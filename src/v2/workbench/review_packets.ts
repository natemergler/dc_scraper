import { type ReviewItemRecord, slugify } from "../domain.ts";
import { queryOne } from "./db.ts";
import type { ReviewItemFilters } from "./review.ts";
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
  reviewItemIds: string[];
}

export function listReviewPackets(
  store: Pick<WorkbenchStore, "db"> & {
    listReviewItems(filters?: string | ReviewItemFilters): ReviewItemRecord[];
  },
  filters?: string | ReviewItemFilters,
): ReviewPacketRecord[] {
  const packets = new Map<string, ReviewPacketRecord>();
  for (const item of store.listReviewItems(filters)) {
    const sourceId = reviewPacketSourceId(store, item);
    const key = reviewPacketKey(item, sourceId);
    const existing = packets.get(key);
    if (existing) {
      existing.count += 1;
      existing.reviewItemIds.push(item.reviewItemId);
      if (item.status === "open") existing.openCount += 1;
      if (item.status === "deferred") existing.deferredCount += 1;
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
  }
  return [...packets.values()].sort((left, right) =>
    right.count - left.count ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.itemType.localeCompare(right.itemType) ||
    left.reason.localeCompare(right.reason)
  );
}

export function renderReviewPacketSummary(packet: ReviewPacketRecord): string {
  return [
    `[${packet.count}] ${packet.sourceId} ${packet.itemType}`,
    `reason: ${packet.reason}`,
    `default: ${packet.defaultAction}`,
    `status: open=${packet.openCount}, deferred=${packet.deferredCount}`,
    packet.relationshipType ? `relationship_type: ${packet.relationshipType}` : undefined,
    packet.refType ? `ref_type: ${packet.refType}` : undefined,
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

function reviewPacketSourceId(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
): string {
  if (item.itemType === "source_status") return item.subjectId;
  if (item.itemType === "placeholder_entity") return "workbench";
  if (item.itemType === "entity_candidate") {
    return querySubjectSourceId(
      store,
      `select source_items.source_id as sourceId
         from entity_candidates
         join source_items on source_items.source_item_id = entity_candidates.source_item_id
         where entity_candidates.candidate_id = ?`,
      item.subjectId,
    ) ?? "unknown";
  }
  if (item.itemType === "relationship_candidate") {
    return querySubjectSourceId(
      store,
      `select source_items.source_id as sourceId
         from relationship_candidates
         join source_items on source_items.source_item_id = relationship_candidates.source_item_id
         where relationship_candidates.relationship_candidate_id = ?`,
      item.subjectId,
    ) ?? "unknown";
  }
  if (item.itemType === "legal_ref") {
    return querySubjectSourceId(
      store,
      `select source_items.source_id as sourceId
         from legal_refs
         join source_items on source_items.source_item_id = legal_refs.source_item_id
         where legal_refs.legal_ref_id = ?`,
      item.subjectId,
    ) ?? "unknown";
  }
  return "unknown";
}

function querySubjectSourceId(
  store: Pick<WorkbenchStore, "db">,
  sql: string,
  subjectId: string,
): string | undefined {
  return queryOne<{ sourceId: string }>(store.db, sql, [subjectId])?.sourceId;
}
