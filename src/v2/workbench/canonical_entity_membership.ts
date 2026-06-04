import { nowIso } from "../domain.ts";
import { queryAll, queryOne, run } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

interface CanonicalMembershipRow {
  entityId: string;
  mergedCandidateIds: string;
}

export function detachEntityCandidateFromOtherCanonicalEntities(
  store: WorkbenchStore,
  candidateId: string,
  targetEntityId: string,
): string[] {
  const rows = queryAll<CanonicalMembershipRow>(
    store.db,
    `select entity_id as entityId,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id != ?
       and exists (
         select 1
         from json_each(canonical_entities.merged_candidate_ids)
         where value = ?
       )`,
    [targetEntityId, candidateId],
  );
  const detachedEntityIds: string[] = [];
  for (const row of rows) {
    const merged = (JSON.parse(row.mergedCandidateIds) as string[]).filter((id) =>
      id !== candidateId
    );
    detachedEntityIds.push(row.entityId);
    if (merged.length === 0) {
      if (!canDeleteCanonicalEntity(store, row.entityId)) {
        throw new Error(
          `Cannot move candidate ${candidateId} from ${row.entityId} to ${targetEntityId}: old entity has dependent facts`,
        );
      }
      run(store.db, "delete from canonical_entities where entity_id = ?", [row.entityId]);
      continue;
    }
    run(
      store.db,
      "update canonical_entities set merged_candidate_ids = ?, updated_at = ? where entity_id = ?",
      [JSON.stringify(merged), nowIso(), row.entityId],
    );
  }
  return detachedEntityIds;
}

function canDeleteCanonicalEntity(store: WorkbenchStore, entityId: string): boolean {
  const row = queryOne<{ dependentCount: number }>(
    store.db,
    `select
       (select count(*) from canonical_relationships where from_entity_id = ? or to_entity_id = ?) +
       (select count(*) from entity_legal_refs where entity_id = ?) as dependentCount`,
    [entityId, entityId, entityId],
  );
  return (row?.dependentCount ?? 0) === 0;
}
