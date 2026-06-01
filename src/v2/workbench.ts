import { ensureDir } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import { Database } from "jsr:@db/sqlite";
import {
  CandidateStatus,
  compactDatePart,
  ConnectorResult,
  EntitySearchResult,
  EntityView,
  inverseRelationshipType,
  nowIso,
  ResolutionEventInput,
  ReviewItemRecord,
  ReviewStatus,
  sha256Hex,
  SourceEndpointDefinition,
  WorkbenchMeta,
} from "./domain.ts";

const migrations = [{
  version: 1,
  name: "v2_workbench_foundation",
  sql: `
create table if not exists schema_migrations (
  version integer primary key,
  name text not null,
  applied_at text not null
);

create table if not exists sources (
  source_id text primary key,
  title text not null,
  kind text not null,
  access_method text not null,
  base_url text not null,
  notes text,
  updated_at text not null
);

create table if not exists source_endpoints (
  endpoint_id text primary key,
  source_id text not null,
  title text not null,
  kind text not null,
  url text not null,
  method text not null,
  capture_mode text not null,
  updated_at text not null
);

create table if not exists source_runs (
  run_id text primary key,
  source_id text not null,
  endpoint_id text not null,
  started_at text not null,
  finished_at text,
  status text not null,
  error_text text
);

create table if not exists source_artifacts (
  artifact_id text primary key,
  run_id text not null,
  endpoint_id text not null,
  kind text not null,
  path text not null,
  fetched_url text not null,
  content_hash text not null,
  size_bytes integer not null,
  created_at text not null
);

create table if not exists source_fields (
  field_id text primary key,
  endpoint_id text not null,
  artifact_id text not null,
  field_name text not null,
  field_type text not null,
  field_label text,
  ordinal integer not null
);

create table if not exists source_items (
  source_item_id text primary key,
  source_id text not null,
  endpoint_id text not null,
  run_id text not null,
  artifact_id text not null,
  item_key text not null,
  item_type text not null,
  title text not null,
  body_json text not null
);

create table if not exists entity_candidates (
  candidate_id text primary key,
  source_item_id text not null,
  proposed_entity_id text not null,
  name text not null,
  normalized_name text not null,
  kind text not null,
  raw_kind text,
  branch text,
  cluster text,
  official_url text,
  confidence real,
  duplicate_hint text,
  review_status text not null default 'pending'
);

create table if not exists entity_candidate_evidence (
  evidence_id text primary key,
  candidate_id text not null,
  source_id text not null,
  source_item_id text not null,
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);

create table if not exists relationship_candidates (
  relationship_candidate_id text primary key,
  source_item_id text not null,
  from_entity_ref text not null,
  to_entity_ref text not null,
  relationship_type text not null,
  raw_value text,
  needs_review integer not null default 0,
  review_status text not null default 'pending'
);

create table if not exists relationship_candidate_evidence (
  evidence_id text primary key,
  relationship_candidate_id text not null,
  source_id text not null,
  source_item_id text not null,
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);

create table if not exists legal_refs (
  legal_ref_id text primary key,
  source_item_id text not null,
  ref_type text not null,
  citation_text text not null,
  normalized_citation text,
  url text,
  review_status text not null default 'pending'
);

create table if not exists legal_ref_evidence (
  evidence_id text primary key,
  legal_ref_id text not null,
  source_id text not null,
  source_item_id text not null,
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);

create table if not exists datasets (
  dataset_id text primary key,
  source_item_id text not null,
  name text not null,
  category text not null,
  owner_name text,
  access_method text not null,
  artifact_depth text not null,
  official_url text,
  review_status text not null default 'pending'
);

create table if not exists dataset_evidence (
  evidence_id text primary key,
  dataset_id text not null,
  source_id text not null,
  source_item_id text not null,
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);

create table if not exists review_items (
  review_item_id text primary key,
  item_type text not null,
  subject_id text not null,
  reason text not null,
  default_action text not null,
  status text not null default 'open',
  details_json text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists resolution_events (
  event_id text primary key,
  event_type text not null,
  subject_id text not null,
  payload_json text not null,
  resolution_file text not null,
  sequence_number integer not null,
  created_at text not null
);

create table if not exists canonical_entities (
  entity_id text primary key,
  name text not null,
  kind text not null,
  branch text,
  cluster text,
  official_url text,
  review_status text not null,
  merged_candidate_ids text not null default '[]',
  created_at text not null,
  updated_at text not null
);

create table if not exists canonical_relationships (
  relationship_id text primary key,
  from_entity_id text not null,
  relationship_type text not null,
  to_entity_id text not null,
  review_status text not null,
  source_event_id text not null,
  created_at text not null
);

create table if not exists entity_legal_refs (
  entity_legal_ref_id text primary key,
  entity_id text not null,
  legal_ref_id text not null
);

create table if not exists relationship_legal_refs (
  relationship_legal_ref_id text primary key,
  relationship_id text not null,
  legal_ref_id text not null
);
`,
}];

export class Workbench {
  readonly db: Database;

  constructor(readonly dbPath: string) {
    this.db = new Database(dbPath);
  }

  close(): void {
    this.db.close();
  }

  init(): WorkbenchMeta {
    this.db.exec(`
create table if not exists schema_migrations (
  version integer primary key,
  name text not null,
  applied_at text not null
);
`);
    for (const migration of migrations) {
      const existing = this.db.prepare(
        "select version, name, applied_at from schema_migrations where version = ?",
      ).get([migration.version]) as
        | { version: number; name: string; applied_at: string }
        | undefined;
      if (existing) continue;
      this.db.exec("begin");
      try {
        this.db.exec(migration.sql);
        this.db.prepare(
          "insert into schema_migrations(version, name, applied_at) values(?, ?, ?)",
        ).run([migration.version, migration.name, nowIso()]);
        this.db.exec("commit");
      } catch (error) {
        this.db.exec("rollback");
        throw error;
      }
    }
    return this.meta();
  }

  meta(): WorkbenchMeta {
    const migrationRows = this.db.prepare(
      "select version, name, applied_at as appliedAt from schema_migrations order by version",
    ).all() as Array<{ version: number; name: string; appliedAt: string }>;
    return {
      dbPath: this.dbPath,
      schemaVersion: migrationRows.at(-1)?.version ?? 0,
      migrations: migrationRows,
    };
  }

  async importConnectorResult(result: ConnectorResult, dataDir: string): Promise<void> {
    this.upsertSource(
      result.source.sourceId,
      result.source.title,
      result.source.kind,
      result.source.accessMethod,
      result.source.baseUrl,
      result.source.notes,
    );
    for (const endpointResult of result.endpointResults) {
      this.upsertEndpoint(endpointResult.endpoint);
      const runId = makeId("run");
      const startedAt = nowIso();
      this.db.prepare(
        "insert into source_runs(run_id, source_id, endpoint_id, started_at, status) values(?, ?, ?, ?, ?)",
      ).run([
        runId,
        endpointResult.endpoint.sourceId,
        endpointResult.endpoint.endpointId,
        startedAt,
        endpointResult.status,
      ]);
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
          const hash = `sha256:${await sha256Hex(artifactInput.contentText)}`;
          this.db.prepare(
            "insert into source_artifacts(artifact_id, run_id, endpoint_id, kind, path, fetched_url, content_hash, size_bytes, created_at) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ).run([
            artifactId,
            runId,
            endpointResult.endpoint.endpointId,
            artifactInput.kind,
            relativePath,
            artifactInput.fetchedUrl,
            hash,
            new TextEncoder().encode(artifactInput.contentText).length,
            nowIso(),
          ]);
        }
        if (endpointResult.parsed) {
          this.importParsedOutput(
            endpointResult.endpoint.sourceId,
            endpointResult.endpoint.endpointId,
            runId,
            firstArtifactId,
            endpointResult.parsed,
          );
        }
        this.db.prepare(
          "update source_runs set finished_at = ?, status = ?, error_text = ? where run_id = ?",
        ).run([nowIso(), endpointResult.status, endpointResult.errorText ?? null, runId]);
      } catch (error) {
        this.db.prepare(
          "update source_runs set finished_at = ?, status = ?, error_text = ? where run_id = ?",
        ).run([nowIso(), "failed", error instanceof Error ? error.message : String(error), runId]);
        throw error;
      }
    }
  }

  private importParsedOutput(
    sourceId: string,
    endpointId: string,
    runId: string,
    artifactId: string,
    parsed: ConnectorResult["endpointResults"][number]["parsed"],
  ): void {
    if (!parsed) return;
    for (const field of parsed.fields ?? []) {
      this.db.prepare(
        "insert or replace into source_fields(field_id, endpoint_id, artifact_id, field_name, field_type, field_label, ordinal) values(?, ?, ?, ?, ?, ?, ?)",
      ).run([
        `${endpointId}:${field.fieldName}`,
        endpointId,
        artifactId,
        field.fieldName,
        field.fieldType,
        field.fieldLabel ?? null,
        field.ordinal,
      ]);
    }
    const itemIndex = new Map<string, { sourceItemId: string; artifactPath: string }>();
    const artifactPath = this.db.prepare(
      "select path from source_artifacts where artifact_id = ?",
    ).get([artifactId]) as { path: string };
    for (const item of parsed.items ?? []) {
      const sourceItemId = `${runId}:${item.itemKey}`;
      itemIndex.set(item.itemKey, { sourceItemId, artifactPath: artifactPath.path });
      this.db.prepare(
        "insert or replace into source_items(source_item_id, source_id, endpoint_id, run_id, artifact_id, item_key, item_type, title, body_json) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run([
        sourceItemId,
        sourceId,
        endpointId,
        runId,
        artifactId,
        item.itemKey,
        item.itemType,
        item.title,
        JSON.stringify(item.body),
      ]);
    }
    for (const candidate of parsed.entityCandidates ?? []) {
      const sourceItem = requireItem(itemIndex, candidate.sourceItemKey);
      this.db.prepare(
        "insert or replace into entity_candidates(candidate_id, source_item_id, proposed_entity_id, name, normalized_name, kind, raw_kind, branch, cluster, official_url, confidence, duplicate_hint, review_status) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, coalesce((select review_status from entity_candidates where candidate_id = ?), 'pending'))",
      ).run([
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
        this.db.prepare(
          "insert or replace into entity_candidate_evidence(evidence_id, candidate_id, source_id, source_item_id, field_path, observed_value, artifact_path) values(?, ?, ?, ?, ?, ?, ?)",
        ).run([
          `${candidate.candidateId}:${index}`,
          candidate.candidateId,
          sourceId,
          sourceItem.sourceItemId,
          evidence.fieldPath,
          evidence.observedValue,
          sourceItem.artifactPath,
        ]);
      }
    }
    for (const candidate of parsed.relationshipCandidates ?? []) {
      const sourceItem = requireItem(itemIndex, candidate.sourceItemKey);
      this.db.prepare(
        "insert or replace into relationship_candidates(relationship_candidate_id, source_item_id, from_entity_ref, to_entity_ref, relationship_type, raw_value, needs_review, review_status) values(?, ?, ?, ?, ?, ?, ?, coalesce((select review_status from relationship_candidates where relationship_candidate_id = ?), 'pending'))",
      ).run([
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
        this.db.prepare(
          "insert or replace into relationship_candidate_evidence(evidence_id, relationship_candidate_id, source_id, source_item_id, field_path, observed_value, artifact_path) values(?, ?, ?, ?, ?, ?, ?)",
        ).run([
          `${candidate.relationshipCandidateId}:${index}`,
          candidate.relationshipCandidateId,
          sourceId,
          sourceItem.sourceItemId,
          evidence.fieldPath,
          evidence.observedValue,
          sourceItem.artifactPath,
        ]);
      }
    }
    for (const legalRef of parsed.legalRefs ?? []) {
      const sourceItem = requireItem(itemIndex, legalRef.sourceItemKey);
      this.db.prepare(
        "insert or replace into legal_refs(legal_ref_id, source_item_id, ref_type, citation_text, normalized_citation, url, review_status) values(?, ?, ?, ?, ?, ?, coalesce((select review_status from legal_refs where legal_ref_id = ?), 'pending'))",
      ).run([
        legalRef.legalRefId,
        sourceItem.sourceItemId,
        legalRef.refType,
        legalRef.citationText,
        legalRef.normalizedCitation ?? null,
        legalRef.url ?? null,
        legalRef.legalRefId,
      ]);
      for (const [index, evidence] of legalRef.evidence.entries()) {
        this.db.prepare(
          "insert or replace into legal_ref_evidence(evidence_id, legal_ref_id, source_id, source_item_id, field_path, observed_value, artifact_path) values(?, ?, ?, ?, ?, ?, ?)",
        ).run([
          `${legalRef.legalRefId}:${index}`,
          legalRef.legalRefId,
          sourceId,
          sourceItem.sourceItemId,
          evidence.fieldPath,
          evidence.observedValue,
          sourceItem.artifactPath,
        ]);
      }
      if (legalRef.attachEntityRef) {
        this.db.prepare(
          "insert or ignore into entity_legal_refs(entity_legal_ref_id, entity_id, legal_ref_id) values(?, ?, ?)",
        ).run([
          `${legalRef.attachEntityRef}:${legalRef.legalRefId}`,
          legalRef.attachEntityRef,
          legalRef.legalRefId,
        ]);
      }
    }
    for (const dataset of parsed.datasets ?? []) {
      const sourceItem = requireItem(itemIndex, dataset.sourceItemKey);
      this.db.prepare(
        "insert or replace into datasets(dataset_id, source_item_id, name, category, owner_name, access_method, artifact_depth, official_url, review_status) values(?, ?, ?, ?, ?, ?, ?, ?, coalesce((select review_status from datasets where dataset_id = ?), 'pending'))",
      ).run([
        dataset.datasetId,
        sourceItem.sourceItemId,
        dataset.name,
        dataset.category,
        dataset.ownerName ?? null,
        dataset.accessMethod,
        dataset.artifactDepth,
        dataset.officialUrl ?? null,
        dataset.datasetId,
      ]);
      for (const [index, evidence] of dataset.evidence.entries()) {
        this.db.prepare(
          "insert or replace into dataset_evidence(evidence_id, dataset_id, source_id, source_item_id, field_path, observed_value, artifact_path) values(?, ?, ?, ?, ?, ?, ?)",
        ).run([
          `${dataset.datasetId}:${index}`,
          dataset.datasetId,
          sourceId,
          sourceItem.sourceItemId,
          evidence.fieldPath,
          evidence.observedValue,
          sourceItem.artifactPath,
        ]);
      }
    }
    for (const reviewItem of parsed.reviewItems ?? []) {
      this.db.prepare(
        "insert or replace into review_items(review_item_id, item_type, subject_id, reason, default_action, status, details_json, created_at, updated_at) values(?, ?, ?, ?, ?, coalesce((select status from review_items where review_item_id = ?), 'open'), ?, coalesce((select created_at from review_items where review_item_id = ?), ?), ?)",
      ).run([
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
      ]);
    }
  }

  upsertSource(
    sourceId: string,
    title: string,
    kind: string,
    accessMethod: string,
    baseUrl: string,
    notes?: string,
  ): void {
    this.db.prepare(
      "insert or replace into sources(source_id, title, kind, access_method, base_url, notes, updated_at) values(?, ?, ?, ?, ?, ?, ?)",
    ).run([sourceId, title, kind, accessMethod, baseUrl, notes ?? null, nowIso()]);
  }

  upsertEndpoint(endpoint: SourceEndpointDefinition): void {
    this.db.prepare(
      "insert or replace into source_endpoints(endpoint_id, source_id, title, kind, url, method, capture_mode, updated_at) values(?, ?, ?, ?, ?, ?, ?, ?)",
    ).run([
      endpoint.endpointId,
      endpoint.sourceId,
      endpoint.title,
      endpoint.kind,
      endpoint.url,
      endpoint.method,
      endpoint.captureMode,
      nowIso(),
    ]);
  }

  sourceSummary(sourceId: string): {
    sourceId: string;
    title: string;
    latestStatus?: string;
    latestRunFinishedAt?: string;
    latestArtifactPath?: string;
    itemCount: number;
    fieldCount: number;
    entityCandidateCount: number;
    relationshipCandidateCount: number;
  } {
    const source = this.db.prepare(
      "select source_id as sourceId, title from sources where source_id = ?",
    ).get([
      sourceId,
    ]) as { sourceId: string; title: string } | undefined;
    if (!source) throw new Error(`Unknown source: ${sourceId}`);
    const latestRun = this.db.prepare(
      `select status as latestStatus, finished_at as latestRunFinishedAt
       from source_runs
       where source_id = ?
       order by coalesce(finished_at, started_at) desc
       limit 1`,
    ).get([sourceId]) as { latestStatus?: string; latestRunFinishedAt?: string } | undefined;
    const latestArtifact = this.db.prepare(
      `select source_artifacts.path as latestArtifactPath
       from source_artifacts
       join source_runs on source_runs.run_id = source_artifacts.run_id
       where source_runs.source_id = ?
       order by source_artifacts.created_at desc
       limit 1`,
    ).get([sourceId]) as { latestArtifactPath?: string } | undefined;
    const counts = this.db.prepare(
      `select
         (select count(*) from source_items where source_id = ?) as itemCount,
         (select count(*) from source_fields join source_endpoints on source_endpoints.endpoint_id = source_fields.endpoint_id where source_endpoints.source_id = ?) as fieldCount,
         (select count(*) from entity_candidates join source_items on source_items.source_item_id = entity_candidates.source_item_id where source_items.source_id = ?) as entityCandidateCount,
         (select count(*) from relationship_candidates join source_items on source_items.source_item_id = relationship_candidates.source_item_id where source_items.source_id = ?) as relationshipCandidateCount`,
    ).get([sourceId, sourceId, sourceId, sourceId]) as {
      itemCount: number;
      fieldCount: number;
      entityCandidateCount: number;
      relationshipCandidateCount: number;
    };
    return { ...source, ...latestRun, ...latestArtifact, ...counts };
  }

  listSources(): Array<{
    sourceId: string;
    title: string;
    latestStatus?: string;
    latestRunFinishedAt?: string;
  }> {
    return this.db.prepare(
      `select
         sources.source_id as sourceId,
         sources.title as title,
         (
           select status from source_runs
           where source_runs.source_id = sources.source_id
           order by coalesce(finished_at, started_at) desc
           limit 1
         ) as latestStatus,
         (
           select finished_at from source_runs
           where source_runs.source_id = sources.source_id
           order by coalesce(finished_at, started_at) desc
           limit 1
         ) as latestRunFinishedAt
       from sources
       order by sources.source_id`,
    ).all() as Array<{
      sourceId: string;
      title: string;
      latestStatus?: string;
      latestRunFinishedAt?: string;
    }>;
  }

  listReviewItems(mode?: string): ReviewItemRecord[] {
    let sql =
      "select review_item_id as reviewItemId, item_type as itemType, subject_id as subjectId, reason, default_action as defaultAction, status, details_json as detailsJson from review_items where status != 'resolved'";
    if (mode === "entities") {
      sql += " and item_type = 'entity_candidate'";
    } else if (mode === "relationships") {
      sql += " and item_type = 'relationship_candidate'";
    } else if (mode === "legal") {
      sql += " and item_type = 'legal_ref'";
    } else if (mode === "sources") {
      sql += " and item_type = 'source_status'";
    }
    sql += " order by status = 'deferred', created_at, review_item_id";
    const rows = this.db.prepare(sql).all() as Array<{
      reviewItemId: string;
      itemType: ReviewItemRecord["itemType"];
      subjectId: string;
      reason: string;
      defaultAction: string;
      status: ReviewStatus;
      detailsJson: string;
    }>;
    return rows.map((row) => ({
      reviewItemId: row.reviewItemId,
      itemType: row.itemType,
      subjectId: row.subjectId,
      reason: row.reason,
      defaultAction: row.defaultAction,
      status: row.status,
      details: JSON.parse(row.detailsJson),
    }));
  }

  nextReviewItem(mode?: string): ReviewItemRecord | undefined {
    return this.listReviewItems(mode).at(0);
  }

  async appendResolutionEvent(
    event: ResolutionEventInput,
    resolutionsDir: string,
  ): Promise<{ filePath: string; sequenceNumber: number }> {
    const dayDir = join(resolutionsDir, compactDatePart());
    await ensureDir(dayDir);
    const filePath = join(dayDir, "001-auto-review.jsonl");
    let sequenceNumber = 1;
    try {
      const existing = await Deno.readTextFile(filePath);
      sequenceNumber = existing.split("\n").filter(Boolean).length + 1;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    const line = JSON.stringify({
      event_type: event.eventType,
      subject_id: event.subjectId,
      payload: event.payload,
    });
    await Deno.writeTextFile(filePath, `${line}\n`, { append: true, create: true });
    this.applyResolutionEvent(event, relative(Deno.cwd(), filePath), sequenceNumber);
    return { filePath, sequenceNumber };
  }

  applyResolutionEvent(
    event: ResolutionEventInput,
    resolutionFile: string,
    sequenceNumber: number,
  ): void {
    const eventId = makeId("resolution");
    this.db.prepare(
      "insert into resolution_events(event_id, event_type, subject_id, payload_json, resolution_file, sequence_number, created_at) values(?, ?, ?, ?, ?, ?, ?)",
    ).run([
      eventId,
      event.eventType,
      event.subjectId,
      JSON.stringify(event.payload),
      resolutionFile,
      sequenceNumber,
      nowIso(),
    ]);
    switch (event.eventType) {
      case "accept_entity_candidate":
        this.acceptEntityCandidate(event.subjectId, event.payload);
        break;
      case "reject_entity_candidate":
        this.setEntityCandidateStatus(event.subjectId, "rejected");
        this.resolveReviewBySubject(event.subjectId);
        break;
      case "merge_entity_candidates":
        this.mergeEntityCandidates(event.payload);
        break;
      case "set_entity_fields":
        this.setEntityFields(event.payload);
        break;
      case "accept_relationship_candidate":
        this.acceptRelationshipCandidate(event.subjectId, event.payload, eventId);
        break;
      case "reject_relationship_candidate":
        this.setRelationshipCandidateStatus(event.subjectId, "rejected");
        this.resolveReviewBySubject(event.subjectId);
        break;
      case "defer_review_item":
        this.setReviewStatus(event.subjectId, "deferred");
        break;
      case "reopen_review_item":
        this.setReviewStatus(event.subjectId, "open");
        break;
    }
  }

  async replayResolutionDirectory(resolutionsDir: string): Promise<void> {
    const files: string[] = [];
    for await (const entry of Deno.readDir(resolutionsDir)) {
      if (!entry.isDirectory) continue;
      const subdir = join(resolutionsDir, entry.name);
      for await (const child of Deno.readDir(subdir)) {
        if (child.isFile && child.name.endsWith(".jsonl")) {
          files.push(join(subdir, child.name));
        }
      }
    }
    files.sort();
    this.db.exec("delete from resolution_events");
    this.db.exec("delete from canonical_relationships");
    this.db.exec("delete from canonical_entities");
    this.db.prepare("update entity_candidates set review_status = 'pending'").run();
    this.db.prepare("update relationship_candidates set review_status = 'pending'").run();
    this.db.prepare("update review_items set status = 'open' where status = 'resolved'").run();
    for (const file of files) {
      const content = await Deno.readTextFile(file);
      const lines = content.split("\n").filter(Boolean);
      for (const [index, line] of lines.entries()) {
        const parsed = JSON.parse(line) as {
          event_type: ResolutionEventInput["eventType"];
          subject_id: string;
          payload: Record<string, unknown>;
        };
        this.applyResolutionEvent(
          { eventType: parsed.event_type, subjectId: parsed.subject_id, payload: parsed.payload },
          relative(Deno.cwd(), file),
          index + 1,
        );
      }
    }
  }

  searchEntities(query: string): EntitySearchResult[] {
    return this.db.prepare(
      `select entity_id as entityId, name, kind, review_status as reviewStatus
       from canonical_entities
       where entity_id like ? collate nocase or name like ? collate nocase
       order by name`,
    ).all([`%${query}%`, `%${query}%`]) as EntitySearchResult[];
  }

  entityView(entityId: string): EntityView {
    const entity = this.db.prepare(
      "select entity_id as entityId, name, kind, branch, cluster, official_url as officialUrl, review_status as reviewStatus from canonical_entities where entity_id = ?",
    ).get([entityId]) as
      | Omit<EntityView, "evidence" | "outgoing" | "incoming" | "reviewItems" | "legalRefs">
      | undefined;
    if (!entity) throw new Error(`Entity not found: ${entityId}`);
    const evidence = this.db.prepare(
      `select field_path as fieldPath, observed_value as observedValue, source_id as sourceId
       from entity_candidate_evidence
       where candidate_id in (
         select value from json_each((select merged_candidate_ids from canonical_entities where entity_id = ?))
       )
       order by field_path`,
    ).all([entityId]) as Array<{ fieldPath: string; observedValue: string; sourceId: string }>;
    const outgoing = this.db.prepare(
      `select canonical_relationships.relationship_type as relationshipType,
              canonical_relationships.to_entity_id as targetEntityId,
              canonical_entities.name as targetName
       from canonical_relationships
       join canonical_entities on canonical_entities.entity_id = canonical_relationships.to_entity_id
       where canonical_relationships.from_entity_id = ?
       order by canonical_relationships.relationship_type, canonical_entities.name`,
    ).all([entityId]) as Array<
      { relationshipType: string; targetEntityId: string; targetName: string }
    >;
    const incomingRows = this.db.prepare(
      `select canonical_relationships.relationship_type as relationshipType,
              canonical_relationships.from_entity_id as sourceEntityId,
              canonical_entities.name as sourceName
       from canonical_relationships
       join canonical_entities on canonical_entities.entity_id = canonical_relationships.from_entity_id
       where canonical_relationships.to_entity_id = ?
       order by canonical_relationships.relationship_type, canonical_entities.name`,
    ).all([entityId]) as Array<
      { relationshipType: string; sourceEntityId: string; sourceName: string }
    >;
    const reviewItems = this.db.prepare(
      "select review_item_id as reviewItemId, item_type as itemType, subject_id as subjectId, reason, default_action as defaultAction, status, details_json as detailsJson from review_items where status != 'resolved' and (subject_id = ? or subject_id like ?)",
    ).all([entityId, `%${entityId}%`]) as Array<{
      reviewItemId: string;
      itemType: ReviewItemRecord["itemType"];
      subjectId: string;
      reason: string;
      defaultAction: string;
      status: ReviewStatus;
      detailsJson: string;
    }>;
    const legalRefs = this.db.prepare(
      `select legal_refs.citation_text as citationText,
              legal_refs.normalized_citation as normalizedCitation,
              legal_refs.ref_type as refType
       from legal_refs
       join entity_legal_refs on entity_legal_refs.legal_ref_id = legal_refs.legal_ref_id
       where entity_legal_refs.entity_id = ?
       order by legal_refs.normalized_citation, legal_refs.citation_text`,
    ).all([entityId]) as Array<
      { citationText: string; normalizedCitation?: string; refType: string }
    >;
    return {
      ...entity,
      evidence,
      outgoing,
      incoming: incomingRows.map((row) => ({
        relationshipType: inverseRelationshipType(row.relationshipType),
        sourceEntityId: row.sourceEntityId,
        sourceName: row.sourceName,
      })),
      reviewItems: reviewItems.map((row) => ({
        reviewItemId: row.reviewItemId,
        itemType: row.itemType,
        subjectId: row.subjectId,
        reason: row.reason,
        defaultAction: row.defaultAction,
        status: row.status,
        details: JSON.parse(row.detailsJson),
      })),
      legalRefs,
    };
  }

  canonicalEntities(): Array<Record<string, unknown>> {
    return this.db.prepare(
      "select entity_id as id, name, kind, branch, cluster, official_url as official_url, review_status as review_status from canonical_entities order by name",
    ).all() as Array<Record<string, unknown>>;
  }

  canonicalRelationships(): Array<Record<string, unknown>> {
    return this.db.prepare(
      "select relationship_id as id, from_entity_id, relationship_type, to_entity_id, review_status from canonical_relationships order by from_entity_id, relationship_type, to_entity_id",
    ).all() as Array<Record<string, unknown>>;
  }

  sourceInventory(): Array<Record<string, unknown>> {
    return this.db.prepare(
      `select
         sources.source_id as source_id,
         sources.title as title,
         sources.kind as kind,
         sources.access_method as access_method,
         (
           select status from source_runs
           where source_runs.source_id = sources.source_id
           order by coalesce(finished_at, started_at) desc
           limit 1
         ) as latest_status,
         (
           select finished_at from source_runs
           where source_runs.source_id = sources.source_id
           order by coalesce(finished_at, started_at) desc
           limit 1
         ) as latest_run_finished_at,
         (
           select path from source_artifacts
           join source_runs on source_runs.run_id = source_artifacts.run_id
           where source_runs.source_id = sources.source_id
           order by source_artifacts.created_at desc
           limit 1
         ) as latest_artifact_path
       from sources
       order by sources.source_id`,
    ).all() as Array<Record<string, unknown>>;
  }

  datasets(): Array<Record<string, unknown>> {
    return this.db.prepare(
      "select dataset_id as id, name, category, owner_name, access_method, artifact_depth, official_url, review_status from datasets order by name",
    ).all() as Array<Record<string, unknown>>;
  }

  legalRefs(): Array<Record<string, unknown>> {
    return this.db.prepare(
      "select legal_ref_id as id, ref_type, citation_text, normalized_citation, url, review_status from legal_refs order by normalized_citation, citation_text",
    ).all() as Array<Record<string, unknown>>;
  }

  artifactHashes(): Array<{ path: string; contentHash: string }> {
    return this.db.prepare(
      "select path, content_hash as contentHash from source_artifacts order by path",
    ).all() as Array<{ path: string; contentHash: string }>;
  }

  private acceptEntityCandidate(candidateId: string, payload: Record<string, unknown>): void {
    const candidate = this.db.prepare(
      "select proposed_entity_id as proposedEntityId, name, kind, branch, cluster, official_url as officialUrl, review_status as reviewStatus from entity_candidates where candidate_id = ?",
    ).get([candidateId]) as {
      proposedEntityId: string;
      name: string;
      kind: string;
      branch?: string;
      cluster?: string;
      officialUrl?: string;
      reviewStatus: CandidateStatus;
    } | undefined;
    if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
    if (candidate.reviewStatus === "rejected") {
      throw new Error(`Conflict: candidate ${candidateId} was already rejected`);
    }
    const entityId = String(payload.entityId ?? candidate.proposedEntityId);
    const existing = this.db.prepare(
      "select merged_candidate_ids as mergedCandidateIds from canonical_entities where entity_id = ?",
    ).get([entityId]) as { mergedCandidateIds: string } | undefined;
    if (!existing) {
      this.db.prepare(
        "insert into canonical_entities(entity_id, name, kind, branch, cluster, official_url, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)",
      ).run([
        entityId,
        candidate.name,
        candidate.kind,
        candidate.branch ?? null,
        candidate.cluster ?? null,
        candidate.officialUrl ?? null,
        JSON.stringify([candidateId]),
        nowIso(),
        nowIso(),
      ]);
    } else {
      const merged = JSON.parse(existing.mergedCandidateIds) as string[];
      if (!merged.includes(candidateId)) merged.push(candidateId);
      this.db.prepare(
        "update canonical_entities set merged_candidate_ids = ?, updated_at = ? where entity_id = ?",
      ).run([JSON.stringify(merged), nowIso(), entityId]);
    }
    this.setEntityCandidateStatus(candidateId, "accepted");
    this.resolveReviewBySubject(candidateId);
  }

  private mergeEntityCandidates(payload: Record<string, unknown>): void {
    const entityId = String(payload.entityId);
    const candidateIds = payload.candidateIds as string[];
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      throw new Error("merge_entity_candidates requires candidateIds");
    }
    for (const candidateId of candidateIds) {
      this.acceptEntityCandidate(candidateId, { entityId });
    }
  }

  private setEntityFields(payload: Record<string, unknown>): void {
    const entityId = String(payload.entityId);
    const current = this.db.prepare(
      "select name, kind, branch, cluster, official_url as officialUrl from canonical_entities where entity_id = ?",
    ).get([entityId]) as {
      name: string;
      kind: string;
      branch?: string;
      cluster?: string;
      officialUrl?: string;
    } | undefined;
    if (!current) throw new Error(`Entity not found: ${entityId}`);
    const fields = payload.fields as Record<string, unknown>;
    const next = { ...current, ...fields };
    for (const key of ["name", "kind", "branch", "cluster", "officialUrl"] as const) {
      const before = current[key];
      const after = next[key];
      if (before && after && before !== after && key !== "branch" && key !== "cluster") {
        throw new Error(`Conflict: ${entityId}.${key} already set to ${before}`);
      }
    }
    this.db.prepare(
      "update canonical_entities set name = ?, kind = ?, branch = ?, cluster = ?, official_url = ?, updated_at = ? where entity_id = ?",
    ).run([
      String(next.name),
      String(next.kind),
      next.branch ?? null,
      next.cluster ?? null,
      next.officialUrl ?? null,
      nowIso(),
      entityId,
    ]);
  }

  private acceptRelationshipCandidate(
    relationshipCandidateId: string,
    payload: Record<string, unknown>,
    eventId: string,
  ): void {
    const candidate = this.db.prepare(
      "select from_entity_ref as fromEntityRef, to_entity_ref as toEntityRef, relationship_type as relationshipType, review_status as reviewStatus from relationship_candidates where relationship_candidate_id = ?",
    ).get([relationshipCandidateId]) as {
      fromEntityRef: string;
      toEntityRef: string;
      relationshipType: string;
      reviewStatus: CandidateStatus;
    } | undefined;
    if (!candidate) throw new Error(`Relationship candidate not found: ${relationshipCandidateId}`);
    if (candidate.reviewStatus === "rejected") {
      throw new Error(`Conflict: relationship candidate ${relationshipCandidateId} was rejected`);
    }
    const relationshipType = String(payload.relationshipType ?? candidate.relationshipType);
    const fromEntityId = this.ensureEntityExists(
      String(payload.fromEntityId ?? candidate.fromEntityRef),
    );
    const toEntityId = this.ensureEntityExists(String(payload.toEntityId ?? candidate.toEntityRef));
    const relationshipId = `${fromEntityId}:${relationshipType}:${toEntityId}`;
    const existing = this.db.prepare(
      "select relationship_id from canonical_relationships where relationship_id = ?",
    ).get([relationshipId]);
    if (!existing) {
      this.db.prepare(
        "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values(?, ?, ?, ?, 'accepted', ?, ?)",
      ).run([relationshipId, fromEntityId, relationshipType, toEntityId, eventId, nowIso()]);
    }
    this.setRelationshipCandidateStatus(relationshipCandidateId, "accepted");
    this.resolveReviewBySubject(relationshipCandidateId);
  }

  private ensureEntityExists(entityId: string): string {
    const existing = this.db.prepare(
      "select entity_id from canonical_entities where entity_id = ?",
    ).get([entityId]);
    if (existing) return entityId;
    const name = entityId.split(".").slice(1).join(" ").replaceAll("_", " ").replaceAll(
      /\b\w/g,
      (part) => part.toUpperCase(),
    );
    this.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'placeholder', 'needs_review', '[]', ?, ?)",
    ).run([entityId, name, nowIso(), nowIso()]);
    return entityId;
  }

  private setEntityCandidateStatus(candidateId: string, status: CandidateStatus): void {
    this.db.prepare("update entity_candidates set review_status = ? where candidate_id = ?").run([
      status,
      candidateId,
    ]);
  }

  private setRelationshipCandidateStatus(candidateId: string, status: CandidateStatus): void {
    this.db.prepare(
      "update relationship_candidates set review_status = ? where relationship_candidate_id = ?",
    ).run([status, candidateId]);
  }

  private resolveReviewBySubject(subjectId: string): void {
    this.db.prepare(
      "update review_items set status = 'resolved', updated_at = ? where subject_id = ?",
    ).run([
      nowIso(),
      subjectId,
    ]);
  }

  private setReviewStatus(reviewItemId: string, status: ReviewStatus): void {
    this.db.prepare("update review_items set status = ?, updated_at = ? where review_item_id = ?")
      .run([
        status,
        nowIso(),
        reviewItemId,
      ]);
  }
}

async function writeArtifact(
  dataDir: string,
  sourceId: string,
  endpointId: string,
  extension: string,
  content: string,
): Promise<string> {
  const directory = join(dataDir, sourceId, endpointId, compactDatePart());
  await ensureDir(directory);
  const filePath = join(directory, `${makeId("artifact")}.${extension}`);
  await ensureDir(dirname(filePath));
  await Deno.writeTextFile(filePath, content);
  return relative(Deno.cwd(), filePath);
}

function requireItem(
  itemIndex: Map<string, { sourceItemId: string; artifactPath: string }>,
  itemKey: string,
): { sourceItemId: string; artifactPath: string } {
  const item = itemIndex.get(itemKey);
  if (!item) throw new Error(`Missing source item for key ${itemKey}`);
  return item;
}

function makeId(prefix: string): string {
  return `${prefix}.${crypto.randomUUID()}`;
}
