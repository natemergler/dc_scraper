import { type ReviewItemRecord, slugify } from "../domain.ts";
import type { ReviewItemFilters } from "./review.ts";
import { renderReviewCommand } from "./review_command_args.ts";
import { reviewSubjectSourceIds } from "./review_subject.ts";
import type { WorkbenchStore } from "./store.ts";
import { projectOpenHumanDecisionWork, type UnresolvedDecisionNode } from "./unresolved_work.ts";

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
  toEntityRef?: string;
  whyDeferred?: string;
  subjectPrefix?: string;
  reviewItemIds: string[];
}

export type ReviewPacketJsonRecord = Omit<ReviewPacketRecord, "reviewItemIds"> & {
  reviewItemIds?: string[];
};

export type ReviewPacketPriorityDecision = Pick<
  UnresolvedDecisionNode,
  "reviewItemId" | "downstreamBlockedCount"
>;

export function listReviewPackets(
  store: Pick<WorkbenchStore, "db"> & {
    listReviewItems(filters?: ReviewItemFilters): ReviewItemRecord[];
  },
  filters?: ReviewItemFilters,
): ReviewPacketRecord[] {
  const { itemFilters, packetLimit } = packetListFilters(filters);
  const items = store.listReviewItems(itemFilters);
  return reviewPacketsFromItems(store, items, { limit: packetLimit });
}

export function listOpenDecisionReviewPackets(
  store: WorkbenchStore,
  filters?: ReviewItemFilters,
): ReviewPacketRecord[] {
  const { itemFilters, packetLimit } = packetListFilters(filters);
  const projection = projectOpenHumanDecisionWork(store, {
    ...itemFilters,
    limit: undefined,
  });
  const packets = reviewPacketsFromItems(
    store,
    projection.items.map((item) => item.reviewItem),
  );
  const decisionsByReviewItemId = reviewPacketPriorityDecisionMap(
    projection.items.map((item) => item.decision),
  );
  const rankedPackets = rankReviewPacketsByPriority(packets, decisionsByReviewItemId);
  return packetLimit === undefined ? rankedPackets : rankedPackets.slice(0, packetLimit);
}

export function reviewPacketsFromItems(
  store: Pick<WorkbenchStore, "db">,
  items: ReviewItemRecord[],
  options: { limit?: number } = {},
): ReviewPacketRecord[] {
  const packets = new Map<string, ReviewPacketRecord>();
  const packetItems = new Map<string, ReviewItemRecord[]>();
  const sourceIds = reviewSubjectSourceIds(store, items);
  for (const item of items) {
    const sourceId = sourceIds.get(item.reviewItemId) ?? "unknown";
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
      toEntityRef: typeof item.details.toEntityRef === "string"
        ? item.details.toEntityRef
        : undefined,
      whyDeferred: typeof item.details.whyDeferred === "string"
        ? item.details.whyDeferred
        : undefined,
      reviewItemIds: [item.reviewItemId],
    });
    packetItems.set(key, [item]);
  }
  const sortedPackets = [...packets.entries()].map(([key, packet]) => {
    const items = packetItems.get(key) ?? [];
    const subjectPrefix = commonSubjectPrefix(items.map((item) => item.subjectId));
    return { ...packet, subjectPrefix };
  }).sort((left, right) =>
    right.count - left.count ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.itemType.localeCompare(right.itemType) ||
    left.reason.localeCompare(right.reason)
  );
  return options.limit === undefined ? sortedPackets : sortedPackets.slice(0, options.limit);
}

export function reviewPacketPriorityDecisionMap(
  decisions: ReviewPacketPriorityDecision[],
): Map<string, ReviewPacketPriorityDecision> {
  return new Map(decisions.map((decision) => [decision.reviewItemId, decision]));
}

export function rankReviewPacketsByPriority(
  packets: ReviewPacketRecord[],
  decisionsByReviewItemId: Map<string, ReviewPacketPriorityDecision>,
): ReviewPacketRecord[] {
  return [...packets].sort((left, right) =>
    reviewPacketPriorityScore(right, decisionsByReviewItemId) -
      reviewPacketPriorityScore(left, decisionsByReviewItemId) ||
    right.openCount - left.openCount ||
    right.count - left.count ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.packetId.localeCompare(right.packetId)
  );
}

export function reviewPacketPriorityScore(
  packet: ReviewPacketRecord,
  decisionsByReviewItemId: Map<string, ReviewPacketPriorityDecision>,
): number {
  return packet.reviewItemIds.reduce((max, reviewItemId) => {
    const decision = decisionsByReviewItemId.get(reviewItemId);
    return Math.max(max, decision?.downstreamBlockedCount ?? 0);
  }, 0);
}

export function reviewPacketJsonRecord(
  packet: ReviewPacketRecord,
  options: { includeReviewItemIds?: boolean } = {},
): ReviewPacketJsonRecord {
  if (options.includeReviewItemIds) return packet;
  const { reviewItemIds: _reviewItemIds, ...compactPacket } = packet;
  return compactPacket;
}

export function renderReviewPacketSummary(packet: ReviewPacketRecord): string {
  return [
    `[${packet.count}] ${packet.sourceId} ${packet.itemType}`,
    `reason: ${packet.reason}`,
    `default: ${packet.defaultAction}`,
    `status: open=${packet.openCount}, deferred=${packet.deferredCount}`,
    packet.relationshipType ? `relationship_type: ${packet.relationshipType}` : undefined,
    packet.refType ? `ref_type: ${packet.refType}` : undefined,
    packet.toEntityRef ? `to_entity_ref: ${packet.toEntityRef}` : undefined,
    packet.whyDeferred ? `why_deferred: ${packet.whyDeferred}` : undefined,
    packet.subjectPrefix ? `subject_prefix: ${packet.subjectPrefix}` : undefined,
    `review: ${reviewPacketCommand(packet)}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function reviewPacketCommand(packet: ReviewPacketRecord): string {
  const mode = modeForPacket(packet);
  return renderReviewCommand({
    mode,
    sourceId: packet.sourceId === "unknown" ? undefined : packet.sourceId,
    type: mode ? undefined : packet.itemType,
    subjectPrefix: packet.subjectPrefix,
    relationshipType: packet.relationshipType,
    refType: packet.refType,
  });
}

function modeForPacket(packet: ReviewPacketRecord): ReviewItemFilters["mode"] {
  switch (packet.itemType) {
    case "entity_candidate":
    case "placeholder_entity":
      return "entities";
    case "relationship_candidate":
      return "relationships";
    case "legal_ref":
      return "legal";
    case "dataset":
    case "source_status":
      return "sources";
  }
}

export function renderReviewPacketHeader(packet: ReviewPacketRecord): string {
  const scope = packet.relationshipType
    ? packet.toEntityRef
      ? `${packet.sourceId} ${packet.relationshipType} -> ${packet.toEntityRef}`
      : `${packet.sourceId} ${packet.relationshipType}`
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
    ...deferredRelationshipPacketContext(item),
  ].join("|");
}

function deferredRelationshipPacketContext(item: ReviewItemRecord): string[] {
  if (item.itemType !== "relationship_candidate" || item.defaultAction !== "defer") return [];
  return [
    typeof item.details.toEntityRef === "string" ? item.details.toEntityRef : "",
    typeof item.details.whyDeferred === "string" ? item.details.whyDeferred : "",
  ];
}

function packetListFilters(filters?: ReviewItemFilters): {
  itemFilters?: ReviewItemFilters;
  packetLimit?: number;
} {
  if (!filters) return {};
  const { limit, ...itemFilters } = filters;
  return { itemFilters, packetLimit: limit };
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
