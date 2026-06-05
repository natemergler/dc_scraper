import { nowIso } from "../domain.ts";
import { queryAll, queryOne, run, withTransaction } from "./db.ts";
import { type EndpointStatus, endpointStatusMap } from "./endpoint_status.ts";
import {
  buildRelationshipReviewDraft,
  type RelationshipReviewDraft,
} from "./relationship_review.ts";
import { proposedActionsForReviewItem } from "./review_conflicts.ts";
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
  deleteUnresolvedReviewItem: ReturnType<WorkbenchStore["db"]["prepare"]>;
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
  const sameFactReviewKeys = sameFactKeysWithHumanReview(candidates);
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
      upsertRelationshipReviewItem(statements, candidate, sameFactReviewKeys);
    }
  });
}

function sameFactKeysWithHumanReview(candidates: RelationshipCandidateRow[]): Set<string> {
  const keys = new Set<string>();
  for (const candidate of candidates) {
    const review = buildRelationshipReviewDraft(candidate);
    if (review.defaultAction === "defer") keys.add(relationshipFactKey(candidate));
  }
  return keys;
}

function relationshipFactKey(candidate: RelationshipCandidateRow): string {
  return [
    candidate.fromEntityRef,
    candidate.relationshipType,
    candidate.toEntityRef,
  ].join("\u0000");
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
    deleteUnresolvedReviewItem: store.db.prepare(
      "delete from review_items where item_type = 'relationship_candidate' and conflict_kind = 'unresolved_symbol' and subject_id = ?",
    ),
    deleteItem: store.db.prepare(
      "delete from reconciliation_items where subject_type = 'relationship_candidate' and subject_id = ?",
    ),
    upsertReviewItem: store.db.prepare(
      `insert into review_items(review_item_id, item_type, conflict_kind, subject_kind, subject_id, reason, default_action, status, proposed_actions_json, details_json, created_at, updated_at)
       values(?, 'relationship_candidate', ?, 'relationship', ?, ?, ?, coalesce((select status from review_items where review_item_id = ?), 'open'), ?, ?,
         coalesce((select created_at from review_items where review_item_id = ?), ?), ?)
       on conflict(review_item_id) do update set
         conflict_kind = excluded.conflict_kind,
         subject_kind = excluded.subject_kind,
         reason = excluded.reason,
         default_action = excluded.default_action,
         status = case
           when review_items.status in ('resolved', 'deferred') then review_items.status
           else 'open'
         end,
         proposed_actions_json = excluded.proposed_actions_json,
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
  const reviewItemId = buildBlockedRelationshipReviewItemId(candidate);
  const details = {
    unresolvedSymbol: true,
    relationshipType: candidate.relationshipType,
    rawValue: candidate.rawValue ?? null,
    rawLabel: candidate.rawValue ?? firstBlockedEndpointLabel(fromStatus, toStatus),
    dependentRelationship: {
      relationshipCandidateId: candidate.relationshipCandidateId,
      fromEntityRef: candidate.fromEntityRef,
      relationshipType: candidate.relationshipType,
      toEntityRef: candidate.toEntityRef,
    },
    needsReview: candidate.needsReview === 1,
    fromEndpoint: fromStatus,
    toEndpoint: toStatus,
  };
  statements.upsertItem.run(candidate.relationshipCandidateId, JSON.stringify(details), now, now);
  statements.deleteReviewItem.run(candidate.relationshipCandidateId);
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
  statements.upsertReviewItem.run(
    reviewItemId,
    "unresolved_symbol",
    candidate.relationshipCandidateId,
    "Resolve unresolved relationship endpoint symbol",
    "defer",
    reviewItemId,
    JSON.stringify(
      proposedActionsForReviewItem("unresolved_symbol", "relationship", "defer", details),
    ),
    JSON.stringify(details),
    reviewItemId,
    now,
    now,
  );
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
  sameFactReviewKeys: Set<string>,
): void {
  if (shouldHideCorroboratingSameFactReview(candidate, sameFactReviewKeys)) {
    statements.deleteReviewItem.run(candidate.relationshipCandidateId);
    return;
  }
  const review = applySameFactReviewContext(
    buildRelationshipReviewDraft(candidate),
    candidate,
    sameFactReviewKeys,
  );
  const now = nowIso();
  statements.deleteUnresolvedReviewItem.run(candidate.relationshipCandidateId);
  statements.upsertReviewItem.run(
    review.reviewItemId,
    "fact_conflict",
    candidate.relationshipCandidateId,
    review.reason,
    review.defaultAction,
    review.reviewItemId,
    JSON.stringify(
      proposedActionsForReviewItem(
        "fact_conflict",
        "relationship",
        review.defaultAction,
        review.details,
      ),
    ),
    JSON.stringify(review.details),
    review.reviewItemId,
    now,
    now,
  );
}

function buildBlockedRelationshipReviewItemId(candidate: RelationshipCandidateRow): string {
  return `${candidate.relationshipCandidateId}.unresolved-symbol`;
}

function firstBlockedEndpointLabel(fromStatus: EndpointStatus, toStatus: EndpointStatus): string {
  for (const endpoint of [fromStatus, toStatus]) {
    if (endpoint.state !== "accepted") return endpoint.name ?? endpoint.entityId;
  }
  return toStatus.name ?? toStatus.entityId;
}

function shouldHideCorroboratingSameFactReview(
  candidate: RelationshipCandidateRow,
  sameFactReviewKeys: Set<string>,
): boolean {
  const review = buildRelationshipReviewDraft(candidate);
  if (review.defaultAction === "defer") return false;
  if (candidate.needsReview === 1) return false;
  return sameFactReviewKeys.has(relationshipFactKey(candidate));
}

function applySameFactReviewContext(
  review: RelationshipReviewDraft,
  candidate: RelationshipCandidateRow,
  sameFactReviewKeys: Set<string>,
): RelationshipReviewDraft {
  if (review.defaultAction === "defer") return review;
  if (!sameFactReviewKeys.has(relationshipFactKey(candidate))) return review;
  return {
    ...review,
    defaultAction: "defer",
    details: {
      ...review.details,
      whyDeferred:
        "Another source has the same directed relationship fact marked for human review, so this fact should be resolved as source tension before accepting it.",
    },
  };
}
