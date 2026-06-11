export type LiteralUnion<LiteralType extends BaseType, BaseType extends string = string> =
  | LiteralType
  | (BaseType & Record<never, never>);

export type EntryFamily = LiteralUnion<
  "organization" | "person" | "position" | "area" | "authority"
>;

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

export interface Citation {
  source: string;
  sourceRecordId: string;
  locator?: string;
  url?: string;
}

export interface UncitedCitation {
  uncited: true;
  reason?: string;
}

export type CitationValue = Citation | UncitedCitation;

export interface BaseRelation {
  kind: string;
  to: string;
  citations?: CitationValue[];
}

export interface Relation extends BaseRelation {
  from: string;
}

export interface Entry {
  id: string;
  family: EntryFamily;
  kind: string;
  name: string;
  attributes: Record<string, unknown>;
  citations: CitationValue[];
  relations: Record<string, BaseRelation[]>;
}

export type BaselineEntry = Entry;

export type StateEntry = Entry;

export interface EntryFragment {
  fragmentType: "entry";
  source: string;
  sourceRecordId: string;
  provisionalId: string;
  family: EntryFamily;
  kind: string;
  name: string;
  attributes: Record<string, unknown>;
  citations: CitationValue[];
}

export interface RelationFragment {
  fragmentType: "relation";
  source: string;
  sourceRecordId: string;
  from: string;
  relationKind: string;
  to: string;
  citations: CitationValue[];
}

export interface Finding {
  kind: "info" | "warn" | "conflict";
  code: string;
  message: string;
  citation?: CitationValue;
}

export interface Revision {
  id: string;
  source: string;
  targetKind: "entry" | "relation";
  targetId: string;
  rationale?: string;
  evidence?: CitationValue[];
  patch: Record<string, unknown>;
}

export interface LedgerState {
  jurisdiction: string;
  generatedAt: string;
  entries: Map<string, Entry>;
  findings: Finding[];
}

export function cite(
  source: string,
  sourceRecordId: string,
  options?: { locator?: string; url?: string },
): Citation {
  return {
    source,
    sourceRecordId,
    locator: options?.locator,
    url: options?.url,
  };
}

export function uncited(reason?: string): UncitedCitation {
  return {
    uncited: true,
    ...(reason ? { reason } : {}),
  };
}

export function isCitationValue(value: unknown): value is CitationValue {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.uncited === true) {
    return (
      typeof candidate.reason === "string" || typeof candidate.reason === "undefined"
    );
  }

  return (
    typeof candidate.source === "string" &&
    typeof candidate.sourceRecordId === "string" &&
    (typeof candidate.locator === "string" || typeof candidate.locator === "undefined") &&
    (typeof candidate.url === "string" || typeof candidate.url === "undefined")
  );
}
