import { join } from "@std/path";
import { buildV2Release } from "./release.ts";
import { createConnectorContext, getConnector } from "./connectors.ts";
import { EntityView, ResolutionEventInput, ReviewItemRecord } from "./domain.ts";
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
      console.log(`${row.entityId} ${row.name} [${row.kind}] ${row.reviewStatus}`);
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

async function runInteractiveReview(
  workbench: Workbench,
  mode: string | undefined,
  resolutionsDir: string,
): Promise<void> {
  const encoder = new TextEncoder();
  while (true) {
    const item = workbench.nextReviewItem(mode);
    if (!item) {
      console.log("No review items remain.");
      return;
    }
    console.log(renderReviewItem(item));
    const action = await promptLine("Action [a/r/m/d/q/e]: ");
    if (!action || action === "q") {
      console.log("Review stopped without corrupting state.");
      return;
    }
    const event = await actionToEvent(item, action);
    if (!event) continue;
    await workbench.appendResolutionEvent(event, resolutionsDir);
    await Deno.stdout.write(encoder.encode("Saved resolution.\n"));
  }
}

async function actionToEvent(
  item: ReviewItemRecord,
  action: string,
): Promise<ResolutionEventInput | undefined> {
  if (item.itemType === "entity_candidate") {
    if (action === "a") {
      return { eventType: "accept_entity_candidate", subjectId: item.subjectId, payload: {} };
    }
    if (action === "r") {
      return { eventType: "reject_entity_candidate", subjectId: item.subjectId, payload: {} };
    }
    if (action === "m") {
      const entityId = await promptLine("Merge into entity id: ");
      return {
        eventType: "merge_entity_candidates",
        subjectId: item.subjectId,
        payload: { entityId, candidateIds: [item.subjectId] },
      };
    }
  }
  if (item.itemType === "relationship_candidate") {
    if (action === "a") {
      return { eventType: "accept_relationship_candidate", subjectId: item.subjectId, payload: {} };
    }
    if (action === "e") {
      const relationshipType = await promptLine("Relationship type: ");
      return {
        eventType: "accept_relationship_candidate",
        subjectId: item.subjectId,
        payload: { relationshipType },
      };
    }
    if (action === "r") {
      return { eventType: "reject_relationship_candidate", subjectId: item.subjectId, payload: {} };
    }
  }
  if (action === "d") {
    return { eventType: "defer_review_item", subjectId: item.reviewItemId, payload: {} };
  }
  return undefined;
}

async function promptLine(promptText: string): Promise<string> {
  await Deno.stdout.write(new TextEncoder().encode(promptText));
  while (!stdinBuffer.includes("\n")) {
    const buffer = new Uint8Array(1024);
    const read = await Deno.stdin.read(buffer);
    if (read === null) break;
    stdinBuffer += new TextDecoder().decode(buffer.subarray(0, read));
  }
  const newlineIndex = stdinBuffer.indexOf("\n");
  if (newlineIndex === -1) {
    const remaining = stdinBuffer.trim();
    stdinBuffer = "";
    return remaining;
  }
  const line = stdinBuffer.slice(0, newlineIndex).trim();
  stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
  return line;
}

export function renderReviewItem(item: ReviewItemRecord): string {
  return [
    `Review item: ${item.reviewItemId}`,
    `type: ${item.itemType}`,
    `subject: ${item.subjectId}`,
    `status: ${item.status}`,
    `reason: ${item.reason}`,
    `default: ${item.defaultAction}`,
  ].join("\n");
}

export function renderEntityView(view: EntityView): string {
  const lines = [
    `${view.name} (${view.kind})`,
    `id: ${view.entityId}`,
    `review: ${view.reviewStatus}`,
  ];
  if (view.branch) lines.push(`branch: ${view.branch}`);
  if (view.cluster) lines.push(`cluster: ${view.cluster}`);
  if (view.officialUrl) lines.push(`official_url: ${view.officialUrl}`);
  lines.push("evidence:");
  for (const evidence of view.evidence.slice(0, 10)) {
    lines.push(`- ${evidence.fieldPath} <- ${evidence.observedValue} [${evidence.sourceId}]`);
  }
  lines.push("outgoing:");
  for (const relationship of view.outgoing) {
    lines.push(
      `- ${relationship.relationshipType} -> ${relationship.targetEntityId} (${relationship.targetName})`,
    );
  }
  lines.push("incoming:");
  for (const relationship of view.incoming) {
    lines.push(
      `- ${relationship.relationshipType} <- ${relationship.sourceEntityId} (${relationship.sourceName})`,
    );
  }
  if (view.legalRefs.length > 0) {
    lines.push("legal_refs:");
    for (const legalRef of view.legalRefs) {
      lines.push(`- ${legalRef.refType}: ${legalRef.normalizedCitation ?? legalRef.citationText}`);
    }
  }
  if (view.reviewItems.length > 0) {
    lines.push("open_review:");
    for (const item of view.reviewItems) {
      lines.push(`- ${item.itemType}: ${item.reason}`);
    }
  }
  return lines.join("\n");
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

let stdinBuffer = "";
