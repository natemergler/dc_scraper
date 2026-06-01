import {
  type ConnectorResult,
  type DatasetInput,
  type EntityCandidateInput,
  type LegalRefInput,
  type RelationshipCandidateInput,
  type ReviewItemInput,
  type SourceItemInput,
} from "../domain.ts";
import { nowIso } from "../domain.ts";
import { queryOne, run } from "./db.ts";
import { contentHash, makeId, requireItem, writeArtifact } from "./helpers.ts";
import { upsertEndpoint, upsertSource } from "./catalog.ts";
import type { WorkbenchStore } from "./store.ts";

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
    let firstArtifactId = "";
    try {
      for (const artifactInput of endpointResult.artifacts) {
        const artifactId = makeId("artifact");
        if (!firstArtifactId) firstArtifactId = artifactId;
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
      }
      if (endpointResult.parsed) {
        importParsedOutput(
          store,
          endpointResult.endpoint.sourceId,
          endpointResult.endpoint.endpointId,
          runId,
          firstArtifactId,
          endpointResult.parsed,
        );
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

function importParsedOutput(
  store: WorkbenchStore,
  sourceId: string,
  endpointId: string,
  runId: string,
  artifactId: string,
  parsed: ConnectorResult["endpointResults"][number]["parsed"],
): void {
  if (!parsed) return;
  for (const field of parsed.fields ?? []) {
    run(
      store.db,
      "insert or replace into source_fields(field_id, endpoint_id, artifact_id, field_name, field_type, field_label, ordinal) values(?, ?, ?, ?, ?, ?, ?)",
      [
        `${endpointId}:${field.fieldName}`,
        endpointId,
        artifactId,
        field.fieldName,
        field.fieldType,
        field.fieldLabel ?? null,
        field.ordinal,
      ],
    );
  }
  const itemIndex = new Map<string, { sourceItemId: string; artifactPath: string }>();
  const artifactPath = queryOne<{ path: string }>(
    store.db,
    "select path from source_artifacts where artifact_id = ?",
    [artifactId],
  );
  if (!artifactPath) throw new Error(`Missing artifact index for ${artifactId}`);
  for (const item of parsed.items ?? []) {
    const sourceItemId = `${runId}:${item.itemKey}`;
    itemIndex.set(item.itemKey, { sourceItemId, artifactPath: artifactPath.path });
    run(
      store.db,
      "insert or replace into source_items(source_item_id, source_id, endpoint_id, run_id, artifact_id, item_key, item_type, title, body_json) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        sourceItemId,
        sourceId,
        endpointId,
        runId,
        artifactId,
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
          sourceItem.artifactPath,
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
          sourceItem.artifactPath,
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
          sourceItem.artifactPath,
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
          sourceItem.artifactPath,
        ],
      );
    }
  }
  for (const reviewItem of parsed.reviewItems ?? []) {
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
