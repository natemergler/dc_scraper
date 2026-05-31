import { copy, ensureDir, walk } from "@std/fs";
import { join, relative } from "@std/path";
import { generateChecks, summarizeChecks, writeChecks } from "./checks.ts";
import { toCsv } from "./csv.ts";
import { loadRecords, writeJsonFile, writeTextFile } from "./io.ts";
import { sourceDefinitions, sourceEvidenceDepth } from "./source_definitions.ts";
import {
  BuildReleaseOptions,
  BuildReleaseResult,
  ReleaseCollection,
  releaseCollections,
} from "./types.ts";

const requiredReleaseFiles = [
  "manifest.json",
  "public_sources.csv",
  "public_sources.json",
  "legal_materials.csv",
  "legal_materials.json",
  "civic_units.csv",
  "civic_units.json",
  "relationship_types.csv",
  "relationship_types.json",
  "relationships.csv",
  "relationships.json",
  "update_pipelines.csv",
  "update_pipelines.json",
  "gaps.csv",
  "gaps.json",
  "checks_summary.json",
  "README.md",
  "caveats.md",
];

export async function buildRelease(
  repoPath: string,
  options: BuildReleaseOptions = {},
): Promise<BuildReleaseResult> {
  const releaseId = options.releaseId ?? defaultReleaseId();
  const releasePath = join(repoPath, "releases", releaseId);
  await ensureDir(releasePath);

  const loadedRecords = await loadRecords(repoPath);
  const recordStatusSummary = summarizeRecordStatuses(loadedRecords.map((entry) => entry.record));
  const checks = await generateChecks(repoPath);
  const checksSummary = summarizeChecks(checks);
  if (options.blockOnErrors !== false && checksSummary.unsuppressed_errors > 0) {
    throw new Error(
      `Release blocked by ${checksSummary.unsuppressed_errors} unsuppressed error check(s). Run deno task generate-checks.`,
    );
  }

  await writeChecks(repoPath, checks);

  const recordCounts = Object.fromEntries(
    Object.keys(releaseCollections).map((collection) => [collection, 0]),
  ) as Record<ReleaseCollection, number>;

  for (
    const [collection, recordType] of Object.entries(releaseCollections) as [
      ReleaseCollection,
      typeof releaseCollections[ReleaseCollection],
    ][]
  ) {
    const records = loadedRecords
      .filter((entry) => entry.record.record_type === recordType)
      .map((entry) => entry.record)
      .sort((a, b) => a.id.localeCompare(b.id));
    recordCounts[collection] = records.length;
    await writeJsonFile(join(releasePath, `${collection}.json`), records);
    await writeTextFile(join(releasePath, `${collection}.csv`), toCsv(records));
  }

  const caveats = collectCaveats(loadedRecords.map((entry) => entry.record), checks);
  const sourceSnapshotRefs = await collectSourceSnapshotRefs(repoPath);
  const sourceEvidenceSummary = summarizeSourceEvidence(sourceSnapshotRefs);
  await writeJsonFile(join(releasePath, "checks_summary.json"), {
    generated_at: new Date().toISOString(),
    summary: checksSummary,
    release_relevant_checks: checks.filter((check) => check.release_relevant),
  });
  await writeTextFile(
    join(releasePath, "README.md"),
    renderReleaseReadme(releaseId, recordCounts, {
      checksSummary,
      caveatCount: caveats.length,
      sourceSnapshotRefCount: sourceSnapshotRefs.length,
      sourceEvidenceSummary,
      recordStatusSummary,
    }),
  );
  await writeTextFile(join(releasePath, "caveats.md"), renderCaveats(caveats));

  const files = [...requiredReleaseFiles].sort();
  await writeJsonFile(join(releasePath, "manifest.json"), {
    release_id: releaseId,
    generated_at: new Date().toISOString(),
    git_commit: await currentGitCommit(repoPath),
    source_snapshot_refs: sourceSnapshotRefs,
    source_evidence_summary: sourceEvidenceSummary,
    schema_versions: { records: "v0" },
    record_counts: recordCounts,
    record_status_summary: recordStatusSummary,
    checks_summary: checksSummary,
    files,
    release_caveats: caveats,
  });

  if (releaseId !== "latest") {
    const latestPath = join(repoPath, "releases/latest");
    await Deno.remove(latestPath, { recursive: true }).catch(() => {});
    await copy(releasePath, latestPath, { overwrite: true });
  }

  return { releaseId, releasePath, recordCounts, checksSummary, files };
}

async function collectSourceSnapshotRefs(repoPath: string): Promise<string[]> {
  const refs: string[] = [];
  try {
    for await (
      const entry of walk(join(repoPath, "snapshots"), {
        includeDirs: false,
        match: [/(latest|failure\.latest)\.json$/],
      })
    ) {
      refs.push(relative(repoPath, entry.path));
    }
  } catch {
    return [];
  }
  return refs.sort();
}

export async function inspectRelease(repoPath: string, releaseId = "latest"): Promise<string> {
  const manifestPath = join(repoPath, "releases", releaseId, "manifest.json");
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
  const counts = manifest.record_counts as Record<string, number>;
  const checks = manifest.checks_summary as Record<string, number>;
  const sourceEvidence = manifest.source_evidence_summary as Record<string, number> | undefined;
  const recordStatus = manifest.record_status_summary as Record<string, number> | undefined;
  const caveats: string[] = Array.isArray(manifest.release_caveats)
    ? manifest.release_caveats.filter((item: unknown): item is string => typeof item === "string")
    : [];
  const lines = [
    `Release: ${manifest.release_id}`,
    `Git commit: ${manifest.git_commit ?? "unknown"}`,
    "",
    "Records:",
    ...Object.entries(counts).map(([name, count]) => `  ${name}: ${count}`),
    "",
    "Record status:",
    ...renderCountSummary(recordStatus),
    "",
    "Source evidence:",
    ...renderCountSummary(sourceEvidence),
    "",
    `Source snapshots: ${(manifest.source_snapshot_refs as unknown[] | undefined)?.length ?? 0}`,
    "",
    "Checks:",
    `  errors: ${checks.errors ?? 0}`,
    `  warnings: ${checks.warnings ?? 0}`,
    `  suppressed: ${checks.suppressed ?? 0}`,
    "",
    "Files:",
    ...(manifest.files as string[]).map((file) => `  ${file}`),
    "",
    "Caveats:",
    ...(caveats.length ? caveats.map((caveat) => `  - ${caveat}`) : ["  none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function collectCaveats(
  records: Record<string, unknown>[],
  checks: { release_relevant?: boolean; message: string }[],
): string[] {
  const caveats = new Set<string>();
  for (const record of records) {
    for (const caveat of asStringArray(record.release_relevant_caveats)) caveats.add(caveat);
    if (
      record.record_type === "gap" && record.release_relevant === true &&
      typeof record.description === "string"
    ) {
      caveats.add(record.description);
    }
  }
  for (const check of checks) {
    if (check.release_relevant) caveats.add(check.message);
  }
  return [...caveats].sort();
}

function summarizeRecordStatuses(records: Record<string, unknown>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const status = typeof record.status === "string" ? record.status : "unspecified";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function summarizeSourceEvidence(sourceSnapshotRefs: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ref of sourceSnapshotRefs) {
    const sourceId = sourceIdFromSnapshotRef(ref);
    const definition = sourceId ? sourceDefinitions[sourceId] : undefined;
    const evidenceDepth = sourceEvidenceDepth(definition);
    counts[evidenceDepth] = (counts[evidenceDepth] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function sourceIdFromSnapshotRef(ref: string): string | null {
  if (!ref.startsWith("snapshots/")) return null;
  const parts = ref.slice("snapshots/".length).split("/");
  if (parts.length < 2) return null;
  return parts.slice(0, -1).join(".");
}

function renderCountSummary(summary?: Record<string, number>): string[] {
  if (!summary || Object.keys(summary).length === 0) return ["  none"];
  return Object.entries(summary).map(([name, count]) => `  ${name}: ${count}`);
}

function renderSummaryBullets(summary: Record<string, number>): string {
  const entries = Object.entries(summary);
  if (entries.length === 0) return "- none";
  return entries.map(([name, count]) => `- ${name}: ${count}`).join("\n");
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function renderReleaseReadme(
  releaseId: string,
  counts: Record<ReleaseCollection, number>,
  summary: {
    checksSummary: ReturnType<typeof summarizeChecks>;
    caveatCount: number;
    sourceSnapshotRefCount: number;
    sourceEvidenceSummary: Record<string, number>;
    recordStatusSummary: Record<string, number>;
  },
): string {
  return `# D.C. Civic Content Release ${releaseId}

This package is generated from curated records in the D.C. Civic Content Repository.

JSON files are the faithful structured output. CSV files are flattened convenience views and are
lossy for nested fields such as source references, relationship actors, caveats, and lineage.

\`checks_summary.json\` reports generated validation/source-drift findings. \`caveats.md\` reports
curated known limitations and deferred work that remain part of the release story even when
generated checks are clean. \`manifest.json\` includes ${summary.sourceSnapshotRefCount} source
snapshot references used as evidence for the source audit.

### Evidence Depth

${renderSummaryBullets(summary.sourceEvidenceSummary)}

### Record Review Status

${renderSummaryBullets(summary.recordStatusSummary)}

## Record counts

${Object.entries(counts).map(([name, count]) => `- ${name}: ${count}`).join("\n")}

## Review status

- generated errors: ${summary.checksSummary.errors}
- generated warnings: ${summary.checksSummary.warnings}
- suppressed checks: ${summary.checksSummary.suppressed}
- release caveats: ${summary.caveatCount}
- source snapshots: ${summary.sourceSnapshotRefCount}
`;
}

function renderCaveats(caveats: string[]): string {
  if (caveats.length === 0) return "# Caveats\n\nNo release-relevant caveats recorded.\n";
  return `# Caveats\n\n${caveats.map((caveat) => renderMarkdownBullet(caveat)).join("\n")}\n`;
}

function renderMarkdownBullet(text: string, width = 100): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : `- ${word}`;
    if (next.length > width && current) {
      lines.push(current);
      current = `  ${word}`;
    } else {
      current = next;
    }
  }
  lines.push(current || "-");
  return lines.join("\n");
}

function defaultReleaseId(): string {
  return `${new Date().toISOString().slice(0, 10)}-v0.1`;
}

async function currentGitCommit(repoPath: string): Promise<string | null> {
  try {
    const command = new Deno.Command("git", {
      args: ["rev-parse", "--short", "HEAD"],
      cwd: repoPath,
      stdout: "piped",
      stderr: "null",
    });
    const output = await command.output();
    if (!output.success) return null;
    return new TextDecoder().decode(output.stdout).trim();
  } catch {
    return null;
  }
}
