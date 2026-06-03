import { join } from "@std/path";
import type { SourceFetchOutcome } from "./cli_source.ts";
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
  status: SmokeCommandStatus;
}

export interface RunSmokeProfileDeps {
  connectors: SourceConnector[];
  makeTempDir(): Promise<string>;
  fetchSources(
    sourceIds: string[],
    options: { limit?: number },
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
  options: { limit?: number },
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
  const status = await deps.readWorkbenchStatus(workspace);
  return {
    profile,
    sourceIds,
    workspace,
    outcomes,
    status,
  };
}
