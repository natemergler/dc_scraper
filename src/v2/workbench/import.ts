import {
  buildReviewItemId,
  type ConnectorResult,
  type LegalRefInput,
  nowIso,
  type ReviewItemInput,
} from "../domain.ts";
import { queryAll, run, withTransaction } from "./db.ts";
import { classifySameEntityKindMerge } from "./entity_kind_policy.ts";
import { contentHash, makeId, requireItem, writeArtifact } from "./helpers.ts";
import { refreshLegalRefAttachments } from "./legal_ref_attachments.ts";
import {
  type MaterializationStep,
  materializePrerequisiteFacts,
  materializeRelationshipFacts,
} from "./materialization.ts";
import { upsertEndpoint, upsertSource } from "./catalog.ts";
import {
  buildEntityDecisionHint,
  buildLegalRefDecisionHint,
  buildRelationshipDecisionHint,
  reuseOrMarkStaleEntityDecisions,
  reuseOrMarkStaleLegalRefDecisions,
  reuseOrMarkStaleRelationshipDecisions,
} from "./replay.ts";
import { augmentParsedOutputWithRelationshipEndpointCandidates } from "./seeded_endpoints.ts";
import type { WorkbenchStore } from "./store.ts";

interface ArtifactRecord {
  artifactId: string;
  artifactPath: string;
}

interface ParsedSourceItemRecord {
  sourceItemId: string;
  artifactIndex: number;
}

interface EntityReviewConflictContext {
  candidateKind: string;
  candidateName: string;
  candidateSourceId: string;
  candidateBodyJson: string;
  existingEntityId: string;
  existingName: string;
  existingKind: string;
  existingMergedCandidateIds: string;
}

export type ImportProgressPhase =
  | "parsed-row-insert"
  | "entity-replay"
  | "legal-ref-replay"
  | "legal-auto-accept"
  | "entity-auto-promote"
  | "relationship-reconciliation"
  | "relationship-replay"
  | "relationship-auto-accept";

export interface ImportProgressEvent {
  phase: ImportProgressPhase;
  sourceId?: string;
  endpointId?: string;
  message: string;
}

export interface ImportConnectorOptions {
  onProgress?: (event: ImportProgressEvent) => void;
}

export async function importConnectorResult(
  store: WorkbenchStore,
  result: ConnectorResult,
  dataDir: string,
  options: ImportConnectorOptions = {},
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
    const needsDerivedStateRefresh = parsedAffectsDerivedState(parsed);
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
        reportImportProgress(options, {
          phase: "parsed-row-insert",
          sourceId: endpointResult.endpoint.sourceId,
          endpointId: endpointResult.endpoint.endpointId,
          message: "Inserted parsed rows",
        });
        await reuseOrMarkStaleEntityDecisions(store, entityDecisionHints);
        reportImportProgress(options, {
          phase: "entity-replay",
          sourceId: endpointResult.endpoint.sourceId,
          endpointId: endpointResult.endpoint.endpointId,
          message: "Replayed entity decisions",
        });
        await reuseOrMarkStaleLegalRefDecisions(store, legalRefDecisionHints);
        reportImportProgress(options, {
          phase: "legal-ref-replay",
          sourceId: endpointResult.endpoint.sourceId,
          endpointId: endpointResult.endpoint.endpointId,
          message: "Replayed legal ref decisions",
        });
        if (needsDerivedStateRefresh) {
          materializePrerequisiteFacts(store, {
            onStep: (step) =>
              reportImportMaterializationProgress(
                options,
                step,
                endpointResult.endpoint.sourceId,
                endpointResult.endpoint.endpointId,
              ),
          });
        }
        await reuseOrMarkStaleRelationshipDecisions(store, relationshipDecisionHints);
        if (needsDerivedStateRefresh) {
          reportImportProgress(options, {
            phase: "relationship-replay",
            sourceId: endpointResult.endpoint.sourceId,
            endpointId: endpointResult.endpoint.endpointId,
            message: "Replayed relationship decisions",
          });
        }
        if (needsDerivedStateRefresh) {
          materializeRelationshipFacts(store, {
            onStep: (step) =>
              reportImportMaterializationProgress(
                options,
                step,
                endpointResult.endpoint.sourceId,
                endpointResult.endpoint.endpointId,
              ),
          });
        }
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

function reportImportMaterializationProgress(
  options: ImportConnectorOptions,
  step: MaterializationStep,
  sourceId: string,
  endpointId: string,
): void {
  reportImportProgress(options, {
    phase: step,
    sourceId,
    endpointId,
    message: importMaterializationMessage(step),
  });
}

function importMaterializationMessage(step: MaterializationStep): string {
  switch (step) {
    case "legal-auto-accept":
      return "Auto-accepted safe legal refs";
    case "entity-auto-promote":
      return "Auto-promoted safe entities";
    case "relationship-reconciliation":
      return "Reconciled relationship candidates";
    case "relationship-auto-accept":
      return "Auto-accepted safe relationships";
  }
}

function reportImportProgress(
  options: ImportConnectorOptions,
  event: ImportProgressEvent,
): void {
  options.onProgress?.(event);
}

function parsedAffectsDerivedState(
  parsed: ConnectorResult["endpointResults"][number]["parsed"],
): boolean {
  if (!parsed) return false;
  return (parsed.entityCandidates?.length ?? 0) > 0 ||
    (parsed.relationshipCandidates?.length ?? 0) > 0 ||
    (parsed.legalRefs?.length ?? 0) > 0;
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
  const insertReviewItem = store.db.prepare(
    "insert or replace into review_items(review_item_id, item_type, subject_id, reason, default_action, status, details_json, created_at, updated_at) values(?, ?, ?, ?, ?, coalesce((select status from review_items where review_item_id = ?), 'open'), ?, coalesce((select created_at from review_items where review_item_id = ?), ?), ?)",
  );
  const sourceItemRows: unknown[][] = [];
  const entityCandidateRows: unknown[][] = [];
  const entityCandidateEvidenceRows: unknown[][] = [];
  const relationshipCandidateRows: unknown[][] = [];
  const relationshipCandidateEvidenceRows: unknown[][] = [];
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
    sourceItemRows.push([
      sourceItemId,
      sourceId,
      endpointId,
      runId,
      artifactRecord.artifactId,
      item.itemKey,
      item.itemType,
      item.title,
      JSON.stringify(item.body),
    ]);
  }
  bulkInsertRows(
    store.db,
    "source_items",
    [
      "source_item_id",
      "source_id",
      "endpoint_id",
      "run_id",
      "artifact_id",
      "item_key",
      "item_type",
      "title",
      "body_json",
    ],
    sourceItemRows,
  );
  deleteStaleLegalRefsForParsedItems(
    store,
    sourceId,
    endpointId,
    itemIndex,
    parsed.legalRefs ?? [],
  );
  for (const candidate of parsed.entityCandidates ?? []) {
    const sourceItem = requireItem(itemIndex, candidate.sourceItemKey);
    entityCandidateRows.push([
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
    ]);
    for (const [index, evidence] of candidate.evidence.entries()) {
      const artifactRecord = artifactAt(
        artifactRecords,
        evidence.artifactIndex ?? sourceItem.artifactIndex,
      );
      entityCandidateEvidenceRows.push([
        `${candidate.candidateId}:${index}`,
        candidate.candidateId,
        sourceId,
        sourceItem.sourceItemId,
        evidence.fieldPath,
        evidence.observedValue,
        artifactRecord.artifactPath,
      ]);
    }
  }
  bulkInsertRows(
    store.db,
    "entity_candidates",
    [
      "candidate_id",
      "source_item_id",
      "proposed_entity_id",
      "name",
      "normalized_name",
      "kind",
      "raw_kind",
      "branch",
      "cluster",
      "official_url",
      "confidence",
      "duplicate_hint",
      "review_status",
    ],
    entityCandidateRows,
    "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, coalesce((select review_status from entity_candidates where candidate_id = ?), 'pending'))",
  );
  bulkInsertRows(
    store.db,
    "entity_candidate_evidence",
    [
      "evidence_id",
      "candidate_id",
      "source_id",
      "source_item_id",
      "field_path",
      "observed_value",
      "artifact_path",
    ],
    entityCandidateEvidenceRows,
  );
  for (const candidate of parsed.relationshipCandidates ?? []) {
    const sourceItem = requireItem(itemIndex, candidate.sourceItemKey);
    relationshipCandidateRows.push([
      candidate.relationshipCandidateId,
      sourceItem.sourceItemId,
      candidate.fromEntityRef,
      candidate.toEntityRef,
      candidate.relationshipType,
      candidate.rawValue ?? null,
      candidate.needsReview ? 1 : 0,
      candidate.relationshipCandidateId,
    ]);
    for (const [index, evidence] of candidate.evidence.entries()) {
      const artifactRecord = artifactAt(
        artifactRecords,
        evidence.artifactIndex ?? sourceItem.artifactIndex,
      );
      relationshipCandidateEvidenceRows.push([
        `${candidate.relationshipCandidateId}:${index}`,
        candidate.relationshipCandidateId,
        sourceId,
        sourceItem.sourceItemId,
        evidence.fieldPath,
        evidence.observedValue,
        artifactRecord.artifactPath,
      ]);
    }
  }
  bulkInsertRows(
    store.db,
    "relationship_candidates",
    [
      "relationship_candidate_id",
      "source_item_id",
      "from_entity_ref",
      "to_entity_ref",
      "relationship_type",
      "raw_value",
      "needs_review",
      "review_status",
    ],
    relationshipCandidateRows,
    "(?, ?, ?, ?, ?, ?, ?, coalesce((select review_status from relationship_candidates where relationship_candidate_id = ?), 'pending'))",
  );
  bulkInsertRows(
    store.db,
    "relationship_candidate_evidence",
    [
      "evidence_id",
      "relationship_candidate_id",
      "source_id",
      "source_item_id",
      "field_path",
      "observed_value",
      "artifact_path",
    ],
    relationshipCandidateEvidenceRows,
  );
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
  if ((parsed.legalRefs ?? []).length > 0) {
    refreshLegalRefAttachments(store);
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
  const entityReviewContext = entityReviewConflictContextBySubject(store, parsed.reviewItems ?? []);
  for (const reviewItem of parsed.reviewItems ?? []) {
    if (reviewItem.itemType === "relationship_candidate") {
      // Relationship review visibility is derived from reconciled candidate state.
      continue;
    }
    const resolvedReviewItem = reviewItemWithWorkbenchContext(
      store,
      reviewItem,
      entityReviewContext,
    );
    runPrepared(
      insertReviewItem,
      [
        resolvedReviewItem.reviewItemId,
        resolvedReviewItem.itemType,
        resolvedReviewItem.subjectId,
        resolvedReviewItem.reason,
        resolvedReviewItem.defaultAction,
        resolvedReviewItem.reviewItemId,
        JSON.stringify(resolvedReviewItem.details),
        resolvedReviewItem.reviewItemId,
        nowIso(),
        nowIso(),
      ],
    );
  }
}

function deleteStaleLegalRefsForParsedItems(
  store: WorkbenchStore,
  sourceId: string,
  endpointId: string,
  itemIndex: Map<string, ParsedSourceItemRecord & { artifactPath: string }>,
  legalRefs: LegalRefInput[],
): void {
  const itemKeys = [...itemIndex.keys()];
  if (itemKeys.length === 0) return;
  const retainedLegalRefIds = new Set(legalRefs.map((legalRef) => legalRef.legalRefId));
  const itemPlaceholders = itemKeys.map(() => "?").join(", ");
  const retainedClause = retainedLegalRefIds.size === 0
    ? ""
    : `and legal_refs.legal_ref_id not in (${[...retainedLegalRefIds].map(() => "?").join(", ")})`;
  const staleLegalRefs = queryAll<{ legalRefId: string }>(
    store.db,
    `select distinct legal_refs.legal_ref_id as legalRefId
     from legal_refs
     join source_items
       on source_items.source_item_id = legal_refs.source_item_id
     where source_items.source_id = ?
       and source_items.endpoint_id = ?
       and source_items.item_key in (${itemPlaceholders})
       ${retainedClause}`,
    [sourceId, endpointId, ...itemKeys, ...retainedLegalRefIds],
  ).map((row) => row.legalRefId);
  if (staleLegalRefs.length === 0) return;
  const stalePlaceholders = staleLegalRefs.map(() => "?").join(", ");
  run(
    store.db,
    `delete from review_items
     where item_type = 'legal_ref'
       and subject_id in (${stalePlaceholders})`,
    staleLegalRefs,
  );
  run(
    store.db,
    `delete from entity_legal_refs where legal_ref_id in (${stalePlaceholders})`,
    staleLegalRefs,
  );
  run(
    store.db,
    `delete from relationship_legal_refs where legal_ref_id in (${stalePlaceholders})`,
    staleLegalRefs,
  );
  run(
    store.db,
    `delete from legal_ref_evidence where legal_ref_id in (${stalePlaceholders})`,
    staleLegalRefs,
  );
  run(
    store.db,
    `delete from legal_refs where legal_ref_id in (${stalePlaceholders})`,
    staleLegalRefs,
  );
}

function runPrepared(
  statement: ReturnType<WorkbenchStore["db"]["prepare"]>,
  params: unknown[],
): void {
  statement.run(...(params as never[]));
}

const BULK_INSERT_ROW_LIMIT = 500;

function bulkInsertRows(
  db: WorkbenchStore["db"],
  tableName: string,
  columnNames: string[],
  rows: unknown[][],
  rowValueSql = `(${columnNames.map(() => "?").join(", ")})`,
): void {
  if (rows.length === 0) return;
  const columns = columnNames.join(", ");
  for (let offset = 0; offset < rows.length; offset += BULK_INSERT_ROW_LIMIT) {
    const chunk = rows.slice(offset, offset + BULK_INSERT_ROW_LIMIT);
    const placeholders = chunk.map(() => rowValueSql).join(", ");
    const params = chunk.flat();
    run(
      db,
      `insert or replace into ${tableName}(${columns}) values ${placeholders}`,
      params,
    );
  }
}

function reviewItemWithWorkbenchContext(
  store: WorkbenchStore,
  reviewItem: ReviewItemInput,
  entityReviewContext: Map<string, EntityReviewConflictContext>,
): ReviewItemInput {
  if (reviewItem.itemType !== "entity_candidate" || reviewItem.defaultAction === "defer") {
    return reviewItem;
  }
  const conflict = entityReviewContext.get(reviewItem.subjectId);
  if (!conflict) return reviewItem;
  const mergeDecision = classifySameEntityKindMerge(
    store,
    {
      kind: conflict.existingKind,
      mergedCandidateIds: conflict.existingMergedCandidateIds,
    },
    {
      kind: conflict.candidateKind,
      sourceId: conflict.candidateSourceId,
    },
  );
  if (mergeDecision.decision !== "conflict") return reviewItem;
  return {
    ...reviewItem,
    reason: "Resolve entity candidate that conflicts with an accepted entity",
    defaultAction: "defer",
    details: {
      ...reviewItem.details,
      existingEntityId: conflict.existingEntityId,
      existingName: conflict.existingName,
      existingKind: conflict.existingKind,
      candidateKind: conflict.candidateKind,
      whyDeferred:
        `Candidate kind ${conflict.candidateKind} conflicts with accepted ${conflict.existingKind} for the same entity id.`,
      ...sourceIdentityConflictDetails(conflict),
    },
  };
}

function entityReviewConflictContextBySubject(
  store: WorkbenchStore,
  reviewItems: ReviewItemInput[],
): Map<string, EntityReviewConflictContext> {
  const subjectIds = [
    ...new Set(
      reviewItems.filter((reviewItem) =>
        reviewItem.itemType === "entity_candidate" && reviewItem.defaultAction !== "defer"
      ).map((reviewItem) => reviewItem.subjectId),
    ),
  ];
  const contexts = new Map<string, EntityReviewConflictContext>();
  for (const subjectIdChunk of chunks(subjectIds, 500)) {
    if (subjectIdChunk.length === 0) continue;
    const placeholders = subjectIdChunk.map(() => "?").join(", ");
    const rows = queryAll<EntityReviewConflictContext & { candidateId: string }>(
      store.db,
      `select entity_candidates.candidate_id as candidateId,
              entity_candidates.kind as candidateKind,
              entity_candidates.name as candidateName,
              source_items.source_id as candidateSourceId,
              source_items.body_json as candidateBodyJson,
              canonical_entities.entity_id as existingEntityId,
              canonical_entities.name as existingName,
              canonical_entities.kind as existingKind,
              canonical_entities.merged_candidate_ids as existingMergedCandidateIds
       from entity_candidates
       join source_items
         on source_items.source_item_id = entity_candidates.source_item_id
       join canonical_entities
         on canonical_entities.entity_id = entity_candidates.proposed_entity_id
       where entity_candidates.candidate_id in (${placeholders})
         and canonical_entities.review_status = 'accepted'
         and canonical_entities.kind != entity_candidates.kind`,
      subjectIdChunk,
    );
    for (const row of rows) {
      contexts.set(row.candidateId, row);
    }
  }
  return contexts;
}

function sourceIdentityConflictDetails(conflict: {
  candidateBodyJson: string;
  candidateKind: string;
  candidateName: string;
  candidateSourceId: string;
  existingKind: string;
  existingName: string;
}): Record<string, unknown> {
  if (conflict.candidateSourceId !== "dcgis.boards_commissions_councils") return {};
  if (conflict.existingKind !== "agency") return {};
  const body = parseSourceBody(conflict.candidateBodyJson);
  const sourceGoverningAgency = sourceBodyString(body, "GOVERNING_AGENCY");
  if (
    !sourceGoverningAgency ||
    !sameText(sourceGoverningAgency, conflict.existingName) ||
    !sameText(conflict.candidateName, conflict.existingName)
  ) {
    return {};
  }
  return {
    identityQuestion: "Is this source row naming a distinct public body from the governing agency?",
    sourceGoverningAgency,
    sourceShortName: sourceBodyString(body, "SHORT_NAME"),
    sourceUrl: sourceBodyString(body, "WEB_URL"),
    whyDeferred:
      `Source row is a ${conflict.candidateKind} whose label matches the accepted agency; decide whether this row represents a distinct public body before attaching it.`,
  };
}

function parseSourceBody(bodyJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(bodyJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function sourceBodyString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sameText(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
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
    attachEntityRef: legalRef.attachEntityRef ?? null,
    attachRelationshipRef: legalRef.attachRelationshipRef ?? null,
  };
}

function artifactAt(artifactRecords: ArtifactRecord[], artifactIndex?: number): ArtifactRecord {
  const index = artifactIndex ?? 0;
  const record = artifactRecords[index];
  if (!record) throw new Error(`Missing artifact index ${index}`);
  return record;
}
