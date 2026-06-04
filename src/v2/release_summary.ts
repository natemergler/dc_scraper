import { type ReleaseReadinessInput } from "./release_readiness.ts";
import { buildWorkbenchStatus, type WorkbenchStatusSnapshot } from "./status.ts";
import type { Workbench } from "./workbench.ts";

export interface ReviewStatusCount {
  review_status: string;
  count: number;
}

export interface RefTypeCount {
  ref_type: string;
  count: number;
}

export interface ReleaseSummary {
  entities_by_review_status: ReviewStatusCount[];
  relationships_by_review_status: ReviewStatusCount[];
  review_debt_by_type: Array<{
    item_type: string;
    open_count: number;
    deferred_count: number;
  }>;
  review_debt_by_source: Array<{
    source_id: string;
    open_count: number;
    deferred_count: number;
  }>;
  open_review_item_count: number;
  open_human_decision_review_item_count: number;
  browse_only_open_review_item_count: number;
  deferred_review_item_count: number;
  stale_review_item_count: number;
  stale_review_by_prior_decision_state: Array<{ prior_decision_state: string; count: number }>;
  blocked_reconciliation_count: number;
  blocked_reconciliation_by_source: Array<{ source_id: string; count: number }>;
  placeholder_entity_count: number;
  source_count: number;
  failed_source_count: number;
  dataset_count: number;
  legal_refs_by_type: RefTypeCount[];
  legal_refs_by_review_status: ReviewStatusCount[];
  entity_legal_refs_count: number;
  relationship_legal_refs_count: number;
}

export type ReleaseSummaryProjection = Partial<ReleaseSummary>;

export interface ReleaseSummaryRows {
  entities: ReadonlyArray<{ review_status: string }>;
  relationships: ReadonlyArray<{ review_status: string }>;
  sources: ReadonlyArray<unknown>;
  datasets: ReadonlyArray<unknown>;
  legalRefs: ReadonlyArray<{ ref_type: string; review_status: string }>;
  entityLegalRefs: ReadonlyArray<unknown>;
  relationshipLegalRefs: ReadonlyArray<unknown>;
}

export function buildReleaseSummary(
  workbench: Workbench,
  rows: ReleaseSummaryRows,
): ReleaseSummary {
  return buildReleaseSummaryFromStatus(buildWorkbenchStatus(workbench), rows);
}

export function buildReleaseSummaryFromStatus(
  status: WorkbenchStatusSnapshot,
  rows: ReleaseSummaryRows,
): ReleaseSummary {
  return {
    entities_by_review_status: countByReviewStatus(rows.entities, (row) => row.review_status),
    relationships_by_review_status: countByReviewStatus(
      rows.relationships,
      (row) => row.review_status,
    ),
    review_debt_by_type: status.review.byType.map((row) => ({
      item_type: row.itemType,
      open_count: row.openCount,
      deferred_count: row.deferredCount,
    })),
    review_debt_by_source: status.review.bySource.map((row) => ({
      source_id: row.sourceId,
      open_count: row.openCount,
      deferred_count: row.deferredCount,
    })),
    open_review_item_count: status.review.open,
    open_human_decision_review_item_count: status.review.humanDecisionOpen,
    browse_only_open_review_item_count: status.review.browseOnlyOpen,
    deferred_review_item_count: status.review.deferred,
    stale_review_item_count: status.staleReview.count,
    stale_review_by_prior_decision_state: status.staleReview.byPriorDecisionState.map((row) => ({
      prior_decision_state: row.priorDecisionState,
      count: row.count,
    })),
    blocked_reconciliation_count: status.reconciliation.blocked,
    blocked_reconciliation_by_source: status.reconciliation.blockedBySource.map((row) => ({
      source_id: row.sourceId,
      count: row.count,
    })),
    placeholder_entity_count: status.placeholders.count,
    source_count: rows.sources.length,
    failed_source_count: status.sources.failed,
    dataset_count: rows.datasets.length,
    legal_refs_by_type: countByRefType(rows.legalRefs, (row) => row.ref_type),
    legal_refs_by_review_status: countByReviewStatus(
      rows.legalRefs,
      (row) => row.review_status,
    ),
    entity_legal_refs_count: rows.entityLegalRefs.length,
    relationship_legal_refs_count: rows.relationshipLegalRefs.length,
  };
}

export function releaseReadinessInputFromSummary(
  summary: ReleaseSummaryProjection = {},
  options: { blockingProblemCount?: number } = {},
): ReleaseReadinessInput {
  return {
    sourceCount: summary.source_count ?? 0,
    failedSourceCount: summary.failed_source_count ?? 0,
    openReviewItemCount: summary.open_human_decision_review_item_count ??
      summary.open_review_item_count ??
      0,
    deferredReviewItemCount: summary.deferred_review_item_count ?? 0,
    staleReviewItemCount: summary.stale_review_item_count ?? 0,
    blockedReconciliationCount: summary.blocked_reconciliation_count ?? 0,
    placeholderEntityCount: summary.placeholder_entity_count ?? 0,
    blockingProblemCount: options.blockingProblemCount ?? 0,
  };
}

export function releaseReadinessInputFromWorkbenchStatus(
  status: WorkbenchStatusSnapshot,
  options: { blockingProblemCount?: number } = {},
): ReleaseReadinessInput {
  return {
    sourceCount: status.sources.fetched,
    failedSourceCount: status.sources.failed,
    openReviewItemCount: status.review.humanDecisionOpen,
    deferredReviewItemCount: status.review.deferred,
    staleReviewItemCount: status.staleReview.count,
    blockedReconciliationCount: status.reconciliation.blocked,
    placeholderEntityCount: status.placeholders.count,
    blockingProblemCount: options.blockingProblemCount ?? 0,
  };
}

function countByReviewStatus<T>(
  rows: ReadonlyArray<T>,
  value: (row: T) => string,
): ReviewStatusCount[] {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const key = value(row);
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map((
    [review_status, count],
  ) => ({
    review_status,
    count,
  }));
}

function countByRefType<T>(
  rows: ReadonlyArray<T>,
  value: (row: T) => string,
): RefTypeCount[] {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const key = value(row);
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ref_type, count]) => ({
    ref_type,
    count,
  }));
}
