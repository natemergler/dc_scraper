import { type ReviewItemRecord, slugify } from "../domain.ts";
import { queryAll } from "./db.ts";
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
  subjectPrefix?: string;
  reviewItemIds: string[];
}

export interface ReviewDebtSummary {
  byType: Array<{
    itemType: ReviewItemRecord["itemType"];
    openCount: number;
    deferredCount: number;
  }>;
  bySource: Array<{
    sourceId: string;
    openCount: number;
    deferredCount: number;
  }>;
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
  const items = store.listReviewItems(itemFilters);
  const sourceIds = reviewItemSourceIds(store, items);
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

interface ReviewItemSourceRow {
  subjectId: string;
  sourceId?: string | null;
}

function reviewItemSourceIds(
  store: Pick<WorkbenchStore, "db">,
  items: ReviewItemRecord[],
): Map<string, string> {
  if (items.length === 0) return new Map();
  const sourceIds = new Map<string, string>();
  const idsByType = new Map<ReviewItemRecord["itemType"], string[]>();
  for (const item of items) {
    if (item.itemType === "source_status") {
      sourceIds.set(item.reviewItemId, item.subjectId);
      continue;
    }
    if (item.itemType === "placeholder_entity") {
      sourceIds.set(item.reviewItemId, "workbench");
      continue;
    }
    const ids = idsByType.get(item.itemType) ?? [];
    ids.push(item.subjectId);
    idsByType.set(item.itemType, ids);
  }
  const subjectSourceIds = new Map<string, string>();
  addSubjectSourceRows(
    subjectSourceIds,
    sourceRowsForSubjects(
      store,
      idsByType.get("entity_candidate") ?? [],
      "entity_candidates",
      "candidate_id",
    ),
  );
  addSubjectSourceRows(
    subjectSourceIds,
    sourceRowsForSubjects(
      store,
      idsByType.get("relationship_candidate") ?? [],
      "relationship_candidates",
      "relationship_candidate_id",
    ),
  );
  addSubjectSourceRows(
    subjectSourceIds,
    sourceRowsForSubjects(
      store,
      idsByType.get("legal_ref") ?? [],
      "legal_refs",
      "legal_ref_id",
    ),
  );
  for (const item of items) {
    if (sourceIds.has(item.reviewItemId)) continue;
    sourceIds.set(item.reviewItemId, subjectSourceIds.get(item.subjectId) ?? "unknown");
  }
  return sourceIds;
}

function addSubjectSourceRows(
  sourceIds: Map<string, string>,
  rows: ReviewItemSourceRow[],
): void {
  for (const row of rows) {
    sourceIds.set(row.subjectId, row.sourceId ?? "unknown");
  }
}

function sourceRowsForSubjects(
  store: Pick<WorkbenchStore, "db">,
  subjectIds: string[],
  tableName: "entity_candidates" | "relationship_candidates" | "legal_refs",
  subjectColumn: "candidate_id" | "relationship_candidate_id" | "legal_ref_id",
): ReviewItemSourceRow[] {
  const rows: ReviewItemSourceRow[] = [];
  for (const chunk of chunks(subjectIds, 500)) {
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    rows.push(
      ...queryAll<ReviewItemSourceRow>(
        store.db,
        `select ${tableName}.${subjectColumn} as subjectId,
                source_items.source_id as sourceId
         from ${tableName}
         join source_items on source_items.source_item_id = ${tableName}.source_item_id
         where ${tableName}.${subjectColumn} in (${placeholders})`,
        chunk,
      ),
    );
  }
  return rows;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function reviewPacketDebtSummary(
  store: Pick<WorkbenchStore, "db"> & {
    listReviewItems(filters?: string | ReviewItemFilters): ReviewItemRecord[];
  },
): ReviewDebtSummary {
  const packets = listReviewPackets(store, { status: "all" })
    .filter((packet) => packet.openCount > 0 || packet.deferredCount > 0);
  return {
    byType: countPacketDebt(packets, "itemType", "itemType"),
    bySource: countPacketDebt(packets, "sourceId", "sourceId"),
  };
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

function countPacketDebt<K extends "itemType" | "sourceId", P extends string>(
  packets: ReviewPacketRecord[],
  packetKey: K,
  outputKey: P,
): Array<{ [Q in P]: ReviewPacketRecord[K] } & { openCount: number; deferredCount: number }> {
  const counts = new Map<ReviewPacketRecord[K], { openCount: number; deferredCount: number }>();
  for (const packet of packets) {
    const key = packet[packetKey];
    const existing = counts.get(key) ?? { openCount: 0, deferredCount: 0 };
    existing.openCount += packet.openCount;
    existing.deferredCount += packet.deferredCount;
    counts.set(key, existing);
  }
  return [...counts.entries()]
    .sort(([leftKey, left], [rightKey, right]) =>
      (right.openCount + right.deferredCount) - (left.openCount + left.deferredCount) ||
      String(leftKey).localeCompare(String(rightKey))
    )
    .map(([key, count]) => ({
      [outputKey]: key,
      openCount: count.openCount,
      deferredCount: count.deferredCount,
    } as { [Q in P]: ReviewPacketRecord[K] } & {
      openCount: number;
      deferredCount: number;
    }));
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
