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
      reassignCanonicalEntityDependents(store, row.entityId, targetEntityId);
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

function reassignCanonicalEntityDependents(
  store: WorkbenchStore,
  oldEntityId: string,
  targetEntityId: string,
): void {
  const relationships = queryAll<{
    relationshipId: string;
    fromEntityId: string;
    relationshipType: string;
    toEntityId: string;
    sourceEventId: string;
  }>(
    store.db,
    `select relationship_id as relationshipId,
            from_entity_id as fromEntityId,
            relationship_type as relationshipType,
            to_entity_id as toEntityId,
            source_event_id as sourceEventId
     from canonical_relationships
     where from_entity_id = ? or to_entity_id = ?`,
    [oldEntityId, oldEntityId],
  );
  for (const relationship of relationships) {
    const fromEntityId = relationship.fromEntityId === oldEntityId
      ? targetEntityId
      : relationship.fromEntityId;
    const toEntityId = relationship.toEntityId === oldEntityId
      ? targetEntityId
      : relationship.toEntityId;
    if (fromEntityId === toEntityId) {
      run(store.db, "delete from canonical_relationships where relationship_id = ?", [
        relationship.relationshipId,
      ]);
      continue;
    }
    const relationshipId = `${fromEntityId}:${relationship.relationshipType}:${toEntityId}`;
    if (
      queryOne<{ relationshipId: string }>(
        store.db,
        "select relationship_id as relationshipId from canonical_relationships where relationship_id = ?",
        [relationshipId],
      )
    ) {
      run(store.db, "delete from canonical_relationships where relationship_id = ?", [
        relationship.relationshipId,
      ]);
      continue;
    }
    run(
      store.db,
      `update canonical_relationships
       set relationship_id = ?,
           from_entity_id = ?,
           to_entity_id = ?
       where relationship_id = ?`,
      [relationshipId, fromEntityId, toEntityId, relationship.relationshipId],
    );
    run(
      store.db,
      `update resolution_events
       set payload_json = json_set(
         payload_json,
         '$.resolvedFromEntityId',
         ?,
         '$.resolvedToEntityId',
         ?
       )
       where event_id = ?
         and event_type = 'accept_relationship_candidate'`,
      [fromEntityId, toEntityId, relationship.sourceEventId],
    );
  }

  const legalRefs = queryAll<{ entityLegalRefId: string; legalRefId: string }>(
    store.db,
    `select entity_legal_ref_id as entityLegalRefId,
            legal_ref_id as legalRefId
     from entity_legal_refs
     where entity_id = ?`,
    [oldEntityId],
  );
  for (const legalRef of legalRefs) {
    const entityLegalRefId = `${targetEntityId}:${legalRef.legalRefId}`;
    if (
      queryOne<{ entityLegalRefId: string }>(
        store.db,
        "select entity_legal_ref_id as entityLegalRefId from entity_legal_refs where entity_legal_ref_id = ?",
        [entityLegalRefId],
      )
    ) {
      run(store.db, "delete from entity_legal_refs where entity_legal_ref_id = ?", [
        legalRef.entityLegalRefId,
      ]);
      continue;
    }
    run(
      store.db,
      `update entity_legal_refs
       set entity_legal_ref_id = ?,
           entity_id = ?
       where entity_legal_ref_id = ?`,
      [entityLegalRefId, targetEntityId, legalRef.entityLegalRefId],
    );
  }
}
