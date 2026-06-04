import { nowIso } from "../domain.ts";
import { queryAll, queryOne, run } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

interface CanonicalEntityFieldsRow {
  name: string;
  kind: string;
  branch?: string | null;
  cluster?: string | null;
  officialUrl?: string | null;
  mergedCandidateIds: string;
}

interface AcceptedEntityCandidateRow {
  candidateId: string;
  name: string;
  kind: string;
  branch?: string | null;
  cluster?: string | null;
  officialUrl?: string | null;
  confidence?: number | null;
}

export function refreshCanonicalEntityFieldsFromAcceptedCandidates(
  store: WorkbenchStore,
  entityId: string,
): void {
  if (hasManualFieldResolution(store, entityId)) return;
  const current = queryOne<CanonicalEntityFieldsRow>(
    store.db,
    `select name,
            kind,
            branch,
            cluster,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = ?`,
    [entityId],
  );
  if (!current) return;
  const mergedCandidateIds = JSON.parse(current.mergedCandidateIds) as string[];
  if (mergedCandidateIds.length === 0) return;
  const placeholders = mergedCandidateIds.map(() => "?").join(", ");
  const candidates = queryAll<AcceptedEntityCandidateRow>(
    store.db,
    `select candidate_id as candidateId,
            name,
            kind,
            branch,
            cluster,
            official_url as officialUrl,
            confidence
     from entity_candidates
     where review_status = 'accepted'
       and candidate_id in (${placeholders})`,
    mergedCandidateIds,
  );
  if (candidates.length === 0) return;
  const order = new Map(mergedCandidateIds.map((candidateId, index) => [candidateId, index]));
  const strongest = candidates.toSorted((a, b) => {
    const confidenceDelta = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (confidenceDelta !== 0) return confidenceDelta;
    return (order.get(a.candidateId) ?? 0) - (order.get(b.candidateId) ?? 0);
  })[0];
  run(
    store.db,
    `update canonical_entities
     set name = ?,
         kind = ?,
         branch = ?,
         cluster = ?,
         official_url = ?,
         updated_at = ?
     where entity_id = ?`,
    [
      strongest.name,
      strongest.kind,
      strongest.branch ?? current.branch ?? null,
      strongest.cluster ?? current.cluster ?? null,
      strongest.officialUrl ?? current.officialUrl ?? null,
      nowIso(),
      entityId,
    ],
  );
}

function hasManualFieldResolution(store: WorkbenchStore, entityId: string): boolean {
  const row = queryOne<{ count: number }>(
    store.db,
    `select count(*) as count
     from resolution_events
     where event_type = 'set_entity_fields'
       and (subject_id = ? or json_extract(payload_json, '$.entityId') = ?)`,
    [entityId, entityId],
  );
  return (row?.count ?? 0) > 0;
}
