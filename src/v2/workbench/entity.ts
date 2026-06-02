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
  sourceItemId: string;
  artifactPath: string;
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

interface EntityLegalAttachmentRow extends Record<string, string | number | null | undefined> {
  entity_id: string;
  entity_name: string;
  legal_ref_id: string;
  ref_type: string;
  citation_text: string;
  normalized_citation?: string | null;
  url?: string | null;
  review_status: string;
}

interface RelationshipLegalAttachmentRow
  extends Record<string, string | number | null | undefined> {
  relationship_id: string;
  from_entity_id: string;
  from_entity_name: string;
  relationship_type: string;
  to_entity_id: string;
  to_entity_name: string;
  legal_ref_id: string;
  ref_type: string;
  citation_text: string;
  normalized_citation?: string | null;
  url?: string | null;
  review_status: string;
}

export function searchEntities(store: WorkbenchStore, query: string): EntitySearchResult[] {
  return queryAll<EntitySearchResult>(
    store.db,
    `select entity_id as entityId, name, kind, review_status as reviewStatus, is_placeholder as isPlaceholder
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
    "select entity_id as entityId, name, kind, branch, cluster, official_url as officialUrl, review_status as reviewStatus, is_placeholder as isPlaceholder, placeholder_reason as placeholderReason from canonical_entities where entity_id = ?",
    [entityId],
  );
  if (!entity) throw new Error(`Entity not found: ${entityId}`);
  const evidence = queryAll<EntityEvidenceRow>(
    store.db,
    `select field_path as fieldPath,
            observed_value as observedValue,
            source_id as sourceId,
            source_item_id as sourceItemId,
            artifact_path as artifactPath
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
  latest_endpoint_id?: string | null;
  latest_artifact_kind?: string | null;
  latest_fetched_url?: string | null;
  latest_content_hash?: string | null;
  latest_size_bytes?: number | null;
  latest_observed_at?: string | null;
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
         select source_artifacts.endpoint_id from source_artifacts
         join source_runs on source_runs.run_id = source_artifacts.run_id
         where source_runs.source_id = sources.source_id
         order by source_artifacts.created_at desc
         limit 1
       ) as latest_endpoint_id,
       (
         select source_artifacts.kind from source_artifacts
         join source_runs on source_runs.run_id = source_artifacts.run_id
         where source_runs.source_id = sources.source_id
         order by source_artifacts.created_at desc
         limit 1
       ) as latest_artifact_kind,
       (
         select source_artifacts.fetched_url from source_artifacts
         join source_runs on source_runs.run_id = source_artifacts.run_id
         where source_runs.source_id = sources.source_id
         order by source_artifacts.created_at desc
         limit 1
       ) as latest_fetched_url,
       (
         select source_artifacts.content_hash from source_artifacts
         join source_runs on source_runs.run_id = source_artifacts.run_id
         where source_runs.source_id = sources.source_id
         order by source_artifacts.created_at desc
         limit 1
       ) as latest_content_hash,
       (
         select source_artifacts.size_bytes from source_artifacts
         join source_runs on source_runs.run_id = source_artifacts.run_id
         where source_runs.source_id = sources.source_id
         order by source_artifacts.created_at desc
         limit 1
       ) as latest_size_bytes,
       (
         select source_artifacts.created_at from source_artifacts
         join source_runs on source_runs.run_id = source_artifacts.run_id
         where source_runs.source_id = sources.source_id
         order by source_artifacts.created_at desc
         limit 1
       ) as latest_observed_at
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
  source_id: string;
  source_item_id: string;
  source_url?: string | null;
  needs_review: number;
  review_status: string;
}> {
  return queryAll(
    store.db,
    `select
      legal_refs.legal_ref_id as id,
      legal_refs.ref_type as ref_type,
      legal_refs.citation_text as citation_text,
      legal_refs.normalized_citation as normalized_citation,
      legal_refs.url as url,
      source_items.source_id as source_id,
      legal_refs.source_item_id as source_item_id,
      sources.base_url as source_url,
      case when legal_refs.review_status = 'accepted' then 0 else 1 end as needs_review,
      legal_refs.review_status as review_status
    from legal_refs
    join source_items on source_items.source_item_id = legal_refs.source_item_id
    join sources on sources.source_id = source_items.source_id
    order by
      case when legal_refs.ref_type = 'unknown' then 1 else 0 end,
      legal_refs.ref_type,
      legal_refs.normalized_citation,
      legal_refs.citation_text`,
  );
}

export function entityLegalRefs(store: WorkbenchStore): EntityLegalAttachmentRow[] {
  return queryAll(
    store.db,
    `select
      entity_legal_refs.entity_id as entity_id,
      canonical_entities.name as entity_name,
      entity_legal_refs.legal_ref_id as legal_ref_id,
      legal_refs.ref_type as ref_type,
      legal_refs.citation_text as citation_text,
      legal_refs.normalized_citation as normalized_citation,
      legal_refs.url as url,
      legal_refs.review_status as review_status
    from entity_legal_refs
    join canonical_entities on canonical_entities.entity_id = entity_legal_refs.entity_id
    join legal_refs on legal_refs.legal_ref_id = entity_legal_refs.legal_ref_id
    order by canonical_entities.name, legal_refs.normalized_citation, legal_refs.citation_text`,
  );
}

export function relationshipLegalRefs(
  store: WorkbenchStore,
): RelationshipLegalAttachmentRow[] {
  return queryAll(
    store.db,
    `select
      relationship_legal_refs.relationship_id as relationship_id,
      canonical_relationships.from_entity_id as from_entity_id,
      from_entities.name as from_entity_name,
      canonical_relationships.relationship_type as relationship_type,
      canonical_relationships.to_entity_id as to_entity_id,
      to_entities.name as to_entity_name,
      relationship_legal_refs.legal_ref_id as legal_ref_id,
      legal_refs.ref_type as ref_type,
      legal_refs.citation_text as citation_text,
      legal_refs.normalized_citation as normalized_citation,
      legal_refs.url as url,
      legal_refs.review_status as review_status
    from relationship_legal_refs
    join canonical_relationships on canonical_relationships.relationship_id = relationship_legal_refs.relationship_id
    join canonical_entities as from_entities on from_entities.entity_id = canonical_relationships.from_entity_id
    join canonical_entities as to_entities on to_entities.entity_id = canonical_relationships.to_entity_id
    join legal_refs on legal_refs.legal_ref_id = relationship_legal_refs.legal_ref_id
    order by
      from_entities.name,
      canonical_relationships.relationship_type,
      to_entities.name,
      legal_refs.normalized_citation,
      legal_refs.citation_text`,
  );
}

export function sourceArtifacts(
  store: WorkbenchStore,
): Array<{
  source_id: string;
  endpoint_id: string;
  artifact_kind: string;
  fetched_url: string;
  content_hash: string;
  size_bytes: number;
  observed_at: string;
}> {
  return queryAll(
    store.db,
    `select
      source_runs.source_id as source_id,
      source_artifacts.endpoint_id as endpoint_id,
      source_artifacts.kind as artifact_kind,
      source_artifacts.fetched_url as fetched_url,
      source_artifacts.content_hash as content_hash,
      source_artifacts.size_bytes as size_bytes,
      source_artifacts.created_at as observed_at
    from source_artifacts
    join source_runs on source_runs.run_id = source_artifacts.run_id
    order by source_runs.source_id, source_artifacts.created_at`,
  );
}
