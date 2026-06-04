import { sha256BytesHex } from "./domain.ts";
import { classifyReleaseReadiness, type ReleaseReadiness } from "./release_readiness.ts";

export interface ReleaseManifest {
  manifest_version?: number;
  release_id?: string;
  tool_version?: string;
  git_commit?: string;
  source_profile?: string;
  generated_at?: string;
  files?: Array<{ name: string; sha256?: string }>;
  release_summary?: {
    entities_by_review_status?: Array<{ review_status: string; count: number }>;
    relationships_by_review_status?: Array<{ review_status: string; count: number }>;
    legal_refs_by_type?: Array<{ ref_type: string; count: number }>;
    legal_refs_by_review_status?: Array<{ review_status: string; count: number }>;
    open_review_item_count?: number;
    open_human_decision_review_item_count?: number;
    browse_only_open_review_item_count?: number;
    deferred_review_item_count?: number;
    stale_review_item_count?: number;
    stale_review_by_prior_decision_state?: Array<{ prior_decision_state: string; count: number }>;
    review_debt_by_type?: Array<{
      item_type: string;
      open_count: number;
      deferred_count: number;
    }>;
    review_debt_by_source?: Array<{
      source_id: string;
      open_count: number;
      deferred_count: number;
    }>;
    blocked_reconciliation_count?: number;
    blocked_reconciliation_by_source?: Array<{ source_id: string; count: number }>;
    placeholder_entity_count?: number;
    source_count?: number;
    failed_source_count?: number;
    dataset_count?: number;
  };
}

export interface ReleasePackageProblem {
  fileName: string;
  problem:
    | "missing file"
    | "sha256 mismatch"
    | "unexpected file"
    | "unexpected directory"
    | "unexpected entry"
    | "unreadable file";
  expectedSha256?: string;
  actualSha256?: string;
}

export interface ReleaseInspection {
  outDir: string;
  generatedAt: string;
  fileCount: number;
  expectedFileCount: number;
  packageIntegrity: "ok" | "problem" | "unknown";
  packageProblems: ReleasePackageProblem[];
  readiness: ReleaseReadiness;
  releaseSummary: NonNullable<ReleaseManifest["release_summary"]>;
}

export async function renderReleaseInspection(
  outDir: string,
  manifest: ReleaseManifest,
): Promise<string> {
  const inspection = await buildReleaseInspection(outDir, manifest);
  const summary = inspection.releaseSummary;
  return [
    `Release: ${inspection.outDir}`,
    `Manifest version: ${manifest.manifest_version ?? "unknown"}`,
    `Release id: ${manifest.release_id ?? "unknown"}`,
    `Tool version: ${manifest.tool_version ?? "unknown"}`,
    `Git commit: ${manifest.git_commit ?? "unknown"}`,
    `Source profile: ${manifest.source_profile ?? "custom"}`,
    `Generated: ${inspection.generatedAt}`,
    `Files: ${inspection.fileCount}`,
    `Expected files: ${inspection.expectedFileCount}`,
    `Package integrity: ${inspection.packageIntegrity}`,
    ...renderPackageProblems(inspection.packageProblems),
    `Release readiness: ${inspection.readiness}`,
    `Entities: ${renderReviewStatusCounts(summary.entities_by_review_status ?? [])}`,
    `Relationships: ${renderReviewStatusCounts(summary.relationships_by_review_status ?? [])}`,
    `Decision status: open=${summary.open_review_item_count ?? 0} (human decisions=${
      summary.open_human_decision_review_item_count ?? summary.open_review_item_count ?? 0
    }, browse-only=${summary.browse_only_open_review_item_count ?? 0}), deferred=${
      summary.deferred_review_item_count ?? 0
    }, stale=${summary.stale_review_item_count ?? 0}, blocked=${
      summary.blocked_reconciliation_count ?? 0
    }, placeholders=${summary.placeholder_entity_count ?? 0}`,
    `Sources: total=${summary.source_count ?? 0}, failed=${summary.failed_source_count ?? 0}`,
    `Datasets: total=${summary.dataset_count ?? 0}`,
    `Legal refs: ${renderNamedCounts(summary.legal_refs_by_type ?? [], "ref_type")}`,
    `Legal refs by status: ${renderReviewStatusCounts(summary.legal_refs_by_review_status ?? [])}`,
  ].join("\n");
}

export async function buildReleaseInspection(
  outDir: string,
  manifest: ReleaseManifest,
): Promise<ReleaseInspection> {
  const releaseSummary = manifest.release_summary ?? {};
  const packageInspection = await inspectReleasePackage(outDir, manifest);
  return {
    outDir,
    generatedAt: manifest.generated_at ?? "unknown",
    fileCount: packageInspection.fileCount,
    expectedFileCount: packageInspection.expectedFileCount,
    packageIntegrity: packageInspection.packageIntegrity,
    packageProblems: packageInspection.packageProblems,
    readiness: classifyReleaseReadiness({
      sourceCount: releaseSummary.source_count ?? 0,
      failedSourceCount: releaseSummary.failed_source_count,
      openReviewItemCount: releaseSummary.open_review_item_count,
      deferredReviewItemCount: releaseSummary.deferred_review_item_count,
      staleReviewItemCount: releaseSummary.stale_review_item_count,
      blockedReconciliationCount: releaseSummary.blocked_reconciliation_count,
      placeholderEntityCount: releaseSummary.placeholder_entity_count,
      blockingProblemCount: packageInspection.packageIntegrity === "ok" ? 0 : 1,
    }),
    releaseSummary,
  };
}

async function inspectReleasePackage(
  outDir: string,
  manifest: ReleaseManifest,
): Promise<{
  fileCount: number;
  expectedFileCount: number;
  packageIntegrity: "ok" | "problem" | "unknown";
  packageProblems: ReleasePackageProblem[];
}> {
  const expectedFiles = new Map((manifest.files ?? []).map((file) => [file.name, file.sha256]));
  const expectedFileCount = expectedFiles.size + 1;
  if (!manifest.files) {
    const actualEntries = await listReleaseEntries(outDir).catch(() => []);
    return {
      fileCount: actualEntries.length,
      expectedFileCount,
      packageIntegrity: "unknown",
      packageProblems: [],
    };
  }
  const actualEntries = await listReleaseEntries(outDir);
  const actualEntryNames = new Set(actualEntries.map((entry) => entry.name));
  const packageProblems: ReleasePackageProblem[] = [];
  for (const [fileName, expectedSha256] of expectedFiles) {
    if (!actualEntryNames.has(fileName)) {
      packageProblems.push({ fileName, problem: "missing file", expectedSha256 });
      continue;
    }
    if (!expectedSha256) continue;
    try {
      const actualSha256 = await releaseFileSha256(outDir, fileName);
      if (actualSha256 !== expectedSha256) {
        packageProblems.push({
          fileName,
          problem: "sha256 mismatch",
          expectedSha256,
          actualSha256,
        });
      }
    } catch {
      packageProblems.push({ fileName, problem: "unreadable file", expectedSha256 });
    }
  }
  for (const entry of actualEntries) {
    if (entry.name === "manifest.json") continue;
    if (!expectedFiles.has(entry.name)) {
      packageProblems.push({
        fileName: renderReleaseEntryName(entry),
        problem: unexpectedEntryProblem(entry),
      });
    }
  }
  packageProblems.sort((left, right) =>
    left.fileName.localeCompare(right.fileName) || left.problem.localeCompare(right.problem)
  );
  return {
    fileCount: actualEntries.length,
    expectedFileCount,
    packageIntegrity: packageProblems.length === 0 ? "ok" : "problem",
    packageProblems,
  };
}

interface ReleaseDirectoryEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

async function listReleaseEntries(outDir: string): Promise<ReleaseDirectoryEntry[]> {
  const entries: ReleaseDirectoryEntry[] = [];
  for await (const entry of Deno.readDir(outDir)) {
    entries.push({ name: entry.name, isFile: entry.isFile, isDirectory: entry.isDirectory });
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function renderReleaseEntryName(entry: ReleaseDirectoryEntry): string {
  return entry.isDirectory ? `${entry.name}/` : entry.name;
}

function unexpectedEntryProblem(entry: ReleaseDirectoryEntry): ReleasePackageProblem["problem"] {
  if (entry.isFile) return "unexpected file";
  if (entry.isDirectory) return "unexpected directory";
  return "unexpected entry";
}

async function releaseFileSha256(outDir: string, fileName: string): Promise<string> {
  return `sha256:${await sha256BytesHex(await Deno.readFile(`${outDir}/${fileName}`))}`;
}

function renderPackageProblems(problems: ReleasePackageProblem[]): string[] {
  if (problems.length === 0) return [];
  return [
    "Package problems:",
    ...problems.slice(0, 10).map((problem) =>
      `- ${problem.fileName}: ${problem.problem}${
        problem.expectedSha256 && problem.actualSha256
          ? ` (expected ${problem.expectedSha256}, got ${problem.actualSha256})`
          : ""
      }`
    ),
  ];
}

function renderReviewStatusCounts(rows: Array<{ review_status: string; count: number }>): string {
  return rows.map((row) => `${row.review_status}=${row.count}`).join(", ") || "none";
}

function renderNamedCounts<T extends string>(
  rows: Array<Record<T, string> & { count: number }>,
  nameKey: T,
): string {
  return rows.map((row) => `${row[nameKey]}=${row.count}`).join(", ") || "none";
}
