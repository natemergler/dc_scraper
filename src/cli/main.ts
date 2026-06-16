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

type ReviewListOptions = CliOptions & {
  json?: boolean;
  status?: string;
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
  const sourceBinding = dcRuntime.sources.find((candidate) => candidate.source.id === sourceId);
  if (!sourceBinding) {
    throw new Error(`unknown source id: ${sourceId}`);
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
    console.log(
      `state generated with ${result.state.entries.size} entries; ${reviewItems.length} review items`,
    );
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
  const loaded = await loadCommittedState(stateRoot, dcRuntime.kinds);

  const workspace = openWorkspace(workspaceRoot);
  try {
    initWorkspace(workspace);
    if (loaded.state.entries.size > 0) {
      console.log(`check passed with ${loaded.state.entries.size} entries`);
    } else {
      console.log("check passed with empty state");
    }
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
  const loaded = await loadCommittedState(stateRoot, dcRuntime.kinds);
  if (loaded.state.entries.size === 0) {
    throw new Error("state has no entries; run state generate before export");
  }

  const workspace = openWorkspace(workspaceRoot);
  try {
    initWorkspace(workspace);
    indexState(workspace, loaded.state);
    const result = await exportReleaseArtifacts({
      workspace,
      jurisdiction: dcRuntime.jurisdiction,
      releaseRoot,
      sourceCatalog: dcRuntime.sourceCoverage,
    });
    console.log(
      `exported ${result.entryCount} entries, ${result.relationCount} relations to ${result.releaseRoot}`,
    );
    return 0;
  } finally {
    closeWorkspace(workspace);
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
  const status = options.status;
  const filtered = status && status !== "all"
    ? items.filter((item) => item.status === status)
    : items;

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
  const decisionType = parseReviewResolutionType(options.as);
  const items = await refreshReviewItemsFromCommittedState(
    cliOptions.workspace,
    cliOptions.stateRoot,
  );
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw new Error(`review item not found: ${itemId}`);
  }

  const draft = createDraftRevision(item, {
    decisionType,
    targetId: options.target,
    kind: options.kind,
    rationale: options.rationale,
  });
  const path = await writeDraftRevision(cliOptions.workspace, draft);
  await refreshReviewItemsFromCommittedState(cliOptions.workspace, cliOptions.stateRoot);
  console.log(`draft revision written: ${path}`);
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
    .action(() => {
      throw new Error("missing command");
    });

  root.command("collect <sourceId:string>", "Collect one source into the workspace.")
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
      throw new Error("state requires `generate` or `index`");
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

  root.command("check", "Validate committed state.")
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
    .action(() => {
      throw new Error("review requires `list`, `show`, or `resolve`");
    });

  review.command("list", "List persisted review items.")
    .option("--json", "Emit review items as JSON.")
    .option("--status <status:string>", "Filter by open, drafted, applied, or all.", {
      default: "all",
    })
    .action(async (options) => {
      onExitCode(await runReviewList(options as ReviewListOptions));
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
    console.log(`no review items (${totalCount} total)`);
    return;
  }

  console.log(
    [
      "STATUS".padEnd(8),
      "SEVERITY".padEnd(8),
      "CATEGORY".padEnd(28),
      "CLASSIFICATION".padEnd(26),
      "ID",
    ].join("  "),
  );
  for (const item of items) {
    console.log(
      [
        item.status.padEnd(8),
        item.severity.padEnd(8),
        item.category.padEnd(28),
        item.classification.padEnd(26),
        item.id,
      ].join("  "),
    );
  }
  console.log(`${items.length} shown, ${totalCount} total`);
}

function printReviewItem(item: ReviewItem): void {
  console.log(item.title);
  console.log(`ID: ${item.id}`);
  console.log(`Status: ${item.status}`);
  console.log(`Category: ${item.category}`);
  console.log(`Classification: ${item.classification}`);
  console.log(`Severity: ${item.severity}`);
  console.log(`Confidence: ${item.confidence}`);
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
  console.log(item.summary);
  console.log(item.rationale);

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
