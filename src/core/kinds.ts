import { type Entry, type EntryFamily, isCitationValue, type ValidationIssue } from "./types.ts";

export type AttributeType = "string" | "number" | "boolean" | "json";

export interface AttributeSpec {
  required: boolean;
  type?: AttributeType;
}

export interface EntryKind<K extends string = string, F extends EntryFamily = EntryFamily> {
  kind: K;
  family: F;
  attributes: Record<string, AttributeSpec>;
}

export interface RelationKind<K extends string = string> {
  kind: K;
}

export interface RelationKindInput<K extends string = string> {
  kind: K;
}

export interface EntryKindInput<K extends string = string, F extends EntryFamily = EntryFamily> {
  kind: K;
  family: F;
  attributes?: Record<string, AttributeSpec>;
}

export interface EntryKindRegistry {
  register(kind: EntryKind): void;
  get(kind: string): EntryKind | undefined;
  listKinds(): EntryKind[];
  validateEntry(entry: Entry): ValidationResult;
  registerRelation?(kind: RelationKind): void;
  getRelationKind?(kind: string): RelationKind | undefined;
  listRelationKinds?(): RelationKind[];
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

type AttributeValue<S extends AttributeSpec> = S["type"] extends "number" ? number
  : S["type"] extends "boolean" ? boolean
  : S["type"] extends "string" ? string
  : S["type"] extends "json" ? unknown
  : unknown;

type RequiredAttributeKeys<K extends EntryKind> = {
  [K2 in keyof K["attributes"]]: K["attributes"][K2]["required"] extends true ? K2
    : never;
}[keyof K["attributes"]];

type OptionalAttributeKeys<K extends EntryKind> = {
  [K2 in keyof K["attributes"]]: K["attributes"][K2]["required"] extends true ? never
    : K2;
}[keyof K["attributes"]];

type AttributeTypeFor<K extends EntryKind, K2 extends keyof K["attributes"]> = AttributeValue<
  K["attributes"][K2]
>;

export type EntryFromKind<K extends EntryKind> = Omit<Entry, "kind" | "family" | "attributes"> & {
  kind: K["kind"];
  family: K["family"];
  attributes:
    & {
      [A in RequiredAttributeKeys<K>]-?: AttributeTypeFor<K, A>;
    }
    & {
      [A in OptionalAttributeKeys<K>]?: AttributeTypeFor<K, A>;
    };
};

export function defineEntryKind<K extends string, F extends EntryFamily>(
  definition: EntryKindInput<K, F>,
): EntryKind<K, F> {
  return {
    ...definition,
    attributes: definition.attributes ?? {},
  };
}

export function defineRelationKind<K extends string>(
  definition: RelationKindInput<K>,
): RelationKind<K> {
  return definition;
}

const issue = (
  code: string,
  path: string,
  message: string,
): ValidationIssue => ({ code, path, message });

export class KindRegistry implements EntryKindRegistry {
  private readonly kinds = new Map<string, EntryKind>();
  private readonly relationKinds = new Map<string, RelationKind>();

  register(kind: EntryKind): void {
    this.kinds.set(kind.kind, kind);
  }

  registerRelation(kind: RelationKind): void {
    this.relationKinds.set(kind.kind, kind);
  }

  get(kind: string): EntryKind | undefined {
    return this.kinds.get(kind);
  }

  getRelationKind(kind: string): RelationKind | undefined {
    return this.relationKinds.get(kind);
  }

  listKinds(): EntryKind[] {
    return [...this.kinds.values()];
  }

  listRelationKinds(): RelationKind[] {
    return [...this.relationKinds.values()];
  }

  validateEntry(entry: Entry): ValidationResult {
    const issues: ValidationIssue[] = [];

    if (typeof entry.id !== "string" || entry.id.length === 0) {
      issues.push(issue("entry.id_missing", "id", "entry id must be a non-empty string"));
    }

    if (typeof entry.kind !== "string" || entry.kind.length === 0) {
      issues.push(issue("entry.kind_missing", "kind", "entry kind must be a non-empty string"));
    }

    if (typeof entry.name !== "string" || entry.name.length === 0) {
      issues.push(issue("entry.name_missing", "name", "entry name must be a non-empty string"));
    }

    if (typeof entry.family !== "string" || entry.family.length === 0) {
      issues.push(
        issue("entry.family_missing", "family", "entry family must be a non-empty string"),
      );
    }

    if (!Array.isArray(entry.citations)) {
      issues.push(issue("entry.citations_missing", "citations", "citations must be an array"));
    } else {
      entry.citations.forEach((citation, index) => {
        if (!isCitationValue(citation)) {
          issues.push(issue(
            "entry.citation_invalid",
            `citations[${index}]`,
            "citation must match cite(...) or uncited(...) shape",
          ));
        }
      });
    }

    const attributes = entry.attributes;
    const attributesAreObject = typeof attributes === "object" &&
      attributes !== null &&
      !Array.isArray(attributes);
    const attributeValues = attributesAreObject ? attributes as Record<string, unknown> : undefined;
    if (!attributesAreObject) {
      issues.push(issue("entry.attributes_missing", "attributes", "attributes must be an object"));
    }

    const kindDefinition = this.get(entry.kind);
    if (!kindDefinition) {
      issues.push(issue("entry.kind_unknown", "kind", `unknown entry kind: ${entry.kind}`));
      return { ok: false, issues };
    }

    if (entry.family !== kindDefinition.family) {
      issues.push(
        issue(
          "entry.family_mismatch",
          "family",
          `family ${entry.family} does not match kind family ${kindDefinition.family}`,
        ),
      );
    }

    for (const [attributeName, spec] of Object.entries(kindDefinition.attributes)) {
      const hasValue = attributeValues !== undefined &&
        Object.hasOwn(attributeValues, attributeName);
      if (!hasValue && spec.required) {
        issues.push(
          issue(
            "entry.attribute_missing",
            `attributes.${attributeName}`,
            `required attribute missing: ${attributeName}`,
          ),
        );
      }

      if (hasValue) {
        const value = attributeValues[attributeName];
        if (spec.type === "number" && typeof value !== "number") {
          issues.push(
            issue(
              "entry.attribute_type",
              `attributes.${attributeName}`,
              `attribute ${attributeName} must be number`,
            ),
          );
        }
        if (spec.type === "boolean" && typeof value !== "boolean") {
          issues.push(
            issue(
              "entry.attribute_type",
              `attributes.${attributeName}`,
              `attribute ${attributeName} must be boolean`,
            ),
          );
        }
        if (spec.type === "string" && typeof value !== "string") {
          issues.push(
            issue(
              "entry.attribute_type",
              `attributes.${attributeName}`,
              `attribute ${attributeName} must be string`,
            ),
          );
        }
      }
    }

    if (entry.relations && typeof entry.relations === "object") {
      for (const [facet, relations] of Object.entries(entry.relations)) {
        if (!Array.isArray(relations)) {
          issues.push(
            issue(
              "entry.relations_shape",
              `relations.${facet}`,
              `relation facet ${facet} must be an array`,
            ),
          );
          continue;
        }

        for (const [index, relation] of relations.entries()) {
          if (typeof relation.kind !== "string" || relation.kind.length === 0) {
            issues.push(
              issue(
                "entry.relation_kind",
                `relations.${facet}[${index}].kind`,
                "relation kind must be a non-empty string",
              ),
            );
          } else if (this.relationKinds.size > 0 && !this.relationKinds.has(relation.kind)) {
            issues.push(
              issue(
                "entry.relation_kind_unknown",
                `relations.${facet}[${index}].kind`,
                `unknown relation kind: ${relation.kind}`,
              ),
            );
          }

          if (facet !== relation.kind) {
            issues.push(
              issue(
                "entry.relation_facet_mismatch",
                `relations.${facet}[${index}].kind`,
                `relation facet ${facet} does not match relation kind ${relation.kind}`,
              ),
            );
          }

          if (typeof relation.to !== "string" || relation.to.length === 0) {
            issues.push(
              issue(
                "entry.relation_to",
                `relations.${facet}[${index}].to`,
                "relation to must be a non-empty string",
              ),
            );
          }

          if (relation.citations) {
            if (!Array.isArray(relation.citations)) {
              issues.push(
                issue(
                  "entry.relation_citations_shape",
                  `relations.${facet}[${index}].citations`,
                  "relation citations must be an array",
                ),
              );
            } else {
              relation.citations.forEach((citation, citationIndex) => {
                if (!isCitationValue(citation)) {
                  issues.push(
                    issue(
                      "entry.relation_citation_invalid",
                      `relations.${facet}[${index}].citations[${citationIndex}]`,
                      "relation citation must match cite(...) or uncited(...) shape",
                    ),
                  );
                }
              });
            }
          }
        }
      }
    }

    return { ok: issues.length === 0, issues };
  }
}
