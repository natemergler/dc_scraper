import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { handleSourceCommand, type SourceCommandDeps } from "../src/v2/cli_source.ts";
import type { SourceConnector } from "../src/v2/connectors/shared.ts";
import type { ConnectorResult } from "../src/v2/domain.ts";

function fixtureConnector(
  sourceId: string,
  title: string,
  resultFactory: (limit?: number) => Promise<ConnectorResult>,
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
    run: async (context) => await resultFactory(context.limit),
  };
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
  };

  const { result, lines } = await captureConsoleLogs(async () =>
    await handleSourceCommand(["source", "fetch", "--all"], { limit: 3 }, deps)
  );

  assertEquals(result, true);
  assertEquals(observedLimits, [3, 3]);
  assertEquals(imported, ["alpha.source", "beta.source"]);
  assertStringIncludes(lines.join("\n"), "Fetched alpha.source");
  assertStringIncludes(lines.join("\n"), "Fetched beta.source");
  assertStringIncludes(lines.join("\n"), "Source fetch summary: 2/2 succeeded.");
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
  };

  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
  };
  try {
    await assertRejects(
      async () => await handleSourceCommand(["source", "fetch", "--all"], {}, deps),
      Error,
      "Failed 1 source(s): broken.source",
    );
  } finally {
    console.log = original;
  }

  assertEquals(imported, ["alpha.source"]);
  assertStringIncludes(lines.join("\n"), "Fetch failed broken.source");
  assertStringIncludes(lines.join("\n"), "fixture boom");
  assertStringIncludes(lines.join("\n"), "Source fetch summary: 1/2 succeeded.");
});
