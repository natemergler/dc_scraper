import { dcCommand } from "./command_prefix.ts";
import type { ReviewItemFilters } from "./workbench/review.ts";
import {
  listOpenDecisionReviewPackets,
  listReviewPackets,
  renderReviewPacketSummary,
  reviewPacketJsonRecord,
} from "./workbench/review_packets.ts";
import { reviewItemLabel, reviewSubjectSourceIds } from "./workbench/review_subject.ts";
import {
  renderReviewItemSummary,
  runBatchAcceptSafe,
  runBatchDeferDefault,
  runInteractiveReview,
} from "./workbench/review_cli.ts";
import type { Workbench } from "./workbench.ts";
import { isHumanDecisionReviewItem, reviewItemWorkKind } from "./workbench/review.ts";

export interface ReviewCommandOptions {
  json?: boolean;
  resolutionsDir: string;
}

export interface ReviewCommandDeps {
  withWorkbench<T>(action: (workbench: Workbench) => T | Promise<T>): Promise<T>;
  withInteractiveWorkbench?<T>(action: (workbench: Workbench) => T | Promise<T>): Promise<T>;
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
    await (deps.withInteractiveWorkbench ?? deps.withWorkbench)(async (workbench) => {
      await runInteractiveReview(workbench, readReviewFilters(args), options.resolutionsDir);
    });
    return true;
  }
  if (args[1] === "list") {
    if (hasHelpFlag(args, 2)) {
      printReviewHelp();
      return true;
    }
    const filters = readReviewFilters(args);
    const { items, summaries } = await deps.withWorkbench((workbench) => {
      const limit = filters.decisionsOnly ? undefined : filters.limit;
      const baseItems = workbench.listReviewItems({ ...filters, limit });
      const filteredItems = filters.decisionsOnly
        ? baseItems.filter(isHumanDecisionReviewItem).slice(0, filters.limit)
        : baseItems;
      const items = filteredItems;
      const sourceIds = reviewSubjectSourceIds(workbench, items);
      return {
        items: items.map((item) => ({
          ...item,
          sourceId: sourceIds.get(item.reviewItemId) ?? "unknown",
          label: reviewItemLabel(item),
          workKind: reviewItemWorkKind(item),
          humanDecision: isHumanDecisionReviewItem(item),
        })),
        summaries: items.map((item) => renderReviewItemSummary(workbench, item)),
      };
    });
    if (options.json) {
      console.log(JSON.stringify({ count: items.length, items }, null, 2));
      return true;
    }
    console.log(`${reviewListHeading(items)}: ${items.length}`);
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
    const filters = readReviewFilters(args);
    const includeReviewItemIds = args.includes("--include-review-item-ids");
    const packets = await deps.withWorkbench((workbench) =>
      filters.status === undefined || filters.status === "open"
        ? listOpenDecisionReviewPackets(workbench, filters)
        : listReviewPackets(workbench, filters)
    );
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            count: packets.length,
            includeReviewItemIds,
            packets: packets.map((packet) =>
              reviewPacketJsonRecord(packet, { includeReviewItemIds })
            ),
          },
          null,
          2,
        ),
      );
      return true;
    }
    console.log(`${reviewPacketsHeading(filters)}: ${packets.length}`);
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
    await (deps.withInteractiveWorkbench ?? deps.withWorkbench)(async (workbench) => {
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
  1. Run \`${dcCommand("status")}\` or \`${
    dcCommand("audit")
  }\` to see the current decision and browse state
  2. Browse source-backed rows with \`${dcCommand("review list --mode relationships --limit 5")}\`
  3. Narrow raw browsing to actual human decisions with \`${
    dcCommand("review list --decisions")
  }\` when needed
  4. Inspect grouped decision work with \`${dcCommand("review packets --mode relationships")}\`
  5. Run \`${dcCommand("review")}\` when the slice needs a human decision
  6. Press Enter for the recommended packet or choose another ranked decision packet

Usage:
  ${
    dcCommand("review")
  } [entities|relationships|legal|sources] [--db <path>] [--resolutions-dir <path>] [--source <source-id>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>]
  ${
    dcCommand("review list")
  } [--mode <mode>] [--status <open|deferred|resolved|all>] [--type <type>] [--source <source-id>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--limit <n>] [--decisions] [--json]
  ${
    dcCommand("review packets")
  } [--mode <mode>] [--status <open|deferred|resolved|all>] [--type <type>] [--source <source-id>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--limit <n>] [--json] [--include-review-item-ids]
  ${
    dcCommand("review batch accept-safe")
  } --mode <mode> [--source <source-id>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  ${
    dcCommand("review batch defer-default")
  } --mode <mode> --subject-prefix <prefix> [--source <source-id>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]

Interactive actions:
  Enter runs the default action for the current item.
  a accepts, r rejects, d defers, q quits, m merges entity candidates, e edits a relationship type.

Advanced maintenance:
  Scoped batch commands are scriptable fallback tools after inspecting a narrow packet/list slice.
  Use \`${dcCommand("review batch --help")}\` for those commands.
`);
}

function reviewListHeading(
  items: Array<{ humanDecision?: boolean }>,
): string {
  if (items.length > 0 && items.every((item) => item.humanDecision === false)) {
    return "Browse rows";
  }
  if (items.length > 0 && items.every((item) => item.humanDecision === true)) {
    return "Decision items";
  }
  return "Review items";
}

function reviewPacketsHeading(filters: ReviewItemFilters): string {
  return filters.status === undefined ? "Decision packets" : "Review packets";
}

function printReviewBatchHelp(tips: string[] = []): void {
  console.log(`${dcCommand("review batch")}

Workflow:
  1. Choose a narrow slice with \`${dcCommand("review packets")}\` or \`${
    dcCommand("review list")
  }\`
  2. Accept safe work with \`${
    dcCommand(
      "review batch accept-safe --mode entities --subject-prefix candidate.dcgis.boards_commissions_councils",
    )
  }\`
  3. Defer default-defer relationships with \`${
    dcCommand(
      "review batch defer-default --mode relationships --subject-prefix relationship.mota.quickbase --relationship-type overseen_by",
    )
  }\`

Usage:
  ${
    dcCommand("review batch accept-safe")
  } --mode <mode> [--source <source-id>] [--subject-prefix <prefix>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
  ${
    dcCommand("review batch defer-default")
  } --mode <mode> --subject-prefix <prefix> [--source <source-id>] [--relationship-type <type>] [--raw-value <value>] [--raw-value-contains <text>] [--ref-type <type>] [--db <path>] [--resolutions-dir <path>]
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
  const sourceId = readFlag(args, "--source");
  const limit = readNumberFlag(args, "--limit");
  const decisionsOnly = args.includes("--decisions");
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
    sourceId: sourceId ?? undefined,
    limit,
    decisionsOnly,
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
        `choose a narrow slice with \`${dcCommand("review packets")}\` before batching`,
      ]);
      return true;
    }
    await deps.withWorkbench(async (workbench) => {
      await runBatchAcceptSafe(workbench, filters, options.resolutionsDir);
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
