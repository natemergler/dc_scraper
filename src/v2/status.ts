import { connectors } from "./connectors.ts";
import { dcCommand } from "./command_prefix.ts";
import { sha256BytesHex } from "./domain.ts";
import { buildOperatorPlan } from "./operator_plan.ts";
import { Workbench } from "./workbench.ts";
import { canBatchAcceptReviewItem } from "./workbench/review.ts";

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
    review_status_note?: string;
    source_count?: number;
    failed_source_count?: number;
    dataset_count?: number;
  };
}

export interface ReleasePackageProblem {
  fileName: string;
  problem: "missing file" | "sha256 mismatch" | "unexpected file" | "unreadable file";
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
  readiness: "usable" | "usable-with-warnings" | "not-ready";
  releaseSummary: NonNullable<ReleaseManifest["release_summary"]>;
}

export interface WorkbenchStatusSnapshot {
  sources: {
    fetched: number;
    failed: number;
    total: number;
    firstFailedSourceId?: string;
  };
  review: {
    open: number;
    deferred: number;
    byType: Array<{ itemType: string; openCount: number; deferredCount: number }>;
    bySource: Array<{ sourceId: string; openCount: number; deferredCount: number }>;
  };
  staleReview: {
    count: number;
    byPriorDecisionState: Array<{ priorDecisionState: string; count: number }>;
    firstStale?: {
      reviewItemId: string;
      itemType: string;
      subjectId: string;
      reason: string;
      priorDecisionState?: string;
    };
  };
  placeholders: {
    count: number;
    byReason: Array<{ reason: string; count: number }>;
    firstPlaceholder?: {
      entityId: string;
      name: string;
      kind: string;
      placeholderReason?: string | null;
    };
  };
  reconciliation: {
    blocked: number;
    firstBlockedSubjectId?: string;
    firstBlockedReason?: string;
    blockedBySource: Array<{ sourceId: string; count: number }>;
    blockedByBlockerState: Array<{ blockerState: string; count: number }>;
    blockedByRelationshipType: Array<{ relationshipType: string; count: number }>;
    blockedByReason: Array<{ reason: string; count: number }>;
    firstBlocked?: {
      subjectId: string;
      sourceId: string;
      reason: string;
      relationshipType: string;
      rawValue?: string | null;
      blockers: Array<{ blockerId: string; blockerState: string; blockerLabel: string }>;
    };
  };
  canonical: {
    entities: number;
    relationships: number;
  };
  nextCommand: string;
  unresolvedStateNote: string;
}

export function buildWorkbenchStatus(workbench: Workbench): WorkbenchStatusSnapshot {
  const sourceRows = workbench.listSources();
  const fetchedSources = sourceRows.filter((row) => row.latestStatus).length;
  const failedSource = sourceRows.find((row) => row.latestStatus === "failed");
  const failedSources = sourceRows.filter((row) => row.latestStatus === "failed").length;
  const openReview = workbench.listReviewItems({ status: "open" }).length;
  const deferredReview = workbench.listReviewItems({ status: "deferred" }).length;
  const reviewDebt = workbench.reviewDebtSummary();
  const staleReview = workbench.staleReviewSummary();
  const placeholders = workbench.placeholderSummary();
  const reconciliation = workbench.reconciliationSummary();
  const entities = workbench.canonicalEntities().length;
  const relationships = workbench.canonicalRelationships().length;
  const operatorPlan = buildOperatorPlan({
    workbench,
    canBatchAcceptReviewItem: (item, filters) => canBatchAcceptReviewItem(workbench, item, filters),
    fetchedSources,
    failedSourceId: failedSource?.sourceId,
    openReviewItemCount: openReview,
    deferredReviewItemCount: deferredReview,
    staleReviewItemCount: staleReview.count,
    blockedReconciliationCount: reconciliation.blockedCount,
    placeholderEntityCount: placeholders.count,
  });
  return {
    sources: {
      fetched: fetchedSources,
      failed: failedSources,
      total: connectors.length,
      firstFailedSourceId: failedSource?.sourceId,
    },
    review: {
      open: openReview,
      deferred: deferredReview,
      byType: reviewDebt.byType,
      bySource: reviewDebt.bySource,
    },
    staleReview,
    placeholders,
    reconciliation: {
      blocked: reconciliation.blockedCount,
      firstBlockedSubjectId: reconciliation.firstBlocked?.subjectId,
      firstBlockedReason: reconciliation.firstBlocked?.reason,
      blockedBySource: reconciliation.blockedBySource,
      blockedByBlockerState: reconciliation.blockedByBlockerState,
      blockedByRelationshipType: reconciliation.blockedByRelationshipType,
      blockedByReason: reconciliation.blockedByReason,
      firstBlocked: reconciliation.firstBlocked,
    },
    canonical: {
      entities,
      relationships,
    },
    nextCommand: operatorPlan.nextCommand,
    unresolvedStateNote: operatorPlan.unresolvedStateNote,
  };
}

export function renderWorkbenchStatus(status: WorkbenchStatusSnapshot): string {
  const reviewDebtByType = status.review.byType.length > 0
    ? status.review.byType
      .map((row) => `${row.itemType}(open=${row.openCount},deferred=${row.deferredCount})`)
      .join(", ")
    : undefined;
  const reviewDebtBySource = status.review.bySource.length > 0
    ? status.review.bySource
      .map((row) => `${row.sourceId}(open=${row.openCount},deferred=${row.deferredCount})`)
      .join(", ")
    : undefined;
  const reconciliationDetails = [
    status.reconciliation.blockedByRelationshipType.length > 0
      ? status.reconciliation.blockedByRelationshipType
        .map((row) => `${row.relationshipType}=${row.count}`)
        .join(", ")
      : undefined,
    status.reconciliation.blockedBySource.length > 0
      ? `sources ${
        status.reconciliation.blockedBySource
          .map((row) => `${row.sourceId}=${row.count}`)
          .join(", ")
      }`
      : undefined,
    status.reconciliation.blockedByBlockerState.length > 0
      ? `blockers ${
        status.reconciliation.blockedByBlockerState
          .map((row) => `${row.blockerState}=${row.count}`)
          .join(", ")
      }`
      : undefined,
  ].filter((value): value is string => Boolean(value)).join("; ");
  return [
    "",
    `Sources: ${status.sources.fetched}/${status.sources.total} fetched${
      status.sources.failed > 0 ? `, ${status.sources.failed} failed` : ""
    }`,
    `Review: ${status.review.open} open, ${status.review.deferred} deferred`,
    ...(reviewDebtByType ? [`Review debt by type: ${reviewDebtByType}`] : []),
    ...(reviewDebtBySource ? [`Review debt by source: ${reviewDebtBySource}`] : []),
    `Stale review: ${status.staleReview.count}${
      status.staleReview.firstStale?.priorDecisionState
        ? ` from prior ${status.staleReview.firstStale.priorDecisionState} decision`
        : ""
    }`,
    `Placeholders: ${status.placeholders.count}${
      status.placeholders.firstPlaceholder
        ? ` first ${status.placeholders.firstPlaceholder.name}${
          status.placeholders.firstPlaceholder.placeholderReason
            ? ` (${status.placeholders.firstPlaceholder.placeholderReason})`
            : ""
        }`
        : ""
    }`,
    `Reconciliation: ${status.reconciliation.blocked} blocked${
      reconciliationDetails ? ` (${reconciliationDetails})` : ""
    }`,
    ...renderFirstBlockedSummary(status.reconciliation.firstBlocked),
    `Canonical: ${status.canonical.entities} entities, ${status.canonical.relationships} relationships`,
    `Readiness: ${status.unresolvedStateNote}`,
    `Next: ${status.nextCommand}`,
  ].join("\n");
}

export function renderWorkbenchDoctor(status: WorkbenchStatusSnapshot): string {
  const lines = [renderWorkbenchStatus(status)];
  if (status.reconciliation.firstBlocked) {
    lines.push(
      "",
      "Blocked detail:",
      `Source: ${status.reconciliation.firstBlocked.sourceId}`,
      `Relationship: ${status.reconciliation.firstBlocked.relationshipType}`,
      `Reason: ${status.reconciliation.firstBlocked.reason}`,
      ...(status.reconciliation.firstBlocked.rawValue
        ? [`Value: ${status.reconciliation.firstBlocked.rawValue}`]
        : []),
      ...(status.reconciliation.firstBlocked.blockers.length > 0
        ? [
          `Waiting on: ${
            status.reconciliation.firstBlocked.blockers.map((blocker) =>
              renderBlockedDependency(blocker, status.reconciliation.firstBlocked?.rawValue)
            ).join(", ")
          }`,
        ]
        : []),
      `Subject id: ${status.reconciliation.firstBlocked.subjectId}`,
      `Inspect source: ${blockedInspectionCommand(status.reconciliation.firstBlocked.sourceId)}`,
    );
  }
  return lines.join("\n");
}

function blockedInspectionCommand(sourceId: string): string {
  return dcCommand(`source inspect ${sourceId}`);
}

function renderFirstBlockedSummary(
  firstBlocked: WorkbenchStatusSnapshot["reconciliation"]["firstBlocked"],
): string[] {
  if (!firstBlocked) return [];
  return [
    `First blocked: ${
      firstBlocked.rawValue ?? firstBlocked.subjectId
    } [${firstBlocked.relationshipType} from ${firstBlocked.sourceId}]`,
    ...(firstBlocked.blockers.length > 0
      ? [
        `Waiting on: ${
          firstBlocked.blockers.map((blocker) =>
            renderBlockedDependency(blocker, firstBlocked.rawValue)
          ).join(", ")
        }`,
      ]
      : []),
    `Subject id: ${firstBlocked.subjectId}`,
  ];
}

function renderBlockedDependency(
  blocker: { blockerId: string; blockerState: string; blockerLabel: string },
  rawValue?: string | null,
): string {
  const label = blocker.blockerLabel === blocker.blockerId && rawValue
    ? rawValue
    : blocker.blockerLabel;
  const state = blocker.blockerState === "missing"
    ? "missing endpoint"
    : blocker.blockerState.replaceAll("_", " ");
  return `${label} (${state}; id ${blocker.blockerId})`;
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
    `Review status: open=${summary.open_review_item_count ?? 0}, deferred=${
      summary.deferred_review_item_count ?? 0
    }, stale=${summary.stale_review_item_count ?? 0}, blocked=${
      summary.blocked_reconciliation_count ?? 0
    }, placeholders=${summary.placeholder_entity_count ?? 0}`,
    `Review debt by type: ${
      renderReviewDebtCounts(summary.review_debt_by_type ?? [], "item_type")
    }`,
    `Review debt by source: ${
      renderReviewDebtCounts(summary.review_debt_by_source ?? [], "source_id")
    }`,
    `Blocked by source: ${
      renderNamedCounts(summary.blocked_reconciliation_by_source ?? [], "source_id")
    }`,
    `Stale by prior decision: ${
      renderNamedCounts(summary.stale_review_by_prior_decision_state ?? [], "prior_decision_state")
    }`,
    `Sources: total=${summary.source_count ?? 0}, failed=${summary.failed_source_count ?? 0}`,
    `Datasets: total=${summary.dataset_count ?? 0}`,
    `Legal refs: ${renderNamedCounts(summary.legal_refs_by_type ?? [], "ref_type")}`,
    `Legal refs by review: ${renderReviewStatusCounts(summary.legal_refs_by_review_status ?? [])}`,
    `Review note: ${summary.review_status_note ?? "none"}`,
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
    readiness: packageInspection.packageIntegrity === "problem"
      ? "not-ready"
      : releaseReadiness(releaseSummary),
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
    return {
      fileCount: expectedFileCount,
      expectedFileCount,
      packageIntegrity: "unknown",
      packageProblems: [],
    };
  }
  const actualFiles = await listReleaseFiles(outDir);
  const actualFileNames = new Set(actualFiles);
  const packageProblems: ReleasePackageProblem[] = [];
  for (const [fileName, expectedSha256] of expectedFiles) {
    if (!actualFileNames.has(fileName)) {
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
  for (const fileName of actualFiles) {
    if (fileName === "manifest.json") continue;
    if (!expectedFiles.has(fileName)) {
      packageProblems.push({ fileName, problem: "unexpected file" });
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

async function listReleaseFiles(outDir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(outDir)) {
    if (entry.isFile) files.push(entry.name);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function releaseFileSha256(outDir: string, fileName: string): Promise<string> {
  return `sha256:${await sha256BytesHex(await Deno.readFile(`${outDir}/${fileName}`))}`;
}

function releaseReadiness(
  summary: NonNullable<ReleaseManifest["release_summary"]>,
): "usable" | "usable-with-warnings" | "not-ready" {
  if (
    (summary.failed_source_count ?? 0) > 0 ||
    (summary.stale_review_item_count ?? 0) > 0 ||
    (summary.blocked_reconciliation_count ?? 0) > 0 ||
    (summary.placeholder_entity_count ?? 0) > 0
  ) {
    return "not-ready";
  }
  if ((summary.open_review_item_count ?? 0) > 0 || (summary.deferred_review_item_count ?? 0) > 0) {
    return "usable-with-warnings";
  }
  return "usable";
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

function renderReviewDebtCounts<T extends string>(
  rows: Array<Record<T, string> & { open_count: number; deferred_count: number }>,
  nameKey: T,
): string {
  return rows.map((row) => `${row[nameKey]}(open=${row.open_count},deferred=${row.deferred_count})`)
    .join(", ") || "none";
}
