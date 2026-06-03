import { join } from "@std/path";
import { handleAuditCommand } from "./cli_audit.ts";
import { handleSourceCommand } from "./cli_source.ts";
import { buildV2Release } from "./release.ts";
import { connectors, createConnectorContext, getConnector } from "./connectors.ts";
import {
  buildReleaseInspection,
  buildWorkbenchStatus,
  type ReleaseManifest,
  renderReleaseInspection,
} from "./status.ts";
import {
  renderEntityView,
  renderReviewItemSummary,
  runBatchAcceptSafe,
  runBatchDefer,
  runBatchDeferDefault,
  runInteractiveReview,
} from "./workbench/review_cli.ts";
import { Workbench } from "./workbench.ts";
import type { ReviewItemFilters } from "./workbench/review.ts";

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
  if (args[0] === "review" && isHelp(args[1])) {
    printReviewHelp();
    return true;
  }
  if (args[0] === "entity" && isHelp(args[1])) {
    printEntityHelp();
    return true;
  }
  if (args[0] === "release" && isHelp(args[1])) {
    printReleaseHelp();
    return true;
  }
  if (args[0] === "workbench" && args[1] === "init") {
    const meta = await withWorkbench(dbPath, (_workbench, meta) => meta, {
      refreshDerivedState: false,
    });
    console.log(`Initialized v2 workbench: ${dbPath}`);
    console.log(`Schema version: ${meta.schemaVersion}`);
    return true;
  }
  if (args[0] === "review" && (!args[1] || args[1].startsWith("--"))) {
    await withWorkbench(dbPath, async (workbench) => {
      await runInteractiveReview(workbench, readReviewFilters(args), resolutionsDir);
    });
    return true;
  }
  if (args[0] === "review" && args[1] === "list") {
    const { items, summaries } = await withWorkbench(
      dbPath,
      (workbench) => {
        const items = workbench.listReviewItems(readReviewFilters(args));
        return {
          items,
          summaries: items.map((item) => renderReviewItemSummary(workbench, item)),
        };
      },
    );
    if (args.includes("--json")) {
      console.log(JSON.stringify({ count: items.length, items }, null, 2));
      return true;
    }
    console.log(`Review items: ${items.length}`);
    for (const summary of summaries) {
      console.log(summary);
      console.log("");
    }
    return true;
  }
  if (args[0] === "review" && args[1] === "batch" && args[2] === "accept-safe") {
    await withWorkbench(dbPath, async (workbench) => {
      await runBatchAcceptSafe(workbench, readReviewFilters(args), resolutionsDir);
    });
    return true;
  }
  if (args[0] === "review" && args[1] === "batch" && args[2] === "defer") {
    await withWorkbench(dbPath, async (workbench) => {
      await runBatchDefer(workbench, readReviewFilters(args), resolutionsDir);
    });
    return true;
  }
  if (args[0] === "review" && args[1] === "batch" && args[2] === "defer-default") {
    await withWorkbench(dbPath, async (workbench) => {
      await runBatchDeferDefault(workbench, readReviewFilters(args), resolutionsDir);
    });
    return true;
  }
  if (
    args[0] === "review" && args[1] &&
    ["entities", "relationships", "legal", "sources"].includes(args[1])
  ) {
    await withWorkbench(dbPath, async (workbench) => {
      await runInteractiveReview(
        workbench,
        { ...readReviewFilters(args), mode: args[1] },
        resolutionsDir,
      );
    });
    return true;
  }
  if (args[0] === "entity" && args[1] === "search" && args[2]) {
    const rows = await withWorkbench(
      dbPath,
      (workbench) => workbench.searchEntities(readFreeTextArgument(args, 2)),
    );
    if (args.includes("--json")) {
      console.log(JSON.stringify(rows, null, 2));
      return true;
    }
    for (const row of rows) {
      const placeholderTag = row.isPlaceholder ? " placeholder" : "";
      console.log(`${row.entityId} ${row.name} [${row.kind}] ${row.reviewStatus}${placeholderTag}`);
    }
    return true;
  }
  if (args[0] === "entity" && args[1] === "show" && args[2]) {
    const view = await withWorkbench(dbPath, (workbench) => workbench.entityView(args[2]));
    if (args.includes("--json")) {
      console.log(JSON.stringify(view, null, 2));
      return true;
    }
    console.log(renderEntityView(view));
    return true;
  }
  if (args[0] === "release" && args[1] === "build") {
    const result = await withWorkbench(
      dbPath,
      async (workbench) => await buildV2Release(workbench, outDir),
    );
    console.log(`Built v2 release ${result.outDir}`);
    return true;
  }
  if (args[0] === "release" && args[1] === "inspect") {
    const manifest = JSON.parse(
      await Deno.readTextFile(join(outDir, "manifest.json")),
    ) as ReleaseManifest;
    if (args.includes("--json")) {
      console.log(JSON.stringify(buildReleaseInspection(outDir, manifest), null, 2));
      return true;
    }
    console.log(renderReleaseInspection(outDir, manifest));
    return true;
  }
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

function isHelp(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}

function readNumberFlag(args: string[], flag: string): number | undefined {
  const value = readFlag(args, flag);
  return value ? Number(value) : undefined;
}

function readReviewFilters(args: string[]): ReviewItemFilters {
  const modeFlag = readFlag(args, "--mode");
  const statusFlag = readFlag(args, "--status");
  const typeFlag = readFlag(args, "--type");
  const subjectPrefix = readFlag(args, "--subject-prefix");
  const relationshipType = readFlag(args, "--relationship-type");
  const rawValue = readFlag(args, "--raw-value");
  const rawValueContains = readFlag(args, "--raw-value-contains");
  const refType = readFlag(args, "--ref-type");
  const limit = readNumberFlag(args, "--limit");
  const positionalMode = ["entities", "relationships", "legal", "sources"].includes(args[1])
    ? args[1]
    : undefined;
  return {
    mode: modeFlag ?? positionalMode,
    status: statusFlag as ReviewItemFilters["status"] | undefined,
    type: typeFlag as ReviewItemFilters["type"] | undefined,
    subjectPrefix: subjectPrefix ?? undefined,
    relationshipType: relationshipType ?? undefined,
    rawValue: rawValue ?? undefined,
    rawValueContains: rawValueContains ?? undefined,
    refType: refType ?? undefined,
    limit,
  };
}

function readFreeTextArgument(args: string[], startIndex: number): string {
  const values: string[] = [];
  for (let index = startIndex; index < args.length; index += 1) {
    if (args[index].startsWith("--")) break;
    values.push(args[index]);
  }
  return values.join(" ");
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

function printReviewHelp(): void {
  console.log(`dc review

Usage:
  dc review [entities|relationships|legal|sources] [--db <path>] [--resolutions-dir <path>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>]
  dc review list [--mode <mode>] [--status <open|deferred|resolved|all>] [--type <type>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--limit <n>] [--json]
  dc review batch accept-safe [--mode <mode>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  dc review batch defer --mode <mode> --subject-prefix <prefix> [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  dc review batch defer-default --mode <mode> --subject-prefix <prefix> [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]

Interactive actions:
  Enter runs the default action for the current item.
  a accepts, r rejects, d defers, q quits, m merges entity candidates, e edits a relationship type.
`);
}

function printEntityHelp(): void {
  console.log(`dc entity

Usage:
  dc entity search <query> [--db <path>] [--json]
  dc entity show <entity-id> [--db <path>] [--json]
`);
}

function printReleaseHelp(): void {
  console.log(`dc release

Usage:
  dc release build [--db <path>] [--out <dir>]
  dc release inspect [--out <dir>] [--json]

Release files:
  README.md, manifest.json, dcgov.sqlite, entities.*, relationships.*, sources.*, datasets.*, legal_refs.*
`);
}
