import { dcCommand } from "../command_prefix.ts";
import type { ReviewItemFilters } from "./review.ts";

export function renderReviewCommand(
  filters: ReviewItemFilters = {},
  options: {
    browseSubcommand?: "list" | "packets";
    includeType?: boolean;
  } = {},
): string {
  const parts = ["review"];
  if (options.browseSubcommand) parts.push(options.browseSubcommand);
  const mode = reviewModeSubcommand(filters.mode);
  const usePositionalMode = Boolean(mode && !options.browseSubcommand);
  if (mode && usePositionalMode) parts.push(mode);
  parts.push(
    ...reviewFilterArgs(filters, {
      includeMode: !usePositionalMode,
      includeType: options.includeType ?? true,
    }),
  );
  return dcCommand(parts.join(" "));
}

export function reviewFilterArgs(
  filters: ReviewItemFilters,
  options: { includeMode: boolean; includeType: boolean },
): string[] {
  return [
    options.includeMode && filters.mode ? "--mode" : undefined,
    options.includeMode && filters.mode ? quoteShellArg(filters.mode) : undefined,
    filters.status && filters.status !== "open" ? "--status" : undefined,
    filters.status && filters.status !== "open" ? quoteShellArg(filters.status) : undefined,
    filters.sourceId ? "--source" : undefined,
    filters.sourceId ? quoteShellArg(filters.sourceId) : undefined,
    options.includeType && filters.type ? "--type" : undefined,
    options.includeType && filters.type ? quoteShellArg(filters.type) : undefined,
    filters.subjectPrefix ? "--subject-prefix" : undefined,
    filters.subjectPrefix ? quoteShellArg(filters.subjectPrefix) : undefined,
    filters.relationshipType ? "--relationship-type" : undefined,
    filters.relationshipType ? quoteShellArg(filters.relationshipType) : undefined,
    filters.rawValue ? "--raw-value" : undefined,
    filters.rawValue ? quoteShellArg(filters.rawValue) : undefined,
    filters.rawValueContains ? "--raw-value-contains" : undefined,
    filters.rawValueContains ? quoteShellArg(filters.rawValueContains) : undefined,
    filters.refType ? "--ref-type" : undefined,
    filters.refType ? quoteShellArg(filters.refType) : undefined,
  ].filter((value): value is string => Boolean(value));
}

export function reviewModeSubcommand(mode: string | undefined): string | undefined {
  return mode && ["entities", "relationships", "legal", "sources"].includes(mode)
    ? mode
    : undefined;
}

function quoteShellArg(value: string): string {
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
