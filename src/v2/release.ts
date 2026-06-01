import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { Workbench } from "./workbench.ts";
import { nowIso, sha256Hex } from "./domain.ts";

type EntityRow = ReturnType<Workbench["canonicalEntities"]>[number];
type RelationshipRow = ReturnType<Workbench["canonicalRelationships"]>[number];
type SourceRow = ReturnType<Workbench["sourceInventory"]>[number];
type DatasetRow = ReturnType<Workbench["datasets"]>[number];
type LegalRefRow = ReturnType<Workbench["legalRefs"]>[number];
type SourceArtifactRow = ReturnType<Workbench["sourceArtifacts"]>[number];

export async function buildV2Release(
  workbench: Workbench,
  outDir: string,
): Promise<{ outDir: string; fileNames: string[] }> {
  await ensureDir(outDir);
  const entities: EntityRow[] = workbench.canonicalEntities();
  const relationships: RelationshipRow[] = workbench.canonicalRelationships();
  const sources: SourceRow[] = workbench.sourceInventory();
  const datasets: DatasetRow[] = workbench.datasets();
  const legalRefs: LegalRefRow[] = workbench.legalRefs();
  const sourceArtifacts: SourceArtifactRow[] = workbench.sourceArtifacts();
  const summary = buildReleaseSummary(
    workbench,
    entities,
    relationships,
    sources,
    datasets,
    legalRefs,
  );
  const files = new Map<string, string>();
  files.set("entities.json", JSON.stringify(entities, null, 2));
  files.set("relationships.json", JSON.stringify(relationships, null, 2));
  files.set("sources.json", JSON.stringify(sources, null, 2));
  files.set("datasets.json", JSON.stringify(datasets, null, 2));
  files.set("legal_refs.json", JSON.stringify(legalRefs, null, 2));
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
  for (const [name, content] of files) {
    await Deno.writeTextFile(join(outDir, name), content);
  }
  await Deno.copyFile(workbench.dbPath, join(outDir, "dcgov.sqlite"));
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
  await Deno.writeTextFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return {
    outDir,
    fileNames: [...Array.from(manifest.files, (file) => file.name), "manifest.json"],
  };
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
  return `# DCGov v2 Release

This release contains compact canonical entities, directed relationships, source inventory, dataset inventory, legal references, and a queryable SQLite copy of the workbench.

Files:
- \`dcgov.sqlite\`: release SQLite package
- \`entities.*\`: canonical entities
- \`relationships.*\`: directed canonical relationships
- \`sources.*\`: source inventory and latest artifact pointers
- \`datasets.*\`: public dataset inventory
- \`legal_refs.*\`: normalized and source-backed legal references

## Release summary

- entities by review_status: ${entityStatus}
- relationships by review_status: ${relationshipStatus}
- review items by status: ${reviewByStatus}
- review items by type: ${reviewByType}
- sources: total=${summary.source_count}, failed=${summary.failed_source_count}
- datasets: total=${summary.dataset_count}
- legal refs by type: ${legalByType}
- legal refs by review_status: ${legalByStatus}

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
) {
  const reviewByStatus = workbench.db.prepare(
    "select status, count(*) as count from review_items group by status order by status",
  ).all() as Array<{ status: string; count: number }>;
  const reviewByType = workbench.db.prepare(
    "select item_type as item_type, count(*) as count from review_items group by item_type order by item_type",
  ).all() as Array<{ item_type: string; count: number }>;
  return {
    entities_by_review_status: countByReviewStatus(entities, (row) => row.review_status),
    relationships_by_review_status: countByReviewStatus(relationships, (row) => row.review_status),
    review_items_by_status: reviewByStatus,
    review_items_by_type: reviewByType,
    source_count: sources.length,
    failed_source_count: sources.filter((row) => row.latest_status === "failed").length,
    dataset_count: datasets.length,
    legal_refs_by_type: countByRefType(legalRefs, (row) => row.ref_type),
    legal_refs_by_review_status: countByReviewStatus(legalRefs, (row) => row.review_status),
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

function renderStatusCounts(rows: Array<{ review_status: string; count: number }>): string {
  return rows.map((row) => `${row.review_status}=${row.count}`).join(", ") || "none";
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
