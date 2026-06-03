import { dcCommand } from "./command_prefix.ts";
import type { EntitySearchResult, EntityView } from "./domain.ts";
import { renderEntityView } from "./workbench/review_cli.ts";

export interface EntityCommandOptions {
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
      console.log(JSON.stringify(rows, null, 2));
      return true;
    }
    for (const row of rows) {
      const placeholderTag = row.isPlaceholder ? " placeholder" : "";
      console.log(`${row.entityId} ${row.name} [${row.kind}] ${row.reviewStatus}${placeholderTag}`);
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
      console.log(JSON.stringify(view, null, 2));
      return true;
    }
    console.log(renderEntityView(view));
    return true;
  }
  return false;
}

export function printEntityHelp(tips: string[] = []): void {
  console.log(`${dcCommand("entity")}

Workflow:
  1. Find an entity id with \`${dcCommand("entity search District")}\`
  2. Inspect the full record with \`${dcCommand("entity show dc.council")}\`

Usage:
  ${dcCommand("entity search <query>")} [--db <path>] [--json]
  ${dcCommand("entity show <entity-id>")} [--db <path>] [--json]
`);
  for (const tip of tips) {
    console.log(`Tip: ${tip}`);
  }
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
