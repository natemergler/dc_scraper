import { Command } from "@cliffy/command";
import { join } from "@std/path";

import {
  type CommittedSourceCoverageStats,
  loadCommittedState,
  writeCommittedState,
} from "../state/store.ts";
import { compileFragments } from "../compiler/compile.ts";
import {
  closeWorkspace,
  indexState,
  initWorkspace,
  loadRecords,
  openWorkspace,
  replaceSourceData,
  saveBaseline,
  saveFinding,
  saveFragments,
  saveRecords,
  saveSnapshot,
  type Workspace,
} from "../workspace/workspace.ts";
import { AgencyDirectoryReader } from "../readers/agency_directory.ts";
import { ArcGISTableReader } from "../readers/arcgis_table.ts";
import { DCCouncilmembersReader } from "../readers/dccouncil_councilmembers.ts";
import { DCCouncilCommitteePagesReader } from "../readers/dccouncil_committee_pages.ts";
import { OpenDCPublicBodiesReader } from "../readers/open_dc_public_bodies.ts";
import { BegaStructureReader } from "../readers/bega_structure.ts";
import { DCCourtsStructureReader } from "../readers/dccourts_structure.ts";
import { LegalEntrypointsReader } from "../readers/legal_entrypoints.ts";
import { MayorExecutiveStructureReader } from "../readers/mayor_executive_structure.ts";
import { OancProfilesReader } from "../readers/oanc_profiles.ts";
import { dcRuntime } from "../jurisdictions/dc/index.ts";
import {
  exportReleaseArtifacts,
  SOURCE_COVERAGE_COLLECTION_STATUSES,
  type SourceCoverageCollectionStatus,
  sourceCoverageCollectionStatus,
  sourceCoveragePipelineStatuses,
  type SourceCoverageReleaseStatus,
  verifyReleaseArtifacts,
} from "../export/export.ts";
import { buildIdentityAliasResolver, loadIdentityAliases } from "../identity/aliases.ts";
import { loadRevisions } from "../revisions/load.ts";
import {
  applyDraftRevision,
  createDraftRevision,
  type DraftRevision,
  loadDraftRevisions,
  writeDraftRevision,
} from "../revisions/drafts.ts";
import { findReconciliationCandidates } from "../reconciliation/candidates.ts";
import {
  deferredReviewGroupDescription,
  generateReviewItems,
  groupDeferredReviewItems,
  type ReviewItem,
  reviewItemBlocksCurrentOutput,
  reviewItemHasPublicOutputImpact,
  type ReviewQueue,
  reviewQueueForItem,
  reviewQueueLabel,
  type ReviewResolutionType,
} from "../review/items.ts";
import { loadReviewItems, saveReviewItems } from "../review/store.ts";

import {
  type CitationValue,
  type EntryFragment,
  type Finding,
  type LedgerState,
  type RelationFragment,
} from "../core/types.ts";
import {
  type DcInterpreterContext,
  normalizeAgencyLookupKey,
  publicBodyLookupKey,
} from "../jurisdictions/dc/interpreters/context.ts";

type CliOptions = {
  workspace: string;
  stateRoot: string;
  releaseRoot: string;
  limit?: number;
};

type WorkspaceCompilation = {
  fragments: Array<EntryFragment | RelationFragment>;
  findings: Finding[];
};

type SourceListOptions = CliOptions & {
  json?: boolean;
};

type StatusOptions = CliOptions & {
  json?: boolean;
};

type ReleaseVerifyOptions = {
  json?: boolean;
  publish?: boolean;
};

type ReleaseAssetsOptions = {
  json?: boolean;
};

type ReleaseUploadPlanOptions = {
  json?: boolean;
  allowLocalCandidate?: boolean;
};

type ReleaseVerifyDownloadedOptions = {
  json?: boolean;
};

type AnsiStyle = "green" | "yellow" | "red" | "cyan";

const ANSI_STYLES: Record<AnsiStyle, [string, string]> = {
  green: ["\x1b[32m", "\x1b[39m"],
  yellow: ["\x1b[33m", "\x1b[39m"],
  red: ["\x1b[31m", "\x1b[39m"],
  cyan: ["\x1b[36m", "\x1b[39m"],
};

const REVIEW_QUEUE_SUMMARY_ORDER: ReviewQueue[] = [
  "blocking",
  "actionable",
  "drafted",
  "applied",
  "deferred",
];

const RELEASE_ASSET_CATEGORY_ORDER = [
  "public_csv",
  "machine_json",
  "database",
  "documentation",
  "traceability_csv",
  "compatibility_csv",
];

interface WorkspaceCoverageStats {
  snapshotCount: number;
  recordCount: number;
  citationCount: number;
}

type ReviewListOptions = CliOptions & {
  json?: boolean;
  status?: string;
  queue?: string;
};

type ReviewShowOptions = CliOptions & {
  json?: boolean;
};

interface ReviewSourceRecordEvidence {
  source: string;
  sourceRecordId: string;
  found: boolean;
  snapshotKey?: string;
  payload?: Record<string, unknown>;
}

interface ReviewSourceRecordSummary {
  source: string;
  sourceRecordId: string;
  found: boolean;
  urls: string[];
}

type ReviewNextOptions = CliOptions & {
  json?: boolean;
};

type ReviewDeferredOptions = CliOptions & {
  json?: boolean;
};

type ReviewResolveOptions = CliOptions & {
  as?: string;
  target?: string;
  kind?: string;
  rationale?: string;
};

const OPERATOR_FLOW = operatorFlowForReleaseRoot("releases/latest");

function operatorFlowForReleaseRoot(releaseRoot: string): string[] {
  return [
    "deno task civic status",
    "deno task civic revision validate",
    "deno task civic state generate",
    "deno task civic check",
    "deno task civic export",
    `deno task civic release verify ${releaseRoot}`,
  ];
}

const RELEASE_ARTIFACT_HINTS = [
  "Start here: dc_agencies.csv / dc_councilmembers.csv / dc_public_bodies.csv",
  "dc_council_committees.csv / dc_council_committee_memberships.csv",
  "dc_ancs.csv / dc_smds.csv / dc_wards.csv",
  "dc_public_body_affiliations.csv / dc_relationships.csv",
  "dc_legal_authorities.csv / dc_sources.csv",
  "Bulk/audit: ledger.sqlite / govgraph_nodes.json / govgraph_edges.json",
  "Manifest/docs: manifest.json / SHA256SUMS / README.md",
];

interface ReleaseAssetSummary {
  outputName: string;
  path: string;
  category: string;
  description: string;
  byteSize: number;
  sha256: string;
  rowCount?: number;
  columnCount?: number;
  columns?: string[];
}

interface ReleaseAssetLoadFailure {
  valid: false;
  manifestPath: string;
  errors: string[];
}

interface ReleaseAssetLoadSuccess {
  valid: true;
  manifestPath: string;
  assets: ReleaseAssetSummary[];
}

type ReleaseAssetLoadResult = ReleaseAssetLoadFailure | ReleaseAssetLoadSuccess;

export async function runCli(rawArgs: string[] = Deno.args): Promise<number> {
  try {
    let exitCode = 0;
    const cli = createCli((code) => {
      exitCode = code;
    });
    await cli.parse(normalizeRawArgs(rawArgs));
    return exitCode;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

async function runCollect(
  sourceId: string,
  workspaceRoot: string,
  limit?: number,
): Promise<number> {
  if (sourceId === "all") {
    return await runCollectAll(workspaceRoot, limit);
  }

  const sourceBinding = dcRuntime.sources.find((candidate) => candidate.source.id === sourceId);
  if (!sourceBinding) {
    throw new Error(
      `unknown source id: ${sourceId}; run deno task civic sources list to see valid sources`,
    );
  }

  const workspace = openWorkspace(workspaceRoot);
  try {
    initWorkspace(workspace);
    const result = await collectSourceRecords(sourceBinding.source, workspaceRoot, limit);
    replaceSourceData(workspace, sourceId);

    for (const snapshot of result.snapshots) {
      const snapshotId = saveSnapshot(workspace, {
        source: snapshot.source,
        key: snapshot.key,
        payload: snapshot.payload,
      });

      const records = result.records.filter((record) => record.snapshotKey === snapshot.key);
      saveRecords(
        workspace,
        records.map((record) => ({
          source: record.source,
          snapshotId,
          key: record.key,
          payload: record.payload,
        })),
      );
    }

    console.log(
      `collected ${sourceId}: ${result.snapshots.length} snapshots, ${result.records.length} records`,
    );
    return 0;
  } finally {
    closeWorkspace(workspace);
  }
}

async function runCollectAll(workspaceRoot: string, limit?: number): Promise<number> {
  console.log(`collecting ${dcRuntime.sources.length} sources into ${workspaceRoot}`);
  for (const sourceBinding of dcRuntime.sources) {
    await runCollect(sourceBinding.source.id, workspaceRoot, limit);
  }
  console.log("");
  console.log("Next: deno task civic state generate");
  return 0;
}

async function runInit(options: CliOptions): Promise<number> {
  const cliOptions = validateCliOptions(options);
  const workspace = openWorkspace(cliOptions.workspace);
  try {
    initWorkspace(workspace);
  } finally {
    closeWorkspace(workspace);
  }
  console.log("Civic Ledger workspace ready");
  console.log(`  workspace: ${cliOptions.workspace}`);
  console.log(`  state:     ${cliOptions.stateRoot}`);
  console.log(`  release:   ${cliOptions.releaseRoot}`);
  console.log("");
  console.log("Next:");
  console.log("  deno task civic sources list");
  console.log("  deno task civic collect all");
  console.log("  deno task civic state generate");
  return 0;
}

async function runSourcesList(options: SourceListOptions): Promise<number> {
  const cliOptions = validateCliOptions(options);
  const sources = dcRuntime.sources.map((binding) => sourceSummary(binding.source.id));
  const coverageStats = loadWorkspaceCoverageStats(cliOptions.workspace);
  const coverageStatusCounts = countSourceCoverageStatuses(coverageStats);
  const coverageReleaseStatusCounts = countSourceCoverageReleaseStatuses(coverageStats);
  if (options.json) {
    const sourceCoverage = dcRuntime.sourceCoverage.map((coverage) => {
      const stats = coverageStats.get(coverage.source);
      const pipelineStatuses = sourceCoveragePipelineStatuses({
        catalogItem: coverage,
        snapshotCount: stats?.snapshotCount ?? 0,
        recordCount: stats?.recordCount ?? 0,
        citationCount: stats?.citationCount ?? 0,
      });
      return {
        source: coverage.source,
        sourceType: coverage.sourceType,
        family: coverage.family,
        publisher: coverage.publisher,
        accessMethod: coverage.accessMethod,
        sourceUrl: coverage.sourceUrl,
        catalogConfidence: coverage.catalogConfidence,
        collectionStatus: collectionStatusForCoverage(stats),
        readerStatus: pipelineStatuses.readerStatus,
        interpreterStatus: pipelineStatuses.interpreterStatus,
        releaseStatus: pipelineStatuses.releaseStatus,
        snapshotCount: stats?.snapshotCount ?? 0,
        recordCount: stats?.recordCount ?? 0,
        citationCount: stats?.citationCount ?? 0,
        scope: coverage.scope,
        contributes: coverage.contributes,
        excludes: coverage.excludes,
        notes: coverage.notes,
      };
    });
    const sourceCoverageFamilyRollup = sourceCoverageFamilyRollupJson(coverageStats);
    console.log(JSON.stringify(
      {
        sourceCount: sources.length,
        sources,
        sourceCoverageCount: sourceCoverage.length,
        sourceCoverageFamilyCount: sourceCoverageFamilyRollup.length,
        sourceCoverageStatusCounts: Object.fromEntries(coverageStatusCounts),
        sourceCoverageReleaseStatusCounts: Object.fromEntries(coverageReleaseStatusCounts),
        sourceCoverageFamilyRollup,
        sourceCoverage,
      },
      null,
      2,
    ));
    return 0;
  }

  console.log("Civic Ledger Sources");
  console.log("");
  console.log([
    "SOURCE".padEnd(28),
    "STATUS".padEnd(16),
    "FAMILY".padEnd(34),
    "SCOPE".padEnd(30),
    "TYPE",
  ].join("  "));
  const color = cliColorEnabled();
  for (const source of sources) {
    const status = collectionStatusForCoverage(coverageStats.get(source.id));
    console.log([
      source.id.padEnd(28),
      colorize(status.padEnd(16), styleForStatus(status, 1), color),
      source.family.padEnd(34),
      summarizeForColumn(source.scope, 30),
      source.type,
    ].join("  "));
    if (source.notes) {
      console.log(`  notes: ${source.notes}`);
    }
  }
  console.log("");
  console.log("Coverage rows:");
  console.log(
    `  collection: ${dcRuntime.sourceCoverage.length} total; ${
      formatSourceCoverageStatusCounts(coverageStatusCounts, color)
    }`,
  );
  console.log(
    `  release: ${formatSourceCoverageReleaseStatusCounts(coverageReleaseStatusCounts, color)}`,
  );
  printSourceCoverageFamilyRollup(coverageStats, color);
  printInventoryOnlyCoverageRows(coverageStats, color);
  console.log("");
  console.log("Collect everything:");
  console.log("  deno task civic collect all");
  console.log("");
  console.log("Coverage/export inspection:");
  console.log("  deno task civic sources list --json");
  console.log("  deno task civic export   # writes public CSVs and _local/source_coverage.csv");
  return 0;
}

function printSourceCoverageFamilyRollup(
  coverageStats: Map<string, WorkspaceCoverageStats>,
  color: boolean,
): void {
  const rows = buildSourceCoverageFamilyRollup(coverageStats);
  if (rows.length === 0) {
    return;
  }

  console.log("");
  console.log("Family coverage:");
  console.log([
    "FAMILY".padEnd(34),
    "ROWS".padEnd(6),
    "COVERAGE",
  ].join("  "));
  for (const row of rows) {
    console.log([
      row.family.padEnd(34),
      String(row.rows).padEnd(6),
      `collection: ${formatNonZeroStatusCounts(row.collectionStatuses, color)}`,
    ].join("  "));
    console.log([
      "".padEnd(34),
      "".padEnd(6),
      `release: ${formatNonZeroStatusCounts(row.releaseStatuses, color)}`,
    ].join("  "));
  }
}

function buildSourceCoverageFamilyRollup(
  coverageStats: Map<string, WorkspaceCoverageStats>,
): Array<{
  family: string;
  rows: number;
  collectionStatuses: Map<string, number>;
  releaseStatuses: Map<string, number>;
}> {
  const byFamily = new Map<
    string,
    {
      family: string;
      rows: number;
      collectionStatuses: Map<string, number>;
      releaseStatuses: Map<string, number>;
    }
  >();

  for (const coverage of dcRuntime.sourceCoverage) {
    const stats = coverageStats.get(coverage.source);
    const collectionStatus = collectionStatusForCoverage(stats);
    const releaseStatus = sourceCoveragePipelineStatuses({
      catalogItem: coverage,
      snapshotCount: stats?.snapshotCount ?? 0,
      recordCount: stats?.recordCount ?? 0,
      citationCount: stats?.citationCount ?? 0,
    }).releaseStatus;
    const row = byFamily.get(coverage.family) ?? {
      family: coverage.family,
      rows: 0,
      collectionStatuses: new Map<string, number>(),
      releaseStatuses: new Map<string, number>(),
    };
    row.rows += 1;
    incrementStatusCount(row.collectionStatuses, collectionStatus);
    incrementStatusCount(row.releaseStatuses, releaseStatus);
    byFamily.set(coverage.family, row);
  }

  return [...byFamily.values()].sort((left, right) => left.family.localeCompare(right.family));
}

function sourceCoverageFamilyRollupJson(
  coverageStats: Map<string, WorkspaceCoverageStats>,
): Array<{
  family: string;
  rows: number;
  collectionStatuses: Record<string, number>;
  releaseStatuses: Record<string, number>;
}> {
  return buildSourceCoverageFamilyRollup(coverageStats).map((row) => ({
    family: row.family,
    rows: row.rows,
    collectionStatuses: Object.fromEntries(row.collectionStatuses),
    releaseStatuses: Object.fromEntries(row.releaseStatuses),
  }));
}

function incrementStatusCount(counts: Map<string, number>, status: string): void {
  counts.set(status, (counts.get(status) ?? 0) + 1);
}

function formatNonZeroStatusCounts(counts: Map<string, number>, color: boolean): string {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => formatStatusCount(status, count, color))
    .join(", ");
}

function printInventoryOnlyCoverageRows(
  coverageStats: Map<string, WorkspaceCoverageStats>,
  color: boolean,
): void {
  const rows = dcRuntime.sourceCoverage
    .map((coverage) => {
      const stats = coverageStats.get(coverage.source);
      const statuses = sourceCoveragePipelineStatuses({
        catalogItem: coverage,
        snapshotCount: stats?.snapshotCount ?? 0,
        recordCount: stats?.recordCount ?? 0,
        citationCount: stats?.citationCount ?? 0,
      });
      return { coverage, statuses };
    })
    .filter(({ statuses }) => statuses.releaseStatus === "inventory_only");

  if (rows.length === 0) {
    return;
  }

  console.log("");
  console.log("Inventory-only backlog rows:");
  console.log([
    "SOURCE".padEnd(36),
    "FAMILY".padEnd(26),
    "RELEASE".padEnd(16),
    "SCOPE",
  ].join("  "));
  for (const { coverage, statuses } of rows) {
    console.log([
      coverage.source.padEnd(36),
      coverage.family.padEnd(26),
      colorize(statuses.releaseStatus.padEnd(16), styleForStatus(statuses.releaseStatus, 1), color),
      summarizeForColumn(coverage.scope, 48),
    ].join("  "));
  }
  console.log("Use --json for publisher/access/sourceUrl/confidence details.");
}

function summarizeForColumn(value: string, width: number): string {
  if (value.length <= width) {
    return value.padEnd(width);
  }
  return `${value.slice(0, width - 1)}…`;
}

async function runStatus(options: StatusOptions): Promise<number> {
  const cliOptions = validateCliOptions(options);
  const sourceStats = loadWorkspaceSourceStats(cliOptions.workspace);
  const collected = sourceStats.filter((source) => source.snapshotCount > 0).length;
  const recordCount = sourceStats.reduce((total, source) => total + source.recordCount, 0);
  const coverageStats = loadWorkspaceCoverageStats(cliOptions.workspace);
  const coverageStatusCounts = countSourceCoverageStatuses(coverageStats);
  const coverageReleaseStatusCounts = countSourceCoverageReleaseStatuses(coverageStats);
  const stateCount = await countCommittedStateEntries(cliOptions.stateRoot);
  const reviewItems = await loadReviewItems(cliOptions.workspace);
  const nextAction = statusNextAction(recordCount, stateCount, cliOptions.releaseRoot);
  const operatorFlow = operatorFlowForReleaseRoot(cliOptions.releaseRoot);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          workspace: cliOptions.workspace,
          stateRoot: cliOptions.stateRoot,
          releaseRoot: cliOptions.releaseRoot,
          sourceCount: sourceStats.length,
          collectedSourceCount: collected,
          sourceCoverageCount: dcRuntime.sourceCoverage.length,
          sourceCoverageStatusCounts: Object.fromEntries(coverageStatusCounts),
          sourceCoverageReleaseStatusCounts: Object.fromEntries(coverageReleaseStatusCounts),
          recordCount,
          stateEntryCount: stateCount,
          reviewItemCount: reviewItems.length,
          reviewQueueCounts: reviewQueueCountsObject(reviewItems),
          nextAction,
          operatorFlow,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const color = cliColorEnabled();
  console.log("Civic Ledger Status");
  console.log("");
  console.log(`Workspace: ${cliOptions.workspace}`);
  console.log(
    `Sources:   ${
      colorize(
        `${collected}/${sourceStats.length} collected`,
        collected === sourceStats.length ? "green" : collected === 0 ? "red" : "yellow",
        color,
      )
    }`,
  );
  console.log(
    `Coverage:  ${dcRuntime.sourceCoverage.length} rows; ${
      formatSourceCoverageStatusCounts(coverageStatusCounts, color)
    }`,
  );
  console.log(
    `Release:   ${formatSourceCoverageReleaseStatusCounts(coverageReleaseStatusCounts, color)}`,
  );
  console.log(`Records:   ${recordCount}`);
  console.log(
    `State:     ${colorize(`${stateCount} entries`, stateCount > 0 ? "green" : "yellow", color)}`,
  );
  console.log(`Review:    ${formatPersistedReviewSummary(reviewItems, color)}`);
  console.log("");
  console.log("Operator flow:");
  for (const step of operatorFlow) {
    console.log(`  ${step}`);
  }
  console.log("");
  console.log(`Next: ${colorize(nextAction, "cyan", color)}`);
  if (recordCount > 0 && stateCount > 0) {
    console.log(statusReviewQueueHint(reviewItems, color));
  }
  return 0;
}

function statusReviewQueueHint(reviewItems: ReviewItem[], color: boolean): string {
  const queueCounts = countReviewQueues(reviewItems);
  const inboxCount = (queueCounts.get("blocking") ?? 0) + (queueCounts.get("actionable") ?? 0);
  if (inboxCount > 0) {
    return `Review queue: ${colorize("deno task civic review inbox", "cyan", color)}`;
  }
  if ((queueCounts.get("drafted") ?? 0) > 0) {
    return `Review queue: ${
      colorize("deno task civic review list --queue drafted", "cyan", color)
    }`;
  }
  if ((queueCounts.get("deferred") ?? 0) > 0) {
    return `Review queue: ${colorize("deno task civic review deferred", "cyan", color)}`;
  }
  return `Review queue: ${colorize("no active review items", "green", color)}`;
}

function statusNextAction(
  recordCount: number,
  stateEntryCount: number,
  releaseRoot: string,
): string {
  if (recordCount === 0) {
    return "deno task civic collect all";
  }
  if (stateEntryCount === 0) {
    return "deno task civic revision validate, then deno task civic state generate";
  }
  return `deno task civic check, then deno task civic export, then deno task civic release verify ${releaseRoot}`;
}

function sourceSummary(sourceId: string): {
  id: string;
  type: string;
  family: string;
  publisher?: string;
  accessMethod?: string;
  sourceUrl?: string;
  catalogConfidence?: string;
  scope: string;
  notes?: string;
} {
  const binding = dcRuntime.sources.find((candidate) => candidate.source.id === sourceId);
  if (!binding) {
    throw new Error(`unknown source id: ${sourceId}`);
  }
  const coverage = dcRuntime.sourceCoverage.find((candidate) => candidate.source === sourceId);
  return {
    id: sourceId,
    type: binding.source.type,
    family: coverage?.family ?? "uncategorized",
    publisher: coverage?.publisher,
    accessMethod: coverage?.accessMethod,
    sourceUrl: coverage?.sourceUrl,
    catalogConfidence: coverage?.catalogConfidence,
    scope: coverage?.scope ?? "",
    notes: coverage?.notes,
  };
}

function loadWorkspaceSourceStats(workspaceRoot: string): Array<{
  id: string;
  type: string;
  family: string;
  snapshotCount: number;
  recordCount: number;
}> {
  const workspace = openWorkspace(workspaceRoot);
  try {
    initWorkspace(workspace);
    return dcRuntime.sources.map((binding) => {
      const source = sourceSummary(binding.source.id);
      const snapshotRow = workspace.db.prepare(
        "SELECT COUNT(*) AS count FROM snapshots WHERE source = ?",
      ).get([source.id]) as { count: number };
      const recordRow = workspace.db.prepare(
        "SELECT COUNT(*) AS count FROM records WHERE source = ?",
      ).get([source.id]) as { count: number };
      return {
        id: source.id,
        type: source.type,
        family: source.family,
        snapshotCount: Number(snapshotRow.count),
        recordCount: Number(recordRow.count),
      };
    });
  } finally {
    closeWorkspace(workspace);
  }
}

function loadWorkspaceCoverageStats(workspaceRoot: string): Map<string, WorkspaceCoverageStats> {
  const workspace = openWorkspace(workspaceRoot);
  try {
    initWorkspace(workspace);
    const stats = new Map<string, WorkspaceCoverageStats>();
    for (const coverage of dcRuntime.sourceCoverage) {
      const snapshotRow = workspace.db.prepare(
        "SELECT COUNT(*) AS count FROM snapshots WHERE source = ?",
      ).get([coverage.source]) as { count: number };
      const recordRow = workspace.db.prepare(
        "SELECT COUNT(*) AS count FROM records WHERE source = ?",
      ).get([coverage.source]) as { count: number };
      stats.set(coverage.source, {
        snapshotCount: Number(snapshotRow.count),
        recordCount: Number(recordRow.count),
        citationCount: 0,
      });
    }

    const entryRows = workspace.db.prepare("SELECT payload FROM state_entries").all() as Array<{
      payload: string;
    }>;
    for (const row of entryRows) {
      const parsed = safeJsonObject(row.payload);
      addCitationCounts(parsed.citations, stats);
    }

    const relationRows = workspace.db.prepare("SELECT citations FROM state_relations")
      .all() as Array<
        { citations: string | null }
      >;
    for (const row of relationRows) {
      addCitationCounts(safeJsonArray(row.citations), stats);
    }

    return stats;
  } finally {
    closeWorkspace(workspace);
  }
}

function buildCommittedSourceCoverageStats(
  workspace: Workspace,
  state: LedgerState,
): CommittedSourceCoverageStats[] {
  const stats = new Map<string, WorkspaceCoverageStats>();
  for (const coverage of dcRuntime.sourceCoverage) {
    const snapshotRow = workspace.db.prepare(
      "SELECT COUNT(*) AS count FROM snapshots WHERE source = ?",
    ).get([coverage.source]) as { count: number };
    const recordRow = workspace.db.prepare(
      "SELECT COUNT(*) AS count FROM records WHERE source = ?",
    ).get([coverage.source]) as { count: number };
    stats.set(coverage.source, {
      snapshotCount: Number(snapshotRow.count),
      recordCount: Number(recordRow.count),
      citationCount: 0,
    });
  }

  for (const entry of state.entries.values()) {
    addCitationCounts(entry.citations, stats);
    for (const relations of Object.values(entry.relations)) {
      for (const relation of relations) {
        addCitationCounts(relation.citations ?? [], stats);
      }
    }
  }

  return Array.from(stats.entries())
    .map(([source, stat]) => ({
      source,
      snapshotCount: stat.snapshotCount,
      recordCount: stat.recordCount,
      citationCount: stat.citationCount,
    }))
    .sort((left, right) => left.source.localeCompare(right.source));
}

function collectionStatusForCoverage(
  stats: WorkspaceCoverageStats | undefined,
): SourceCoverageCollectionStatus {
  return sourceCoverageCollectionStatus({
    snapshotCount: stats?.snapshotCount ?? 0,
    recordCount: stats?.recordCount ?? 0,
  });
}

function countSourceCoverageStatuses(
  coverageStats: Map<string, WorkspaceCoverageStats>,
): Map<SourceCoverageCollectionStatus, number> {
  const counts = new Map<SourceCoverageCollectionStatus, number>(
    SOURCE_COVERAGE_COLLECTION_STATUSES.map((status) => [status, 0]),
  );
  for (const coverage of dcRuntime.sourceCoverage) {
    const status = collectionStatusForCoverage(coverageStats.get(coverage.source));
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return counts;
}

function countSourceCoverageReleaseStatuses(
  coverageStats: Map<string, WorkspaceCoverageStats>,
): Map<SourceCoverageReleaseStatus, number> {
  const counts = new Map<SourceCoverageReleaseStatus, number>();
  for (const coverage of dcRuntime.sourceCoverage) {
    const stats = coverageStats.get(coverage.source);
    const status = sourceCoveragePipelineStatuses({
      catalogItem: coverage,
      snapshotCount: stats?.snapshotCount ?? 0,
      recordCount: stats?.recordCount ?? 0,
      citationCount: stats?.citationCount ?? 0,
    }).releaseStatus;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return new Map([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function formatSourceCoverageStatusCounts(
  counts: Map<SourceCoverageCollectionStatus, number>,
  color = false,
): string {
  return SOURCE_COVERAGE_COLLECTION_STATUSES
    .map((status) => formatStatusCount(status, counts.get(status) ?? 0, color))
    .join(", ");
}

function formatSourceCoverageReleaseStatusCounts(
  counts: Map<SourceCoverageReleaseStatus, number>,
  color = false,
): string {
  return [...counts.entries()].map(([status, count]) => formatStatusCount(status, count, color))
    .join(", ");
}

function formatStatusCount(status: string, count: number, color: boolean): string {
  return `${colorize(status, styleForStatus(status, count), color)} ${count}`;
}

function styleForStatus(status: string, count: number): AnsiStyle {
  if (count === 0) {
    return "cyan";
  }
  switch (status) {
    case "collected":
    case "exported":
    case "applied":
      return "green";
    case "collected_empty":
    case "inventory_only":
    case "not_collected":
    case "deferred":
    case "drafted":
    case "open":
      return "yellow";
    case "blocking":
    case "actionable":
      return "red";
    default:
      return "cyan";
  }
}

function styleForReviewCount(status: string, count: number): AnsiStyle {
  if (count === 0) {
    return "green";
  }
  return styleForStatus(status, count);
}

function styleForSeverity(severity: string): AnsiStyle {
  switch (severity) {
    case "high":
      return "red";
    case "medium":
      return "yellow";
    default:
      return "cyan";
  }
}

function colorize(value: string, style: AnsiStyle, enabled = cliColorEnabled()): string {
  if (!enabled) {
    return value;
  }
  const [open, close] = ANSI_STYLES[style];
  return `${open}${value}${close}`;
}

function cliColorEnabled(): boolean {
  const mode = Deno.env.get("CIVIC_LEDGER_COLOR")?.toLowerCase();
  if (mode === "always") {
    return true;
  }
  if (mode === "never" || Deno.env.has("NO_COLOR")) {
    return false;
  }
  return Deno.stdout.isTerminal();
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function safeJsonArray(value: string | null): unknown[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addCitationCounts(
  citations: unknown,
  stats: Map<string, WorkspaceCoverageStats>,
): void {
  if (!Array.isArray(citations)) {
    return;
  }
  for (const citation of citations) {
    if (!citation || typeof citation !== "object" || Array.isArray(citation)) {
      continue;
    }
    const source = (citation as Record<string, unknown>).source;
    if (typeof source !== "string" || source.length === 0) {
      continue;
    }
    let sourceStats = stats.get(source);
    if (!sourceStats) {
      sourceStats = { snapshotCount: 0, recordCount: 0, citationCount: 0 };
      stats.set(source, sourceStats);
    }
    sourceStats.citationCount += 1;
  }
}

function countWorkspaceRecords(workspace: Workspace): number {
  const row = workspace.db.prepare("SELECT COUNT(*) AS count FROM records").get() as {
    count: number;
  };
  return Number(row.count);
}

async function countCommittedStateEntries(stateRoot: string): Promise<number> {
  try {
    const loaded = await loadCommittedState(stateRoot, dcRuntime.kinds);
    return loaded.state.entries.size;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return 0;
    }
    throw error;
  }
}

async function collectSourceRecords(
  source: {
    id: string;
    jurisdiction: string;
    type: string;
  },
  workspaceRoot: string,
  limit?: number,
) {
  if (source.type === "dc.agency_directory") {
    const reader = new AgencyDirectoryReader();
    return await reader.collect({
      workspace: { root: workspaceRoot },
      source: source as Parameters<AgencyDirectoryReader["collect"]>[0]["source"],
      limit,
    });
  }

  if (source.type === "arcgis.table") {
    const reader = new ArcGISTableReader();
    return await reader.collect({
      workspace: { root: workspaceRoot },
      source: source as Parameters<ArcGISTableReader["collect"]>[0]["source"],
      limit,
    });
  }

  if (source.type === "dccouncil.committees") {
    const reader = new DCCouncilCommitteePagesReader();
    return await reader.collect({
      workspace: { root: workspaceRoot },
      source: source as Parameters<DCCouncilCommitteePagesReader["collect"]>[0]["source"],
      limit,
    });
  }

  if (source.type === "dccouncil.members") {
    const reader = new DCCouncilmembersReader();
    return await reader.collect({
      workspace: { root: workspaceRoot },
      source: source as Parameters<DCCouncilmembersReader["collect"]>[0]["source"],
      limit,
    });
  }

  if (source.type === "open_dc.public_bodies") {
    const reader = new OpenDCPublicBodiesReader();
    return await reader.collect({
      workspace: { root: workspaceRoot },
      source: source as Parameters<OpenDCPublicBodiesReader["collect"]>[0]["source"],
      limit,
    });
  }

  if (source.type === "bega.structure") {
    const reader = new BegaStructureReader();
    return await reader.collect({
      workspace: { root: workspaceRoot },
      source: source as Parameters<BegaStructureReader["collect"]>[0]["source"],
      limit,
    });
  }

  if (source.type === "dccourts.structure") {
    const reader = new DCCourtsStructureReader();
    return await reader.collect({
      workspace: { root: workspaceRoot },
      source: source as Parameters<DCCourtsStructureReader["collect"]>[0]["source"],
      limit,
    });
  }

  if (source.type === "legal.entrypoints") {
    const reader = new LegalEntrypointsReader();
    return await reader.collect({
      workspace: { root: workspaceRoot },
      source: source as Parameters<LegalEntrypointsReader["collect"]>[0]["source"],
      limit,
    });
  }

  if (source.type === "mayor.executive_structure") {
    const reader = new MayorExecutiveStructureReader();
    return await reader.collect({
      workspace: { root: workspaceRoot },
      source: source as Parameters<MayorExecutiveStructureReader["collect"]>[0]["source"],
      limit,
    });
  }

  if (source.type === "oanc.profiles") {
    const reader = new OancProfilesReader();
    return await reader.collect({
      workspace: { root: workspaceRoot },
      source: source as Parameters<OancProfilesReader["collect"]>[0]["source"],
      limit,
    });
  }

  throw new Error(`unsupported source type: ${source.type}`);
}

async function runStateGenerate(workspaceRoot: string, stateRoot: string): Promise<number> {
  const workspace = openWorkspace(workspaceRoot);
  try {
    initWorkspace(workspace);
    const recordCount = countWorkspaceRecords(workspace);
    if (recordCount === 0) {
      throw new Error(
        "workspace has no source records; run deno task civic sources list, then deno task civic collect all",
      );
    }

    const revisionRoot = revisionRootForStateRoot(stateRoot);
    const identityRoot = identityRootForStateRoot(stateRoot);
    const revisions = await loadRevisions(revisionRoot);
    const identityAliases = await loadIdentityAliases(identityRoot);
    const workspaceCompilation = compileFromWorkspace(workspace);
    workspace.db.run("DELETE FROM fragments");
    saveFragments(
      workspace,
      workspaceCompilation.fragments.map((fragment) => ({
        source: fragment.source,
        sourceRecordId: fragment.sourceRecordId,
        payload: fragment,
      })),
    );

    const result = compileFragments({
      jurisdiction: dcRuntime.jurisdiction,
      fragments: workspaceCompilation.fragments,
      kindRegistry: dcRuntime.kinds,
      promotionPolicy: dcRuntime.promotionPolicy,
      findings: workspaceCompilation.findings,
      revisions: [...dcRuntime.revisions, ...revisions],
      identityAliases,
      generatedAt: new Date().toISOString(),
    });
    const allFindings = [...result.findings, ...result.conflicts];

    workspace.db.run("DELETE FROM baselines");
    saveBaseline(workspace, {
      jurisdiction: dcRuntime.jurisdiction,
      source: "compiler.baseline",
      payload: result.baseline,
    });

    workspace.db.run("DELETE FROM findings");
    for (const finding of allFindings) {
      saveFinding(workspace, finding);
    }

    if (!result.ok || !result.state) {
      for (const finding of result.conflicts) {
        console.error(`${finding.code}: ${finding.message}`);
      }
      return 1;
    }

    const draftRevisions = await safelyLoadDraftRevisions(workspaceRoot);
    const reviewItems = generateReviewItems(result.state, allFindings, {
      trackedRevisions: [...dcRuntime.revisions, ...revisions],
      draftRevisions,
      generatedAt: result.state.generatedAt,
    });
    await saveReviewItems(workspaceRoot, reviewItems);

    const sourceCoverageStats = buildCommittedSourceCoverageStats(workspace, result.state);
    await writeCommittedState(result.state, stateRoot, { sourceCoverageStats });
    console.log(`state generated with ${result.state.entries.size} entries`);
    console.log(formatReviewQueueSummary(reviewItems));
    return 0;
  } finally {
    closeWorkspace(workspace);
  }
}

async function runStateIndex(workspaceRoot: string, stateRoot: string): Promise<number> {
  const loaded = await loadCommittedState(stateRoot, dcRuntime.kinds);

  const workspace = openWorkspace(workspaceRoot);
  try {
    initWorkspace(workspace);
    indexState(workspace, loaded.state);
    console.log(`state indexed: ${loaded.state.entries.size} entries`);
    return 0;
  } finally {
    closeWorkspace(workspace);
  }
}

async function runCheck(workspaceRoot: string, stateRoot: string): Promise<number> {
  const loaded = await loadCommittedStateForCli(stateRoot, "check");

  const workspace = openWorkspace(workspaceRoot);
  try {
    initWorkspace(workspace);
    if (loaded.state.entries.size > 0) {
      console.log(`check passed with ${loaded.state.entries.size} entries`);
    } else {
      console.error(
        "committed state has no entries; run deno task civic state generate before check/export",
      );
      return 1;
    }
    console.log("Next: deno task civic export");
    return 0;
  } finally {
    closeWorkspace(workspace);
  }
}

async function runExport(
  workspaceRoot: string,
  stateRoot: string,
  releaseRoot: string,
): Promise<number> {
  const loaded = await loadCommittedStateForCli(stateRoot, "export");
  if (loaded.state.entries.size === 0) {
    throw new Error(
      "state has no entries; run deno task civic state generate, then deno task civic check before export",
    );
  }

  const workspace = openWorkspace(workspaceRoot);
  try {
    initWorkspace(workspace);
    indexState(workspace, loaded.state);
    const reviewItems = await refreshReviewItemsFromCommittedState(workspaceRoot, stateRoot, {
      includePersistedFindings: false,
    });
    const result = await exportReleaseArtifacts({
      workspace,
      jurisdiction: dcRuntime.jurisdiction,
      releaseRoot,
      sourceCatalog: dcRuntime.sourceCoverage,
      sourceCoverageStats: loaded.sourceCoverageStats,
      reviewItems,
    });
    const color = cliColorEnabled();
    console.log(
      `${colorize("exported", "green", color)} ${
        colorize(String(result.entryCount), "green", color)
      } entries, ${colorize(String(result.relationCount), "green", color)} relations to ${
        colorize(result.releaseRoot, "cyan", color)
      }`,
    );
    console.log(
      `GovGraph projection: ${colorize(String(result.govGraphNodeCount), "green", color)} nodes, ${
        colorize(String(result.govGraphEdgeCount), "green", color)
      } edges; excluded ${
        colorize(
          String(result.govGraphExcludedNodeCount),
          result.govGraphExcludedNodeCount === 0 ? "green" : "yellow",
          color,
        )
      } nodes, ${
        colorize(
          String(result.govGraphExcludedEdgeCount),
          result.govGraphExcludedEdgeCount === 0 ? "green" : "yellow",
          color,
        )
      } edges; blocking review items ${
        colorize(
          String(result.govGraphBlockedReviewItemCount),
          result.govGraphBlockedReviewItemCount === 0 ? "green" : "red",
          color,
        )
      }`,
    );
    console.log(colorize("Release artifact highlights:", "cyan", color));
    for (const artifact of RELEASE_ARTIFACT_HINTS) {
      console.log(`  - ${artifact}`);
    }
    console.log(
      `Inspect source coverage: ${
        colorize(join(result.releaseRoot, "_local/source_coverage.csv"), "cyan", color)
      }`,
    );
    console.log(
      `Verify release: ${
        colorize(`deno task civic release verify ${result.releaseRoot}`, "cyan", color)
      }`,
    );
    return 0;
  } finally {
    closeWorkspace(workspace);
  }
}

async function runReleaseVerify(
  releaseRoot: string,
  options: ReleaseVerifyOptions = {},
): Promise<number> {
  const verification = await verifyReleaseArtifacts(releaseRoot);
  const publishErrors = options.publish && verification.valid
    ? await validatePublishReadyProvenance(verification.manifestPath)
    : [];
  const result = {
    ...verification,
    valid: verification.valid && publishErrors.length === 0,
    ...(options.publish
      ? {
        publishReady: publishErrors.length === 0,
        publishErrors,
      }
      : {}),
    errors: [...verification.errors, ...publishErrors],
  };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.valid ? 0 : 1;
  }

  const color = cliColorEnabled();
  if (result.valid) {
    console.log(
      `${colorize("release verified", "green", color)}: ${
        colorize(String(result.checkedFileCount), "green", color)
      } payload files match ${colorize(result.manifestPath, "cyan", color)}; ${
        colorize(
          "schema version, release identity, artifact counts, kind rollups, zero blocking/actionable/drafted review items, review posture/categories/deferred descriptions, source coverage metadata/statuses, and GovGraph summary agreements passed",
          "green",
          color,
        )
      }`,
    );
    if (options.publish) {
      console.log(
        colorize(
          "publish provenance gate passed: manifest and current git checkout match a clean worktree",
          "green",
          color,
        ),
      );
    }
    return 0;
  }

  console.error(`${colorize("release verification failed", "red", color)} for ${releaseRoot}:`);
  for (const error of result.errors) {
    console.error(`  - ${error}`);
  }
  return 1;
}

async function validatePublishReadyProvenance(manifestPath: string): Promise<string[]> {
  const errors: string[] = [];
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await Deno.readTextFile(manifestPath)) as unknown;
    if (!isPlainRecord(parsed)) {
      return ["manifest.json must contain a JSON object for publish provenance verification"];
    }
    manifest = parsed;
  } catch (error) {
    return [
      `unable to read manifest for publish provenance verification: ${(error as Error).message}`,
    ];
  }

  const provenance = isPlainRecord(manifest.provenance) ? manifest.provenance : null;
  if (!provenance) {
    return ["manifest.provenance is required for publish provenance verification"];
  }
  if (provenance.gitSource !== "git_metadata") {
    errors.push("manifest.provenance.gitSource must be git_metadata for publish");
  }
  if (typeof provenance.gitHeadCommit !== "string" || provenance.gitHeadCommit.length === 0) {
    errors.push("manifest.provenance.gitHeadCommit is required for publish");
  }
  if (provenance.workingTreeStatus !== "clean") {
    errors.push(
      `manifest.provenance.workingTreeStatus must be clean for publish, found ${
        String(provenance.workingTreeStatus)
      }`,
    );
  }
  if (provenance.workingTreeChangedPathCount !== 0) {
    errors.push(
      `manifest.provenance.workingTreeChangedPathCount must be 0 for publish, found ${
        String(provenance.workingTreeChangedPathCount)
      }`,
    );
  }

  const currentGit = await readCurrentGitPublishState();
  if (!currentGit.available) {
    errors.push(`current git metadata is required for publish: ${currentGit.error}`);
    return errors;
  }
  if (
    typeof provenance.gitHeadCommit === "string" &&
    provenance.gitHeadCommit.length > 0 &&
    currentGit.headCommit !== provenance.gitHeadCommit
  ) {
    errors.push(
      `current git HEAD ${currentGit.headCommit} must match manifest.provenance.gitHeadCommit ${provenance.gitHeadCommit} for publish`,
    );
  }
  if (currentGit.workingTreeStatus !== "clean") {
    errors.push(
      `current git working tree must be clean for publish, found ${currentGit.workingTreeStatus}`,
    );
  }
  if (currentGit.workingTreeChangedPathCount !== 0) {
    errors.push(
      `current git changed path count must be 0 for publish, found ${currentGit.workingTreeChangedPathCount}`,
    );
  }
  return errors;
}

type CurrentGitPublishState =
  | {
    available: true;
    headCommit: string;
    workingTreeStatus: "clean" | "dirty";
    workingTreeChangedPathCount: number;
  }
  | {
    available: false;
    error: string;
  };

async function readCurrentGitPublishState(): Promise<CurrentGitPublishState> {
  const head = await runGitForPublish(["rev-parse", "HEAD"]);
  if (!head.ok) {
    return { available: false, error: head.error };
  }
  const headCommit = head.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(headCommit)) {
    return { available: false, error: "git rev-parse HEAD did not return a commit hash" };
  }

  const status = await runGitForPublish([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (!status.ok) {
    return { available: false, error: status.error };
  }
  const changedPathCount = countGitPorcelainStatusLines(status.stdout);
  return {
    available: true,
    headCommit,
    workingTreeStatus: changedPathCount === 0 ? "clean" : "dirty",
    workingTreeChangedPathCount: changedPathCount,
  };
}

async function runGitForPublish(args: string[]): Promise<
  | { ok: true; stdout: string }
  | { ok: false; error: string }
> {
  try {
    const output = await new Deno.Command("git", {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr).trim();
    if (!output.success) {
      return {
        ok: false,
        error: stderr.length > 0 ? stderr : `git ${args.join(" ")} exited ${output.code}`,
      };
    }
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

function countGitPorcelainStatusLines(stdout: string): number {
  const trimmed = stdout.trimEnd();
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

async function runReleaseAssets(
  releaseRoot: string,
  options: ReleaseAssetsOptions = {},
): Promise<number> {
  const releaseAssets = await loadReleaseAssetSummaries(releaseRoot);
  if (!releaseAssets.valid) {
    if (options.json) {
      console.log(JSON.stringify(
        {
          releaseRoot,
          manifestPath: releaseAssets.manifestPath,
          valid: false,
          errors: releaseAssets.errors,
        },
        null,
        2,
      ));
    } else {
      console.error(`${releaseRoot} is not release-ready; run release verify for details.`);
      for (const error of releaseAssets.errors) {
        console.error(`  - ${error}`);
      }
    }
    return 1;
  }

  const assets = releaseAssets.assets;
  const categoryCounts = assets.reduce<Record<string, number>>((counts, asset) => {
    counts[asset.category] = (counts[asset.category] ?? 0) + 1;
    return counts;
  }, {});

  if (options.json) {
    console.log(JSON.stringify(
      {
        releaseRoot,
        manifestPath: releaseAssets.manifestPath,
        valid: true,
        assetCount: assets.length,
        categoryCounts,
        assets,
      },
      null,
      2,
    ));
    return 0;
  }

  const color = cliColorEnabled();
  console.log(
    `${colorize("release assets", "green", color)}: ${
      colorize(String(assets.length), "green", color)
    } individually uploadable files from ${colorize(releaseRoot, "cyan", color)}`,
  );
  for (const category of Object.keys(categoryCounts).sort(releaseAssetCategoryCompare)) {
    console.log("");
    console.log(`${category} (${categoryCounts[category]}):`);
    for (const asset of assets.filter((candidate) => candidate.category === category)) {
      const rowLabel = typeof asset.rowCount === "number" ? ` (${asset.rowCount} rows)` : "";
      console.log(`  ${asset.path}${rowLabel} - ${asset.description}`);
    }
  }
  console.log("");
  console.log(`Manifest: ${colorize(releaseAssets.manifestPath, "cyan", color)}`);
  return 0;
}

async function runReleaseUploadPlan(
  tagName: string,
  releaseRoot: string,
  options: ReleaseUploadPlanOptions = {},
): Promise<number> {
  const releaseAssets = await loadReleaseAssetSummaries(releaseRoot);
  if (!releaseAssets.valid) {
    if (options.json) {
      console.log(JSON.stringify(
        {
          releaseRoot,
          manifestPath: releaseAssets.manifestPath,
          valid: false,
          errors: releaseAssets.errors,
        },
        null,
        2,
      ));
    } else {
      console.error(`${releaseRoot} is not release-ready; run release verify for details.`);
      for (const error of releaseAssets.errors) {
        console.error(`  - ${error}`);
      }
    }
    return 1;
  }

  const publishErrors = options.allowLocalCandidate
    ? []
    : await validatePublishReadyProvenance(releaseAssets.manifestPath);
  if (publishErrors.length > 0) {
    if (options.json) {
      console.log(JSON.stringify(
        {
          releaseRoot,
          manifestPath: releaseAssets.manifestPath,
          valid: false,
          publishReady: false,
          publishErrors,
          errors: publishErrors,
        },
        null,
        2,
      ));
    } else {
      console.error(
        `${releaseRoot} is not publish-ready; run release verify --publish for details.`,
      );
      for (const error of publishErrors) {
        console.error(`  - ${error}`);
      }
      console.error("Use --allow-local-candidate only for dry-run upload-plan rehearsals.");
    }
    return 1;
  }

  const downloadRoot = `.release-download/${tagName.replaceAll(/[^A-Za-z0-9._-]/g, "_")}`;
  const legacyTarballName = `${tagName}.tar.gz`;
  const obsoleteAssetCommands =
    releaseAssets.assets.some((asset) => asset.path === legacyTarballName) ? [] : [[
      "gh",
      "release",
      "delete-asset",
      tagName,
      legacyTarballName,
      "--yes",
    ]];
  const uploadCommand = [
    "gh",
    "release",
    "upload",
    tagName,
    ...releaseAssets.assets.map((asset) => join(releaseRoot, asset.path)),
    "--clobber",
  ];
  const downloadCommand = [
    "gh",
    "release",
    "download",
    tagName,
    "--dir",
    downloadRoot,
  ];
  const verifyDownloadedCommand = [
    "deno",
    "task",
    "civic",
    "release",
    "verify-downloaded",
    releaseRoot,
    downloadRoot,
  ];

  if (options.json) {
    console.log(JSON.stringify(
      {
        releaseRoot,
        manifestPath: releaseAssets.manifestPath,
        valid: true,
        publishReady: !options.allowLocalCandidate,
        allowLocalCandidate: options.allowLocalCandidate === true,
        tagName,
        assetCount: releaseAssets.assets.length,
        assets: releaseAssets.assets,
        obsoleteAssetCommands,
        uploadCommand,
        downloadCommand,
        verifyDownloadedCommand,
      },
      null,
      2,
    ));
    return 0;
  }

  if (options.allowLocalCandidate) {
    console.log(
      "Local-candidate upload plan; rerun without --allow-local-candidate before publish.",
    );
    console.log("");
  }
  if (obsoleteAssetCommands.length > 0) {
    console.log("Remove obsolete archive asset if present:");
    for (const command of obsoleteAssetCommands) {
      console.log(formatShellCommand(command));
    }
    console.log("");
  }
  console.log(`Upload ${releaseAssets.assets.length} release assets to ${tagName}:`);
  console.log(formatShellCommand(uploadCommand));
  console.log("");
  console.log("Download and verify uploaded assets:");
  console.log(formatShellCommand(downloadCommand));
  console.log(formatShellCommand(verifyDownloadedCommand));
  return 0;
}

async function runReleaseVerifyDownloaded(
  releaseRoot: string,
  downloadRoot: string,
  options: ReleaseVerifyDownloadedOptions = {},
): Promise<number> {
  const releaseAssets = await loadReleaseAssetSummaries(releaseRoot);
  if (!releaseAssets.valid) {
    if (options.json) {
      console.log(JSON.stringify(
        {
          releaseRoot,
          downloadRoot,
          manifestPath: releaseAssets.manifestPath,
          valid: false,
          errors: releaseAssets.errors,
        },
        null,
        2,
      ));
    } else {
      console.error(`${releaseRoot} is not release-ready; run release verify for details.`);
      for (const error of releaseAssets.errors) {
        console.error(`  - ${error}`);
      }
    }
    return 1;
  }

  const errors: string[] = [];
  const checkedAssets: Array<{
    path: string;
    byteSize: number;
    sha256: string;
  }> = [];
  const expectedPaths = new Set(releaseAssets.assets.map((asset) => asset.path));
  const downloadedPaths = await listRelativeFiles(downloadRoot).catch((error) => {
    if (error instanceof Deno.errors.NotFound) {
      errors.push(`download root not found: ${downloadRoot}`);
      return [] as string[];
    }
    throw error;
  });

  for (const asset of releaseAssets.assets) {
    const downloadedPath = join(downloadRoot, asset.path);
    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(downloadedPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        errors.push(`missing downloaded asset: ${asset.path}`);
        continue;
      }
      throw error;
    }
    const sha256 = await fileSha256(bytes);
    checkedAssets.push({ path: asset.path, byteSize: bytes.byteLength, sha256 });
    if (bytes.byteLength !== asset.byteSize) {
      errors.push(
        `downloaded asset ${asset.path} byte size ${bytes.byteLength} does not match manifest ${asset.byteSize}`,
      );
    }
    if (sha256 !== asset.sha256) {
      errors.push(
        `downloaded asset ${asset.path} sha256 ${sha256} does not match manifest ${asset.sha256}`,
      );
    }
  }

  for (const downloadedPath of downloadedPaths) {
    if (!expectedPaths.has(downloadedPath)) {
      errors.push(`unexpected downloaded asset: ${downloadedPath}`);
    }
  }

  const result = {
    releaseRoot,
    downloadRoot,
    manifestPath: releaseAssets.manifestPath,
    valid: errors.length === 0,
    expectedAssetCount: releaseAssets.assets.length,
    downloadedFileCount: downloadedPaths.length,
    checkedAssetCount: checkedAssets.length,
    errors,
    checkedAssets,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.valid ? 0 : 1;
  }

  if (!result.valid) {
    console.error(`downloaded release asset verification failed for ${downloadRoot}:`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    return 1;
  }

  console.log(
    `downloaded release assets verified: ${checkedAssets.length} files match ${releaseAssets.manifestPath}`,
  );
  return 0;
}

async function loadReleaseAssetSummaries(releaseRoot: string): Promise<ReleaseAssetLoadResult> {
  const verification = await verifyReleaseArtifacts(releaseRoot);
  if (!verification.valid) {
    return {
      valid: false,
      manifestPath: verification.manifestPath,
      errors: verification.errors,
    };
  }
  const manifest = JSON.parse(await Deno.readTextFile(verification.manifestPath)) as Record<
    string,
    unknown
  >;
  return {
    valid: true,
    manifestPath: verification.manifestPath,
    assets: await releaseAssetsFromManifest(manifest, releaseRoot, verification.manifestPath),
  };
}

async function releaseAssetsFromManifest(
  manifest: Record<string, unknown>,
  releaseRoot: string,
  manifestPath: string,
): Promise<ReleaseAssetSummary[]> {
  const outputCatalog = Array.isArray(manifest.outputCatalog) ? manifest.outputCatalog : [];
  const outputFileMetadata = isPlainRecord(manifest.outputFileMetadata)
    ? manifest.outputFileMetadata
    : {};
  const assets = outputCatalog
    .filter((item): item is Record<string, unknown> => isPlainRecord(item))
    .filter((item) => item.releaseAsset === true)
    .map((item) => {
      const outputName = String(item.outputName ?? "");
      const metadata = isPlainRecord(outputFileMetadata[outputName])
        ? outputFileMetadata[outputName]
        : {};
      return {
        outputName,
        path: String(item.path ?? ""),
        category: String(item.category ?? ""),
        description: String(item.description ?? ""),
        byteSize: typeof metadata.byteSize === "number" ? metadata.byteSize : 0,
        sha256: typeof metadata.sha256 === "string" ? metadata.sha256 : "",
        ...(typeof metadata.rowCount === "number" ? { rowCount: metadata.rowCount } : {}),
        ...(typeof metadata.columnCount === "number" ? { columnCount: metadata.columnCount } : {}),
        ...(Array.isArray(metadata.columns) &&
            metadata.columns.every((column) => typeof column === "string")
          ? { columns: metadata.columns }
          : {}),
      };
    });
  assets.push(await buildManifestReleaseAsset(releaseRoot, manifestPath));
  return assets;
}

async function buildManifestReleaseAsset(
  releaseRoot: string,
  manifestPath: string,
): Promise<ReleaseAssetSummary> {
  const bytes = await Deno.readFile(manifestPath);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    outputName: "manifestJson",
    path: relativeReleaseAssetPath(releaseRoot, manifestPath),
    category: "machine_json",
    description: "Release manifest with file sizes, hashes, row counts, and asset categories.",
    byteSize: bytes.byteLength,
    sha256: hexDigest(digest),
  };
}

function relativeReleaseAssetPath(releaseRoot: string, path: string): string {
  if (path === join(releaseRoot, "manifest.json")) {
    return "manifest.json";
  }
  return path;
}

function hexDigest(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fileSha256(bytes: Uint8Array): Promise<string> {
  const source = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(source).set(bytes);
  return hexDigest(await crypto.subtle.digest("SHA-256", source));
}

async function listRelativeFiles(root: string, prefix = ""): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of Deno.readDir(join(root, prefix))) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      paths.push(relativePath);
    } else if (entry.isDirectory) {
      paths.push(...await listRelativeFiles(root, relativePath));
    }
  }
  return paths.sort((left, right) => left.localeCompare(right));
}

function formatShellCommand(command: string[]): string {
  return command.map(shellQuote).join(" \\\n  ");
}

function releaseAssetCategoryCompare(left: string, right: string): number {
  return releaseAssetCategoryOrder(left) - releaseAssetCategoryOrder(right) ||
    left.localeCompare(right);
}

function releaseAssetCategoryOrder(category: string): number {
  const index = RELEASE_ASSET_CATEGORY_ORDER.indexOf(category);
  return index === -1 ? RELEASE_ASSET_CATEGORY_ORDER.length : index;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadCommittedStateForCli(
  stateRoot: string,
  commandName: "check" | "export",
): ReturnType<typeof loadCommittedState> {
  try {
    return await loadCommittedState(stateRoot, dcRuntime.kinds);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `committed state not found at ${stateRoot}; run deno task civic state generate before ${commandName}`,
      );
    }
    throw error;
  }
}

async function runReconcileCandidates(stateRoot: string, limit?: number): Promise<number> {
  const loaded = await loadCommittedState(stateRoot, dcRuntime.kinds);
  const report = findReconciliationCandidates(loaded.state, { limit });
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

async function runReviewList(options: ReviewListOptions): Promise<number> {
  const cliOptions = validateCliOptions(options);
  const items = await refreshReviewItemsFromCommittedState(
    cliOptions.workspace,
    cliOptions.stateRoot,
  );
  const filterResult = filterReviewItems(items, options);
  const shownItems = limitReviewItems(filterResult.filtered, cliOptions.limit);

  if (options.json) {
    console.log(JSON.stringify(
      {
        reviewItemCount: shownItems.length,
        totalReviewItemCount: items.length,
        filter: reviewListFilterJson(filterResult, items.length, cliOptions.limit),
        reviewQueueCounts: reviewQueueCountsObject(items),
        statusFilteredReviewQueueCounts: reviewQueueCountsObject(filterResult.statusFiltered),
        items: shownItems.map(reviewListJsonItem),
      },
      null,
      2,
    ));
    return 0;
  }

  printReviewList(shownItems, items.length, filterResult);
  return 0;
}

function reviewListJsonItem(item: ReviewItem): ReviewItem & {
  publicOutputImpact: boolean;
  blocksCurrentOutput: boolean;
  queue: ReviewQueue;
  queueLabel: string;
} {
  const queue = reviewQueueForItem(item);
  return {
    ...item,
    publicOutputImpact: reviewItemHasPublicOutputImpact(item),
    blocksCurrentOutput: reviewItemBlocksCurrentOutput(item),
    queue,
    queueLabel: reviewQueueLabel(queue),
  };
}

interface ReviewListFilterResult {
  filtered: ReviewItem[];
  statusFiltered: ReviewItem[];
  status: ReviewListOptions["status"] | "all";
  queue: ReviewQueueFilter;
  defaultQueueApplied: boolean;
}

function filterReviewItems(
  items: ReviewItem[],
  options: ReviewListOptions,
): ReviewListFilterResult {
  const status = options.status ?? "all";
  const statusFiltered = status && status !== "all"
    ? items.filter((item) => item.status === status)
    : items;
  const defaultQueueApplied = options.queue === undefined;
  const queue = parseReviewQueueFilter(options.queue ?? "inbox") ?? "inbox";
  let filtered: ReviewItem[];
  if (queue === "all") {
    filtered = statusFiltered;
  } else if (queue === "inbox") {
    filtered = statusFiltered.filter((item) => {
      const itemQueue = reviewQueueForItem(item);
      return itemQueue === "blocking" || itemQueue === "actionable";
    });
  } else {
    filtered = statusFiltered.filter((item) => reviewQueueForItem(item) === queue);
  }
  return {
    filtered,
    statusFiltered,
    status,
    queue,
    defaultQueueApplied,
  };
}

function reviewListFilterJson(
  filter: ReviewListFilterResult,
  totalReviewItemCount: number,
  limit?: number,
): Record<string, unknown> {
  const deferredAfterStatus =
    filter.statusFiltered.filter((item) => reviewQueueForItem(item) === "deferred").length;
  return {
    status: filter.status,
    queue: filter.queue,
    defaultQueueApplied: filter.defaultQueueApplied,
    totalReviewItemCount,
    statusMatchedReviewItemCount: filter.statusFiltered.length,
    queueMatchedReviewItemCount: filter.filtered.length,
    shownReviewItemCount: limit === undefined ? filter.filtered.length : Math.min(
      filter.filtered.length,
      limit,
    ),
    limit: limit ?? null,
    deferredMatchedReviewItemCount: deferredAfterStatus,
  };
}

function limitReviewItems(items: ReviewItem[], limit?: number): ReviewItem[] {
  return limit === undefined ? items : items.slice(0, limit);
}

type ReviewQueueFilter = ReviewQueue | "inbox" | "all";

function parseReviewQueueFilter(value: string | undefined): ReviewQueueFilter | undefined {
  if (!value) {
    return undefined;
  }
  if (
    value === "inbox" ||
    value === "all" ||
    value === "blocking" ||
    value === "actionable" ||
    value === "drafted" ||
    value === "applied" ||
    value === "deferred"
  ) {
    return value;
  }
  throw new Error(
    "review queue must be inbox, blocking, actionable, drafted, applied, deferred, or all",
  );
}

async function runReviewDashboard(options: CliOptions): Promise<number> {
  const cliOptions = validateCliOptions(options);
  const items = await refreshReviewItemsFromCommittedState(
    cliOptions.workspace,
    cliOptions.stateRoot,
  );
  printReviewDashboard(items);
  return 0;
}

async function runReviewNext(options: ReviewNextOptions): Promise<number> {
  const cliOptions = validateCliOptions(options);
  const items = await refreshReviewItemsFromCommittedState(
    cliOptions.workspace,
    cliOptions.stateRoot,
  );
  const next = items.find((item) => reviewQueueForItem(item) === "blocking") ??
    items.find((item) => reviewQueueForItem(item) === "actionable");

  if (options.json) {
    console.log(JSON.stringify(
      {
        reviewItemCount: items.length,
        reviewQueueCounts: reviewQueueCountsObject(items),
        next: next ? reviewListJsonItem(next) : null,
      },
      null,
      2,
    ));
    return 0;
  }

  if (!next) {
    printReviewDashboard(items);
    return 0;
  }
  printReviewItem(next);
  return 0;
}

async function runReviewDeferred(options: ReviewDeferredOptions): Promise<number> {
  const cliOptions = validateCliOptions(options);
  const items = await refreshReviewItemsFromCommittedState(
    cliOptions.workspace,
    cliOptions.stateRoot,
  );
  const deferred = items.filter((item) => reviewQueueForItem(item) === "deferred");
  const groups = groupDeferredReviewItems(deferred);
  const shownGroups = cliOptions.limit === undefined ? groups : groups.slice(0, cliOptions.limit);
  const sampleEvidenceByItemId = new Map<string, ReviewSourceRecordSummary[]>();
  for (const group of shownGroups) {
    const sample = group.items[0];
    if (sample) {
      sampleEvidenceByItemId.set(
        sample.id,
        summarizeReviewSourceRecords(loadReviewSourceRecords(cliOptions.workspace, sample)),
      );
    }
  }

  if (options.json) {
    console.log(JSON.stringify(
      {
        reviewItemCount: deferred.length,
        deferredReviewItemCount: deferred.length,
        totalReviewItemCount: items.length,
        groupCount: groups.length,
        shownGroupCount: shownGroups.length,
        limit: cliOptions.limit ?? null,
        groups: shownGroups.map((group) => ({
          category: group.category,
          label: group.label,
          count: group.items.length,
          sampleItemId: group.items[0]?.id ?? null,
          sampleSummary: group.items[0]?.summary ?? null,
          sampleSourceRecords: group.items[0]
            ? sampleEvidenceByItemId.get(group.items[0].id) ?? []
            : [],
          inspectCommand: group.items[0] ? reviewShowCommand(group.items[0].id) : null,
          description: deferredReviewGroupDescription(group.category, group.label) ?? null,
        })),
      },
      null,
      2,
    ));
    return 0;
  }

  printDeferredReviewSummary(
    deferred,
    items.length,
    shownGroups,
    groups.length,
    sampleEvidenceByItemId,
  );
  return 0;
}

async function runReviewShow(itemId: string, options: ReviewShowOptions): Promise<number> {
  const cliOptions = validateCliOptions(options);
  const items = await refreshReviewItemsFromCommittedState(
    cliOptions.workspace,
    cliOptions.stateRoot,
  );
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw new Error(`review item not found: ${itemId}`);
  }

  const sourceRecords = loadReviewSourceRecords(cliOptions.workspace, item);
  if (options.json) {
    console.log(JSON.stringify(reviewShowJsonItem(item, sourceRecords), null, 2));
    return 0;
  }

  printReviewItem(item, sourceRecords);
  return 0;
}

function reviewShowJsonItem(
  item: ReviewItem,
  sourceRecords: ReviewSourceRecordEvidence[],
): ReviewItem & {
  queue: ReviewQueue;
  queueLabel: string;
  sourceRecordSummaries: ReviewSourceRecordSummary[];
  sourceRecords: ReviewSourceRecordEvidence[];
} {
  return {
    ...reviewListJsonItem(item),
    sourceRecordSummaries: summarizeReviewSourceRecords(sourceRecords),
    sourceRecords,
  };
}

function loadReviewSourceRecords(
  workspaceRoot: string,
  item: ReviewItem,
): ReviewSourceRecordEvidence[] {
  const refs = sourceRecordRefsForReviewItem(item);
  if (refs.length === 0) {
    return [];
  }

  const workspace = openWorkspace(workspaceRoot);
  try {
    initWorkspace(workspace);
    const recordsBySource = new Map<string, ReturnType<typeof loadRecords>>();
    return refs.map((ref) => {
      const records = recordsBySource.get(ref.source) ?? loadRecords(workspace, ref.source);
      recordsBySource.set(ref.source, records);
      const record = records.find((candidate) => candidate.key === ref.sourceRecordId);
      if (!record) {
        return {
          source: ref.source,
          sourceRecordId: ref.sourceRecordId,
          found: false,
        };
      }
      return {
        source: ref.source,
        sourceRecordId: ref.sourceRecordId,
        found: true,
        snapshotKey: record.snapshotKey,
        payload: record.payload,
      };
    });
  } finally {
    closeWorkspace(workspace);
  }
}

function summarizeReviewSourceRecords(
  records: ReviewSourceRecordEvidence[],
): ReviewSourceRecordSummary[] {
  return records.map((record) => ({
    source: record.source,
    sourceRecordId: record.sourceRecordId,
    found: record.found,
    urls: record.found ? sourceRecordUrls(record.payload).slice(0, 3) : [],
  }));
}

function sourceRecordUrls(payload: Record<string, unknown> | undefined): string[] {
  if (!payload) {
    return [];
  }

  const urls: string[] = [];
  for (
    const key of [
      "detailUrl",
      "sourceUrl",
      "sourcePageUrl",
      "sourcePageUrls",
      "profileUrl",
      "officialUrl",
      "url",
      "enablingStatuteUrl",
    ]
  ) {
    collectUrlValue(payload[key], urls);
  }
  return [...new Set(urls)].sort();
}

function collectUrlValue(value: unknown, urls: string[]): void {
  if (typeof value === "string" && isHttpUrl(value)) {
    urls.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrlValue(item, urls);
    }
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sourceRecordRefsForReviewItem(
  item: ReviewItem,
): Array<{ source: string; sourceRecordId: string }> {
  const refs = new Map<string, { source: string; sourceRecordId: string }>();
  for (const citation of [...item.sourceRefs, ...item.citations]) {
    if (
      "source" in citation && typeof citation.source === "string" &&
      typeof citation.sourceRecordId === "string"
    ) {
      const key = `${citation.source}\0${citation.sourceRecordId}`;
      refs.set(key, {
        source: citation.source,
        sourceRecordId: citation.sourceRecordId,
      });
    }
  }
  return [...refs.values()].sort((left, right) =>
    left.source.localeCompare(right.source) ||
    left.sourceRecordId.localeCompare(right.sourceRecordId)
  );
}

async function runReviewResolve(
  itemId: string,
  options: ReviewResolveOptions,
): Promise<number> {
  const cliOptions = validateCliOptions(options);
  const items = await refreshReviewItemsFromCommittedState(
    cliOptions.workspace,
    cliOptions.stateRoot,
  );
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw new Error(`review item not found: ${itemId}`);
  }

  if (!options.as) {
    printReviewItem(item);
    console.log("");
    console.log("Choose a decision with one of:");
    for (const command of reviewDecisionCommandExamples(item)) {
      console.log(`  ${command}`);
    }
    return 1;
  }

  const decisionType = parseReviewResolutionType(options.as);
  const draft = createDraftRevision(item, {
    decisionType,
    targetId: options.target,
    kind: options.kind,
    rationale: options.rationale,
  });
  const path = await writeDraftRevision(cliOptions.workspace, draft);
  await refreshReviewItemsFromCommittedState(cliOptions.workspace, cliOptions.stateRoot);
  console.log(`draft revision written: ${path}`);
  console.log(`draft id: ${draft.id}`);
  console.log(`validate: deno task civic revision validate`);
  console.log(`apply:    deno task civic revision apply-draft ${draft.id}`);
  return 0;
}

async function runRevisionValidate(workspaceRoot: string, stateRoot: string): Promise<number> {
  const revisionRoot = revisionRootForStateRoot(stateRoot);
  const identityRoot = identityRootForStateRoot(stateRoot);
  const trackedRevisions = await loadRevisions(revisionRoot);
  const identityAliases = await loadIdentityAliases(identityRoot);
  const identityResolver = buildIdentityAliasResolver(identityAliases);
  const loadedState = await loadCommittedState(stateRoot, dcRuntime.kinds);
  if (identityResolver.issues.length > 0) {
    for (const issue of identityResolver.issues) {
      console.error(`${issue.code}: ${issue.message}`);
    }
    return 1;
  }
  const targetIssues = identityResolver.assertTargetExists(loadedState.state.entries);
  if (targetIssues.length > 0) {
    for (const issue of targetIssues) {
      console.error(`${issue.code}: ${issue.message}`);
    }
    return 1;
  }
  const draftRevisions = await loadDraftRevisions(workspaceRoot);
  console.log(
    `revision validation passed: ${trackedRevisions.length} tracked, ${draftRevisions.length} draft, ${identityAliases.length} identity aliases`,
  );
  return 0;
}

async function runRevisionApplyDraft(
  workspaceRoot: string,
  stateRoot: string,
  draftId: string,
): Promise<number> {
  const revisionRoot = revisionRootForStateRoot(stateRoot);
  const path = await applyDraftRevision(workspaceRoot, revisionRoot, draftId);
  console.log(`tracked revision written: ${path}`);
  return 0;
}

async function refreshReviewItemsFromCommittedState(
  workspaceRoot: string,
  stateRoot: string,
  options: { includePersistedFindings?: boolean } = {},
): Promise<ReviewItem[]> {
  const loaded = await loadCommittedState(stateRoot, dcRuntime.kinds);
  const revisionRoot = revisionRootForStateRoot(stateRoot);
  const trackedRevisions = await loadRevisions(revisionRoot);
  const draftRevisions = await safelyLoadDraftRevisions(workspaceRoot);
  const persistedFindings = options.includePersistedFindings === false
    ? []
    : loadPersistedFindings(workspaceRoot);
  const findings = loaded.state.findings.length > 0 ? loaded.state.findings : persistedFindings;
  const items = generateReviewItems(loaded.state, findings, {
    trackedRevisions: [...dcRuntime.revisions, ...trackedRevisions],
    draftRevisions,
    generatedAt: loaded.state.generatedAt,
  });
  await saveReviewItems(workspaceRoot, items);
  return await loadReviewItems(workspaceRoot);
}

function loadPersistedFindings(workspaceRoot: string): Finding[] {
  const workspace = openWorkspace(workspaceRoot);
  try {
    initWorkspace(workspace);
    const rows = workspace.db.prepare("SELECT payload FROM findings ORDER BY id ASC")
      .all() as Array<
        { payload: string }
      >;
    const findings: Finding[] = [];
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload) as Finding;
        if (
          payload &&
          typeof payload === "object" &&
          typeof payload.kind === "string" &&
          typeof payload.code === "string" &&
          typeof payload.message === "string"
        ) {
          findings.push(payload);
        }
      } catch {
        continue;
      }
    }
    return findings;
  } finally {
    closeWorkspace(workspace);
  }
}

async function safelyLoadDraftRevisions(workspaceRoot: string): Promise<DraftRevision[]> {
  try {
    return await loadDraftRevisions(workspaceRoot);
  } catch (error) {
    console.error(
      `warning: draft revisions could not be loaded: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    return [];
  }
}

function compileFromWorkspace(
  workspace: Workspace,
): WorkspaceCompilation {
  const allFragments: Array<EntryFragment | RelationFragment> = [];
  const allFindings: Finding[] = [];
  const interpreterContext: DcInterpreterContext = {};

  for (const sourceBinding of dcRuntime.sources) {
    const records = loadRecords(workspace, sourceBinding.source.id);
    const interpreted = sourceBinding.interpret(records, interpreterContext);

    allFragments.push(...interpreted.entryFragments, ...interpreted.relationFragments);
    allFindings.push(...interpreted.findings);

    if (sourceBinding.source.id === "dcgis.agencies") {
      for (const entryFragment of interpreted.entryFragments) {
        if (entryFragment.kind !== "dc.agency") {
          continue;
        }
        if (!interpreterContext.agencyLookup) {
          interpreterContext.agencyLookup = new Map();
        }
        if (!interpreterContext.agencyIdLookup) {
          interpreterContext.agencyIdLookup = new Map();
        }
        if (!interpreterContext.agencyNameLookup) {
          interpreterContext.agencyNameLookup = new Map();
        }
        const agencyId = typeof entryFragment.attributes.sourceAgencyId === "string"
          ? entryFragment.attributes.sourceAgencyId
          : entryFragment.provisionalId.startsWith("dc.agency:")
          ? entryFragment.provisionalId.replace("dc.agency:", "")
          : entryFragment.provisionalId;
        interpreterContext.agencyIdLookup.set(agencyId, entryFragment.provisionalId);
        interpreterContext.agencyNameLookup.set(entryFragment.provisionalId, entryFragment.name);

        const normalizedName = normalizeAgencyLookupKey(entryFragment.name);
        if (normalizedName.length > 0 && !interpreterContext.agencyLookup.has(normalizedName)) {
          interpreterContext.agencyLookup.set(normalizedName, entryFragment.provisionalId);
        }

        const shortName = entryFragment.attributes.shortName;
        if (typeof shortName === "string") {
          const normalizedShortName = normalizeAgencyLookupKey(shortName);
          if (
            normalizedShortName.length > 0 &&
            !interpreterContext.agencyLookup.has(normalizedShortName)
          ) {
            interpreterContext.agencyLookup.set(normalizedShortName, entryFragment.provisionalId);
          }
        }
      }
    }

    if (
      sourceBinding.source.id === "dcgis.boards" ||
      sourceBinding.source.id === "dcgis.commissions" ||
      sourceBinding.source.id === "dcgis.councils" ||
      sourceBinding.source.id === "dcgis.authorities"
    ) {
      for (const entryFragment of interpreted.entryFragments) {
        if (
          entryFragment.kind !== "dc.board" &&
          entryFragment.kind !== "dc.commission" &&
          entryFragment.kind !== "dc.council" &&
          entryFragment.kind !== "dc.authority"
        ) {
          continue;
        }
        if (!interpreterContext.publicBodyLookup) {
          interpreterContext.publicBodyLookup = new Map();
        }
        const lookupKey = publicBodyLookupKey(entryFragment.kind, entryFragment.name);
        if (!interpreterContext.publicBodyLookup.has(lookupKey)) {
          interpreterContext.publicBodyLookup.set(lookupKey, {
            provisionalId: entryFragment.provisionalId,
            sourceRecordId: entryFragment.sourceRecordId,
          });
        }
      }
    }
  }
  return { fragments: allFragments, findings: allFindings };
}

function createCli(onExitCode: (code: number) => void): Command<CliOptions> {
  const root = new Command<CliOptions>()
    .name("dc")
    .description(
      `Civic Ledger operator CLI. Common flow: ${OPERATOR_FLOW.join(" -> ")}.`,
    )
    .throwErrors()
    .globalOption("--workspace <path:string>", "Workspace root path.", {
      default: ".civic/workspace",
    })
    .globalOption("--state-root <path:string>", "Committed state root path.", {
      default: join("ledger", dcRuntime.jurisdiction, "state"),
    })
    .globalOption("--release-root <path:string>", "Release output root path.", {
      default: "releases/latest",
    })
    .globalOption("--limit <limit:integer>", "Limit collected records.")
    .action(async (options) => {
      onExitCode(await runStatus(validateCliOptions(options)));
    });

  root.command("init", "Create/check the local workspace and print first-run next steps.")
    .action(async (options) => {
      onExitCode(await runInit(validateCliOptions(options)));
    });

  root.command("status", "Show workspace, source, state, and review readiness.")
    .option("--json", "Emit status metadata as JSON.")
    .action(async (options) => {
      onExitCode(await runStatus(options));
    });

  const sources = new Command<CliOptions>()
    .description("Source catalog and source coverage commands.")
    .action(() => {
      throw new Error(
        "sources requires `list`; try deno task civic sources list --json for coverage metadata",
      );
    });

  sources.command("list", "List configured source IDs and coverage scope.")
    .option("--json", "Emit source metadata as JSON.")
    .action(async (options) => {
      onExitCode(await runSourcesList(options as SourceListOptions));
    });

  root.command("sources", sources);

  root.command("collect <sourceId:string>", "Collect one source, or use `collect all`.")
    .action(async (options, sourceId) => {
      const cliOptions = validateCliOptions(options);
      onExitCode(await runCollect(sourceId, cliOptions.workspace, cliOptions.limit));
    });

  root.command("compile", "Compile committed state from workspace records.")
    .action(async (options) => {
      const cliOptions = validateCliOptions(options);
      onExitCode(await runStateGenerate(cliOptions.workspace, cliOptions.stateRoot));
    });

  const state = new Command<CliOptions>()
    .description("State management commands.")
    .action(() => {
      throw new Error(
        "state requires `generate` or `index`; common flow is revision validate -> state generate -> check -> export",
      );
    });

  state.command("generate", "Compile committed state from workspace records.")
    .action(async (options) => {
      const cliOptions = validateCliOptions(options);
      onExitCode(await runStateGenerate(cliOptions.workspace, cliOptions.stateRoot));
    });

  state.command("index", "Index committed state into the workspace.")
    .action(async (options) => {
      const cliOptions = validateCliOptions(options);
      onExitCode(await runStateIndex(cliOptions.workspace, cliOptions.stateRoot));
    });

  root.command("state", state);

  root.command("check", "Validate committed state before export.")
    .action(async (options) => {
      const cliOptions = validateCliOptions(options);
      onExitCode(await runCheck(cliOptions.workspace, cliOptions.stateRoot));
    });

  root.command("export", "Export release artifacts from committed state.")
    .action(async (options) => {
      const cliOptions = validateCliOptions(options);
      onExitCode(
        await runExport(cliOptions.workspace, cliOptions.stateRoot, cliOptions.releaseRoot),
      );
    });

  const release = new Command<CliOptions>()
    .description("Release artifact commands.")
    .action(() => {
      throw new Error(
        "release requires `verify`, `assets`, `upload-plan`, or `verify-downloaded`; try deno task civic release verify releases/latest",
      );
    });

  release.command(
    "verify [releaseRoot:string]",
    "Verify release identity, payload metadata, source coverage statuses, review category posture, zero blockers, and manifest contracts.",
  )
    .option("--json", "Emit release verification result as JSON.")
    .option("--publish", "Require publish-grade provenance with a clean git worktree.")
    .action(async (options, releaseRootArg?: string) => {
      const cliOptions = validateCliOptions(options);
      onExitCode(await runReleaseVerify(releaseRootArg ?? cliOptions.releaseRoot, options));
    });

  release.command(
    "assets [releaseRoot:string]",
    "List individually uploadable release assets from the verified manifest catalog.",
  )
    .option("--json", "Emit release asset metadata as JSON.")
    .action(async (options, releaseRootArg?: string) => {
      const cliOptions = validateCliOptions(options);
      onExitCode(await runReleaseAssets(releaseRootArg ?? cliOptions.releaseRoot, options));
    });

  release.command(
    "upload-plan <tagName:string> [releaseRoot:string]",
    "Print GitHub upload and download-verification commands for a publish-ready release.",
  )
    .option("--json", "Emit upload and verification commands as JSON arrays.")
    .option(
      "--allow-local-candidate",
      "Bypass publish provenance checks for local dry-run upload-plan rehearsals.",
    )
    .action(async (options, tagName: string, releaseRootArg?: string) => {
      const cliOptions = validateCliOptions(options);
      onExitCode(
        await runReleaseUploadPlan(tagName, releaseRootArg ?? cliOptions.releaseRoot, options),
      );
    });

  release.command(
    "verify-downloaded <releaseRoot:string> <downloadRoot:string>",
    "Verify downloaded GitHub release assets against the local release manifest.",
  )
    .option("--json", "Emit downloaded asset verification result as JSON.")
    .action(async (options, releaseRoot: string, downloadRoot: string) => {
      onExitCode(await runReleaseVerifyDownloaded(releaseRoot, downloadRoot, options));
    });

  root.command("release", release);

  const reconcile = new Command<CliOptions>()
    .description("Reconciliation review commands.")
    .action(() => {
      throw new Error("reconcile requires `candidates`");
    });

  reconcile.command("candidates", "Emit reconciliation candidate review packets as JSON.")
    .action(async (options) => {
      const cliOptions = validateCliOptions(options);
      onExitCode(await runReconcileCandidates(cliOptions.stateRoot, cliOptions.limit));
    });

  root.command("reconcile", reconcile);

  const review = new Command<CliOptions>()
    .description("Review workflow commands; read commands refresh items from committed state.")
    .action(async (options) => {
      onExitCode(await runReviewDashboard(validateCliOptions(options)));
    });

  review.command("list", "Refresh from committed state and list persisted review items.")
    .option("--json", "Emit review items as JSON.")
    .option("--status <status:string>", "Filter by open, drafted, applied, or all.", {
      default: "all",
    })
    .option(
      "--queue <queue:string>",
      "Filter by inbox, blocking, actionable, drafted, applied, deferred, or all.",
    )
    .action(async (options) => {
      onExitCode(await runReviewList(options as ReviewListOptions));
    });

  review.command("inbox", "Refresh from committed state and list operator-decision review items.")
    .option("--json", "Emit review items as JSON.")
    .action(async (options) => {
      onExitCode(await runReviewList({ ...(options as CliOptions), queue: "inbox" }));
    });

  review.command("next", "Refresh from committed state and show the next actionable review item.")
    .option("--json", "Emit the next review item as JSON.")
    .action(async (options) => {
      onExitCode(await runReviewNext(options as ReviewNextOptions));
    });

  review.command(
    "deferred",
    "Refresh from committed state and summarize parked review items by group.",
  )
    .option("--json", "Emit deferred review groups as JSON.")
    .action(async (options) => {
      onExitCode(await runReviewDeferred(options as ReviewDeferredOptions));
    });

  review.command(
    "show <itemId:string>",
    "Refresh from committed state and show one review item evidence packet.",
  )
    .option("--json", "Emit the review item plus matching source records as JSON.")
    .action(async (options, itemId) => {
      onExitCode(await runReviewShow(itemId, options as ReviewShowOptions));
    });

  review.command("resolve <itemId:string>", "Write a draft revision for a review resolution.")
    .option("--as <decision:string>", "Resolution type.")
    .option("--target <entry-id:string>", "Canonical or target entry ID.")
    .option("--kind <kind:string>", "Kind to use with override-kind.")
    .option("--rationale <text:string>", "Operator rationale for the draft revision.")
    .action(async (options, itemId) => {
      onExitCode(await runReviewResolve(itemId, options as ReviewResolveOptions));
    });

  review.command("decide <itemId:string>", "Alias for resolve: write a draft review decision.")
    .option("--as <decision:string>", "Decision type.")
    .option("--target <entry-id:string>", "Canonical or target entry ID.")
    .option("--kind <kind:string>", "Kind to use with override-kind.")
    .option("--rationale <text:string>", "Operator rationale for the draft revision.")
    .action(async (options, itemId) => {
      onExitCode(await runReviewResolve(itemId, options as ReviewResolveOptions));
    });

  root.command("review", review);

  const revision = new Command<CliOptions>()
    .description("Revision workflow commands.")
    .action(() => {
      throw new Error("revision requires `validate` or `apply-draft`");
    });

  revision.command("validate", "Validate tracked and draft revisions.")
    .action(async (options) => {
      const cliOptions = validateCliOptions(options);
      onExitCode(await runRevisionValidate(cliOptions.workspace, cliOptions.stateRoot));
    });

  revision.command("apply-draft <draftId:string>", "Apply a draft revision as tracked curation.")
    .action(async (options, draftId) => {
      const cliOptions = validateCliOptions(options);
      onExitCode(await runRevisionApplyDraft(cliOptions.workspace, cliOptions.stateRoot, draftId));
    });

  root.command("revision", revision);

  return root;
}

function printReviewList(
  items: ReviewItem[],
  totalCount: number,
  filter?: ReviewListFilterResult,
): void {
  const color = cliColorEnabled();
  const matchingCount = filter?.filtered.length ?? items.length;
  if (items.length === 0) {
    if (matchingCount > 0) {
      console.log(`0 shown, ${matchingCount} matching, ${totalCount} total`);
      console.log("Increase --limit to show matching review items.");
      return;
    }
    console.log(`no matching review items (${totalCount} total)`);
    if (filter) {
      console.log(`Filter: status=${filter.status}, queue=${filter.queue}`);
      if (filter.statusFiltered.length > 0) {
        console.log(
          `${filter.statusFiltered.length} item(s) matched status before queue filtering.`,
        );
      }
      const hiddenDeferredCount = filter.statusFiltered.filter((item) =>
        reviewQueueForItem(item) === "deferred"
      ).length;
      if (hiddenDeferredCount > 0 && filter.queue !== "deferred" && filter.queue !== "all") {
        console.log(
          `${hiddenDeferredCount} deferred item(s) are outside this queue; use --queue deferred, --queue all, or review deferred.`,
        );
      }
    }
    return;
  }

  console.log(
    [
      "QUEUE".padEnd(14),
      "SEVERITY".padEnd(8),
      "CATEGORY".padEnd(28),
      "QUESTION",
    ].join("  "),
  );
  for (const item of items) {
    const queue = reviewQueueForItem(item);
    console.log(
      [
        colorize(reviewQueueLabel(queue).padEnd(14), styleForStatus(queue, 1), color),
        colorize(item.severity.padEnd(8), styleForSeverity(item.severity), color),
        item.category.padEnd(28),
        reviewQuestion(item),
      ].join("  "),
    );
    console.log(`  id: ${item.id}`);
  }
  console.log(`${items.length} shown, ${matchingCount} matching, ${totalCount} total`);
  const hiddenQueueHint = reviewListHiddenQueueHint(filter);
  if (hiddenQueueHint) {
    console.log(hiddenQueueHint);
  }
}

function reviewListHiddenQueueHint(filter: ReviewListFilterResult | undefined): string | null {
  if (!filter || filter.queue === "all") {
    return null;
  }

  const hiddenQueues = new Set<ReviewQueue>();
  for (const item of filter.statusFiltered) {
    const itemQueue = reviewQueueForItem(item);
    if (filter.queue === "inbox" && (itemQueue === "blocking" || itemQueue === "actionable")) {
      continue;
    }
    if (itemQueue !== filter.queue) {
      hiddenQueues.add(itemQueue);
    }
  }

  const hiddenLabels = (["applied", "deferred"] as const).filter((queue) =>
    hiddenQueues.has(queue)
  );
  if (hiddenLabels.length === 0) {
    return null;
  }
  return `Use --queue all to include ${formatList(hiddenLabels)} items.`;
}

function formatList(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function printDeferredReviewSummary(
  items: ReviewItem[],
  totalCount: number,
  groups = groupDeferredReviewItems(items),
  totalGroupCount = groups.length,
  sampleEvidenceByItemId: Map<string, ReviewSourceRecordSummary[]> = new Map(),
): void {
  const color = cliColorEnabled();
  console.log("Deferred Review Items");
  console.log("");
  console.log(
    "These are parked because they do not currently affect public output or the active release decision path.",
  );
  console.log("");
  if (items.length === 0) {
    console.log(`No deferred review items (${totalCount} total).`);
    return;
  }

  console.log(["COUNT".padEnd(5), "CATEGORY".padEnd(28), "SOURCE/FINDING"].join("  "));
  for (const group of groups) {
    console.log([
      colorize(String(group.items.length).padEnd(5), "yellow", color),
      colorize(group.category.padEnd(28), "yellow", color),
      group.label,
    ].join("  "));
    const sample = group.items[0];
    console.log(`  sample: ${sample.id}`);
    console.log(`  sample summary: ${sample.summary}`);
    const sampleEvidence = sampleEvidenceByItemId.get(sample.id) ?? [];
    if (sampleEvidence.length > 0) {
      console.log(`  sample sources: ${formatSourceRecordSummaries(sampleEvidence)}`);
    }
    console.log(`  inspect: ${reviewShowCommand(sample.id)}`);
    const description = deferredReviewGroupDescription(group.category, group.label);
    if (description) {
      console.log(`  why: ${description}`);
    }
  }
  console.log("");
  if (groups.length < totalGroupCount) {
    console.log(`${groups.length} shown deferred groups, ${totalGroupCount} total groups`);
  }
  console.log(
    `${colorize(String(items.length), "yellow", color)} deferred, ${totalCount} total review items`,
  );
  console.log("Inspect one with: deno task civic review show <item-id>");
}

function formatSourceRecordSummaries(records: ReviewSourceRecordSummary[]): string {
  return records.map((record) => {
    const ref = `${record.source}:${record.sourceRecordId}`;
    if (!record.found) {
      return `${ref} (not found)`;
    }
    if (record.urls.length === 0) {
      return ref;
    }
    return `${ref} (${record.urls.join(", ")})`;
  }).join("; ");
}

function reviewShowCommand(itemId: string): string {
  return `deno task civic review show ${itemId}`;
}

function printReviewDashboard(items: ReviewItem[]): void {
  const color = cliColorEnabled();
  const queueCounts = countReviewQueues(items);
  const statusCounts = countReviewStatuses(items);
  const outputImpactingBlockers = items.filter((item) =>
    item.status === "open" &&
    item.blocks.releaseReadiness &&
    reviewItemHasPublicOutputImpact(item)
  ).length;
  const stateBlockers =
    items.filter((item) => item.status === "open" && item.blocks.stateGeneration).length;
  const next = items.find((item) => reviewQueueForItem(item) === "blocking") ??
    items.find((item) => reviewQueueForItem(item) === "actionable");

  console.log("Civic Ledger Review");
  console.log("");
  console.log("Readiness");
  console.log(
    `  ${
      colorize(String(stateBlockers), stateBlockers > 0 ? "red" : "green", color)
    } state-generation blockers`,
  );
  console.log(
    `  ${
      colorize(
        String(outputImpactingBlockers),
        outputImpactingBlockers > 0 ? "red" : "green",
        color,
      )
    } public-output blockers`,
  );
  console.log("");
  console.log("Decision queues");
  for (
    const queue of ["blocking", "actionable", "drafted", "applied", "deferred"] as ReviewQueue[]
  ) {
    const count = queueCounts.get(queue) ?? 0;
    console.log(
      `  ${reviewQueueLabel(queue).padEnd(14)} ${
        colorize(String(count), styleForReviewCount(queue, count), color)
      }`,
    );
  }
  console.log("");
  console.log("Statuses");
  for (const status of ["open", "drafted", "applied"] as const) {
    const count = statusCounts.get(status) ?? 0;
    console.log(
      `  ${status.padEnd(8)} ${colorize(String(count), styleForReviewCount(status, count), color)}`,
    );
  }
  console.log("");
  if (next) {
    console.log("Recommended next");
    console.log(`  deno task civic review next`);
    console.log(`  ${reviewQuestion(next)}`);
  } else {
    console.log("Recommended next");
    console.log(
      `  ${
        colorize("No actionable review items.", "green", color)
      } Use review deferred for parked work.`,
    );
  }
}

function countReviewQueues(items: ReviewItem[]): Map<ReviewQueue, number> {
  const counts = new Map<ReviewQueue, number>();
  for (const item of items) {
    const queue = reviewQueueForItem(item);
    counts.set(queue, (counts.get(queue) ?? 0) + 1);
  }
  return counts;
}

function reviewQueueCountsObject(items: ReviewItem[]): Record<ReviewQueue, number> {
  const counts = countReviewQueues(items);
  return Object.fromEntries(
    REVIEW_QUEUE_SUMMARY_ORDER.map((queue) => [queue, counts.get(queue) ?? 0]),
  ) as Record<ReviewQueue, number>;
}

function countReviewStatuses(items: ReviewItem[]): Map<ReviewItem["status"], number> {
  const counts = new Map<ReviewItem["status"], number>();
  for (const item of items) {
    counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  }
  return counts;
}

function formatReviewQueueSummary(items: ReviewItem[]): string {
  const counts = countReviewQueues(items);
  const inboxCount = (counts.get("blocking") ?? 0) + (counts.get("actionable") ?? 0);
  return [
    `review items: ${items.length}`,
    `inbox ${inboxCount}`,
    ...REVIEW_QUEUE_SUMMARY_ORDER.map((queue) => `${queue} ${counts.get(queue) ?? 0}`),
  ].join("; ");
}

function formatPersistedReviewSummary(items: ReviewItem[], color = false): string {
  if (items.length === 0) {
    return "0 persisted items";
  }

  const counts = countReviewQueues(items);
  const queueSummary = REVIEW_QUEUE_SUMMARY_ORDER
    .map((queue) => {
      const count = counts.get(queue) ?? 0;
      return `${colorize(queue, styleForReviewCount(queue, count), color)} ${count}`;
    })
    .join(", ");
  return `${items.length} persisted items (${queueSummary})`;
}

function reviewQuestion(item: ReviewItem): string {
  if (item.category === "same_source_duplicate") {
    return `Are these ${item.sourceFamilies.join("/") || "source"} records duplicates?`;
  }
  if (item.category === "source_shadow") {
    return "Is one source record shadowing a better canonical entry?";
  }
  if (item.category === "kind_conflict") {
    return "Do these similarly named entries represent distinct civic things?";
  }
  if (item.category === "identity_conflict" || item.category === "alias_candidate") {
    return "Should these entries be aliased, preserved, or suppressed?";
  }
  if (item.category === "relation_endpoint_missing") {
    return "Should this relation target be retargeted or suppressed?";
  }
  if (item.category === "legal_authority_ambiguous") {
    return "Does this legal authority evidence support the same civic fact?";
  }
  if (item.category === "out_of_scope_candidate") {
    return "Should this currently deferred source candidate stay out of scope?";
  }
  if (item.category === "preserve_distinct_candidate") {
    return "Was this preserve-distinct decision the right curation choice?";
  }
  return item.title;
}

function reviewWhyFlagged(item: ReviewItem): string {
  if (item.source.type === "reconciliation_candidate") {
    return item.source.reason
      ? `${item.source.reason} detected overlapping evidence across ${
        item.sourceFamilies.join(", ") || "sources"
      }.`
      : "Reconciliation found overlapping evidence.";
  }
  if (item.source.type === "finding") {
    return `Compiler or interpreter finding: ${
      item.attributesThatConflict.findingCode ?? item.id
    }.`;
  }
  return "Tracked curation revision is shown for audit.";
}

function reviewSuggestedNext(item: ReviewItem): string {
  const suggested = item.suggestedResolutions.join(", ");
  if (item.status === "drafted") {
    return `Review the draft, then run revision validate and revision apply-draft if it is right. Options: ${suggested}.`;
  }
  if (item.status === "applied") {
    return `Already applied by tracked revision. Options originally included: ${suggested}.`;
  }
  if (reviewQueueForItem(item) === "deferred") {
    return `Leave deferred for now unless this source family is in scope. Options: ${suggested}.`;
  }
  return `Decide with review decide, then validate the draft. Options: ${suggested}.`;
}

function printReviewItem(
  item: ReviewItem,
  sourceRecords: ReviewSourceRecordEvidence[] = [],
): void {
  console.log(reviewQuestion(item));
  console.log(`ID: ${item.id}`);
  console.log(`Queue: ${reviewQueueLabel(reviewQueueForItem(item))}`);
  console.log(`Status: ${item.status}`);
  console.log(`Category: ${item.category}`);
  console.log(`Classification: ${item.classification}`);
  console.log(`Severity: ${item.severity}`);
  console.log(`Confidence: ${item.confidence}`);
  console.log(`Public output impact: ${reviewItemHasPublicOutputImpact(item) ? "yes" : "no"}`);
  console.log(`Blocks current output: ${reviewItemBlocksCurrentOutput(item) ? "yes" : "no"}`);
  console.log(`Blocks state generation: ${item.blocks.stateGeneration ? "yes" : "no"}`);
  console.log(`Release blocker if open: ${item.blocks.releaseReadiness ? "yes" : "no"}`);
  console.log(`Suggested resolutions: ${item.suggestedResolutions.join(", ")}`);
  if (item.trackedRevisionIds.length > 0) {
    console.log(`Tracked revisions: ${item.trackedRevisionIds.join(", ")}`);
  }
  if (item.draftRevisionIds.length > 0) {
    console.log(`Draft revisions: ${item.draftRevisionIds.join(", ")}`);
  }
  console.log("");
  console.log("Why flagged:");
  console.log(reviewWhyFlagged(item));
  console.log("");
  console.log("Summary:");
  console.log(item.summary);
  console.log(item.rationale);
  console.log("");
  console.log("Suggested next:");
  console.log(reviewSuggestedNext(item));
  if (item.status === "open" && reviewQueueForItem(item) !== "deferred") {
    console.log("");
    console.log("Decision command examples:");
    for (const command of reviewDecisionCommandExamples(item)) {
      console.log(`- ${command}`);
    }
  }

  if (item.candidateEntries.length > 0) {
    console.log("");
    console.log("Entries:");
    for (const entry of item.candidateEntries) {
      console.log(`- ${entry.id} | ${entry.kind} | ${entry.name} | ${entry.sources.join(", ")}`);
    }
  }

  if (item.affected.relationEndpoints.length > 0) {
    console.log("");
    console.log("Relation endpoints:");
    for (const endpoint of item.affected.relationEndpoints) {
      console.log(`- ${endpoint.from} --${endpoint.kind}--> ${endpoint.to}`);
    }
  }

  if (item.citations.length > 0) {
    console.log("");
    console.log("Evidence:");
    for (const citation of item.citations) {
      console.log(`- ${formatCitation(citation)}`);
    }
  }

  if (sourceRecords.length > 0) {
    console.log("");
    console.log("Source records:");
    for (const record of sourceRecords) {
      const suffix = record.found
        ? `snapshot ${record.snapshotKey ?? "unknown"}`
        : "missing from workspace records";
      const urls = record.found ? sourceRecordUrls(record.payload).slice(0, 3) : [];
      const urlSuffix = urls.length > 0 ? `; urls: ${urls.join(", ")}` : "";
      console.log(`- ${record.source}:${record.sourceRecordId} (${suffix}${urlSuffix})`);
    }
  }
}

function reviewDecisionCommandExamples(item: ReviewItem): string[] {
  return item.suggestedResolutions.slice(0, 4).map((resolution) => {
    const parts = [
      "deno task civic review decide",
      shellQuote(item.id),
      "--as",
      resolution,
    ];
    if (
      resolution === "source-shadow" ||
      resolution === "alias" ||
      resolution === "preserve-distinct"
    ) {
      parts.push("--target", "<entry-id>");
    }
    if (resolution === "override-kind") {
      parts.push("--kind", "<kind>");
    }
    parts.push("--rationale", shellQuote("why this is the right decision"));
    return parts.join(" ");
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatCitation(citation: CitationValue): string {
  if ("uncited" in citation) {
    return citation.reason ? `uncited: ${citation.reason}` : "uncited";
  }
  return [
    citation.source,
    citation.sourceRecordId,
    citation.locator,
    citation.url,
  ].filter((part): part is string => typeof part === "string" && part.length > 0).join(" | ");
}

function parseReviewResolutionType(value: unknown): ReviewResolutionType {
  if (
    value === "preserve-distinct" ||
    value === "source-shadow" ||
    value === "alias" ||
    value === "suppress" ||
    value === "override-kind"
  ) {
    return value;
  }
  throw new Error(
    "--as must be one of preserve-distinct, source-shadow, alias, suppress, override-kind",
  );
}

function revisionRootForStateRoot(stateRoot: string): string {
  return join(stateRoot, "..", "revisions");
}

function identityRootForStateRoot(stateRoot: string): string {
  return join(stateRoot, "..", "identity");
}

function validateCliOptions(options: CliOptions): CliOptions {
  if (options.limit !== undefined && options.limit < 0) {
    throw new Error("--limit requires a non-negative integer");
  }
  return options;
}

function normalizeRawArgs(rawArgs: string[]): string[] {
  if (rawArgs[0] === "--") {
    return rawArgs.slice(1);
  }
  return rawArgs;
}

if (import.meta.main) {
  Deno.exit(await runCli());
}
