import { nowIso } from "../domain.ts";
import { queryAll, run } from "./db.ts";
import { type EndpointStatus, endpointStatus } from "./endpoint_status.ts";
import { buildRelationshipReviewDraft } from "./relationship_review.ts";
import type { WorkbenchStore } from "./store.ts";

interface RelationshipCandidateRow {
  relationshipCandidateId: string;
  sourceId: string;
  fromEntityRef: string;
  toEntityRef: string;
  relationshipType: string;
  rawValue?: string | null;
  needsReview: number;
  reviewStatus: string;
}

export function reconcileRelationshipCandidates(store: WorkbenchStore): void {
  const candidates = queryAll<RelationshipCandidateRow>(
    store.db,
    `select relationship_candidates.relationship_candidate_id as relationshipCandidateId,
            source_items.source_id as sourceId,
            from_entity_ref as fromEntityRef,
            to_entity_ref as toEntityRef,
            relationship_type as relationshipType,
            raw_value as rawValue,
            needs_review as needsReview,
            review_status as reviewStatus
     from relationship_candidates
     join source_items on source_items.source_item_id = relationship_candidates.source_item_id`,
  );

  for (const candidate of candidates) {
    if (candidate.reviewStatus !== "pending") {
      clearRelationshipReconciliationState(store, candidate.relationshipCandidateId);
      continue;
    }
    const fromStatus = endpointStatus(store, candidate.fromEntityRef);
    const toStatus = endpointStatus(store, candidate.toEntityRef);
    const blockedEndpoints = [fromStatus, toStatus].filter((endpoint) =>
      endpoint.state !== "accepted"
    );
    if (blockedEndpoints.length > 0) {
      upsertBlockedRelationship(store, candidate, fromStatus, toStatus);
      continue;
    }
    clearRelationshipReconciliationState(store, candidate.relationshipCandidateId);
    upsertRelationshipReviewItem(store, candidate);
  }
}

function upsertBlockedRelationship(
  store: WorkbenchStore,
  candidate: RelationshipCandidateRow,
  fromStatus: EndpointStatus,
  toStatus: EndpointStatus,
): void {
  const now = nowIso();
  const details = {
    relationshipType: candidate.relationshipType,
    rawValue: candidate.rawValue ?? null,
    needsReview: candidate.needsReview === 1,
    fromEndpoint: fromStatus,
    toEndpoint: toStatus,
  };
  run(
    store.db,
    `insert into reconciliation_items(subject_type, subject_id, state, reason, details_json, created_at, updated_at)
     values('relationship_candidate', ?, 'blocked', 'unresolved_endpoints', ?, ?, ?)
     on conflict(subject_type, subject_id) do update set
       state = excluded.state,
       reason = excluded.reason,
       details_json = excluded.details_json,
       updated_at = excluded.updated_at`,
    [candidate.relationshipCandidateId, JSON.stringify(details), now, now],
  );
  run(
    store.db,
    "delete from reconciliation_blockers where subject_type = 'relationship_candidate' and subject_id = ?",
    [candidate.relationshipCandidateId],
  );
  for (const endpoint of [fromStatus, toStatus]) {
    if (endpoint.state === "accepted") continue;
    run(
      store.db,
      `insert into reconciliation_blockers(
         subject_type, subject_id, blocker_key, blocker_type, blocker_id, blocker_state, details_json, created_at, updated_at
       ) values('relationship_candidate', ?, ?, 'endpoint', ?, ?, ?, ?, ?)`,
      [
        candidate.relationshipCandidateId,
        endpoint.entityId,
        endpoint.entityId,
        endpoint.state,
        JSON.stringify({ endpoint }),
        now,
        now,
      ],
    );
  }
  run(
    store.db,
    "delete from review_items where item_type = 'relationship_candidate' and subject_id = ?",
    [candidate.relationshipCandidateId],
  );
}

function clearRelationshipReconciliationState(
  store: WorkbenchStore,
  relationshipCandidateId: string,
): void {
  run(
    store.db,
    "delete from reconciliation_blockers where subject_type = 'relationship_candidate' and subject_id = ?",
    [relationshipCandidateId],
  );
  run(
    store.db,
    "delete from reconciliation_items where subject_type = 'relationship_candidate' and subject_id = ?",
    [relationshipCandidateId],
  );
}

function upsertRelationshipReviewItem(
  store: WorkbenchStore,
  candidate: RelationshipCandidateRow,
): void {
  const review = buildRelationshipReviewDraft(candidate);
  const now = nowIso();
  run(
    store.db,
    `insert into review_items(review_item_id, item_type, subject_id, reason, default_action, status, details_json, created_at, updated_at)
     values(?, 'relationship_candidate', ?, ?, ?, coalesce((select status from review_items where review_item_id = ?), 'open'), ?,
       coalesce((select created_at from review_items where review_item_id = ?), ?), ?)
     on conflict(review_item_id) do update set
       reason = excluded.reason,
       default_action = excluded.default_action,
       status = case
         when review_items.status in ('resolved', 'deferred') then review_items.status
         else 'open'
       end,
       details_json = excluded.details_json,
       updated_at = excluded.updated_at`,
    [
      review.reviewItemId,
      candidate.relationshipCandidateId,
      review.reason,
      review.defaultAction,
      review.reviewItemId,
      JSON.stringify(review.details),
      review.reviewItemId,
      now,
      now,
    ],
  );
}
