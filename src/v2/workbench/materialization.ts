import { autoAcceptSafeLegalRefs } from "./auto_accept_legal_refs.ts";
import { autoAcceptSafeRelationshipCandidates } from "./auto_accept_relationships.ts";
import { autoPromoteSafeEntityCandidates } from "./auto_promote.ts";
import { reconcileRelationshipCandidates } from "./reconciliation.ts";
import type { WorkbenchStore } from "./store.ts";

export type MaterializationStep =
  | "legal-auto-accept"
  | "entity-auto-promote"
  | "relationship-reconciliation"
  | "relationship-auto-accept";

export interface MaterializationOptions {
  onStep?: (step: MaterializationStep) => void;
}

export function materializePrerequisiteFacts(
  store: WorkbenchStore,
  options: MaterializationOptions = {},
): void {
  autoAcceptSafeLegalRefs(store);
  options.onStep?.("legal-auto-accept");
  autoPromoteSafeEntityCandidates(store);
  options.onStep?.("entity-auto-promote");
  reconcileRelationshipCandidates(store);
  options.onStep?.("relationship-reconciliation");
}

export function materializeRelationshipFacts(
  store: WorkbenchStore,
  options: MaterializationOptions = {},
): void {
  autoAcceptSafeRelationshipCandidates(store);
  options.onStep?.("relationship-auto-accept");
}

export function materializeReviewReadyFacts(store: WorkbenchStore): void {
  materializePrerequisiteFacts(store);
  materializeRelationshipFacts(store);
}
