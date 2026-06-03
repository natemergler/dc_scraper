import { join } from "@std/path";
import { handleAuditCommand } from "./cli_audit.ts";
import { handleEntityCommand } from "./cli_entity.ts";
import { handleReleaseCommand } from "./cli_release.ts";
import { handleReviewCommand } from "./cli_review.ts";
import { handleSourceCommand } from "./cli_source.ts";
import { handleWorkbenchCommand } from "./cli_workbench.ts";
import { connectors, createConnectorContext, getConnector } from "./connectors.ts";
import { buildWorkbenchStatus } from "./status.ts";
import { Workbench } from "./workbench.ts";

export async function handleV2Command(args: string[]): Promise<boolean> {
  if (args.length === 0) return false;
  const dbPath = readFlag(args, "--db") ?? join(Deno.cwd(), "data", "workbench.sqlite");
  const dataDir = readFlag(args, "--data-dir") ?? join(Deno.cwd(), "data", "v2_artifacts");
  const outDir = readFlag(args, "--out") ?? join(Deno.cwd(), "releases", "latest");
  const resolutionsDir = readFlag(args, "--resolutions-dir") ?? join(Deno.cwd(), "resolutions");
  const limit = readNumberFlag(args, "--limit");
  const sourceHandled = await handleSourceCommand(args, { json: args.includes("--json"), limit }, {
    connectors,
    getConnector,
    createConnectorContext,
    importConnectorResult: async (result) =>
      await withWorkbench(
        dbPath,
        async (workbench) => {
          await workbench.importConnectorResult(result, dataDir);
        },
        { refreshDerivedState: false },
      ),
    readSourceSummary: async (sourceId) =>
      await withWorkbench(
        dbPath,
        (workbench) => sourceSummaryOrConfigured(workbench, sourceId),
        { refreshDerivedState: false },
      ),
    readPublicBodyComparison: async () =>
      await withWorkbench(
        dbPath,
        (workbench) => workbench.comparePublicBodies(),
        { refreshDerivedState: false },
      ),
    readSourceRows: async () =>
      await withWorkbench(
        dbPath,
        (workbench) => workbench.listSources(),
        { refreshDerivedState: false },
      ),
  });
  if (sourceHandled) return true;
  const auditHandled = await handleAuditCommand(args, { json: args.includes("--json") }, {
    readWorkbenchStatus: async () =>
      await withWorkbench(dbPath, (workbench, meta) => ({
        meta,
        status: buildWorkbenchStatus(workbench),
      })),
  });
  if (auditHandled) return true;
  const reviewHandled = await handleReviewCommand(
    args,
    { json: args.includes("--json"), resolutionsDir },
    {
      withWorkbench: async (action) => await withWorkbench(dbPath, action),
    },
  );
  if (reviewHandled) return true;
  const releaseHandled = await handleReleaseCommand(
    args,
    { json: args.includes("--json"), outDir },
    {
      withWorkbench: async (action) => await withWorkbench(dbPath, action),
      readFile: async (path) => await Deno.readTextFile(path),
    },
  );
  if (releaseHandled) return true;
  const entityHandled = await handleEntityCommand(
    args,
    { json: args.includes("--json") },
    {
      searchEntities: async (query) =>
        await withWorkbench(dbPath, (workbench) => workbench.searchEntities(query)),
      entityView: async (entityId) =>
        await withWorkbench(dbPath, (workbench) => workbench.entityView(entityId)),
    },
  );
  if (entityHandled) return true;
  const workbenchHandled = await handleWorkbenchCommand(args, {
    initWorkbench: async () =>
      await withWorkbench(dbPath, (_workbench, meta) => meta, {
        refreshDerivedState: false,
      }),
  });
  if (workbenchHandled) return true;
  return false;
}

async function withWorkbench<T>(
  dbPath: string,
  action: (workbench: Workbench, meta: ReturnType<Workbench["init"]>) => T | Promise<T>,
  options?: { refreshDerivedState?: boolean },
): Promise<T> {
  const workbench = new Workbench(dbPath);
  try {
    const meta = workbench.init(options);
    return await action(workbench, meta);
  } finally {
    workbench.close();
  }
}

function sourceSummaryOrConfigured(workbench: Workbench, sourceId: string): {
  sourceId: string;
  title: string;
  latestStatus?: string;
  latestRunFinishedAt?: string;
  latestArtifactPath?: string;
  itemCount: number;
  fieldCount: number;
  entityCandidateCount: number;
  relationshipCandidateCount: number;
} {
  try {
    return workbench.sourceSummary(sourceId);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Unknown source:")) throw error;
    const connector = getConnector(sourceId);
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

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readNumberFlag(args: string[], flag: string): number | undefined {
  const value = readFlag(args, flag);
  return value ? Number(value) : undefined;
}

export function printHelp(): void {
  console.log(`dc civic-data workbench

Workflow:
  Fetch:   dc source list | dc source fetch --all | dc source fetch dcgis.agencies
  Audit:   dc audit | dc status --json | dc source inspect dcgis.agencies
  Review:  dc review | dc review list --mode entities
  Release: dc release build | dc release inspect

Usage:
  dc init [--db <path>]
  dc audit [status|doctor] [--db <path>] [--json]
  dc status [--db <path>] [--json]
  dc doctor [--db <path>] [--json]
  dc source list [--db <path>] [--json]
  dc source fetch <source-id> [--db <path>] [--data-dir <path>] [--limit <n>]
  dc source fetch --all [--db <path>] [--data-dir <path>] [--limit <n>]
  dc source inspect <source-id> [--db <path>] [--json]
  dc source compare public-bodies [--db <path>] [--json]
  dc review [entities|relationships|legal|sources] [--db <path>] [--resolutions-dir <path>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>]
  dc review list [--mode <mode>] [--status <open|deferred|resolved|all>] [--type <type>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--limit <n>] [--json]
  dc review batch accept-safe [--mode <mode>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  dc review batch defer --mode <mode> --subject-prefix <prefix> [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  dc review batch defer-default --mode <mode> --subject-prefix <prefix> [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  dc entity search <query> [--db <path>] [--json]
  dc entity show <entity-id> [--db <path>] [--json]
  dc release build [--db <path>] [--out <dir>]
  dc release inspect [--out <dir>] [--json]

Defaults:
  workbench db: data/workbench.sqlite
  source artifacts: data/v2_artifacts
  resolutions: resolutions/
  release output: releases/latest
`);
}
