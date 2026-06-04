import { queryAll } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

const PUBLIC_BODY_SPECIFIC_KINDS = new Set([
  "board",
  "commission",
  "committee",
  "council",
  "task_force",
]);

const AUTHORITATIVE_KIND_REFINEMENT_SOURCE_PRECEDENCE = new Map<string, Set<string>>([
  ["bega.structure", new Set(["dcgis.agencies"])],
  ["dccourts.structure", new Set(["dcgis.agencies"])],
]);

export interface EntityKindPolicyCanonical {
  kind: string;
  mergedCandidateIds: string;
}

export interface EntityKindPolicyCandidate {
  kind: string;
  sourceId: string;
}

export type EntityKindMergeDecision =
  | { decision: "compatible" }
  | { decision: "refinement" }
  | { decision: "conflict" };

export function classifySameEntityKindMerge(
  store: WorkbenchStore,
  canonical: EntityKindPolicyCanonical,
  candidate: EntityKindPolicyCandidate,
): EntityKindMergeDecision {
  if (canonical.kind === candidate.kind) return { decision: "compatible" };
  if (isGenericPublicBodyRefinement(canonical.kind, candidate.kind)) {
    return { decision: "refinement" };
  }
  if (isAuthoritativeSourceRefinement(store, canonical, candidate)) {
    return { decision: "refinement" };
  }
  return { decision: "conflict" };
}

export function compareAuthoritativeEntitySourcePrecedence(
  candidateSourceId: string,
  otherSourceId: string,
): number {
  if (AUTHORITATIVE_KIND_REFINEMENT_SOURCE_PRECEDENCE.get(candidateSourceId)?.has(otherSourceId)) {
    return 1;
  }
  if (AUTHORITATIVE_KIND_REFINEMENT_SOURCE_PRECEDENCE.get(otherSourceId)?.has(candidateSourceId)) {
    return -1;
  }
  return 0;
}

export function compareEntityKindSpecificity(candidateKind: string, otherKind: string): number {
  if (candidateKind === otherKind) return 0;
  if (isGenericPublicBodyRefinement(otherKind, candidateKind)) return 1;
  if (isGenericPublicBodyRefinement(candidateKind, otherKind)) return -1;
  return 0;
}

function isGenericPublicBodyRefinement(canonicalKind: string, candidateKind: string): boolean {
  return canonicalKind === "public_body" && PUBLIC_BODY_SPECIFIC_KINDS.has(candidateKind);
}

function isAuthoritativeSourceRefinement(
  store: WorkbenchStore,
  canonical: EntityKindPolicyCanonical,
  candidate: EntityKindPolicyCandidate,
): boolean {
  const supersededSources = AUTHORITATIVE_KIND_REFINEMENT_SOURCE_PRECEDENCE.get(candidate.sourceId);
  if (!supersededSources) return false;
  const mergedCandidateIds = JSON.parse(canonical.mergedCandidateIds) as string[];
  if (mergedCandidateIds.length === 0) return false;
  const placeholders = mergedCandidateIds.map(() => "?").join(", ");
  const sourceRows = queryAll<{ sourceId: string }>(
    store.db,
    `select distinct source_items.source_id as sourceId
     from entity_candidates
     join source_items on source_items.source_item_id = entity_candidates.source_item_id
     where entity_candidates.candidate_id in (${placeholders})`,
    mergedCandidateIds,
  );
  return sourceRows.length > 0 &&
    sourceRows.every((row) => supersededSources.has(row.sourceId));
}
