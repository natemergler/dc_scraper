import { connectors } from "./connectors.ts";
import { dcCommand } from "./command_prefix.ts";
import { buildOperatorPlan } from "./operator_plan.ts";
import { Workbench } from "./workbench.ts";
import { renderReviewCommand } from "./workbench/review_command_args.ts";
import { reviewPacketDebtSummary } from "./workbench/review_packets.ts";
import { summarizeUnresolvedReconciliation } from "./workbench/unresolved_work.ts";

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
    blockedFamilies: Array<{
      sourceId: string;
      relationshipType: string;
      blockerId: string;
      blockerLabel: string;
      blockerState: string;
      count: number;
    }>;
    blockedByReason: Array<{ reason: string; count: number }>;
    firstBlocked?: {
      subjectId: string;
      sourceId: string;
      reason: string;
      relationshipType: string;
      rawValue?: string | null;
      blockers: Array<{ blockerId: string; blockerState: string; blockerLabel: string }>;
    };
    topUnblocker?: {
      reviewItemId: string;
      itemType: string;
      subjectId: string;
      sourceId: string;
      reason: string;
      defaultAction: string;
      downstreamBlockedCount: number;
      reviewCommand: string;
    };
  };
  canonical: {
    entities: number;
    relationships: number;
  };
  nextCommand: string;
  unresolvedStateNote: string;
}

export function buildWorkbenchStatus(workbench: Workbench): WorkbenchStatusSnapshot {
  const sourceRows = workbench.listSources();
  const fetchedSources = sourceRows.filter((row) => row.latestStatus).length;
  const failedSource = sourceRows.find((row) => row.latestStatus === "failed");
  const failedSources = sourceRows.filter((row) => row.latestStatus === "failed").length;
  const openReview = workbench.listReviewItems({ status: "open" }).length;
  const deferredReview = workbench.listReviewItems({ status: "deferred" }).length;
  const reviewDebt = reviewPacketDebtSummary(workbench);
  const staleReview = workbench.staleReviewSummary();
  const placeholders = workbench.placeholderSummary();
  const unresolvedWork = workbench.unresolvedWorkGraph();
  const reconciliation = summarizeUnresolvedReconciliation(unresolvedWork);
  const entities = workbench.canonicalEntities().length;
  const relationships = workbench.canonicalRelationships().length;
  const operatorPlan = buildOperatorPlan({
    fetchedSources,
    failedSourceId: failedSource?.sourceId,
    openReviewItemCount: openReview,
    deferredReviewItemCount: deferredReview,
    staleReviewItemCount: staleReview.count,
    blockedReconciliationCount: reconciliation.blockedCount,
    placeholderEntityCount: placeholders.count,
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
      blockedFamilies: reconciliation.blockedFamilies,
      blockedByReason: reconciliation.blockedByReason,
      firstBlocked: reconciliation.firstBlocked,
      topUnblocker: reconciliation.topUnblocker
        ? {
          ...reconciliation.topUnblocker,
          reviewCommand: reviewCommandForUnblocker(reconciliation.topUnblocker),
        }
        : undefined,
    },
    canonical: {
      entities,
      relationships,
    },
    nextCommand: operatorPlan.nextCommand,
    unresolvedStateNote: operatorPlan.unresolvedStateNote,
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
  const blockedFamilySummary = renderBlockedFamilySummary(status.reconciliation.blockedFamilies);
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
    ...(blockedFamilySummary ? [`Blocked families: ${blockedFamilySummary}`] : []),
    ...renderTopUnblockerSummary(status.reconciliation.topUnblocker),
    ...renderFirstBlockedSummary(status.reconciliation.firstBlocked),
    `Canonical: ${status.canonical.entities} entities, ${status.canonical.relationships} relationships`,
    `Readiness: ${status.unresolvedStateNote}`,
    `Next: ${status.nextCommand}`,
  ].join("\n");
}

export function renderWorkbenchAudit(status: WorkbenchStatusSnapshot): string {
  const lines = [renderWorkbenchStatus(status)];
  if (status.reconciliation.firstBlocked) {
    lines.push(
      "",
      "Blocked detail:",
      `Source: ${status.reconciliation.firstBlocked.sourceId}`,
      `Relationship: ${status.reconciliation.firstBlocked.relationshipType}`,
      `Reason: ${status.reconciliation.firstBlocked.reason}`,
      ...(status.reconciliation.firstBlocked.rawValue
        ? [`Value: ${status.reconciliation.firstBlocked.rawValue}`]
        : []),
      ...(status.reconciliation.firstBlocked.blockers.length > 0
        ? [
          `Waiting on: ${
            status.reconciliation.firstBlocked.blockers.map((blocker) =>
              renderBlockedDependency(blocker, status.reconciliation.firstBlocked?.rawValue)
            ).join(", ")
          }`,
        ]
        : []),
      `Subject id: ${status.reconciliation.firstBlocked.subjectId}`,
      `Inspect source: ${blockedInspectionCommand(status.reconciliation.firstBlocked.sourceId)}`,
    );
  }
  return lines.join("\n");
}

function blockedInspectionCommand(sourceId: string): string {
  return dcCommand(`source inspect ${sourceId}`);
}

function renderTopUnblockerSummary(
  topUnblocker: WorkbenchStatusSnapshot["reconciliation"]["topUnblocker"],
): string[] {
  if (!topUnblocker) return [];
  const plural = topUnblocker.downstreamBlockedCount === 1 ? "" : "s";
  return [
    `Top unblocker: ${topUnblocker.reason} (${topUnblocker.downstreamBlockedCount} blocked relationship${plural})`,
    `Review unblocker: ${topUnblocker.reviewCommand}`,
  ];
}

function renderFirstBlockedSummary(
  firstBlocked: WorkbenchStatusSnapshot["reconciliation"]["firstBlocked"],
): string[] {
  if (!firstBlocked) return [];
  return [
    `First blocked: ${
      firstBlocked.rawValue ?? firstBlocked.subjectId
    } [${firstBlocked.relationshipType} from ${firstBlocked.sourceId}]`,
    ...(firstBlocked.blockers.length > 0
      ? [
        `Waiting on: ${
          firstBlocked.blockers.map((blocker) =>
            renderBlockedDependency(blocker, firstBlocked.rawValue)
          ).join(", ")
        }`,
      ]
      : []),
    `Subject id: ${firstBlocked.subjectId}`,
  ];
}

function renderBlockedFamilySummary(
  families: WorkbenchStatusSnapshot["reconciliation"]["blockedFamilies"],
): string | undefined {
  if (families.length === 0) return undefined;
  const rendered = families.slice(0, 5).map((family) =>
    `${family.sourceId} ${family.relationshipType} -> ${family.blockerLabel} = ${family.count}`
  );
  if (families.length > 5) {
    rendered.push(`+${families.length - 5} more`);
  }
  return rendered.join("; ");
}

function renderBlockedDependency(
  blocker: { blockerId: string; blockerState: string; blockerLabel: string },
  rawValue?: string | null,
): string {
  const label = blocker.blockerLabel === blocker.blockerId && rawValue
    ? rawValue
    : blocker.blockerLabel;
  const state = blocker.blockerState === "missing"
    ? "missing endpoint"
    : blocker.blockerState.replaceAll("_", " ");
  return `${label} (${state}; id ${blocker.blockerId})`;
}

function reviewCommandForUnblocker(
  topUnblocker: NonNullable<ReturnType<typeof summarizeUnresolvedReconciliation>["topUnblocker"]>,
): string {
  return renderReviewCommand({
    mode: reviewModeForItemType(topUnblocker.itemType),
    subjectPrefix: topUnblocker.subjectId,
  });
}

function reviewModeForItemType(itemType: string):
  | "entities"
  | "relationships"
  | "legal"
  | "sources"
  | undefined {
  switch (itemType) {
    case "entity_candidate":
    case "placeholder_entity":
      return "entities";
    case "legal_ref":
      return "legal";
    case "relationship_candidate":
      return "relationships";
    case "source_status":
      return "sources";
    default:
      return undefined;
  }
}
