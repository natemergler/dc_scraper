import { join } from "@std/path";
import { dcCommand } from "./command_prefix.ts";
import {
  buildV2Release,
  RELEASE_FILE_DESCRIPTIONS,
  type ReleaseBuildProgressEvent,
} from "./release.ts";
import { renderReleaseVerification, verifyWorkbenchRelease } from "./release_verify.ts";
import type { SmokeProfile } from "./domain.ts";
import {
  buildReleaseInspection,
  type ReleaseManifest,
  renderReleaseInspection,
} from "./release_inspect.ts";
import type { Workbench } from "./workbench.ts";

export interface ReleaseCommandOptions {
  json?: boolean;
  outDir: string;
  dbPath: string;
  sourceProfile?: SmokeProfile | "custom";
}

export interface ReleaseCommandDeps {
  withWorkbench<T>(action: (workbench: Workbench) => T | Promise<T>): Promise<T>;
  readFile(path: string): Promise<string>;
}

export async function handleReleaseCommand(
  args: string[],
  options: ReleaseCommandOptions,
  deps: ReleaseCommandDeps,
): Promise<boolean> {
  if (args[0] !== "release") return false;
  if (!args[1] || args[1].startsWith("--") || isHelp(args[1])) {
    printReleaseHelp();
    return true;
  }
  if (args[1] === "build") {
    if (hasHelpFlag(args, 2)) {
      printReleaseHelp();
      return true;
    }
    const result = await deps.withWorkbench(
      async (workbench) =>
        await buildV2Release(workbench, options.outDir, {
          sourceProfile: options.sourceProfile,
          onProgress: (event) => {
            console.error(renderReleaseBuildProgress(event));
          },
        }),
    );
    const inspectCommand = dcCommand(`release inspect --out ${result.outDir}`);
    const nextCommand = inspectCommand;
    if (options.json) {
      console.log(JSON.stringify({ ...result, inspectCommand, nextCommand }, null, 2));
      return true;
    }
    console.log(`Built release ${result.outDir}`);
    console.log(`Inspect: ${inspectCommand}`);
    console.log(`Next: ${nextCommand}`);
    return true;
  }
  if (args[1] === "verify") {
    if (hasHelpFlag(args, 2)) {
      printReleaseHelp();
      return true;
    }
    const result = scopeReleaseVerifyCommands(
      await deps.withWorkbench((workbench) => verifyWorkbenchRelease(workbench)),
      options.dbPath,
    );
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderReleaseVerification(result));
    }
    if (!result.ready) Deno.exitCode = 1;
    return true;
  }
  if (args[1] === "inspect") {
    if (hasHelpFlag(args, 2)) {
      printReleaseHelp();
      return true;
    }
    const manifest = JSON.parse(
      await deps.readFile(join(options.outDir, "manifest.json")),
    ) as ReleaseManifest;
    if (options.json) {
      console.log(JSON.stringify(await buildReleaseInspection(options.outDir, manifest), null, 2));
      return true;
    }
    console.log(await renderReleaseInspection(options.outDir, manifest));
    return true;
  }
  return false;
}

export function renderReleaseBuildProgress(event: ReleaseBuildProgressEvent): string {
  const parts = [`Release build: ${event.message}`];
  if (event.fileCount !== undefined) parts.push(`files=${event.fileCount}`);
  const counts = renderReleaseBuildCounts(event.counts);
  if (counts) parts.push(counts);
  return parts.join(" ");
}

export function printReleaseHelp(): void {
  const releaseFileLines = chunkReleaseFileNames(
    RELEASE_FILE_DESCRIPTIONS.map((file) => file.name),
  ).map((line) => `  ${line}`).join("\n");
  console.log(`${dcCommand("release")}

Workflow:
  1. Verify package readiness and provenance before building
  2. Build the current release package
  3. Inspect the built package
  4. Use JSON output for scriptable release summary checks

Usage:
  ${dcCommand("release verify")} [--db <path>] [--json]
  ${
    dcCommand("release build")
  } [--db <path>] [--out|--output <dir>] [--source-profile <structure|tier0|inventory|custom>] [--json]
  ${dcCommand("release inspect")} [--out|--output <dir>] [--json]

Release files:
${releaseFileLines}
`);
}

function hasHelpFlag(args: string[], start: number): boolean {
  return args.slice(start).some((value) => isHelp(value));
}

function isHelp(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}

function chunkReleaseFileNames(fileNames: readonly string[]): string[] {
  const lines: string[] = [];
  let current = "";
  for (const name of fileNames) {
    const next = current ? `${current}, ${name}` : name;
    if (next.length > 115 && current) {
      lines.push(`${current},`);
      current = name;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function renderReleaseBuildCounts(
  counts: ReleaseBuildProgressEvent["counts"] | undefined,
): string | undefined {
  if (!counts) return undefined;
  const parts = [
    ["entities", counts.entities],
    ["relationships", counts.relationships],
    ["sources", counts.sources],
    ["datasets", counts.datasets],
    ["legal_refs", counts.legalRefs],
  ].filter((row): row is [string, number] => typeof row[1] === "number");
  return parts.map(([name, count]) => `${name}=${count}`).join(" ");
}

function scopeReleaseVerifyCommands<
  T extends {
    buildCommand?: string;
    warningReviewCommand?: string;
    publicBodyCompareCommand?: string;
    nextCommand: string;
  },
>(result: T, dbPath: string): T {
  return {
    ...result,
    buildCommand: scopeDbCommand(result.buildCommand, dbPath),
    warningReviewCommand: scopeDbCommand(result.warningReviewCommand, dbPath),
    publicBodyCompareCommand: scopeDbCommand(result.publicBodyCompareCommand, dbPath),
    nextCommand: scopeDbCommand(result.nextCommand, dbPath) ?? result.nextCommand,
  };
}

function scopeDbCommand(command: string | undefined, dbPath: string): string | undefined {
  if (!command) return undefined;
  if (command.includes(" --db ")) return command;
  if (!command.startsWith("deno task dc -- ")) return command;
  return `${command} --db ${dbPath}`;
}
