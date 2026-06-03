import { nowIso, type WorkbenchMeta } from "../domain.ts";
import { queryAll, queryOne, run, withTransaction } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

export interface SchemaMigration {
  version: number;
  name: string;
  sql: string;
}

export interface SchemaMigrationRow {
  version: number;
  name: string;
  appliedAt: string;
}

export const migrations: SchemaMigration[] = [{
  version: 1,
  name: "v2_workbench_foundation",
  sql: `
create table if not exists schema_migrations (
  version integer primary key,
  name text not null,
  applied_at text not null
);

create table if not exists sources (
  source_id text primary key,
  title text not null,
  kind text not null,
  access_method text not null,
  base_url text not null,
  notes text,
  updated_at text not null
);

create table if not exists source_endpoints (
  endpoint_id text primary key,
  source_id text not null,
  title text not null,
  kind text not null,
  url text not null,
  method text not null,
  capture_mode text not null,
  updated_at text not null
);

create table if not exists source_runs (
  run_id text primary key,
  source_id text not null,
  endpoint_id text not null,
  started_at text not null,
  finished_at text,
  status text not null,
  error_text text
);

create table if not exists source_artifacts (
  artifact_id text primary key,
  run_id text not null,
  endpoint_id text not null,
  kind text not null,
  path text not null,
  fetched_url text not null,
  content_hash text not null,
  size_bytes integer not null,
  created_at text not null
);

create table if not exists source_fields (
  field_id text primary key,
  endpoint_id text not null,
  artifact_id text not null,
  field_name text not null,
  field_type text not null,
  field_label text,
  ordinal integer not null
);

create table if not exists source_items (
  source_item_id text primary key,
  source_id text not null,
  endpoint_id text not null,
  run_id text not null,
  artifact_id text not null,
  item_key text not null,
  item_type text not null,
  title text not null,
  body_json text not null
);

create table if not exists entity_candidates (
  candidate_id text primary key,
  source_item_id text not null,
  proposed_entity_id text not null,
  name text not null,
  normalized_name text not null,
  kind text not null,
  raw_kind text,
  branch text,
  cluster text,
  official_url text,
  confidence real,
  duplicate_hint text,
  review_status text not null default 'pending'
);

create table if not exists entity_candidate_evidence (
  evidence_id text primary key,
  candidate_id text not null,
  source_id text not null,
  source_item_id text not null,
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);

create table if not exists relationship_candidates (
  relationship_candidate_id text primary key,
  source_item_id text not null,
  from_entity_ref text not null,
  to_entity_ref text not null,
  relationship_type text not null,
  raw_value text,
  needs_review integer not null default 0,
  review_status text not null default 'pending'
);

create table if not exists relationship_candidate_evidence (
  evidence_id text primary key,
  relationship_candidate_id text not null,
  source_id text not null,
  source_item_id text not null,
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);

create table if not exists legal_refs (
  legal_ref_id text primary key,
  source_item_id text not null,
  ref_type text not null,
  citation_text text not null,
  normalized_citation text,
  url text,
  review_status text not null default 'pending'
);

create table if not exists legal_ref_evidence (
  evidence_id text primary key,
  legal_ref_id text not null,
  source_id text not null,
  source_item_id text not null,
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);

create table if not exists datasets (
  dataset_id text primary key,
  source_item_id text not null,
  name text not null,
  category text not null,
  owner_name text,
  access_method text not null,
  artifact_depth text not null,
  official_url text,
  review_status text not null default 'pending'
);

create table if not exists dataset_evidence (
  evidence_id text primary key,
  dataset_id text not null,
  source_id text not null,
  source_item_id text not null,
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);

create table if not exists review_items (
  review_item_id text primary key,
  item_type text not null,
  subject_id text not null,
  reason text not null,
  default_action text not null,
  status text not null default 'open',
  details_json text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists resolution_events (
  event_id text primary key,
  event_type text not null,
  subject_id text not null,
  payload_json text not null,
  resolution_file text not null,
  sequence_number integer not null,
  created_at text not null
);

create table if not exists canonical_entities (
  entity_id text primary key,
  name text not null,
  kind text not null,
  branch text,
  cluster text,
  official_url text,
  review_status text not null,
  merged_candidate_ids text not null default '[]',
  created_at text not null,
  updated_at text not null
);

create table if not exists canonical_relationships (
  relationship_id text primary key,
  from_entity_id text not null,
  relationship_type text not null,
  to_entity_id text not null,
  review_status text not null,
  source_event_id text not null,
  created_at text not null
);

create table if not exists entity_legal_refs (
  entity_legal_ref_id text primary key,
  entity_id text not null,
  legal_ref_id text not null
);

create table if not exists relationship_legal_refs (
  relationship_legal_ref_id text primary key,
  relationship_id text not null,
  legal_ref_id text not null
);
`,
}, {
  version: 2,
  name: "v2_placeholder_entities_and_artifact_precision",
  sql: `
alter table canonical_entities add column is_placeholder integer not null default 0;
alter table canonical_entities add column placeholder_reason text;
`,
}, {
  version: 3,
  name: "v2_lifecycle_indexes",
  sql: `
create index if not exists source_endpoints_source_idx on source_endpoints(source_id);
create index if not exists source_runs_source_status_idx on source_runs(source_id, status, finished_at, started_at);
create index if not exists source_artifacts_run_idx on source_artifacts(run_id, endpoint_id, created_at);
create index if not exists source_fields_endpoint_idx on source_fields(endpoint_id, ordinal);
create index if not exists source_items_source_key_idx on source_items(source_id, item_key);
create index if not exists source_items_run_idx on source_items(run_id);

create index if not exists entity_candidates_review_idx on entity_candidates(review_status, normalized_name);
create index if not exists entity_candidates_source_item_idx on entity_candidates(source_item_id);
create index if not exists entity_candidate_evidence_candidate_idx on entity_candidate_evidence(candidate_id);

create index if not exists relationship_candidates_review_idx on relationship_candidates(review_status, relationship_type);
create index if not exists relationship_candidates_source_item_idx on relationship_candidates(source_item_id);
create index if not exists relationship_candidate_evidence_candidate_idx on relationship_candidate_evidence(relationship_candidate_id);

create index if not exists legal_refs_source_item_idx on legal_refs(source_item_id);
create index if not exists legal_ref_evidence_ref_idx on legal_ref_evidence(legal_ref_id);
create index if not exists datasets_source_item_idx on datasets(source_item_id);
create index if not exists dataset_evidence_dataset_idx on dataset_evidence(dataset_id);

create index if not exists review_items_queue_idx on review_items(status, item_type, subject_id);
create unique index if not exists resolution_events_file_sequence_idx on resolution_events(resolution_file, sequence_number);
create index if not exists canonical_relationships_from_idx on canonical_relationships(from_entity_id, relationship_type);
create index if not exists canonical_relationships_to_idx on canonical_relationships(to_entity_id, relationship_type);
`,
}, {
  version: 4,
  name: "v2_relational_integrity_constraints",
  sql: `
alter table sources rename to sources_old;
create table sources (
  source_id text primary key,
  title text not null,
  kind text not null,
  access_method text not null,
  base_url text not null,
  notes text,
  updated_at text not null
);
insert into sources select source_id, title, kind, access_method, base_url, notes, updated_at from sources_old;
drop table sources_old;

alter table source_endpoints rename to source_endpoints_old;
create table source_endpoints (
  endpoint_id text primary key,
  source_id text not null references sources(source_id),
  title text not null,
  kind text not null,
  url text not null,
  method text not null,
  capture_mode text not null,
  updated_at text not null
);
insert into source_endpoints select endpoint_id, source_id, title, kind, url, method, capture_mode, updated_at from source_endpoints_old;
drop table source_endpoints_old;

alter table source_runs rename to source_runs_old;
create table source_runs (
  run_id text primary key,
  source_id text not null references sources(source_id),
  endpoint_id text not null references source_endpoints(endpoint_id),
  started_at text not null,
  finished_at text,
  status text not null check (status in ('success', 'failed')),
  error_text text
);
insert into source_runs select run_id, source_id, endpoint_id, started_at, finished_at, status, error_text from source_runs_old;
drop table source_runs_old;

alter table source_artifacts rename to source_artifacts_old;
create table source_artifacts (
  artifact_id text primary key,
  run_id text not null references source_runs(run_id),
  endpoint_id text not null references source_endpoints(endpoint_id),
  kind text not null check (kind in ('page', 'schema', 'sample', 'rows', 'documents', 'text', 'json')),
  path text not null,
  fetched_url text not null,
  content_hash text not null,
  size_bytes integer not null check (size_bytes >= 0),
  created_at text not null
);
insert into source_artifacts select artifact_id, run_id, endpoint_id, kind, path, fetched_url, content_hash, size_bytes, created_at from source_artifacts_old;
drop table source_artifacts_old;

alter table source_fields rename to source_fields_old;
create table source_fields (
  field_id text primary key,
  endpoint_id text not null references source_endpoints(endpoint_id),
  artifact_id text not null references source_artifacts(artifact_id),
  field_name text not null,
  field_type text not null,
  field_label text,
  ordinal integer not null check (ordinal >= 0)
);
insert into source_fields select field_id, endpoint_id, artifact_id, field_name, field_type, field_label, ordinal from source_fields_old;
drop table source_fields_old;

alter table source_items rename to source_items_old;
create table source_items (
  source_item_id text primary key,
  source_id text not null references sources(source_id),
  endpoint_id text not null references source_endpoints(endpoint_id),
  run_id text not null references source_runs(run_id),
  artifact_id text not null references source_artifacts(artifact_id),
  item_key text not null,
  item_type text not null,
  title text not null,
  body_json text not null check (json_valid(body_json))
);
insert into source_items select source_item_id, source_id, endpoint_id, run_id, artifact_id, item_key, item_type, title, body_json from source_items_old;
drop table source_items_old;

alter table entity_candidates rename to entity_candidates_old;
create table entity_candidates (
  candidate_id text primary key,
  source_item_id text not null references source_items(source_item_id),
  proposed_entity_id text not null,
  name text not null,
  normalized_name text not null,
  kind text not null,
  raw_kind text,
  branch text,
  cluster text,
  official_url text,
  confidence real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  duplicate_hint text,
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected'))
);
insert into entity_candidates select candidate_id, source_item_id, proposed_entity_id, name, normalized_name, kind, raw_kind, branch, cluster, official_url, confidence, duplicate_hint, review_status from entity_candidates_old;
drop table entity_candidates_old;

alter table relationship_candidates rename to relationship_candidates_old;
create table relationship_candidates (
  relationship_candidate_id text primary key,
  source_item_id text not null references source_items(source_item_id),
  from_entity_ref text not null,
  to_entity_ref text not null,
  relationship_type text not null check (relationship_type in ('part_of', 'governed_by', 'overseen_by', 'appointed_by', 'authorized_by', 'published_by')),
  raw_value text,
  needs_review integer not null default 0 check (needs_review in (0, 1)),
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected'))
);
insert into relationship_candidates select relationship_candidate_id, source_item_id, from_entity_ref, to_entity_ref, relationship_type, raw_value, needs_review, review_status from relationship_candidates_old;
drop table relationship_candidates_old;

alter table legal_refs rename to legal_refs_old;
create table legal_refs (
  legal_ref_id text primary key,
  source_item_id text not null references source_items(source_item_id),
  ref_type text not null check (ref_type in ('dc_code', 'dcmr', 'dc_register', 'mayors_order', 'unknown')),
  citation_text text not null,
  normalized_citation text,
  url text,
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected'))
);
insert into legal_refs select legal_ref_id, source_item_id, ref_type, citation_text, normalized_citation, url, review_status from legal_refs_old;
drop table legal_refs_old;

alter table datasets rename to datasets_old;
create table datasets (
  dataset_id text primary key,
  source_item_id text not null references source_items(source_item_id),
  name text not null,
  category text not null,
  owner_name text,
  access_method text not null,
  artifact_depth text not null check (artifact_depth in ('page', 'schema', 'sample', 'rows', 'documents', 'text', 'json', 'records')),
  official_url text,
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected'))
);
insert into datasets select dataset_id, source_item_id, name, category, owner_name, access_method, artifact_depth, official_url, review_status from datasets_old;
drop table datasets_old;

alter table canonical_entities rename to canonical_entities_old;
create table canonical_entities (
  entity_id text primary key,
  name text not null,
  kind text not null,
  branch text,
  cluster text,
  official_url text,
  review_status text not null check (review_status in ('accepted', 'placeholder')),
  merged_candidate_ids text not null default '[]' check (json_valid(merged_candidate_ids)),
  created_at text not null,
  updated_at text not null,
  is_placeholder integer not null default 0 check (is_placeholder in (0, 1)),
  placeholder_reason text
);
insert into canonical_entities(entity_id, name, kind, branch, cluster, official_url, review_status, merged_candidate_ids, created_at, updated_at, is_placeholder, placeholder_reason)
  select entity_id, name, kind, branch, cluster, official_url, review_status, merged_candidate_ids, created_at, updated_at, is_placeholder, placeholder_reason from canonical_entities_old;
drop table canonical_entities_old;

alter table resolution_events rename to resolution_events_old;
create table resolution_events (
  event_id text primary key,
  event_type text not null check (event_type in ('accept_entity_candidate', 'reject_entity_candidate', 'merge_entity_candidates', 'set_entity_fields', 'accept_relationship_candidate', 'reject_relationship_candidate', 'defer_review_item', 'reopen_review_item')),
  subject_id text not null,
  payload_json text not null check (json_valid(payload_json)),
  resolution_file text not null,
  sequence_number integer not null check (sequence_number > 0),
  created_at text not null
);
insert into resolution_events select event_id, event_type, subject_id, payload_json, resolution_file, sequence_number, created_at from resolution_events_old;
drop table resolution_events_old;

alter table review_items rename to review_items_old;
create table review_items (
  review_item_id text primary key,
  item_type text not null check (item_type in ('entity_candidate', 'relationship_candidate', 'legal_ref', 'dataset', 'source_status', 'placeholder_entity')),
  subject_id text not null,
  reason text not null,
  default_action text not null check (default_action in ('accept', 'reject', 'defer')),
  status text not null default 'open' check (status in ('open', 'resolved', 'deferred')),
  details_json text not null check (json_valid(details_json)),
  created_at text not null,
  updated_at text not null
);
insert into review_items select review_item_id, item_type, subject_id, reason, default_action, status, details_json, created_at, updated_at from review_items_old;
drop table review_items_old;

alter table entity_candidate_evidence rename to entity_candidate_evidence_old;
create table entity_candidate_evidence (
  evidence_id text primary key,
  candidate_id text not null references entity_candidates(candidate_id),
  source_id text not null references sources(source_id),
  source_item_id text not null references source_items(source_item_id),
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);
insert into entity_candidate_evidence select evidence_id, candidate_id, source_id, source_item_id, field_path, observed_value, artifact_path from entity_candidate_evidence_old;
drop table entity_candidate_evidence_old;

alter table relationship_candidate_evidence rename to relationship_candidate_evidence_old;
create table relationship_candidate_evidence (
  evidence_id text primary key,
  relationship_candidate_id text not null references relationship_candidates(relationship_candidate_id),
  source_id text not null references sources(source_id),
  source_item_id text not null references source_items(source_item_id),
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);
insert into relationship_candidate_evidence select evidence_id, relationship_candidate_id, source_id, source_item_id, field_path, observed_value, artifact_path from relationship_candidate_evidence_old;
drop table relationship_candidate_evidence_old;

alter table legal_ref_evidence rename to legal_ref_evidence_old;
create table legal_ref_evidence (
  evidence_id text primary key,
  legal_ref_id text not null references legal_refs(legal_ref_id),
  source_id text not null references sources(source_id),
  source_item_id text not null references source_items(source_item_id),
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);
insert into legal_ref_evidence select evidence_id, legal_ref_id, source_id, source_item_id, field_path, observed_value, artifact_path from legal_ref_evidence_old;
drop table legal_ref_evidence_old;

alter table dataset_evidence rename to dataset_evidence_old;
create table dataset_evidence (
  evidence_id text primary key,
  dataset_id text not null references datasets(dataset_id),
  source_id text not null references sources(source_id),
  source_item_id text not null references source_items(source_item_id),
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);
insert into dataset_evidence select evidence_id, dataset_id, source_id, source_item_id, field_path, observed_value, artifact_path from dataset_evidence_old;
drop table dataset_evidence_old;

alter table canonical_relationships rename to canonical_relationships_old;
create table canonical_relationships (
  relationship_id text primary key,
  from_entity_id text not null references canonical_entities(entity_id),
  relationship_type text not null check (relationship_type in ('part_of', 'governed_by', 'overseen_by', 'appointed_by', 'authorized_by', 'published_by')),
  to_entity_id text not null references canonical_entities(entity_id),
  review_status text not null check (review_status in ('accepted', 'rejected')),
  source_event_id text not null references resolution_events(event_id),
  created_at text not null
);
insert into canonical_relationships select relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at from canonical_relationships_old;
drop table canonical_relationships_old;

alter table entity_legal_refs rename to entity_legal_refs_old;
create table entity_legal_refs (
  entity_legal_ref_id text primary key,
  entity_id text not null,
  legal_ref_id text not null references legal_refs(legal_ref_id)
);
insert into entity_legal_refs select entity_legal_ref_id, entity_id, legal_ref_id from entity_legal_refs_old;
drop table entity_legal_refs_old;

alter table relationship_legal_refs rename to relationship_legal_refs_old;
create table relationship_legal_refs (
  relationship_legal_ref_id text primary key,
  relationship_id text not null,
  legal_ref_id text not null references legal_refs(legal_ref_id)
);
insert into relationship_legal_refs select relationship_legal_ref_id, relationship_id, legal_ref_id from relationship_legal_refs_old;
drop table relationship_legal_refs_old;

create index if not exists source_endpoints_source_idx on source_endpoints(source_id);
create index if not exists source_runs_source_status_idx on source_runs(source_id, status, finished_at, started_at);
create index if not exists source_artifacts_run_idx on source_artifacts(run_id, endpoint_id, created_at);
create index if not exists source_fields_endpoint_idx on source_fields(endpoint_id, ordinal);
create index if not exists source_items_source_key_idx on source_items(source_id, item_key);
create index if not exists source_items_run_idx on source_items(run_id);

create index if not exists entity_candidates_review_idx on entity_candidates(review_status, normalized_name);
create index if not exists entity_candidates_source_item_idx on entity_candidates(source_item_id);
create index if not exists entity_candidate_evidence_candidate_idx on entity_candidate_evidence(candidate_id);

create index if not exists relationship_candidates_review_idx on relationship_candidates(review_status, relationship_type);
create index if not exists relationship_candidates_source_item_idx on relationship_candidates(source_item_id);
create index if not exists relationship_candidate_evidence_candidate_idx on relationship_candidate_evidence(relationship_candidate_id);

create index if not exists legal_refs_source_item_idx on legal_refs(source_item_id);
create index if not exists legal_ref_evidence_ref_idx on legal_ref_evidence(legal_ref_id);
create index if not exists datasets_source_item_idx on datasets(source_item_id);
create index if not exists dataset_evidence_dataset_idx on dataset_evidence(dataset_id);

create index if not exists review_items_queue_idx on review_items(status, item_type, subject_id);
create unique index if not exists resolution_events_file_sequence_idx on resolution_events(resolution_file, sequence_number);
create index if not exists canonical_relationships_from_idx on canonical_relationships(from_entity_id, relationship_type);
create index if not exists canonical_relationships_to_idx on canonical_relationships(to_entity_id, relationship_type);
`,
}, {
  version: 5,
  name: "v2_legal_ref_resolution_events",
  sql: `
alter table resolution_events rename to resolution_events_old;
create table resolution_events (
  event_id text primary key,
  event_type text not null check (event_type in ('accept_entity_candidate', 'reject_entity_candidate', 'merge_entity_candidates', 'set_entity_fields', 'accept_relationship_candidate', 'reject_relationship_candidate', 'accept_legal_ref', 'reject_legal_ref', 'defer_review_item', 'reopen_review_item')),
  subject_id text not null,
  payload_json text not null check (json_valid(payload_json)),
  resolution_file text not null,
  sequence_number integer not null check (sequence_number > 0),
  created_at text not null
);
insert into resolution_events select event_id, event_type, subject_id, payload_json, resolution_file, sequence_number, created_at from resolution_events_old;
drop table resolution_events_old;

alter table canonical_relationships rename to canonical_relationships_old;
create table canonical_relationships (
  relationship_id text primary key,
  from_entity_id text not null references canonical_entities(entity_id),
  relationship_type text not null check (relationship_type in ('part_of', 'governed_by', 'overseen_by', 'appointed_by', 'authorized_by', 'published_by')),
  to_entity_id text not null references canonical_entities(entity_id),
  review_status text not null check (review_status in ('accepted', 'rejected')),
  source_event_id text not null references resolution_events(event_id),
  created_at text not null
);
insert into canonical_relationships select relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at from canonical_relationships_old;
drop table canonical_relationships_old;

create unique index if not exists resolution_events_file_sequence_idx on resolution_events(resolution_file, sequence_number);
create index if not exists canonical_relationships_from_idx on canonical_relationships(from_entity_id, relationship_type);
create index if not exists canonical_relationships_to_idx on canonical_relationships(to_entity_id, relationship_type);
`,
}, {
  version: 6,
  name: "v2_civic_structure_relationships",
  sql: `
alter table relationship_candidates rename to relationship_candidates_old;
create table relationship_candidates (
  relationship_candidate_id text primary key,
  source_item_id text not null references source_items(source_item_id),
  from_entity_ref text not null,
  to_entity_ref text not null,
  relationship_type text not null check (relationship_type in ('part_of', 'governed_by', 'overseen_by', 'appointed_by', 'authorized_by', 'published_by', 'holds', 'represents', 'member_of', 'chairs')),
  raw_value text,
  needs_review integer not null default 0 check (needs_review in (0, 1)),
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected'))
);
insert into relationship_candidates select relationship_candidate_id, source_item_id, from_entity_ref, to_entity_ref, relationship_type, raw_value, needs_review, review_status from relationship_candidates_old;
drop table relationship_candidates_old;

alter table relationship_candidate_evidence rename to relationship_candidate_evidence_old;
create table relationship_candidate_evidence (
  evidence_id text primary key,
  relationship_candidate_id text not null references relationship_candidates(relationship_candidate_id),
  source_id text not null references sources(source_id),
  source_item_id text not null references source_items(source_item_id),
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);
insert into relationship_candidate_evidence select evidence_id, relationship_candidate_id, source_id, source_item_id, field_path, observed_value, artifact_path from relationship_candidate_evidence_old;
drop table relationship_candidate_evidence_old;

alter table canonical_relationships rename to canonical_relationships_old;
create table canonical_relationships (
  relationship_id text primary key,
  from_entity_id text not null references canonical_entities(entity_id),
  relationship_type text not null check (relationship_type in ('part_of', 'governed_by', 'overseen_by', 'appointed_by', 'authorized_by', 'published_by', 'holds', 'represents', 'member_of', 'chairs')),
  to_entity_id text not null references canonical_entities(entity_id),
  review_status text not null check (review_status in ('accepted', 'rejected')),
  source_event_id text not null references resolution_events(event_id),
  created_at text not null
);
insert into canonical_relationships select relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at from canonical_relationships_old;
drop table canonical_relationships_old;

create index if not exists relationship_candidates_review_idx on relationship_candidates(review_status, relationship_type);
create index if not exists relationship_candidates_source_item_idx on relationship_candidates(source_item_id);
create index if not exists relationship_candidate_evidence_candidate_idx on relationship_candidate_evidence(relationship_candidate_id);
create index if not exists canonical_relationships_from_idx on canonical_relationships(from_entity_id, relationship_type);
create index if not exists canonical_relationships_to_idx on canonical_relationships(to_entity_id, relationship_type);
`,
}, {
  version: 7,
  name: "v2_relationship_reconciliation_foundation",
  sql: `
create table relationship_review_templates (
  review_item_id text primary key,
  subject_id text not null unique references relationship_candidates(relationship_candidate_id),
  reason text not null,
  default_action text not null check (default_action in ('accept', 'reject', 'defer')),
  details_json text not null check (json_valid(details_json)),
  created_at text not null,
  updated_at text not null
);

create table reconciliation_items (
  subject_type text not null check (subject_type in ('relationship_candidate')),
  subject_id text not null references relationship_candidates(relationship_candidate_id),
  state text not null check (state in ('blocked', 'review_ready')),
  reason text not null,
  details_json text not null check (json_valid(details_json)),
  created_at text not null,
  updated_at text not null,
  primary key (subject_type, subject_id)
);

create table reconciliation_blockers (
  subject_type text not null check (subject_type in ('relationship_candidate')),
  subject_id text not null references relationship_candidates(relationship_candidate_id),
  blocker_key text not null,
  blocker_type text not null check (blocker_type in ('endpoint')),
  blocker_id text not null,
  blocker_state text not null check (blocker_state in ('missing', 'pending_candidate', 'placeholder', 'rejected_candidate')),
  details_json text not null check (json_valid(details_json)),
  created_at text not null,
  updated_at text not null,
  primary key (subject_type, subject_id, blocker_key)
);

create index if not exists relationship_review_templates_subject_idx
  on relationship_review_templates(subject_id);
create index if not exists reconciliation_items_state_idx
  on reconciliation_items(state, subject_type, subject_id);
create index if not exists reconciliation_blockers_subject_idx
  on reconciliation_blockers(subject_type, subject_id);
 `,
}, {
  version: 8,
  name: "v2_remove_relationship_review_templates",
  sql: `
drop table if exists relationship_review_templates;
`,
}, {
  version: 9,
  name: "v2_stale_candidate_blocker_state",
  sql: `
alter table reconciliation_blockers rename to reconciliation_blockers_old;
create table reconciliation_blockers (
  subject_type text not null check (subject_type in ('relationship_candidate')),
  subject_id text not null references relationship_candidates(relationship_candidate_id),
  blocker_key text not null,
  blocker_type text not null check (blocker_type in ('endpoint')),
  blocker_id text not null,
  blocker_state text not null check (blocker_state in ('missing', 'pending_candidate', 'placeholder', 'stale_candidate', 'rejected_candidate')),
  details_json text not null check (json_valid(details_json)),
  created_at text not null,
  updated_at text not null,
  primary key (subject_type, subject_id, blocker_key)
);
insert into reconciliation_blockers
select subject_type, subject_id, blocker_key, blocker_type, blocker_id, blocker_state, details_json, created_at, updated_at
from reconciliation_blockers_old;
drop table reconciliation_blockers_old;

create index if not exists reconciliation_blockers_subject_idx
  on reconciliation_blockers(subject_type, subject_id);
`,
}, {
  version: 10,
  name: "v2_replay_conflict_blocker_state",
  sql: `
alter table reconciliation_blockers rename to reconciliation_blockers_old;
create table reconciliation_blockers (
  subject_type text not null check (subject_type in ('relationship_candidate')),
  subject_id text not null,
  blocker_key text not null,
  blocker_type text not null check (blocker_type in ('endpoint')),
  blocker_id text not null,
  blocker_state text not null check (blocker_state in ('missing', 'pending_candidate', 'placeholder', 'stale_candidate', 'replay_conflict', 'rejected_candidate')),
  details_json text not null check (json_valid(details_json)),
  created_at text not null,
  updated_at text not null,
  primary key(subject_type, subject_id, blocker_key)
);
insert into reconciliation_blockers
select subject_type, subject_id, blocker_key, blocker_type, blocker_id, blocker_state, details_json, created_at, updated_at
from reconciliation_blockers_old;
drop table reconciliation_blockers_old;

create index if not exists reconciliation_blockers_subject_idx
  on reconciliation_blockers(subject_type, subject_id);
`,
}, {
  version: 11,
  name: "v2_deferred_candidate_blocker_state",
  sql: `
alter table reconciliation_blockers rename to reconciliation_blockers_old;
create table reconciliation_blockers (
  subject_type text not null check (subject_type in ('relationship_candidate')),
  subject_id text not null,
  blocker_key text not null,
  blocker_type text not null check (blocker_type in ('endpoint')),
  blocker_id text not null,
  blocker_state text not null check (blocker_state in ('missing', 'pending_candidate', 'deferred_candidate', 'placeholder', 'stale_candidate', 'replay_conflict', 'rejected_candidate')),
  details_json text not null check (json_valid(details_json)),
  created_at text not null,
  updated_at text not null,
  primary key(subject_type, subject_id, blocker_key)
);
insert into reconciliation_blockers
select subject_type, subject_id, blocker_key, blocker_type, blocker_id, blocker_state, details_json, created_at, updated_at
from reconciliation_blockers_old;
drop table reconciliation_blockers_old;

create index if not exists reconciliation_blockers_subject_idx
  on reconciliation_blockers(subject_type, subject_id);
`,
}, {
  version: 12,
  name: "v2_public_body_seat_relationships",
  sql: `
alter table relationship_candidates rename to relationship_candidates_old;
create table relationship_candidates (
  relationship_candidate_id text primary key,
  source_item_id text not null references source_items(source_item_id),
  from_entity_ref text not null,
  to_entity_ref text not null,
  relationship_type text not null check (relationship_type in ('part_of', 'has_seat', 'has_status', 'governed_by', 'overseen_by', 'appointed_by', 'designated_by', 'authorized_by', 'published_by', 'holds', 'represents', 'member_of', 'chairs')),
  raw_value text,
  needs_review integer not null default 0 check (needs_review in (0, 1)),
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected'))
);
insert into relationship_candidates select relationship_candidate_id, source_item_id, from_entity_ref, to_entity_ref, relationship_type, raw_value, needs_review, review_status from relationship_candidates_old;
drop table relationship_candidates_old;

alter table relationship_candidate_evidence rename to relationship_candidate_evidence_old;
create table relationship_candidate_evidence (
  evidence_id text primary key,
  relationship_candidate_id text not null references relationship_candidates(relationship_candidate_id),
  source_id text not null references sources(source_id),
  source_item_id text not null references source_items(source_item_id),
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);
insert into relationship_candidate_evidence select evidence_id, relationship_candidate_id, source_id, source_item_id, field_path, observed_value, artifact_path from relationship_candidate_evidence_old;
drop table relationship_candidate_evidence_old;

alter table canonical_relationships rename to canonical_relationships_old;
create table canonical_relationships (
  relationship_id text primary key,
  from_entity_id text not null references canonical_entities(entity_id),
  relationship_type text not null check (relationship_type in ('part_of', 'has_seat', 'has_status', 'governed_by', 'overseen_by', 'appointed_by', 'designated_by', 'authorized_by', 'published_by', 'holds', 'represents', 'member_of', 'chairs')),
  to_entity_id text not null references canonical_entities(entity_id),
  review_status text not null check (review_status in ('accepted', 'rejected')),
  source_event_id text not null references resolution_events(event_id),
  created_at text not null
);
insert into canonical_relationships select relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at from canonical_relationships_old;
drop table canonical_relationships_old;

alter table reconciliation_items rename to reconciliation_items_old;
create table reconciliation_items (
  subject_type text not null check (subject_type in ('relationship_candidate')),
  subject_id text not null references relationship_candidates(relationship_candidate_id),
  state text not null check (state in ('blocked', 'review_ready')),
  reason text not null,
  details_json text not null check (json_valid(details_json)),
  created_at text not null,
  updated_at text not null,
  primary key (subject_type, subject_id)
);
insert into reconciliation_items select subject_type, subject_id, state, reason, details_json, created_at, updated_at from reconciliation_items_old;
drop table reconciliation_items_old;

alter table reconciliation_blockers rename to reconciliation_blockers_old;
create table reconciliation_blockers (
  subject_type text not null check (subject_type in ('relationship_candidate')),
  subject_id text not null,
  blocker_key text not null,
  blocker_type text not null check (blocker_type in ('endpoint')),
  blocker_id text not null,
  blocker_state text not null check (blocker_state in ('missing', 'pending_candidate', 'deferred_candidate', 'placeholder', 'stale_candidate', 'replay_conflict', 'rejected_candidate')),
  details_json text not null check (json_valid(details_json)),
  created_at text not null,
  updated_at text not null,
  primary key(subject_type, subject_id, blocker_key)
);
insert into reconciliation_blockers
select subject_type, subject_id, blocker_key, blocker_type, blocker_id, blocker_state, details_json, created_at, updated_at
from reconciliation_blockers_old;
drop table reconciliation_blockers_old;

create index if not exists relationship_candidates_review_idx on relationship_candidates(review_status, relationship_type);
create index if not exists relationship_candidates_source_item_idx on relationship_candidates(source_item_id);
create index if not exists relationship_candidate_evidence_candidate_idx on relationship_candidate_evidence(relationship_candidate_id);
create index if not exists canonical_relationships_from_idx on canonical_relationships(from_entity_id, relationship_type);
create index if not exists canonical_relationships_to_idx on canonical_relationships(to_entity_id, relationship_type);
create index if not exists reconciliation_items_state_idx
  on reconciliation_items(state, subject_type, subject_id);
create index if not exists reconciliation_blockers_subject_idx
  on reconciliation_blockers(subject_type, subject_id);
`,
}];

const reconciliationFoundationMigration = migrations.find((migration) => migration.version === 7);
const removeRelationshipReviewTemplatesMigration = migrations.find((migration) =>
  migration.version === 8
);

const reconciliationFoundationRepairSql = `
create table if not exists reconciliation_items (
  subject_type text not null check (subject_type in ('relationship_candidate')),
  subject_id text not null references relationship_candidates(relationship_candidate_id),
  state text not null check (state in ('blocked', 'review_ready')),
  reason text not null,
  details_json text not null check (json_valid(details_json)),
  created_at text not null,
  updated_at text not null,
  primary key (subject_type, subject_id)
);

create table if not exists reconciliation_blockers (
  subject_type text not null check (subject_type in ('relationship_candidate')),
  subject_id text not null references relationship_candidates(relationship_candidate_id),
  blocker_key text not null,
  blocker_type text not null check (blocker_type in ('endpoint')),
  blocker_id text not null,
  blocker_state text not null check (blocker_state in ('missing', 'pending_candidate', 'placeholder', 'rejected_candidate')),
  details_json text not null check (json_valid(details_json)),
  created_at text not null,
  updated_at text not null,
  primary key (subject_type, subject_id, blocker_key)
);

drop table if exists relationship_review_templates;

create index if not exists reconciliation_items_state_idx
  on reconciliation_items(state, subject_type, subject_id);
create index if not exists reconciliation_blockers_subject_idx
  on reconciliation_blockers(subject_type, subject_id);
`;

function tableExists(store: WorkbenchStore, tableName: string): boolean {
  return Boolean(
    queryOne<{ name: string }>(
      store.db,
      "select name from sqlite_master where type = 'table' and name = ?",
      [tableName],
    ),
  );
}

function repairLegacyReconciliationMigrationCollision(store: WorkbenchStore): void {
  const migration7 = queryOne<SchemaMigrationRow>(
    store.db,
    "select version, name, applied_at as appliedAt from schema_migrations where version = 7",
  );
  const migration8 = queryOne<SchemaMigrationRow>(
    store.db,
    "select version, name, applied_at as appliedAt from schema_migrations where version = 8",
  );
  if (!migration7 && !migration8) return;

  const expectedMigration7Name = reconciliationFoundationMigration?.name;
  const expectedMigration8Name = removeRelationshipReviewTemplatesMigration?.name;
  const namesMismatch =
    (migration7 && expectedMigration7Name && migration7.name !== expectedMigration7Name) ||
    (migration8 && expectedMigration8Name && migration8.name !== expectedMigration8Name);
  const missingFoundationTables = !tableExists(store, "reconciliation_items") ||
    !tableExists(store, "reconciliation_blockers");

  if (!namesMismatch && !missingFoundationTables) return;

  withTransaction(store.db, () => {
    if (missingFoundationTables) {
      store.db.exec(reconciliationFoundationRepairSql);
    }
    if (migration7 && expectedMigration7Name && migration7.name !== expectedMigration7Name) {
      run(
        store.db,
        "update schema_migrations set name = ? where version = 7",
        [expectedMigration7Name],
      );
    }
    if (migration8 && expectedMigration8Name && migration8.name !== expectedMigration8Name) {
      run(
        store.db,
        "update schema_migrations set name = ? where version = 8",
        [expectedMigration8Name],
      );
    }
  });
}

export function initWorkbench(store: WorkbenchStore): WorkbenchMeta {
  store.db.exec(`
create table if not exists schema_migrations (
  version integer primary key,
  name text not null,
  applied_at text not null
);
`);
  repairLegacyReconciliationMigrationCollision(store);
  for (const migration of migrations) {
    const existing = queryOne<SchemaMigrationRow>(
      store.db,
      "select version, name, applied_at as appliedAt from schema_migrations where version = ?",
      [migration.version],
    );
    if (existing) continue;
    withTransaction(store.db, () => {
      store.db.exec(migration.sql);
      run(
        store.db,
        "insert into schema_migrations(version, name, applied_at) values(?, ?, ?)",
        [migration.version, migration.name, nowIso()],
      );
    });
  }
  return readWorkbenchMeta(store);
}

export function readWorkbenchMeta(store: WorkbenchStore): WorkbenchMeta {
  const migrationRows = queryAll<SchemaMigrationRow>(
    store.db,
    "select version, name, applied_at as appliedAt from schema_migrations order by version",
  );
  return {
    dbPath: store.dbPath,
    schemaVersion: migrationRows.at(-1)?.version ?? 0,
    migrations: migrationRows,
  };
}
