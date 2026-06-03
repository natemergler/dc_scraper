import { join } from "@std/path";
import { buildV2Release } from "./release.ts";
import { buildReleaseInspection, type ReleaseManifest, renderReleaseInspection } from "./status.ts";
import type { Workbench } from "./workbench.ts";

export interface ReleaseCommandOptions {
  json?: boolean;
  outDir: string;
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
      async (workbench) => await buildV2Release(workbench, options.outDir),
    );
    console.log(`Built v2 release ${result.outDir}`);
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
      console.log(JSON.stringify(buildReleaseInspection(options.outDir, manifest), null, 2));
      return true;
    }
    console.log(renderReleaseInspection(options.outDir, manifest));
    return true;
  }
  return false;
}

export function printReleaseHelp(): void {
  console.log(`dc release

Workflow:
  1. Build the current release package with \`dc release build\`
  2. Inspect the built package with \`dc release inspect\`
  3. Use \`dc release inspect --json\` for scriptable release summary checks

Usage:
  dc release build [--db <path>] [--out <dir>]
  dc release inspect [--out <dir>] [--json]

Release files:
  README.md, manifest.json, dcgov.sqlite, entities.*, relationships.*, sources.*, datasets.*, legal_refs.*
`);
}

function hasHelpFlag(args: string[], start: number): boolean {
  return args.slice(start).some((value) => isHelp(value));
}

function isHelp(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}
