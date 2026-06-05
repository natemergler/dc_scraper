import { dcCommand } from "./command_prefix.ts";
import type { EntitySearchResult, EntityView, ReviewItemRecord } from "./domain.ts";

export interface EntityCommandOptions {
  dbPath?: string;
  json?: boolean;
}

export interface EntityCommandDeps {
  searchEntities(query: string): Promise<EntitySearchResult[]>;
  entityView(entityId: string): Promise<EntityView>;
}

export async function handleEntityCommand(
  args: string[],
  options: EntityCommandOptions,
  deps: EntityCommandDeps,
): Promise<boolean> {
  if (args[0] !== "entity") return false;
  if (!args[1] || args[1].startsWith("--") || isHelp(args[1])) {
    printEntityHelp();
    return true;
  }
  if (args[1] === "search") {
    if (!args[2] || args[2].startsWith("--") || hasHelpFlag(args, 2)) {
      printEntityHelp([`run \`${dcCommand("entity search District")}\` to look up a body by name`]);
      return true;
    }
    const rows = await deps.searchEntities(readFreeTextArgument(args, 2));
    if (options.json) {
      console.log(
        JSON.stringify(rows.map((row) => entitySearchJsonRecord(row, options.dbPath)), null, 2),
      );
      return true;
    }
    for (const row of rows) {
      const placeholderTag = row.isPlaceholder ? " placeholder" : "";
      console.log(`${row.entityId} ${row.name} [${row.kind}] ${row.reviewStatus}${placeholderTag}`);
      console.log(`  Show: ${entityShowCommand(row.entityId, options.dbPath)}`);
    }
    return true;
  }
  if (args[1] === "show") {
    if (!args[2] || args[2].startsWith("--") || hasHelpFlag(args, 2)) {
      printEntityHelp([
        `run \`${dcCommand("entity show dc.council")}\` after you know the entity id`,
      ]);
      return true;
    }
    const view = await deps.entityView(args[2]);
    if (options.json) {
      console.log(JSON.stringify(entityViewJsonRecord(view, options.dbPath), null, 2));
      return true;
    }
    console.log(renderEntityView(view, options.dbPath));
    return true;
  }
  return false;
}

function entitySearchJsonRecord(
  row: EntitySearchResult,
  dbPath?: string,
): EntitySearchResult & {
  showCommand: string;
} {
  return { ...row, showCommand: entityShowCommand(row.entityId, dbPath) };
}

function entityShowCommand(entityId: string, dbPath?: string): string {
  return scopeDbCommand(dcCommand(`entity show ${entityId}`), dbPath) ??
    dcCommand(`entity show ${entityId}`);
}

function entityViewJsonRecord(
  view: EntityView,
  dbPath?: string,
): EntityView & { nextCommand?: string } {
  return {
    ...view,
    reviewItems: view.reviewItems.map((item) => scopeReviewItem(item, dbPath)),
    nextCommand: firstReviewCommand(view.reviewItems, dbPath),
  };
}

export function printEntityHelp(tips: string[] = []): void {
  console.log(`${dcCommand("entity")}

Workflow:
  1. Find an entity id with \`${dcCommand("entity search District")}\`
  2. Use the printed \`Show:\` command, or inspect the full record with \`${
    dcCommand("entity show dc.council")
  }\`

Usage:
  ${dcCommand("entity search <query>")} [--db <path>] [--json]
  ${dcCommand("entity show <entity-id>")} [--db <path>] [--json]
`);
  for (const tip of tips) {
    console.log(`Tip: ${tip}`);
  }
}

function renderEntityView(view: EntityView, dbPath?: string): string {
  const lines = [
    `${view.name} (${view.kind})`,
    `id: ${view.entityId}`,
    `review: ${view.reviewStatus}`,
  ];
  if (view.branch) lines.push(`branch: ${view.branch}`);
  if (view.cluster) lines.push(`cluster: ${view.cluster}`);
  if (view.officialUrl) lines.push(`official_url: ${view.officialUrl}`);
  if (view.isPlaceholder) {
    lines.push(`placeholder: yes${view.placeholderReason ? ` (${view.placeholderReason})` : ""}`);
  }
  lines.push("evidence:");
  for (const evidence of view.evidence.slice(0, 10)) {
    lines.push(
      `- ${evidence.sourceId}: ${evidence.fieldPath} <- ${evidence.observedValue}`,
      `  artifact: ${evidence.artifactPath}`,
    );
  }
  lines.push("outgoing:");
  for (const relationship of view.outgoing) {
    lines.push(
      `- ${relationship.relationshipType} -> ${relationship.targetName} [${relationship.targetEntityId}]`,
    );
  }
  lines.push("incoming:");
  for (const relationship of view.incoming) {
    lines.push(
      `- ${relationship.relationshipType} <- ${relationship.sourceName} [${relationship.sourceEntityId}]`,
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
      lines.push(...renderOpenReviewItem(item, dbPath));
    }
    const nextCommand = firstReviewCommand(view.reviewItems, dbPath);
    if (nextCommand) {
      lines.push(`Next: ${nextCommand}`);
    }
  }
  return lines.join("\n");
}

function firstReviewCommand(items: ReviewItemRecord[], dbPath?: string): string | undefined {
  for (const item of items) {
    const command = reviewCommandForItem(item, dbPath);
    if (command) return command;
  }
  return undefined;
}

function renderOpenReviewItem(item: ReviewItemRecord, dbPath?: string): string[] {
  const lines = [
    `- ${item.itemType}: ${item.reason} [default ${item.defaultAction}]`,
  ];
  if (item.subject?.sourceId) {
    lines.push(
      `  source: ${item.subject.sourceId}${
        item.subject.itemTitle ? ` / ${item.subject.itemTitle}` : ""
      }`,
    );
  }
  if (item.subject?.label) {
    lines.push(`  label: ${item.subject.label}`);
  }
  if (item.subject?.relationshipType) {
    lines.push(
      `  relationship: ${item.subject.fromEntityRef ?? "?"} --${item.subject.relationshipType}--> ${
        item.subject.toEntityRef ?? "?"
      }`,
    );
  }
  if (item.subject?.rawValue) {
    lines.push(`  raw value: ${item.subject.rawValue}`);
  }
  const whyDeferred = stringDetail(item.details, "whyDeferred");
  if (whyDeferred) {
    lines.push(`  why: ${whyDeferred}`);
  }
  const reviewCommand = reviewCommandForItem(item, dbPath);
  if (reviewCommand) {
    lines.push(
      `  review: ${reviewCommand}`,
    );
  }
  return lines;
}

function reviewCommandForItem(item: ReviewItemRecord, dbPath?: string): string | undefined {
  return scopeDbCommand(
    item.reviewCommand ??
      (item.subject?.sourceId
        ? `${
          dcCommand("review")
        } --source ${item.subject.sourceId} --subject-prefix ${item.subjectId}`
        : undefined),
    dbPath,
  );
}

function scopeReviewItem(item: ReviewItemRecord, dbPath?: string): ReviewItemRecord {
  const reviewCommand = reviewCommandForItem(item, dbPath);
  return reviewCommand ? { ...item, reviewCommand } : item;
}

function scopeDbCommand(command: string | undefined, dbPath?: string): string | undefined {
  if (!command || !dbPath || !command.startsWith(dcCommand("")) || command.includes(" --db ")) {
    return command;
  }
  return `${command} --db ${dbPath}`;
}

function stringDetail(details: Record<string, unknown>, key: string): string | undefined {
  const value = details[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hasHelpFlag(args: string[], start: number): boolean {
  return args.slice(start).some((value) => isHelp(value));
}

function isHelp(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}

function readFreeTextArgument(args: string[], startIndex: number): string {
  const values: string[] = [];
  for (let index = startIndex; index < args.length; index += 1) {
    if (args[index].startsWith("--")) break;
    values.push(args[index]);
  }
  return values.join(" ");
}
