import { queryAll, queryOne, run } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

interface LegalRefAttachmentRow {
  legalRefId: string;
  sourceItemId: string;
  attachEntityRef?: string | null;
  attachRelationshipRef?: string | null;
}

export function refreshLegalRefAttachments(store: Pick<WorkbenchStore, "db">): void {
  const attachments = queryAll<LegalRefAttachmentRow>(
    store.db,
    `select legal_refs.legal_ref_id as legalRefId,
            legal_refs.source_item_id as sourceItemId,
            json_extract(review_items.details_json, '$.attachEntityRef') as attachEntityRef,
            json_extract(review_items.details_json, '$.attachRelationshipRef') as attachRelationshipRef
     from legal_refs
     join review_items
       on review_items.subject_id = legal_refs.legal_ref_id
      and review_items.item_type = 'legal_ref'`,
  );
  for (const attachment of attachments) {
    refreshLegalRefAttachment(store, attachment);
  }
}

function refreshLegalRefAttachment(
  store: Pick<WorkbenchStore, "db">,
  attachment: LegalRefAttachmentRow,
): void {
  run(store.db, "delete from entity_legal_refs where legal_ref_id = ?", [
    attachment.legalRefId,
  ]);
  run(store.db, "delete from relationship_legal_refs where legal_ref_id = ?", [
    attachment.legalRefId,
  ]);
  if (
    attachment.attachEntityRef &&
    isAcceptedCanonicalEntity(store, attachment.attachEntityRef) &&
    !hasMatchingUnacceptedEntityCandidate(
      store,
      attachment.sourceItemId,
      attachment.attachEntityRef,
    )
  ) {
    insertEntityLegalRefAttachment(store, attachment.attachEntityRef, attachment.legalRefId);
  }
  if (
    attachment.attachRelationshipRef &&
    isAcceptedCanonicalRelationship(store, attachment.attachRelationshipRef)
  ) {
    insertRelationshipLegalRefAttachment(
      store,
      attachment.attachRelationshipRef,
      attachment.legalRefId,
    );
  }
}

function hasMatchingUnacceptedEntityCandidate(
  store: Pick<WorkbenchStore, "db">,
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

function isAcceptedCanonicalEntity(
  store: Pick<WorkbenchStore, "db">,
  entityId: string,
): boolean {
  const row = queryOne<{ entityId: string }>(
    store.db,
    `select entity_id as entityId
     from canonical_entities
     where entity_id = ?
       and review_status = 'accepted'
       and is_placeholder = 0`,
    [entityId],
  );
  return Boolean(row);
}

function isAcceptedCanonicalRelationship(
  store: Pick<WorkbenchStore, "db">,
  relationshipId: string,
): boolean {
  const row = queryOne<{ relationshipId: string }>(
    store.db,
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = ?
       and review_status = 'accepted'`,
    [relationshipId],
  );
  return Boolean(row);
}

function insertEntityLegalRefAttachment(
  store: Pick<WorkbenchStore, "db">,
  entityId: string,
  legalRefId: string,
): void {
  run(
    store.db,
    "insert or ignore into entity_legal_refs(entity_legal_ref_id, entity_id, legal_ref_id) values(?, ?, ?)",
    [`${entityId}:${legalRefId}`, entityId, legalRefId],
  );
}

function insertRelationshipLegalRefAttachment(
  store: Pick<WorkbenchStore, "db">,
  relationshipId: string,
  legalRefId: string,
): void {
  run(
    store.db,
    "insert or ignore into relationship_legal_refs(relationship_legal_ref_id, relationship_id, legal_ref_id) values(?, ?, ?)",
    [`${relationshipId}:${legalRefId}`, relationshipId, legalRefId],
  );
}
