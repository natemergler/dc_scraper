import {
  buildReviewItemId,
  type ConnectorResult,
  type EntityCandidateInput,
  type LegalRefInput,
  normalizeName,
  nowIso,
  type RelationshipCandidateInput,
  sha256Hex,
  slugify,
} from "../domain.ts";
import { queryOne, run, withTransaction } from "./db.ts";
import { contentHash, makeId, requireItem, writeArtifact } from "./helpers.ts";
import { upsertEndpoint, upsertSource } from "./catalog.ts";
import { reconcileRelationshipCandidates } from "./reconciliation.ts";
import type { WorkbenchStore } from "./store.ts";

interface ArtifactRecord {
  artifactId: string;
  artifactPath: string;
}

interface ParsedSourceItemRecord {
  sourceItemId: string;
  artifactIndex: number;
}

interface EntityDecisionHint {
  candidateId: string;
  proposedEntityId: string;
  factSignature: string;
  evidenceHash: string;
}

interface LegalRefDecisionHint {
  legalRefId: string;
  factSignature: string;
  evidenceHash: string;
}

interface RelationshipDecisionHint {
  relationshipCandidateId: string;
  factSignature: string;
  evidenceHash: string;
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
    const entityDecisionHints = endpointResult.parsed?.entityCandidates
      ? await Promise.all(
        endpointResult.parsed.entityCandidates.map((candidate) =>
          buildEntityDecisionHint(endpointResult.endpoint.sourceId, candidate)
        ),
      )
      : [];
    const legalRefDecisionHints = endpointResult.parsed?.legalRefs
      ? await Promise.all(
        endpointResult.parsed.legalRefs.map((legalRef) =>
          buildLegalRefDecisionHint(endpointResult.endpoint.sourceId, legalRef)
        ),
      )
      : [];
    const relationshipDecisionHints = endpointResult.parsed?.relationshipCandidates
      ? await Promise.all(
        endpointResult.parsed.relationshipCandidates.map((candidate) =>
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
      if (endpointResult.parsed) {
        withTransaction(store.db, () => {
          importParsedOutput(
            store,
            endpointResult.endpoint.sourceId,
            endpointResult.endpoint.endpointId,
            runId,
            artifactRecords,
            endpointResult.parsed,
          );
        });
        await reuseOrMarkStaleEntityDecisions(store, entityDecisionHints);
        await reuseOrMarkStaleLegalRefDecisions(store, legalRefDecisionHints);
        await reuseOrMarkStaleRelationshipDecisions(store, relationshipDecisionHints);
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

async function buildEntityDecisionHint(
  sourceId: string,
  candidate: EntityCandidateInput,
): Promise<EntityDecisionHint> {
  return {
    candidateId: candidate.candidateId,
    proposedEntityId: candidate.proposedEntityId,
    factSignature: entityFactSignature(sourceId, candidate),
    evidenceHash: await entityEvidenceHash(candidate),
  };
}

async function buildLegalRefDecisionHint(
  sourceId: string,
  legalRef: LegalRefInput,
): Promise<LegalRefDecisionHint> {
  return {
    legalRefId: legalRef.legalRefId,
    factSignature: legalRefFactSignature(sourceId, legalRef),
    evidenceHash: await legalRefEvidenceHash(legalRef),
  };
}

async function buildRelationshipDecisionHint(
  sourceId: string,
  candidate: RelationshipCandidateInput,
): Promise<RelationshipDecisionHint> {
  return {
    relationshipCandidateId: candidate.relationshipCandidateId,
    factSignature: relationshipFactSignature(sourceId, candidate),
    evidenceHash: await relationshipEvidenceHash(candidate),
  };
}

async function reuseOrMarkStaleEntityDecisions(
  store: WorkbenchStore,
  hints: EntityDecisionHint[],
): Promise<void> {
  let changed = false;
  for (const hint of hints) {
    const priorDecision = queryOne<{
      eventType: string;
      evidenceHash?: string | null;
      resolvedEntityId?: string | null;
    }>(
      store.db,
      `select event_type as eventType,
              json_extract(payload_json, '$.evidence_hash') as evidenceHash,
              json_extract(payload_json, '$.resolved_entity_id') as resolvedEntityId
       from resolution_events
       where event_type in ('accept_entity_candidate', 'reject_entity_candidate')
         and json_extract(payload_json, '$.fact_signature') = ?
       order by created_at desc, event_id desc
       limit 1`,
      [hint.factSignature],
    );
    if (!priorDecision?.evidenceHash) continue;

    if (priorDecision.evidenceHash === hint.evidenceHash) {
      const candidate = queryOne<{ reviewStatus: string }>(
        store.db,
        "select review_status as reviewStatus from entity_candidates where candidate_id = ?",
        [hint.candidateId],
      );
      if (!candidate) continue;
      if (priorDecision.eventType === "accept_entity_candidate") {
        if (candidate.reviewStatus !== "accepted") {
          mergeAcceptedEntityCandidate(
            store,
            hint.candidateId,
            priorDecision.resolvedEntityId ?? hint.proposedEntityId,
          );
        }
      } else if (candidate.reviewStatus !== "rejected") {
        run(
          store.db,
          "update entity_candidates set review_status = 'rejected' where candidate_id = ?",
          [hint.candidateId],
        );
      }
      run(
        store.db,
        "update review_items set status = 'resolved', updated_at = ? where subject_id = ? and item_type = 'entity_candidate'",
        [nowIso(), hint.candidateId],
      );
      changed = true;
      continue;
    }

    const reviewItem = queryOne<{ reason: string; detailsJson: string }>(
      store.db,
      "select reason, details_json as detailsJson from review_items where subject_id = ? and item_type = 'entity_candidate'",
      [hint.candidateId],
    );
    if (!reviewItem) continue;
    const details = JSON.parse(reviewItem.detailsJson) as Record<string, unknown>;
    const priorDecisionState = priorDecision.eventType === "accept_entity_candidate"
      ? "accepted"
      : "rejected";
    details.priorDecisionState = priorDecisionState;
    details.stalePriorDecision = true;
    details.factSignature = hint.factSignature;
    details.evidenceHash = hint.evidenceHash;
    const staleSuffix = `changed since a prior ${priorDecisionState} decision`;
    const staleReason = reviewItem.reason.includes(staleSuffix)
      ? reviewItem.reason
      : `${reviewItem.reason} (${staleSuffix})`;
    run(
      store.db,
      "update review_items set reason = ?, default_action = ?, details_json = ?, status = 'open', updated_at = ? where subject_id = ? and item_type = 'entity_candidate'",
      [
        staleReason,
        priorDecisionState === "accepted" ? "accept" : "reject",
        JSON.stringify(details),
        nowIso(),
        hint.candidateId,
      ],
    );
  }
  if (changed) {
    reconcileRelationshipCandidates(store);
  }
}

async function reuseOrMarkStaleLegalRefDecisions(
  store: WorkbenchStore,
  hints: LegalRefDecisionHint[],
): Promise<void> {
  for (const hint of hints) {
    const priorDecision = queryOne<{
      eventType: string;
      evidenceHash?: string | null;
      resolvedRefType?: string | null;
      resolvedNormalizedCitation?: string | null;
      resolvedUrl?: string | null;
    }>(
      store.db,
      `select event_type as eventType,
              json_extract(payload_json, '$.evidence_hash') as evidenceHash,
              json_extract(payload_json, '$.resolved_ref_type') as resolvedRefType,
              json_extract(payload_json, '$.resolved_normalized_citation') as resolvedNormalizedCitation,
              json_extract(payload_json, '$.resolved_url') as resolvedUrl
       from resolution_events
       where event_type in ('accept_legal_ref', 'reject_legal_ref')
         and json_extract(payload_json, '$.fact_signature') = ?
       order by created_at desc, event_id desc
       limit 1`,
      [hint.factSignature],
    );
    if (!priorDecision?.evidenceHash) continue;

    if (priorDecision.evidenceHash === hint.evidenceHash) {
      const legalRef = queryOne<{ reviewStatus: string }>(
        store.db,
        "select review_status as reviewStatus from legal_refs where legal_ref_id = ?",
        [hint.legalRefId],
      );
      if (!legalRef) continue;
      if (priorDecision.eventType === "accept_legal_ref") {
        if (legalRef.reviewStatus !== "accepted") {
          reuseAcceptedLegalRefDecision(store, hint.legalRefId, priorDecision);
        }
      } else if (legalRef.reviewStatus !== "rejected") {
        run(
          store.db,
          "update legal_refs set review_status = 'rejected' where legal_ref_id = ?",
          [hint.legalRefId],
        );
      }
      run(
        store.db,
        "update review_items set status = 'resolved', updated_at = ? where subject_id = ? and item_type = 'legal_ref'",
        [nowIso(), hint.legalRefId],
      );
      continue;
    }

    const reviewItem = queryOne<{ reason: string; detailsJson: string }>(
      store.db,
      "select reason, details_json as detailsJson from review_items where subject_id = ? and item_type = 'legal_ref'",
      [hint.legalRefId],
    );
    if (!reviewItem) continue;
    const details = JSON.parse(reviewItem.detailsJson) as Record<string, unknown>;
    const priorDecisionState = priorDecision.eventType === "accept_legal_ref"
      ? "accepted"
      : "rejected";
    details.priorDecisionState = priorDecisionState;
    details.stalePriorDecision = true;
    details.factSignature = hint.factSignature;
    details.evidenceHash = hint.evidenceHash;
    const staleSuffix = `changed since a prior ${priorDecisionState} decision`;
    const staleReason = reviewItem.reason.includes(staleSuffix)
      ? reviewItem.reason
      : `${reviewItem.reason} (${staleSuffix})`;
    run(
      store.db,
      "update review_items set reason = ?, default_action = ?, details_json = ?, status = 'open', updated_at = ? where subject_id = ? and item_type = 'legal_ref'",
      [
        staleReason,
        priorDecisionState === "accepted" ? "accept" : "reject",
        JSON.stringify(details),
        nowIso(),
        hint.legalRefId,
      ],
    );
  }
}

async function reuseOrMarkStaleRelationshipDecisions(
  store: WorkbenchStore,
  hints: RelationshipDecisionHint[],
): Promise<void> {
  let changed = false;
  for (const hint of hints) {
    const priorDecision = queryOne<{
      eventType: string;
      eventId: string;
      evidenceHash?: string | null;
      resolvedRelationshipType?: string | null;
      resolvedFromEntityId?: string | null;
      resolvedToEntityId?: string | null;
    }>(
      store.db,
      `select event_type as eventType,
              event_id as eventId,
              json_extract(payload_json, '$.evidence_hash') as evidenceHash,
              json_extract(payload_json, '$.resolved_relationship_type') as resolvedRelationshipType,
              json_extract(payload_json, '$.resolved_from_entity_id') as resolvedFromEntityId,
              json_extract(payload_json, '$.resolved_to_entity_id') as resolvedToEntityId
       from resolution_events
       where event_type in ('accept_relationship_candidate', 'reject_relationship_candidate')
         and json_extract(payload_json, '$.fact_signature') = ?
       order by created_at desc, event_id desc
      limit 1`,
      [hint.factSignature],
    );
    if (!priorDecision?.evidenceHash) {
      reuseOrMarkStaleDeferredRelationshipReview(store, hint);
      continue;
    }

    if (priorDecision.evidenceHash === hint.evidenceHash) {
      const candidate = queryOne<{ reviewStatus: string }>(
        store.db,
        `select review_status as reviewStatus
         from relationship_candidates
         where relationship_candidate_id = ?`,
        [hint.relationshipCandidateId],
      );
      if (!candidate) continue;
      if (priorDecision.eventType === "accept_relationship_candidate") {
        if (candidate.reviewStatus !== "accepted") {
          reuseAcceptedRelationshipDecision(store, hint.relationshipCandidateId, priorDecision);
        }
      } else if (candidate.reviewStatus !== "rejected") {
        run(
          store.db,
          "update relationship_candidates set review_status = 'rejected' where relationship_candidate_id = ?",
          [hint.relationshipCandidateId],
        );
      }
      run(
        store.db,
        "update review_items set status = 'resolved', updated_at = ? where subject_id = ? and item_type = 'relationship_candidate'",
        [nowIso(), hint.relationshipCandidateId],
      );
      changed = true;
      continue;
    }

    const reviewItem = queryOne<{ reason: string; detailsJson: string }>(
      store.db,
      `select reason, details_json as detailsJson
       from review_items
       where subject_id = ? and item_type = 'relationship_candidate'`,
      [hint.relationshipCandidateId],
    );
    if (!reviewItem) continue;
    const details = JSON.parse(reviewItem.detailsJson) as Record<string, unknown>;
    const priorDecisionState = priorDecision.eventType === "accept_relationship_candidate"
      ? "accepted"
      : "rejected";
    details.priorDecisionState = priorDecisionState;
    details.stalePriorDecision = true;
    details.factSignature = hint.factSignature;
    details.evidenceHash = hint.evidenceHash;
    const staleSuffix = `changed since a prior ${priorDecisionState} decision`;
    const staleReason = reviewItem.reason.includes(staleSuffix)
      ? reviewItem.reason
      : `${reviewItem.reason} (${staleSuffix})`;
    run(
      store.db,
      `update review_items
       set reason = ?, default_action = ?, details_json = ?, status = 'open', updated_at = ?
       where subject_id = ? and item_type = 'relationship_candidate'`,
      [
        staleReason,
        priorDecisionState === "accepted" ? "accept" : "reject",
        JSON.stringify(details),
        nowIso(),
        hint.relationshipCandidateId,
      ],
    );
  }
  if (changed) {
    reconcileRelationshipCandidates(store);
  }
}

function reuseOrMarkStaleDeferredRelationshipReview(
  store: WorkbenchStore,
  hint: RelationshipDecisionHint,
): void {
  const priorReviewDecision = queryOne<{
    eventType: string;
    reviewItemId: string;
    evidenceHash?: string | null;
  }>(
    store.db,
    `select event_type as eventType,
            subject_id as reviewItemId,
            json_extract(payload_json, '$.evidence_hash') as evidenceHash
     from resolution_events
     where event_type in ('defer_review_item', 'reopen_review_item')
       and json_extract(payload_json, '$.fact_signature') = ?
     order by created_at desc, event_id desc
     limit 1`,
    [hint.factSignature],
  );
  if (!priorReviewDecision?.evidenceHash || priorReviewDecision.eventType !== "defer_review_item") {
    return;
  }

  const reviewItem = queryOne<{
    reviewItemId: string;
    reason: string;
    detailsJson: string;
    status: string;
  }>(
    store.db,
    `select review_item_id as reviewItemId,
            reason,
            details_json as detailsJson,
            status
     from review_items
     where subject_id = ? and item_type = 'relationship_candidate'`,
    [hint.relationshipCandidateId],
  );
  if (!reviewItem || reviewItem.status === "resolved") return;
  if (priorReviewDecision.reviewItemId !== reviewItem.reviewItemId) {
    run(
      store.db,
      "update review_items set status = 'resolved', updated_at = ? where review_item_id = ?",
      [nowIso(), priorReviewDecision.reviewItemId],
    );
  }

  if (priorReviewDecision.evidenceHash === hint.evidenceHash) {
    run(
      store.db,
      `update review_items
       set status = 'deferred', updated_at = ?
       where subject_id = ? and item_type = 'relationship_candidate'`,
      [nowIso(), hint.relationshipCandidateId],
    );
    return;
  }

  const details = JSON.parse(reviewItem.detailsJson) as Record<string, unknown>;
  details.priorDecisionState = "deferred";
  details.stalePriorDecision = true;
  details.factSignature = hint.factSignature;
  details.evidenceHash = hint.evidenceHash;
  const staleSuffix = "changed since a prior deferred decision";
  const staleReason = reviewItem.reason.includes(staleSuffix)
    ? reviewItem.reason
    : `${reviewItem.reason} (${staleSuffix})`;
  run(
    store.db,
    `update review_items
     set reason = ?, details_json = ?, status = 'open', updated_at = ?
     where subject_id = ? and item_type = 'relationship_candidate'`,
    [
      staleReason,
      JSON.stringify(details),
      nowIso(),
      hint.relationshipCandidateId,
    ],
  );
}

function mergeAcceptedEntityCandidate(
  store: WorkbenchStore,
  candidateId: string,
  entityId: string,
): void {
  const entity = queryOne<{ mergedCandidateIds: string }>(
    store.db,
    "select merged_candidate_ids as mergedCandidateIds from canonical_entities where entity_id = ?",
    [entityId],
  );
  if (!entity) return;
  const merged = JSON.parse(entity.mergedCandidateIds) as string[];
  if (!merged.includes(candidateId)) {
    merged.push(candidateId);
    run(
      store.db,
      "update canonical_entities set merged_candidate_ids = ?, updated_at = ? where entity_id = ?",
      [JSON.stringify(merged), nowIso(), entityId],
    );
  }
  run(store.db, "update entity_candidates set review_status = 'accepted' where candidate_id = ?", [
    candidateId,
  ]);
}

function entityFactSignature(
  sourceId: string,
  candidate: Pick<EntityCandidateInput, "sourceItemKey" | "proposedEntityId" | "name" | "kind">,
): string {
  return [
    "entity_candidate",
    sourceId,
    candidate.sourceItemKey,
    candidate.proposedEntityId,
    slugify(normalizeName(candidate.name)),
    candidate.kind,
  ].join(":");
}

async function entityEvidenceHash(
  candidate: Pick<EntityCandidateInput, "evidence">,
): Promise<string> {
  const canonicalEvidence = candidate.evidence
    .map((row) => ({
      fieldPath: row.fieldPath,
      observedValue: row.observedValue,
    }))
    .sort((left, right) =>
      left.fieldPath.localeCompare(right.fieldPath) ||
      left.observedValue.localeCompare(right.observedValue)
    );
  return `sha256:${await sha256Hex(JSON.stringify(canonicalEvidence))}`;
}

function legalRefFactSignature(
  sourceId: string,
  legalRef: Pick<LegalRefInput, "sourceItemKey" | "refType" | "citationText">,
): string {
  return [
    "legal_ref",
    sourceId,
    legalRef.sourceItemKey,
    legalRef.refType,
    slugify(normalizeName(legalRef.citationText)),
  ].join(":");
}

async function legalRefEvidenceHash(
  legalRef: Pick<
    LegalRefInput,
    "evidence" | "refType" | "citationText" | "normalizedCitation" | "url"
  >,
): Promise<string> {
  const canonicalEvidence = {
    refType: legalRef.refType,
    citationText: legalRef.citationText,
    normalizedCitation: legalRef.normalizedCitation ?? null,
    url: legalRef.url ?? null,
    evidence: legalRef.evidence
      .map((row) => ({
        fieldPath: row.fieldPath,
        observedValue: row.observedValue,
      }))
      .sort((left, right) =>
        left.fieldPath.localeCompare(right.fieldPath) ||
        left.observedValue.localeCompare(right.observedValue)
      ),
  };
  return `sha256:${await sha256Hex(JSON.stringify(canonicalEvidence))}`;
}

function relationshipFactSignature(
  sourceId: string,
  candidate: Pick<
    RelationshipCandidateInput,
    "sourceItemKey" | "fromEntityRef" | "toEntityRef" | "relationshipType"
  >,
): string {
  return [
    "relationship_candidate",
    sourceId,
    candidate.sourceItemKey,
    candidate.fromEntityRef,
    candidate.relationshipType,
    candidate.toEntityRef,
  ].join(":");
}

async function relationshipEvidenceHash(
  candidate: Pick<RelationshipCandidateInput, "rawValue" | "needsReview" | "evidence">,
): Promise<string> {
  const canonicalEvidence = {
    rawValue: candidate.rawValue ?? null,
    needsReview: candidate.needsReview === true,
    evidence: candidate.evidence
      .map((row: { fieldPath: string; observedValue: string }) => ({
        fieldPath: row.fieldPath,
        observedValue: row.observedValue,
      }))
      .sort((left: { fieldPath: string; observedValue: string }, right: {
        fieldPath: string;
        observedValue: string;
      }) =>
        left.fieldPath.localeCompare(right.fieldPath) ||
        left.observedValue.localeCompare(right.observedValue)
      ),
  };
  return `sha256:${await sha256Hex(JSON.stringify(canonicalEvidence))}`;
}

function reuseAcceptedLegalRefDecision(
  store: WorkbenchStore,
  legalRefId: string,
  priorDecision: {
    resolvedRefType?: string | null;
    resolvedNormalizedCitation?: string | null;
    resolvedUrl?: string | null;
  },
): void {
  run(
    store.db,
    "update legal_refs set ref_type = coalesce(?, ref_type), normalized_citation = ?, url = coalesce(?, url), review_status = 'accepted' where legal_ref_id = ?",
    [
      priorDecision.resolvedRefType ?? null,
      priorDecision.resolvedNormalizedCitation ?? null,
      priorDecision.resolvedUrl ?? null,
      legalRefId,
    ],
  );
}

function reuseAcceptedRelationshipDecision(
  store: WorkbenchStore,
  relationshipCandidateId: string,
  priorDecision: {
    eventId: string;
    resolvedRelationshipType?: string | null;
    resolvedFromEntityId?: string | null;
    resolvedToEntityId?: string | null;
  },
): void {
  const relationshipType = priorDecision.resolvedRelationshipType;
  const fromEntityId = priorDecision.resolvedFromEntityId;
  const toEntityId = priorDecision.resolvedToEntityId;
  if (!relationshipType || !fromEntityId || !toEntityId) return;
  const relationshipId = `${fromEntityId}:${relationshipType}:${toEntityId}`;
  const existing = queryOne<{ relationshipId: string }>(
    store.db,
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = ?",
    [relationshipId],
  );
  if (!existing) {
    run(
      store.db,
      `insert into canonical_relationships(
         relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at
       ) values(?, ?, ?, ?, 'accepted', ?, ?)`,
      [relationshipId, fromEntityId, relationshipType, toEntityId, priorDecision.eventId, nowIso()],
    );
  }
  run(
    store.db,
    "update relationship_candidates set review_status = 'accepted' where relationship_candidate_id = ?",
    [relationshipCandidateId],
  );
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
  reconcileRelationshipCandidates(store);
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
