import type { ReviewItemRecord } from "../domain.ts";
import { queryOne } from "./db.ts";
import type { ReviewItemFilters } from "./review.ts";
import type { WorkbenchStore } from "./store.ts";

export function canBatchAcceptReviewItem(
  store: Pick<WorkbenchStore, "db">,
  item: ReviewItemRecord,
  filters: ReviewItemFilters = {},
): boolean {
  if (item.status !== "open") return false;
  if (item.details.stalePriorDecision === true) return false;
  if (item.details.replayConflict === true) return false;
  if (item.itemType === "relationship_candidate") {
    return canBatchAcceptRelationshipItem(store, item, filters);
  }
  if (item.itemType === "legal_ref") {
    return canBatchAcceptLegalItem(store, item, filters);
  }
  if (item.itemType !== "entity_candidate") return false;
  if (item.defaultAction !== "accept") return false;
  if (item.details.safeToAutoAccept === true) return true;
  const candidate = queryOne<{ confidence?: number; reviewStatus: string }>(
    store.db,
    "select confidence, review_status as reviewStatus from entity_candidates where candidate_id = ?",
    [item.subjectId],
  );
  if (!candidate || candidate.reviewStatus !== "pending") return false;
  return typeof candidate.confidence === "number" && candidate.confidence >= 0.95;
}

export function isScopedDefaultDeferBatch(filters: ReviewItemFilters): boolean {
  return Boolean(
    filters.mode &&
      filters.subjectPrefix &&
      (filters.type || filters.relationshipType || filters.rawValue || filters.rawValueContains ||
        filters.refType),
  );
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
  return isScopedCouncilOversightAccept(filters) || isScopedQuickbaseSeatAccept(filters) ||
    isScopedDcCourtsStructureAccept(filters) || isScopedBegaStructureAccept(filters);
}

function isScopedCouncilOversightAccept(filters: ReviewItemFilters): boolean {
  return filters.relationshipType === "overseen_by" &&
    Boolean(filters.subjectPrefix?.startsWith("relationship.council.committees"));
}

function isScopedQuickbaseSeatAccept(filters: ReviewItemFilters): boolean {
  return Boolean(filters.subjectPrefix?.startsWith("relationship.mota.quickbase")) &&
    (
      filters.relationshipType === "has_seat" ||
      filters.relationshipType === "has_status" ||
      filters.relationshipType === "holds" ||
      filters.relationshipType === "appointed_by" ||
      filters.relationshipType === "designated_by"
    );
}

function isScopedDcCourtsStructureAccept(filters: ReviewItemFilters): boolean {
  return Boolean(filters.subjectPrefix?.startsWith("relationship.dccourts.structure")) &&
    filters.relationshipType === "part_of";
}

function isScopedBegaStructureAccept(filters: ReviewItemFilters): boolean {
  return Boolean(filters.subjectPrefix?.startsWith("relationship.bega.structure")) &&
    filters.relationshipType === "part_of";
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
