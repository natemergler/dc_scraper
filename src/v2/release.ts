import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { readGitCommit } from "./git.ts";
import { Workbench } from "./workbench.ts";
import { nowIso, sha256BytesHex, type SmokeProfile } from "./domain.ts";
import { buildWorkbenchStatus } from "./status.ts";
import { MANIFEST_VERSION, TOOL_VERSION } from "./version.ts";
import { containsLocalPath } from "./url_safety.ts";
import { withTransaction } from "./workbench/db.ts";

type EntityRow = ReturnType<Workbench["canonicalEntities"]>[number];
type RelationshipRow = ReturnType<Workbench["canonicalRelationships"]>[number];
type SourceRow = ReturnType<Workbench["sourceInventory"]>[number];
type DatasetRow = ReturnType<Workbench["datasets"]>[number];
type LegalRefRow = ReturnType<Workbench["legalRefs"]>[number];
type EntityLegalRefRow = ReturnType<Workbench["entityLegalRefs"]>[number];
type RelationshipLegalRefRow = ReturnType<Workbench["relationshipLegalRefs"]>[number];
type SourceArtifactRow = ReturnType<Workbench["sourceArtifacts"]>[number];

export interface BuildReleaseOptions {
  sourceProfile?: SmokeProfile | "custom";
  repoRoot?: string;
  gitCommit?: string;
  toolVersion?: string;
  onProgress?: (event: ReleaseBuildProgressEvent) => void;
}

export interface ReleaseBuildProgressEvent {
  phase:
    | "prepare"
    | "read-workbench"
    | "summarize"
    | "write-files"
    | "write-sqlite"
    | "write-manifest";
  message: string;
  counts?: Partial<
    Record<"entities" | "relationships" | "sources" | "datasets" | "legalRefs", number>
  >;
  fileCount?: number;
}

export async function buildV2Release(
  workbench: Workbench,
  outDir: string,
  options: BuildReleaseOptions = {},
): Promise<{ outDir: string; fileNames: string[] }> {
  emitReleaseProgress(options, {
    phase: "prepare",
    message: `Preparing release directory ${outDir}`,
  });
  await resetReleaseDirectory(outDir);
  emitReleaseProgress(options, {
    phase: "read-workbench",
    message: "Reading accepted release rows",
  });
  const entities: EntityRow[] = workbench.canonicalEntities();
  const relationships: RelationshipRow[] = workbench.canonicalRelationships();
  const sources: SourceRow[] = workbench.sourceInventory();
  const datasets: DatasetRow[] = workbench.datasets();
  const legalRefs: LegalRefRow[] = workbench.legalRefs();
  const entityLegalRefs: EntityLegalRefRow[] = workbench.entityLegalRefs();
  const relationshipLegalRefs: RelationshipLegalRefRow[] = workbench.relationshipLegalRefs();
  const sourceArtifacts: SourceArtifactRow[] = workbench.sourceArtifacts();
  emitReleaseProgress(options, {
    phase: "summarize",
    message: "Building release summary",
    counts: {
      entities: entities.length,
      relationships: relationships.length,
      sources: sources.length,
      datasets: datasets.length,
      legalRefs: legalRefs.length,
    },
  });
  const summary = buildReleaseSummary(
    workbench,
    entities,
    relationships,
    sources,
    datasets,
    legalRefs,
    entityLegalRefs,
    relationshipLegalRefs,
  );
  assertNoContactInfo("release_summary", JSON.stringify(summary));
  const files = new Map<string, string>();
  files.set("entities.json", JSON.stringify(entities, null, 2));
  files.set("relationships.json", JSON.stringify(relationships, null, 2));
  files.set("sources.json", JSON.stringify(sources, null, 2));
  files.set("datasets.json", JSON.stringify(datasets, null, 2));
  files.set("legal_refs.json", JSON.stringify(legalRefs, null, 2));
  files.set("entity_legal_refs.json", JSON.stringify(entityLegalRefs, null, 2));
  files.set("relationship_legal_refs.json", JSON.stringify(relationshipLegalRefs, null, 2));
  files.set(
    "entities.csv",
    toCsv(
      ["id", "name", "kind", "branch", "cluster", "official_url", "review_status"],
      entities,
    ),
  );
  files.set(
    "relationships.csv",
    toCsv(
      ["id", "from_entity_id", "relationship_type", "to_entity_id", "review_status"],
      relationships,
    ),
  );
  files.set(
    "sources.csv",
    toCsv(
      [
        "source_id",
        "title",
        "kind",
        "access_method",
        "latest_status",
        "latest_run_finished_at",
        "latest_endpoint_id",
        "latest_artifact_kind",
        "latest_fetched_url",
        "latest_content_hash",
        "latest_size_bytes",
        "latest_observed_at",
      ],
      sources,
    ),
  );
  files.set(
    "datasets.csv",
    toCsv(
      [
        "id",
        "name",
        "category",
        "owner_name",
        "access_method",
        "artifact_depth",
        "official_url",
        "review_status",
      ],
      datasets,
    ),
  );
  files.set(
    "legal_refs.csv",
    toCsv(
      [
        "id",
        "ref_type",
        "citation_text",
        "normalized_citation",
        "url",
        "source_id",
        "source_item_id",
        "source_url",
        "needs_review",
        "review_status",
      ],
      legalRefs,
    ),
  );
  files.set(
    "entity_legal_refs.csv",
    toCsv(
      [
        "entity_id",
        "entity_name",
        "legal_ref_id",
        "ref_type",
        "citation_text",
        "normalized_citation",
        "url",
        "review_status",
      ],
      entityLegalRefs,
    ),
  );
  files.set(
    "relationship_legal_refs.csv",
    toCsv(
      [
        "relationship_id",
        "from_entity_id",
        "from_entity_name",
        "relationship_type",
        "to_entity_id",
        "to_entity_name",
        "legal_ref_id",
        "ref_type",
        "citation_text",
        "normalized_citation",
        "url",
        "review_status",
      ],
      relationshipLegalRefs,
    ),
  );
  assertReleaseFilesDoNotContainContactInfo(files);
  emitReleaseProgress(options, {
    phase: "write-files",
    message: "Writing CSV and JSON exports",
    fileCount: files.size,
  });
  for (const [name, content] of files) {
    await Deno.writeTextFile(join(outDir, name), content);
  }
  emitReleaseProgress(options, {
    phase: "write-sqlite",
    message: "Writing dcgov.sqlite",
    counts: {
      entities: entities.length,
      relationships: relationships.length,
      sources: sources.length,
      datasets: datasets.length,
      legalRefs: legalRefs.length,
    },
  });
  await buildReleaseSqlite(join(outDir, "dcgov.sqlite"), {
    entities,
    relationships,
    sources,
    datasets,
    legalRefs,
    entityLegalRefs,
    relationshipLegalRefs,
  });
  emitReleaseProgress(options, {
    phase: "write-manifest",
    message: "Writing README and manifest",
    fileCount: files.size + 3,
  });
  const readme = buildReadme(summary);
  await Deno.writeTextFile(join(outDir, "README.md"), readme);
  const generatedAt = nowIso();
  const gitCommit = options.gitCommit ?? await readGitCommit(options.repoRoot ?? Deno.cwd());
  const sourceProfile = options.sourceProfile ?? "custom";
  const toolVersion = options.toolVersion ?? TOOL_VERSION;
  const manifest = {
    manifest_version: MANIFEST_VERSION,
    release_id: buildReleaseId(generatedAt, gitCommit),
    tool_version: toolVersion,
    git_commit: gitCommit,
    source_profile: sourceProfile,
    schema_version: workbench.meta().schema.version,
    generated_at: generatedAt,
    files: await Promise.all(
      ["README.md", "dcgov.sqlite", ...files.keys()].map(async (name) => ({
        name,
        sha256: await fileSha(join(outDir, name)),
      })),
    ),
    release_summary: summary,
    source_artifacts: sourceArtifacts,
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  assertNoContactInfo("manifest.json", manifestText);
  await Deno.writeTextFile(join(outDir, "manifest.json"), manifestText);
  return {
    outDir,
    fileNames: [...Array.from(manifest.files, (file) => file.name), "manifest.json"],
  };
}

function emitReleaseProgress(
  options: BuildReleaseOptions,
  event: ReleaseBuildProgressEvent,
): void {
  options.onProgress?.(event);
}

function buildReleaseId(generatedAt: string, gitCommit: string): string {
  const timestamp = generatedAt.replaceAll(/[^0-9]/g, "").slice(0, 14);
  const shortCommit = gitCommit === "unknown" ? "unknown" : gitCommit.slice(0, 12);
  return `release.${timestamp}.${shortCommit}`;
}

async function resetReleaseDirectory(outDir: string): Promise<void> {
  await Deno.remove(outDir, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await ensureDir(outDir);
}

function assertReleaseFilesDoNotContainContactInfo(files: Map<string, string>): void {
  for (const [name, content] of files) {
    assertNoContactInfo(name, content);
  }
}

function assertNoContactInfo(name: string, content: string): void {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(content)) {
    throw new Error(`Release output contains email-shaped contact info in ${name}`);
  }
  if (/\b(?:tel:)?(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/i.test(content)) {
    throw new Error(`Release output contains phone-shaped contact info in ${name}`);
  }
  if (containsLocalPath(content)) {
    throw new Error(`Release output contains local path-shaped info in ${name}`);
  }
}

async function buildReleaseSqlite(
  path: string,
  rows: {
    entities: EntityRow[];
    relationships: RelationshipRow[];
    sources: SourceRow[];
    datasets: DatasetRow[];
    legalRefs: LegalRefRow[];
    entityLegalRefs: EntityLegalRefRow[];
    relationshipLegalRefs: RelationshipLegalRefRow[];
  },
): Promise<void> {
  await Deno.remove(path).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  const db = new Database(path);
  try {
    db.exec(`
      pragma foreign_keys = on;

      create table entities (
        id text primary key,
        name text not null,
        kind text not null,
        branch text,
        cluster text,
        official_url text,
        review_status text not null
      );

      create table relationships (
        id text primary key,
        from_entity_id text not null,
        relationship_type text not null,
        to_entity_id text not null,
        review_status text not null,
        foreign key (from_entity_id) references entities(id),
        foreign key (to_entity_id) references entities(id)
      );

      create view incoming_relationships as
        select
          relationships.to_entity_id as entity_id,
          relationships.relationship_type as relationship_type,
          relationships.from_entity_id as source_entity_id,
          entities.name as source_name,
          relationships.review_status as review_status
        from relationships
        left join entities on entities.id = relationships.from_entity_id;

      create table sources (
        source_id text primary key,
        title text not null,
        kind text not null,
        access_method text not null,
        latest_status text,
        latest_run_finished_at text,
        latest_endpoint_id text,
        latest_artifact_kind text,
        latest_fetched_url text,
        latest_content_hash text,
        latest_size_bytes integer,
        latest_observed_at text
      );

      create table datasets (
        id text primary key,
        name text not null,
        category text not null,
        owner_name text,
        access_method text not null,
        artifact_depth text not null,
        official_url text,
        review_status text not null
      );

      create table legal_refs (
        id text primary key,
        ref_type text not null,
        citation_text text not null,
        normalized_citation text,
        url text,
        source_id text not null,
        source_item_id text not null,
        source_url text,
        needs_review integer not null,
        review_status text not null
      );

      create table entity_legal_refs (
        entity_id text not null,
        entity_name text not null,
        legal_ref_id text not null,
        ref_type text not null,
        citation_text text not null,
        normalized_citation text,
        url text,
        review_status text not null,
        foreign key (entity_id) references entities(id),
        foreign key (legal_ref_id) references legal_refs(id)
      );

      create table relationship_legal_refs (
        relationship_id text not null,
        from_entity_id text not null,
        from_entity_name text not null,
        relationship_type text not null,
        to_entity_id text not null,
        to_entity_name text not null,
        legal_ref_id text not null,
        ref_type text not null,
        citation_text text not null,
        normalized_citation text,
        url text,
        review_status text not null,
        foreign key (relationship_id) references relationships(id),
        foreign key (from_entity_id) references entities(id),
        foreign key (to_entity_id) references entities(id),
        foreign key (legal_ref_id) references legal_refs(id)
      );
    `);
    withTransaction(db, () => {
      const insertEntity = db.prepare(
        "insert into entities(id, name, kind, branch, cluster, official_url, review_status) values(?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of rows.entities) {
        insertEntity.run([
          row.id,
          row.name,
          row.kind,
          row.branch ?? null,
          row.cluster ?? null,
          row.official_url ?? null,
          row.review_status,
        ]);
      }
      const insertRelationship = db.prepare(
        "insert into relationships(id, from_entity_id, relationship_type, to_entity_id, review_status) values(?, ?, ?, ?, ?)",
      );
      for (const row of rows.relationships) {
        insertRelationship.run([
          row.id,
          row.from_entity_id,
          row.relationship_type,
          row.to_entity_id,
          row.review_status,
        ]);
      }
      const insertSource = db.prepare(
        "insert into sources(source_id, title, kind, access_method, latest_status, latest_run_finished_at, latest_endpoint_id, latest_artifact_kind, latest_fetched_url, latest_content_hash, latest_size_bytes, latest_observed_at) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of rows.sources) {
        insertSource.run([
          row.source_id,
          row.title,
          row.kind,
          row.access_method,
          row.latest_status ?? null,
          row.latest_run_finished_at ?? null,
          row.latest_endpoint_id ?? null,
          row.latest_artifact_kind ?? null,
          row.latest_fetched_url ?? null,
          row.latest_content_hash ?? null,
          row.latest_size_bytes ?? null,
          row.latest_observed_at ?? null,
        ]);
      }
      const insertDataset = db.prepare(
        "insert into datasets(id, name, category, owner_name, access_method, artifact_depth, official_url, review_status) values(?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of rows.datasets) {
        insertDataset.run([
          row.id,
          row.name,
          row.category,
          row.owner_name ?? null,
          row.access_method,
          row.artifact_depth,
          row.official_url ?? null,
          row.review_status,
        ]);
      }
      const insertLegalRef = db.prepare(
        "insert into legal_refs(id, ref_type, citation_text, normalized_citation, url, source_id, source_item_id, source_url, needs_review, review_status) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of rows.legalRefs) {
        insertLegalRef.run([
          row.id,
          row.ref_type,
          row.citation_text,
          row.normalized_citation ?? null,
          row.url ?? null,
          row.source_id,
          row.source_item_id,
          row.source_url ?? null,
          row.needs_review,
          row.review_status,
        ]);
      }
      const insertEntityLegalRef = db.prepare(
        "insert into entity_legal_refs(entity_id, entity_name, legal_ref_id, ref_type, citation_text, normalized_citation, url, review_status) values(?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of rows.entityLegalRefs) {
        insertEntityLegalRef.run([
          row.entity_id,
          row.entity_name,
          row.legal_ref_id,
          row.ref_type,
          row.citation_text,
          row.normalized_citation ?? null,
          row.url ?? null,
          row.review_status,
        ]);
      }
      const insertRelationshipLegalRef = db.prepare(
        "insert into relationship_legal_refs(relationship_id, from_entity_id, from_entity_name, relationship_type, to_entity_id, to_entity_name, legal_ref_id, ref_type, citation_text, normalized_citation, url, review_status) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of rows.relationshipLegalRefs) {
        insertRelationshipLegalRef.run([
          row.relationship_id,
          row.from_entity_id,
          row.from_entity_name,
          row.relationship_type,
          row.to_entity_id,
          row.to_entity_name,
          row.legal_ref_id,
          row.ref_type,
          row.citation_text,
          row.normalized_citation ?? null,
          row.url ?? null,
          row.review_status,
        ]);
      }
    });
  } finally {
    db.close();
  }
}

function buildReadme(summary: ReturnType<typeof buildReleaseSummary>): string {
  const legalByType =
    summary.legal_refs_by_type.map((item) => `${item.ref_type}=${item.count}`).join(", ") || "none";
  return `# DCGov Release

This release contains compact canonical entities, directed relationships, source inventory, dataset inventory, legal references, and a queryable SQLite release database.

Files:
- \`README.md\`: package overview, model semantics, and release counts
- \`manifest.json\`: package metadata, file hashes, source inventory/artifact summary, and release summary
- \`dcgov.sqlite\`: release SQLite package
- \`entities.*\`: canonical entities
- \`relationships.*\`: directed canonical relationships
- \`sources.*\`: source inventory and latest artifact metadata
- \`datasets.*\`: public dataset inventory
- \`legal_refs.*\`: normalized and source-backed legal references
- \`entity_legal_refs.*\`: entity-linked legal reference attachments
- \`relationship_legal_refs.*\`: relationship-linked legal reference attachments

## Model semantics

\`entities.*\`: canonical civic entities such as public bodies, offices, seats/roles, status markers, and source-backed public official observations. Datasets and legal refs have their own tables.

Public official observations are source-backed role or seat observations, not a personnel or contact directory.

\`relationships.*\`: one directed fact per row, \`from_entity_id --relationship_type--> to_entity_id\`. Incoming/backlink views are derived from that directed row.

Relationship families: structure (\`part_of\`, \`has_seat\`, \`has_status\`), authority/source (\`governed_by\`, \`overseen_by\`, \`appointed_by\`, \`designated_by\`, \`authorized_by\`, \`published_by\`), and civic role (\`holds\`, \`represents\`, \`member_of\`, \`chairs\`).

Relationship direction guide: \`part_of\` points from a component to its containing entity; \`has_seat\`/\`has_status\` point from a body, seat, or observation to the seat/status marker; authority/source types point from the civic subject to the governing, oversight, appointment, designation, legal-authority, or publication source; civic-role types point from an observation or role entity to the seat, district, body, or committee role.

DC city/county distinctions are not inferred beyond source-backed civic structure labels.

## Release summary

- entities: total=${totalReviewStatusCount(summary.entities_by_review_status)}
- relationships: total=${totalReviewStatusCount(summary.relationships_by_review_status)}
- sources: total=${summary.source_count}
- datasets: total=${summary.dataset_count}
- legal refs: total=${totalReviewStatusCount(summary.legal_refs_by_review_status)}
- legal refs by type: ${legalByType}
- entity legal refs: total=${summary.entity_legal_refs_count}
- relationship legal refs: total=${summary.relationship_legal_refs_count}
`;
}

function buildReleaseSummary(
  workbench: Workbench,
  entities: EntityRow[],
  relationships: RelationshipRow[],
  sources: SourceRow[],
  datasets: DatasetRow[],
  legalRefs: LegalRefRow[],
  entityLegalRefs: EntityLegalRefRow[],
  relationshipLegalRefs: RelationshipLegalRefRow[],
) {
  const reviewByStatus = workbench.db.prepare(
    "select status, count(*) as count from review_items group by status order by status",
  ).all() as Array<{ status: string; count: number }>;
  const reviewByType = workbench.db.prepare(
    "select item_type as item_type, count(*) as count from review_items group by item_type order by item_type",
  ).all() as Array<{ item_type: string; count: number }>;
  const status = buildWorkbenchStatus(workbench);
  return {
    entities_by_review_status: countByReviewStatus(entities, (row) => row.review_status),
    relationships_by_review_status: countByReviewStatus(relationships, (row) => row.review_status),
    review_items_by_status: reviewByStatus,
    review_items_by_type: reviewByType,
    review_debt_by_type: status.review.byType.map((row) => ({
      item_type: row.itemType,
      open_count: row.openCount,
      deferred_count: row.deferredCount,
    })),
    review_debt_by_source: status.review.bySource.map((row) => ({
      source_id: row.sourceId,
      open_count: row.openCount,
      deferred_count: row.deferredCount,
    })),
    open_review_item_count: status.review.open,
    deferred_review_item_count: status.review.deferred,
    stale_review_item_count: status.staleReview.count,
    stale_review_by_prior_decision_state: status.staleReview.byPriorDecisionState.map((row) => ({
      prior_decision_state: row.priorDecisionState,
      count: row.count,
    })),
    blocked_reconciliation_count: status.reconciliation.blocked,
    blocked_reconciliation_by_source: status.reconciliation.blockedBySource.map((row) => ({
      source_id: row.sourceId,
      count: row.count,
    })),
    placeholder_entity_count: status.placeholders.count,
    source_count: sources.length,
    failed_source_count: status.sources.failed,
    dataset_count: datasets.length,
    legal_refs_by_type: countByRefType(legalRefs, (row) => row.ref_type),
    legal_refs_by_review_status: countByReviewStatus(legalRefs, (row) => row.review_status),
    entity_legal_refs_count: entityLegalRefs.length,
    relationship_legal_refs_count: relationshipLegalRefs.length,
  };
}

function countByReviewStatus<T>(
  rows: T[],
  value: (row: T) => string,
): Array<{ review_status: string; count: number }> {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const key = value(row);
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map((
    [review_status, count],
  ) => ({
    review_status,
    count,
  }));
}

function countByRefType<T>(
  rows: T[],
  value: (row: T) => string,
): Array<{ ref_type: string; count: number }> {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const key = value(row);
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ref_type, count]) => ({
    ref_type,
    count,
  }));
}

function totalReviewStatusCount(rows: Array<{ count: number }>): number {
  return rows.reduce((total, row) => total + row.count, 0);
}

function toCsv<T extends Record<string, string | number | null | undefined>>(
  columns: string[],
  rows: T[],
): string {
  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(","));
  return `${[header, ...lines].join("\n")}\n`;
}

function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

async function fileSha(path: string): Promise<string> {
  return `sha256:${await sha256BytesHex(await Deno.readFile(path))}`;
}
