import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { Workbench } from "./workbench.ts";
import { nowIso, sha256Hex } from "./domain.ts";

type EntityRow = ReturnType<Workbench["canonicalEntities"]>[number];
type RelationshipRow = ReturnType<Workbench["canonicalRelationships"]>[number];
type SourceRow = ReturnType<Workbench["sourceInventory"]>[number];
type DatasetRow = ReturnType<Workbench["datasets"]>[number];
type LegalRefRow = ReturnType<Workbench["legalRefs"]>[number];

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
        "latest_artifact_path",
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
      ["id", "ref_type", "citation_text", "normalized_citation", "url", "review_status"],
      legalRefs,
    ),
  );
  for (const [name, content] of files) {
    await Deno.writeTextFile(join(outDir, name), content);
  }
  await Deno.copyFile(workbench.dbPath, join(outDir, "dcgov.sqlite"));
  const readme = buildReadme();
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
    source_artifacts: workbench.artifactHashes(),
  };
  await Deno.writeTextFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return {
    outDir,
    fileNames: [...Array.from(manifest.files, (file) => file.name), "manifest.json"],
  };
}

function buildReadme(): string {
  return `# DCGov v2 Release

This release contains compact canonical entities, directed relationships, source inventory, dataset inventory, legal references, and a queryable SQLite copy of the workbench.

Files:
- \`dcgov.sqlite\`: release SQLite package
- \`entities.*\`: canonical entities
- \`relationships.*\`: directed canonical relationships
- \`sources.*\`: source inventory and latest artifact pointers
- \`datasets.*\`: public dataset inventory
- \`legal_refs.*\`: normalized and source-backed legal references

Review status fields show whether an item is accepted or still needs follow-up.
`;
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
