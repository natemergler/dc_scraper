import { dcCommand } from "./command_prefix.ts";
import type { ReviewItemFilters } from "./workbench/review.ts";
import {
  listReviewPackets,
  renderReviewPacketSummary,
  type ReviewPacketCommandContext,
} from "./workbench/review_packets.ts";
import {
  renderReviewItemSummary,
  runBatchAcceptSafe,
  runBatchDefer,
  runBatchDeferDefault,
  runInteractiveReview,
} from "./workbench/review_cli.ts";
import type { Workbench } from "./workbench.ts";

export interface ReviewCommandOptions {
  json?: boolean;
  resolutionsDir: string;
  nextCommandContext?: ReviewPacketCommandContext;
}

export interface ReviewCommandDeps {
  withWorkbench<T>(action: (workbench: Workbench) => T | Promise<T>): Promise<T>;
  withReadonlyWorkbench<T>(action: (workbench: Workbench) => T | Promise<T>): Promise<T>;
}

export async function handleReviewCommand(
  args: string[],
  options: ReviewCommandOptions,
  deps: ReviewCommandDeps,
): Promise<boolean> {
  if (args[0] !== "review") return false;
  if (isHelp(args[1])) {
    printReviewHelp();
    return true;
  }
  if (!args[1] || args[1].startsWith("--")) {
    await deps.withWorkbench(async (workbench) => {
      await runInteractiveReview(workbench, readReviewFilters(args), options.resolutionsDir);
    });
    return true;
  }
  if (args[1] === "list") {
    if (hasHelpFlag(args, 2)) {
      printReviewHelp();
      return true;
    }
    const { items, summaries } = await deps.withReadonlyWorkbench((workbench) => {
      const items = workbench.listReviewItems(readReviewFilters(args));
      return {
        items,
        summaries: items.map((item) => renderReviewItemSummary(workbench, item)),
      };
    });
    if (options.json) {
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
  if (args[1] === "packets") {
    if (hasHelpFlag(args, 2)) {
      printReviewHelp();
      return true;
    }
    const packets = await deps.withReadonlyWorkbench((workbench) =>
      listReviewPackets(workbench, readReviewFilters(args), {
        commandContext: options.nextCommandContext,
      })
    );
    if (options.json) {
      console.log(JSON.stringify({ count: packets.length, packets }, null, 2));
      return true;
    }
    console.log(`Review packets: ${packets.length}`);
    for (const packet of packets) {
      console.log(renderReviewPacketSummary(packet));
      console.log("");
    }
    return true;
  }
  if (args[1] === "batch") {
    return await handleReviewBatchCommand(args, options, deps);
  }
  if (isReviewMode(args[1])) {
    if (hasHelpFlag(args, 2)) {
      printReviewHelp();
      return true;
    }
    await deps.withWorkbench(async (workbench) => {
      await runInteractiveReview(
        workbench,
        { ...readReviewFilters(args), mode: args[1] },
        options.resolutionsDir,
      );
    });
    return true;
  }
  return false;
}

export function printReviewHelp(): void {
  console.log(`${dcCommand("review")}

Workflow:
  1. Run \`${dcCommand("review")}\` for the next open item
  2. Browse a queue slice with \`${dcCommand("review list --mode relationships --limit 5")}\`
  3. Inspect grouped related work with \`${dcCommand("review packets --mode relationships")}\`
  4. Run \`${dcCommand("status")}\` for the next suggested scoped batch command
  5. Apply a scoped batch like \`${
    dcCommand(
      "review batch accept-safe --mode entities --subject-prefix candidate.council.committees",
    )
  }\`

Usage:
  ${
    dcCommand("review")
  } [entities|relationships|legal|sources] [--db <path>] [--resolutions-dir <path>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>]
  ${
    dcCommand("review list")
  } [--mode <mode>] [--status <open|deferred|resolved|all>] [--type <type>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--limit <n>] [--json]
  ${
    dcCommand("review packets")
  } [--mode <mode>] [--status <open|deferred|resolved|all>] [--type <type>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--limit <n>] [--json]
  ${
    dcCommand("review batch accept-safe")
  } --mode <mode> [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  ${
    dcCommand("review batch defer")
  } --mode <mode> --subject-prefix <prefix> [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  ${
    dcCommand("review batch defer-default")
  } --mode <mode> --subject-prefix <prefix> [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]

Interactive actions:
  Enter runs the default action for the current item.
  a accepts, r rejects, d defers, q quits, m merges entity candidates, e edits a relationship type.
`);
}

function printReviewBatchHelp(tips: string[] = []): void {
  console.log(`${dcCommand("review batch")}

Workflow:
  1. Run \`${dcCommand("status")}\` for the next suggested scoped batch command
  2. Accept safe work with \`${
    dcCommand(
      "review batch accept-safe --mode entities --subject-prefix candidate.council.committees",
    )
  }\`
  3. Defer default-defer relationships with \`${
    dcCommand(
      "review batch defer-default --mode relationships --subject-prefix relationship.dcgis.agencies --relationship-type part_of",
    )
  }\`

Usage:
  ${
    dcCommand("review batch accept-safe")
  } --mode <mode> [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  ${
    dcCommand("review batch defer")
  } --mode <mode> --subject-prefix <prefix> [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  ${
    dcCommand("review batch defer-default")
  } --mode <mode> --subject-prefix <prefix> [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
`);
  for (const tip of tips) {
    console.log(`Tip: ${tip}`);
  }
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
  const positionalMode = isReviewMode(args[1]) ? args[1] : undefined;
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

async function handleReviewBatchCommand(
  args: string[],
  options: ReviewCommandOptions,
  deps: ReviewCommandDeps,
): Promise<boolean> {
  if (!args[2] || args[2].startsWith("--") || isHelp(args[2])) {
    printReviewBatchHelp();
    return true;
  }
  const filters = readReviewFilters(args);
  if (args[2] === "accept-safe") {
    if (hasHelpFlag(args, 3) || !filters.mode) {
      printReviewBatchHelp([
        `run \`${dcCommand("status")}\` for the next suggested scoped batch command`,
      ]);
      return true;
    }
    await deps.withWorkbench(async (workbench) => {
      await runBatchAcceptSafe(workbench, filters, options.resolutionsDir);
    });
    return true;
  }
  if (args[2] === "defer") {
    if (hasHelpFlag(args, 3)) {
      printReviewBatchHelp();
      return true;
    }
    await deps.withWorkbench(async (workbench) => {
      await runBatchDefer(workbench, filters, options.resolutionsDir);
    });
    return true;
  }
  if (args[2] === "defer-default") {
    if (hasHelpFlag(args, 3)) {
      printReviewBatchHelp();
      return true;
    }
    await deps.withWorkbench(async (workbench) => {
      await runBatchDeferDefault(workbench, filters, options.resolutionsDir);
    });
    return true;
  }
  return false;
}

function hasHelpFlag(args: string[], start: number): boolean {
  return args.slice(start).some((value) => isHelp(value));
}

function isHelp(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}

function isReviewMode(
  value: string | undefined,
): value is "entities" | "relationships" | "legal" | "sources" {
  return value === "entities" || value === "relationships" || value === "legal" ||
    value === "sources";
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
