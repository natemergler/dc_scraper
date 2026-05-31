import { loadRecords } from "./io.ts";
import { Check, isRecordType, LoadedRecord } from "./types.ts";

export async function validateRepo(repoPath: string): Promise<Check[]> {
  return validateLoadedRecords(await loadRecords(repoPath));
}

export function validateLoadedRecords(records: LoadedRecord[]): Check[] {
  const checks: Check[] = [];
  const byId = new Map<string, LoadedRecord[]>();
  const sourceIds = new Set<string>();
  const civicUnitIds = new Set<string>();
  const relationshipTypeIds = new Set<string>();

  for (const loaded of records) {
    const record = loaded.record;
    if (typeof record.id !== "string" || record.id.trim() === "") {
      checks.push(
        check("missing_required_field", "error", "Record is missing a stable id.", loaded),
      );
      continue;
    }
    if (!isRecordType(record.record_type)) {
      checks.push(
        check("invalid_enum", "error", `Record ${record.id} has unknown record_type.`, loaded),
      );
      continue;
    }
    if (!record.name && !record.display_name) {
      checks.push(
        check("missing_required_field", "warning", `Record ${record.id} has no name.`, loaded),
      );
    }
    if (loaded.relativePath !== loaded.expectedRelativePath) {
      checks.push(
        check(
          "path_id_mismatch",
          "error",
          `Record ${record.id} is at ${loaded.relativePath}; expected ${loaded.expectedRelativePath}.`,
          loaded,
        ),
      );
    }
    byId.set(record.id, [...(byId.get(record.id) ?? []), loaded]);
    if (record.record_type === "source") sourceIds.add(record.id);
    if (record.record_type === "civic_unit") civicUnitIds.add(record.id);
    if (record.record_type === "relationship_type") relationshipTypeIds.add(record.id);
  }

  for (const [id, matches] of byId) {
    if (matches.length > 1) {
      for (const loaded of matches) {
        checks.push(check("duplicate_id", "error", `Duplicate record id ${id}.`, loaded));
      }
    }
  }

  for (const loaded of records) {
    const record = loaded.record;
    if (typeof record.id !== "string" || !isRecordType(record.record_type)) continue;

    if (record.record_type !== "source" && !hasSourceRefs(record)) {
      checks.push(
        check(
          "missing_source_ref",
          record.status === "planned" ? "info" : "warning",
          `Record ${record.id} has no source_refs.`,
          loaded,
          true,
        ),
      );
    }

    for (const sourceId of record.source_refs ?? []) {
      if (!sourceIds.has(sourceId)) {
        checks.push(
          check(
            "unknown_source_id",
            "warning",
            `Record ${record.id} references unknown source ${sourceId}.`,
            loaded,
            true,
          ),
        );
      }
    }

    if (record.record_type === "relationship") {
      validateRelationship(loaded, civicUnitIds, relationshipTypeIds, checks);
    }
  }

  return checks.sort((a, b) =>
    severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id)
  );
}

function validateRelationship(
  loaded: LoadedRecord,
  civicUnitIds: Set<string>,
  relationshipTypeIds: Set<string>,
  checks: Check[],
): void {
  const record = loaded.record;
  const relationshipTypeId = record.relationship_type_id;
  if (typeof relationshipTypeId !== "string") {
    checks.push(
      check(
        "missing_required_field",
        "error",
        `Relationship ${record.id} has no relationship_type_id.`,
        loaded,
      ),
    );
  } else if (!relationshipTypeIds.has(relationshipTypeId)) {
    checks.push(
      check(
        "broken_internal_ref",
        "error",
        `Relationship ${record.id} references missing relationship type ${relationshipTypeId}.`,
        loaded,
      ),
    );
  }

  for (const field of ["source_actor", "target_actor"]) {
    const actor = record[field];
    if (!isActor(actor)) {
      checks.push(
        check(
          "relationship_endpoint_missing",
          "error",
          `Relationship ${record.id} has invalid ${field}.`,
          loaded,
        ),
      );
      continue;
    }
    if (actor.kind === "civic_unit" && !civicUnitIds.has(actor.id)) {
      checks.push(
        check(
          "broken_internal_ref",
          "error",
          `Relationship ${record.id} ${field} references missing civic unit ${actor.id}.`,
          loaded,
        ),
      );
    }
  }
}

function hasSourceRefs(record: { source_refs?: unknown }): boolean {
  return Array.isArray(record.source_refs) && record.source_refs.length > 0;
}

function isActor(
  value: unknown,
): value is { kind: "civic_unit"; id: string } | { kind: "external"; name: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actor = value as Record<string, unknown>;
  if (actor.kind === "civic_unit") return typeof actor.id === "string" && actor.id.length > 0;
  if (actor.kind === "external") return typeof actor.name === "string" && actor.name.length > 0;
  return false;
}

function check(
  kind: string,
  severity: Check["severity"],
  message: string,
  loaded: LoadedRecord,
  releaseRelevant = false,
): Check {
  const recordId = typeof loaded.record.id === "string" ? loaded.record.id : "unknown";
  return {
    id: `check.${kind}.${recordId.replaceAll("/", ".")}`,
    kind,
    severity,
    message,
    record_id: recordId,
    path: loaded.relativePath,
    release_relevant: releaseRelevant,
  };
}

function severityRank(severity: Check["severity"]): number {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}
