import { join } from "@std/path";
import type { SourceFetchOutcome, SourceFetchProgressEvent } from "./cli_source.ts";
import { dcCommand } from "./command_prefix.ts";
import type { SourceConnector } from "./connectors/shared.ts";
import type { SmokeProfile } from "./domain.ts";

export interface SmokeCommandStatus {
  nextCommand: string;
  unresolvedStateNote: string;
}

export interface SmokeWorkspacePaths {
  rootDir: string;
  dbPath: string;
  dataDir: string;
  resolutionsDir: string;
}

export interface SmokeRunResult {
  profile: SmokeProfile;
  sourceIds: string[];
  workspace: SmokeWorkspacePaths;
  outcomes: SourceFetchOutcome[];
  successCount: number;
  failureCount: number;
  status: SmokeCommandStatus;
}

export interface RunSmokeProfileDeps {
  connectors: SourceConnector[];
  makeTempDir(): Promise<string>;
  fetchSources(
    sourceIds: string[],
    options: {
      limit?: number;
      onProgress?: (event: SourceFetchProgressEvent) => void;
    },
    paths: SmokeWorkspacePaths,
  ): Promise<SourceFetchOutcome[]>;
  readWorkbenchStatus(paths: SmokeWorkspacePaths): Promise<SmokeCommandStatus>;
}

export function sourceIdsForSmokeProfile(
  connectors: SourceConnector[],
  profile: SmokeProfile,
): string[] {
  return connectors
    .filter((connector) => connector.source.smokeProfiles?.includes(profile))
    .map((connector) => connector.sourceId);
}

export async function runSmokeProfile(
  profile: SmokeProfile,
  options: {
    limit?: number;
    onProgress?: (event: SourceFetchProgressEvent) => void;
  },
  deps: RunSmokeProfileDeps,
): Promise<SmokeRunResult> {
  const rootDir = await deps.makeTempDir();
  const workspace = {
    rootDir,
    dbPath: join(rootDir, "workbench.sqlite"),
    dataDir: join(rootDir, "data"),
    resolutionsDir: join(rootDir, "resolutions"),
  };
  const sourceIds = sourceIdsForSmokeProfile(deps.connectors, profile);
  const outcomes = await deps.fetchSources(sourceIds, options, workspace);
  const failureCount = outcomes.filter((outcome) => outcome.status === "failed").length;
  const status = scopeSmokeStatus(
    await deps.readWorkbenchStatus(workspace),
    workspace,
    failureCount,
  );
  return {
    profile,
    sourceIds,
    workspace,
    outcomes,
    successCount: outcomes.length - failureCount,
    failureCount,
    status,
  };
}

function scopeSmokeStatus(
  status: SmokeCommandStatus,
  workspace: SmokeWorkspacePaths,
  failureCount: number,
): SmokeCommandStatus {
  if (
    failureCount === 0 &&
    status.nextCommand === dcCommand("source list") &&
    status.unresolvedStateNote.startsWith("No open decisions")
  ) {
    return {
      ...status,
      nextCommand: dcCommand(`release verify --db ${workspace.dbPath}`),
    };
  }
  return {
    ...status,
    nextCommand: scopeDbCommand(status.nextCommand, workspace.dbPath),
  };
}

function scopeDbCommand(command: string, dbPath: string): string {
  if (command.includes(" --db ")) return command;
  if (!command.startsWith("deno task dc -- ")) return command;
  return `${command} --db ${dbPath}`;
}
