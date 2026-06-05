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
        "Workbench state: open decisions=0, browse rows=0, deferred review=0, stale review=0, blocked reconciliation=0, placeholder entities=0.",
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
  const text = stdout.join("\n");
  assertStringIncludes(text, "Release out: /tmp/dc-smoke-progress-fixture/release");
  assertStringIncludes(
    text,
    "Release verify: deno task dc -- release verify --db /tmp/dc-smoke-progress-fixture/workbench.sqlite",
  );
  assertStringIncludes(
    text,
    "Release build: deno task dc -- release build --source-profile structure --db /tmp/dc-smoke-progress-fixture/workbench.sqlite --out /tmp/dc-smoke-progress-fixture/release",
  );
  assertStringIncludes(
    text,
    "Release inspect: deno task dc -- release inspect --out /tmp/dc-smoke-progress-fixture/release",
  );
  assertStringIncludes(text, "Smoke fetch summary: 1/1 succeeded.");
  assertStringIncludes(
    text,
    "Next: deno task dc -- review --db /tmp/dc-smoke-progress-fixture/workbench.sqlite",
  );
});

Deno.test("smoke text points failed sources to inspection in the temp workbench", async () => {
  const deps = fixtureSmokeDeps();
  deps.fetchSources = async () => [{
    sourceId: "alpha.structure",
    title: "Alpha Structure",
    status: "failed",
    endpointStatuses: [],
    errorText: "fixture smoke fetch failure",
  }];
  deps.readWorkbenchStatus = async () => ({
    nextCommand: "deno task dc -- source inspect alpha.structure",
    unresolvedStateNote: "Workbench state: failed source present.",
  });

  const { result, stdout } = await runSmokeWithStreams(
    ["smoke", "structure"],
    {},
    deps,
  );
  Deno.exitCode = 0;

  assertEquals(result, true);
  const text = stdout.join("\n");
  assertStringIncludes(text, "Smoke fetch summary: 0/1 succeeded.");
  assertStringIncludes(text, "Smoke failures: 1");
  assertStringIncludes(
    text,
    "Inspect failed source: deno task dc -- source inspect alpha.structure --db /tmp/dc-smoke-progress-fixture/workbench.sqlite",
  );
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
  assertEquals(parsed.successCount, 1);
  assertEquals(parsed.failureCount, 0);
  assertEquals(parsed.outcomes[0].sourceId, "alpha.structure");
  assertEquals(parsed.releaseOutDir, "/tmp/dc-smoke-progress-fixture/release");
  assertEquals(
    parsed.releaseVerifyCommand,
    "deno task dc -- release verify --db /tmp/dc-smoke-progress-fixture/workbench.sqlite",
  );
  assertEquals(
    parsed.releaseBuildCommand,
    "deno task dc -- release build --source-profile structure --db /tmp/dc-smoke-progress-fixture/workbench.sqlite --out /tmp/dc-smoke-progress-fixture/release",
  );
  assertEquals(
    parsed.releaseInspectCommand,
    "deno task dc -- release inspect --out /tmp/dc-smoke-progress-fixture/release",
  );
  assertEquals(
    parsed.nextCommand,
    "deno task dc -- review --db /tmp/dc-smoke-progress-fixture/workbench.sqlite",
  );
  assertEquals(
    parsed.status.nextCommand,
    "deno task dc -- review --db /tmp/dc-smoke-progress-fixture/workbench.sqlite",
  );
});

Deno.test("smoke clean ready status points next command to scoped release verify", async () => {
  const deps = fixtureSmokeDeps();
  deps.readWorkbenchStatus = async () => ({
    nextCommand: "deno task dc -- source list",
    unresolvedStateNote:
      "No open decisions, browse rows, deferred review items, stale review items, blocked reconciliation items, or placeholder entities were present.",
  });

  const { result, stdout } = await runSmokeWithStreams(
    ["smoke", "structure"],
    {},
    deps,
  );

  assertEquals(result, true);
  assertStringIncludes(
    stdout.join("\n"),
    "Next: deno task dc -- release verify --db /tmp/dc-smoke-progress-fixture/workbench.sqlite",
  );
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
