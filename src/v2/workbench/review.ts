import type { ReviewItemRecord, ReviewStatus } from "../domain.ts";
import { queryAll } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

interface ReviewItemRow {
  reviewItemId: string;
  itemType: ReviewItemRecord["itemType"];
  subjectId: string;
  reason: string;
  defaultAction: string;
  status: ReviewStatus;
  detailsJson: string;
}

export function listReviewItems(store: WorkbenchStore, mode?: string): ReviewItemRecord[] {
  let sql =
    "select review_item_id as reviewItemId, item_type as itemType, subject_id as subjectId, reason, default_action as defaultAction, status, details_json as detailsJson from review_items where status != 'resolved'";
  if (mode === "entities") {
    sql += " and item_type in ('entity_candidate', 'placeholder_entity')";
  } else if (mode === "relationships") {
    sql += " and item_type = 'relationship_candidate'";
  } else if (mode === "legal") {
    sql += " and item_type = 'legal_ref'";
  } else if (mode === "sources") {
    sql += " and item_type = 'source_status'";
  }
  sql += " order by status = 'deferred', created_at, review_item_id";
  return queryAll<ReviewItemRow>(store.db, sql).map((row) => ({
    reviewItemId: row.reviewItemId,
    itemType: row.itemType,
    subjectId: row.subjectId,
    reason: row.reason,
    defaultAction: row.defaultAction,
    status: row.status,
    details: JSON.parse(row.detailsJson),
  }));
}

export function nextReviewItem(store: WorkbenchStore, mode?: string): ReviewItemRecord | undefined {
  return listReviewItems(store, mode).at(0);
}
