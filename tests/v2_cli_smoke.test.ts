import { assertEquals, assertStringIncludes } from "@std/assert";
import { handleSmokeCommand, type SmokeCommandOptions } from "../src/v2/cli_smoke.ts";
import type { SourceConnector } from "../src/v2/connectors/shared.ts";
import type { SourceDefinition } from "../src/v2/domain.ts";
import type { RunSmokeProfileDeps, SmokeWorkspacePaths } from "../src/v2/smoke.ts";

function captureConsoleLogs<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
  };
  return fn().then((result) => ({ result, lines })).finally(() => {
    console.log = original;
  });
}

function captureConsole<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stdout: string[]; stderr: string[] }> {
  const originalLog = console.log;
  const originalError = console.error;
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (...args: unknown[]) => {
    stdout.push(args.map((value) => String(value)).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderr.push(args.map((value) => String(value)).join(" "));
  };
  return fn().then((result) => ({ result, stdout, stderr })).finally(() => {
    console.log = originalLog;
    console.error = originalError;
  });
}

function fixtureConnector(source: SourceDefinition): SourceConnector {
  return {
    sourceId: source.sourceId,
    source,
    run: async () => {
      throw new Error("unused");
    },
  };
}

function fixtureSmokeDeps(): RunSmokeProfileDeps {
  const source: SourceDefinition = {
    sourceId: "alpha.structure",
    title: "Alpha Structure",
    kind: "fixture",
    accessMethod: "fixture",
    baseUrl: "https://example.com/alpha",
    smokeProfiles: ["structure"],
  };
  return {
    connectors: [fixtureConnector(source)],
    makeTempDir: async () => "/tmp/dc-smoke-progress-fixture",
    fetchSources: async (
      sourceIds: string[],
      options,
      _paths: SmokeWorkspacePaths,
    ) => {
      options.onProgress?.({
        sourceId: "alpha.structure",
        title: "Alpha Structure",
        index: 1,
        total: sourceIds.length,
        phase: "start",
      });
      options.onProgress?.({
        sourceId: "alpha.structure",
        title: "Alpha Structure",
        index: 1,
        total: sourceIds.length,
        phase: "connector-progress",
        message: "Fetching fixture page 1/2",
      });
      options.onProgress?.({
        sourceId: "alpha.structure",
        title: "Alpha Structure",
        index: 1,
        total: sourceIds.length,
        phase: "success",
        connectorDurationMs: 1,
        importDurationMs: 1,
        totalDurationMs: 2,
      });
      return [{
        sourceId: "alpha.structure",
        title: "Alpha Structure",
        status: "success",
        endpointStatuses: ["alpha.structure.main:success"],
      }];
    },
    readWorkbenchStatus: async () => ({
      nextCommand: "deno task dc -- review",
      unresolvedStateNote:
        "Unresolved workbench state: open decisions=0, browse rows=0, deferred review=0, stale review=0, blocked reconciliation=0, placeholder entities=0.",
    }),
  };
}

Deno.test("smoke renders source progress while fetching profile sources", async () => {
  const { result, stdout, stderr } = await runSmokeWithStreams(
    ["smoke", "structure"],
    {},
    fixtureSmokeDeps(),
  );

  assertEquals(result, true);
  const progress = stderr.join("\n");
  assertStringIncludes(progress, "[1/1] Starting alpha.structure - Alpha Structure");
  assertStringIncludes(progress, "[1/1] alpha.structure: Fetching fixture page 1/2");
  assertStringIncludes(progress, "[1/1] Finished alpha.structure");
  assertStringIncludes(stdout.join("\n"), "Smoke fetch summary: 1/1 succeeded.");
});

Deno.test("smoke json output stays free of source progress logs", async () => {
  const { result, lines } = await runSmoke(
    ["smoke", "structure"],
    { json: true },
    fixtureSmokeDeps(),
  );

  assertEquals(result, true);
  assertEquals(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assertEquals(parsed.profile, "structure");
  assertEquals(parsed.outcomes[0].sourceId, "alpha.structure");
});

async function runSmoke(
  args: string[],
  options: SmokeCommandOptions,
  deps: RunSmokeProfileDeps,
): Promise<{ result: boolean; lines: string[] }> {
  return await captureConsoleLogs(async () => await handleSmokeCommand(args, options, deps));
}

async function runSmokeWithStreams(
  args: string[],
  options: SmokeCommandOptions,
  deps: RunSmokeProfileDeps,
): Promise<{ result: boolean; stdout: string[]; stderr: string[] }> {
  return await captureConsole(async () => await handleSmokeCommand(args, options, deps));
}
