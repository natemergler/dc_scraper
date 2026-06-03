import { dcCommand } from "./command_prefix.ts";
import { connectors } from "./connectors.ts";
import type { ReviewItemRecord } from "./domain.ts";
import { reviewBatchCommand } from "./workbench/review_command_args.ts";
import type { ReviewDebtSummary, ReviewItemFilters } from "./workbench/review.ts";
import type { ReviewPacketBatchCommandAction } from "./workbench/review_packets.ts";

export interface WorkbenchUnresolvedCounts {
  openReviewItemCount: number;
  deferredReviewItemCount: number;
  staleReviewItemCount: number;
  blockedReconciliationCount: number;
  placeholderEntityCount: number;
}

export interface OperatorPlanInput extends WorkbenchUnresolvedCounts {
  workbench: OperatorPlanWorkbench;
  canBatchAcceptReviewItem: BatchAcceptPredicate;
  suggestReviewPacketCommand: ReviewPacketCommandSuggester;
  fetchedSources: number;
  failedSourceId?: string;
}

export interface OperatorPlanWorkbench {
  reviewDebtSummary(): ReviewDebtSummary;
  listReviewItems(filters?: ReviewItemFilters): ReviewItemRecord[];
}

export type BatchAcceptPredicate = (
  item: ReviewItemRecord,
  filters: ReviewItemFilters,
) => boolean;
export type ReviewPacketCommandSuggester = (
  filters: ReviewItemFilters,
  action: ReviewPacketBatchCommandAction,
) => string | undefined;

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
  if (
    counts.openReviewItemCount === 0 &&
    counts.deferredReviewItemCount === 0 &&
    counts.staleReviewItemCount === 0 &&
    counts.blockedReconciliationCount === 0 &&
    counts.placeholderEntityCount === 0
  ) {
    return "No open review items, deferred review items, stale review items, blocked reconciliation items, or placeholder entities were present.";
  }
  return `Unresolved workbench state: open review=${counts.openReviewItemCount}, deferred review=${counts.deferredReviewItemCount}, stale review=${counts.staleReviewItemCount}, blocked reconciliation=${counts.blockedReconciliationCount}, placeholder entities=${counts.placeholderEntityCount}.`;
}

function nextCommand(input: OperatorPlanInput): string {
  if (input.failedSourceId) return dcCommand(`source inspect ${input.failedSourceId}`);
  const suggestedReviewCommand = suggestScopedReviewCommand(input);
  if (suggestedReviewCommand) return suggestedReviewCommand;
  if (input.openReviewItemCount > 0) return dcCommand("review");
  if (input.blockedReconciliationCount > 0) return dcCommand("audit");
  if (input.fetchedSources < connectors.length) return dcCommand("source list");
  return dcCommand("release build");
}

interface SuggestedCommand {
  command: string;
  count: number;
}

function suggestScopedReviewCommand(input: OperatorPlanInput): string | undefined {
  return suggestExplicitSafeEntityBatch(input)?.command ??
    input.suggestReviewPacketCommand(
      { mode: "relationships", status: "open" },
      "accept-safe",
    ) ??
    input.suggestReviewPacketCommand(
      { mode: "relationships", status: "open" },
      "defer-default",
    ) ??
    input.suggestReviewPacketCommand({ mode: "legal", status: "open" }, "defer-default") ??
    suggestHighConfidenceEntityBatch(input)?.command;
}

function suggestExplicitSafeEntityBatch(input: OperatorPlanInput): SuggestedCommand | undefined {
  const reviewDebt = input.workbench.reviewDebtSummary();
  let best: SuggestedCommand | undefined;
  for (const source of reviewDebt.bySource) {
    if (source.openCount === 0) continue;
    const filters = {
      mode: "entities",
      status: "open",
      subjectPrefix: `candidate.${source.sourceId}`,
    } as const;
    const items = input.workbench.listReviewItems(filters);
    const safeCount = items.filter((item) =>
      item.details.safeToAutoAccept === true &&
      input.canBatchAcceptReviewItem(item, filters)
    ).length;
    if (safeCount === 0) continue;
    const candidate = {
      command: reviewBatchCommand("accept-safe", filters),
      count: safeCount,
    };
    best = betterSuggestion(best, candidate);
  }
  return best;
}

function suggestHighConfidenceEntityBatch(input: OperatorPlanInput): SuggestedCommand | undefined {
  const reviewDebt = input.workbench.reviewDebtSummary();
  let best: SuggestedCommand | undefined;
  for (const source of reviewDebt.bySource) {
    if (source.openCount === 0) continue;
    const filters = {
      mode: "entities",
      status: "open",
      subjectPrefix: `candidate.${source.sourceId}`,
    } as const;
    const items = input.workbench.listReviewItems(filters);
    const safeCount = items.filter((item) =>
      item.details.safeToAutoAccept !== true &&
      input.canBatchAcceptReviewItem(item, filters)
    ).length;
    if (safeCount === 0) continue;
    const candidate = {
      command: reviewBatchCommand("accept-safe", filters),
      count: safeCount,
    };
    best = betterSuggestion(best, candidate);
  }
  return best;
}

function betterSuggestion(
  current: SuggestedCommand | undefined,
  candidate: SuggestedCommand,
): SuggestedCommand {
  return !current || candidate.count > current.count ? candidate : current;
}
