import { nowIso, type RelationshipType } from "../domain.ts";
import { buildKnownEntityRef, extractExcludedCouncilOversightNames } from "../connectors/shared.ts";
import { queryAll, queryOne, withTransaction } from "./db.ts";
import { endpointStatusMap } from "./endpoint_status.ts";
import { refreshLegalRefAttachments } from "./legal_ref_attachments.ts";
import { isLegalAuthorityRelationship } from "./relationship_kinds.ts";
import type { WorkbenchStore } from "./store.ts";

const AUTO_ACCEPT_NEEDS_REVIEW_RULES = new Map<string, Set<RelationshipType>>([
  ["bega.structure", new Set(["part_of"])],
  ["council.committees", new Set(["overseen_by"])],
  ["dccourts.structure", new Set(["part_of"])],
  ["mota.quickbase", new Set(["appointed_by", "designated_by", "has_status", "holds"])],
]);

interface AutoAcceptRelationshipRow {
  relationshipCandidateId: string;
  sourceId: string;
  fromEntityRef: string;
  toEntityRef: string;
  relationshipType: RelationshipType;
  rawValue?: string | null;
  needsReview: number;
  reviewItemStatus: string;
  defaultAction: string;
  stalePriorDecision?: number | null;
  replayConflict?: number | null;
  whyDeferred?: string | null;
}

interface AutoAcceptRelationshipStatements {
  insertResolutionEvent: ReturnType<WorkbenchStore["db"]["prepare"]>;
  deleteRelationshipLegalRefs: ReturnType<WorkbenchStore["db"]["prepare"]>;
  insertCanonicalRelationship: ReturnType<WorkbenchStore["db"]["prepare"]>;
  updateRelationshipCandidate: ReturnType<WorkbenchStore["db"]["prepare"]>;
  resolveReviewItem: ReturnType<WorkbenchStore["db"]["prepare"]>;
}

export function autoAcceptSafeRelationshipCandidates(
  store: Pick<WorkbenchStore, "db">,
): number {
  const candidates = queryAll<AutoAcceptRelationshipRow>(
    store.db,
    `select relationship_candidates.relationship_candidate_id as relationshipCandidateId,
            source_items.source_id as sourceId,
            relationship_candidates.from_entity_ref as fromEntityRef,
            relationship_candidates.to_entity_ref as toEntityRef,
            relationship_candidates.relationship_type as relationshipType,
            relationship_candidates.raw_value as rawValue,
            relationship_candidates.needs_review as needsReview,
            review_items.status as reviewItemStatus,
            review_items.default_action as defaultAction,
            json_extract(review_items.details_json, '$.stalePriorDecision') as stalePriorDecision,
            json_extract(review_items.details_json, '$.replayConflict') as replayConflict,
            json_extract(review_items.details_json, '$.whyDeferred') as whyDeferred
     from relationship_candidates
     join source_items on source_items.source_item_id = relationship_candidates.source_item_id
     join review_items
       on review_items.subject_id = relationship_candidates.relationship_candidate_id
      and review_items.item_type = 'relationship_candidate'
     where relationship_candidates.review_status = 'pending'`,
  );
  const endpointStatuses = endpointStatusMap(
    store,
    candidates.flatMap((candidate) => [candidate.fromEntityRef, candidate.toEntityRef]),
  );
  const sameFactDeferredReviewKeys = sameFactDeferredReviewKeySet(store);
  const statements = prepareAutoAcceptRelationshipStatements(store);

  let acceptedCount = 0;
  withTransaction(store.db, () => {
    for (const candidate of candidates) {
      if (!isSafeToAutoAccept(store, endpointStatuses, sameFactDeferredReviewKeys, candidate)) {
        continue;
      }
      acceptRelationshipCandidateDirect(statements, candidate);
      acceptedCount += 1;
    }
  });
  if (acceptedCount > 0) {
    refreshLegalRefAttachments(store);
  }
  return acceptedCount;
}

function prepareAutoAcceptRelationshipStatements(
  store: Pick<WorkbenchStore, "db">,
): AutoAcceptRelationshipStatements {
  return {
    insertResolutionEvent: store.db.prepare(
      `insert or ignore into resolution_events(
         event_id, event_type, subject_id, payload_json, resolution_file, sequence_number, created_at
       ) values(?, 'accept_relationship_candidate', ?, ?, ?, 1, ?)`,
    ),
    deleteRelationshipLegalRefs: store.db.prepare(
      "delete from relationship_legal_refs where relationship_id in (?, ?)",
    ),
    insertCanonicalRelationship: store.db.prepare(
      `insert or ignore into canonical_relationships(
         relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at
       ) values(?, ?, ?, ?, 'accepted', ?, ?)`,
    ),
    updateRelationshipCandidate: store.db.prepare(
      "update relationship_candidates set review_status = 'accepted' where relationship_candidate_id = ?",
    ),
    resolveReviewItem: store.db.prepare(
      "update review_items set status = 'resolved', updated_at = ? where subject_id = ? and item_type = 'relationship_candidate'",
    ),
  };
}

function isSafeToAutoAccept(
  store: Pick<WorkbenchStore, "db">,
  endpointStatuses: ReturnType<typeof endpointStatusMap>,
  sameFactDeferredReviewKeys: Set<string>,
  candidate: AutoAcceptRelationshipRow,
): boolean {
  if (candidate.reviewItemStatus !== "open") return false;
  if (candidate.stalePriorDecision === 1) return false;
  if (candidate.replayConflict === 1) return false;
  if (isSafeCouncilOversightExclusion(store, endpointStatuses, candidate)) return true;
  if (candidate.defaultAction !== "accept") return false;
  if (candidate.whyDeferred) return false;
  if (candidate.needsReview !== 0 && !allowsNeedsReviewAutoAccept(candidate)) return false;
  if (sameFactDeferredReviewKeys.has(relationshipFactKey(candidate))) return false;
  return endpointStatuses.get(candidate.fromEntityRef)?.state === "accepted" &&
    endpointStatuses.get(candidate.toEntityRef)?.state === "accepted";
}

function sameFactDeferredReviewKeySet(
  store: Pick<WorkbenchStore, "db">,
): Set<string> {
  const rows = queryAll<{
    fromEntityRef: string;
    relationshipType: RelationshipType;
    toEntityRef: string;
  }>(
    store.db,
    `select distinct relationship_candidates.from_entity_ref as fromEntityRef,
            relationship_candidates.relationship_type as relationshipType,
            relationship_candidates.to_entity_ref as toEntityRef
     from relationship_candidates
     join review_items
       on review_items.subject_id = relationship_candidates.relationship_candidate_id
      and review_items.item_type = 'relationship_candidate'
     where relationship_candidates.review_status = 'pending'
       and review_items.status in ('open', 'deferred')
       and (
         review_items.default_action = 'defer'
         or json_extract(review_items.details_json, '$.whyDeferred') is not null
       )`,
  );
  return new Set(rows.map((row) => relationshipFactKey(row)));
}

function relationshipFactKey(
  row: Pick<AutoAcceptRelationshipRow, "fromEntityRef" | "relationshipType" | "toEntityRef">,
): string {
  return `${row.fromEntityRef}\u{1f}${row.relationshipType}\u{1f}${row.toEntityRef}`;
}

function isSafeCouncilOversightExclusion(
  store: Pick<WorkbenchStore, "db">,
  endpointStatuses: ReturnType<typeof endpointStatusMap>,
  candidate: AutoAcceptRelationshipRow,
): boolean {
  if (candidate.sourceId !== "council.committees") return false;
  if (candidate.relationshipType !== "overseen_by") return false;
  const excludedRefs = extractExcludedCouncilOversightNames(candidate.rawValue ?? "")
    .map((name) => buildKnownEntityRef(name));
  if (excludedRefs.length === 0) return false;
  if (endpointStatuses.get(candidate.fromEntityRef)?.state !== "accepted") return false;
  if (endpointStatuses.get(candidate.toEntityRef)?.state !== "accepted") return false;
  return excludedRefs.every((entityRef) =>
    excludedEndpointIsAccepted(store, entityRef) &&
    excludedEndpointHasSeparateCommitteeOversight(store, entityRef, candidate.toEntityRef)
  );
}

function excludedEndpointIsAccepted(store: Pick<WorkbenchStore, "db">, entityRef: string): boolean {
  const row = queryOne<{ reviewStatus: string; isPlaceholder: number }>(
    store.db,
    `select review_status as reviewStatus,
            is_placeholder as isPlaceholder
     from canonical_entities
     where entity_id = ?`,
    [entityRef],
  );
  return row?.reviewStatus === "accepted" && row.isPlaceholder === 0;
}

function excludedEndpointHasSeparateCommitteeOversight(
  store: Pick<WorkbenchStore, "db">,
  entityRef: string,
  scopedCommitteeRef: string,
): boolean {
  const row = queryOne<{ count: number }>(
    store.db,
    `select count(*) as count
     from canonical_relationships
     join canonical_entities as oversight_committee
       on oversight_committee.entity_id = canonical_relationships.to_entity_id
     where canonical_relationships.from_entity_id = ?
       and canonical_relationships.relationship_type = 'overseen_by'
       and canonical_relationships.to_entity_id != ?
       and canonical_relationships.review_status = 'accepted'
       and oversight_committee.kind = 'committee'`,
    [entityRef, scopedCommitteeRef],
  );
  return (row?.count ?? 0) > 0;
}

function allowsNeedsReviewAutoAccept(candidate: AutoAcceptRelationshipRow): boolean {
  return AUTO_ACCEPT_NEEDS_REVIEW_RULES.get(candidate.sourceId)?.has(
    candidate.relationshipType,
  ) ===
    true;
}

function acceptRelationshipCandidateDirect(
  statements: AutoAcceptRelationshipStatements,
  candidate: AutoAcceptRelationshipRow,
): void {
  const eventId = `resolution.auto.relationship.${candidate.relationshipCandidateId}`;
  const acceptedAt = nowIso();
  statements.insertResolutionEvent.run([
    eventId,
    candidate.relationshipCandidateId,
    JSON.stringify({
      auto: true,
      reason: "safe_relationship_rule",
      ruleVersion: 1,
      sourceId: candidate.sourceId,
      resolvedFromEntityId: candidate.fromEntityRef,
      resolvedRelationshipType: candidate.relationshipType,
      resolvedToEntityId: candidate.toEntityRef,
    }),
    `auto/relationship/${candidate.relationshipCandidateId}.jsonl`,
    acceptedAt,
  ]);
  const relationshipId =
    `${candidate.fromEntityRef}:${candidate.relationshipType}:${candidate.toEntityRef}`;
  if (isLegalAuthorityRelationship(candidate.relationshipType, candidate.toEntityRef)) {
    statements.deleteRelationshipLegalRefs.run([candidate.relationshipCandidateId, relationshipId]);
  } else {
    statements.insertCanonicalRelationship.run([
      relationshipId,
      candidate.fromEntityRef,
      candidate.relationshipType,
      candidate.toEntityRef,
      eventId,
      acceptedAt,
    ]);
  }
  statements.updateRelationshipCandidate.run([candidate.relationshipCandidateId]);
  statements.resolveReviewItem.run([acceptedAt, candidate.relationshipCandidateId]);
}
