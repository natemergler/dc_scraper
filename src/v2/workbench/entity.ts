import {
  type EntitySearchResult,
  type EntityView,
  inverseRelationshipType,
  type ReviewItemRecord,
  type ReviewStatus,
} from "../domain.ts";
import { queryAll, queryOne } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

interface EntityCoreRow {
  entityId: string;
  name: string;
  kind: string;
  branch?: string;
  cluster?: string;
  officialUrl?: string;
  reviewStatus: string;
}

interface EntityEvidenceRow {
  fieldPath: string;
  observedValue: string;
  sourceId: string;
}

interface EntityRelationshipRow {
  relationshipType: string;
  targetEntityId: string;
  targetName: string;
}

interface EntityIncomingRow {
  relationshipType: string;
  sourceEntityId: string;
  sourceName: string;
}

interface EntityReviewItemRow {
  reviewItemId: string;
  itemType: ReviewItemRecord["itemType"];
  subjectId: string;
  reason: string;
  defaultAction: string;
  status: ReviewStatus;
  detailsJson: string;
}

interface EntityLegalRefRow {
  citationText: string;
  normalizedCitation?: string;
  refType: string;
}

export function searchEntities(store: WorkbenchStore, query: string): EntitySearchResult[] {
  return queryAll<EntitySearchResult>(
    store.db,
    `select entity_id as entityId, name, kind, review_status as reviewStatus
     from canonical_entities
     where entity_id like ? collate nocase or name like ? collate nocase
     order by name`,
    [`%${query}%`, `%${query}%`],
  );
}

export function entityView(store: WorkbenchStore, entityId: string): EntityView {
  const entity = queryOne<
    Omit<EntityView, "evidence" | "outgoing" | "incoming" | "reviewItems" | "legalRefs">
  >(
    store.db,
    "select entity_id as entityId, name, kind, branch, cluster, official_url as officialUrl, review_status as reviewStatus from canonical_entities where entity_id = ?",
    [entityId],
  );
  if (!entity) throw new Error(`Entity not found: ${entityId}`);
  const evidence = queryAll<EntityEvidenceRow>(
    store.db,
    `select field_path as fieldPath, observed_value as observedValue, source_id as sourceId
     from entity_candidate_evidence
     where candidate_id in (
       select value from json_each((select merged_candidate_ids from canonical_entities where entity_id = ?))
     )
     order by field_path`,
    [entityId],
  );
  const outgoing = queryAll<EntityRelationshipRow>(
    store.db,
    `select canonical_relationships.relationship_type as relationshipType,
            canonical_relationships.to_entity_id as targetEntityId,
            canonical_entities.name as targetName
     from canonical_relationships
     join canonical_entities on canonical_entities.entity_id = canonical_relationships.to_entity_id
     where canonical_relationships.from_entity_id = ?
     order by canonical_relationships.relationship_type, canonical_entities.name`,
    [entityId],
  );
  const incomingRows = queryAll<EntityIncomingRow>(
    store.db,
    `select canonical_relationships.relationship_type as relationshipType,
            canonical_relationships.from_entity_id as sourceEntityId,
            canonical_entities.name as sourceName
     from canonical_relationships
     join canonical_entities on canonical_entities.entity_id = canonical_relationships.from_entity_id
     where canonical_relationships.to_entity_id = ?
     order by canonical_relationships.relationship_type, canonical_entities.name`,
    [entityId],
  );
  const reviewItems = queryAll<EntityReviewItemRow>(
    store.db,
    "select review_item_id as reviewItemId, item_type as itemType, subject_id as subjectId, reason, default_action as defaultAction, status, details_json as detailsJson from review_items where status != 'resolved' and (subject_id = ? or subject_id like ?)",
    [entityId, `%${entityId}%`],
  );
  const legalRefs = queryAll<EntityLegalRefRow>(
    store.db,
    `select legal_refs.citation_text as citationText,
            legal_refs.normalized_citation as normalizedCitation,
            legal_refs.ref_type as refType
     from legal_refs
     join entity_legal_refs on entity_legal_refs.legal_ref_id = legal_refs.legal_ref_id
     where entity_legal_refs.entity_id = ?
     order by legal_refs.normalized_citation, legal_refs.citation_text`,
    [entityId],
  );
  return {
    ...entity,
    evidence,
    outgoing,
    incoming: incomingRows.map((row) => ({
      relationshipType: inverseRelationshipType(row.relationshipType),
      sourceEntityId: row.sourceEntityId,
      sourceName: row.sourceName,
    })),
    reviewItems: reviewItems.map((row) => ({
      reviewItemId: row.reviewItemId,
      itemType: row.itemType,
      subjectId: row.subjectId,
      reason: row.reason,
      defaultAction: row.defaultAction,
      status: row.status,
      details: JSON.parse(row.detailsJson),
    })),
    legalRefs,
  };
}

export function canonicalEntities(store: WorkbenchStore): Array<{
  id: string;
  name: string;
  kind: string;
  branch?: string | null;
  cluster?: string | null;
  official_url?: string | null;
  review_status: string;
}> {
  return queryAll(
    store.db,
    "select entity_id as id, name, kind, branch, cluster, official_url as official_url, review_status as review_status from canonical_entities order by name",
  );
}

export function canonicalRelationships(store: WorkbenchStore): Array<{
  id: string;
  from_entity_id: string;
  relationship_type: string;
  to_entity_id: string;
  review_status: string;
}> {
  return queryAll(
    store.db,
    "select relationship_id as id, from_entity_id, relationship_type, to_entity_id, review_status from canonical_relationships order by from_entity_id, relationship_type, to_entity_id",
  );
}

export function sourceInventory(store: WorkbenchStore): Array<{
  source_id: string;
  title: string;
  kind: string;
  access_method: string;
  latest_status?: string | null;
  latest_run_finished_at?: string | null;
  latest_artifact_path?: string | null;
}> {
  return queryAll(
    store.db,
    `select
       sources.source_id as source_id,
       sources.title as title,
       sources.kind as kind,
       sources.access_method as access_method,
       (
         select status from source_runs
         where source_runs.source_id = sources.source_id
         order by coalesce(finished_at, started_at) desc
         limit 1
       ) as latest_status,
       (
         select finished_at from source_runs
         where source_runs.source_id = sources.source_id
         order by coalesce(finished_at, started_at) desc
         limit 1
       ) as latest_run_finished_at,
       (
         select path from source_artifacts
         join source_runs on source_runs.run_id = source_artifacts.run_id
         where source_runs.source_id = sources.source_id
         order by source_artifacts.created_at desc
         limit 1
       ) as latest_artifact_path
     from sources
     order by sources.source_id`,
  );
}

export function datasets(store: WorkbenchStore): Array<{
  id: string;
  name: string;
  category: string;
  owner_name?: string | null;
  access_method: string;
  artifact_depth: string;
  official_url?: string | null;
  review_status: string;
}> {
  return queryAll(
    store.db,
    "select dataset_id as id, name, category, owner_name, access_method, artifact_depth, official_url, review_status from datasets order by name",
  );
}

export function legalRefs(store: WorkbenchStore): Array<{
  id: string;
  ref_type: string;
  citation_text: string;
  normalized_citation?: string | null;
  url?: string | null;
  review_status: string;
}> {
  return queryAll(
    store.db,
    "select legal_ref_id as id, ref_type, citation_text, normalized_citation, url, review_status from legal_refs order by normalized_citation, citation_text",
  );
}

export function artifactHashes(
  store: WorkbenchStore,
): Array<{ path: string; contentHash: string }> {
  return queryAll(
    store.db,
    "select path, content_hash as contentHash from source_artifacts order by path",
  );
}
