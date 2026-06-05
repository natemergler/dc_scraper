import type {
  ConflictKind,
  ConflictSubjectKind,
  ProposedReviewAction,
  ProposedReviewActionKind,
  ReviewItemInput,
  ReviewItemRecord,
} from "../domain.ts";

export const conflictKinds = [
  "fact_conflict",
  "unresolved_symbol",
  "parse_or_normalization_failure",
  "compiler_diagnostic",
] as const satisfies readonly ConflictKind[];

export const conflictSubjectKinds = [
  "entity",
  "relationship",
  "legal_ref",
  "dataset",
  "source_item",
] as const satisfies readonly ConflictSubjectKind[];

export const proposedReviewActionKinds = [
  "accept_fact",
  "reject_fact",
  "map_symbol",
  "create_alias_rule",
  "create_placeholder",
  "normalize_legal_ref",
  "mark_non_graphable",
  "defer",
  "open_source_issue",
] as const satisfies readonly ProposedReviewActionKind[];

export function reviewConflictKindForInput(item: ReviewItemInput): ConflictKind {
  if (item.conflictKind) return item.conflictKind;
  return inferConflictKind(item.itemType, item.defaultAction, item.details);
}

export function reviewSubjectKindForInput(item: ReviewItemInput): ConflictSubjectKind {
  if (item.subjectKind) return item.subjectKind;
  return inferSubjectKind(item.itemType);
}

export function proposedActionsForInput(item: ReviewItemInput): ProposedReviewAction[] {
  return item.proposedActions ?? proposedActionsForReviewItem(
    reviewConflictKindForInput(item),
    reviewSubjectKindForInput(item),
    item.defaultAction,
    item.details,
  );
}

export function proposedActionsForReviewItem(
  conflictKind: ConflictKind,
  subjectKind: ConflictSubjectKind,
  defaultAction: string,
  details: Record<string, unknown>,
): ProposedReviewAction[] {
  if (conflictKind === "unresolved_symbol") {
    return [
      { action: "map_symbol" },
      { action: "create_alias_rule" },
      { action: "create_placeholder" },
      { action: "defer" },
      { action: "open_source_issue" },
    ];
  }
  if (conflictKind === "compiler_diagnostic") {
    return [
      { action: "mark_non_graphable" },
      { action: "defer" },
      { action: "open_source_issue" },
    ];
  }
  if (subjectKind === "legal_ref" || conflictKind === "parse_or_normalization_failure") {
    return [
      { action: "normalize_legal_ref" },
      { action: "accept_fact" },
      { action: "reject_fact" },
      { action: "defer" },
      { action: "open_source_issue" },
    ];
  }
  const actions: ProposedReviewAction[] = [
    { action: "accept_fact" },
    { action: "reject_fact" },
    { action: "defer" },
  ];
  if (defaultAction === "defer" || details.needsReview === true) {
    actions.push({ action: "open_source_issue" });
  }
  return actions;
}

export function inferConflictKind(
  itemType: ReviewItemRecord["itemType"],
  defaultAction: string,
  details: Record<string, unknown>,
): ConflictKind {
  if (itemType === "source_status") return "compiler_diagnostic";
  if (itemType === "legal_ref") {
    const refType = typeof details.refType === "string" ? details.refType : "unknown";
    const normalizedCitation = details.normalizedCitation;
    if (refType === "unknown" || typeof normalizedCitation !== "string") {
      return "parse_or_normalization_failure";
    }
  }
  if (itemType === "relationship_candidate" && details.unresolvedSymbol === true) {
    return "unresolved_symbol";
  }
  if (defaultAction === "defer" && typeof details.rawLabel === "string") {
    return "unresolved_symbol";
  }
  return "fact_conflict";
}

export function inferSubjectKind(
  itemType: ReviewItemRecord["itemType"],
): ConflictSubjectKind {
  switch (itemType) {
    case "entity_candidate":
    case "placeholder_entity":
      return "entity";
    case "relationship_candidate":
      return "relationship";
    case "legal_ref":
      return "legal_ref";
    case "dataset":
      return "dataset";
    case "source_status":
      return "source_item";
  }
}

export function parseProposedActions(value: string): ProposedReviewAction[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isProposedReviewAction);
}

function isProposedReviewAction(value: unknown): value is ProposedReviewAction {
  if (!value || typeof value !== "object") return false;
  const action = (value as { action?: unknown }).action;
  return typeof action === "string" &&
    proposedReviewActionKinds.includes(action as ProposedReviewActionKind);
}
