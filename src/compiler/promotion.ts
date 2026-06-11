import type { CitationValue, EntryFragment, Finding } from "../core/types.ts";

export type EntryPromotionAction =
  | "promote"
  | "promote_with_warning"
  | "review_required"
  | "conflict"
  | "drop";

interface PromotionFindingFields {
  code: string;
  message: string;
  citation?: CitationValue;
}

export type EntryPromotionDecision =
  | { action: "promote"; reason?: string }
  | ({ action: "promote_with_warning" } & PromotionFindingFields)
  | ({ action: "review_required" } & PromotionFindingFields)
  | ({ action: "conflict" } & PromotionFindingFields)
  | ({ action: "drop" } & PromotionFindingFields);

export interface RelationKindCanonicalization {
  kind: string;
  finding?: Finding;
}

export interface PromotionPolicy {
  decideEntryFragment(fragment: EntryFragment): EntryPromotionDecision;
  canonicalizeRelationKind?(kind: string): RelationKindCanonicalization;
}

export const promoteAllFragmentsPolicy: PromotionPolicy = {
  decideEntryFragment: () => ({ action: "promote" }),
};
