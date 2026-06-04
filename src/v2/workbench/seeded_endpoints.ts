import {
  buildCandidateId,
  buildEntityId,
  buildReviewItemId,
  detectEntityKind,
  type EntityCandidateInput,
  normalizeName,
  type ParsedEndpointOutput,
  type RelationshipCandidateInput,
  type ReviewItemInput,
} from "../domain.ts";
import {
  buildKnownEntityRef,
  defaultActionForCouncilOversightTarget,
  extractScopedCouncilOversightBaseName,
  isScopedCouncilOversightTarget,
} from "../connectors/shared.ts";
import { queryOne } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

export function augmentParsedOutputWithRelationshipEndpointCandidates(
  store: Pick<WorkbenchStore, "db">,
  sourceId: string,
  parsed: ParsedEndpointOutput,
): ParsedEndpointOutput {
  const seededCandidates = buildSeededRelationshipEndpointCandidates(
    store,
    sourceId,
    parsed.relationshipCandidates ?? [],
    parsed.entityCandidates ?? [],
  );
  if (seededCandidates.length === 0) return parsed;
  return {
    ...parsed,
    entityCandidates: [...(parsed.entityCandidates ?? []), ...seededCandidates],
    reviewItems: [
      ...(parsed.reviewItems ?? []),
      ...seededCandidates.map((candidate) => seededRelationshipEndpointReviewItem(candidate)),
    ],
  };
}

function buildSeededRelationshipEndpointCandidates(
  store: Pick<WorkbenchStore, "db">,
  sourceId: string,
  relationshipCandidates: RelationshipCandidateInput[],
  entityCandidates: EntityCandidateInput[],
): EntityCandidateInput[] {
  const existingEntityIds = new Set(
    entityCandidates.map((candidate) => candidate.proposedEntityId),
  );
  const seededCandidates: EntityCandidateInput[] = [];
  for (const relationshipCandidate of relationshipCandidates) {
    for (
      const seededCandidate of seededRelationshipEndpointCandidatesForRelationship(
        sourceId,
        relationshipCandidate,
      )
    ) {
      if (existingEntityIds.has(seededCandidate.proposedEntityId)) continue;
      if (endpointAlreadyKnown(store, seededCandidate.proposedEntityId)) continue;
      seededCandidates.push(seededCandidate);
      existingEntityIds.add(seededCandidate.proposedEntityId);
    }
  }
  return seededCandidates;
}

function seededRelationshipEndpointCandidatesForRelationship(
  sourceId: string,
  relationshipCandidate: RelationshipCandidateInput,
): EntityCandidateInput[] {
  const observedName = normalizeName(relationshipCandidate.rawValue ?? "");
  if (!observedName || !isSeedableEndpointName(observedName)) return [];
  const candidates: EntityCandidateInput[] = [];
  if (
    !relationshipCandidate.toEntityRef.startsWith("legal.") &&
    buildEntityId(observedName) === relationshipCandidate.toEntityRef
  ) {
    candidates.push(
      buildSeededRelationshipEndpointCandidate(
        sourceId,
        relationshipCandidate,
        observedName,
        relationshipCandidate.toEntityRef,
        "to-endpoint",
      ),
    );
  }
  const seedableFromName = seedableFromRelationshipEndpointName(
    sourceId,
    relationshipCandidate,
    observedName,
  );
  if (seedableFromName) {
    candidates.push(
      buildSeededRelationshipEndpointCandidate(
        sourceId,
        relationshipCandidate,
        seedableFromName,
        relationshipCandidate.fromEntityRef,
        "from-endpoint",
      ),
    );
  }
  return candidates;
}

function buildSeededRelationshipEndpointCandidate(
  sourceId: string,
  relationshipCandidate: RelationshipCandidateInput,
  observedName: string,
  proposedEntityId: string,
  suffix: string,
): EntityCandidateInput {
  return {
    candidateId: buildCandidateId(
      sourceId,
      `${relationshipCandidate.relationshipCandidateId}.${suffix}`,
    ),
    sourceItemKey: relationshipCandidate.sourceItemKey,
    proposedEntityId,
    name: observedName,
    kind: detectEntityKind(undefined, observedName),
    evidence: relationshipCandidate.evidence.map((evidence) => ({
      ...evidence,
      observedValue: observedName,
    })),
  };
}

function seedableFromRelationshipEndpointName(
  sourceId: string,
  relationshipCandidate: RelationshipCandidateInput,
  observedName: string,
): string | undefined {
  if (
    sourceId !== "council.committees" ||
    relationshipCandidate.relationshipType !== "overseen_by"
  ) {
    return undefined;
  }
  if (
    !isGroupedCommitteeOversightTarget(observedName)
  ) {
    if (buildEntityId(observedName) === relationshipCandidate.fromEntityRef) {
      return observedName;
    }
    if (
      defaultActionForCouncilOversightTarget(observedName) === "accept" &&
      buildKnownEntityRef(observedName) === relationshipCandidate.fromEntityRef
    ) {
      return observedName;
    }
  }
  const scopedBaseName = extractScopedCouncilOversightBaseName(observedName);
  if (
    scopedBaseName &&
    buildEntityId(scopedBaseName) === relationshipCandidate.fromEntityRef
  ) {
    return scopedBaseName;
  }
  return undefined;
}

function seededRelationshipEndpointReviewItem(
  candidate: EntityCandidateInput,
): ReviewItemInput {
  const safeToAutoAccept = isSafeToAutoAcceptSeededRelationshipEndpointCandidateId(
    candidate.candidateId,
  );
  return {
    reviewItemId: buildReviewItemId(candidate.candidateId, "seeded-endpoint"),
    itemType: "entity_candidate",
    subjectId: candidate.candidateId,
    reason: "Review entity candidate inferred from relationship endpoint text",
    defaultAction: "accept",
    details: {
      name: candidate.name,
      kind: candidate.kind,
      proposedEntityId: candidate.proposedEntityId,
      seededFrom: "relationship_endpoint",
      ...(safeToAutoAccept ? { safeToAutoAccept: true } : {}),
    },
  };
}

export function isSafeToAutoAcceptSeededRelationshipEndpointCandidateId(
  candidateId: string,
): boolean {
  return isSafeCouncilSeededEndpointCandidate(candidateId) ||
    isSafeDcgisGoverningEndpointCandidate(candidateId);
}

function isSafeCouncilSeededEndpointCandidate(candidateId: string): boolean {
  return candidateId.startsWith("candidate.council.committees.relationship_") &&
    candidateId.endsWith("_from_endpoint");
}

function isSafeDcgisGoverningEndpointCandidate(candidateId: string): boolean {
  return candidateId.startsWith("candidate.dcgis.boards_commissions_councils.relationship_") &&
    candidateId.endsWith("_to_endpoint");
}

function isSeedableEndpointName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized !== "other" &&
    normalized !== "unknown" &&
    normalized !== "n/a" &&
    normalized !== "na" &&
    normalized !== "none";
}

function isGroupedCommitteeOversightTarget(value: string): boolean {
  return isScopedCouncilOversightTarget(value);
}

function endpointAlreadyKnown(
  store: Pick<WorkbenchStore, "db">,
  entityId: string,
): boolean {
  return Boolean(queryOne<{ found: number }>(
    store.db,
    `select 1 as found
     from canonical_entities
     where entity_id = ?
     union all
     select 1 as found
     from entity_candidates
     where proposed_entity_id = ?
     limit 1`,
    [entityId, entityId],
  ));
}
