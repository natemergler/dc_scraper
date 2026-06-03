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
  if (item.itemType === "source_status") return item.subjectId;
  if (item.itemType === "placeholder_entity") return "workbench";
  return reviewSubject(store, item)?.source.sourceId ?? "unknown";
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
