import { join } from "@std/path";
import { dcCommand } from "./command_prefix.ts";
import { buildV2Release } from "./release.ts";
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
        }),
    );
    console.log(`Built v2 release ${result.outDir}`);
    return true;
  }
  if (args[1] === "verify") {
    if (hasHelpFlag(args, 2)) {
      printReleaseHelp();
      return true;
    }
    const result = await deps.withWorkbench((workbench) => verifyWorkbenchRelease(workbench));
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

export function printReleaseHelp(): void {
  console.log(`${dcCommand("release")}

Workflow:
  1. Verify the current workbench readiness and provenance before building
  2. Build the current release package
  3. Inspect the built package
  4. Use JSON output for scriptable release summary checks

Usage:
  ${dcCommand("release verify")} [--db <path>] [--json]
  ${
    dcCommand("release build")
  } [--db <path>] [--out <dir>] [--source-profile <structure|tier0|inventory|custom>]
  ${dcCommand("release inspect")} [--out <dir>] [--json]

Release files:
  README.md, manifest.json, dcgov.sqlite, entities.*, relationships.*, sources.*, datasets.*, legal_refs.*, entity_legal_refs.*, relationship_legal_refs.*
`);
}

function hasHelpFlag(args: string[], start: number): boolean {
  return args.slice(start).some((value) => isHelp(value));
}

function isHelp(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}
