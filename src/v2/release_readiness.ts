export type ReleaseReadiness = "usable" | "usable-with-warnings" | "not-ready";

export interface ReleaseReadinessInput {
  sourceCount?: number;
  failedSourceCount?: number;
  openReviewItemCount?: number;
  deferredReviewItemCount?: number;
  staleReviewItemCount?: number;
  blockedReconciliationCount?: number;
  placeholderEntityCount?: number;
  blockingProblemCount?: number;
}

export function classifyReleaseReadiness(input: ReleaseReadinessInput): ReleaseReadiness {
  if (
    input.sourceCount === 0 ||
    hasCount(input.failedSourceCount) ||
    hasCount(input.staleReviewItemCount) ||
    hasCount(input.blockedReconciliationCount) ||
    hasCount(input.placeholderEntityCount) ||
    hasCount(input.blockingProblemCount)
  ) {
    return "not-ready";
  }
  if (hasCount(input.openReviewItemCount) || hasCount(input.deferredReviewItemCount)) {
    return "usable-with-warnings";
  }
  return "usable";
}

function hasCount(value: number | undefined): boolean {
  return (value ?? 0) > 0;
}
