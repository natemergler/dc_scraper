import { loadRecords } from "./io.ts";
import { findCandidate } from "./candidates.ts";
import { PatchDocument, PatchOperation } from "./patches.ts";

const recordOnlyFields = new Set([
  "record_origin",
  "derived_from",
  "source_context",
  "release_relevant_caveats",
  "field_source_refs",
  "candidate_collisions",
]);

export async function draftPatchForRecord(
  repoPath: string,
  recordId: string,
): Promise<PatchDocument> {
  const record = (await loadRecords(repoPath)).find((entry) => entry.record.id === recordId)
    ?.record;
  if (!record) throw new Error(`Record not found: ${recordId}`);
  const derivedFrom = record.derived_from as Record<string, unknown> | undefined;
  const candidateId = typeof derivedFrom?.candidate_id === "string"
    ? derivedFrom.candidate_id
    : null;
  if (!candidateId) throw new Error(`Record ${recordId} has no derived_from.candidate_id`);
  const candidate = await findCandidate(repoPath, candidateId);
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);

  const operations: PatchOperation[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (recordOnlyFields.has(key)) continue;
    const candidateValue = candidate.record[key];
    if (JSON.stringify(value) === JSON.stringify(candidateValue)) continue;
    if (Array.isArray(value) && Array.isArray(candidateValue)) {
      for (const item of value) {
        if (
          !candidateValue.some((candidateItem) =>
            JSON.stringify(candidateItem) === JSON.stringify(item)
          )
        ) {
          operations.push({ op: "append_unique", path: `/${key}`, value: item });
        }
      }
    } else {
      operations.push(
        candidateValue === undefined
          ? { op: "set", path: `/${key}`, value }
          : { op: "set", path: `/${key}`, value, expected_before: candidateValue },
      );
    }
  }

  return {
    id: `patch.${recordId.replaceAll(".", "_")}`,
    record_type: "patch",
    status: "draft",
    candidate_id: candidateId,
    operations,
  };
}
