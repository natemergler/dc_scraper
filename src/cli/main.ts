import { Command } from "@cliffy/command";
import { join } from "@std/path";

import { loadCommittedState, writeCommittedState } from "../state/store.ts";
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
import { exportReleaseArtifacts } from "../export/export.ts";
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
  generateReviewItems,
  type ReviewItem,
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

type ReviewListOptions = CliOptions & {
  json?: boolean;
  status?: string;
  queue?: string;
};

type ReviewShowOptions = CliOptions & {
  json?: boolean;
};

type ReviewResolveOptions = CliOptions & {
  as?: string;
  target?: string;
  kind?: string;
  rationale?: string;
};

const OPERATOR_FLOW = [
  "deno task civic status",
  "deno task civic revision validate",
  "deno task civic state generate",
  "deno task civic check",
  "deno task civic export",
];

const ALPHA_ARTIFACT_HINTS = [
  "entries.csv / relations.csv / citations.csv",
  "source_coverage.csv",
  "ledger.sqlite",
  "dc_board_affiliations.csv / dc_commission_affiliations.csv / dc_authority_affiliations.csv",
  "dc_anc_smd_structure.csv / dc_council_committee_membership.csv",
];

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
  const sources = dcRuntime.sources.map((binding) => sourceSummary(binding.source.id));
  if (options.json) {
    console.log(JSON.stringify({ sourceCount: sources.length, sources }, null, 2));
    return 0;
  }

  console.log("Civic Ledger Sources");
  console.log("");
  console.log([
    "SOURCE".padEnd(28),
    "FAMILY".padEnd(34),
    "SCOPE".padEnd(30),
    "TYPE",
  ].join("  "));
  for (const source of sources) {
    console.log([
      source.id.padEnd(28),
      source.family.padEnd(34),
      summarizeForColumn(source.scope, 30),
      source.type,
    ].join("  "));
    if (source.notes) {
      console.log(`  notes: ${source.notes}`);
    }
  }
  console.log("");
  console.log("Collect everything:");
  console.log("  deno task civic collect all");
  console.log("");
  console.log("Coverage/export inspection:");
  console.log("  deno task civic sources list --json");
  console.log("  deno task civic export   # writes source_coverage.csv in the release root");
  return 0;
}

function summarizeForColumn(value: string, width: number): string {
  if (value.length <= width) {
    return value.padEnd(width);
  }
  return `${value.slice(0, width - 1)}…`;
}

async function runStatus(options: CliOptions): Promise<number> {
  const cliOptions = validateCliOptions(options);
  const sourceStats = loadWorkspaceSourceStats(cliOptions.workspace);
  const collected = sourceStats.filter((source) => source.snapshotCount > 0).length;
  const recordCount = sourceStats.reduce((total, source) => total + source.recordCount, 0);
  const stateCount = await countCommittedStateEntries(cliOptions.stateRoot);
  const reviewCount = await countPersistedReviewItems(cliOptions.workspace);

  console.log("Civic Ledger Status");
  console.log("");
  console.log(`Workspace: ${cliOptions.workspace}`);
  console.log(`Sources:   ${collected}/${sourceStats.length} collected`);
  console.log(`Records:   ${recordCount}`);
  console.log(`State:     ${stateCount} entries`);
  console.log(`Review:    ${reviewCount} persisted items`);
  console.log("");
  console.log("Operator flow:");
  for (const step of OPERATOR_FLOW) {
    console.log(`  ${step}`);
  }
  console.log("");
  if (recordCount === 0) {
    console.log("Next: deno task civic collect all");
  } else if (stateCount === 0) {
    console.log("Next: deno task civic revision validate, then deno task civic state generate");
  } else {
    console.log("Next: deno task civic check, then deno task civic export");
    console.log("Review queue: deno task civic review inbox");
  }
  return 0;
}

function sourceSummary(sourceId: string): {
  id: string;
  type: string;
  family: string;
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

async function countPersistedReviewItems(workspaceRoot: string): Promise<number> {
  try {
    const items = await loadReviewItems(workspaceRoot);
    return items.length;
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

    await writeCommittedState(result.state, stateRoot);
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
    const reviewItems = await refreshReviewItemsFromCommittedState(workspaceRoot, stateRoot);
    const result = await exportReleaseArtifacts({
      workspace,
      jurisdiction: dcRuntime.jurisdiction,
      releaseRoot,
      sourceCatalog: dcRuntime.sourceCoverage,
      reviewItems,
    });
    console.log(
      `exported ${result.entryCount} entries, ${result.relationCount} relations to ${result.releaseRoot}`,
    );
    console.log("Alpha artifact highlights:");
    for (const artifact of ALPHA_ARTIFACT_HINTS) {
      console.log(`  - ${artifact}`);
    }
    console.log(`Inspect source coverage: ${join(result.releaseRoot, "source_coverage.csv")}`);
    return 0;
  } finally {
    closeWorkspace(workspace);
  }
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
  const filtered = filterReviewItems(items, options);

  if (options.json) {
    console.log(JSON.stringify(
      {
        reviewItemCount: filtered.length,
        totalReviewItemCount: items.length,
        items: filtered,
      },
      null,
      2,
    ));
    return 0;
  }

  printReviewList(filtered, items.length);
  return 0;
}

function filterReviewItems(items: ReviewItem[], options: ReviewListOptions): ReviewItem[] {
  const status = options.status;
  const statusFiltered = status && status !== "all"
    ? items.filter((item) => item.status === status)
    : items;
  const queue = parseReviewQueueFilter(options.queue ?? "inbox");
  if (queue === "all") {
    return statusFiltered;
  }
  if (queue === "inbox") {
    return statusFiltered.filter((item) => {
      const itemQueue = reviewQueueForItem(item);
      return itemQueue === "blocking" || itemQueue === "actionable";
    });
  }
  return statusFiltered.filter((item) => reviewQueueForItem(item) === queue);
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

async function runReviewNext(options: CliOptions): Promise<number> {
  const cliOptions = validateCliOptions(options);
  const items = await refreshReviewItemsFromCommittedState(
    cliOptions.workspace,
    cliOptions.stateRoot,
  );
  const next = items.find((item) => reviewQueueForItem(item) === "blocking") ??
    items.find((item) => reviewQueueForItem(item) === "actionable");
  if (!next) {
    console.log("No actionable review items.");
    printReviewDashboard(items);
    return 0;
  }
  printReviewItem(next);
  return 0;
}

async function runReviewDeferred(options: CliOptions): Promise<number> {
  const cliOptions = validateCliOptions(options);
  const items = await refreshReviewItemsFromCommittedState(
    cliOptions.workspace,
    cliOptions.stateRoot,
  );
  const deferred = items.filter((item) => reviewQueueForItem(item) === "deferred");
  printDeferredReviewSummary(deferred, items.length);
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

  if (options.json) {
    console.log(JSON.stringify(item, null, 2));
    return 0;
  }

  printReviewItem(item);
  return 0;
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
): Promise<ReviewItem[]> {
  const loaded = await loadCommittedState(stateRoot, dcRuntime.kinds);
  const revisionRoot = revisionRootForStateRoot(stateRoot);
  const trackedRevisions = await loadRevisions(revisionRoot);
  const draftRevisions = await safelyLoadDraftRevisions(workspaceRoot);
  const findings = loadPersistedFindings(workspaceRoot);
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
    .action(async (options) => {
      onExitCode(await runStatus(validateCliOptions(options)));
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

  root.command("export", "Export alpha release artifacts from committed state.")
    .action(async (options) => {
      const cliOptions = validateCliOptions(options);
      onExitCode(
        await runExport(cliOptions.workspace, cliOptions.stateRoot, cliOptions.releaseRoot),
      );
    });

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
    .description("Review workflow commands.")
    .action(async (options) => {
      onExitCode(await runReviewDashboard(validateCliOptions(options)));
    });

  review.command("list", "List persisted review items.")
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

  review.command("inbox", "List review items that need an operator decision.")
    .option("--json", "Emit review items as JSON.")
    .action(async (options) => {
      onExitCode(await runReviewList({ ...(options as CliOptions), queue: "inbox" }));
    });

  review.command("next", "Show the next actionable review item.")
    .action(async (options) => {
      onExitCode(await runReviewNext(validateCliOptions(options)));
    });

  review.command("deferred", "Summarize parked, non-blocking review items by group.")
    .action(async (options) => {
      onExitCode(await runReviewDeferred(validateCliOptions(options)));
    });

  review.command("show <itemId:string>", "Show one review item evidence packet.")
    .option("--json", "Emit the full review item packet as JSON.")
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

function printReviewList(items: ReviewItem[], totalCount: number): void {
  if (items.length === 0) {
    console.log(`no matching review items (${totalCount} total)`);
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
    console.log(
      [
        reviewQueueLabel(reviewQueueForItem(item)).padEnd(14),
        item.severity.padEnd(8),
        item.category.padEnd(28),
        reviewQuestion(item),
      ].join("  "),
    );
    console.log(`  id: ${item.id}`);
  }
  console.log(`${items.length} shown, ${items.length} matching, ${totalCount} total`);
  console.log("Use --queue all to include applied and deferred items.");
}

function printDeferredReviewSummary(items: ReviewItem[], totalCount: number): void {
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

  const groups = groupDeferredReviewItems(items);
  console.log(["COUNT".padEnd(5), "CATEGORY".padEnd(28), "SOURCE/FINDING"].join("  "));
  for (const group of groups) {
    console.log([
      String(group.items.length).padEnd(5),
      group.category.padEnd(28),
      group.label,
    ].join("  "));
    console.log(`  sample: ${group.items[0].id}`);
  }
  console.log("");
  console.log(`${items.length} deferred, ${totalCount} total review items`);
  console.log("Inspect one with: deno task civic review show <item-id>");
}

function groupDeferredReviewItems(items: ReviewItem[]): Array<{
  category: string;
  label: string;
  items: ReviewItem[];
}> {
  const groups = new Map<string, { category: string; label: string; items: ReviewItem[] }>();
  for (const item of items) {
    const label = deferredReviewGroupLabel(item);
    const key = `${item.category}\0${label}`;
    const group = groups.get(key) ?? { category: item.category, label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) =>
    right.items.length - left.items.length ||
    left.category.localeCompare(right.category) ||
    left.label.localeCompare(right.label)
  );
}

function deferredReviewGroupLabel(item: ReviewItem): string {
  if (item.source.type === "finding") {
    const code = item.attributesThatConflict.findingCode;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }
  return item.sourceFamilies.join(", ") || item.classification;
}

function printReviewDashboard(items: ReviewItem[]): void {
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
  console.log(`  ${stateBlockers} state-generation blockers`);
  console.log(`  ${outputImpactingBlockers} public-output blockers`);
  console.log("");
  console.log("Decision queues");
  for (
    const queue of ["blocking", "actionable", "drafted", "applied", "deferred"] as ReviewQueue[]
  ) {
    console.log(`  ${reviewQueueLabel(queue).padEnd(14)} ${queueCounts.get(queue) ?? 0}`);
  }
  console.log("");
  console.log("Statuses");
  for (const status of ["open", "drafted", "applied"] as const) {
    console.log(`  ${status.padEnd(8)} ${statusCounts.get(status) ?? 0}`);
  }
  console.log("");
  if (next) {
    console.log("Recommended next");
    console.log(`  deno task civic review next`);
    console.log(`  ${reviewQuestion(next)}`);
  } else {
    console.log("Recommended next");
    console.log("  No actionable review items. Use review deferred for parked work.");
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
    `blocking ${counts.get("blocking") ?? 0}`,
    `deferred ${counts.get("deferred") ?? 0}`,
    `applied ${counts.get("applied") ?? 0}`,
  ].join("; ");
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

function printReviewItem(item: ReviewItem): void {
  console.log(reviewQuestion(item));
  console.log(`ID: ${item.id}`);
  console.log(`Queue: ${reviewQueueLabel(reviewQueueForItem(item))}`);
  console.log(`Status: ${item.status}`);
  console.log(`Category: ${item.category}`);
  console.log(`Classification: ${item.classification}`);
  console.log(`Severity: ${item.severity}`);
  console.log(`Confidence: ${item.confidence}`);
  console.log(`Public output impact: ${reviewItemHasPublicOutputImpact(item) ? "yes" : "no"}`);
  console.log(`Blocks state generation: ${item.blocks.stateGeneration ? "yes" : "no"}`);
  console.log(`Blocks release readiness: ${item.blocks.releaseReadiness ? "yes" : "no"}`);
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
