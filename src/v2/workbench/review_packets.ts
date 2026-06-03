import { type ReviewItemRecord, slugify } from "../domain.ts";
import type { ReviewItemFilters } from "./review.ts";
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
  reviewItemIds: string[];
}

export function listReviewPackets(
  store: Pick<WorkbenchStore, "db"> & {
    listReviewItems(filters?: string | ReviewItemFilters): ReviewItemRecord[];
  },
  filters?: string | ReviewItemFilters,
): ReviewPacketRecord[] {
  const { itemFilters, packetLimit } = packetListFilters(filters);
  const packets = new Map<string, ReviewPacketRecord>();
  const packetItems = new Map<string, ReviewItemRecord[]>();
  for (const item of store.listReviewItems(itemFilters)) {
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
    return { ...packet, subjectPrefix };
  }).sort((left, right) =>
    right.count - left.count ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.itemType.localeCompare(right.itemType) ||
    left.reason.localeCompare(right.reason)
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
} {
  if (typeof filters === "string") {
    return { itemFilters: filters };
  }
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
