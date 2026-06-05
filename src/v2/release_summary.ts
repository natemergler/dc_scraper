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
  accepted_multi_governor_entity_count: number;
  accepted_public_body_missing_official_url_count: number;
  open_review_item_count: number;
  open_human_decision_review_item_count: number;
  open_human_decision_review_item_count_by_type: Array<{ item_type: string; count: number }>;
  browse_only_open_review_item_count: number;
  deferred_review_item_count: number;
  stale_review_item_count: number;
  stale_review_by_prior_decision_state: Array<{ prior_decision_state: string; count: number }>;
  blocked_reconciliation_count: number;
  blocked_reconciliation_by_source: Array<{ source_id: string; count: number }>;
  public_body_variant_lead_count: number;
  public_body_release_risk_variant_lead_count: number;
  public_body_governance_suffix_lead_count: number;
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
  entities: ReadonlyArray<{
    review_status: string;
    kind?: string;
    entity_group?: string;
    entity_type?: string;
    official_url?: string | null;
  }>;
  relationships: ReadonlyArray<{
    review_status: string;
    relationship_type: string;
    from_entity_id: string;
    to_entity_id: string;
  }>;
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
    accepted_multi_governor_entity_count: countAcceptedMultiGovernorEntities(rows.relationships),
    accepted_public_body_missing_official_url_count: countAcceptedPublicEntitiesMissingOfficialUrls(
      rows.entities,
    ),
    open_review_item_count: status.review.open,
    open_human_decision_review_item_count: status.review.humanDecisionOpen,
    open_human_decision_review_item_count_by_type: status.review.humanDecisionOpenByItemType.map((
      row,
    ) => ({
      item_type: row.itemType,
      count: row.count,
    })),
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
    public_body_variant_lead_count: status.publicBodies.conservativeVariantLeads,
    public_body_release_risk_variant_lead_count: status.publicBodies.releaseRiskVariantLeads,
    public_body_governance_suffix_lead_count: status.publicBodies.governanceSuffixLeads,
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
    publicBodyReleaseRiskVariantLeadCount: summary.public_body_release_risk_variant_lead_count ?? 0,
    acceptedMultiGovernorEntityCount: summary.accepted_multi_governor_entity_count ?? 0,
    acceptedPublicBodyMissingOfficialUrlCount:
      summary.accepted_public_body_missing_official_url_count ?? 0,
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
    publicBodyReleaseRiskVariantLeadCount: status.publicBodies.releaseRiskVariantLeads,
    acceptedMultiGovernorEntityCount: 0,
    acceptedPublicBodyMissingOfficialUrlCount: 0,
    placeholderEntityCount: status.placeholders.count,
    blockingProblemCount: options.blockingProblemCount ?? 0,
  };
}

function countAcceptedMultiGovernorEntities(
  rows: ReadonlyArray<ReleaseSummaryRows["relationships"][number]>,
): number {
  const byEntity = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.review_status !== "accepted" || row.relationship_type !== "governed_by") continue;
    const targets = byEntity.get(row.from_entity_id) ?? new Set<string>();
    targets.add(row.to_entity_id);
    byEntity.set(row.from_entity_id, targets);
  }
  let count = 0;
  for (const targets of byEntity.values()) {
    if (targets.size > 1) count += 1;
  }
  return count;
}

function countAcceptedPublicEntitiesMissingOfficialUrls(
  rows: ReadonlyArray<ReleaseSummaryRows["entities"][number]>,
): number {
  let count = 0;
  for (const row of rows) {
    if (row.review_status !== "accepted") continue;
    if (!isPublicBodyLikeReleaseEntity(row)) {
      continue;
    }
    if ((row.official_url ?? "").trim()) continue;
    count += 1;
  }
  return count;
}

function isPublicBodyLikeReleaseEntity(
  row: ReleaseSummaryRows["entities"][number],
): boolean {
  const entityGroup = row.entity_group ?? "";
  if (entityGroup === "board_commission_public_body" || entityGroup === "council_committee") {
    return true;
  }
  const entityType = (row.entity_type ?? row.kind ?? "").toLowerCase();
  return [
    "board",
    "commission",
    "public_body",
    "advisory_body",
    "working_group",
    "committee",
    "council_committee",
  ].includes(entityType);
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
