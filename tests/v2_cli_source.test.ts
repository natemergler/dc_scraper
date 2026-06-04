import { assertEquals, assertMatch, assertRejects, assertStringIncludes } from "@std/assert";
import {
  handleSourceCommand,
  type ImportProgressEvent,
  type SourceCommandDeps,
} from "../src/v2/cli_source.ts";
import type { ConnectorContext, SourceConnector } from "../src/v2/connectors/shared.ts";
import type { ConnectorResult } from "../src/v2/domain.ts";
import type { PublicBodyComparisonReport } from "../src/v2/workbench/catalog.ts";

function fixtureConnector(
  sourceId: string,
  title: string,
  resultFactory: (
    limit?: number,
    onProgress?: ConnectorContext["onProgress"],
  ) => Promise<ConnectorResult>,
): SourceConnector {
  return {
    sourceId,
    source: {
      sourceId,
      title,
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: `https://example.com/${sourceId}`,
    },
    run: async (context) => await resultFactory(context.limit, context.onProgress),
  };
}

function fixtureResult(sourceId: string, title: string): ConnectorResult {
  return {
    source: {
      sourceId,
      title,
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: `https://example.com/${sourceId}`,
    },
    endpointResults: [{
      endpoint: {
        endpointId: `${sourceId}.main`,
        sourceId,
        title: `${title} endpoint`,
        kind: "fixture",
        url: `https://example.com/${sourceId}`,
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [],
    }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

Deno.test("source fetch --all runs configured connectors in order and imports each result", async () => {
  const observedLimits: Array<number | undefined> = [];
  const imported: string[] = [];
  const connectors = [
    fixtureConnector("alpha.source", "Alpha Source", async (limit) => {
      observedLimits.push(limit);
      return {
        source: {
          sourceId: "alpha.source",
          title: "Alpha Source",
          kind: "fixture",
          accessMethod: "fixture",
          baseUrl: "https://example.com/alpha",
        },
        endpointResults: [{
          endpoint: {
            endpointId: "alpha.source.main",
            sourceId: "alpha.source",
            title: "Alpha endpoint",
            kind: "fixture",
            url: "https://example.com/alpha",
            method: "GET",
            captureMode: "rows",
          },
          status: "success",
          artifacts: [],
        }],
      };
    }),
    fixtureConnector("beta.source", "Beta Source", async (limit) => {
      observedLimits.push(limit);
      return {
        source: {
          sourceId: "beta.source",
          title: "Beta Source",
          kind: "fixture",
          accessMethod: "fixture",
          baseUrl: "https://example.com/beta",
        },
        endpointResults: [{
          endpoint: {
            endpointId: "beta.source.main",
            sourceId: "beta.source",
            title: "Beta endpoint",
            kind: "fixture",
            url: "https://example.com/beta",
            method: "GET",
            captureMode: "rows",
          },
          status: "success",
          artifacts: [],
        }],
      };
    }),
  ];
  const deps: SourceCommandDeps = {
    connectors,
    getConnector: (sourceId) => {
      const connector = connectors.find((candidate) => candidate.sourceId === sourceId);
      if (!connector) throw new Error(`Unknown v2 source: ${sourceId}`);
      return connector;
    },
    createConnectorContext: ({ limit }) => ({
      fetcher: async () => {
        throw new Error("unused");
      },
      limit,
    }),
    importConnectorResult: async (result) => {
      imported.push(result.source.sourceId);
    },
    readSourceSummary: async () => {
      throw new Error("unused");
    },
    readPublicBodyComparison: async () => {
      throw new Error("unused");
    },
    readSourceRows: async () => [],
    readWorkbenchStatus: async () => ({
      nextCommand: "deno task dc -- review",
      unresolvedStateNote:
        "Unresolved workbench state: open decisions=2, browse rows=0, deferred review=0, stale review=0, blocked reconciliation=0, placeholder entities=0.",
    }),
  };

  const { result, stdout, stderr } = await captureConsole(async () =>
    await handleSourceCommand(["source", "fetch", "--all"], { limit: 3 }, deps)
  );

  assertEquals(result, true);
  assertEquals(observedLimits, [3, 3]);
  assertEquals(imported, ["alpha.source", "beta.source"]);
  const progress = stderr.join("\n");
  assertMatch(progress, /\[1\/2\] Starting alpha\.source - Alpha Source/);
  assertMatch(progress, /\[1\/2\] Importing alpha\.source after connector .*/);
  assertMatch(progress, /\[1\/2\] Finished alpha\.source in .* \(connector .*, import .*\)/);
  assertMatch(progress, /\[2\/2\] Starting beta\.source - Beta Source/);
  assertMatch(progress, /\[2\/2\] Importing beta\.source after connector .*/);
  assertMatch(progress, /\[2\/2\] Finished beta\.source in .* \(connector .*, import .*\)/);
  const output = stdout.join("\n");
  assertStringIncludes(output, "Fetched alpha.source");
  assertStringIncludes(output, "Fetched beta.source");
  assertStringIncludes(output, "Source fetch summary: 2/2 succeeded.");
  assertStringIncludes(
    output,
    "Readiness: Unresolved workbench state: open decisions=2, browse rows=0, deferred review=0, stale review=0, blocked reconciliation=0, placeholder entities=0.",
  );
  assertStringIncludes(
    output,
    "Next: deno task dc -- review",
  );
});

Deno.test("source fetch --all prefetches connectors while importing in requested order", async () => {
  const events: string[] = [];
  const imported: string[] = [];
  const alphaReady = deferred<ConnectorResult>();
  const betaStarted = deferred<void>();
  const connectors = [
    fixtureConnector("alpha.source", "Alpha Source", async () => {
      events.push("run alpha.source");
      return await alphaReady.promise;
    }),
    fixtureConnector("beta.source", "Beta Source", async () => {
      events.push("run beta.source");
      betaStarted.resolve();
      return fixtureResult("beta.source", "Beta Source");
    }),
  ];
  const deps: SourceCommandDeps = {
    connectors,
    getConnector: (sourceId) => {
      const connector = connectors.find((candidate) => candidate.sourceId === sourceId);
      if (!connector) throw new Error(`Unknown v2 source: ${sourceId}`);
      return connector;
    },
    createConnectorContext: ({ limit }) => ({
      fetcher: async () => {
        throw new Error(`unused ${limit}`);
      },
      limit,
    }),
    importConnectorResult: async (result) => {
      imported.push(result.source.sourceId);
    },
    readSourceSummary: async () => {
      throw new Error("unused");
    },
    readPublicBodyComparison: async () => {
      throw new Error("unused");
    },
    readSourceRows: async () => [],
  };

  const command = captureConsole(async () =>
    await handleSourceCommand(["source", "fetch", "--all"], {}, deps)
  );
  const betaStartedBeforeAlphaFinished = await Promise.race([
    betaStarted.promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
  ]);
  if (!betaStartedBeforeAlphaFinished) {
    alphaReady.resolve(fixtureResult("alpha.source", "Alpha Source"));
    await command;
  }
  assertEquals(betaStartedBeforeAlphaFinished, true);
  alphaReady.resolve(fixtureResult("alpha.source", "Alpha Source"));

  const { result } = await command;

  assertEquals(result, true);
  assertEquals(events, ["run alpha.source", "run beta.source"]);
  assertEquals(imported, ["alpha.source", "beta.source"]);
});

Deno.test("source fetch --all reports connector completion before ordered import", async () => {
  const alphaReady = deferred<ConnectorResult>();
  const connectors = [
    fixtureConnector("alpha.source", "Alpha Source", async () => await alphaReady.promise),
    fixtureConnector(
      "beta.source",
      "Beta Source",
      async () => fixtureResult("beta.source", "Beta Source"),
    ),
  ];
  const deps: SourceCommandDeps = {
    connectors,
    getConnector: (sourceId) => {
      const connector = connectors.find((candidate) => candidate.sourceId === sourceId);
      if (!connector) throw new Error(`Unknown v2 source: ${sourceId}`);
      return connector;
    },
    createConnectorContext: ({ limit }) => ({
      fetcher: async () => {
        throw new Error(`unused ${limit}`);
      },
      limit,
    }),
    importConnectorResult: async () => {},
    readSourceSummary: async () => {
      throw new Error("unused");
    },
    readPublicBodyComparison: async () => {
      throw new Error("unused");
    },
    readSourceRows: async () => [],
  };

  const command = captureConsole(async () =>
    await handleSourceCommand(["source", "fetch", "--all"], {}, deps)
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  alphaReady.resolve(fixtureResult("alpha.source", "Alpha Source"));

  const { result, stderr } = await command;

  assertEquals(result, true);
  assertStringIncludes(
    stderr.join("\n"),
    "[2/2] Connector ready beta.source; queued for ordered import",
  );
});

Deno.test("source fetch --all continues through failures and throws a summary error", async () => {
  const imported: string[] = [];
  const connectors = [
    fixtureConnector("alpha.source", "Alpha Source", async () => ({
      source: {
        sourceId: "alpha.source",
        title: "Alpha Source",
        kind: "fixture",
        accessMethod: "fixture",
        baseUrl: "https://example.com/alpha",
      },
      endpointResults: [{
        endpoint: {
          endpointId: "alpha.source.main",
          sourceId: "alpha.source",
          title: "Alpha endpoint",
          kind: "fixture",
          url: "https://example.com/alpha",
          method: "GET",
          captureMode: "rows",
        },
        status: "success",
        artifacts: [],
      }],
    })),
    fixtureConnector("broken.source", "Broken Source", async () => {
      throw new Error("fixture boom");
    }),
  ];
  const deps: SourceCommandDeps = {
    connectors,
    getConnector: (sourceId) => {
      const connector = connectors.find((candidate) => candidate.sourceId === sourceId);
      if (!connector) throw new Error(`Unknown v2 source: ${sourceId}`);
      return connector;
    },
    createConnectorContext: ({ limit }) => ({
      fetcher: async () => {
        throw new Error(`unused ${limit}`);
      },
      limit,
    }),
    importConnectorResult: async (result) => {
      imported.push(result.source.sourceId);
    },
    readSourceSummary: async () => {
      throw new Error("unused");
    },
    readPublicBodyComparison: async () => {
      throw new Error("unused");
    },
    readSourceRows: async () => [],
    readWorkbenchStatus: async () => {
      throw new Error("stale workbench status should not be read after a fetch failure");
    },
  };

  const { stdout, stderr } = await captureConsole(async () =>
    await assertRejects(
      async () => await handleSourceCommand(["source", "fetch", "--all"], {}, deps),
      Error,
      "Failed 1 source(s): broken.source",
    )
  );

  assertEquals(imported, ["alpha.source"]);
  const progress = stderr.join("\n");
  assertMatch(progress, /\[2\/2\] Starting broken\.source - Broken Source/);
  assertMatch(progress, /\[2\/2\] Fetch failed broken\.source after .* \(connector .*\)/);
  const output = stdout.join("\n");
  assertStringIncludes(output, "Fetch failed broken.source");
  assertStringIncludes(output, "fixture boom");
  assertStringIncludes(output, "Source fetch summary: 1/2 succeeded.");
  assertEquals(stdout.some((line) => line.startsWith("Next:")), false);
});

Deno.test("source fetch --all keeps json output free of progress logs", async () => {
  const connectors = [
    fixtureConnector("alpha.source", "Alpha Source", async (_limit, onProgress) => {
      onProgress?.({ message: "Fetching rows 1-2 of 3 (page 1/2)" });
      return {
        source: {
          sourceId: "alpha.source",
          title: "Alpha Source",
          kind: "fixture",
          accessMethod: "fixture",
          baseUrl: "https://example.com/alpha",
        },
        endpointResults: [{
          endpoint: {
            endpointId: "alpha.source.main",
            sourceId: "alpha.source",
            title: "Alpha endpoint",
            kind: "fixture",
            url: "https://example.com/alpha",
            method: "GET",
            captureMode: "rows",
          },
          status: "success",
          artifacts: [],
        }],
      };
    }),
  ];
  const deps: SourceCommandDeps = {
    connectors,
    getConnector: (sourceId) => {
      const connector = connectors.find((candidate) => candidate.sourceId === sourceId);
      if (!connector) throw new Error(`Unknown v2 source: ${sourceId}`);
      return connector;
    },
    createConnectorContext: ({ limit }) => ({
      fetcher: async () => {
        throw new Error(`unused ${limit}`);
      },
      limit,
    }),
    importConnectorResult: async () => {},
    readSourceSummary: async () => {
      throw new Error("unused");
    },
    readPublicBodyComparison: async () => {
      throw new Error("unused");
    },
    readSourceRows: async () => [],
    readWorkbenchStatus: async () => {
      throw new Error("json mode should not read workbench readiness");
    },
  };

  const { result, lines } = await captureConsoleLogs(async () =>
    await handleSourceCommand(["source", "fetch", "--all"], { json: true }, deps)
  );

  assertEquals(result, true);
  assertEquals(lines.length, 1);
  assertEquals(JSON.parse(lines[0]), {
    count: 1,
    outcomes: [{
      sourceId: "alpha.source",
      title: "Alpha Source",
      status: "success",
      endpointStatuses: ["alpha.source.main:success"],
    }],
  });
});

Deno.test("source fetch prints connector substep progress", async () => {
  const connectors = [
    fixtureConnector("paged.source", "Paged Source", async (_limit, onProgress) => {
      onProgress?.({ message: "Fetching rows 1-2 of 3 (page 1/2)" });
      return {
        source: {
          sourceId: "paged.source",
          title: "Paged Source",
          kind: "fixture",
          accessMethod: "fixture",
          baseUrl: "https://example.com/paged",
        },
        endpointResults: [{
          endpoint: {
            endpointId: "paged.source.main",
            sourceId: "paged.source",
            title: "Paged endpoint",
            kind: "fixture",
            url: "https://example.com/paged",
            method: "GET",
            captureMode: "rows",
          },
          status: "success",
          artifacts: [],
        }],
      };
    }),
  ];
  const deps: SourceCommandDeps = {
    connectors,
    getConnector: (sourceId) => {
      const connector = connectors.find((candidate) => candidate.sourceId === sourceId);
      if (!connector) throw new Error(`Unknown v2 source: ${sourceId}`);
      return connector;
    },
    createConnectorContext: ({ limit, onProgress }) => ({
      fetcher: async () => {
        throw new Error("unused");
      },
      limit,
      onProgress,
    }),
    importConnectorResult: async () => {},
    readSourceSummary: async () => {
      throw new Error("unused");
    },
    readPublicBodyComparison: async () => {
      throw new Error("unused");
    },
    readSourceRows: async () => [],
  };

  const { result, stderr } = await captureConsole(async () =>
    await handleSourceCommand(["source", "fetch", "--all"], {}, deps)
  );

  assertEquals(result, true);
  assertStringIncludes(
    stderr.join("\n"),
    "[1/1] paged.source: Fetching rows 1-2 of 3 (page 1/2)",
  );
});

Deno.test("source fetch prints import substeps to stderr after connector returns", async () => {
  const connectors = [
    fixtureConnector("mota.quickbase", "MOTA QuickBase", async () => ({
      source: {
        sourceId: "mota.quickbase",
        title: "MOTA QuickBase",
        kind: "quickbase",
        accessMethod: "fixture",
        baseUrl: "https://example.com/quickbase",
      },
      endpointResults: [{
        endpoint: {
          endpointId: "mota.quickbase.main",
          sourceId: "mota.quickbase",
          title: "QuickBase endpoint",
          kind: "fixture",
          url: "https://example.com/quickbase",
          method: "GET",
          captureMode: "rows",
        },
        status: "success",
        artifacts: [],
      }],
    })),
  ];
  const importProgress: ImportProgressEvent[] = [
    { phase: "parsed-row-insert", message: "Inserted parsed rows" },
    { phase: "legal-auto-accept", message: "Auto-accepted safe legal refs" },
    { phase: "entity-auto-promote", message: "Auto-promoted safe entities" },
    { phase: "relationship-reconciliation", message: "Reconciled relationship candidates" },
    { phase: "relationship-replay", message: "Replayed relationship decisions" },
    { phase: "relationship-auto-accept", message: "Auto-accepted safe relationships" },
  ];
  const deps: SourceCommandDeps = {
    connectors,
    getConnector: (sourceId) => {
      const connector = connectors.find((candidate) => candidate.sourceId === sourceId);
      if (!connector) throw new Error(`Unknown v2 source: ${sourceId}`);
      return connector;
    },
    createConnectorContext: ({ limit }) => ({
      fetcher: async () => {
        throw new Error(`unused ${limit}`);
      },
      limit,
    }),
    importConnectorResult: async (_result, options) => {
      for (const event of importProgress) options?.onProgress?.(event);
    },
    readSourceSummary: async () => {
      throw new Error("unused");
    },
    readPublicBodyComparison: async () => {
      throw new Error("unused");
    },
    readSourceRows: async () => [],
  };

  const { result, stdout, stderr } = await captureConsole(async () =>
    await handleSourceCommand(["source", "fetch", "mota.quickbase"], {}, deps)
  );

  assertEquals(result, true);
  assertStringIncludes(stdout.join("\n"), "Fetched mota.quickbase");
  const progress = stderr.join("\n");
  assertStringIncludes(progress, "[1/1] Starting mota.quickbase - MOTA QuickBase");
  assertStringIncludes(progress, "[1/1] Importing mota.quickbase after connector");
  assertStringIncludes(progress, "[1/1] mota.quickbase import: Inserted parsed rows");
  assertStringIncludes(progress, "[1/1] mota.quickbase import: Auto-accepted safe legal refs");
  assertStringIncludes(progress, "[1/1] mota.quickbase import: Auto-promoted safe entities");
  assertStringIncludes(progress, "[1/1] mota.quickbase import: Reconciled relationship candidates");
  assertStringIncludes(progress, "[1/1] mota.quickbase import: Replayed relationship decisions");
  assertStringIncludes(progress, "[1/1] mota.quickbase import: Auto-accepted safe relationships");
});

Deno.test("source fetch --json does not attach an import progress reporter", async () => {
  let sawImportProgressReporter = false;
  const connectors = [
    fixtureConnector("alpha.source", "Alpha Source", async () => ({
      source: {
        sourceId: "alpha.source",
        title: "Alpha Source",
        kind: "fixture",
        accessMethod: "fixture",
        baseUrl: "https://example.com/alpha",
      },
      endpointResults: [{
        endpoint: {
          endpointId: "alpha.source.main",
          sourceId: "alpha.source",
          title: "Alpha endpoint",
          kind: "fixture",
          url: "https://example.com/alpha",
          method: "GET",
          captureMode: "rows",
        },
        status: "success",
        artifacts: [],
      }],
    })),
  ];
  const deps: SourceCommandDeps = {
    connectors,
    getConnector: (sourceId) => {
      const connector = connectors.find((candidate) => candidate.sourceId === sourceId);
      if (!connector) throw new Error(`Unknown v2 source: ${sourceId}`);
      return connector;
    },
    createConnectorContext: ({ limit }) => ({
      fetcher: async () => {
        throw new Error(`unused ${limit}`);
      },
      limit,
    }),
    importConnectorResult: async (_result, options) => {
      sawImportProgressReporter = options?.onProgress !== undefined;
    },
    readSourceSummary: async () => {
      throw new Error("unused");
    },
    readPublicBodyComparison: async () => {
      throw new Error("unused");
    },
    readSourceRows: async () => [],
  };

  const { result, stdout, stderr } = await captureConsole(async () =>
    await handleSourceCommand(["source", "fetch", "alpha.source"], { json: true }, deps)
  );

  assertEquals(result, true);
  assertEquals(sawImportProgressReporter, false);
  assertEquals(stderr, []);
  assertEquals(JSON.parse(stdout[0]).count, 1);
});

Deno.test("source compare public-bodies labels conservative variant matches separately from exact overlaps", async () => {
  const comparison: PublicBodyComparisonReport = {
    sourceSummaries: [{
      sourceId: "dcgis.boards_commissions_councils",
      title: "DCGIS Fixture",
      latestStatus: "success",
      latestRunFinishedAt: "2026-06-03T12:00:00Z",
      latestArtifactPath: "artifacts/dcgis.json",
      itemCount: 1,
      fieldCount: 1,
      entityCandidateCount: 1,
      relationshipCandidateCount: 0,
      normalizedNameCount: 1,
      sharedNameCount: 0,
      exclusiveNameCount: 1,
    }],
    rows: [],
    sharedNameCount: 0,
    exclusiveNameCount: 1,
    conservativeVariantMatches: [{
      variantName: "Board of Example",
      matchKinds: ["acronym_parenthetical", "parenthetical_alias"],
      sourceIds: ["dcgis.boards_commissions_councils", "open_dc.public_bodies"],
      sourceTitles: ["DCGIS Fixture", "Open DC Fixture"],
      names: [{
        normalizedName: "Board of Example",
        displayName: "Board of Example",
        sourceId: "dcgis.boards_commissions_councils",
        sourceTitle: "DCGIS Fixture",
      }, {
        normalizedName: "Board of Example (Advisory Board)",
        displayName: "Board of Example (Advisory Board)",
        sourceId: "open_dc.public_bodies",
        sourceTitle: "Open DC Fixture",
      }],
    }],
    conservativeVariantMatchCount: 1,
  };
  const deps: SourceCommandDeps = {
    connectors: [],
    getConnector: () => {
      throw new Error("unused");
    },
    createConnectorContext: () => ({
      fetcher: async () => {
        throw new Error("unused");
      },
    }),
    importConnectorResult: async () => {
      throw new Error("unused");
    },
    readSourceSummary: async () => {
      throw new Error("unused");
    },
    readPublicBodyComparison: async () => comparison,
    readSourceRows: async () => [],
  };

  const { result, lines } = await captureConsoleLogs(async () =>
    await handleSourceCommand(["source", "compare", "public-bodies"], {}, deps)
  );

  assertEquals(result, true);
  const output = lines.join("\n");
  assertStringIncludes(output, "Public-body overlap comparison");
  assertStringIncludes(output, "Shared exact names: 0");
  assertStringIncludes(
    output,
    "Conservative variant matches (review leads, not exact overlaps): 1",
  );
  assertStringIncludes(
    output,
    "These rows are conservative name-similarity leads. They do not imply a canonical merge.",
  );
  assertStringIncludes(output, "- Board of Example [acronym_parenthetical, parenthetical_alias]");
  assertStringIncludes(
    output,
    "  - Board of Example (dcgis.boards_commissions_councils)",
  );
  assertStringIncludes(
    output,
    "  - Board of Example (Advisory Board) (open_dc.public_bodies)",
  );

  const jsonCapture = await captureConsoleLogs(async () =>
    await handleSourceCommand(["source", "compare", "public-bodies"], { json: true }, deps)
  );
  assertEquals(jsonCapture.result, true);
  assertEquals(jsonCapture.lines.length, 1);
  assertEquals(JSON.parse(jsonCapture.lines[0]), comparison);
});
