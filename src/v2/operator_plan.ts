import { dcCommand } from "./command_prefix.ts";
import { connectors } from "./connectors.ts";
import type { ReviewItemRecord } from "./domain.ts";
import type { ReviewItemFilters } from "./workbench/review.ts";
import type {
  ReviewPacketBatchCommandAction,
  ReviewPacketCommandOptions,
} from "./workbench/review_packets.ts";

export interface WorkbenchUnresolvedCounts {
  openReviewItemCount: number;
  deferredReviewItemCount: number;
  staleReviewItemCount: number;
  blockedReconciliationCount: number;
  placeholderEntityCount: number;
}

export interface OperatorPlanInput extends WorkbenchUnresolvedCounts {
  suggestReviewPacketCommand: ReviewPacketCommandSuggester;
  fetchedSources: number;
  failedSourceId?: string;
}

export type ReviewPacketCommandSuggester = (
  filters: ReviewItemFilters,
  action: ReviewPacketBatchCommandAction,
  options?: ReviewPacketCommandOptions,
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

function suggestScopedReviewCommand(input: OperatorPlanInput): string | undefined {
  return input.suggestReviewPacketCommand(
    { mode: "entities", status: "open" },
    "accept-safe",
    { itemFilter: isExplicitSafeEntityReviewItem },
  ) ??
    input.suggestReviewPacketCommand(
      { mode: "relationships", status: "open" },
      "accept-safe",
    ) ??
    input.suggestReviewPacketCommand(
      { mode: "relationships", status: "open" },
      "defer-default",
    ) ??
    input.suggestReviewPacketCommand({ mode: "legal", status: "open" }, "defer-default") ??
    input.suggestReviewPacketCommand(
      { mode: "entities", status: "open" },
      "accept-safe",
      { itemFilter: isNonExplicitSafeEntityReviewItem },
    );
}

function isExplicitSafeEntityReviewItem(item: ReviewItemRecord): boolean {
  return item.itemType === "entity_candidate" && item.details.safeToAutoAccept === true;
}

function isNonExplicitSafeEntityReviewItem(item: ReviewItemRecord): boolean {
  return item.itemType === "entity_candidate" && item.details.safeToAutoAccept !== true;
}
