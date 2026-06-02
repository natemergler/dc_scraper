import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { Workbench } from "./workbench.ts";
import { nowIso, sha256Hex } from "./domain.ts";

type EntityRow = ReturnType<Workbench["canonicalEntities"]>[number];
type RelationshipRow = ReturnType<Workbench["canonicalRelationships"]>[number];
type SourceRow = ReturnType<Workbench["sourceInventory"]>[number];
type DatasetRow = ReturnType<Workbench["datasets"]>[number];
type LegalRefRow = ReturnType<Workbench["legalRefs"]>[number];
type EntityLegalRefRow = ReturnType<Workbench["entityLegalRefs"]>[number];
type SourceArtifactRow = ReturnType<Workbench["sourceArtifacts"]>[number];

export async function buildV2Release(
  workbench: Workbench,
  outDir: string,
): Promise<{ outDir: string; fileNames: string[] }> {
  await resetReleaseDirectory(outDir);
  const entities: EntityRow[] = workbench.canonicalEntities();
  const relationships: RelationshipRow[] = workbench.canonicalRelationships();
  const sources: SourceRow[] = workbench.sourceInventory();
  const datasets: DatasetRow[] = workbench.datasets();
  const legalRefs: LegalRefRow[] = workbench.legalRefs();
  const entityLegalRefs: EntityLegalRefRow[] = workbench.entityLegalRefs();
  const sourceArtifacts: SourceArtifactRow[] = workbench.sourceArtifacts();
  const summary = buildReleaseSummary(
    workbench,
    entities,
    relationships,
    sources,
    datasets,
    legalRefs,
    entityLegalRefs,
  );
  const files = new Map<string, string>();
  files.set("entities.json", JSON.stringify(entities, null, 2));
  files.set("relationships.json", JSON.stringify(relationships, null, 2));
  files.set("sources.json", JSON.stringify(sources, null, 2));
  files.set("datasets.json", JSON.stringify(datasets, null, 2));
  files.set("legal_refs.json", JSON.stringify(legalRefs, null, 2));
  files.set("entity_legal_refs.json", JSON.stringify(entityLegalRefs, null, 2));
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
  assertReleaseFilesDoNotContainContactInfo(files);
  for (const [name, content] of files) {
    await Deno.writeTextFile(join(outDir, name), content);
  }
  await buildReleaseSqlite(join(outDir, "dcgov.sqlite"), {
    entities,
    relationships,
    sources,
    datasets,
    legalRefs,
    entityLegalRefs,
  });
  const readme = buildReadme(summary);
  await Deno.writeTextFile(join(outDir, "README.md"), readme);
  const manifest = {
    schema_version: workbench.meta().schemaVersion,
    generated_at: nowIso(),
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

function containsLocalPath(content: string): boolean {
  const decoded = repeatedlyDecodeURIComponent(content).replaceAll("\\", "/");
  return /\bfile:/i.test(decoded) ||
    /\b[a-z]:\/Users\//i.test(decoded) ||
    /(^|[^a-z])\/(?:tmp|var\/home|home)\/[^"',\s]+/i.test(decoded);
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

async function buildReleaseSqlite(
  path: string,
  rows: {
    entities: EntityRow[];
    relationships: RelationshipRow[];
    sources: SourceRow[];
    datasets: DatasetRow[];
    legalRefs: LegalRefRow[];
    entityLegalRefs: EntityLegalRefRow[];
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
    `);
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
  } finally {
    db.close();
  }
}

function buildReadme(summary: ReturnType<typeof buildReleaseSummary>): string {
  const entityStatus = renderStatusCounts(summary.entities_by_review_status);
  const relationshipStatus = renderStatusCounts(summary.relationships_by_review_status);
  const legalByType =
    summary.legal_refs_by_type.map((item) => `${item.ref_type}=${item.count}`).join(", ") || "none";
  const legalByStatus = renderStatusCounts(summary.legal_refs_by_review_status);
  const reviewByStatus =
    summary.review_items_by_status.map((item) => `${item.status}=${item.count}`).join(", ") ||
    "none";
  const reviewByType =
    summary.review_items_by_type.map((item) => `${item.item_type}=${item.count}`).join(", ") ||
    "none";
  const reviewDebtByType = renderReviewDebt(summary.review_debt_by_type, "item_type");
  const reviewDebtBySource = renderReviewDebt(summary.review_debt_by_source, "source_id");
  return `# DCGov v2 Release

This release contains compact canonical entities, directed relationships, source inventory, dataset inventory, legal references, and a queryable SQLite release database.

Files:
- \`dcgov.sqlite\`: release SQLite package
- \`entities.*\`: canonical entities
- \`relationships.*\`: directed canonical relationships
- \`sources.*\`: source inventory and latest artifact metadata
- \`datasets.*\`: public dataset inventory
- \`legal_refs.*\`: normalized and source-backed legal references
- \`entity_legal_refs.*\`: entity-linked legal reference attachments

Civic role relationship types used by the workbench: holds, represents, member_of, and chairs.

## Release summary

- entities by review_status: ${entityStatus}
- relationships by review_status: ${relationshipStatus}
- review items by status: ${reviewByStatus}
- review items by type: ${reviewByType}
- review debt by type: ${reviewDebtByType}
- review debt by source: ${reviewDebtBySource}
- stale review: ${summary.stale_review_item_count} (${
    renderStaleByPriorDecision(summary.stale_review_by_prior_decision_state)
  })
- sources: total=${summary.source_count}, failed=${summary.failed_source_count}
- datasets: total=${summary.dataset_count}
- legal refs by type: ${legalByType}
- legal refs by review_status: ${legalByStatus}
- entity legal refs: total=${summary.entity_legal_refs_count}
- review status note: ${summary.review_status_note}
- blocked by source: ${renderBlockedBySource(summary.blocked_reconciliation_by_source)}

Relationship coverage note: accepted relationships may represent only a partial reviewed slice of discovered relationship candidates.
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
) {
  const reviewByStatus = workbench.db.prepare(
    "select status, count(*) as count from review_items group by status order by status",
  ).all() as Array<{ status: string; count: number }>;
  const reviewByType = workbench.db.prepare(
    "select item_type as item_type, count(*) as count from review_items group by item_type order by item_type",
  ).all() as Array<{ item_type: string; count: number }>;
  const reviewStatusCounts = new Map(reviewByStatus.map((row) => [row.status, row.count]));
  const reviewDebt = workbench.reviewDebtSummary();
  const reconciliation = workbench.reconciliationSummary();
  const staleReview = workbench.staleReviewSummary();
  const placeholderEntityCount = workbench.db.prepare(
    "select count(*) as count from canonical_entities where is_placeholder = 1",
  ).get() as { count: number };
  const openReviewItemCount = reviewStatusCounts.get("open") ?? 0;
  const deferredReviewItemCount = reviewStatusCounts.get("deferred") ?? 0;
  return {
    entities_by_review_status: countByReviewStatus(entities, (row) => row.review_status),
    relationships_by_review_status: countByReviewStatus(relationships, (row) => row.review_status),
    review_items_by_status: reviewByStatus,
    review_items_by_type: reviewByType,
    review_debt_by_type: reviewDebt.byType.map((row) => ({
      item_type: row.itemType,
      open_count: row.openCount,
      deferred_count: row.deferredCount,
    })),
    review_debt_by_source: reviewDebt.bySource.map((row) => ({
      source_id: row.sourceId,
      open_count: row.openCount,
      deferred_count: row.deferredCount,
    })),
    open_review_item_count: openReviewItemCount,
    deferred_review_item_count: deferredReviewItemCount,
    stale_review_item_count: staleReview.count,
    stale_review_by_prior_decision_state: staleReview.byPriorDecisionState.map((row) => ({
      prior_decision_state: row.priorDecisionState,
      count: row.count,
    })),
    blocked_reconciliation_count: reconciliation.blockedCount,
    blocked_reconciliation_by_source: reconciliation.blockedBySource.map((row) => ({
      source_id: row.sourceId,
      count: row.count,
    })),
    placeholder_entity_count: placeholderEntityCount.count,
    review_status_note: buildReviewStatusNote({
      openReviewItemCount,
      deferredReviewItemCount,
      staleReviewItemCount: staleReview.count,
      blockedReconciliationCount: reconciliation.blockedCount,
      placeholderEntityCount: placeholderEntityCount.count,
    }),
    source_count: sources.length,
    failed_source_count: sources.filter((row) => row.latest_status === "failed").length,
    dataset_count: datasets.length,
    legal_refs_by_type: countByRefType(legalRefs, (row) => row.ref_type),
    legal_refs_by_review_status: countByReviewStatus(legalRefs, (row) => row.review_status),
    entity_legal_refs_count: entityLegalRefs.length,
  };
}

function buildReviewStatusNote(counts: {
  openReviewItemCount: number;
  deferredReviewItemCount: number;
  staleReviewItemCount: number;
  blockedReconciliationCount: number;
  placeholderEntityCount: number;
}): string {
  if (
    counts.openReviewItemCount === 0 &&
    counts.deferredReviewItemCount === 0 &&
    counts.staleReviewItemCount === 0 &&
    counts.blockedReconciliationCount === 0 &&
    counts.placeholderEntityCount === 0
  ) {
    return "No open review items, deferred review items, stale review items, blocked reconciliation items, or placeholder entities were present at release build time.";
  }
  return `Release built with unresolved workbench state: open review=${counts.openReviewItemCount}, deferred review=${counts.deferredReviewItemCount}, stale review=${counts.staleReviewItemCount}, blocked reconciliation=${counts.blockedReconciliationCount}, placeholder entities=${counts.placeholderEntityCount}.`;
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

function renderReviewDebt<T extends string>(
  rows: Array<Record<T, string> & { open_count: number; deferred_count: number }>,
  nameKey: T,
): string {
  return rows.map((row) => `${row[nameKey]}(open=${row.open_count},deferred=${row.deferred_count})`)
    .join(", ") || "none";
}

function renderStatusCounts(rows: Array<{ review_status: string; count: number }>): string {
  return rows.map((row) => `${row.review_status}=${row.count}`).join(", ") || "none";
}

function renderBlockedBySource(rows: Array<{ source_id: string; count: number }>): string {
  return rows.map((row) => `${row.source_id}=${row.count}`).join(", ") || "none";
}

function renderStaleByPriorDecision(
  rows: Array<{ prior_decision_state: string; count: number }> | undefined,
): string {
  return rows?.map((row) => `${row.prior_decision_state}=${row.count}`).join(", ") || "none";
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
  const content = await Deno.readTextFile(path).catch(async () => {
    const bytes = await Deno.readFile(path);
    return new TextDecoder().decode(bytes);
  });
  return `sha256:${await sha256Hex(content)}`;
}
