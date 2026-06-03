import type { ConnectorContext, SourceConnector } from "./connectors/shared.ts";
import type { ConnectorResult } from "./domain.ts";
import type {
  PublicBodyComparisonReport,
  SourceListRow,
  SourceSummary,
} from "./workbench/catalog.ts";

export interface SourceCommandOptions {
  json?: boolean;
  limit?: number;
}

export interface SourceCommandDeps {
  connectors: SourceConnector[];
  getConnector(sourceId: string): SourceConnector;
  createConnectorContext(options: { limit?: number }): ConnectorContext;
  importConnectorResult(result: ConnectorResult): Promise<void>;
  readSourceSummary(sourceId: string): Promise<SourceSummary>;
  readPublicBodyComparison(): Promise<PublicBodyComparisonReport>;
  readSourceRows(): Promise<SourceListRow[]>;
}

export interface SourceFetchOutcome {
  sourceId: string;
  title: string;
  status: "success" | "failed";
  endpointStatuses: string[];
  errorText?: string;
}

export async function handleSourceCommand(
  args: string[],
  options: SourceCommandOptions,
  deps: SourceCommandDeps,
): Promise<boolean> {
  if (args[0] !== "source") return false;
  if (!args[1]) {
    printSourceHelp({
      tips: [
        "run `dc source list` to see fetch status, `dc source fetch --all` for a full smoke, or `dc source fetch dcgis.agencies` to start smaller",
      ],
      showAvailableSources: true,
      connectors: deps.connectors,
    });
    return true;
  }
  if (isHelp(args[1])) {
    printSourceHelp({ connectors: deps.connectors });
    return true;
  }
  if (args[1] === "fetch") {
    const sourceIds = requestedSourceIds(args, deps.connectors);
    if (!sourceIds) {
      printSourceHelp({
        tips: [
          "run `dc source fetch --all` for a full smoke or `dc source fetch dcgis.agencies` for a single source",
        ],
        showAvailableSources: true,
        connectors: deps.connectors,
      });
      return true;
    }
    const outcomes = await fetchSources(sourceIds, options, deps);
    if (options.json) {
      console.log(JSON.stringify({ count: outcomes.length, outcomes }, null, 2));
    } else {
      for (const outcome of outcomes) {
        if (outcome.status === "success") {
          console.log(`Fetched ${outcome.sourceId}`);
          console.log(outcome.endpointStatuses.join(", "));
        } else {
          console.log(`Fetch failed ${outcome.sourceId}`);
          console.log(outcome.errorText ?? "Unknown source fetch error");
        }
      }
      console.log(
        `Source fetch summary: ${
          outcomes.filter((outcome) => outcome.status === "success").length
        }/${outcomes.length} succeeded.`,
      );
    }
    const failures = outcomes.filter((outcome) => outcome.status === "failed");
    if (failures.length > 0) {
      throw new Error(
        `Failed ${failures.length} source(s): ${
          failures.map((outcome) => outcome.sourceId).join(", ")
        }`,
      );
    }
    return true;
  }
  if (args[1] === "inspect") {
    const sourceId = readPositionalArg(args, 2);
    if (!sourceId) {
      printSourceHelp({
        tips: [
          "run `dc source inspect dcgis.agencies` after a fetch or `dc source list` to browse ids",
        ],
        connectors: deps.connectors,
      });
      return true;
    }
    const summary = await readSourceSummaryOrConfigured(sourceId, deps);
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      return true;
    }
    console.log(`${summary.sourceId} - ${summary.title}`);
    console.log(`Latest status: ${summary.latestStatus ?? "unfetched"}`);
    console.log(`Latest run: ${summary.latestRunFinishedAt ?? "n/a"}`);
    console.log(`Latest artifact: ${summary.latestArtifactPath ?? "n/a"}`);
    console.log(
      `Counts: items=${summary.itemCount} fields=${summary.fieldCount} entity_candidates=${summary.entityCandidateCount} relationship_candidates=${summary.relationshipCandidateCount}`,
    );
    return true;
  }
  if (args[1] === "compare" && args[2] === "public-bodies") {
    const comparison = await deps.readPublicBodyComparison();
    if (options.json) {
      console.log(JSON.stringify(comparison, null, 2));
      return true;
    }
    console.log("Public-body overlap comparison");
    for (const source of comparison.sourceSummaries) {
      console.log(
        `${source.sourceId} ${source.normalizedNameCount} names (${source.sharedNameCount} shared, ${source.exclusiveNameCount} exclusive) entity_candidates=${source.entityCandidateCount} relationship_candidates=${source.relationshipCandidateCount}`,
      );
    }
    console.log(`Shared exact names: ${comparison.sharedNameCount}`);
    for (const row of comparison.rows.filter((row) => row.sourceIds.length > 1)) {
      console.log(`- ${row.displayName} [${row.sourceIds.join(", ")}]`);
    }
    return true;
  }
  if (args[1] === "list") {
    const rowsBySourceId = new Map((await deps.readSourceRows()).map((row) => [row.sourceId, row]));
    const sourceRows = deps.connectors.map((connector) => {
      const row = rowsBySourceId.get(connector.sourceId);
      return {
        sourceId: connector.sourceId,
        title: connector.source.title,
        status: row?.latestStatus ?? "unfetched",
        latestRunFinishedAt: row?.latestRunFinishedAt,
      };
    });
    if (options.json) {
      console.log(JSON.stringify(sourceRows, null, 2));
      return true;
    }
    for (const row of sourceRows) {
      console.log(
        `${row.sourceId} ${row.status}${
          row.latestRunFinishedAt ? ` ${row.latestRunFinishedAt}` : ""
        }`,
      );
    }
    return true;
  }
  return false;
}

export async function fetchSources(
  sourceIds: string[],
  options: SourceCommandOptions,
  deps: Pick<
    SourceCommandDeps,
    "getConnector" | "createConnectorContext" | "importConnectorResult"
  >,
): Promise<SourceFetchOutcome[]> {
  const outcomes: SourceFetchOutcome[] = [];
  for (const sourceId of sourceIds) {
    const connector = deps.getConnector(sourceId);
    try {
      const result = await connector.run(deps.createConnectorContext({ limit: options.limit }));
      await deps.importConnectorResult(result);
      outcomes.push({
        sourceId: connector.sourceId,
        title: connector.source.title,
        status: "success",
        endpointStatuses: result.endpointResults.map((item) =>
          `${item.endpoint.endpointId}:${item.status}`
        ),
      });
    } catch (error) {
      outcomes.push({
        sourceId: connector.sourceId,
        title: connector.source.title,
        status: "failed",
        endpointStatuses: [],
        errorText: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcomes;
}

export function printSourceHelp(
  options: {
    tips?: string[];
    showAvailableSources?: boolean;
    connectors?: SourceConnector[];
  } = {},
): void {
  console.log(`dc source

Workflow:
  1. Browse configured sources with \`dc source list\`
  2. Fetch everything with \`dc source fetch --all\` or fetch one source with \`dc source fetch dcgis.agencies\`
  3. Inspect one source with \`dc source inspect dcgis.agencies\`
  4. Compare overlapping public-body lanes with \`dc source compare public-bodies\`

Usage:
  dc source list [--db <path>] [--json]
  dc source fetch <source-id> [--db <path>] [--data-dir <path>] [--limit <n>] [--json]
  dc source fetch --all [--db <path>] [--data-dir <path>] [--limit <n>] [--json]
  dc source inspect <source-id> [--db <path>] [--json]
  dc source compare public-bodies [--db <path>] [--json]
`);
  if (options.showAvailableSources) {
    console.log("Available sources:");
    for (const connector of options.connectors ?? []) {
      console.log(`  ${connector.sourceId}`);
    }
    console.log("");
  }
  for (const tip of options.tips ?? []) {
    console.log(`Tip: ${tip}`);
  }
}

function requestedSourceIds(
  args: string[],
  connectors: SourceConnector[],
): string[] | undefined {
  const sourceId = readPositionalArg(args, 2);
  if (args.includes("--all") || sourceId === "all") {
    return connectors.map((connector) => connector.sourceId);
  }
  return sourceId ? [sourceId] : undefined;
}

async function readSourceSummaryOrConfigured(
  sourceId: string,
  deps: Pick<SourceCommandDeps, "readSourceSummary" | "getConnector">,
): Promise<SourceSummary> {
  try {
    return await deps.readSourceSummary(sourceId);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Unknown source:")) throw error;
    const connector = deps.getConnector(sourceId);
    return {
      sourceId: connector.sourceId,
      title: connector.source.title,
      latestStatus: "unfetched",
      itemCount: 0,
      fieldCount: 0,
      entityCandidateCount: 0,
      relationshipCandidateCount: 0,
    };
  }
}

function isHelp(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}

function readPositionalArg(args: string[], startIndex: number): string | undefined {
  for (let index = startIndex; index < args.length; index += 1) {
    if (flagConsumesValue(args[index])) {
      index += 1;
      continue;
    }
    if (args[index] === "--all" || args[index] === "--json") continue;
    if (!args[index].startsWith("--")) return args[index];
  }
  return undefined;
}

function flagConsumesValue(value: string): boolean {
  return value === "--db" || value === "--data-dir" || value === "--limit";
}
