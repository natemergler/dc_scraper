import { dcCommand } from "../command_prefix.ts";
import { type ReviewItemRecord, slugify } from "../domain.ts";
import {
  reviewBatchCommand,
  type ReviewCommandContext,
  reviewContextArgs,
  reviewFilterArgs,
} from "./review_command_args.ts";
import { canBatchAcceptReviewItem, type ReviewItemFilters } from "./review.ts";
import { reviewSubjectSourceId } from "./review_subject.ts";
import type { WorkbenchStore } from "./store.ts";

export interface ReviewPacketRecord {
  packetId: string;
  itemType: ReviewItemRecord["itemType"];
  sourceId: string;
  reason: string;
  defaultAction: string;
  count: number;
  openCount: number;
  deferredCount: number;
  relationshipType?: string;
  refType?: string;
  subjectPrefix?: string;
  nextCommand?: string;
  reviewItemIds: string[];
}

export type ReviewPacketCommandContext = ReviewCommandContext;
export type ReviewPacketBatchCommandAction = "accept-safe" | "defer-default";

type ReviewPacketCommandAction = ReviewPacketBatchCommandAction | "list";

export interface ReviewPacketListOptions {
  commandContext?: ReviewPacketCommandContext;
  commandSubjectScope?: "packet" | "source";
}

export interface ReviewPacketCommandOptions extends ReviewPacketListOptions {
  itemFilter?: (item: ReviewItemRecord) => boolean;
}

interface ReviewPacketEntry {
  packet: ReviewPacketRecord;
  nextAction?: ReviewPacketCommandAction;
}

interface ReviewPacketEntryOptions extends ReviewPacketListOptions {
  itemFilter?: (item: ReviewItemRecord) => boolean;
}

export function listReviewPackets(
  store: Pick<WorkbenchStore, "db"> & {
    listReviewItems(filters?: string | ReviewItemFilters): ReviewItemRecord[];
  },
  filters?: string | ReviewItemFilters,
  options: ReviewPacketListOptions = {},
): ReviewPacketRecord[] {
  return listReviewPacketEntries(store, filters, options).map((entry) => entry.packet);
}

export function reviewPacketCommand(
  store: Pick<WorkbenchStore, "db"> & {
    listReviewItems(filters?: string | ReviewItemFilters): ReviewItemRecord[];
  },
  filters: ReviewItemFilters,
  action: ReviewPacketBatchCommandAction,
  options: ReviewPacketCommandOptions = {},
): string | undefined {
  return listReviewPacketEntries(store, filters, {
    ...options,
    commandSubjectScope: options.commandSubjectScope ?? "source",
  })
    .find((entry) => entry.nextAction === action)
    ?.packet.nextCommand;
}

function listReviewPacketEntries(
  store: Pick<WorkbenchStore, "db"> & {
    listReviewItems(filters?: string | ReviewItemFilters): ReviewItemRecord[];
  },
  filters?: string | ReviewItemFilters,
  options: ReviewPacketEntryOptions = {},
): ReviewPacketEntry[] {
  const { itemFilters, packetLimit, originalFilters } = packetListFilters(filters);
  const packets = new Map<string, ReviewPacketRecord>();
  const packetItems = new Map<string, ReviewItemRecord[]>();
  for (const item of store.listReviewItems(itemFilters)) {
    if (options.itemFilter && !options.itemFilter(item)) continue;
    const sourceId = reviewSubjectSourceId(store, item);
    const key = reviewPacketKey(item, sourceId);
    const existing = packets.get(key);
    if (existing) {
      existing.count += 1;
      existing.reviewItemIds.push(item.reviewItemId);
      if (item.status === "open") existing.openCount += 1;
      if (item.status === "deferred") existing.deferredCount += 1;
      packetItems.get(key)?.push(item);
      continue;
    }
    packets.set(key, {
      packetId: `packet.${slugify(key)}`,
      itemType: item.itemType,
      sourceId,
      reason: item.reason,
      defaultAction: item.defaultAction,
      count: 1,
      openCount: item.status === "open" ? 1 : 0,
      deferredCount: item.status === "deferred" ? 1 : 0,
      relationshipType: typeof item.details.relationshipType === "string"
        ? item.details.relationshipType
        : undefined,
      refType: typeof item.details.refType === "string" ? item.details.refType : undefined,
      reviewItemIds: [item.reviewItemId],
    });
    packetItems.set(key, [item]);
  }
  const sortedPackets = [...packets.entries()].map(([key, packet]) => {
    const items = packetItems.get(key) ?? [];
    const subjectPrefix = commonSubjectPrefix(items.map((item) => item.subjectId));
    const next = reviewPacketNextCommand(
      store,
      packet,
      items,
      subjectPrefix,
      originalFilters,
      options.commandContext,
      options.commandSubjectScope ?? "packet",
      options.itemFilter,
    );
    return {
      packet: {
        ...packet,
        subjectPrefix,
        nextCommand: next?.command,
      },
      nextAction: next?.action,
    };
  }).sort((left, right) =>
    right.packet.count - left.packet.count ||
    left.packet.sourceId.localeCompare(right.packet.sourceId) ||
    left.packet.itemType.localeCompare(right.packet.itemType) ||
    left.packet.reason.localeCompare(right.packet.reason)
  );
  return packetLimit === undefined ? sortedPackets : sortedPackets.slice(0, packetLimit);
}

export function renderReviewPacketSummary(packet: ReviewPacketRecord): string {
  return [
    `[${packet.count}] ${packet.sourceId} ${packet.itemType}`,
    `reason: ${packet.reason}`,
    `default: ${packet.defaultAction}`,
    `status: open=${packet.openCount}, deferred=${packet.deferredCount}`,
    packet.relationshipType ? `relationship_type: ${packet.relationshipType}` : undefined,
    packet.refType ? `ref_type: ${packet.refType}` : undefined,
    packet.subjectPrefix ? `subject_prefix: ${packet.subjectPrefix}` : undefined,
    packet.nextCommand ? `next: ${packet.nextCommand}` : undefined,
    `packet_id: ${packet.packetId}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function renderReviewPacketHeader(packet: ReviewPacketRecord): string {
  const scope = packet.relationshipType
    ? `${packet.sourceId} ${packet.relationshipType}`
    : packet.refType
    ? `${packet.sourceId} ${packet.refType}`
    : `${packet.sourceId} ${packet.itemType}`;
  return `Packet: ${scope} (${packet.count} item(s); open=${packet.openCount}, deferred=${packet.deferredCount})`;
}

function reviewPacketKey(item: ReviewItemRecord, sourceId: string): string {
  return [
    item.itemType,
    sourceId,
    item.reason,
    item.defaultAction,
    typeof item.details.relationshipType === "string" ? item.details.relationshipType : "",
    typeof item.details.refType === "string" ? item.details.refType : "",
  ].join("|");
}

function packetListFilters(filters?: string | ReviewItemFilters): {
  itemFilters?: string | ReviewItemFilters;
  packetLimit?: number;
  originalFilters?: ReviewItemFilters;
} {
  if (typeof filters === "string") {
    return { itemFilters: filters, originalFilters: { mode: filters } };
  }
  if (!filters) return {};
  const { limit, ...itemFilters } = filters;
  return { itemFilters, packetLimit: limit, originalFilters: filters };
}

function reviewPacketNextCommand(
  store: Pick<WorkbenchStore, "db"> & {
    listReviewItems(filters?: string | ReviewItemFilters): ReviewItemRecord[];
  },
  packet: ReviewPacketRecord,
  items: ReviewItemRecord[],
  subjectPrefix: string | undefined,
  originalFilters: ReviewItemFilters | undefined,
  commandContext: ReviewPacketCommandContext | undefined,
  commandSubjectScope: NonNullable<ReviewPacketListOptions["commandSubjectScope"]>,
  itemFilter: ((item: ReviewItemRecord) => boolean) | undefined,
): { command: string; action: ReviewPacketCommandAction } | undefined {
  const mode = reviewPacketMode(packet.itemType);
  if (!mode) return undefined;
  const sourceSubjectPrefix = sourceSubjectPrefixForPacket(
    packet,
    mode,
    originalFilters,
    commandSubjectScope,
  );
  const commandSubjectPrefix = reviewPacketCommandSubjectPrefix(
    sourceSubjectPrefix ? undefined : subjectPrefix,
    sourceSubjectPrefix,
    originalFilters?.subjectPrefix,
    items,
  );
  const requestedSubjectPrefixCanScopeBatch = reviewPacketRequestedPrefixCanScopeBatch(
    originalFilters?.subjectPrefix,
    items,
  );
  const batchScopedFilters = reviewPacketFilters(
    packet,
    mode,
    commandSubjectPrefix,
    originalFilters,
  );
  const listScopedFilters = reviewPacketFilters(
    packet,
    mode,
    requestedSubjectPrefixCanScopeBatch
      ? commandSubjectPrefix
      : originalFilters?.subjectPrefix ?? commandSubjectPrefix,
    originalFilters,
  );
  const listFilterArgs = reviewFilterArgs(listScopedFilters, {
    includeMode: true,
    includeType: true,
  });
  const openItems = items.filter((item) => item.status === "open");
  const acceptSafeFilters = acceptSafeBatchFilters(
    store,
    batchScopedFilters,
    openItems,
    itemFilter,
  );
  if (
    openItems.length > 0 &&
    packet.defaultAction === "accept" &&
    commandSubjectPrefix &&
    requestedSubjectPrefixCanScopeBatch &&
    isOpenPacketScope(batchScopedFilters) &&
    acceptSafeFilters
  ) {
    return {
      command: reviewBatchCommand("accept-safe", acceptSafeFilters, commandContext),
      action: "accept-safe",
    };
  }
  if (
    openItems.length > 0 &&
    packet.defaultAction === "defer" &&
    commandSubjectPrefix &&
    requestedSubjectPrefixCanScopeBatch &&
    isOpenPacketScope(batchScopedFilters) &&
    hasBatchNarrowing(batchScopedFilters)
  ) {
    return {
      command: reviewBatchCommand("defer-default", batchScopedFilters, commandContext),
      action: "defer-default",
    };
  }
  return {
    command: dcCommand(
      [
        "review list",
        ...listFilterArgs,
        "--limit",
        "10",
        ...reviewContextArgs(commandContext, "read"),
      ]
        .join(" "),
    ),
    action: "list",
  };
}

function acceptSafeBatchFilters(
  store: Pick<WorkbenchStore, "db"> & {
    listReviewItems(filters?: string | ReviewItemFilters): ReviewItemRecord[];
  },
  filters: ReviewItemFilters,
  openItems: ReviewItemRecord[],
  itemFilter: ((item: ReviewItemRecord) => boolean) | undefined,
): ReviewItemFilters | undefined {
  for (const candidateFilters of acceptSafeBatchFilterCandidates(filters, openItems, itemFilter)) {
    const acceptedItems = store.listReviewItems(candidateFilters).filter((item) =>
      canBatchAcceptReviewItem(store, item, candidateFilters)
    );
    if (acceptedItems.length === 0) continue;
    if (itemFilter && !acceptedItems.every(itemFilter)) continue;
    return candidateFilters;
  }
  return undefined;
}

function acceptSafeBatchFilterCandidates(
  filters: ReviewItemFilters,
  openItems: ReviewItemRecord[],
  itemFilter: ((item: ReviewItemRecord) => boolean) | undefined,
): ReviewItemFilters[] {
  const subjectPrefixes = [filters.subjectPrefix];
  if (itemFilter) {
    subjectPrefixes.push(...openItems.filter(itemFilter).map((item) => item.subjectId));
  }
  const seen = new Set<string>();
  return subjectPrefixes.flatMap((subjectPrefix) => {
    if (!subjectPrefix || seen.has(subjectPrefix)) return [];
    seen.add(subjectPrefix);
    return [{ ...filters, subjectPrefix }];
  });
}

function sourceSubjectPrefixForPacket(
  packet: ReviewPacketRecord,
  mode: string,
  originalFilters: ReviewItemFilters | undefined,
  commandSubjectScope: NonNullable<ReviewPacketListOptions["commandSubjectScope"]>,
): string | undefined {
  if (commandSubjectScope !== "source" || originalFilters?.subjectPrefix) return undefined;
  if (mode === "entities") return `candidate.${packet.sourceId}`;
  if (mode === "relationships") return `relationship.${packet.sourceId}`;
  if (mode === "legal") return `legal.${packet.sourceId}`;
  return undefined;
}

function reviewPacketMode(itemType: ReviewItemRecord["itemType"]): string | undefined {
  if (itemType === "entity_candidate" || itemType === "placeholder_entity") return "entities";
  if (itemType === "relationship_candidate") return "relationships";
  if (itemType === "legal_ref") return "legal";
  if (itemType === "source_status") return "sources";
  return undefined;
}

function reviewPacketFilters(
  packet: ReviewPacketRecord,
  mode: string,
  subjectPrefix: string | undefined,
  originalFilters: ReviewItemFilters | undefined,
): ReviewItemFilters {
  return {
    mode,
    status: reviewPacketCommandStatus(packet, originalFilters?.status),
    type: packet.itemType,
    subjectPrefix,
    relationshipType: originalFilters?.relationshipType ?? packet.relationshipType,
    rawValue: originalFilters?.rawValue,
    rawValueContains: originalFilters?.rawValueContains,
    refType: originalFilters?.refType ?? packet.refType,
  };
}

function reviewPacketCommandStatus(
  packet: ReviewPacketRecord,
  requestedStatus: ReviewItemFilters["status"] | undefined,
): ReviewItemFilters["status"] | undefined {
  if (requestedStatus === "resolved" || requestedStatus === "all") return requestedStatus;
  if (requestedStatus === "deferred") return "deferred";
  if (packet.openCount > 0) return "open";
  if (packet.deferredCount > 0) return "deferred";
  return requestedStatus;
}

function isOpenPacketScope(filters: ReviewItemFilters): boolean {
  return filters.status === undefined || filters.status === "open";
}

function hasBatchNarrowing(filters: ReviewItemFilters): boolean {
  return Boolean(filters.subjectPrefix && (filters.relationshipType || filters.refType));
}

function reviewPacketCommandSubjectPrefix(
  packetPrefix: string | undefined,
  sourcePrefix: string | undefined,
  requestedPrefix: string | undefined,
  items: ReviewItemRecord[],
): string | undefined {
  const candidates: string[] = [];
  if (packetPrefix) candidates.push(packetPrefix);
  if (sourcePrefix) candidates.push(sourcePrefix);
  if (requestedPrefix) candidates.push(requestedPrefix);
  return candidates
    .filter((prefix) => items.every((item) => item.subjectId.startsWith(prefix)))
    .sort((left, right) => right.length - left.length)[0];
}

function reviewPacketRequestedPrefixCanScopeBatch(
  requestedPrefix: string | undefined,
  items: ReviewItemRecord[],
): boolean {
  return !requestedPrefix || items.every((item) => item.subjectId.startsWith(requestedPrefix));
}

function commonSubjectPrefix(subjectIds: string[]): string | undefined {
  if (subjectIds.length === 0) return undefined;
  const splitIds = subjectIds.map((subjectId) => subjectId.split("."));
  const commonParts: string[] = [];
  for (let index = 0; index < splitIds[0].length; index += 1) {
    const value = splitIds[0][index];
    if (splitIds.every((parts) => parts[index] === value)) {
      commonParts.push(value);
      continue;
    }
    break;
  }
  return commonParts.length >= 2 ? commonParts.join(".") : undefined;
}
