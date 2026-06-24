import {
  type Entry,
  type Finding,
  type ValidationIssue,
  type ValidationResult,
} from "../core/types.ts";
import { KindRegistry } from "../core/kinds.ts";

export type StateValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

export function validateStateEntries(
  entries: Map<string, Entry>,
  kindRegistry: KindRegistry,
): StateValidationResult {
  const issues: ValidationIssue[] = [];

  for (const [entryId, entry] of entries) {
    const entryResult: ValidationResult = kindRegistry.validateEntry(entry);
    if (!entryResult.ok) {
      issues.push(
        ...entryResult.issues.map((issue) => ({
          ...issue,
          path: `entries.${entryId}.${issue.path}`,
        })),
      );
    }
  }

  for (const [entryId, entry] of entries) {
    for (const [facetName, relations] of Object.entries(entry.relations ?? {})) {
      for (const [index, relation] of relations.entries()) {
        if (!entries.has(relation.to)) {
          issues.push({
            code: "relation.target_missing",
            path: `entries.${entryId}.relations.${facetName}[${index}].to`,
            message: `target entry not found: ${relation.to}`,
          });
        }
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

export function toFindings(result: StateValidationResult): Finding[] {
  return result.issues.map((issue) => ({
    kind: "conflict",
    code: issue.code,
    message: issue.message,
  }));
}
