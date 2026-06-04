import { nowIso } from "../domain.ts";
import { queryAll, queryOne, run, withTransaction } from "./db.ts";
import { type EndpointStatus, endpointStatusMap } from "./endpoint_status.ts";
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
}

interface ReconciliationStatements {
  upsertItem: ReturnType<WorkbenchStore["db"]["prepare"]>;
  deleteBlockers: ReturnType<WorkbenchStore["db"]["prepare"]>;
  insertBlocker: ReturnType<WorkbenchStore["db"]["prepare"]>;
  deleteReviewItem: ReturnType<WorkbenchStore["db"]["prepare"]>;
  deleteItem: ReturnType<WorkbenchStore["db"]["prepare"]>;
  upsertReviewItem: ReturnType<WorkbenchStore["db"]["prepare"]>;
}

export function reconcileRelationshipCandidates(store: WorkbenchStore): void {
  clearNonPendingRelationshipReconciliationState(store);
  const candidates = queryAll<RelationshipCandidateRow>(
    store.db,
    `select relationship_candidates.relationship_candidate_id as relationshipCandidateId,
            source_items.source_id as sourceId,
            from_entity_ref as fromEntityRef,
            to_entity_ref as toEntityRef,
            relationship_type as relationshipType,
            raw_value as rawValue,
            needs_review as needsReview
     from relationship_candidates
     join source_items on source_items.source_item_id = relationship_candidates.source_item_id
     where relationship_candidates.review_status = 'pending'`,
  );
  const endpointStatuses = endpointStatusMap(
    store,
    candidates.flatMap((candidate) => [candidate.fromEntityRef, candidate.toEntityRef]),
  );
  const statements = prepareReconciliationStatements(store);

  withTransaction(store.db, () => {
    for (const candidate of candidates) {
      const fromStatus = endpointStatuses.get(candidate.fromEntityRef) ?? {
        entityId: candidate.fromEntityRef,
        state: "missing",
      };
      const toStatus = endpointStatuses.get(candidate.toEntityRef) ?? {
        entityId: candidate.toEntityRef,
        state: "missing",
      };
      const blockedEndpoints = [fromStatus, toStatus].filter((endpoint) =>
        endpoint.state !== "accepted"
      );
      if (blockedEndpoints.length > 0) {
        upsertBlockedRelationship(statements, candidate, fromStatus, toStatus);
        continue;
      }
      clearRelationshipReconciliationState(statements, candidate.relationshipCandidateId);
      upsertRelationshipReviewItem(statements, candidate);
    }
  });
}

function clearNonPendingRelationshipReconciliationState(store: WorkbenchStore): void {
  const staleRow = queryOne<{ count: number }>(
    store.db,
    `select count(*) as count
     from reconciliation_items
     where subject_type = 'relationship_candidate'
       and exists (
         select 1
         from relationship_candidates
         where relationship_candidates.relationship_candidate_id = reconciliation_items.subject_id
           and relationship_candidates.review_status != 'pending'
       )`,
  );
  if ((staleRow?.count ?? 0) === 0) return;
  run(
    store.db,
    `delete from reconciliation_blockers
     where subject_type = 'relationship_candidate'
       and exists (
         select 1
         from relationship_candidates
         where relationship_candidates.relationship_candidate_id = reconciliation_blockers.subject_id
           and relationship_candidates.review_status != 'pending'
       )`,
  );
  run(
    store.db,
    `delete from reconciliation_items
     where subject_type = 'relationship_candidate'
       and exists (
         select 1
         from relationship_candidates
         where relationship_candidates.relationship_candidate_id = reconciliation_items.subject_id
           and relationship_candidates.review_status != 'pending'
       )`,
  );
}

function prepareReconciliationStatements(store: WorkbenchStore): ReconciliationStatements {
  return {
    upsertItem: store.db.prepare(
      `insert into reconciliation_items(subject_type, subject_id, state, reason, details_json, created_at, updated_at)
       values('relationship_candidate', ?, 'blocked', 'unresolved_endpoints', ?, ?, ?)
       on conflict(subject_type, subject_id) do update set
         state = excluded.state,
         reason = excluded.reason,
         details_json = excluded.details_json,
         updated_at = excluded.updated_at`,
    ),
    deleteBlockers: store.db.prepare(
      "delete from reconciliation_blockers where subject_type = 'relationship_candidate' and subject_id = ?",
    ),
    insertBlocker: store.db.prepare(
      `insert into reconciliation_blockers(
         subject_type, subject_id, blocker_key, blocker_type, blocker_id, blocker_state, details_json, created_at, updated_at
       ) values('relationship_candidate', ?, ?, 'endpoint', ?, ?, ?, ?, ?)`,
    ),
    deleteReviewItem: store.db.prepare(
      "delete from review_items where item_type = 'relationship_candidate' and subject_id = ?",
    ),
    deleteItem: store.db.prepare(
      "delete from reconciliation_items where subject_type = 'relationship_candidate' and subject_id = ?",
    ),
    upsertReviewItem: store.db.prepare(
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
    ),
  };
}

function upsertBlockedRelationship(
  statements: ReconciliationStatements,
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
  statements.upsertItem.run(candidate.relationshipCandidateId, JSON.stringify(details), now, now);
  statements.deleteBlockers.run(candidate.relationshipCandidateId);
  for (const endpoint of [fromStatus, toStatus]) {
    if (endpoint.state === "accepted") continue;
    statements.insertBlocker.run(
      candidate.relationshipCandidateId,
      endpoint.entityId,
      endpoint.entityId,
      endpoint.state,
      JSON.stringify({ endpoint }),
      now,
      now,
    );
  }
  statements.deleteReviewItem.run(candidate.relationshipCandidateId);
}

function clearRelationshipReconciliationState(
  statements: ReconciliationStatements,
  relationshipCandidateId: string,
): void {
  statements.deleteBlockers.run(relationshipCandidateId);
  statements.deleteItem.run(relationshipCandidateId);
}

function upsertRelationshipReviewItem(
  statements: ReconciliationStatements,
  candidate: RelationshipCandidateRow,
): void {
  const review = buildRelationshipReviewDraft(candidate);
  const now = nowIso();
  statements.upsertReviewItem.run(
    review.reviewItemId,
    candidate.relationshipCandidateId,
    review.reason,
    review.defaultAction,
    review.reviewItemId,
    JSON.stringify(review.details),
    review.reviewItemId,
    now,
    now,
  );
}
