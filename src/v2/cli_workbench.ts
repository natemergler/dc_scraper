import type { WorkbenchMeta } from "./domain.ts";

export interface WorkbenchCommandDeps {
  initWorkbench(): Promise<WorkbenchMeta>;
}

export async function handleWorkbenchCommand(
  args: string[],
  deps: WorkbenchCommandDeps,
): Promise<boolean> {
  if (args[0] !== "workbench") return false;
  if (!args[1] || args[1].startsWith("--") || isHelp(args[1])) {
    printWorkbenchHelp();
    return true;
  }
  if (args[1] === "init") {
    if (hasHelpFlag(args, 2)) {
      printWorkbenchHelp();
      return true;
    }
    const meta = await deps.initWorkbench();
    console.log(`Initialized v2 workbench: ${meta.dbPath}`);
    console.log(`Schema version: ${meta.schemaVersion}`);
    return true;
  }
  return false;
}

export function printWorkbenchHelp(): void {
  console.log(`dc workbench

Workflow:
  1. Create or open the workbench with \`dc init\`
  2. Check the current state with \`dc status\`
  3. Inspect blockers with \`dc audit\`

Usage:
  dc init [--db <path>]
  dc workbench init [--db <path>]
  dc status [--db <path>] [--json]
  dc audit [--db <path>] [--json]
`);
}

function hasHelpFlag(args: string[], start: number): boolean {
  return args.slice(start).some((value) => isHelp(value));
}

function isHelp(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}
