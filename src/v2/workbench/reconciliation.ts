import { nowIso } from "../domain.ts";
import { queryAll, queryOne, run } from "./db.ts";
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

interface CanonicalEndpointRow {
  name: string;
  isPlaceholder: number;
}

interface CandidateEndpointStatusRow {
  sourceId: string;
  itemKey: string;
  runStartedAt: string;
  reviewStatus: string;
  reviewItemStatus?: string | null;
  stalePriorDecision?: number | null;
  replayConflict?: number | null;
}

export interface ReconciliationSummary {
  blockedCount: number;
  blockedBySource: Array<{
    sourceId: string;
    count: number;
  }>;
  blockedByBlockerState: Array<{
    blockerState: string;
    count: number;
  }>;
  blockedByRelationshipType: Array<{
    relationshipType: string;
    count: number;
  }>;
  blockedByReason: Array<{
    reason: string;
    count: number;
  }>;
  firstBlocked?: {
    subjectId: string;
    sourceId: string;
    reason: string;
    relationshipType: string;
    rawValue?: string | null;
    blockers: Array<{
      blockerId: string;
      blockerState: string;
      blockerLabel: string;
    }>;
  };
}

type EndpointState =
  | "accepted"
  | "missing"
  | "pending_candidate"
  | "deferred_candidate"
  | "placeholder"
  | "replay_conflict"
  | "stale_candidate"
  | "rejected_candidate";

interface EndpointStatus {
  entityId: string;
  state: EndpointState;
  name?: string;
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

export function reconciliationSummary(store: WorkbenchStore): ReconciliationSummary {
  const blockedCount = queryOne<{ count: number }>(
    store.db,
    "select count(*) as count from reconciliation_items where state = 'blocked'",
  )?.count ?? 0;
  const blockedBySource = queryAll<{ sourceId: string; count: number }>(
    store.db,
    `select source_items.source_id as sourceId,
            count(*) as count
     from reconciliation_items
     join relationship_candidates
       on relationship_candidates.relationship_candidate_id = reconciliation_items.subject_id
     join source_items
       on source_items.source_item_id = relationship_candidates.source_item_id
     where reconciliation_items.state = 'blocked'
     group by source_items.source_id
     order by count(*) desc, source_items.source_id`,
  );
  const blockedByBlockerState = queryAll<{ blockerState: string; count: number }>(
    store.db,
    `select blocker_state as blockerState,
            count(*) as count
     from reconciliation_blockers
     where subject_type = 'relationship_candidate'
     group by blocker_state
     order by count(*) desc, blocker_state`,
  );
  const blockedByRelationshipType = queryAll<{ relationshipType: string; count: number }>(
    store.db,
    `select relationship_candidates.relationship_type as relationshipType,
            count(*) as count
     from reconciliation_items
     join relationship_candidates
       on relationship_candidates.relationship_candidate_id = reconciliation_items.subject_id
     where reconciliation_items.state = 'blocked'
     group by relationship_candidates.relationship_type
     order by count(*) desc, relationship_candidates.relationship_type`,
  );
  const blockedByReason = queryAll<{ reason: string; count: number }>(
    store.db,
    `select reason, count(*) as count
     from reconciliation_items
     where state = 'blocked'
     group by reason
     order by count(*) desc, reason`,
  );
  const firstBlockedRow = queryOne<{
    subjectId: string;
    sourceId: string;
    reason: string;
    relationshipType: string;
    rawValue?: string | null;
  }>(
    store.db,
    `select reconciliation_items.subject_id as subjectId,
            source_items.source_id as sourceId,
            reconciliation_items.reason,
            relationship_candidates.relationship_type as relationshipType,
            relationship_candidates.raw_value as rawValue
     from reconciliation_items
     join relationship_candidates
       on relationship_candidates.relationship_candidate_id = reconciliation_items.subject_id
     join source_items
       on source_items.source_item_id = relationship_candidates.source_item_id
     where state = 'blocked'
     order by updated_at, subject_id
     limit 1`,
  );
  const firstBlocked = firstBlockedRow
    ? {
      ...firstBlockedRow,
      blockers: queryAll<{ blockerId: string; blockerState: string; blockerLabel: string }>(
        store.db,
        `select reconciliation_blockers.blocker_id as blockerId,
                reconciliation_blockers.blocker_state as blockerState,
                coalesce(
                  canonical_entities.name,
                  (
                    select entity_candidates.name
                    from entity_candidates
                    where entity_candidates.proposed_entity_id = reconciliation_blockers.blocker_id
                    order by
                      case entity_candidates.review_status
                        when 'accepted' then 0
                        when 'pending' then 1
                        else 2
                      end,
                      coalesce(entity_candidates.confidence, 0) desc,
                      entity_candidates.candidate_id
                    limit 1
                  ),
                  reconciliation_blockers.blocker_id
                ) as blockerLabel
         from reconciliation_blockers
         left join canonical_entities
           on canonical_entities.entity_id = reconciliation_blockers.blocker_id
         where subject_type = 'relationship_candidate' and subject_id = ?
         order by blocker_key`,
        [firstBlockedRow.subjectId],
      ),
    }
    : undefined;
  return {
    blockedCount,
    blockedBySource,
    blockedByBlockerState,
    blockedByRelationshipType,
    blockedByReason,
    firstBlocked,
  };
}

function endpointStatus(store: WorkbenchStore, entityId: string): EndpointStatus {
  const statuses = queryAll<CandidateEndpointStatusRow>(
    store.db,
    `select source_items.source_id as sourceId,
            source_items.item_key as itemKey,
            source_runs.started_at as runStartedAt,
            entity_candidates.review_status as reviewStatus,
            review_items.status as reviewItemStatus,
            json_extract(review_items.details_json, '$.stalePriorDecision') as stalePriorDecision,
            json_extract(review_items.details_json, '$.replayConflict') as replayConflict
     from entity_candidates
     join source_items on source_items.source_item_id = entity_candidates.source_item_id
     join source_runs on source_runs.run_id = source_items.run_id
     left join review_items
       on review_items.subject_id = entity_candidates.candidate_id
      and review_items.item_type = 'entity_candidate'
     where entity_candidates.proposed_entity_id = ?
     order by source_runs.started_at desc,
              entity_candidates.candidate_id desc`,
    [entityId],
  );
  const currentStatuses = latestSourceItemStatuses(statuses);
  if (
    currentStatuses.some((row) => row.reviewStatus === "pending" && row.stalePriorDecision === 1)
  ) {
    return { entityId, state: "stale_candidate" };
  }
  if (
    currentStatuses.some((row) => row.reviewStatus === "pending" && row.replayConflict === 1)
  ) {
    return { entityId, state: "replay_conflict" };
  }
  if (
    currentStatuses.some((row) =>
      row.reviewStatus === "pending" && row.reviewItemStatus === "deferred"
    )
  ) {
    return { entityId, state: "deferred_candidate" };
  }
  const canonical = queryOne<CanonicalEndpointRow>(
    store.db,
    "select name, is_placeholder as isPlaceholder from canonical_entities where entity_id = ?",
    [entityId],
  );
  if (canonical) {
    return {
      entityId,
      state: canonical.isPlaceholder === 1 ? "placeholder" : "accepted",
      name: canonical.name,
    };
  }
  if (currentStatuses.some((row) => row.reviewStatus === "pending")) {
    return { entityId, state: "pending_candidate" };
  }
  if (
    currentStatuses.length > 0 &&
    currentStatuses.every((row) => row.reviewStatus === "rejected")
  ) {
    return { entityId, state: "rejected_candidate" };
  }
  return { entityId, state: "missing" };
}

function latestSourceItemStatuses(
  statuses: CandidateEndpointStatusRow[],
): CandidateEndpointStatusRow[] {
  const latestBySourceItem = new Map<string, string>();
  for (const status of statuses) {
    const sourceItemKey = `${status.sourceId}\u0000${status.itemKey}`;
    const priorStartedAt = latestBySourceItem.get(sourceItemKey);
    if (!priorStartedAt || status.runStartedAt > priorStartedAt) {
      latestBySourceItem.set(sourceItemKey, status.runStartedAt);
    }
  }
  return statuses.filter((status) => {
    const sourceItemKey = `${status.sourceId}\u0000${status.itemKey}`;
    return latestBySourceItem.get(sourceItemKey) === status.runStartedAt;
  });
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
