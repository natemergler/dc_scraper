import {
  buildCandidateId,
  buildEntityId,
  buildReviewItemId,
  type ConnectorResult,
  detectEntityKind,
  type EntityCandidateInput,
  type LegalRefInput,
  normalizeName,
  nowIso,
  type ParsedEndpointOutput,
  type RelationshipCandidateInput,
  type ReviewItemInput,
} from "../domain.ts";
import { autoAcceptSafeLegalRefs } from "./auto_accept_legal_refs.ts";
import { autoAcceptSafeRelationshipCandidates } from "./auto_accept_relationships.ts";
import { autoPromoteSafeEntityCandidates } from "./auto_promote.ts";
import { queryOne, run, withTransaction } from "./db.ts";
import { contentHash, makeId, requireItem, writeArtifact } from "./helpers.ts";
import { upsertEndpoint, upsertSource } from "./catalog.ts";
import { reconcileRelationshipCandidates } from "./reconciliation.ts";
import {
  buildEntityDecisionHint,
  buildLegalRefDecisionHint,
  buildRelationshipDecisionHint,
  reuseOrMarkStaleEntityDecisions,
  reuseOrMarkStaleLegalRefDecisions,
  reuseOrMarkStaleRelationshipDecisions,
} from "./replay.ts";
import type { WorkbenchStore } from "./store.ts";

interface ArtifactRecord {
  artifactId: string;
  artifactPath: string;
}

interface ParsedSourceItemRecord {
  sourceItemId: string;
  artifactIndex: number;
}

export async function importConnectorResult(
  store: WorkbenchStore,
  result: ConnectorResult,
  dataDir: string,
): Promise<void> {
  upsertSource(
    store,
    result.source.sourceId,
    result.source.title,
    result.source.kind,
    result.source.accessMethod,
    result.source.baseUrl,
    result.source.notes,
  );
  for (const endpointResult of result.endpointResults) {
    const parsed = endpointResult.parsed
      ? augmentParsedOutputWithRelationshipEndpointCandidates(
        store,
        endpointResult.endpoint.sourceId,
        endpointResult.parsed,
      )
      : undefined;
    upsertEndpoint(store, endpointResult.endpoint);
    const runId = makeId("run");
    const startedAt = nowIso();
    run(
      store.db,
      "insert into source_runs(run_id, source_id, endpoint_id, started_at, status) values(?, ?, ?, ?, ?)",
      [
        runId,
        endpointResult.endpoint.sourceId,
        endpointResult.endpoint.endpointId,
        startedAt,
        endpointResult.status,
      ],
    );
    const artifactRecords: ArtifactRecord[] = [];
    const entityDecisionHints = parsed?.entityCandidates
      ? await Promise.all(
        parsed.entityCandidates.map((candidate) =>
          buildEntityDecisionHint(endpointResult.endpoint.sourceId, candidate)
        ),
      )
      : [];
    const legalRefDecisionHints = parsed?.legalRefs
      ? await Promise.all(
        parsed.legalRefs.map((legalRef) =>
          buildLegalRefDecisionHint(endpointResult.endpoint.sourceId, legalRef)
        ),
      )
      : [];
    const relationshipDecisionHints = parsed?.relationshipCandidates
      ? await Promise.all(
        parsed.relationshipCandidates.map((candidate) =>
          buildRelationshipDecisionHint(endpointResult.endpoint.sourceId, candidate)
        ),
      )
      : [];
    try {
      for (const artifactInput of endpointResult.artifacts) {
        const artifactId = makeId("artifact");
        const relativePath = await writeArtifact(
          dataDir,
          endpointResult.endpoint.sourceId,
          endpointResult.endpoint.endpointId,
          artifactInput.extension,
          artifactInput.contentText,
        );
        run(
          store.db,
          "insert into source_artifacts(artifact_id, run_id, endpoint_id, kind, path, fetched_url, content_hash, size_bytes, created_at) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            artifactId,
            runId,
            endpointResult.endpoint.endpointId,
            artifactInput.kind,
            relativePath,
            artifactInput.fetchedUrl,
            await contentHash(artifactInput.contentText),
            new TextEncoder().encode(artifactInput.contentText).length,
            nowIso(),
          ],
        );
        artifactRecords.push({ artifactId, artifactPath: relativePath });
      }
      if (parsed) {
        withTransaction(store.db, () => {
          importParsedOutput(
            store,
            endpointResult.endpoint.sourceId,
            endpointResult.endpoint.endpointId,
            runId,
            artifactRecords,
            parsed,
          );
        });
        await reuseOrMarkStaleEntityDecisions(store, entityDecisionHints);
        await reuseOrMarkStaleLegalRefDecisions(store, legalRefDecisionHints);
        autoAcceptSafeLegalRefs(store);
        autoPromoteSafeEntityCandidates(store);
        reconcileRelationshipCandidates(store);
        await reuseOrMarkStaleRelationshipDecisions(store, relationshipDecisionHints);
        autoAcceptSafeRelationshipCandidates(store);
      }
      run(
        store.db,
        "update source_runs set finished_at = ?, status = ?, error_text = ? where run_id = ?",
        [nowIso(), endpointResult.status, endpointResult.errorText ?? null, runId],
      );
    } catch (error) {
      run(
        store.db,
        "update source_runs set finished_at = ?, status = ?, error_text = ? where run_id = ?",
        [nowIso(), "failed", error instanceof Error ? error.message : String(error), runId],
      );
      throw error;
    }
  }
}

function augmentParsedOutputWithRelationshipEndpointCandidates(
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
  if (shouldSeedFromRelationshipEndpoint(sourceId, relationshipCandidate, observedName)) {
    candidates.push(
      buildSeededRelationshipEndpointCandidate(
        sourceId,
        relationshipCandidate,
        observedName,
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

function shouldSeedFromRelationshipEndpoint(
  sourceId: string,
  relationshipCandidate: RelationshipCandidateInput,
  observedName: string,
): boolean {
  return sourceId === "council.committees" &&
    relationshipCandidate.relationshipType === "overseen_by" &&
    buildEntityId(observedName) === relationshipCandidate.fromEntityRef &&
    !isGroupedCommitteeOversightTarget(observedName);
}

function seededRelationshipEndpointReviewItem(
  candidate: EntityCandidateInput,
): ReviewItemInput {
  const safeToAutoAccept = isSafeToBatchAcceptSeededEndpointCandidate(candidate);
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

function isSafeToBatchAcceptSeededEndpointCandidate(
  candidate: EntityCandidateInput,
): boolean {
  return isSafeCouncilSeededEndpointCandidate(candidate.candidateId) ||
    isSafeDcgisGoverningEndpointCandidate(candidate.candidateId);
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
  return /including|jointly|^all of |excluding/i.test(value);
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

function importParsedOutput(
  store: WorkbenchStore,
  sourceId: string,
  endpointId: string,
  runId: string,
  artifactRecords: ArtifactRecord[],
  parsed: ConnectorResult["endpointResults"][number]["parsed"],
): void {
  if (!parsed) return;
  for (const field of parsed.fields ?? []) {
    const artifactRecord = artifactAt(artifactRecords, field.artifactIndex);
    run(
      store.db,
      "insert or replace into source_fields(field_id, endpoint_id, artifact_id, field_name, field_type, field_label, ordinal) values(?, ?, ?, ?, ?, ?, ?)",
      [
        `${endpointId}:${field.fieldName}`,
        endpointId,
        artifactRecord.artifactId,
        field.fieldName,
        field.fieldType,
        field.fieldLabel ?? null,
        field.ordinal,
      ],
    );
  }
  const itemIndex = new Map<string, ParsedSourceItemRecord & { artifactPath: string }>();
  for (const item of parsed.items ?? []) {
    const artifactRecord = artifactAt(artifactRecords, item.artifactIndex);
    const sourceItemId = `${runId}:${item.itemKey}`;
    itemIndex.set(item.itemKey, {
      sourceItemId,
      artifactIndex: item.artifactIndex ?? 0,
      artifactPath: artifactRecord.artifactPath,
    });
    run(
      store.db,
      "insert or replace into source_items(source_item_id, source_id, endpoint_id, run_id, artifact_id, item_key, item_type, title, body_json) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        sourceItemId,
        sourceId,
        endpointId,
        runId,
        artifactRecord.artifactId,
        item.itemKey,
        item.itemType,
        item.title,
        JSON.stringify(item.body),
      ],
    );
  }
  for (const candidate of parsed.entityCandidates ?? []) {
    const sourceItem = requireItem(itemIndex, candidate.sourceItemKey);
    run(
      store.db,
      "insert or replace into entity_candidates(candidate_id, source_item_id, proposed_entity_id, name, normalized_name, kind, raw_kind, branch, cluster, official_url, confidence, duplicate_hint, review_status) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, coalesce((select review_status from entity_candidates where candidate_id = ?), 'pending'))",
      [
        candidate.candidateId,
        sourceItem.sourceItemId,
        candidate.proposedEntityId,
        candidate.name,
        candidate.name.toLowerCase(),
        candidate.kind,
        candidate.rawKind ?? null,
        candidate.branch ?? null,
        candidate.cluster ?? null,
        candidate.officialUrl ?? null,
        candidate.confidence ?? null,
        candidate.duplicateHint ?? null,
        candidate.candidateId,
      ],
    );
    for (const [index, evidence] of candidate.evidence.entries()) {
      const artifactRecord = artifactAt(
        artifactRecords,
        evidence.artifactIndex ?? sourceItem.artifactIndex,
      );
      run(
        store.db,
        "insert or replace into entity_candidate_evidence(evidence_id, candidate_id, source_id, source_item_id, field_path, observed_value, artifact_path) values(?, ?, ?, ?, ?, ?, ?)",
        [
          `${candidate.candidateId}:${index}`,
          candidate.candidateId,
          sourceId,
          sourceItem.sourceItemId,
          evidence.fieldPath,
          evidence.observedValue,
          artifactRecord.artifactPath,
        ],
      );
    }
  }
  for (const candidate of parsed.relationshipCandidates ?? []) {
    const sourceItem = requireItem(itemIndex, candidate.sourceItemKey);
    run(
      store.db,
      "insert or replace into relationship_candidates(relationship_candidate_id, source_item_id, from_entity_ref, to_entity_ref, relationship_type, raw_value, needs_review, review_status) values(?, ?, ?, ?, ?, ?, ?, coalesce((select review_status from relationship_candidates where relationship_candidate_id = ?), 'pending'))",
      [
        candidate.relationshipCandidateId,
        sourceItem.sourceItemId,
        candidate.fromEntityRef,
        candidate.toEntityRef,
        candidate.relationshipType,
        candidate.rawValue ?? null,
        candidate.needsReview ? 1 : 0,
        candidate.relationshipCandidateId,
      ],
    );
    for (const [index, evidence] of candidate.evidence.entries()) {
      const artifactRecord = artifactAt(
        artifactRecords,
        evidence.artifactIndex ?? sourceItem.artifactIndex,
      );
      run(
        store.db,
        "insert or replace into relationship_candidate_evidence(evidence_id, relationship_candidate_id, source_id, source_item_id, field_path, observed_value, artifact_path) values(?, ?, ?, ?, ?, ?, ?)",
        [
          `${candidate.relationshipCandidateId}:${index}`,
          candidate.relationshipCandidateId,
          sourceId,
          sourceItem.sourceItemId,
          evidence.fieldPath,
          evidence.observedValue,
          artifactRecord.artifactPath,
        ],
      );
    }
  }
  for (const legalRef of parsed.legalRefs ?? []) {
    const sourceItem = requireItem(itemIndex, legalRef.sourceItemKey);
    run(
      store.db,
      "insert or replace into legal_refs(legal_ref_id, source_item_id, ref_type, citation_text, normalized_citation, url, review_status) values(?, ?, ?, ?, ?, ?, coalesce((select review_status from legal_refs where legal_ref_id = ?), 'pending'))",
      [
        legalRef.legalRefId,
        sourceItem.sourceItemId,
        legalRef.refType,
        legalRef.citationText,
        legalRef.normalizedCitation ?? null,
        legalRef.url ?? null,
        legalRef.legalRefId,
      ],
    );
    for (const [index, evidence] of legalRef.evidence.entries()) {
      const artifactRecord = artifactAt(
        artifactRecords,
        evidence.artifactIndex ?? sourceItem.artifactIndex,
      );
      run(
        store.db,
        "insert or replace into legal_ref_evidence(evidence_id, legal_ref_id, source_id, source_item_id, field_path, observed_value, artifact_path) values(?, ?, ?, ?, ?, ?, ?)",
        [
          `${legalRef.legalRefId}:${index}`,
          legalRef.legalRefId,
          sourceId,
          sourceItem.sourceItemId,
          evidence.fieldPath,
          evidence.observedValue,
          artifactRecord.artifactPath,
        ],
      );
    }
    if (legalRef.attachEntityRef) {
      run(
        store.db,
        "insert or ignore into entity_legal_refs(entity_legal_ref_id, entity_id, legal_ref_id) values(?, ?, ?)",
        [
          `${legalRef.attachEntityRef}:${legalRef.legalRefId}`,
          legalRef.attachEntityRef,
          legalRef.legalRefId,
        ],
      );
    }
    if (legalRef.attachRelationshipRef) {
      run(
        store.db,
        "insert or ignore into relationship_legal_refs(relationship_legal_ref_id, relationship_id, legal_ref_id) values(?, ?, ?)",
        [
          `${legalRef.attachRelationshipRef}:${legalRef.legalRefId}`,
          legalRef.attachRelationshipRef,
          legalRef.legalRefId,
        ],
      );
    }
    const reviewItemId = buildReviewItemId(legalRef.legalRefId, "legal-ref");
    run(
      store.db,
      "insert or replace into review_items(review_item_id, item_type, subject_id, reason, default_action, status, details_json, created_at, updated_at) values(?, 'legal_ref', ?, ?, ?, coalesce((select status from review_items where review_item_id = ?), 'open'), ?, coalesce((select created_at from review_items where review_item_id = ?), ?), ?)",
      [
        reviewItemId,
        legalRef.legalRefId,
        legalReviewReason(legalRef),
        legalDefaultAction(legalRef),
        reviewItemId,
        JSON.stringify(legalReviewDetails(legalRef)),
        reviewItemId,
        nowIso(),
        nowIso(),
      ],
    );
  }
  for (const dataset of parsed.datasets ?? []) {
    const sourceItem = requireItem(itemIndex, dataset.sourceItemKey);
    run(
      store.db,
      "insert or replace into datasets(dataset_id, source_item_id, name, category, owner_name, access_method, artifact_depth, official_url, review_status) values(?, ?, ?, ?, ?, ?, ?, ?, coalesce((select review_status from datasets where dataset_id = ?), 'pending'))",
      [
        dataset.datasetId,
        sourceItem.sourceItemId,
        dataset.name,
        dataset.category,
        dataset.ownerName ?? null,
        dataset.accessMethod,
        dataset.artifactDepth,
        dataset.officialUrl ?? null,
        dataset.datasetId,
      ],
    );
    for (const [index, evidence] of dataset.evidence.entries()) {
      const artifactRecord = artifactAt(
        artifactRecords,
        evidence.artifactIndex ?? sourceItem.artifactIndex,
      );
      run(
        store.db,
        "insert or replace into dataset_evidence(evidence_id, dataset_id, source_id, source_item_id, field_path, observed_value, artifact_path) values(?, ?, ?, ?, ?, ?, ?)",
        [
          `${dataset.datasetId}:${index}`,
          dataset.datasetId,
          sourceId,
          sourceItem.sourceItemId,
          evidence.fieldPath,
          evidence.observedValue,
          artifactRecord.artifactPath,
        ],
      );
    }
  }
  for (const reviewItem of parsed.reviewItems ?? []) {
    if (reviewItem.itemType === "relationship_candidate") {
      // Relationship review visibility is derived from reconciled candidate state.
      continue;
    }
    run(
      store.db,
      "insert or replace into review_items(review_item_id, item_type, subject_id, reason, default_action, status, details_json, created_at, updated_at) values(?, ?, ?, ?, ?, coalesce((select status from review_items where review_item_id = ?), 'open'), ?, coalesce((select created_at from review_items where review_item_id = ?), ?), ?)",
      [
        reviewItem.reviewItemId,
        reviewItem.itemType,
        reviewItem.subjectId,
        reviewItem.reason,
        reviewItem.defaultAction,
        reviewItem.reviewItemId,
        JSON.stringify(reviewItem.details),
        reviewItem.reviewItemId,
        nowIso(),
        nowIso(),
      ],
    );
  }
}

function legalDefaultAction(legalRef: LegalRefInput): "accept" | "defer" {
  if (legalRef.refType === "unknown") return "defer";
  if (legalRef.needsReview === true && !legalRef.normalizedCitation) return "defer";
  return "accept";
}

function legalReviewReason(legalRef: LegalRefInput): string {
  if (legalRef.refType === "unknown") return "Classify or defer unknown legal reference";
  if (legalRef.needsReview === true) return "Review legal reference normalization";
  return "Accept or correct normalized legal reference";
}

function legalReviewDetails(legalRef: LegalRefInput): Record<string, unknown> {
  return {
    citationText: legalRef.citationText,
    refType: legalRef.refType,
    normalizedCitation: legalRef.normalizedCitation ?? null,
    url: legalRef.url ?? null,
    needsReview: legalRef.needsReview === true,
  };
}

function artifactAt(artifactRecords: ArtifactRecord[], artifactIndex?: number): ArtifactRecord {
  const index = artifactIndex ?? 0;
  const record = artifactRecords[index];
  if (!record) throw new Error(`Missing artifact index ${index}`);
  return record;
}
