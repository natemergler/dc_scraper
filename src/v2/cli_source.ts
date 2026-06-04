import { dcCommand } from "./command_prefix.ts";
import type {
  ConnectorContext,
  ConnectorProgressEvent,
  SourceConnector,
} from "./connectors/shared.ts";
import type { ConnectorResult } from "./domain.ts";
import type {
  PublicBodyComparisonReport,
  SourceListRow,
  SourceSummary,
} from "./workbench/catalog.ts";
import type { ImportConnectorOptions, ImportProgressEvent } from "./workbench/import.ts";

export type { ImportProgressEvent };

export interface SourceCommandOptions {
  json?: boolean;
  limit?: number;
}

export interface SourceCommandDeps {
  connectors: SourceConnector[];
  getConnector(sourceId: string): SourceConnector;
  createConnectorContext(
    options: { limit?: number; onProgress?: (event: ConnectorProgressEvent) => void },
  ): ConnectorContext;
  importConnectorResult(result: ConnectorResult, options?: ImportConnectorOptions): Promise<void>;
  readSourceSummary(sourceId: string): Promise<SourceSummary>;
  readPublicBodyComparison(): Promise<PublicBodyComparisonReport>;
  readSourceRows(): Promise<SourceListRow[]>;
  readWorkbenchStatus?(): Promise<{ nextCommand: string; unresolvedStateNote: string }>;
}

export interface SourceFetchOutcome {
  sourceId: string;
  title: string;
  status: "success" | "failed";
  endpointStatuses: string[];
  errorText?: string;
}

export interface SourceFetchProgressEvent {
  sourceId: string;
  title: string;
  index: number;
  total: number;
  phase:
    | "start"
    | "connector-progress"
    | "connector-ready"
    | "import"
    | "import-progress"
    | "success"
    | "failed";
  message?: string;
  importProgress?: ImportProgressEvent;
  connectorDurationMs?: number;
  importDurationMs?: number;
  totalDurationMs?: number;
}

const SOURCE_FETCH_CONNECTOR_CONCURRENCY = 4;

export async function handleSourceCommand(
  args: string[],
  options: SourceCommandOptions,
  deps: SourceCommandDeps,
): Promise<boolean> {
  if (args[0] !== "source") return false;
  if (!args[1]) {
    printSourceHelp({
      tips: [
        `run \`${dcCommand("source list")}\` to see fetch status, \`${
          dcCommand("source fetch --all")
        }\` to fetch every configured source into this workbench, or \`${
          dcCommand("source fetch dcgis.agencies")
        }\` to start smaller`,
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
          `run \`${
            dcCommand("source fetch --all")
          }\` to fetch every configured source into this workbench or \`${
            dcCommand("source fetch dcgis.agencies")
          }\` for one source`,
        ],
        showAvailableSources: true,
        connectors: deps.connectors,
      });
      return true;
    }
    const outcomes = await fetchSources(
      sourceIds,
      options,
      deps,
      options.json ? undefined : logSourceFetchProgress,
    );
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
    if (!options.json && deps.readWorkbenchStatus) {
      const status = await deps.readWorkbenchStatus();
      console.log(`Readiness: ${status.unresolvedStateNote}`);
      console.log(`Next: ${status.nextCommand}`);
    }
    return true;
  }
  if (args[1] === "inspect") {
    const sourceId = readPositionalArg(args, 2);
    if (!sourceId) {
      printSourceHelp({
        tips: [
          `run \`${dcCommand("source inspect dcgis.agencies")}\` after a fetch or \`${
            dcCommand("source list")
          }\` to browse ids`,
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
  if (args[1] === "compare") {
    if (!args[2] || args[2].startsWith("--") || isHelp(args[2])) {
      printSourceHelp({
        tips: [
          `run \`${
            dcCommand("source compare public-bodies")
          }\` after fetching overlapping public-body lanes`,
        ],
        connectors: deps.connectors,
      });
      return true;
    }
  }
  if (args[1] === "compare" && args[2] === "public-bodies") {
    if (hasHelpFlag(args, 3)) {
      printSourceHelp({
        tips: [
          `run \`${
            dcCommand("source compare public-bodies")
          }\` after fetching overlapping public-body lanes`,
        ],
        connectors: deps.connectors,
      });
      return true;
    }
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
    console.log(
      `Conservative variant matches (review leads, not exact overlaps): ${comparison.conservativeVariantMatchCount}`,
    );
    if (comparison.conservativeVariantMatchCount > 0) {
      console.log(
        "These rows are conservative name-similarity leads. They do not imply a canonical merge.",
      );
    }
    for (const match of comparison.conservativeVariantMatches) {
      console.log(`- ${match.variantName} [${match.matchKinds.join(", ")}]`);
      for (const name of match.names) {
        console.log(`  - ${name.displayName} (${name.sourceId})`);
      }
    }
    return true;
  }
  if (args[1] === "list") {
    if (hasHelpFlag(args, 2)) {
      printSourceHelp({ connectors: deps.connectors });
      return true;
    }
    const rowsBySourceId = new Map((await deps.readSourceRows()).map((row) => [row.sourceId, row]));
    const sourceRows = deps.connectors.map((connector) => {
      const row = rowsBySourceId.get(connector.sourceId);
      return {
        sourceId: connector.sourceId,
        title: connector.source.title,
        status: row?.latestStatus ?? "unfetched",
        latestRunFinishedAt: row?.latestRunFinishedAt,
        tier: connector.source.tier ?? "unspecified",
        releaseRole: connector.source.releaseRole ?? "unspecified",
        smokeProfiles: connector.source.smokeProfiles ?? [],
        privacyNotes: connector.source.privacyNotes ?? [],
      };
    });
    if (options.json) {
      console.log(JSON.stringify(sourceRows, null, 2));
      return true;
    }
    for (const row of sourceRows) {
      console.log(
        `${row.sourceId} ${row.status} ${row.tier}/${row.releaseRole}${
          row.smokeProfiles.length > 0 ? ` [${row.smokeProfiles.join(",")}]` : ""
        }${row.latestRunFinishedAt ? ` ${row.latestRunFinishedAt}` : ""}`,
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
  onProgress?: (event: SourceFetchProgressEvent) => void,
): Promise<SourceFetchOutcome[]> {
  const outcomes: SourceFetchOutcome[] = [];
  const total = sourceIds.length;
  const fetchRecords = await mapConcurrent(
    sourceIds.map((sourceId, index) => ({ sourceId, sourceIndex: index + 1 })),
    SOURCE_FETCH_CONNECTOR_CONCURRENCY,
    async ({ sourceId, sourceIndex }) =>
      await fetchConnectorResult(sourceId, sourceIndex, total, options, deps, onProgress),
  );
  for (const record of fetchRecords) {
    const { connector, sourceIndex, sourceStartedAt, connectorDurationMs } = record;
    if (record.status === "failed") {
      outcomes.push({
        sourceId: connector.sourceId,
        title: connector.source.title,
        status: "failed",
        endpointStatuses: [],
        errorText: record.errorText,
      });
      continue;
    }
    const importStartedAt = performance.now();
    onProgress?.({
      sourceId: connector.sourceId,
      title: connector.source.title,
      index: sourceIndex,
      total,
      phase: "import",
      connectorDurationMs,
      totalDurationMs: performance.now() - sourceStartedAt,
    });
    let importDurationMs = 0;
    try {
      await deps.importConnectorResult(
        record.result,
        onProgress
          ? {
            onProgress: (event) =>
              onProgress({
                sourceId: connector.sourceId,
                title: connector.source.title,
                index: sourceIndex,
                total,
                phase: "import-progress",
                message: event.message,
                importProgress: event,
                connectorDurationMs,
                importDurationMs: performance.now() - importStartedAt,
                totalDurationMs: performance.now() - sourceStartedAt,
              }),
          }
          : undefined,
      );
      importDurationMs = performance.now() - importStartedAt;
    } catch (error) {
      onProgress?.({
        sourceId: connector.sourceId,
        title: connector.source.title,
        index: sourceIndex,
        total,
        phase: "failed",
        connectorDurationMs,
        importDurationMs: performance.now() - importStartedAt,
        totalDurationMs: performance.now() - sourceStartedAt,
      });
      outcomes.push({
        sourceId: connector.sourceId,
        title: connector.source.title,
        status: "failed",
        endpointStatuses: [],
        errorText: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    onProgress?.({
      sourceId: connector.sourceId,
      title: connector.source.title,
      index: sourceIndex,
      total,
      phase: "success",
      connectorDurationMs,
      importDurationMs,
      totalDurationMs: performance.now() - sourceStartedAt,
    });
    outcomes.push({
      sourceId: connector.sourceId,
      title: connector.source.title,
      status: "success",
      endpointStatuses: record.result.endpointResults.map((item) =>
        `${item.endpoint.endpointId}:${item.status}`
      ),
    });
  }
  return outcomes;
}

type ConnectorFetchRecord =
  | {
    status: "success";
    connector: SourceConnector;
    sourceIndex: number;
    sourceStartedAt: number;
    connectorDurationMs: number;
    result: ConnectorResult;
  }
  | {
    status: "failed";
    connector: SourceConnector;
    sourceIndex: number;
    sourceStartedAt: number;
    connectorDurationMs: number;
    errorText: string;
  };

async function fetchConnectorResult(
  sourceId: string,
  sourceIndex: number,
  total: number,
  options: SourceCommandOptions,
  deps: Pick<SourceCommandDeps, "getConnector" | "createConnectorContext">,
  onProgress?: (event: SourceFetchProgressEvent) => void,
): Promise<ConnectorFetchRecord> {
  const connector = deps.getConnector(sourceId);
  onProgress?.({
    sourceId: connector.sourceId,
    title: connector.source.title,
    index: sourceIndex,
    total,
    phase: "start",
  });
  const sourceStartedAt = performance.now();
  const connectorStartedAt = performance.now();
  try {
    const result = await connector.run(
      deps.createConnectorContext({
        limit: options.limit,
        onProgress: onProgress
          ? (event) =>
            onProgress({
              sourceId: connector.sourceId,
              title: connector.source.title,
              index: sourceIndex,
              total,
              phase: "connector-progress",
              message: event.message,
              connectorDurationMs: performance.now() - connectorStartedAt,
              totalDurationMs: performance.now() - sourceStartedAt,
            })
          : undefined,
      }),
    );
    const connectorDurationMs = performance.now() - connectorStartedAt;
    onProgress?.({
      sourceId: connector.sourceId,
      title: connector.source.title,
      index: sourceIndex,
      total,
      phase: "connector-ready",
      connectorDurationMs,
      totalDurationMs: performance.now() - sourceStartedAt,
    });
    return {
      status: "success",
      connector,
      sourceIndex,
      sourceStartedAt,
      connectorDurationMs,
      result,
    };
  } catch (error) {
    const connectorDurationMs = performance.now() - connectorStartedAt;
    onProgress?.({
      sourceId: connector.sourceId,
      title: connector.source.title,
      index: sourceIndex,
      total,
      phase: "failed",
      connectorDurationMs,
      importDurationMs: 0,
      totalDurationMs: performance.now() - sourceStartedAt,
    });
    return {
      status: "failed",
      connector,
      sourceIndex,
      sourceStartedAt,
      connectorDurationMs,
      errorText: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mapConcurrent<T, U>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export function printSourceHelp(
  options: {
    tips?: string[];
    showAvailableSources?: boolean;
    connectors?: SourceConnector[];
  } = {},
): void {
  console.log(`${dcCommand("source")}

Workflow:
  1. Browse configured sources with \`${dcCommand("source list")}\`
  2. Fetch everything with \`${dcCommand("source fetch --all")}\` or fetch one source with \`${
    dcCommand("source fetch dcgis.agencies")
  }\`
  3. Inspect one source with \`${dcCommand("source inspect dcgis.agencies")}\`
  4. Compare overlapping public-body lanes with \`${dcCommand("source compare public-bodies")}\`

Usage:
  ${dcCommand("source list")} [--db <path>] [--json]
  ${dcCommand("source fetch <source-id>")} [--db <path>] [--data-dir <path>] [--limit <n>] [--json]
  ${dcCommand("source fetch --all")} [--db <path>] [--data-dir <path>] [--limit <n>] [--json]
  ${dcCommand("source inspect <source-id>")} [--db <path>] [--json]
  ${dcCommand("source compare public-bodies")} [--db <path>] [--json]
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

function hasHelpFlag(args: string[], start: number): boolean {
  return args.slice(start).some((value) => isHelp(value));
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

export function logSourceFetchProgress(event: SourceFetchProgressEvent): void {
  const prefix = `[${event.index}/${event.total}]`;
  if (event.phase === "start") {
    console.error(`${prefix} Starting ${event.sourceId} - ${event.title}`);
    return;
  }
  if (event.phase === "success") {
    console.error(
      `${prefix} Finished ${event.sourceId} in ${
        formatDuration(event.totalDurationMs)
      } (connector ${formatDuration(event.connectorDurationMs)}, import ${
        formatDuration(event.importDurationMs)
      })`,
    );
    return;
  }
  if (event.phase === "connector-progress") {
    const elapsed = event.connectorDurationMs === undefined
      ? ""
      : ` (${formatDuration(event.connectorDurationMs)})`;
    console.error(`${prefix} ${event.sourceId}: ${event.message ?? "Working"}${elapsed}`);
    return;
  }
  if (event.phase === "connector-ready") {
    console.error(
      `${prefix} Connector ready ${event.sourceId}; queued for ordered import (${
        formatDuration(event.connectorDurationMs)
      })`,
    );
    return;
  }
  if (event.phase === "import") {
    console.error(
      `${prefix} Importing ${event.sourceId} after connector ${
        formatDuration(event.connectorDurationMs)
      }`,
    );
    return;
  }
  if (event.phase === "import-progress") {
    const elapsed = event.importDurationMs === undefined
      ? ""
      : ` (${formatDuration(event.importDurationMs)})`;
    console.error(`${prefix} ${event.sourceId} import: ${event.message ?? "Working"}${elapsed}`);
    return;
  }
  console.error(
    `${prefix} Fetch failed ${event.sourceId} after ${formatDuration(event.totalDurationMs)} (${
      event.importDurationMs && event.importDurationMs > 0
        ? `connector ${formatDuration(event.connectorDurationMs)}, import ${
          formatDuration(event.importDurationMs)
        }`
        : `connector ${formatDuration(event.connectorDurationMs)}`
    })`,
  );
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return "n/a";
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(2)}s`;
  return `${Math.round(durationMs)}ms`;
}
