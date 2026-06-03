import { buildWorkbenchStatus } from "./status.ts";
import { classifyReleaseReadiness, type ReleaseReadiness } from "./release_readiness.ts";
import type { Workbench } from "./workbench.ts";

export interface ReleaseArtifactProblem {
  sourceId: string;
  endpointId: string;
  artifactKind: string;
  message: string;
}

export interface ReleaseEntityProvenanceProblem {
  entityId: string;
  candidateId: string;
  message: string;
}

export interface ReleaseRelationshipProvenanceProblem {
  relationshipId: string;
  fromEntityId: string;
  relationshipType: string;
  toEntityId: string;
  message: string;
}

export interface ReleaseDatasetProvenanceProblem {
  datasetId: string;
  message: string;
}

export interface ReleaseLegalRefProvenanceProblem {
  legalRefId: string;
  message: string;
}

export interface ReleaseEntityLegalRefProvenanceProblem {
  attachmentId: string;
  entityId: string;
  legalRefId: string;
  message: string;
}

export interface ReleaseRelationshipLegalRefProvenanceProblem {
  attachmentId: string;
  relationshipId: string;
  legalRefId: string;
  message: string;
}

export interface ReleaseVerificationResult {
  ready: boolean;
  readiness: ReleaseReadiness;
  reasons: string[];
  sourceArtifactProblems: ReleaseArtifactProblem[];
  entityProvenanceCheckedCount: number;
  entityProvenanceProblems: ReleaseEntityProvenanceProblem[];
  relationshipProvenanceCheckedCount: number;
  relationshipProvenanceProblems: ReleaseRelationshipProvenanceProblem[];
  datasetProvenanceCheckedCount: number;
  datasetProvenanceProblems: ReleaseDatasetProvenanceProblem[];
  legalRefProvenanceCheckedCount: number;
  legalRefProvenanceProblems: ReleaseLegalRefProvenanceProblem[];
  entityLegalRefProvenanceCheckedCount: number;
  entityLegalRefProvenanceProblems: ReleaseEntityLegalRefProvenanceProblem[];
  relationshipLegalRefProvenanceCheckedCount: number;
  relationshipLegalRefProvenanceProblems: ReleaseRelationshipLegalRefProvenanceProblem[];
  nextCommand: string;
  unresolvedStateNote: string;
}

interface ReleaseRelationshipProvenanceCheck {
  checkedCount: number;
  problems: ReleaseRelationshipProvenanceProblem[];
}

interface ReleaseEntityProvenanceCheck {
  checkedCount: number;
  problems: ReleaseEntityProvenanceProblem[];
}

interface ReleaseDatasetProvenanceCheck {
  checkedCount: number;
  problems: ReleaseDatasetProvenanceProblem[];
}

interface ReleaseLegalRefProvenanceCheck {
  checkedCount: number;
  problems: ReleaseLegalRefProvenanceProblem[];
}

interface ReleaseEntityLegalRefProvenanceCheck {
  checkedCount: number;
  problems: ReleaseEntityLegalRefProvenanceProblem[];
}

interface ReleaseRelationshipLegalRefProvenanceCheck {
  checkedCount: number;
  problems: ReleaseRelationshipLegalRefProvenanceProblem[];
}

export function verifyWorkbenchRelease(workbench: Workbench): ReleaseVerificationResult {
  const status = buildWorkbenchStatus(workbench);
  const sourceArtifactProblems = validateSourceArtifacts(workbench.sourceArtifacts());
  const entityProvenance = validateEntityProvenance(workbench);
  const entityProvenanceProblems = entityProvenance.problems;
  const relationshipProvenance = validateRelationshipProvenance(workbench);
  const relationshipProvenanceProblems = relationshipProvenance.problems;
  const datasetProvenance = validateDatasetProvenance(workbench);
  const datasetProvenanceProblems = datasetProvenance.problems;
  const legalRefProvenance = validateLegalRefProvenance(workbench);
  const legalRefProvenanceProblems = legalRefProvenance.problems;
  const entityLegalRefProvenance = validateEntityLegalRefProvenance(workbench);
  const entityLegalRefProvenanceProblems = entityLegalRefProvenance.problems;
  const relationshipLegalRefProvenance = validateRelationshipLegalRefProvenance(workbench);
  const relationshipLegalRefProvenanceProblems = relationshipLegalRefProvenance.problems;
  const reasons: string[] = [];
  if (status.sources.fetched === 0) reasons.push("no sources fetched");
  if (status.sources.failed > 0) reasons.push(`failed sources: ${status.sources.failed}`);
  if (status.review.open > 0) reasons.push(`open review items: ${status.review.open}`);
  if (status.review.deferred > 0) reasons.push(`deferred review items: ${status.review.deferred}`);
  if (status.staleReview.count > 0) reasons.push(`stale review items: ${status.staleReview.count}`);
  if (status.reconciliation.blocked > 0) {
    reasons.push(`blocked reconciliation items: ${status.reconciliation.blocked}`);
  }
  if (status.placeholders.count > 0) {
    reasons.push(`placeholder entities: ${status.placeholders.count}`);
  }
  if (sourceArtifactProblems.length > 0) {
    reasons.push(
      `source artifact provenance: ${sourceArtifactProblems.length} problem${
        sourceArtifactProblems.length === 1 ? "" : "s"
      }`,
    );
  }
  if (entityProvenanceProblems.length > 0) {
    reasons.push(
      `entity row provenance: ${entityProvenanceProblems.length} problem${
        entityProvenanceProblems.length === 1 ? "" : "s"
      }`,
    );
  }
  if (relationshipProvenanceProblems.length > 0) {
    reasons.push(
      `relationship row provenance: ${relationshipProvenanceProblems.length} problem${
        relationshipProvenanceProblems.length === 1 ? "" : "s"
      }`,
    );
  }
  if (datasetProvenanceProblems.length > 0) {
    reasons.push(
      `dataset row provenance: ${datasetProvenanceProblems.length} problem${
        datasetProvenanceProblems.length === 1 ? "" : "s"
      }`,
    );
  }
  if (legalRefProvenanceProblems.length > 0) {
    reasons.push(
      `legal ref row provenance: ${legalRefProvenanceProblems.length} problem${
        legalRefProvenanceProblems.length === 1 ? "" : "s"
      }`,
    );
  }
  if (entityLegalRefProvenanceProblems.length > 0) {
    reasons.push(
      `entity legal ref row provenance: ${entityLegalRefProvenanceProblems.length} problem${
        entityLegalRefProvenanceProblems.length === 1 ? "" : "s"
      }`,
    );
  }
  if (relationshipLegalRefProvenanceProblems.length > 0) {
    reasons.push(
      `relationship legal ref row provenance: ${relationshipLegalRefProvenanceProblems.length} problem${
        relationshipLegalRefProvenanceProblems.length === 1 ? "" : "s"
      }`,
    );
  }
  return {
    ready: reasons.length === 0,
    readiness: classifyReleaseReadiness({
      sourceCount: status.sources.fetched,
      failedSourceCount: status.sources.failed,
      openReviewItemCount: status.review.open,
      deferredReviewItemCount: status.review.deferred,
      staleReviewItemCount: status.staleReview.count,
      blockedReconciliationCount: status.reconciliation.blocked,
      placeholderEntityCount: status.placeholders.count,
      blockingProblemCount: sourceArtifactProblems.length +
        entityProvenanceProblems.length +
        relationshipProvenanceProblems.length +
        datasetProvenanceProblems.length +
        legalRefProvenanceProblems.length +
        entityLegalRefProvenanceProblems.length +
        relationshipLegalRefProvenanceProblems.length,
    }),
    reasons,
    sourceArtifactProblems,
    entityProvenanceCheckedCount: entityProvenance.checkedCount,
    entityProvenanceProblems,
    relationshipProvenanceCheckedCount: relationshipProvenance.checkedCount,
    relationshipProvenanceProblems,
    datasetProvenanceCheckedCount: datasetProvenance.checkedCount,
    datasetProvenanceProblems,
    legalRefProvenanceCheckedCount: legalRefProvenance.checkedCount,
    legalRefProvenanceProblems,
    entityLegalRefProvenanceCheckedCount: entityLegalRefProvenance.checkedCount,
    entityLegalRefProvenanceProblems,
    relationshipLegalRefProvenanceCheckedCount: relationshipLegalRefProvenance.checkedCount,
    relationshipLegalRefProvenanceProblems,
    nextCommand: status.nextCommand,
    unresolvedStateNote: status.unresolvedStateNote,
  };
}

export function renderReleaseVerification(result: ReleaseVerificationResult): string {
  const lines = [
    `Release verify: ${result.ready ? "ready" : "not ready"}`,
    `Readiness: ${result.readiness}`,
  ];
  if (result.reasons.length === 0) {
    lines.push("No blocking release issues found.");
  } else {
    lines.push("Reasons:");
    for (const reason of result.reasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (result.sourceArtifactProblems.length > 0) {
    const problems = result.sourceArtifactProblems.slice(0, 5);
    lines.push(
      `Source artifact problems${
        truncationNote(problems.length, result.sourceArtifactProblems.length)
      }:`,
    );
    for (const problem of problems) {
      lines.push(
        `- ${problem.sourceId} ${problem.endpointId} ${problem.artifactKind}: ${problem.message}`,
      );
    }
  }
  lines.push(
    `Entity rows checked: ${result.entityProvenanceCheckedCount} accepted entity row${
      result.entityProvenanceCheckedCount === 1 ? "" : "s"
    }.`,
  );
  lines.push(
    `Relationship rows checked: ${result.relationshipProvenanceCheckedCount} accepted relationship row${
      result.relationshipProvenanceCheckedCount === 1 ? "" : "s"
    }.`,
  );
  lines.push(
    `Dataset row provenance checked: ${result.datasetProvenanceCheckedCount} dataset row${
      result.datasetProvenanceCheckedCount === 1 ? "" : "s"
    }.`,
  );
  lines.push(
    `Legal ref row provenance checked: ${result.legalRefProvenanceCheckedCount} legal ref row${
      result.legalRefProvenanceCheckedCount === 1 ? "" : "s"
    }.`,
  );
  lines.push(
    `Entity legal ref row provenance checked: ${result.entityLegalRefProvenanceCheckedCount} attachment row${
      result.entityLegalRefProvenanceCheckedCount === 1 ? "" : "s"
    }.`,
  );
  lines.push(
    `Relationship legal ref row provenance checked: ${result.relationshipLegalRefProvenanceCheckedCount} attachment row${
      result.relationshipLegalRefProvenanceCheckedCount === 1 ? "" : "s"
    }.`,
  );
  if (result.entityProvenanceProblems.length > 0) {
    const problems = result.entityProvenanceProblems.slice(0, 5);
    lines.push(
      `Entity row provenance problems${
        truncationNote(problems.length, result.entityProvenanceProblems.length)
      }:`,
    );
    for (const problem of problems) {
      lines.push(
        `- ${problem.entityId} ${problem.candidateId}: ${problem.message}`,
      );
    }
  }
  if (result.relationshipProvenanceProblems.length > 0) {
    const problems = result.relationshipProvenanceProblems.slice(0, 5);
    lines.push(
      `Relationship row provenance problems${
        truncationNote(problems.length, result.relationshipProvenanceProblems.length)
      }:`,
    );
    for (const problem of problems) {
      lines.push(
        `- ${problem.relationshipId}: ${problem.message}`,
      );
    }
  }
  if (result.datasetProvenanceProblems.length > 0) {
    const problems = result.datasetProvenanceProblems.slice(0, 5);
    lines.push(
      `Dataset row provenance problems${
        truncationNote(problems.length, result.datasetProvenanceProblems.length)
      }:`,
    );
    for (const problem of problems) {
      lines.push(`- ${problem.datasetId}: ${problem.message}`);
    }
  }
  if (result.legalRefProvenanceProblems.length > 0) {
    const problems = result.legalRefProvenanceProblems.slice(0, 5);
    lines.push(
      `Legal ref row provenance problems${
        truncationNote(problems.length, result.legalRefProvenanceProblems.length)
      }:`,
    );
    for (const problem of problems) {
      lines.push(`- ${problem.legalRefId}: ${problem.message}`);
    }
  }
  if (result.entityLegalRefProvenanceProblems.length > 0) {
    const problems = result.entityLegalRefProvenanceProblems.slice(0, 5);
    lines.push(
      `Entity legal ref row provenance problems${
        truncationNote(problems.length, result.entityLegalRefProvenanceProblems.length)
      }:`,
    );
    for (const problem of problems) {
      lines.push(
        `- ${problem.attachmentId}: ${problem.entityId} ${problem.legalRefId}: ${problem.message}`,
      );
    }
  }
  if (result.relationshipLegalRefProvenanceProblems.length > 0) {
    const problems = result.relationshipLegalRefProvenanceProblems.slice(0, 5);
    lines.push(
      `Relationship legal ref row provenance problems${
        truncationNote(problems.length, result.relationshipLegalRefProvenanceProblems.length)
      }:`,
    );
    for (const problem of problems) {
      lines.push(
        `- ${problem.attachmentId}: ${problem.relationshipId} ${problem.legalRefId}: ${problem.message}`,
      );
    }
  }
  lines.push(`Readiness note: ${result.unresolvedStateNote}`);
  lines.push(`Next: ${result.nextCommand}`);
  return lines.join("\n");
}

function truncationNote(shownCount: number, totalCount: number): string {
  return totalCount > shownCount ? ` (showing first ${shownCount} of ${totalCount})` : "";
}

function validateSourceArtifacts(
  artifacts: Array<{
    source_id: string;
    endpoint_id: string;
    artifact_kind: string;
    fetched_url: string;
    content_hash: string;
    size_bytes: number;
    observed_at: string;
  }>,
): ReleaseArtifactProblem[] {
  const problems: ReleaseArtifactProblem[] = [];
  for (const artifact of artifacts) {
    if (!artifact.source_id) {
      problems.push(problemForArtifact(artifact, "missing source_id"));
    }
    if (!artifact.endpoint_id) {
      problems.push(problemForArtifact(artifact, "missing endpoint_id"));
    }
    if (!artifact.artifact_kind) {
      problems.push(problemForArtifact(artifact, "missing artifact_kind"));
    }
    if (!artifact.content_hash) {
      problems.push(problemForArtifact(artifact, "missing content_hash"));
    }
    if (!artifact.observed_at) {
      problems.push(problemForArtifact(artifact, "missing observed_at"));
    }
    if (!Number.isFinite(artifact.size_bytes) || artifact.size_bytes < 0) {
      problems.push(problemForArtifact(artifact, "size_bytes must be a non-negative integer"));
    }
    if (!isPublicHttpUrl(artifact.fetched_url)) {
      problems.push(problemForArtifact(artifact, "fetched_url is not a public http/https URL"));
    }
  }
  return problems;
}

function problemForArtifact(
  artifact: { source_id: string; endpoint_id: string; artifact_kind: string },
  message: string,
): ReleaseArtifactProblem {
  return {
    sourceId: artifact.source_id || "unknown",
    endpointId: artifact.endpoint_id || "unknown",
    artifactKind: artifact.artifact_kind || "unknown",
    message,
  };
}

function validateEntityProvenance(workbench: Workbench): ReleaseEntityProvenanceCheck {
  const entities = workbench.db.prepare(
    `select entity_id as entityId,
            name,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where review_status = 'accepted'
     order by entity_id`,
  ).all() as Array<{
    entityId: string;
    name: string;
    officialUrl?: string | null;
    mergedCandidateIds: string;
  }>;
  const problems: ReleaseEntityProvenanceProblem[] = [];

  for (const entity of entities) {
    const addProblem = (candidateId: string, message: string) => {
      problems.push({
        entityId: entity.entityId,
        candidateId,
        message,
      });
    };
    if (!entity.name) addProblem("unknown", "missing entity label");
    if (entity.officialUrl && !isPublicHttpUrl(entity.officialUrl)) {
      addProblem("unknown", "official_url is not a public http/https URL");
    }

    const candidateIds = parseStringArray(entity.mergedCandidateIds);
    if (!candidateIds) {
      addProblem("unknown", "merged_candidate_ids is not a JSON string array");
      continue;
    }
    if (candidateIds.length === 0) {
      addProblem("unknown", "missing accepted entity candidate reference");
      continue;
    }

    for (const candidateId of candidateIds) {
      const candidate = workbench.db.prepare(
        `select entity_candidates.candidate_id as candidateId,
                entity_candidates.source_item_id as sourceItemId,
                entity_candidates.review_status as reviewStatus,
                source_items.source_item_id as resolvedSourceItemId,
                sources.base_url as sourceBaseUrl
         from entity_candidates
         left join source_items
           on source_items.source_item_id = entity_candidates.source_item_id
         left join sources
           on sources.source_id = source_items.source_id
         where entity_candidates.candidate_id = ?`,
      ).get(candidateId) as {
        candidateId: string;
        sourceItemId: string;
        reviewStatus: string;
        resolvedSourceItemId?: string | null;
        sourceBaseUrl?: string | null;
      } | undefined;
      if (!candidate) {
        addProblem(
          candidateId,
          "merged_candidate_ids entry does not resolve to an entity candidate",
        );
        continue;
      }
      if (candidate.reviewStatus !== "accepted") {
        addProblem(candidateId, "entity candidate row is not accepted");
      }
      if (!candidate.resolvedSourceItemId) {
        addProblem(candidateId, "candidate source_item_id does not resolve to a source item");
      }
      if (candidate.sourceBaseUrl && !isPublicHttpUrl(candidate.sourceBaseUrl)) {
        addProblem(candidateId, "source base_url is not a public http/https URL");
      }

      const evidenceRows = sourceBackedEvidenceRows(
        workbench,
        "entity_candidate_evidence",
        "candidate_id",
        candidateId,
      );
      validateSourceBackedEvidenceRows(
        evidenceRows,
        candidate.sourceItemId,
        "entity candidate source_item_id",
        "missing entity candidate evidence",
        (message) => addProblem(candidateId, message),
      );
    }
  }

  return { checkedCount: entities.length, problems };
}

function validateRelationshipProvenance(
  workbench: Workbench,
): ReleaseRelationshipProvenanceCheck {
  const relationships = workbench.db.prepare(
    `select canonical_relationships.relationship_id as relationshipId,
            canonical_relationships.from_entity_id as fromEntityId,
            canonical_relationships.relationship_type as relationshipType,
            canonical_relationships.to_entity_id as toEntityId,
            canonical_relationships.source_event_id as sourceEventId,
            from_entities.name as fromEntityName,
            to_entities.name as toEntityName,
            resolution_events.event_type as eventType,
            resolution_events.subject_id as subjectId,
            resolution_events.payload_json as payloadJson,
            relationship_candidates.relationship_candidate_id as candidateId,
            relationship_candidates.source_item_id as candidateSourceItemId,
            relationship_candidates.from_entity_ref as candidateFromEntityId,
            relationship_candidates.relationship_type as candidateRelationshipType,
            relationship_candidates.to_entity_ref as candidateToEntityId
     from canonical_relationships
     left join canonical_entities as from_entities
       on from_entities.entity_id = canonical_relationships.from_entity_id
     left join canonical_entities as to_entities
       on to_entities.entity_id = canonical_relationships.to_entity_id
     left join resolution_events
       on resolution_events.event_id = canonical_relationships.source_event_id
     left join relationship_candidates
       on relationship_candidates.relationship_candidate_id = resolution_events.subject_id
     where canonical_relationships.review_status = 'accepted'
     order by canonical_relationships.relationship_id`,
  ).all() as Array<{
    relationshipId: string;
    fromEntityId: string;
    relationshipType: string;
    toEntityId: string;
    sourceEventId: string;
    fromEntityName?: string | null;
    toEntityName?: string | null;
    eventType?: string | null;
    subjectId?: string | null;
    payloadJson?: string | null;
    candidateId?: string | null;
    candidateSourceItemId?: string | null;
    candidateFromEntityId?: string | null;
    candidateRelationshipType?: string | null;
    candidateToEntityId?: string | null;
  }>;
  const problems: ReleaseRelationshipProvenanceProblem[] = [];

  for (const relationship of relationships) {
    const addProblem = (message: string) => {
      problems.push({
        relationshipId: relationship.relationshipId,
        fromEntityId: relationship.fromEntityId,
        relationshipType: relationship.relationshipType,
        toEntityId: relationship.toEntityId,
        message,
      });
    };
    if (!relationship.fromEntityName) addProblem("missing from_entity label");
    if (!relationship.toEntityName) addProblem("missing to_entity label");
    if (!relationship.eventType) {
      addProblem("source_event_id does not resolve to a resolution event");
      continue;
    }
    if (relationship.eventType !== "accept_relationship_candidate") {
      addProblem("source_event_id is not an accept_relationship_candidate event");
      continue;
    }
    if (!relationship.subjectId) {
      addProblem("resolution event is missing subject_id");
      continue;
    }
    if (!relationship.candidateId) {
      addProblem("resolution event subject_id does not resolve to a relationship candidate");
      continue;
    }
    const payload = parseJsonObject(relationship.payloadJson);
    const expectedFromEntityId = payloadString(
      payload,
      "resolved_from_entity_id",
      "resolvedFromEntityId",
      "fromEntityId",
    ) ?? relationship.candidateFromEntityId;
    const expectedRelationshipType = payloadString(
      payload,
      "resolved_relationship_type",
      "resolvedRelationshipType",
      "relationshipType",
    ) ?? relationship.candidateRelationshipType;
    const expectedToEntityId = payloadString(
      payload,
      "resolved_to_entity_id",
      "resolvedToEntityId",
      "toEntityId",
    ) ?? relationship.candidateToEntityId;
    if (!expectedFromEntityId || !expectedRelationshipType || !expectedToEntityId) {
      addProblem("accepted relationship decision is missing resolved endpoint/type fields");
      continue;
    }
    const expectedRelationshipId =
      `${expectedFromEntityId}:${expectedRelationshipType}:${expectedToEntityId}`;
    if (
      relationship.relationshipId !== expectedRelationshipId ||
      relationship.fromEntityId !== expectedFromEntityId ||
      relationship.relationshipType !== expectedRelationshipType ||
      relationship.toEntityId !== expectedToEntityId
    ) {
      addProblem(
        `canonical row does not match accepted relationship decision ${expectedRelationshipId}`,
      );
    }

    const evidenceRows = workbench.db.prepare(
      `select relationship_candidate_evidence.evidence_id as evidenceId,
              relationship_candidate_evidence.field_path as fieldPath,
              relationship_candidate_evidence.artifact_path as artifactPath,
              relationship_candidate_evidence.source_id as evidenceSourceId,
              relationship_candidate_evidence.source_item_id as evidenceSourceItemId,
              source_items.source_id as sourceItemSourceId,
              source_runs.source_id as artifactRunSourceId,
              source_artifacts.fetched_url as fetchedUrl,
              source_artifacts.content_hash as contentHash
       from relationship_candidate_evidence
       left join source_items
         on source_items.source_item_id = relationship_candidate_evidence.source_item_id
       left join source_artifacts
         on source_artifacts.run_id = source_items.run_id
        and source_artifacts.path = relationship_candidate_evidence.artifact_path
       left join source_runs
         on source_runs.run_id = source_artifacts.run_id
       where relationship_candidate_evidence.relationship_candidate_id = ?
       order by relationship_candidate_evidence.evidence_id`,
    ).all(relationship.subjectId) as SourceBackedEvidenceRow[];
    validateSourceBackedEvidenceRows(
      evidenceRows,
      relationship.candidateSourceItemId ?? "",
      "relationship candidate",
      "missing relationship candidate evidence",
      addProblem,
    );
  }

  return { checkedCount: relationships.length, problems };
}

function validateDatasetProvenance(workbench: Workbench): ReleaseDatasetProvenanceCheck {
  const datasets = workbench.db.prepare(
    `select datasets.dataset_id as datasetId,
            datasets.source_item_id as sourceItemId,
            datasets.official_url as officialUrl,
            source_items.source_id as sourceItemSourceId,
            sources.base_url as sourceBaseUrl
     from datasets
     left join source_items
       on source_items.source_item_id = datasets.source_item_id
     left join sources
       on sources.source_id = source_items.source_id
     order by datasets.dataset_id`,
  ).all() as Array<{
    datasetId: string;
    sourceItemId: string;
    officialUrl?: string | null;
    sourceItemSourceId?: string | null;
    sourceBaseUrl?: string | null;
  }>;
  const problems: ReleaseDatasetProvenanceProblem[] = [];
  for (const dataset of datasets) {
    const addProblem = (message: string) => {
      problems.push({ datasetId: dataset.datasetId, message });
    };
    if (!dataset.sourceItemSourceId) addProblem("source_item_id does not resolve to a source item");
    if (dataset.sourceBaseUrl && !isPublicHttpUrl(dataset.sourceBaseUrl)) {
      addProblem("source base_url is not a public http/https URL");
    }
    if (dataset.officialUrl && !isPublicHttpUrl(dataset.officialUrl)) {
      addProblem("official_url is not a public http/https URL");
    }
    const evidenceRows = sourceBackedEvidenceRows(
      workbench,
      "dataset_evidence",
      "dataset_id",
      dataset.datasetId,
    );
    validateSourceBackedEvidenceRows(
      evidenceRows,
      dataset.sourceItemId,
      "row source_item_id",
      "missing dataset evidence",
      addProblem,
    );
  }
  return { checkedCount: datasets.length, problems };
}

function validateLegalRefProvenance(workbench: Workbench): ReleaseLegalRefProvenanceCheck {
  const legalRefs = workbench.db.prepare(
    `select legal_refs.legal_ref_id as legalRefId,
            legal_refs.source_item_id as sourceItemId,
            legal_refs.url as url,
            source_items.source_id as sourceItemSourceId,
            sources.base_url as sourceBaseUrl
     from legal_refs
     left join source_items
       on source_items.source_item_id = legal_refs.source_item_id
     left join sources
       on sources.source_id = source_items.source_id
     order by legal_refs.legal_ref_id`,
  ).all() as Array<{
    legalRefId: string;
    sourceItemId: string;
    url?: string | null;
    sourceItemSourceId?: string | null;
    sourceBaseUrl?: string | null;
  }>;
  const problems: ReleaseLegalRefProvenanceProblem[] = [];
  for (const legalRef of legalRefs) {
    const addProblem = (message: string) => {
      problems.push({ legalRefId: legalRef.legalRefId, message });
    };
    if (!legalRef.sourceItemSourceId) {
      addProblem("source_item_id does not resolve to a source item");
    }
    if (legalRef.sourceBaseUrl && !isPublicHttpUrl(legalRef.sourceBaseUrl)) {
      addProblem("source base_url is not a public http/https URL");
    }
    if (legalRef.url && !isPublicHttpUrl(legalRef.url)) {
      addProblem("url is not a public http/https URL");
    }
    const evidenceRows = sourceBackedEvidenceRows(
      workbench,
      "legal_ref_evidence",
      "legal_ref_id",
      legalRef.legalRefId,
    );
    validateSourceBackedEvidenceRows(
      evidenceRows,
      legalRef.sourceItemId,
      "row source_item_id",
      "missing legal ref evidence",
      addProblem,
    );
  }
  return { checkedCount: legalRefs.length, problems };
}

function validateEntityLegalRefProvenance(
  workbench: Workbench,
): ReleaseEntityLegalRefProvenanceCheck {
  const attachments = workbench.db.prepare(
    `select entity_legal_refs.entity_legal_ref_id as attachmentId,
            entity_legal_refs.entity_id as entityId,
            entity_legal_refs.legal_ref_id as legalRefId,
            canonical_entities.entity_id as resolvedEntityId,
            canonical_entities.name as entityName,
            canonical_entities.review_status as entityReviewStatus,
            legal_refs.legal_ref_id as resolvedLegalRefId
     from entity_legal_refs
     left join canonical_entities
       on canonical_entities.entity_id = entity_legal_refs.entity_id
     left join legal_refs
       on legal_refs.legal_ref_id = entity_legal_refs.legal_ref_id
     order by entity_legal_refs.entity_legal_ref_id`,
  ).all() as Array<{
    attachmentId: string;
    entityId: string;
    legalRefId: string;
    resolvedEntityId?: string | null;
    entityName?: string | null;
    entityReviewStatus?: string | null;
    resolvedLegalRefId?: string | null;
  }>;
  const problems: ReleaseEntityLegalRefProvenanceProblem[] = [];
  for (const attachment of attachments) {
    const addProblem = (message: string) => {
      problems.push({
        attachmentId: attachment.attachmentId,
        entityId: attachment.entityId,
        legalRefId: attachment.legalRefId,
        message,
      });
    };
    if (!attachment.resolvedEntityId) {
      addProblem("entity_id does not resolve to a canonical entity");
    } else {
      if (!attachment.entityName) addProblem("missing entity label");
      if (attachment.entityReviewStatus !== "accepted") addProblem("entity row is not accepted");
    }
    if (!attachment.resolvedLegalRefId) addProblem("legal_ref_id does not resolve to a legal ref");
  }
  return { checkedCount: attachments.length, problems };
}

function validateRelationshipLegalRefProvenance(
  workbench: Workbench,
): ReleaseRelationshipLegalRefProvenanceCheck {
  const attachments = workbench.db.prepare(
    `select relationship_legal_refs.relationship_legal_ref_id as attachmentId,
            relationship_legal_refs.relationship_id as relationshipId,
            relationship_legal_refs.legal_ref_id as legalRefId,
            canonical_relationships.relationship_id as resolvedRelationshipId,
            canonical_relationships.from_entity_id as fromEntityId,
            canonical_relationships.relationship_type as relationshipType,
            canonical_relationships.to_entity_id as toEntityId,
            canonical_relationships.review_status as relationshipReviewStatus,
            from_entities.name as fromEntityName,
            to_entities.name as toEntityName,
            legal_refs.legal_ref_id as resolvedLegalRefId
     from relationship_legal_refs
     left join canonical_relationships
       on canonical_relationships.relationship_id = relationship_legal_refs.relationship_id
     left join canonical_entities as from_entities
       on from_entities.entity_id = canonical_relationships.from_entity_id
     left join canonical_entities as to_entities
       on to_entities.entity_id = canonical_relationships.to_entity_id
     left join legal_refs
       on legal_refs.legal_ref_id = relationship_legal_refs.legal_ref_id
     order by relationship_legal_refs.relationship_legal_ref_id`,
  ).all() as Array<{
    attachmentId: string;
    relationshipId: string;
    legalRefId: string;
    resolvedRelationshipId?: string | null;
    fromEntityId?: string | null;
    relationshipType?: string | null;
    toEntityId?: string | null;
    relationshipReviewStatus?: string | null;
    fromEntityName?: string | null;
    toEntityName?: string | null;
    resolvedLegalRefId?: string | null;
  }>;
  const problems: ReleaseRelationshipLegalRefProvenanceProblem[] = [];
  for (const attachment of attachments) {
    const addProblem = (message: string) => {
      problems.push({
        attachmentId: attachment.attachmentId,
        relationshipId: attachment.relationshipId,
        legalRefId: attachment.legalRefId,
        message,
      });
    };
    if (!attachment.resolvedRelationshipId) {
      addProblem("relationship_id does not resolve to a canonical relationship");
    } else {
      if (attachment.relationshipReviewStatus !== "accepted") {
        addProblem("relationship row is not accepted");
      }
      if (!attachment.fromEntityName) addProblem("missing from_entity label");
      if (!attachment.toEntityName) addProblem("missing to_entity label");
      const expectedRelationshipId =
        `${attachment.fromEntityId}:${attachment.relationshipType}:${attachment.toEntityId}`;
      if (attachment.relationshipId !== expectedRelationshipId) {
        addProblem(
          `relationship_id does not match canonical relationship fields ${expectedRelationshipId}`,
        );
      }
    }
    if (!attachment.resolvedLegalRefId) addProblem("legal_ref_id does not resolve to a legal ref");
  }
  return { checkedCount: attachments.length, problems };
}

interface SourceBackedEvidenceRow {
  evidenceId: string;
  fieldPath: string;
  artifactPath: string;
  evidenceSourceId: string;
  evidenceSourceItemId: string;
  sourceItemSourceId?: string | null;
  artifactRunSourceId?: string | null;
  fetchedUrl?: string | null;
  contentHash?: string | null;
}

function sourceBackedEvidenceRows(
  workbench: Workbench,
  evidenceTable: "entity_candidate_evidence" | "dataset_evidence" | "legal_ref_evidence",
  rowIdColumn: "candidate_id" | "dataset_id" | "legal_ref_id",
  rowId: string,
): SourceBackedEvidenceRow[] {
  return workbench.db.prepare(
    `select ${evidenceTable}.evidence_id as evidenceId,
            ${evidenceTable}.field_path as fieldPath,
            ${evidenceTable}.artifact_path as artifactPath,
            ${evidenceTable}.source_id as evidenceSourceId,
            ${evidenceTable}.source_item_id as evidenceSourceItemId,
            source_items.source_id as sourceItemSourceId,
            source_runs.source_id as artifactRunSourceId,
            source_artifacts.fetched_url as fetchedUrl,
            source_artifacts.content_hash as contentHash
     from ${evidenceTable}
     left join source_items
       on source_items.source_item_id = ${evidenceTable}.source_item_id
     left join source_artifacts
       on source_artifacts.run_id = source_items.run_id
      and source_artifacts.path = ${evidenceTable}.artifact_path
     left join source_runs
       on source_runs.run_id = source_artifacts.run_id
     where ${evidenceTable}.${rowIdColumn} = ?
     order by ${evidenceTable}.evidence_id`,
  ).all(rowId) as SourceBackedEvidenceRow[];
}

function validateSourceBackedEvidenceRows(
  evidenceRows: SourceBackedEvidenceRow[],
  rowSourceItemId: string,
  rowSourceItemLabel: string,
  missingEvidenceMessage: string,
  addProblem: (message: string) => void,
): void {
  if (evidenceRows.length === 0) {
    addProblem(missingEvidenceMessage);
    return;
  }
  for (const evidence of evidenceRows) {
    const evidenceLabel = `${evidence.evidenceId} ${evidence.fieldPath}`;
    if (evidence.evidenceSourceItemId !== rowSourceItemId) {
      addProblem(`${evidenceLabel}: evidence source_item_id does not match ${rowSourceItemLabel}`);
    }
    if (!evidence.sourceItemSourceId) {
      addProblem(`${evidenceLabel}: evidence source_item_id does not resolve to a source item`);
    } else if (evidence.sourceItemSourceId !== evidence.evidenceSourceId) {
      addProblem(`${evidenceLabel}: evidence source_id does not match source item`);
    }
    if (!evidence.fetchedUrl) {
      addProblem(`${evidenceLabel}: evidence artifact_path does not resolve to a source artifact`);
      continue;
    }
    if (
      evidence.artifactRunSourceId && evidence.artifactRunSourceId !== evidence.evidenceSourceId
    ) {
      addProblem(`${evidenceLabel}: evidence artifact source does not match evidence source`);
    }
    if (!isPublicHttpUrl(evidence.fetchedUrl)) {
      addProblem(`${evidenceLabel}: fetched_url is not a public http/https URL`);
    }
    if (!evidence.contentHash) {
      addProblem(`${evidenceLabel}: missing source artifact content_hash`);
    }
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: string | null | undefined): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function payloadString(payload: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function isPublicHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = repeatedlyDecodeURIComponent(value).replaceAll("\\", "/");
  if (/^[a-z]:\//i.test(normalized) || normalized.startsWith("/") || /\bfile:/i.test(normalized)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      isPublicHostname(url.hostname);
  } catch {
    return false;
  }
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return false;
  }
  if (host.endsWith(".internal") || (!host.includes(".") && !host.includes(":"))) {
    return false;
  }
  if (isPrivateIpv4Host(host)) return false;
  if (isPrivateIpv6Host(host)) return false;
  return true;
}

function isPrivateIpv4Host(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

function isPrivateIpv6Host(host: string): boolean {
  if (!host.includes(":")) return false;
  return host === "::" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host.startsWith("::ffff:") ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd");
}

function repeatedlyDecodeURIComponent(value: string): string {
  let decoded = value;
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}
