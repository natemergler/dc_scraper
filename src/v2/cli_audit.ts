import type { WorkbenchMeta } from "./domain.ts";
import {
  renderWorkbenchDoctor,
  renderWorkbenchStatus,
  type WorkbenchStatusSnapshot,
} from "./status.ts";

export interface AuditCommandOptions {
  json?: boolean;
}

export interface AuditCommandDeps {
  readWorkbenchStatus(): Promise<{ meta: WorkbenchMeta; status: WorkbenchStatusSnapshot }>;
}

export async function handleAuditCommand(
  args: string[],
  options: AuditCommandOptions,
  deps: AuditCommandDeps,
): Promise<boolean> {
  if (args[0] === "audit") {
    if (isHelp(args[1])) {
      printAuditHelp();
      return true;
    }
    if (!args[1] || args[1].startsWith("--")) {
      await renderAuditSnapshot("doctor", options, deps);
      return true;
    }
    if (args[1] === "status" || args[1] === "doctor") {
      await renderAuditSnapshot(args[1], options, deps);
      return true;
    }
    return false;
  }

  if (args[0] === "workbench" && (args[1] === "status" || args[1] === "doctor")) {
    await renderAuditSnapshot(args[1], options, deps);
    return true;
  }

  return false;
}

export function printAuditHelp(): void {
  console.log(`dc audit

Workflow:
  1. Run \`dc audit\` for the human blocker view
  2. Use \`dc audit --json\` or \`dc status --json\` for scriptable status
  3. Inspect the blocked source with \`dc source inspect <source-id>\`

Usage:
  dc audit [--db <path>] [--json]
  dc audit status [--db <path>] [--json]
  dc audit doctor [--db <path>] [--json]
  dc status [--db <path>] [--json]
  dc doctor [--db <path>] [--json]
`);
}

async function renderAuditSnapshot(
  mode: "status" | "doctor",
  options: AuditCommandOptions,
  deps: AuditCommandDeps,
): Promise<void> {
  const { meta, status } = await deps.readWorkbenchStatus();
  if (options.json) {
    console.log(JSON.stringify({ ...meta, ...status }, null, 2));
    return;
  }
  console.log(`DB: ${meta.dbPath}`);
  console.log(`Schema version: ${meta.schemaVersion}`);
  for (const migration of meta.migrations) {
    console.log(`- ${migration.version} ${migration.name} (${migration.appliedAt})`);
  }
  console.log(mode === "status" ? renderWorkbenchStatus(status) : renderWorkbenchDoctor(status));
}

function isHelp(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}
