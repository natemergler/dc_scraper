import { nowIso, type RelationshipType } from "../domain.ts";
import { queryAll, run } from "./db.ts";
import { endpointStatus } from "./reconciliation.ts";
import type { WorkbenchStore } from "./store.ts";

const AUTO_ACCEPT_RULES = new Map<string, Set<RelationshipType>>([
  ["council.committees", new Set(["chairs", "member_of", "part_of"])],
  ["council.members", new Set(["holds", "part_of", "represents"])],
  ["dcgis.agencies", new Set(["part_of"])],
  ["dcgis.boards_commissions_councils", new Set(["governed_by", "part_of"])],
  ["oanc.anc_profiles", new Set(["part_of", "member_of", "represents"])],
  ["open_dc.public_bodies", new Set(["authorized_by", "governed_by"])],
]);

interface AutoAcceptRelationshipRow {
  relationshipCandidateId: string;
  sourceId: string;
  fromEntityRef: string;
  toEntityRef: string;
  relationshipType: RelationshipType;
  needsReview: number;
  reviewItemStatus: string;
  defaultAction: string;
  stalePriorDecision?: number | null;
}

export function autoAcceptSafeRelationshipCandidates(store: WorkbenchStore): number {
  const candidates = queryAll<AutoAcceptRelationshipRow>(
    store.db,
    `select relationship_candidates.relationship_candidate_id as relationshipCandidateId,
            source_items.source_id as sourceId,
            relationship_candidates.from_entity_ref as fromEntityRef,
            relationship_candidates.to_entity_ref as toEntityRef,
            relationship_candidates.relationship_type as relationshipType,
            relationship_candidates.needs_review as needsReview,
            review_items.status as reviewItemStatus,
            review_items.default_action as defaultAction,
            json_extract(review_items.details_json, '$.stalePriorDecision') as stalePriorDecision
     from relationship_candidates
     join source_items on source_items.source_item_id = relationship_candidates.source_item_id
     join review_items
       on review_items.subject_id = relationship_candidates.relationship_candidate_id
      and review_items.item_type = 'relationship_candidate'
     where relationship_candidates.review_status = 'pending'`,
  );

  let acceptedCount = 0;
  for (const candidate of candidates) {
    if (!isSafeToAutoAccept(store, candidate)) continue;
    acceptRelationshipCandidateDirect(store, candidate);
    acceptedCount += 1;
  }
  return acceptedCount;
}

function isSafeToAutoAccept(store: WorkbenchStore, candidate: AutoAcceptRelationshipRow): boolean {
  const allowedTypes = AUTO_ACCEPT_RULES.get(candidate.sourceId);
  if (!allowedTypes?.has(candidate.relationshipType)) return false;
  if (candidate.reviewItemStatus !== "open") return false;
  if (candidate.defaultAction !== "accept") return false;
  if (candidate.needsReview !== 0) return false;
  if (candidate.stalePriorDecision === 1) return false;
  return endpointStatus(store, candidate.fromEntityRef).state === "accepted" &&
    endpointStatus(store, candidate.toEntityRef).state === "accepted";
}

function acceptRelationshipCandidateDirect(
  store: WorkbenchStore,
  candidate: AutoAcceptRelationshipRow,
): void {
  const eventId = `resolution.auto.relationship.${candidate.relationshipCandidateId}`;
  run(
    store.db,
    `insert or ignore into resolution_events(
       event_id, event_type, subject_id, payload_json, resolution_file, sequence_number, created_at
     ) values(?, 'accept_relationship_candidate', ?, ?, ?, 1, ?)`,
    [
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
      nowIso(),
    ],
  );
  const relationshipId =
    `${candidate.fromEntityRef}:${candidate.relationshipType}:${candidate.toEntityRef}`;
  if (!isLegalAuthorityRelationship(candidate.relationshipType, candidate.toEntityRef)) {
    run(
      store.db,
      `insert or ignore into canonical_relationships(
         relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at
       ) values(?, ?, ?, ?, 'accepted', ?, ?)`,
      [
        relationshipId,
        candidate.fromEntityRef,
        candidate.relationshipType,
        candidate.toEntityRef,
        eventId,
        nowIso(),
      ],
    );
  }
  run(
    store.db,
    "update relationship_candidates set review_status = 'accepted' where relationship_candidate_id = ?",
    [candidate.relationshipCandidateId],
  );
  run(
    store.db,
    "update review_items set status = 'resolved', updated_at = ? where subject_id = ? and item_type = 'relationship_candidate'",
    [nowIso(), candidate.relationshipCandidateId],
  );
}

function isLegalAuthorityRelationship(
  relationshipType: RelationshipType,
  toEntityRef: string,
): boolean {
  return relationshipType === "authorized_by" && toEntityRef.startsWith("legal.");
}
