import { dcCommand } from "./command_prefix.ts";
import { connectors } from "./connectors.ts";

export interface WorkbenchUnresolvedCounts {
  openReviewItemCount: number;
  humanDecisionOpenReviewItemCount?: number;
  browseOnlyOpenReviewItemCount?: number;
  deferredReviewItemCount: number;
  staleReviewItemCount: number;
  blockedReconciliationCount: number;
  placeholderEntityCount: number;
}

export interface OperatorPlanInput extends WorkbenchUnresolvedCounts {
  fetchedSources: number;
  failedSourceId?: string;
}

export interface OperatorPlan {
  nextCommand: string;
  unresolvedStateNote: string;
}

export function buildOperatorPlan(input: OperatorPlanInput): OperatorPlan {
  return {
    nextCommand: nextCommand(input),
    unresolvedStateNote: unresolvedStateNote(input),
  };
}

export function unresolvedStateNote(counts: WorkbenchUnresolvedCounts): string {
  const openReviewDetail = typeof counts.humanDecisionOpenReviewItemCount === "number" ||
      typeof counts.browseOnlyOpenReviewItemCount === "number"
    ? ` (human decisions=${
      counts.humanDecisionOpenReviewItemCount ?? counts.openReviewItemCount
    }, browse-only=${counts.browseOnlyOpenReviewItemCount ?? 0})`
    : "";
  if (
    counts.openReviewItemCount === 0 &&
    counts.deferredReviewItemCount === 0 &&
    counts.staleReviewItemCount === 0 &&
    counts.blockedReconciliationCount === 0 &&
    counts.placeholderEntityCount === 0
  ) {
    return "No open review items, deferred review items, stale review items, blocked reconciliation items, or placeholder entities were present.";
  }
  return `Unresolved workbench state: open review=${counts.openReviewItemCount}${openReviewDetail}, deferred review=${counts.deferredReviewItemCount}, stale review=${counts.staleReviewItemCount}, blocked reconciliation=${counts.blockedReconciliationCount}, placeholder entities=${counts.placeholderEntityCount}.`;
}

function nextCommand(input: OperatorPlanInput): string {
  if (input.failedSourceId) return dcCommand(`source inspect ${input.failedSourceId}`);
  if ((input.humanDecisionOpenReviewItemCount ?? input.openReviewItemCount) > 0) {
    return dcCommand("review");
  }
  if (input.blockedReconciliationCount > 0) return dcCommand("audit");
  if (input.fetchedSources < connectors.length) return dcCommand("source list");
  return dcCommand("release build");
}
