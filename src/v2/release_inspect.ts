import { sha256BytesHex } from "./domain.ts";
import { dcCommand } from "./command_prefix.ts";
import {
  classifyReleaseReadiness,
  releaseBlockingReasons,
  type ReleaseReadiness,
  releaseWarningReasons,
} from "./release_readiness.ts";
import {
  releaseReadinessInputFromSummary,
  type ReleaseSummaryProjection,
} from "./release_summary.ts";

export interface ReleaseManifest {
  manifest_version?: number;
  release_id?: string;
  tool_version?: string;
  git_commit?: string;
  source_profile?: string;
  generated_at?: string;
  files?: Array<{ name: string; sha256?: string }>;
  release_summary?: ReleaseSummaryProjection;
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
  readinessReasons: string[];
  warningReasons: string[];
  warningReviewCommand?: string;
  publicBodyCompareCommand?: string;
  browseCommand?: string;
  inspectCommand?: string;
  nextCommand?: string;
  releaseSummary: ReleaseSummaryProjection;
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
    ...(inspection.readinessReasons.length > 0
      ? [`Readiness reasons: ${inspection.readinessReasons.join("; ")}`]
      : []),
    ...(inspection.warningReasons.length > 0
      ? [`Warnings: ${inspection.warningReasons.join("; ")}`]
      : []),
    ...(inspection.warningReviewCommand
      ? [`Review warnings: ${inspection.warningReviewCommand}`]
      : []),
    ...(inspection.publicBodyCompareCommand
      ? [`Compare public bodies: ${inspection.publicBodyCompareCommand}`]
      : []),
    `Entities: ${renderReviewStatusCounts(summary.entities_by_review_status ?? [])}`,
    `Relationships: ${renderReviewStatusCounts(summary.relationships_by_review_status ?? [])}`,
    `Decisions: open=${
      summary.open_human_decision_review_item_count ?? summary.open_review_item_count ?? 0
    }, deferred=${summary.deferred_review_item_count ?? 0}, stale=${
      summary.stale_review_item_count ?? 0
    }, blocked=${summary.blocked_reconciliation_count ?? 0}, placeholders=${
      summary.placeholder_entity_count ?? 0
    }`,
    ...((summary.open_human_decision_review_item_count_by_type?.length ?? 0) > 0
      ? [
        `Decision types: ${
          renderNamedCounts(
            summary.open_human_decision_review_item_count_by_type ?? [],
            "item_type",
          )
        }`,
      ]
      : []),
    `Browse: source-backed rows=${summary.browse_only_open_review_item_count ?? 0}`,
    ...(inspection.browseCommand ? [`Browse rows: ${inspection.browseCommand}`] : []),
    ...(inspection.inspectCommand ? [`Inspect source: ${inspection.inspectCommand}`] : []),
    ...(inspection.nextCommand ? [`Next: ${inspection.nextCommand}`] : []),
    `Sources: total=${summary.source_count ?? 0}, failed=${summary.failed_source_count ?? 0}`,
    `Datasets: total=${summary.dataset_count ?? 0}`,
    `Legal refs: ${renderNamedCounts(summary.legal_refs_by_type ?? [], "ref_type")}`,
    `Legal refs by status: ${renderReviewStatusCounts(summary.legal_refs_by_review_status ?? [])}`,
    `Legal attachments: entity=${summary.entity_legal_refs_count ?? 0}, relationship=${
      summary.relationship_legal_refs_count ?? 0
    }`,
  ].join("\n");
}

export async function buildReleaseInspection(
  outDir: string,
  manifest: ReleaseManifest,
): Promise<ReleaseInspection> {
  const releaseSummary = manifest.release_summary ?? {};
  const packageInspection = await inspectReleasePackage(outDir, manifest);
  const readinessInput = releaseReadinessInputFromSummary(releaseSummary, {
    blockingProblemCount: packageIntegrityBlockingProblemCount(packageInspection),
  });
  return {
    outDir,
    generatedAt: manifest.generated_at ?? "unknown",
    fileCount: packageInspection.fileCount,
    expectedFileCount: packageInspection.expectedFileCount,
    packageIntegrity: packageInspection.packageIntegrity,
    packageProblems: packageInspection.packageProblems,
    readiness: classifyReleaseReadiness(readinessInput),
    readinessReasons: releaseBlockingReasons(readinessInput),
    warningReasons: releaseWarningReasons(readinessInput),
    warningReviewCommand: releaseWarningReviewCommand(releaseSummary),
    publicBodyCompareCommand: releasePublicBodyCompareCommand(releaseSummary),
    browseCommand: releaseBrowseCommand(releaseSummary),
    inspectCommand: releaseInspectSourceCommand(releaseSummary),
    nextCommand: releaseInspectNextCommand(releaseSummary),
    releaseSummary,
  };
}

function releaseWarningReviewCommand(summary: ReleaseSummaryProjection): string | undefined {
  return ((summary.open_human_decision_review_item_count ?? summary.open_review_item_count ?? 0) >
      0) ||
      ((summary.deferred_review_item_count ?? 0) > 0)
    ? dcCommand("review list --status all --decisions")
    : undefined;
}

function releaseBrowseCommand(summary: ReleaseSummaryProjection): string | undefined {
  return (summary.browse_only_open_review_item_count ?? 0) > 0
    ? dcCommand("review list --status all")
    : undefined;
}

function releasePublicBodyCompareCommand(summary: ReleaseSummaryProjection): string | undefined {
  return (summary.public_body_release_risk_variant_lead_count ?? 0) > 0
    ? dcCommand("source compare public-bodies")
    : undefined;
}

function releaseInspectSourceCommand(summary: ReleaseSummaryProjection): string | undefined {
  const sourceId = summary.blocked_reconciliation_by_source?.[0]?.source_id;
  return sourceId ? dcCommand(`source inspect ${sourceId}`) : undefined;
}

function releaseInspectNextCommand(summary: ReleaseSummaryProjection): string | undefined {
  const inspectCommand = releaseInspectSourceCommand(summary);
  if (
    (summary.source_count ?? 0) === 0 ||
    (summary.failed_source_count ?? 0) > 0 ||
    (summary.stale_review_item_count ?? 0) > 0 ||
    (summary.blocked_reconciliation_count ?? 0) > 0 ||
    (summary.placeholder_entity_count ?? 0) > 0
  ) {
    return inspectCommand ?? dcCommand("audit");
  }
  if ((summary.open_human_decision_review_item_count ?? summary.open_review_item_count ?? 0) > 0) {
    return dcCommand("review list --status all --decisions");
  }
  if ((summary.browse_only_open_review_item_count ?? 0) > 0) {
    return dcCommand("review list --status all");
  }
  if ((summary.public_body_release_risk_variant_lead_count ?? 0) > 0) {
    return dcCommand("source compare public-bodies");
  }
  return undefined;
}

function packageIntegrityBlockingProblemCount(
  inspection: { packageIntegrity: "ok" | "problem" | "unknown"; packageProblems: unknown[] },
): number {
  if (inspection.packageIntegrity === "ok") return 0;
  return Math.max(inspection.packageProblems.length, 1);
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
    const actualFiles = actualEntries.filter((entry) => entry.isFile);
    return {
      fileCount: actualFiles.length,
      expectedFileCount,
      packageIntegrity: "unknown",
      packageProblems: [],
    };
  }
  const actualEntries = await listReleaseEntries(outDir);
  const actualFiles = actualEntries.filter((entry) => entry.isFile);
  const actualEntryNames = new Set(actualFiles.map((entry) => entry.name));
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
    if (entry.isDirectory && hasExpectedChild(entry.name, expectedFiles)) continue;
    if (entry.isFile && !expectedFiles.has(entry.name)) {
      packageProblems.push({
        fileName: renderReleaseEntryName(entry),
        problem: unexpectedEntryProblem(entry),
      });
    }
    if (entry.isDirectory && !hasExpectedChild(entry.name, expectedFiles)) {
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
    fileCount: actualFiles.length,
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
  await collectReleaseEntries(outDir, "", entries);
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

async function collectReleaseEntries(
  rootDir: string,
  relativeDir: string,
  entries: ReleaseDirectoryEntry[],
): Promise<void> {
  const dir = relativeDir ? `${rootDir}/${relativeDir}` : rootDir;
  for await (const entry of Deno.readDir(dir)) {
    const name = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    entries.push({ name, isFile: entry.isFile, isDirectory: entry.isDirectory });
    if (entry.isDirectory) {
      await collectReleaseEntries(rootDir, name, entries);
    }
  }
}

function renderReleaseEntryName(entry: ReleaseDirectoryEntry): string {
  return entry.isDirectory ? `${entry.name}/` : entry.name;
}

function unexpectedEntryProblem(entry: ReleaseDirectoryEntry): ReleasePackageProblem["problem"] {
  if (entry.isFile) return "unexpected file";
  if (entry.isDirectory) return "unexpected directory";
  return "unexpected entry";
}

function hasExpectedChild(
  directoryName: string,
  expectedFiles: ReadonlyMap<string, string | undefined>,
): boolean {
  const prefix = `${directoryName}/`;
  return [...expectedFiles.keys()].some((fileName) => fileName.startsWith(prefix));
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
