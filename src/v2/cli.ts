import { join } from "@std/path";
import { handleAuditCommand } from "./cli_audit.ts";
import { dcCommand } from "./command_prefix.ts";
import { handleEntityCommand } from "./cli_entity.ts";
import { handleReleaseCommand } from "./cli_release.ts";
import { handleReviewCommand } from "./cli_review.ts";
import { handleSmokeCommand } from "./cli_smoke.ts";
import { handleSourceCommand } from "./cli_source.ts";
import { handleWorkbenchCommand } from "./cli_workbench.ts";
import { fetchSources } from "./cli_source.ts";
import { connectors, createConnectorContext, getConnector } from "./connectors.ts";
import { buildWorkbenchStatus } from "./status.ts";
import { Workbench } from "./workbench.ts";

export async function handleV2Command(args: string[]): Promise<boolean> {
  if (args.length === 0) return false;
  const explicitDbPath = readFlag(args, "--db");
  const explicitResolutionsDir = readFlag(args, "--resolutions-dir");
  const dbPath = explicitDbPath ?? join(Deno.cwd(), "data", "workbench.sqlite");
  const dataDir = readFlag(args, "--data-dir") ?? join(Deno.cwd(), "data", "v2_artifacts");
  const outDir = readFlag(args, "--out") ?? readFlag(args, "--output") ??
    join(Deno.cwd(), "releases", "latest");
  const resolutionsDir = explicitResolutionsDir ?? join(Deno.cwd(), "resolutions");
  const limit = readNumberFlag(args, "--limit");
  const sourceProfile = readFlag(args, "--source-profile") as
    | "structure"
    | "tier0"
    | "inventory"
    | "custom"
    | undefined;
  const sourceHandled = await handleSourceCommand(
    args,
    { json: args.includes("--json"), limit, dbPath },
    {
      connectors,
      getConnector,
      createConnectorContext,
      importConnectorResult: async (result, options) =>
        await withWorkbench(
          dbPath,
          async (workbench) => {
            await workbench.importConnectorResult(result, dataDir, options);
          },
          { refreshDerivedState: false },
        ),
      readSourceSummary: async (sourceId) =>
        await withWorkbench(
          dbPath,
          (workbench) => workbench.sourceSummary(sourceId),
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
    },
  );
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
    {
      dbPath,
      json: args.includes("--json"),
      resolutionsDir,
    },
    {
      withWorkbench: async (action) => await withWorkbench(dbPath, action),
      withInteractiveWorkbench: async (action) =>
        await withWorkbench(dbPath, action, {
          refreshDerivedState: false,
        }),
      withReadonlyWorkbench: async (action) =>
        await withWorkbench(dbPath, action, {
          readonly: true,
          fallbackToWritable: true,
        }),
    },
  );
  if (reviewHandled) return true;
  const smokeHandled = await handleSmokeCommand(
    args,
    { json: args.includes("--json"), limit },
    {
      connectors,
      makeTempDir: async () => await Deno.makeTempDir({ prefix: "dc-smoke-" }),
      fetchSources: async (sourceIds, smokeOptions, paths) =>
        await fetchSources(sourceIds, { limit: smokeOptions.limit }, {
          getConnector,
          createConnectorContext: ({ limit, onProgress }) =>
            createConnectorContext({ limit, onProgress }),
          importConnectorResult: async (result, options) =>
            await withWorkbench(
              paths.dbPath,
              async (workbench) => {
                await workbench.importConnectorResult(result, paths.dataDir, options);
              },
              { refreshDerivedState: false },
            ),
        }, smokeOptions.onProgress),
      readWorkbenchStatus: async (paths) =>
        await withWorkbench(
          paths.dbPath,
          (workbench) => buildWorkbenchStatus(workbench),
          { readonly: true, fallbackToWritable: true },
        ),
    },
  );
  if (smokeHandled) return true;
  const releaseHandled = await handleReleaseCommand(
    args,
    { json: args.includes("--json"), outDir, dbPath, sourceProfile },
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
    { dbPath, json: args.includes("--json") },
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
  Smoke:   ${dcCommand("smoke tier0")} | ${dcCommand("smoke structure")}
  Audit:   ${dcCommand("audit")} | ${dcCommand("status --json")} | ${
    dcCommand("source inspect dcgis.agencies")
  }
  Browse:  ${dcCommand("entity search accountancy")} | ${dcCommand("review list --status all")}
  Decide:  ${dcCommand("review")} | ${dcCommand("review packets --mode relationships")}
  Release: ${dcCommand("release verify")} | ${dcCommand("release build")} | ${
    dcCommand("release inspect")
  }

Usage:
  ${dcCommand("init")} [--db <path>]
  ${dcCommand("audit")} [--db <path>] [--json]
  ${dcCommand("status")} [--db <path>] [--json]
  ${dcCommand("source list")} [--db <path>] [--json]
  ${dcCommand("source fetch <source-id>")} [--db <path>] [--data-dir <path>] [--limit <n>] [--json]
  ${dcCommand("source fetch --all")} [--db <path>] [--data-dir <path>] [--limit <n>] [--json]
  ${dcCommand("source inspect <source-id>")} [--db <path>] [--json]
  ${dcCommand("source compare public-bodies")} [--db <path>] [--json]
  ${dcCommand("smoke <structure|tier0|inventory>")} [--limit <n>] [--json]
  ${
    dcCommand("review")
  } [entities|relationships|legal|sources] [--db <path>] [--resolutions-dir <path>] [--source <source-id>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>]
  ${
    dcCommand("review list")
  } [--mode <mode>] [--status <open|deferred|resolved|all>] [--type <type>] [--source <source-id>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--limit <n>] [--decisions] [--json]
  ${
    dcCommand("review packets")
  } [--mode <mode>] [--status <open|deferred|resolved|all>] [--type <type>] [--source <source-id>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--limit <n>] [--json] [--include-review-item-ids]
  ${
    dcCommand("review batch accept-safe")
  } [--mode <mode>] [--source <source-id>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  ${
    dcCommand("review batch defer-default")
  } --mode <mode> --subject-prefix <prefix> [--source <source-id>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  ${dcCommand("entity search <query>")} [--db <path>] [--json]
  ${dcCommand("entity show <entity-id>")} [--db <path>] [--json]
  ${
    dcCommand("release build")
  } [--db <path>] [--out|--output <dir>] [--source-profile <structure|tier0|inventory|custom>] [--json]
  ${dcCommand("release verify")} [--db <path>] [--json]
  ${dcCommand("release inspect")} [--out|--output <dir>] [--json]

Defaults:
  workbench db: data/workbench.sqlite
  source artifacts: data/v2_artifacts
  resolutions: resolutions/
  release output: releases/latest
`);
}
