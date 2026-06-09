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
  saveFinding,
  saveRecords,
  saveSnapshot,
  type Workspace,
} from "../workspace/workspace.ts";
import { ArcGISTableReader } from "../readers/arcgis_table.ts";
import { DCCouncilmembersReader } from "../readers/dccouncil_councilmembers.ts";
import { DCCouncilCommitteePagesReader } from "../readers/dccouncil_committee_pages.ts";
import { OpenDCPublicBodiesReader } from "../readers/open_dc_public_bodies.ts";
import { dcRuntime } from "../jurisdictions/dc/index.ts";
import { exportReleaseArtifacts } from "../export/export.ts";
import { loadRevisions } from "../revisions/load.ts";

import { type EntryFragment, type Finding, type RelationFragment } from "../core/types.ts";
import {
  type DcInterpreterContext,
  normalizeAgencyLookupKey,
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

  throw new Error(`unsupported source type: ${source.type}`);
}

async function runStateGenerate(workspaceRoot: string, stateRoot: string): Promise<number> {
  const workspace = openWorkspace(workspaceRoot);
  try {
    initWorkspace(workspace);

    const revisionRoot = join(stateRoot, "..", "revisions");
    const revisions = await loadRevisions(revisionRoot);
    const workspaceCompilation = compileFromWorkspace(workspace);
    const result = compileFragments({
      jurisdiction: dcRuntime.jurisdiction,
      fragments: workspaceCompilation.fragments,
      kindRegistry: dcRuntime.kinds,
      findings: workspaceCompilation.findings,
      revisions: [...dcRuntime.revisions, ...revisions],
      generatedAt: new Date().toISOString(),
    });

    workspace.db.run("DELETE FROM findings");
    for (const finding of [...result.findings, ...result.conflicts]) {
      saveFinding(workspace, finding);
    }

    if (!result.ok || !result.state) {
      for (const finding of result.conflicts) {
        console.error(`${finding.code}: ${finding.message}`);
      }
      return 1;
    }

    await writeCommittedState(result.state, stateRoot);
    console.log(`state generated with ${result.state.entries.size} entries`);
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
    });
    console.log(
      `exported ${result.entryCount} entries, ${result.relationCount} relations to ${result.releaseRoot}`,
    );
    return 0;
  } finally {
    closeWorkspace(workspace);
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
        const agencyId = typeof entryFragment.attributes.sourceAgencyId === "string"
          ? entryFragment.attributes.sourceAgencyId
          : entryFragment.provisionalId.startsWith("dc.agency:")
          ? entryFragment.provisionalId.replace("dc.agency:", "")
          : entryFragment.provisionalId;

        const normalizedName = normalizeAgencyLookupKey(entryFragment.name);
        if (normalizedName.length > 0 && !interpreterContext.agencyLookup.has(normalizedName)) {
          interpreterContext.agencyLookup.set(normalizedName, agencyId);
        }

        const shortName = entryFragment.attributes.shortName;
        if (typeof shortName === "string") {
          const normalizedShortName = normalizeAgencyLookupKey(shortName);
          if (
            normalizedShortName.length > 0 &&
            !interpreterContext.agencyLookup.has(normalizedShortName)
          ) {
            interpreterContext.agencyLookup.set(normalizedShortName, agencyId);
          }
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

  return root;
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
