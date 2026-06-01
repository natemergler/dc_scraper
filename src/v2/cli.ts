import { join } from "@std/path";
import { buildV2Release } from "./release.ts";
import { createConnectorContext, getConnector } from "./connectors.ts";
import { renderEntityView, runInteractiveReview } from "./workbench/review_cli.ts";
import { Workbench } from "./workbench.ts";

export async function handleV2Command(args: string[]): Promise<boolean> {
  if (args.length === 0) return false;
  const dbPath = readFlag(args, "--db") ?? join(Deno.cwd(), "data", "workbench.sqlite");
  const dataDir = readFlag(args, "--data-dir") ?? join(Deno.cwd(), "data", "v2_artifacts");
  const outDir = readFlag(args, "--out") ?? join(Deno.cwd(), "releases", "latest");
  const resolutionsDir = readFlag(args, "--resolutions-dir") ?? join(Deno.cwd(), "resolutions");
  const limit = readNumberFlag(args, "--limit");
  if (args[0] === "workbench" && args[1] === "init") {
    const workbench = new Workbench(dbPath);
    const meta = workbench.init();
    workbench.close();
    console.log(`Initialized v2 workbench: ${dbPath}`);
    console.log(`Schema version: ${meta.schemaVersion}`);
    return true;
  }
  if (args[0] === "workbench" && args[1] === "status") {
    const workbench = new Workbench(dbPath);
    const meta = workbench.init();
    workbench.close();
    console.log(`DB: ${meta.dbPath}`);
    console.log(`Schema version: ${meta.schemaVersion}`);
    for (const migration of meta.migrations) {
      console.log(`- ${migration.version} ${migration.name} (${migration.appliedAt})`);
    }
    return true;
  }
  if (args[0] === "source" && args[1] === "fetch" && args[2]) {
    const connector = getConnector(args[2]);
    const workbench = new Workbench(dbPath);
    workbench.init();
    const result = await connector.run(createConnectorContext({ limit }));
    await workbench.importConnectorResult(result, dataDir);
    workbench.close();
    const statuses = result.endpointResults.map((item) =>
      `${item.endpoint.endpointId}:${item.status}`
    ).join(", ");
    console.log(`Fetched ${connector.sourceId}`);
    console.log(statuses);
    return true;
  }
  if (args[0] === "source" && args[1] === "inspect" && args[2]) {
    const workbench = new Workbench(dbPath);
    workbench.init();
    const summary = workbench.sourceSummary(args[2]);
    workbench.close();
    console.log(`${summary.sourceId} - ${summary.title}`);
    console.log(`Latest status: ${summary.latestStatus ?? "none"}`);
    console.log(`Latest run: ${summary.latestRunFinishedAt ?? "n/a"}`);
    console.log(`Latest artifact: ${summary.latestArtifactPath ?? "n/a"}`);
    console.log(
      `Counts: items=${summary.itemCount} fields=${summary.fieldCount} entity_candidates=${summary.entityCandidateCount} relationship_candidates=${summary.relationshipCandidateCount}`,
    );
    return true;
  }
  if (args[0] === "source" && args[1] === "list") {
    const workbench = new Workbench(dbPath);
    workbench.init();
    const rows = workbench.listSources();
    workbench.close();
    for (const row of rows) {
      console.log(
        `${row.sourceId} ${row.latestStatus ?? "unfetched"}${
          row.latestRunFinishedAt ? ` ${row.latestRunFinishedAt}` : ""
        }`,
      );
    }
    return true;
  }
  if (args[0] === "review" && (!args[1] || args[1].startsWith("--"))) {
    const workbench = new Workbench(dbPath);
    workbench.init();
    await runInteractiveReview(workbench, undefined, resolutionsDir);
    workbench.close();
    return true;
  }
  if (
    args[0] === "review" && args[1] &&
    ["entities", "relationships", "legal", "sources"].includes(args[1])
  ) {
    const workbench = new Workbench(dbPath);
    workbench.init();
    await runInteractiveReview(workbench, args[1], resolutionsDir);
    workbench.close();
    return true;
  }
  if (args[0] === "entity" && args[1] === "search" && args[2]) {
    const workbench = new Workbench(dbPath);
    workbench.init();
    const rows = workbench.searchEntities(readFreeTextArgument(args, 2));
    workbench.close();
    for (const row of rows) {
      const placeholderTag = row.isPlaceholder ? " placeholder" : "";
      console.log(`${row.entityId} ${row.name} [${row.kind}] ${row.reviewStatus}${placeholderTag}`);
    }
    return true;
  }
  if (args[0] === "entity" && args[1] === "show" && args[2]) {
    const workbench = new Workbench(dbPath);
    workbench.init();
    const view = workbench.entityView(args[2]);
    workbench.close();
    console.log(renderEntityView(view));
    return true;
  }
  if (args[0] === "release" && args[1] === "build" && readFlag(args, "--db")) {
    const workbench = new Workbench(dbPath);
    workbench.init();
    const result = await buildV2Release(workbench, outDir);
    workbench.close();
    console.log(`Built v2 release ${result.outDir}`);
    return true;
  }
  return false;
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

function readFreeTextArgument(args: string[], startIndex: number): string {
  const values: string[] = [];
  for (let index = startIndex; index < args.length; index += 1) {
    if (args[index].startsWith("--")) break;
    values.push(args[index]);
  }
  return values.join(" ");
}
