import type { ReviewItemRecord, ReviewStatus } from "../domain.ts";
import { queryAll, queryOne } from "./db.ts";
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

export interface ReviewItemFilters {
  mode?: string;
  status?: ReviewStatus | "resolved" | "all";
  type?: ReviewItemRecord["itemType"];
  subjectPrefix?: string;
  limit?: number;
}

export function listReviewItems(
  store: WorkbenchStore,
  modeOrFilters?: string | ReviewItemFilters,
): ReviewItemRecord[] {
  const filters = normalizeReviewItemFilters(modeOrFilters);
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status === "all") {
    // include resolved items too
  } else if (filters.status) {
    where.push("review_items.status = ?");
    params.push(filters.status);
  } else {
    where.push("review_items.status != 'resolved'");
  }
  if (filters.mode === "entities") {
    where.push("review_items.item_type in ('entity_candidate', 'placeholder_entity')");
  } else if (filters.mode === "relationships") {
    where.push("review_items.item_type = 'relationship_candidate'");
  } else if (filters.mode === "legal") {
    where.push("review_items.item_type = 'legal_ref'");
  } else if (filters.mode === "sources") {
    where.push("review_items.item_type = 'source_status'");
  }
  if (filters.type) {
    where.push("review_items.item_type = ?");
    params.push(filters.type);
  }
  if (filters.subjectPrefix) {
    where.push(
      "(review_items.subject_id like ? or review_items.subject_id like ? or review_items.subject_id like ? or review_items.subject_id = ?)",
    );
    params.push(
      `${filters.subjectPrefix}%`,
      `%.${filters.subjectPrefix}%`,
      `%${filters.subjectPrefix}.%`,
      filters.subjectPrefix,
    );
  }
  const sql = `
select review_items.review_item_id as reviewItemId,
       review_items.item_type as itemType,
       review_items.subject_id as subjectId,
       review_items.reason,
       review_items.default_action as defaultAction,
       review_items.status,
       review_items.details_json as detailsJson
from review_items
left join entity_candidates on entity_candidates.candidate_id = review_items.subject_id
left join relationship_candidates on relationship_candidates.relationship_candidate_id = review_items.subject_id
left join canonical_entities as from_entity on from_entity.entity_id = relationship_candidates.from_entity_ref
left join canonical_entities as to_entity on to_entity.entity_id = relationship_candidates.to_entity_ref
where ${where.join(" and ")}
order by
  case when review_items.status = 'deferred' then 1 else 0 end,
  case
    when review_items.item_type = 'source_status' then 0
    when review_items.item_type = 'placeholder_entity' then 10
    when review_items.item_type = 'relationship_candidate'
      and (
        from_entity.entity_id is null or to_entity.entity_id is null
        or coalesce(from_entity.is_placeholder, 0) = 1
        or coalesce(to_entity.is_placeholder, 0) = 1
      ) then 20
    when review_items.item_type = 'entity_candidate'
      and coalesce(entity_candidates.confidence, 0) >= 0.9 then 30
    when review_items.item_type = 'entity_candidate' then 40
    when review_items.item_type = 'relationship_candidate' then 50
    else 60
  end,
  review_items.created_at,
  review_items.review_item_id
  ${filters.limit === undefined ? "" : "limit ?"}
`;
  if (filters.limit !== undefined) {
    params.push(filters.limit);
  }
  return queryAll<ReviewItemRow>(store.db, sql, params).map((row) => ({
    reviewItemId: row.reviewItemId,
    itemType: row.itemType,
    subjectId: row.subjectId,
    reason: row.reason,
    defaultAction: row.defaultAction,
    status: row.status,
    details: parseDetails(row.detailsJson),
  }));
}

export function nextReviewItem(
  store: WorkbenchStore,
  modeOrFilters?: string | ReviewItemFilters,
): ReviewItemRecord | undefined {
  return listReviewItems(store, modeOrFilters).at(0);
}

export function canBatchAcceptReviewItem(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
): boolean {
  if (item.status !== "open" || item.itemType !== "entity_candidate") return false;
  if (item.details.safeToAutoAccept === true) return true;
  const candidate = queryOne<{ confidence?: number; reviewStatus: string }>(
    store.db,
    "select confidence, review_status as reviewStatus from entity_candidates where candidate_id = ?",
    [item.subjectId],
  );
  if (!candidate || candidate.reviewStatus !== "pending") return false;
  return typeof candidate.confidence === "number" && candidate.confidence >= 0.95;
}

function normalizeReviewItemFilters(
  modeOrFilters?: string | ReviewItemFilters,
): ReviewItemFilters {
  if (typeof modeOrFilters === "string") {
    return { mode: modeOrFilters };
  }
  return modeOrFilters ?? {};
}

function parseDetails(detailsJson: string): Record<string, unknown> {
  const details = JSON.parse(detailsJson) as Record<string, unknown>;
  return details;
}
