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
  relationshipType?: string;
  rawValue?: string;
  rawValueContains?: string;
  refType?: string;
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
  if (filters.relationshipType) {
    where.push("relationship_candidates.relationship_type = ?");
    params.push(filters.relationshipType);
  }
  if (filters.rawValue) {
    where.push("relationship_candidates.raw_value = ?");
    params.push(filters.rawValue);
  }
  if (filters.rawValueContains) {
    where.push("relationship_candidates.raw_value like ? escape '\\'");
    params.push(`%${escapeSqlLike(filters.rawValueContains)}%`);
  }
  if (filters.refType) {
    where.push("legal_refs.ref_type = ?");
    params.push(filters.refType);
  }
  const whereSql = where.length === 0 ? "1 = 1" : where.join(" and ");
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
left join legal_refs on legal_refs.legal_ref_id = review_items.subject_id
left join canonical_entities as from_entity on from_entity.entity_id = relationship_candidates.from_entity_ref
left join canonical_entities as to_entity on to_entity.entity_id = relationship_candidates.to_entity_ref
where ${whereSql}
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
  coalesce(relationship_candidates.relationship_type, ''),
  coalesce(relationship_candidates.raw_value, ''),
  coalesce(relationship_candidates.to_entity_ref, ''),
  coalesce(relationship_candidates.from_entity_ref, ''),
  coalesce(legal_refs.ref_type, ''),
  coalesce(legal_refs.normalized_citation, ''),
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
  filters: ReviewItemFilters = {},
): boolean {
  if (item.status !== "open") return false;
  if (item.itemType === "relationship_candidate") {
    return canBatchAcceptRelationshipItem(store, item, filters);
  }
  if (item.itemType === "legal_ref") {
    return canBatchAcceptLegalItem(store, item, filters);
  }
  if (item.itemType !== "entity_candidate") return false;
  if (item.details.safeToAutoAccept === true) return true;
  const candidate = queryOne<{ confidence?: number; reviewStatus: string }>(
    store.db,
    "select confidence, review_status as reviewStatus from entity_candidates where candidate_id = ?",
    [item.subjectId],
  );
  if (!candidate || candidate.reviewStatus !== "pending") return false;
  return typeof candidate.confidence === "number" && candidate.confidence >= 0.95;
}

function canBatchAcceptRelationshipItem(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
  filters: ReviewItemFilters,
): boolean {
  if (filters.mode !== "relationships" || !filters.relationshipType) return false;
  if (item.defaultAction !== "accept") return false;
  const candidate = queryOne<{
    reviewStatus: string;
    needsReview: number;
    fromReviewStatus?: string | null;
    fromIsPlaceholder?: number | null;
    toReviewStatus?: string | null;
    toIsPlaceholder?: number | null;
  }>(
    store.db,
    `select relationship_candidates.review_status as reviewStatus,
            relationship_candidates.needs_review as needsReview,
            from_entity.review_status as fromReviewStatus,
            from_entity.is_placeholder as fromIsPlaceholder,
            to_entity.review_status as toReviewStatus,
            to_entity.is_placeholder as toIsPlaceholder
     from relationship_candidates
     left join canonical_entities as from_entity
       on from_entity.entity_id = relationship_candidates.from_entity_ref
     left join canonical_entities as to_entity
       on to_entity.entity_id = relationship_candidates.to_entity_ref
     where relationship_candidates.relationship_candidate_id = ?`,
    [item.subjectId],
  );
  if (!candidate || candidate.reviewStatus !== "pending") {
    return false;
  }
  if (candidate.needsReview !== 0 && !isScopedReviewNeededRelationshipAccept(filters)) {
    return false;
  }
  return candidate.fromReviewStatus === "accepted" &&
    candidate.toReviewStatus === "accepted" &&
    candidate.fromIsPlaceholder === 0 &&
    candidate.toIsPlaceholder === 0;
}

function isScopedReviewNeededRelationshipAccept(filters: ReviewItemFilters): boolean {
  return isScopedCouncilOversightAccept(filters) || isScopedQuickbaseSeatAccept(filters);
}

function isScopedCouncilOversightAccept(filters: ReviewItemFilters): boolean {
  return filters.relationshipType === "overseen_by" &&
    Boolean(filters.subjectPrefix?.startsWith("relationship.council.committees"));
}

function isScopedQuickbaseSeatAccept(filters: ReviewItemFilters): boolean {
  return Boolean(filters.subjectPrefix?.startsWith("relationship.mota.quickbase")) &&
    (
      filters.relationshipType === "has_seat" ||
      filters.relationshipType === "appointed_by" ||
      filters.relationshipType === "designated_by"
    );
}

function canBatchAcceptLegalItem(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
  filters: ReviewItemFilters,
): boolean {
  if (filters.mode !== "legal" || !filters.subjectPrefix) return false;
  if (item.defaultAction !== "accept") return false;
  const legalRef = queryOne<{
    refType: string;
    normalizedCitation?: string | null;
    reviewStatus: string;
  }>(
    store.db,
    `select ref_type as refType,
            normalized_citation as normalizedCitation,
            review_status as reviewStatus
     from legal_refs
     where legal_ref_id = ?`,
    [item.subjectId],
  );
  if (!legalRef || legalRef.reviewStatus !== "pending") return false;
  return legalRef.refType !== "unknown" && Boolean(legalRef.normalizedCitation);
}

function normalizeReviewItemFilters(
  modeOrFilters?: string | ReviewItemFilters,
): ReviewItemFilters {
  if (typeof modeOrFilters === "string") {
    return { mode: modeOrFilters };
  }
  return modeOrFilters ?? {};
}

function escapeSqlLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function parseDetails(detailsJson: string): Record<string, unknown> {
  const details = JSON.parse(detailsJson) as Record<string, unknown>;
  return details;
}
