import { join } from "@std/path";
import { handleAuditCommand } from "./cli_audit.ts";
import { dcCommand } from "./command_prefix.ts";
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
    readWorkbenchStatus: async () =>
      await withWorkbench(
        dbPath,
        (workbench) => buildWorkbenchStatus(workbench),
        { readonly: true, fallbackToWritable: true },
      ),
  });
  if (sourceHandled) return true;
  const auditHandled = await handleAuditCommand(args, { json: args.includes("--json") }, {
    readWorkbenchStatus: async () =>
      await withWorkbench(
        dbPath,
        (workbench, meta) => ({
          meta,
          status: buildWorkbenchStatus(workbench),
        }),
        { readonly: true, fallbackToWritable: true },
      ),
  });
  if (auditHandled) return true;
  const reviewHandled = await handleReviewCommand(
    args,
    { json: args.includes("--json"), resolutionsDir },
    {
      withWorkbench: async (action) => await withWorkbench(dbPath, action),
      withReadonlyWorkbench: async (action) =>
        await withWorkbench(dbPath, action, {
          readonly: true,
          fallbackToWritable: true,
        }),
    },
  );
  if (reviewHandled) return true;
  const releaseHandled = await handleReleaseCommand(
    args,
    { json: args.includes("--json"), outDir },
    {
      withWorkbench: async (action) =>
        await withWorkbench(dbPath, action, {
          readonly: true,
          fallbackToWritable: true,
        }),
      readFile: async (path) => await Deno.readTextFile(path),
    },
  );
  if (releaseHandled) return true;
  const entityHandled = await handleEntityCommand(
    args,
    { json: args.includes("--json") },
    {
      searchEntities: async (query) =>
        await withWorkbench(
          dbPath,
          (workbench) => workbench.searchEntities(query),
          { readonly: true, fallbackToWritable: true },
        ),
      entityView: async (entityId) =>
        await withWorkbench(
          dbPath,
          (workbench) => workbench.entityView(entityId),
          { readonly: true, fallbackToWritable: true },
        ),
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
  options?: {
    refreshDerivedState?: boolean;
    readonly?: boolean;
    fallbackToWritable?: boolean;
  },
): Promise<T> {
  if (options?.readonly) {
    try {
      return await withOpenedWorkbench(dbPath, action, {
        readonly: true,
        initialize: false,
      });
    } catch (error) {
      if (!options.fallbackToWritable || !shouldFallbackToWritableWorkbench(error)) throw error;
    }
  }
  return await withOpenedWorkbench(dbPath, action, {
    readonly: false,
    initialize: true,
    refreshDerivedState: options?.refreshDerivedState,
  });
}

async function withOpenedWorkbench<T>(
  dbPath: string,
  action: (workbench: Workbench, meta: ReturnType<Workbench["init"]>) => T | Promise<T>,
  options: {
    readonly: boolean;
    initialize: boolean;
    refreshDerivedState?: boolean;
  },
): Promise<T> {
  const workbench = new Workbench(dbPath, { readonly: options.readonly });
  try {
    const meta = options.initialize
      ? workbench.init({
        refreshDerivedState: options.refreshDerivedState,
      })
      : workbench.meta();
    return await action(workbench, meta);
  } finally {
    workbench.close();
  }
}

function shouldFallbackToWritableWorkbench(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("unable to open database file") ||
    error.message.includes("no such table:");
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
  Fetch:   ${dcCommand("source list")} | ${dcCommand("source fetch --all")} | ${
    dcCommand("source fetch dcgis.agencies")
  }
  Audit:   ${dcCommand("audit")} | ${dcCommand("status --json")} | ${
    dcCommand("source inspect dcgis.agencies")
  }
  Review:  ${dcCommand("review")} | ${dcCommand("review list --mode entities")}
  Release: ${dcCommand("release build")} | ${dcCommand("release inspect")}

Usage:
  ${dcCommand("init")} [--db <path>]
  ${dcCommand("audit")} [status|doctor] [--db <path>] [--json]
  ${dcCommand("status")} [--db <path>] [--json]
  ${dcCommand("doctor")} [--db <path>] [--json]
  ${dcCommand("source list")} [--db <path>] [--json]
  ${dcCommand("source fetch <source-id>")} [--db <path>] [--data-dir <path>] [--limit <n>]
  ${dcCommand("source fetch --all")} [--db <path>] [--data-dir <path>] [--limit <n>]
  ${dcCommand("source inspect <source-id>")} [--db <path>] [--json]
  ${dcCommand("source compare public-bodies")} [--db <path>] [--json]
  ${
    dcCommand("review")
  } [entities|relationships|legal|sources] [--db <path>] [--resolutions-dir <path>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>]
  ${
    dcCommand("review list")
  } [--mode <mode>] [--status <open|deferred|resolved|all>] [--type <type>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--limit <n>] [--json]
  ${
    dcCommand("review batch accept-safe")
  } [--mode <mode>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  ${
    dcCommand("review batch defer")
  } --mode <mode> --subject-prefix <prefix> [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  ${
    dcCommand("review batch defer-default")
  } --mode <mode> --subject-prefix <prefix> [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  ${dcCommand("entity search <query>")} [--db <path>] [--json]
  ${dcCommand("entity show <entity-id>")} [--db <path>] [--json]
  ${dcCommand("release build")} [--db <path>] [--out <dir>]
  ${dcCommand("release inspect")} [--out <dir>] [--json]

Defaults:
  workbench db: data/workbench.sqlite
  source artifacts: data/v2_artifacts
  resolutions: resolutions/
  release output: releases/latest
`);
}
