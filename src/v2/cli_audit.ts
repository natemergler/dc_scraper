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
  1. Run \`${
    dcCommand("audit")
  }\` to inspect release blockers, failed sources, and reconciliation details
  2. Use \`${dcCommand("audit --json")}\` or \`${dcCommand("status --json")}\` for scriptable status
  3. Inspect a failed or blocked source with \`${dcCommand("source inspect <source-id>")}\`

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
  const scopedStatus = scopeAuditCommands(status, meta.dbPath);
  if (options.json) {
    console.log(
      JSON.stringify({ ...meta, ...scopedStatus, schemaVersion: meta.schema.version }, null, 2),
    );
    return;
  }
  console.log(`DB: ${meta.dbPath}`);
  console.log(`Schema version: ${meta.schema.version}`);
  console.log(
    `Schema: ${meta.schema.version} ${meta.schema.name} (${meta.schema.initializedAt})`,
  );
  console.log(
    mode === "status" ? renderWorkbenchStatus(scopedStatus) : renderWorkbenchAudit(scopedStatus),
  );
}

function isHelp(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}

function scopeAuditCommands(
  status: WorkbenchStatusSnapshot,
  dbPath: string,
): WorkbenchStatusSnapshot {
  return {
    ...status,
    review: {
      ...status.review,
      browseCommand: scopeDbCommand(status.review.browseCommand, dbPath),
    },
    reconciliation: {
      ...status.reconciliation,
      firstBlocked: status.reconciliation.firstBlocked
        ? {
          ...status.reconciliation.firstBlocked,
          inspectCommand:
            scopeDbCommand(status.reconciliation.firstBlocked.inspectCommand, dbPath) ??
              status.reconciliation.firstBlocked.inspectCommand,
        }
        : undefined,
      topUnblocker: status.reconciliation.topUnblocker
        ? {
          ...status.reconciliation.topUnblocker,
          reviewCommand: scopeDbCommand(
            status.reconciliation.topUnblocker.reviewCommand,
            dbPath,
          ) ?? status.reconciliation.topUnblocker.reviewCommand,
        }
        : undefined,
    },
    publicBodies: {
      ...status.publicBodies,
      inspectCommand: scopeDbCommand(status.publicBodies.inspectCommand, dbPath),
    },
    nextCommand: scopeDbCommand(status.nextCommand, dbPath) ?? status.nextCommand,
  };
}

function scopeDbCommand(command: string | undefined, dbPath: string): string | undefined {
  if (!command) return undefined;
  if (command.includes(" --db ")) return command;
  if (!command.startsWith("deno task dc -- ")) return command;
  return `${command} --db ${dbPath}`;
}
