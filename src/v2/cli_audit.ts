import { dcCommand } from "./command_prefix.ts";
import type { WorkbenchMeta } from "./domain.ts";
import {
  renderWorkbenchAudit,
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
  if (args[0] === "status") {
    if (isHelp(args[1])) {
      printAuditHelp();
      return true;
    }
    if (!args[1] || args[1].startsWith("--")) {
      await renderAuditSnapshot("status", options, deps);
      return true;
    }
    return false;
  }

  if (args[0] === "audit") {
    if (isHelp(args[1])) {
      printAuditHelp();
      return true;
    }
    if (!args[1] || args[1].startsWith("--")) {
      await renderAuditSnapshot("audit", options, deps);
      return true;
    }
    return false;
  }

  return false;
}

export function printAuditHelp(): void {
  console.log(`${dcCommand("audit")}

Workflow:
  1. Run \`${dcCommand("audit")}\` for the human blocker view
  2. Use \`${dcCommand("audit --json")}\` or \`${dcCommand("status --json")}\` for scriptable status
  3. Inspect the blocked source with \`${dcCommand("source inspect <source-id>")}\`

Usage:
  ${dcCommand("audit")} [--db <path>] [--json]
  ${dcCommand("status")} [--db <path>] [--json]
`);
}

async function renderAuditSnapshot(
  mode: "status" | "audit",
  options: AuditCommandOptions,
  deps: AuditCommandDeps,
): Promise<void> {
  const { meta, status } = await deps.readWorkbenchStatus();
  if (options.json) {
    console.log(
      JSON.stringify({ ...meta, ...status, schemaVersion: meta.schema.version }, null, 2),
    );
    return;
  }
  console.log(`DB: ${meta.dbPath}`);
  console.log(`Schema version: ${meta.schema.version}`);
  console.log(
    `Schema: ${meta.schema.version} ${meta.schema.name} (${meta.schema.initializedAt})`,
  );
  console.log(mode === "status" ? renderWorkbenchStatus(status) : renderWorkbenchAudit(status));
}

function isHelp(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}
