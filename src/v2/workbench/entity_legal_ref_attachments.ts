import { queryAll, queryOne, run } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

export function materializeEntityLegalRefAttachmentIfResolved(
  store: WorkbenchStore,
  input: {
    sourceItemId: string;
    attachEntityRef: string;
    legalRefId: string;
  },
): void {
  if (
    hasMatchingUnacceptedEntityCandidate(
      store,
      input.sourceItemId,
      input.attachEntityRef,
    )
  ) {
    run(
      store.db,
      "delete from entity_legal_refs where entity_id = ? and legal_ref_id = ?",
      [input.attachEntityRef, input.legalRefId],
    );
    return;
  }
  insertEntityLegalRefAttachment(store, input.attachEntityRef, input.legalRefId);
}

export function materializeEntityLegalRefsForAcceptedCandidate(
  store: WorkbenchStore,
  candidateId: string,
  entityId: string,
): void {
  const candidate = queryOne<{
    sourceItemId: string;
    proposedEntityId: string;
    reviewStatus: string;
  }>(
    store.db,
    `select source_item_id as sourceItemId,
            proposed_entity_id as proposedEntityId,
            review_status as reviewStatus
     from entity_candidates
     where candidate_id = ?`,
    [candidateId],
  );
  if (!candidate || candidate.reviewStatus !== "accepted") return;
  const legalRefs = queryAll<{ legalRefId: string }>(
    store.db,
    `select legal_refs.legal_ref_id as legalRefId
     from legal_refs
     join review_items
       on review_items.subject_id = legal_refs.legal_ref_id
      and review_items.item_type = 'legal_ref'
     where legal_refs.source_item_id = ?
       and json_extract(review_items.details_json, '$.attachEntityRef') = ?`,
    [candidate.sourceItemId, candidate.proposedEntityId],
  );
  for (const legalRef of legalRefs) {
    insertEntityLegalRefAttachment(store, entityId, legalRef.legalRefId);
  }
}

function hasMatchingUnacceptedEntityCandidate(
  store: WorkbenchStore,
  sourceItemId: string,
  entityId: string,
): boolean {
  const candidates = queryAll<{ reviewStatus: string }>(
    store.db,
    `select review_status as reviewStatus
     from entity_candidates
     where source_item_id = ?
       and proposed_entity_id = ?`,
    [sourceItemId, entityId],
  );
  return candidates.length > 0 &&
    candidates.every((candidate) => candidate.reviewStatus !== "accepted");
}

function insertEntityLegalRefAttachment(
  store: WorkbenchStore,
  entityId: string,
  legalRefId: string,
): void {
  run(
    store.db,
    "insert or ignore into entity_legal_refs(entity_legal_ref_id, entity_id, legal_ref_id) values(?, ?, ?)",
    [`${entityId}:${legalRefId}`, entityId, legalRefId],
  );
}
