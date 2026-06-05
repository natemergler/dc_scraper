export type ReleaseReadiness = "usable" | "usable-with-warnings" | "not-ready";

export interface ReleaseReadinessInput {
  sourceCount?: number;
  failedSourceCount?: number;
  openReviewItemCount?: number;
  deferredReviewItemCount?: number;
  staleReviewItemCount?: number;
  blockedReconciliationCount?: number;
  publicBodyReleaseRiskVariantLeadCount?: number;
  acceptedMultiGovernorEntityCount?: number;
  acceptedPublicBodyMissingOfficialUrlCount?: number;
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
  if (
    hasCount(input.openReviewItemCount) ||
    hasCount(input.deferredReviewItemCount) ||
    hasCount(input.publicBodyReleaseRiskVariantLeadCount) ||
    hasCount(input.acceptedMultiGovernorEntityCount) ||
    hasCount(input.acceptedPublicBodyMissingOfficialUrlCount)
  ) {
    return "usable-with-warnings";
  }
  return "usable";
}

export function releaseReadinessReasons(input: ReleaseReadinessInput): string[] {
  return [...releaseWarningReasons(input), ...releaseBlockingReasons(input)];
}

export function releaseWarningReasons(input: ReleaseReadinessInput): string[] {
  const reasons: string[] = [];
  if (hasCount(input.openReviewItemCount)) {
    reasons.push(`open decisions: ${input.openReviewItemCount}`);
  }
  if (hasCount(input.deferredReviewItemCount)) {
    reasons.push(`deferred review items: ${input.deferredReviewItemCount}`);
  }
  if (hasCount(input.publicBodyReleaseRiskVariantLeadCount)) {
    reasons.push(
      `public body duplicate-risk leads: ${input.publicBodyReleaseRiskVariantLeadCount}`,
    );
  }
  if (hasCount(input.acceptedMultiGovernorEntityCount)) {
    reasons.push(`multi-governor entities: ${input.acceptedMultiGovernorEntityCount}`);
  }
  if (hasCount(input.acceptedPublicBodyMissingOfficialUrlCount)) {
    reasons.push(
      `public bodies missing official URLs: ${input.acceptedPublicBodyMissingOfficialUrlCount}`,
    );
  }
  return reasons;
}

export function releaseBlockingReasons(input: ReleaseReadinessInput): string[] {
  const reasons: string[] = [];
  if (input.sourceCount === 0) reasons.push("no sources fetched");
  if (hasCount(input.failedSourceCount)) {
    reasons.push(`failed sources: ${input.failedSourceCount}`);
  }
  if (hasCount(input.staleReviewItemCount)) {
    reasons.push(`stale review items: ${input.staleReviewItemCount}`);
  }
  if (hasCount(input.blockedReconciliationCount)) {
    reasons.push(`blocked reconciliation items: ${input.blockedReconciliationCount}`);
  }
  if (hasCount(input.placeholderEntityCount)) {
    reasons.push(`placeholder entities: ${input.placeholderEntityCount}`);
  }
  if (hasCount(input.blockingProblemCount)) {
    reasons.push(`package integrity problems: ${input.blockingProblemCount}`);
  }
  return reasons;
}

function hasCount(value: number | undefined): boolean {
  return (value ?? 0) > 0;
}
