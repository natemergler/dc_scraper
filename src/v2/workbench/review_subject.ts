import type { ReviewItemRecord } from "../domain.ts";
import { queryAll, queryOne } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

export interface ReviewSubjectSource {
  sourceId: string;
  itemTitle: string;
}

export interface EntityReviewSubject {
  itemType: "entity_candidate";
  name: string;
  entityKind: string;
  source: ReviewSubjectSource;
}

export interface RelationshipReviewSubject {
  itemType: "relationship_candidate";
  relationshipType: string;
  fromEntityRef: string;
  toEntityRef: string;
  rawValue?: string | null;
  source: ReviewSubjectSource;
}

export interface LegalRefReviewSubject {
  itemType: "legal_ref";
  citationText: string;
  refType: string;
  source: ReviewSubjectSource;
}

export type ReviewSubject =
  | EntityReviewSubject
  | RelationshipReviewSubject
  | LegalRefReviewSubject;

export interface ReviewEvidenceRow {
  fieldPath: string;
  observedValue: string;
  sourceId: string;
  artifactPath: string;
}

type ReviewSubjectSourceLookupItem = Pick<
  ReviewItemRecord,
  "reviewItemId" | "itemType" | "subjectId"
>;

interface ReviewSubjectSourceRow {
  reviewItemId: string;
  sourceId?: string | null;
}

export function reviewSubject(
  store: Pick<WorkbenchStore, "db">,
  item: Pick<ReviewItemRecord, "itemType" | "subjectId">,
): ReviewSubject | undefined {
  if (item.itemType === "entity_candidate") {
    const row = queryOne<{
      name: string;
      entityKind: string;
      sourceId: string;
      itemTitle: string;
    }>(
      store.db,
      `select entity_candidates.name as name,
              entity_candidates.kind as entityKind,
              source_items.source_id as sourceId,
              source_items.title as itemTitle
       from entity_candidates
       join source_items on source_items.source_item_id = entity_candidates.source_item_id
       where entity_candidates.candidate_id = ?`,
      [item.subjectId],
    );
    return row
      ? {
        itemType: "entity_candidate",
        name: row.name,
        entityKind: row.entityKind,
        source: {
          sourceId: row.sourceId,
          itemTitle: row.itemTitle,
        },
      }
      : undefined;
  }
  if (item.itemType === "relationship_candidate") {
    const row = queryOne<{
      relationshipType: string;
      fromEntityRef: string;
      toEntityRef: string;
      rawValue?: string | null;
      sourceId: string;
      itemTitle: string;
    }>(
      store.db,
      `select relationship_candidates.relationship_type as relationshipType,
              relationship_candidates.from_entity_ref as fromEntityRef,
              relationship_candidates.to_entity_ref as toEntityRef,
              relationship_candidates.raw_value as rawValue,
              source_items.source_id as sourceId,
              source_items.title as itemTitle
       from relationship_candidates
       join source_items on source_items.source_item_id = relationship_candidates.source_item_id
       where relationship_candidates.relationship_candidate_id = ?`,
      [item.subjectId],
    );
    return row
      ? {
        itemType: "relationship_candidate",
        relationshipType: row.relationshipType,
        fromEntityRef: row.fromEntityRef,
        toEntityRef: row.toEntityRef,
        rawValue: row.rawValue,
        source: {
          sourceId: row.sourceId,
          itemTitle: row.itemTitle,
        },
      }
      : undefined;
  }
  if (item.itemType === "legal_ref") {
    const row = queryOne<{
      citationText: string;
      refType: string;
      sourceId: string;
      itemTitle: string;
    }>(
      store.db,
      `select legal_refs.citation_text as citationText,
              legal_refs.ref_type as refType,
              source_items.source_id as sourceId,
              source_items.title as itemTitle
       from legal_refs
       join source_items on source_items.source_item_id = legal_refs.source_item_id
       where legal_refs.legal_ref_id = ?`,
      [item.subjectId],
    );
    return row
      ? {
        itemType: "legal_ref",
        citationText: row.citationText,
        refType: row.refType,
        source: {
          sourceId: row.sourceId,
          itemTitle: row.itemTitle,
        },
      }
      : undefined;
  }
  return undefined;
}

export function reviewSubjectSourceId(
  store: Pick<WorkbenchStore, "db">,
  item: Pick<ReviewItemRecord, "itemType" | "subjectId">,
): string {
  const directSourceId = directReviewSubjectSourceId(item);
  if (directSourceId !== undefined) return directSourceId;
  return reviewSubject(store, item)?.source.sourceId ?? "unknown";
}

export function reviewSubjectSourceIds(
  store: Pick<WorkbenchStore, "db">,
  items: readonly ReviewSubjectSourceLookupItem[],
): Map<string, string> {
  const sourceIds = new Map<string, string>();
  const lookupReviewItemIds: string[] = [];
  for (const item of items) {
    const directSourceId = directReviewSubjectSourceId(item);
    if (directSourceId !== undefined) {
      sourceIds.set(item.reviewItemId, directSourceId);
      continue;
    }
    lookupReviewItemIds.push(item.reviewItemId);
  }
  for (const reviewItemIdChunk of chunks(lookupReviewItemIds, 500)) {
    const placeholders = reviewItemIdChunk.map(() => "?").join(", ");
    for (
      const row of queryAll<ReviewSubjectSourceRow>(
        store.db,
        `select review_items.review_item_id as reviewItemId,
                source_items.source_id as sourceId
         from review_items
         left join entity_candidates
           on review_items.item_type = 'entity_candidate'
          and entity_candidates.candidate_id = review_items.subject_id
         left join relationship_candidates
           on review_items.item_type = 'relationship_candidate'
          and relationship_candidates.relationship_candidate_id = review_items.subject_id
         left join legal_refs
           on review_items.item_type = 'legal_ref'
          and legal_refs.legal_ref_id = review_items.subject_id
         left join source_items
           on source_items.source_item_id = coalesce(
             entity_candidates.source_item_id,
             relationship_candidates.source_item_id,
             legal_refs.source_item_id
           )
         where review_items.review_item_id in (${placeholders})`,
        reviewItemIdChunk,
      )
    ) {
      sourceIds.set(row.reviewItemId, row.sourceId ?? "unknown");
    }
  }
  for (const item of items) {
    if (!sourceIds.has(item.reviewItemId)) sourceIds.set(item.reviewItemId, "unknown");
  }
  return sourceIds;
}

export function reviewItemLabel(item: Pick<ReviewItemRecord, "subjectId" | "details">): string {
  const details = item.details;
  const candidates = [
    stringDetail(details, "name"),
    stringDetail(details, "rawValue"),
    stringDetail(details, "citationText"),
    stringDetail(details, "normalizedCitation"),
    stringDetail(details, "relationshipType") && stringDetail(details, "toName")
      ? `${stringDetail(details, "relationshipType")}: ${stringDetail(details, "toName")}`
      : undefined,
    stringDetail(details, "relationshipType") && stringDetail(details, "toEntityRef")
      ? `${stringDetail(details, "relationshipType")}: ${stringDetail(details, "toEntityRef")}`
      : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
  }
  return item.subjectId;
}

export function reviewEvidence(
  store: Pick<WorkbenchStore, "db">,
  item: Pick<ReviewItemRecord, "itemType" | "subjectId">,
): ReviewEvidenceRow[] {
  if (item.itemType === "entity_candidate") {
    return queryAll<ReviewEvidenceRow>(
      store.db,
      `select field_path as fieldPath,
              observed_value as observedValue,
              source_id as sourceId,
              artifact_path as artifactPath
       from entity_candidate_evidence
       where candidate_id = ?
       order by field_path`,
      [item.subjectId],
    );
  }
  if (item.itemType === "relationship_candidate") {
    return queryAll<ReviewEvidenceRow>(
      store.db,
      `select field_path as fieldPath,
              observed_value as observedValue,
              source_id as sourceId,
              artifact_path as artifactPath
       from relationship_candidate_evidence
       where relationship_candidate_id = ?
       order by field_path`,
      [item.subjectId],
    );
  }
  if (item.itemType === "legal_ref") {
    return queryAll<ReviewEvidenceRow>(
      store.db,
      `select field_path as fieldPath,
              observed_value as observedValue,
              source_id as sourceId,
              artifact_path as artifactPath
       from legal_ref_evidence
       where legal_ref_id = ?
       order by field_path`,
      [item.subjectId],
    );
  }
  return [];
}

function directReviewSubjectSourceId(
  item: Pick<ReviewItemRecord, "itemType" | "subjectId">,
): string | undefined {
  if (item.itemType === "source_status") return item.subjectId;
  if (item.itemType === "placeholder_entity") return "workbench";
  return undefined;
}

function stringDetail(details: Record<string, unknown>, key: string): string | undefined {
  const value = details[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
