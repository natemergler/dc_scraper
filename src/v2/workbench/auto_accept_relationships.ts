import { nowIso, type RelationshipType } from "../domain.ts";
import { queryAll, run, withTransaction } from "./db.ts";
import { endpointStatusMap } from "./endpoint_status.ts";
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
  needsReview: number;
  reviewItemStatus: string;
  defaultAction: string;
  stalePriorDecision?: number | null;
  replayConflict?: number | null;
  whyDeferred?: string | null;
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

  let acceptedCount = 0;
  withTransaction(store.db, () => {
    for (const candidate of candidates) {
      if (!isSafeToAutoAccept(endpointStatuses, candidate)) continue;
      acceptRelationshipCandidateDirect(store, candidate);
      acceptedCount += 1;
    }
  });
  return acceptedCount;
}

function isSafeToAutoAccept(
  endpointStatuses: ReturnType<typeof endpointStatusMap>,
  candidate: AutoAcceptRelationshipRow,
): boolean {
  if (candidate.reviewItemStatus !== "open") return false;
  if (candidate.defaultAction !== "accept") return false;
  if (candidate.stalePriorDecision === 1) return false;
  if (candidate.replayConflict === 1) return false;
  if (candidate.whyDeferred) return false;
  if (candidate.needsReview !== 0 && !allowsNeedsReviewAutoAccept(candidate)) return false;
  return endpointStatuses.get(candidate.fromEntityRef)?.state === "accepted" &&
    endpointStatuses.get(candidate.toEntityRef)?.state === "accepted";
}

function allowsNeedsReviewAutoAccept(candidate: AutoAcceptRelationshipRow): boolean {
  return AUTO_ACCEPT_NEEDS_REVIEW_RULES.get(candidate.sourceId)?.has(
    candidate.relationshipType,
  ) ===
    true;
}

function acceptRelationshipCandidateDirect(
  store: Pick<WorkbenchStore, "db">,
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
  if (isLegalAuthorityRelationship(candidate.relationshipType, candidate.toEntityRef)) {
    run(
      store.db,
      "delete from relationship_legal_refs where relationship_id in (?, ?)",
      [candidate.relationshipCandidateId, relationshipId],
    );
  } else {
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
