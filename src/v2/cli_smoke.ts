import { dcCommand } from "./command_prefix.ts";
import type { SmokeProfile } from "./domain.ts";
import { logSourceFetchProgress } from "./cli_source.ts";
import { runSmokeProfile, type RunSmokeProfileDeps, type SmokeRunResult } from "./smoke.ts";

export interface SmokeCommandOptions {
  json?: boolean;
  limit?: number;
}

export async function handleSmokeCommand(
  args: string[],
  options: SmokeCommandOptions,
  deps: RunSmokeProfileDeps,
): Promise<boolean> {
  if (args[0] !== "smoke") return false;
  if (!args[1] || isHelp(args[1])) {
    printSmokeHelp();
    return true;
  }
  if (!isSmokeProfile(args[1])) {
    printSmokeHelp();
    return true;
  }
  const result = await runSmokeProfile(args[1], {
    limit: options.limit,
    onProgress: options.json ? undefined : logSourceFetchProgress,
  }, deps);
  const failures = result.outcomes.filter((outcome) => outcome.status === "failed");
  const releaseCommands = smokeReleaseCommands(result);
  if (options.json) {
    console.log(
      JSON.stringify(
        { ...result, ...releaseCommands, nextCommand: result.status.nextCommand },
        null,
        2,
      ),
    );
  } else {
    renderSmokeResult(result, failures.length, releaseCommands);
  }
  if (failures.length > 0) Deno.exitCode = 1;
  return true;
}

export function printSmokeHelp(): void {
  console.log(`${dcCommand("smoke")}

Workflow:
  1. Run \`${dcCommand("smoke structure")}\` for a temp-workbench structure pass
  2. Run \`${dcCommand("smoke tier0")}\` for the smallest credible release spine
  3. Run \`${dcCommand("smoke inventory")}\` for inventory-only dataset lanes

Smoke always creates a fresh temp workspace. Use \`${dcCommand("source fetch --all")}\` with
\`--db\` and \`--data-dir\` when you need to fetch into explicit paths.

Usage:
  ${dcCommand("smoke structure")} [--limit <n>] [--json]
  ${dcCommand("smoke tier0")} [--limit <n>] [--json]
  ${dcCommand("smoke inventory")} [--limit <n>] [--json]
`);
}

function renderSmokeResult(
  result: SmokeRunResult,
  failureCount: number,
  releaseCommands: ReturnType<typeof smokeReleaseCommands>,
): void {
  console.log(`Smoke profile: ${result.profile}`);
  console.log(`Workspace: ${result.workspace.rootDir}`);
  console.log(`DB: ${result.workspace.dbPath}`);
  console.log(`Release out: ${releaseCommands.releaseOutDir}`);
  console.log(`Release verify: ${releaseCommands.releaseVerifyCommand}`);
  console.log(`Release build: ${releaseCommands.releaseBuildCommand}`);
  console.log(`Release inspect: ${releaseCommands.releaseInspectCommand}`);
  console.log(`Sources: ${result.sourceIds.join(", ")}`);
  for (const outcome of result.outcomes) {
    if (outcome.status === "success") {
      console.log(`Fetched ${outcome.sourceId}`);
      console.log(outcome.endpointStatuses.join(", "));
    } else {
      console.log(`Fetch failed ${outcome.sourceId}`);
      console.log(outcome.errorText ?? "Unknown source fetch error");
    }
  }
  console.log(`Smoke fetch summary: ${result.successCount}/${result.outcomes.length} succeeded.`);
  console.log(`Readiness: ${result.status.unresolvedStateNote}`);
  console.log(`Next: ${result.status.nextCommand}`);
  if (failureCount > 0) {
    console.log(`Smoke failures: ${failureCount}`);
    const firstFailure = result.outcomes.find((outcome) => outcome.status === "failed");
    if (firstFailure) {
      console.log(
        `Inspect failed source: ${
          dcCommand(`source inspect ${firstFailure.sourceId} --db ${result.workspace.dbPath}`)
        }`,
      );
    }
  }
}

function smokeReleaseCommands(result: SmokeRunResult): {
  releaseOutDir: string;
  releaseVerifyCommand: string;
  releaseBuildCommand: string;
  releaseInspectCommand: string;
} {
  const defaultReleaseOutDir = `${result.workspace.rootDir}/release`;
  return {
    releaseOutDir: defaultReleaseOutDir,
    releaseVerifyCommand: dcCommand(`release verify --db ${result.workspace.dbPath}`),
    releaseBuildCommand: dcCommand(
      `release build --source-profile ${result.profile} --db ${result.workspace.dbPath} --out ${defaultReleaseOutDir}`,
    ),
    releaseInspectCommand: dcCommand(`release inspect --out ${defaultReleaseOutDir}`),
  };
}

function isSmokeProfile(value: string | undefined): value is SmokeProfile {
  return value === "structure" || value === "tier0" || value === "inventory";
}

function isHelp(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}
