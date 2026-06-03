import { connectors } from "./connectors.ts";
import { Workbench } from "./workbench.ts";
import { canBatchAcceptReviewItem } from "./workbench/review.ts";

export interface ReleaseManifest {
  generated_at?: string;
  files?: Array<{ name: string }>;
  release_summary?: {
    entities_by_review_status?: Array<{ review_status: string; count: number }>;
    relationships_by_review_status?: Array<{ review_status: string; count: number }>;
    legal_refs_by_type?: Array<{ ref_type: string; count: number }>;
    legal_refs_by_review_status?: Array<{ review_status: string; count: number }>;
    open_review_item_count?: number;
    deferred_review_item_count?: number;
    stale_review_item_count?: number;
    stale_review_by_prior_decision_state?: Array<{ prior_decision_state: string; count: number }>;
    review_debt_by_type?: Array<{
      item_type: string;
      open_count: number;
      deferred_count: number;
    }>;
    review_debt_by_source?: Array<{
      source_id: string;
      open_count: number;
      deferred_count: number;
    }>;
    blocked_reconciliation_count?: number;
    blocked_reconciliation_by_source?: Array<{ source_id: string; count: number }>;
    placeholder_entity_count?: number;
    review_status_note?: string;
    source_count?: number;
    failed_source_count?: number;
    dataset_count?: number;
  };
}

export interface WorkbenchStatusSnapshot {
  sources: {
    fetched: number;
    failed: number;
    total: number;
    firstFailedSourceId?: string;
  };
  review: {
    open: number;
    deferred: number;
    byType: Array<{ itemType: string; openCount: number; deferredCount: number }>;
    bySource: Array<{ sourceId: string; openCount: number; deferredCount: number }>;
  };
  staleReview: {
    count: number;
    byPriorDecisionState: Array<{ priorDecisionState: string; count: number }>;
    firstStale?: {
      reviewItemId: string;
      itemType: string;
      subjectId: string;
      reason: string;
      priorDecisionState?: string;
    };
  };
  placeholders: {
    count: number;
    byReason: Array<{ reason: string; count: number }>;
    firstPlaceholder?: {
      entityId: string;
      name: string;
      kind: string;
      placeholderReason?: string | null;
    };
  };
  reconciliation: {
    blocked: number;
    firstBlockedSubjectId?: string;
    firstBlockedReason?: string;
    blockedBySource: Array<{ sourceId: string; count: number }>;
    blockedByBlockerState: Array<{ blockerState: string; count: number }>;
    blockedByRelationshipType: Array<{ relationshipType: string; count: number }>;
    blockedByReason: Array<{ reason: string; count: number }>;
    firstBlocked?: {
      subjectId: string;
      sourceId: string;
      reason: string;
      relationshipType: string;
      rawValue?: string | null;
      blockers: Array<{ blockerId: string; blockerState: string; blockerLabel: string }>;
    };
  };
  canonical: {
    entities: number;
    relationships: number;
  };
  nextCommand: string;
}

export function buildWorkbenchStatus(workbench: Workbench): WorkbenchStatusSnapshot {
  const sourceRows = workbench.listSources();
  const fetchedSources = sourceRows.filter((row) => row.latestStatus).length;
  const failedSource = sourceRows.find((row) => row.latestStatus === "failed");
  const failedSources = sourceRows.filter((row) => row.latestStatus === "failed").length;
  const openReview = workbench.listReviewItems({ status: "open" }).length;
  const deferredReview = workbench.listReviewItems({ status: "deferred" }).length;
  const reviewDebt = workbench.reviewDebtSummary();
  const staleReview = workbench.staleReviewSummary();
  const placeholders = workbench.placeholderSummary();
  const reconciliation = workbench.reconciliationSummary();
  const entities = workbench.canonicalEntities().length;
  const relationships = workbench.canonicalRelationships().length;
  const next = nextCommand({
    workbench,
    fetchedSources,
    failedSourceId: failedSource?.sourceId,
    openReview,
    blockedReconciliation: reconciliation.blockedCount,
  });
  return {
    sources: {
      fetched: fetchedSources,
      failed: failedSources,
      total: connectors.length,
      firstFailedSourceId: failedSource?.sourceId,
    },
    review: {
      open: openReview,
      deferred: deferredReview,
      byType: reviewDebt.byType,
      bySource: reviewDebt.bySource,
    },
    staleReview,
    placeholders,
    reconciliation: {
      blocked: reconciliation.blockedCount,
      firstBlockedSubjectId: reconciliation.firstBlocked?.subjectId,
      firstBlockedReason: reconciliation.firstBlocked?.reason,
      blockedBySource: reconciliation.blockedBySource,
      blockedByBlockerState: reconciliation.blockedByBlockerState,
      blockedByRelationshipType: reconciliation.blockedByRelationshipType,
      blockedByReason: reconciliation.blockedByReason,
      firstBlocked: reconciliation.firstBlocked,
    },
    canonical: {
      entities,
      relationships,
    },
    nextCommand: next,
  };
}

export function renderWorkbenchStatus(status: WorkbenchStatusSnapshot): string {
  const reviewDebtByType = status.review.byType.length > 0
    ? status.review.byType
      .map((row) => `${row.itemType}(open=${row.openCount},deferred=${row.deferredCount})`)
      .join(", ")
    : undefined;
  const reviewDebtBySource = status.review.bySource.length > 0
    ? status.review.bySource
      .map((row) => `${row.sourceId}(open=${row.openCount},deferred=${row.deferredCount})`)
      .join(", ")
    : undefined;
  const reconciliationDetails = [
    status.reconciliation.blockedByRelationshipType.length > 0
      ? status.reconciliation.blockedByRelationshipType
        .map((row) => `${row.relationshipType}=${row.count}`)
        .join(", ")
      : undefined,
    status.reconciliation.blockedBySource.length > 0
      ? `sources ${
        status.reconciliation.blockedBySource
          .map((row) => `${row.sourceId}=${row.count}`)
          .join(", ")
      }`
      : undefined,
    status.reconciliation.blockedByBlockerState.length > 0
      ? `blockers ${
        status.reconciliation.blockedByBlockerState
          .map((row) => `${row.blockerState}=${row.count}`)
          .join(", ")
      }`
      : undefined,
  ].filter((value): value is string => Boolean(value)).join("; ");
  return [
    "",
    `Sources: ${status.sources.fetched}/${status.sources.total} fetched${
      status.sources.failed > 0 ? `, ${status.sources.failed} failed` : ""
    }`,
    `Review: ${status.review.open} open, ${status.review.deferred} deferred`,
    ...(reviewDebtByType ? [`Review debt by type: ${reviewDebtByType}`] : []),
    ...(reviewDebtBySource ? [`Review debt by source: ${reviewDebtBySource}`] : []),
    `Stale review: ${status.staleReview.count}${
      status.staleReview.firstStale?.priorDecisionState
        ? ` from prior ${status.staleReview.firstStale.priorDecisionState} decision`
        : ""
    }`,
    `Placeholders: ${status.placeholders.count}${
      status.placeholders.firstPlaceholder
        ? ` first ${status.placeholders.firstPlaceholder.name}${
          status.placeholders.firstPlaceholder.placeholderReason
            ? ` (${status.placeholders.firstPlaceholder.placeholderReason})`
            : ""
        }`
        : ""
    }`,
    `Reconciliation: ${status.reconciliation.blocked} blocked${
      reconciliationDetails ? ` (${reconciliationDetails})` : ""
    }`,
    ...(status.reconciliation.firstBlocked
      ? [
        `First blocked: ${status.reconciliation.firstBlocked.subjectId} [${status.reconciliation.firstBlocked.sourceId} ${status.reconciliation.firstBlocked.relationshipType}]`,
        ...(status.reconciliation.firstBlocked.rawValue
          ? [`Blocked raw value: ${status.reconciliation.firstBlocked.rawValue}`]
          : []),
      ]
      : []),
    `Canonical: ${status.canonical.entities} entities, ${status.canonical.relationships} relationships`,
    `Next: ${status.nextCommand}`,
  ].join("\n");
}

export function renderWorkbenchDoctor(status: WorkbenchStatusSnapshot): string {
  const lines = [renderWorkbenchStatus(status)];
  if (status.reconciliation.firstBlocked) {
    const blockers = status.reconciliation.firstBlocked.blockers
      .map((blocker) => `${blocker.blockerLabel} (${blocker.blockerState})`)
      .join(", ");
    lines.push(
      "",
      "Blocked detail:",
      `Source: ${status.reconciliation.firstBlocked.sourceId}`,
      `Subject: ${status.reconciliation.firstBlocked.subjectId}`,
      `Reason: ${status.reconciliation.firstBlocked.reason}`,
      `Relationship type: ${status.reconciliation.firstBlocked.relationshipType}`,
      ...(status.reconciliation.firstBlocked.rawValue
        ? [`Raw value: ${status.reconciliation.firstBlocked.rawValue}`]
        : []),
      `Blockers: ${blockers}`,
      `Inspect source: ${blockedInspectionCommand(status.reconciliation.firstBlocked.sourceId)}`,
    );
  }
  return lines.join("\n");
}

function nextCommand(options: {
  workbench: Workbench;
  fetchedSources: number;
  failedSourceId?: string;
  openReview: number;
  blockedReconciliation: number;
}): string {
  if (options.failedSourceId) return `dc source inspect ${options.failedSourceId}`;
  const suggestedReviewCommand = suggestScopedReviewCommand(options.workbench);
  if (suggestedReviewCommand) return suggestedReviewCommand;
  if (options.openReview > 0) return "dc review";
  if (options.blockedReconciliation > 0) return "dc audit";
  if (options.fetchedSources < connectors.length) return "dc source list";
  return "dc release build";
}

function blockedInspectionCommand(sourceId: string): string {
  return `dc source inspect ${sourceId}`;
}

interface SuggestedCommand {
  command: string;
  count: number;
}

function suggestScopedReviewCommand(workbench: Workbench): string | undefined {
  return suggestExplicitSafeEntityBatch(workbench)?.command ??
    suggestSafeRelationshipBatch(workbench)?.command ??
    suggestDeferDefaultRelationshipBatch(workbench)?.command ??
    suggestDeferDefaultLegalBatch(workbench)?.command ??
    suggestHighConfidenceEntityBatch(workbench)?.command;
}

function suggestExplicitSafeEntityBatch(workbench: Workbench): SuggestedCommand | undefined {
  const reviewDebt = workbench.reviewDebtSummary();
  let best: SuggestedCommand | undefined;
  for (const source of reviewDebt.bySource) {
    if (source.openCount === 0) continue;
    const filters = {
      mode: "entities",
      status: "open",
      subjectPrefix: `candidate.${source.sourceId}`,
    } as const;
    const items = workbench.listReviewItems(filters);
    const safeCount = items.filter((item) =>
      item.details.safeToAutoAccept === true &&
      canBatchAcceptReviewItem(workbench, item, filters)
    ).length;
    if (safeCount === 0) continue;
    const candidate = {
      command:
        `dc review batch accept-safe --mode entities --subject-prefix candidate.${source.sourceId}`,
      count: safeCount,
    };
    if (!best || candidate.count > best.count) best = candidate;
  }
  return best;
}

function suggestSafeRelationshipBatch(workbench: Workbench): SuggestedCommand | undefined {
  const items = workbench.listReviewItems({ mode: "relationships", status: "open" });
  const grouped = new Map<
    string,
    { sourceId: string; relationshipType: string; items: typeof items }
  >();
  for (const item of items) {
    const sourceId = sourceIdForReviewSubject(item.subjectId, "relationship");
    const relationshipType = detailString(item.details, "relationshipType");
    if (!sourceId || !relationshipType) continue;
    const key = `${sourceId}:${relationshipType}`;
    const group = grouped.get(key) ?? { sourceId, relationshipType, items: [] };
    group.items.push(item);
    if (!grouped.has(key)) grouped.set(key, group);
  }

  let best: SuggestedCommand | undefined;
  for (const group of grouped.values()) {
    const filters = {
      mode: "relationships",
      status: "open",
      subjectPrefix: `relationship.${group.sourceId}`,
      relationshipType: group.relationshipType,
    } as const;
    const safeCount = group.items.filter((item) =>
      canBatchAcceptReviewItem(workbench, item, filters)
    ).length;
    if (safeCount === 0) continue;
    const candidate = {
      command:
        `dc review batch accept-safe --mode relationships --subject-prefix relationship.${group.sourceId} --relationship-type ${group.relationshipType}`,
      count: safeCount,
    };
    if (!best || candidate.count > best.count) best = candidate;
  }
  return best;
}

function suggestDeferDefaultRelationshipBatch(workbench: Workbench): SuggestedCommand | undefined {
  const items = workbench.listReviewItems({ mode: "relationships", status: "open" });
  const grouped = new Map<
    string,
    { sourceId: string; relationshipType: string; items: typeof items }
  >();
  for (const item of items) {
    const sourceId = sourceIdForReviewSubject(item.subjectId, "relationship");
    const relationshipType = detailString(item.details, "relationshipType");
    if (!sourceId || !relationshipType) continue;
    const key = `${sourceId}:${relationshipType}`;
    const group = grouped.get(key) ?? { sourceId, relationshipType, items: [] };
    group.items.push(item);
    if (!grouped.has(key)) grouped.set(key, group);
  }

  let best: SuggestedCommand | undefined;
  for (const group of grouped.values()) {
    if (group.items.some((item) => item.defaultAction !== "defer")) continue;
    const candidate = {
      command:
        `dc review batch defer-default --mode relationships --subject-prefix relationship.${group.sourceId} --relationship-type ${group.relationshipType}`,
      count: group.items.length,
    };
    if (!best || candidate.count > best.count) best = candidate;
  }
  return best;
}

function suggestDeferDefaultLegalBatch(workbench: Workbench): SuggestedCommand | undefined {
  const items = workbench.listReviewItems({ mode: "legal", status: "open" });
  const grouped = new Map<string, { sourceId: string; refType: string; items: typeof items }>();
  for (const item of items) {
    const sourceId = sourceIdForReviewSubject(item.subjectId, "legal");
    const refType = detailString(item.details, "refType");
    if (!sourceId || !refType) continue;
    const key = `${sourceId}:${refType}`;
    const group = grouped.get(key) ?? { sourceId, refType, items: [] };
    group.items.push(item);
    if (!grouped.has(key)) grouped.set(key, group);
  }

  let best: SuggestedCommand | undefined;
  for (const group of grouped.values()) {
    if (group.items.some((item) => item.defaultAction !== "defer")) continue;
    const candidate = {
      command:
        `dc review batch defer-default --mode legal --subject-prefix legal.${group.sourceId} --ref-type ${group.refType}`,
      count: group.items.length,
    };
    if (!best || candidate.count > best.count) best = candidate;
  }
  return best;
}

function suggestHighConfidenceEntityBatch(workbench: Workbench): SuggestedCommand | undefined {
  const reviewDebt = workbench.reviewDebtSummary();
  let best: SuggestedCommand | undefined;
  for (const source of reviewDebt.bySource) {
    if (source.openCount === 0) continue;
    const filters = {
      mode: "entities",
      status: "open",
      subjectPrefix: `candidate.${source.sourceId}`,
    } as const;
    const items = workbench.listReviewItems(filters);
    const safeCount = items.filter((item) =>
      item.details.safeToAutoAccept !== true &&
      canBatchAcceptReviewItem(workbench, item, filters)
    ).length;
    if (safeCount === 0) continue;
    const candidate = {
      command:
        `dc review batch accept-safe --mode entities --subject-prefix candidate.${source.sourceId}`,
      count: safeCount,
    };
    if (!best || candidate.count > best.count) best = candidate;
  }
  return best;
}

function sourceIdForReviewSubject(
  subjectId: string,
  kind: "candidate" | "relationship" | "legal",
): string | undefined {
  const prefix = `${kind}.`;
  return connectors.find((connector) => subjectId.startsWith(`${prefix}${connector.sourceId}.`))
    ?.sourceId;
}

function detailString(details: Record<string, unknown>, key: string): string | undefined {
  const value = details[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function renderReleaseInspection(outDir: string, manifest: ReleaseManifest): string {
  const inspection = buildReleaseInspection(outDir, manifest);
  const summary = inspection.releaseSummary;
  return [
    `Release: ${inspection.outDir}`,
    `Generated: ${inspection.generatedAt}`,
    `Files: ${inspection.fileCount}`,
    `Entities: ${renderReviewStatusCounts(summary.entities_by_review_status ?? [])}`,
    `Relationships: ${renderReviewStatusCounts(summary.relationships_by_review_status ?? [])}`,
    `Review status: open=${summary.open_review_item_count ?? 0}, deferred=${
      summary.deferred_review_item_count ?? 0
    }, stale=${summary.stale_review_item_count ?? 0}, blocked=${
      summary.blocked_reconciliation_count ?? 0
    }, placeholders=${summary.placeholder_entity_count ?? 0}`,
    `Review debt by type: ${
      renderReviewDebtCounts(summary.review_debt_by_type ?? [], "item_type")
    }`,
    `Review debt by source: ${
      renderReviewDebtCounts(summary.review_debt_by_source ?? [], "source_id")
    }`,
    `Blocked by source: ${
      renderNamedCounts(summary.blocked_reconciliation_by_source ?? [], "source_id")
    }`,
    `Stale by prior decision: ${
      renderNamedCounts(summary.stale_review_by_prior_decision_state ?? [], "prior_decision_state")
    }`,
    `Sources: total=${summary.source_count ?? 0}, failed=${summary.failed_source_count ?? 0}`,
    `Datasets: total=${summary.dataset_count ?? 0}`,
    `Legal refs: ${renderNamedCounts(summary.legal_refs_by_type ?? [], "ref_type")}`,
    `Legal refs by review: ${renderReviewStatusCounts(summary.legal_refs_by_review_status ?? [])}`,
    `Review note: ${summary.review_status_note ?? "none"}`,
  ].join("\n");
}

export function buildReleaseInspection(outDir: string, manifest: ReleaseManifest): {
  outDir: string;
  generatedAt: string;
  fileCount: number;
  releaseSummary: NonNullable<ReleaseManifest["release_summary"]>;
} {
  return {
    outDir,
    generatedAt: manifest.generated_at ?? "unknown",
    fileCount: (manifest.files?.length ?? 0) + 1,
    releaseSummary: manifest.release_summary ?? {},
  };
}

function renderReviewStatusCounts(rows: Array<{ review_status: string; count: number }>): string {
  return rows.map((row) => `${row.review_status}=${row.count}`).join(", ") || "none";
}

function renderNamedCounts<T extends string>(
  rows: Array<Record<T, string> & { count: number }>,
  nameKey: T,
): string {
  return rows.map((row) => `${row[nameKey]}=${row.count}`).join(", ") || "none";
}

function renderReviewDebtCounts<T extends string>(
  rows: Array<Record<T, string> & { open_count: number; deferred_count: number }>,
  nameKey: T,
): string {
  return rows.map((row) => `${row[nameKey]}(open=${row.open_count},deferred=${row.deferred_count})`)
    .join(", ") || "none";
}
