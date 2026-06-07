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
import { dcRuntime } from "../jurisdictions/dc/index.ts";
import { exportReleaseArtifacts } from "../export/export.ts";
import { loadRevisions } from "../revisions/load.ts";

import { type EntryFragment, type Finding, type RelationFragment } from "../core/types.ts";
import {
  type DcInterpreterContext,
  normalizeAgencyLookupKey,
} from "../jurisdictions/dc/interpreters/context.ts";

type Command =
  | { type: "collect"; sourceId: string; args: string[] }
  | { type: "state"; subcommand: "generate" | "index"; args: string[] }
  | { type: "check"; args: string[] }
  | { type: "export"; args: string[] };

type CliOptions = {
  workspaceRoot: string;
  stateRoot: string;
  releaseRoot: string;
  limit?: number;
  args: string[];
};

type WorkspaceCompilation = {
  fragments: Array<EntryFragment | RelationFragment>;
  findings: Finding[];
};

export async function runCli(rawArgs: string[] = Deno.args): Promise<number> {
  try {
    const options = parseOptions(rawArgs);
    const command = parseCommand(options.args);

    const workspaceRoot = options.workspaceRoot;
    const stateRoot = options.stateRoot;

    switch (command.type) {
      case "collect":
        return await runCollect(command, workspaceRoot, options.limit);

      case "state":
        if (command.subcommand === "generate") {
          return await runStateGenerate(workspaceRoot, stateRoot);
        }
        return await runStateIndex(workspaceRoot, stateRoot);

      case "check":
        return await runCheck(workspaceRoot, stateRoot);

      case "export":
        return await runExport(workspaceRoot, stateRoot, options.releaseRoot);

      default: {
        return 1;
      }
    }
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

async function runCollect(
  command: Extract<Command, { type: "collect" }>,
  workspaceRoot: string,
  limit?: number,
): Promise<number> {
  const sourceBinding = dcRuntime.sources.find((candidate) =>
    candidate.source.id === command.sourceId
  );
  if (!sourceBinding) {
    throw new Error(`unknown source id: ${command.sourceId}`);
  }

  const reader = new ArcGISTableReader();
  const workspace = openWorkspace(workspaceRoot);
  try {
    initWorkspace(workspace);
    const source = sourceBinding.source as {
      id: string;
      jurisdiction: string;
      type: "arcgis.table";
      tableUrl: string;
      outFields?: string[];
      where?: string;
      pageSize?: number;
      objectIdField?: string;
      idField?: string;
    };

    const result = await reader.collect({
      workspace: { root: workspaceRoot },
      source,
      limit,
    });

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
      `collected ${command.sourceId}: ${result.snapshots.length} snapshots, ${result.records.length} records`,
    );
    return 0;
  } finally {
    closeWorkspace(workspace);
  }
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

function parseCommand(args: string[]): Command {
  const [command, ...rest] = args;
  if (!command) {
    throw new Error("missing command");
  }

  if (command === "collect") {
    const [sourceId] = rest;
    if (!sourceId) {
      throw new Error("collect requires a source id");
    }
    return { type: "collect", sourceId, args: rest };
  }

  if (command === "state") {
    const [subcommand] = rest;
    if (subcommand !== "generate" && subcommand !== "index") {
      throw new Error("state requires `generate` or `index`");
    }
    return { type: "state", subcommand, args: rest };
  }

  if (command === "check") {
    return { type: "check", args: rest };
  }

  if (command === "export") {
    return { type: "export", args: rest };
  }

  throw new Error(`unknown command: ${command}`);
}

function parseOptions(rawArgs: string[]): CliOptions {
  const args: string[] = [];
  let workspaceRoot = ".civic/workspace";
  let stateRoot = join("ledger", dcRuntime.jurisdiction, "state");
  let releaseRoot = "releases/latest";
  let limit: number | undefined;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const current = rawArgs[index];
    if (current === "--workspace") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--workspace requires a path");
      }
      workspaceRoot = value;
      index += 1;
      continue;
    }
    if (current === "--state-root") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--state-root requires a path");
      }
      stateRoot = value;
      index += 1;
      continue;
    }
    if (current === "--release-root") {
      const value = rawArgs[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--release-root requires a path");
      }
      releaseRoot = value;
      index += 1;
      continue;
    }
    if (current === "--limit") {
      const rawLimit = rawArgs[index + 1];
      const parsed = Number.parseInt(rawLimit ?? "", 10);
      if (!rawLimit || !Number.isFinite(parsed) || parsed < 0) {
        throw new Error("--limit requires a non-negative integer");
      }
      limit = parsed;
      index += 1;
      continue;
    }

    args.push(current);
  }

  return {
    workspaceRoot,
    stateRoot,
    releaseRoot,
    limit,
    args,
  };
}
