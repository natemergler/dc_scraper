import { connectors } from "./connectors.ts";
import { dcCommand } from "./command_prefix.ts";
import { Workbench } from "./workbench.ts";
import { renderReviewCommand } from "./workbench/review_command_args.ts";
import { reviewDecisionSummary } from "./workbench/review.ts";
import { summarizeUnresolvedReconciliation } from "./workbench/unresolved_work.ts";

export interface WorkbenchStatusSnapshot {
  sources: {
    fetched: number;
    failed: number;
    total: number;
    firstFailedSourceId?: string;
    firstFailedSourceErrorText?: string;
  };
  review: {
    open: number;
    humanDecisionOpen: number;
    browseOnlyOpen: number;
    deferred: number;
    humanDecisionOpenByItemType: Array<{ itemType: string; count: number }>;
    browseCommand?: string;
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
      inspectCommand: string;
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
  publicBodies: {
    conservativeVariantLeads: number;
    releaseRiskVariantLeads: number;
    governanceSuffixLeads: number;
    inspectCommand?: string;
    firstGovernanceSuffixLead?: {
      variantName: string;
      sourceIds: string[];
      names: string[];
    };
  };
  nextCommand: string;
  unresolvedStateNote: string;
}

interface WorkbenchUnresolvedCounts {
  openReviewItemCount: number;
  humanDecisionOpenReviewItemCount?: number;
  browseOnlyOpenReviewItemCount?: number;
  deferredReviewItemCount: number;
  staleReviewItemCount: number;
  blockedReconciliationCount: number;
  placeholderEntityCount: number;
}

interface WorkbenchStatusPlanInput extends WorkbenchUnresolvedCounts {
  fetchedSources: number;
  failedSourceId?: string;
  topUnblockerReviewCommand?: string;
}

interface WorkbenchStatusPlan {
  nextCommand: string;
  unresolvedStateNote: string;
}

export function buildWorkbenchStatus(workbench: Workbench): WorkbenchStatusSnapshot {
  const sourceRows = workbench.listSources();
  const fetchedSources = sourceRows.filter((row) => row.latestStatus).length;
  const failedSource = sourceRows.find((row) => row.latestStatus === "failed");
  const failedSourceSummary = failedSource
    ? workbench.sourceSummary(failedSource.sourceId)
    : undefined;
  const failedSources = sourceRows.filter((row) => row.latestStatus === "failed").length;
  const reviewDecisions = reviewDecisionSummary(workbench);
  const staleReview = workbench.staleReviewSummary();
  const placeholders = workbench.placeholderSummary();
  const unresolvedWork = workbench.unresolvedWorkGraph();
  const reconciliation = summarizeUnresolvedReconciliation(unresolvedWork);
  const topUnblockerReviewCommand = reconciliation.topUnblocker
    ? reviewCommandForUnblocker(reconciliation.topUnblocker)
    : undefined;
  const publicBodyComparison = workbench.comparePublicBodies();
  const governanceSuffixLeads = publicBodyComparison.conservativeVariantMatches.filter((match) =>
    match.matchKinds.includes("governance_suffix")
  );
  const entities = workbench.canonicalEntities().length;
  const relationships = workbench.canonicalRelationships().length;
  const statusPlan = buildWorkbenchStatusPlan({
    fetchedSources,
    failedSourceId: failedSource?.sourceId,
    openReviewItemCount: reviewDecisions.open,
    humanDecisionOpenReviewItemCount: reviewDecisions.humanDecisionOpen,
    browseOnlyOpenReviewItemCount: reviewDecisions.browseOnlyOpen,
    deferredReviewItemCount: reviewDecisions.deferred,
    staleReviewItemCount: staleReview.count,
    blockedReconciliationCount: reconciliation.blockedCount,
    topUnblockerReviewCommand,
    placeholderEntityCount: placeholders.count,
  });
  return {
    sources: {
      fetched: fetchedSources,
      failed: failedSources,
      total: connectors.length,
      firstFailedSourceId: failedSource?.sourceId,
      firstFailedSourceErrorText: failedSourceSummary?.latestErrorText,
    },
    review: {
      open: reviewDecisions.open,
      humanDecisionOpen: reviewDecisions.humanDecisionOpen,
      browseOnlyOpen: reviewDecisions.browseOnlyOpen,
      deferred: reviewDecisions.deferred,
      humanDecisionOpenByItemType: reviewDecisions.humanDecisionOpenByItemType,
      browseCommand: reviewDecisions.browseOnlyOpen > 0
        ? dcCommand("review list --status all")
        : undefined,
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
      firstBlocked: reconciliation.firstBlocked
        ? {
          ...reconciliation.firstBlocked,
          inspectCommand: blockedInspectionCommand(reconciliation.firstBlocked.sourceId),
        }
        : undefined,
      topUnblocker: reconciliation.topUnblocker
        ? {
          ...reconciliation.topUnblocker,
          reviewCommand: topUnblockerReviewCommand ?? reviewCommandForUnblocker(
            reconciliation.topUnblocker,
          ),
        }
        : undefined,
    },
    canonical: {
      entities,
      relationships,
    },
    publicBodies: {
      conservativeVariantLeads: publicBodyComparison.conservativeVariantMatchCount,
      releaseRiskVariantLeads: publicBodyComparison.releaseRiskVariantMatchCount,
      governanceSuffixLeads: governanceSuffixLeads.length,
      inspectCommand: governanceSuffixLeads.length > 0
        ? publicBodyLeadsInspectCommand()
        : undefined,
      firstGovernanceSuffixLead: governanceSuffixLeads[0]
        ? {
          variantName: governanceSuffixLeads[0].variantName,
          sourceIds: governanceSuffixLeads[0].sourceIds,
          names: governanceSuffixLeads[0].names.map((name) => name.displayName),
        }
        : undefined,
    },
    nextCommand: statusPlan.nextCommand,
    unresolvedStateNote: statusPlan.unresolvedStateNote,
  };
}

function buildWorkbenchStatusPlan(input: WorkbenchStatusPlanInput): WorkbenchStatusPlan {
  return {
    nextCommand: nextWorkbenchCommand(input),
    unresolvedStateNote: unresolvedStateNote(input),
  };
}

function unresolvedStateNote(counts: WorkbenchUnresolvedCounts): string {
  const openDecisionCount = counts.humanDecisionOpenReviewItemCount ?? counts.openReviewItemCount;
  const browseOnlyCount = counts.browseOnlyOpenReviewItemCount ?? 0;
  if (
    openDecisionCount === 0 &&
    browseOnlyCount === 0 &&
    counts.deferredReviewItemCount === 0 &&
    counts.staleReviewItemCount === 0 &&
    counts.blockedReconciliationCount === 0 &&
    counts.placeholderEntityCount === 0
  ) {
    return "No open decisions, browse rows, deferred review items, stale review items, blocked reconciliation items, or placeholder entities were present.";
  }
  return `Workbench state: open decisions=${openDecisionCount}, browse rows=${browseOnlyCount}, deferred review=${counts.deferredReviewItemCount}, stale review=${counts.staleReviewItemCount}, blocked reconciliation=${counts.blockedReconciliationCount}, placeholder entities=${counts.placeholderEntityCount}.`;
}

function nextWorkbenchCommand(input: WorkbenchStatusPlanInput): string {
  if (input.failedSourceId) return dcCommand(`source inspect ${input.failedSourceId}`);
  if (input.topUnblockerReviewCommand) return input.topUnblockerReviewCommand;
  if ((input.humanDecisionOpenReviewItemCount ?? input.openReviewItemCount) > 0) {
    return dcCommand("review");
  }
  if (input.staleReviewItemCount > 0) return dcCommand("review");
  if (input.blockedReconciliationCount > 0) return dcCommand("audit");
  if (input.placeholderEntityCount > 0) return dcCommand("audit");
  if (input.fetchedSources < connectors.length) return dcCommand("source list");
  return dcCommand("release verify");
}

export function renderWorkbenchStatus(status: WorkbenchStatusSnapshot): string {
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
    ...(status.sources.firstFailedSourceId
      ? [`First failed source: ${status.sources.firstFailedSourceId}`]
      : []),
    ...(status.sources.firstFailedSourceErrorText
      ? [`Failure detail: ${status.sources.firstFailedSourceErrorText}`]
      : []),
    `Decisions: ${status.review.humanDecisionOpen} open, ${status.review.deferred} deferred`,
    ...(status.review.humanDecisionOpenByItemType.length > 0
      ? [`Decision types: ${renderItemTypeCounts(status.review.humanDecisionOpenByItemType)}`]
      : []),
    `Browse: ${status.review.browseOnlyOpen} source-backed row${
      status.review.browseOnlyOpen === 1 ? "" : "s"
    }`,
    ...(status.review.browseOnlyOpen > 0
      ? [`Browse rows: ${status.review.browseCommand ?? dcCommand("review list --status all")}`]
      : []),
    `Stale review: ${status.staleReview.count}${
      status.staleReview.firstStale?.priorDecisionState
        ? ` from prior ${status.staleReview.firstStale.priorDecisionState} decision`
        : ""
    }`,
    ...(status.staleReview.firstStale
      ? [
        `First stale: ${status.staleReview.firstStale.subjectId} (${status.staleReview.firstStale.reason})`,
      ]
      : []),
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
    ...renderPublicBodyLinkageSummary(status.publicBodies),
    `Canonical: ${status.canonical.entities} entities, ${status.canonical.relationships} relationships`,
    `Readiness: ${status.unresolvedStateNote}`,
    `Next: ${status.nextCommand}`,
  ].join("\n");
}

function renderItemTypeCounts(rows: Array<{ itemType: string; count: number }>): string {
  return rows.map((row) => `${row.itemType}=${row.count}`).join(", ");
}

function renderPublicBodyLinkageSummary(status: WorkbenchStatusSnapshot["publicBodies"]): string[] {
  if (status.governanceSuffixLeads === 0) return [];
  return [
    `Public-body linkage leads: ${status.governanceSuffixLeads} governance-suffix lead${
      status.governanceSuffixLeads === 1 ? "" : "s"
    }${
      status.firstGovernanceSuffixLead
        ? `, first ${status.firstGovernanceSuffixLead.variantName}`
        : ""
    }`,
    `Inspect leads: ${status.inspectCommand ?? publicBodyLeadsInspectCommand()}`,
  ];
}

function publicBodyLeadsInspectCommand(): string {
  return dcCommand("source compare public-bodies");
}

export function renderWorkbenchAudit(status: WorkbenchStatusSnapshot): string {
  const lines = [renderWorkbenchStatus(status)];
  if (status.placeholders.firstPlaceholder) {
    lines.push(
      "",
      "Placeholder detail:",
      `Entity: ${status.placeholders.firstPlaceholder.name}`,
      ...(status.placeholders.firstPlaceholder.placeholderReason
        ? [`Reason: ${status.placeholders.firstPlaceholder.placeholderReason}`]
        : []),
      `Kind: ${status.placeholders.firstPlaceholder.kind}`,
      `Entity id: ${status.placeholders.firstPlaceholder.entityId}`,
    );
  }
  if (status.staleReview.firstStale) {
    lines.push(
      "",
      "Stale review detail:",
      `Subject id: ${status.staleReview.firstStale.subjectId}`,
      `Item type: ${status.staleReview.firstStale.itemType}`,
      ...(status.staleReview.firstStale.priorDecisionState
        ? [`Prior decision: ${status.staleReview.firstStale.priorDecisionState}`]
        : []),
      `Reason: ${status.staleReview.firstStale.reason}`,
    );
  }
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
      `Inspect source: ${status.reconciliation.firstBlocked.inspectCommand}`,
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
    sourceId: topUnblocker.sourceId,
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
