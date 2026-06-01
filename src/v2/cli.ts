import { join } from "@std/path";
import { buildV2Release } from "./release.ts";
import { connectors, createConnectorContext, getConnector } from "./connectors.ts";
import {
  renderEntityView,
  renderReviewItemSummary,
  runBatchAcceptSafe,
  runInteractiveReview,
} from "./workbench/review_cli.ts";
import { Workbench } from "./workbench.ts";
import type { ReviewItemFilters } from "./workbench/review.ts";

interface ReleaseManifest {
  generated_at?: string;
  files?: Array<{ name: string }>;
  release_summary?: {
    entities_by_review_status?: Array<{ review_status: string; count: number }>;
    relationships_by_review_status?: Array<{ review_status: string; count: number }>;
    legal_refs_by_type?: Array<{ ref_type: string; count: number }>;
    legal_refs_by_review_status?: Array<{ review_status: string; count: number }>;
    source_count?: number;
    failed_source_count?: number;
    dataset_count?: number;
  };
}

interface WorkbenchStatusSnapshot {
  sources: {
    fetched: number;
    failed: number;
    total: number;
    firstFailedSourceId?: string;
  };
  review: {
    open: number;
    deferred: number;
  };
  canonical: {
    entities: number;
    relationships: number;
  };
  nextCommand: string;
}

export async function handleV2Command(args: string[]): Promise<boolean> {
  if (args.length === 0) return false;
  const dbPath = readFlag(args, "--db") ?? join(Deno.cwd(), "data", "workbench.sqlite");
  const dataDir = readFlag(args, "--data-dir") ?? join(Deno.cwd(), "data", "v2_artifacts");
  const outDir = readFlag(args, "--out") ?? join(Deno.cwd(), "releases", "latest");
  const resolutionsDir = readFlag(args, "--resolutions-dir") ?? join(Deno.cwd(), "resolutions");
  const limit = readNumberFlag(args, "--limit");
  if (args[0] === "source" && isHelp(args[1])) {
    printSourceHelp();
    return true;
  }
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
    const meta = await withWorkbench(dbPath, (_workbench, meta) => meta);
    console.log(`Initialized v2 workbench: ${dbPath}`);
    console.log(`Schema version: ${meta.schemaVersion}`);
    return true;
  }
  if (args[0] === "workbench" && args[1] === "status") {
    const { meta, status } = await withWorkbench(dbPath, (workbench, meta) => ({
      meta,
      status: buildWorkbenchStatus(workbench),
    }));
    if (args.includes("--json")) {
      console.log(JSON.stringify({ ...meta, ...status }, null, 2));
      return true;
    }
    console.log(`DB: ${meta.dbPath}`);
    console.log(`Schema version: ${meta.schemaVersion}`);
    for (const migration of meta.migrations) {
      console.log(`- ${migration.version} ${migration.name} (${migration.appliedAt})`);
    }
    console.log(renderWorkbenchStatus(status));
    return true;
  }
  if (args[0] === "source" && args[1] === "fetch" && args[2]) {
    const connector = getConnector(args[2]);
    const result = await connector.run(createConnectorContext({ limit }));
    await withWorkbench(dbPath, async (workbench) => {
      await workbench.importConnectorResult(result, dataDir);
    });
    const statuses = result.endpointResults.map((item) =>
      `${item.endpoint.endpointId}:${item.status}`
    ).join(", ");
    console.log(`Fetched ${connector.sourceId}`);
    console.log(statuses);
    return true;
  }
  if (args[0] === "source" && args[1] === "inspect" && args[2]) {
    const summary = await withWorkbench(
      dbPath,
      (workbench) => sourceSummaryOrConfigured(workbench, args[2]),
    );
    if (args.includes("--json")) {
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
  if (args[0] === "source" && args[1] === "list") {
    const rowsBySourceId = await withWorkbench(
      dbPath,
      (workbench) => new Map(workbench.listSources().map((row) => [row.sourceId, row])),
    );
    const sourceRows = connectors.map((connector) => {
      const row = rowsBySourceId.get(connector.sourceId);
      return {
        sourceId: connector.sourceId,
        title: connector.source.title,
        status: row?.latestStatus ?? "unfetched",
        latestRunFinishedAt: row?.latestRunFinishedAt,
      };
    });
    if (args.includes("--json")) {
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
  if (args[0] === "review" && (!args[1] || args[1].startsWith("--"))) {
    await withWorkbench(dbPath, async (workbench) => {
      await runInteractiveReview(workbench, readReviewFilters(args), resolutionsDir);
    });
    return true;
  }
  if (args[0] === "review" && args[1] === "list") {
    const items = await withWorkbench(
      dbPath,
      (workbench) => workbench.listReviewItems(readReviewFilters(args)),
    );
    if (args.includes("--json")) {
      console.log(JSON.stringify({ count: items.length, items }, null, 2));
      return true;
    }
    console.log(`Review items: ${items.length}`);
    for (const item of items) {
      console.log(renderReviewItemSummary(item));
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
): Promise<T> {
  const workbench = new Workbench(dbPath);
  try {
    const meta = workbench.init();
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
  const positionalMode = ["entities", "relationships", "legal", "sources"].includes(args[1])
    ? args[1]
    : undefined;
  return {
    mode: modeFlag ?? positionalMode,
    status: statusFlag as ReviewItemFilters["status"] | undefined,
    type: typeFlag as ReviewItemFilters["type"] | undefined,
    subjectPrefix: subjectPrefix ?? undefined,
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

function buildWorkbenchStatus(workbench: Workbench): WorkbenchStatusSnapshot {
  const sourceRows = workbench.listSources();
  const fetchedSources = sourceRows.filter((row) => row.latestStatus).length;
  const failedSource = sourceRows.find((row) => row.latestStatus === "failed");
  const failedSources = sourceRows.filter((row) => row.latestStatus === "failed").length;
  const openReview = workbench.listReviewItems({ status: "open" }).length;
  const deferredReview = workbench.listReviewItems({ status: "deferred" }).length;
  const entities = workbench.canonicalEntities().length;
  const relationships = workbench.canonicalRelationships().length;
  const next = nextCommand({
    fetchedSources,
    failedSourceId: failedSource?.sourceId,
    openReview,
  });
  return {
    sources: {
      fetched: fetchedSources,
      failed: failedSources,
      total: connectors.length,
      firstFailedSourceId: failedSource?.sourceId,
    },
    review: {
      open: openReview,
      deferred: deferredReview,
    },
    canonical: {
      entities,
      relationships,
    },
    nextCommand: next,
  };
}

function renderWorkbenchStatus(status: WorkbenchStatusSnapshot): string {
  return [
    "",
    `Sources: ${status.sources.fetched}/${status.sources.total} fetched${
      status.sources.failed > 0 ? `, ${status.sources.failed} failed` : ""
    }`,
    `Review: ${status.review.open} open, ${status.review.deferred} deferred`,
    `Canonical: ${status.canonical.entities} entities, ${status.canonical.relationships} relationships`,
    `Next: ${status.nextCommand}`,
  ].join("\n");
}

function nextCommand(options: {
  fetchedSources: number;
  failedSourceId?: string;
  openReview: number;
}): string {
  if (options.failedSourceId) return `dc source inspect ${options.failedSourceId}`;
  if (options.openReview > 0) return "dc review";
  if (options.fetchedSources < connectors.length) return "dc source list";
  return "dc release build";
}

function renderReleaseInspection(outDir: string, manifest: ReleaseManifest): string {
  const inspection = buildReleaseInspection(outDir, manifest);
  const summary = inspection.releaseSummary;
  return [
    `Release: ${inspection.outDir}`,
    `Generated: ${inspection.generatedAt}`,
    `Files: ${inspection.fileCount}`,
    `Entities: ${renderReviewStatusCounts(summary.entities_by_review_status ?? [])}`,
    `Relationships: ${renderReviewStatusCounts(summary.relationships_by_review_status ?? [])}`,
    `Sources: total=${summary.source_count ?? 0}, failed=${summary.failed_source_count ?? 0}`,
    `Datasets: total=${summary.dataset_count ?? 0}`,
    `Legal refs: ${renderNamedCounts(summary.legal_refs_by_type ?? [], "ref_type")}`,
    `Legal refs by review: ${renderReviewStatusCounts(summary.legal_refs_by_review_status ?? [])}`,
  ].join("\n");
}

function buildReleaseInspection(outDir: string, manifest: ReleaseManifest): {
  outDir: string;
  generatedAt: string;
  fileCount: number;
  releaseSummary: NonNullable<ReleaseManifest["release_summary"]>;
} {
  return {
    outDir,
    generatedAt: manifest.generated_at ?? "unknown",
    fileCount: (manifest.files?.length ?? 0) + 1,
    releaseSummary: manifest.release_summary ?? {},
  };
}

function renderReviewStatusCounts(rows: Array<{ review_status: string; count: number }>): string {
  return rows.map((row) => `${row.review_status}=${row.count}`).join(", ") || "none";
}

function renderNamedCounts<T extends string>(
  rows: Array<Record<T, string> & { count: number }>,
  nameKey: T,
): string {
  return rows.map((row) => `${row[nameKey]}=${row.count}`).join(", ") || "none";
}

export function printHelp(): void {
  console.log(`dc civic-data workbench

Usage:
  dc init [--db <path>]
  dc status [--db <path>] [--json]
  dc doctor [--db <path>]
  dc source list [--db <path>] [--json]
  dc source fetch <source-id> [--db <path>] [--data-dir <path>] [--limit <n>]
  dc source inspect <source-id> [--db <path>] [--json]
  dc review [entities|relationships|legal|sources] [--db <path>] [--resolutions-dir <path>]
  dc review list [--mode <mode>] [--status <open|deferred|resolved|all>] [--type <type>] [--json]
  dc review batch accept-safe [--mode <mode>] [--db <path>] [--resolutions-dir <path>]
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
  dc review [entities|relationships|legal|sources] [--db <path>] [--resolutions-dir <path>]
  dc review list [--mode <mode>] [--status <open|deferred|resolved|all>] [--type <type>] [--json]
  dc review batch accept-safe [--mode <mode>] [--db <path>] [--resolutions-dir <path>]

Interactive actions:
  Enter runs the default action for the current item.
  a accepts, r rejects, d defers, q quits, m merges entity candidates, e edits a relationship type.
`);
}

function printSourceHelp(): void {
  console.log(`dc source

Usage:
  dc source list [--db <path>] [--json]
  dc source fetch <source-id> [--db <path>] [--data-dir <path>] [--limit <n>]
  dc source inspect <source-id> [--db <path>] [--json]
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
