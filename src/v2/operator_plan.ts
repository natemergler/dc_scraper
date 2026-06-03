import { dcCommand } from "./command_prefix.ts";
import { connectors } from "./connectors.ts";
import type { ReviewItemRecord } from "./domain.ts";
import type { Workbench } from "./workbench.ts";
import { canBatchAcceptReviewItem } from "./workbench/review.ts";

export interface WorkbenchUnresolvedCounts {
  openReviewItemCount: number;
  deferredReviewItemCount: number;
  staleReviewItemCount: number;
  blockedReconciliationCount: number;
  placeholderEntityCount: number;
}

export interface OperatorPlanInput extends WorkbenchUnresolvedCounts {
  workbench: Workbench;
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
  const suggestedReviewCommand = suggestScopedReviewCommand(input.workbench);
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
      command: dcCommand(
        `review batch accept-safe --mode entities --subject-prefix candidate.${source.sourceId}`,
      ),
      count: safeCount,
    };
    best = betterSuggestion(best, candidate);
  }
  return best;
}

function suggestSafeRelationshipBatch(workbench: Workbench): SuggestedCommand | undefined {
  const items = workbench.listReviewItems({ mode: "relationships", status: "open" });
  let best: SuggestedCommand | undefined;
  for (
    const group of groupedReviewSlices(
      items,
      "relationship",
      "relationshipType",
      "relationshipType",
    )
  ) {
    const filters = {
      mode: "relationships",
      status: "open",
      subjectPrefix: `relationship.${group.sourceId}`,
      relationshipType: group.detailValue,
    } as const;
    const safeCount = group.items.filter((item) =>
      canBatchAcceptReviewItem(workbench, item, filters)
    ).length;
    if (safeCount === 0) continue;
    const candidate = {
      command: dcCommand(
        `review batch accept-safe --mode relationships --subject-prefix relationship.${group.sourceId} --relationship-type ${group.detailValue}`,
      ),
      count: safeCount,
    };
    best = betterSuggestion(best, candidate);
  }
  return best;
}

function suggestDeferDefaultRelationshipBatch(workbench: Workbench): SuggestedCommand | undefined {
  const items = workbench.listReviewItems({ mode: "relationships", status: "open" });
  let best: SuggestedCommand | undefined;
  for (
    const group of groupedReviewSlices(
      items,
      "relationship",
      "relationshipType",
      "relationshipType",
    )
  ) {
    if (group.items.some((item) => item.defaultAction !== "defer")) continue;
    const candidate = {
      command: dcCommand(
        `review batch defer-default --mode relationships --subject-prefix relationship.${group.sourceId} --relationship-type ${group.detailValue}`,
      ),
      count: group.items.length,
    };
    best = betterSuggestion(best, candidate);
  }
  return best;
}

function suggestDeferDefaultLegalBatch(workbench: Workbench): SuggestedCommand | undefined {
  const items = workbench.listReviewItems({ mode: "legal", status: "open" });
  let best: SuggestedCommand | undefined;
  for (const group of groupedReviewSlices(items, "legal", "refType", "refType")) {
    if (group.items.some((item) => item.defaultAction !== "defer")) continue;
    const candidate = {
      command: dcCommand(
        `review batch defer-default --mode legal --subject-prefix legal.${group.sourceId} --ref-type ${group.detailValue}`,
      ),
      count: group.items.length,
    };
    best = betterSuggestion(best, candidate);
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
      command: dcCommand(
        `review batch accept-safe --mode entities --subject-prefix candidate.${source.sourceId}`,
      ),
      count: safeCount,
    };
    best = betterSuggestion(best, candidate);
  }
  return best;
}

interface GroupedReviewSlice {
  sourceId: string;
  detailValue: string;
  items: ReviewItemRecord[];
}

function groupedReviewSlices(
  items: ReviewItemRecord[],
  subjectKind: "relationship" | "legal",
  detailKey: string,
  groupLabel: string,
): GroupedReviewSlice[] {
  const grouped = new Map<string, GroupedReviewSlice>();
  for (const item of items) {
    const sourceId = sourceIdForReviewSubject(item.subjectId, subjectKind);
    const detailValue = detailString(item.details, detailKey);
    if (!sourceId || !detailValue) continue;
    const key = `${sourceId}:${groupLabel}:${detailValue}`;
    const group = grouped.get(key) ?? { sourceId, detailValue, items: [] };
    group.items.push(item);
    if (!grouped.has(key)) grouped.set(key, group);
  }
  return Array.from(grouped.values());
}

function betterSuggestion(
  current: SuggestedCommand | undefined,
  candidate: SuggestedCommand,
): SuggestedCommand {
  return !current || candidate.count > current.count ? candidate : current;
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
