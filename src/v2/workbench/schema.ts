import { nowIso, type WorkbenchMeta } from "../domain.ts";
import { queryAll, run, withTransaction } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

export interface WorkbenchSchemaContractRow {
  version: number;
  name: string;
  initializedAt: string;
}

const CURRENT_WORKBENCH_SCHEMA_VERSION = 16;
const CURRENT_WORKBENCH_SCHEMA_NAME = "v2_current_workbench_schema";

const CREATE_WORKBENCH_SQL = `create table sources(
  source_id text primary key,
  title text not null,
  kind text not null,
  access_method text not null,
  base_url text not null,
  notes text,
  updated_at text not null
);
create table source_endpoints(
  endpoint_id text primary key,
  source_id text not null references sources(source_id),
  title text not null,
  kind text not null,
  url text not null,
  method text not null,
  capture_mode text not null,
  updated_at text not null
);
create table source_runs(
  run_id text primary key,
  source_id text not null references sources(source_id),
  endpoint_id text not null references source_endpoints(endpoint_id),
  started_at text not null,
  finished_at text,
  status text not null check(status in('success', 'failed')),
  error_text text
);
create table source_artifacts(
  artifact_id text primary key,
  run_id text not null references source_runs(run_id),
  endpoint_id text not null references source_endpoints(endpoint_id),
  kind text not null check(kind in('page', 'schema', 'sample', 'rows', 'documents', 'text', 'json')),
  path text not null,
  fetched_url text not null,
  content_hash text not null,
  size_bytes integer not null check(size_bytes >= 0),
  created_at text not null
);
create table source_fields(
  field_id text primary key,
  endpoint_id text not null references source_endpoints(endpoint_id),
  artifact_id text not null references source_artifacts(artifact_id),
  field_name text not null,
  field_type text not null,
  field_label text,
  ordinal integer not null check(ordinal >= 0)
);
create table source_items(
  source_item_id text primary key,
  source_id text not null references sources(source_id),
  endpoint_id text not null references source_endpoints(endpoint_id),
  run_id text not null references source_runs(run_id),
  artifact_id text not null references source_artifacts(artifact_id),
  item_key text not null,
  item_type text not null,
  title text not null,
  body_json text not null check(json_valid(body_json))
);
create table entity_candidates(
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
  confidence real check(confidence is null or(confidence >= 0 and confidence <= 1)),
  duplicate_hint text,
  review_status text not null default 'pending' check(review_status in('pending', 'accepted', 'rejected'))
);
create table legal_refs(
  legal_ref_id text primary key,
  source_item_id text not null references source_items(source_item_id),
  ref_type text not null check(ref_type in('dc_code', 'dcmr', 'dc_register', 'mayors_order', 'dc_law', 'dc_act', 'dc_bill', 'public_law', 'reorganization_plan', 'unknown')),
  citation_text text not null,
  normalized_citation text,
  url text,
  review_status text not null default 'pending' check(review_status in('pending', 'accepted', 'rejected'))
);
create table datasets(
  dataset_id text primary key,
  source_item_id text not null references source_items(source_item_id),
  name text not null,
  category text not null,
  owner_name text,
  access_method text not null,
  artifact_depth text not null check(artifact_depth in('page', 'schema', 'sample', 'rows', 'documents', 'text', 'json', 'records')),
  official_url text,
  review_status text not null default 'pending' check(review_status in('pending', 'accepted', 'rejected'))
);
create table canonical_entities(
  entity_id text primary key,
  name text not null,
  kind text not null,
  branch text,
  cluster text,
  official_url text,
  review_status text not null check(review_status in('accepted', 'placeholder')),
  merged_candidate_ids text not null default '[]' check(json_valid(merged_candidate_ids)),
  created_at text not null,
  updated_at text not null,
  is_placeholder integer not null default 0 check(is_placeholder in(0, 1)),
  placeholder_reason text
);
create table review_items(
  review_item_id text primary key,
  item_type text not null check(item_type in('entity_candidate', 'relationship_candidate', 'legal_ref', 'dataset', 'source_status', 'placeholder_entity')),
  subject_id text not null,
  reason text not null,
  default_action text not null check(default_action in('accept', 'reject', 'defer')),
  status text not null default 'open' check(status in('open', 'resolved', 'deferred')),
  details_json text not null check(json_valid(details_json)),
  created_at text not null,
  updated_at text not null
);
create table entity_candidate_evidence(
  evidence_id text primary key,
  candidate_id text not null references entity_candidates(candidate_id),
  source_id text not null references sources(source_id),
  source_item_id text not null references source_items(source_item_id),
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);
create table legal_ref_evidence(
  evidence_id text primary key,
  legal_ref_id text not null references legal_refs(legal_ref_id),
  source_id text not null references sources(source_id),
  source_item_id text not null references source_items(source_item_id),
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);
create table dataset_evidence(
  evidence_id text primary key,
  dataset_id text not null references datasets(dataset_id),
  source_id text not null references sources(source_id),
  source_item_id text not null references source_items(source_item_id),
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);
create table entity_legal_refs(
  entity_legal_ref_id text primary key,
  entity_id text not null,
  legal_ref_id text not null references legal_refs(legal_ref_id)
);
create table relationship_legal_refs(
  relationship_legal_ref_id text primary key,
  relationship_id text not null,
  legal_ref_id text not null references legal_refs(legal_ref_id)
);
create index source_endpoints_source_idx on source_endpoints(source_id);
create index source_runs_source_status_idx on source_runs(source_id, status, finished_at, started_at);
create index source_artifacts_run_idx on source_artifacts(run_id, endpoint_id, created_at);
create index source_fields_endpoint_idx on source_fields(endpoint_id, ordinal);
create index source_items_source_key_idx on source_items(source_id, item_key);
create index source_items_run_idx on source_items(run_id);
create index entity_candidates_review_idx on entity_candidates(review_status, normalized_name);
create index entity_candidates_source_item_idx on entity_candidates(source_item_id);
create index entity_candidate_evidence_candidate_idx on entity_candidate_evidence(candidate_id);
create index legal_refs_source_item_idx on legal_refs(source_item_id);
create index legal_ref_evidence_ref_idx on legal_ref_evidence(legal_ref_id);
create index datasets_source_item_idx on datasets(source_item_id);
create index dataset_evidence_dataset_idx on dataset_evidence(dataset_id);
create index review_items_queue_idx on review_items(status, item_type, subject_id);
create index review_items_subject_type_idx on review_items(subject_id, item_type);
create table resolution_events(
  event_id text primary key,
  event_type text not null check(event_type in('accept_entity_candidate', 'reject_entity_candidate', 'merge_entity_candidates', 'set_entity_fields', 'accept_relationship_candidate', 'reject_relationship_candidate', 'accept_legal_ref', 'reject_legal_ref', 'defer_review_item', 'reopen_review_item')),
  subject_id text not null,
  payload_json text not null check(json_valid(payload_json)),
  resolution_file text not null,
  sequence_number integer not null check(sequence_number > 0),
  created_at text not null
);
create unique index resolution_events_file_sequence_idx on resolution_events(resolution_file, sequence_number);
create index resolution_events_fact_signature_idx on resolution_events(
  json_extract(payload_json, '$.fact_signature'),
  created_at desc,
  event_id desc,
  event_type
);
create table relationship_candidates(
  relationship_candidate_id text primary key,
  source_item_id text not null references source_items(source_item_id),
  from_entity_ref text not null,
  to_entity_ref text not null,
  relationship_type text not null check(relationship_type in('part_of', 'has_seat', 'has_status', 'governed_by', 'overseen_by', 'appointed_by', 'designated_by', 'authorized_by', 'published_by', 'holds', 'represents', 'member_of', 'chairs')),
  raw_value text,
  needs_review integer not null default 0 check(needs_review in(0, 1)),
  review_status text not null default 'pending' check(review_status in('pending', 'accepted', 'rejected'))
);
create table relationship_candidate_evidence(
  evidence_id text primary key,
  relationship_candidate_id text not null references relationship_candidates(relationship_candidate_id),
  source_id text not null references sources(source_id),
  source_item_id text not null references source_items(source_item_id),
  field_path text not null,
  observed_value text not null,
  artifact_path text not null
);
create table canonical_relationships(
  relationship_id text primary key,
  from_entity_id text not null references canonical_entities(entity_id),
  relationship_type text not null check(relationship_type in('part_of', 'has_seat', 'has_status', 'governed_by', 'overseen_by', 'appointed_by', 'designated_by', 'authorized_by', 'published_by', 'holds', 'represents', 'member_of', 'chairs')),
  to_entity_id text not null references canonical_entities(entity_id),
  review_status text not null check(review_status in('accepted', 'rejected')),
  source_event_id text not null references resolution_events(event_id),
  created_at text not null
);
create table reconciliation_items(
  subject_type text not null check(subject_type in('relationship_candidate')),
  subject_id text not null references relationship_candidates(relationship_candidate_id),
  state text not null check(state in('blocked', 'review_ready')),
  reason text not null,
  details_json text not null check(json_valid(details_json)),
  created_at text not null,
  updated_at text not null,
  primary key(subject_type, subject_id)
);
create table reconciliation_blockers(
  subject_type text not null check(subject_type in('relationship_candidate')),
  subject_id text not null,
  blocker_key text not null,
  blocker_type text not null check(blocker_type in('endpoint')),
  blocker_id text not null,
  blocker_state text not null check(blocker_state in('missing', 'pending_candidate', 'deferred_candidate', 'placeholder', 'stale_candidate', 'replay_conflict', 'rejected_candidate')),
  details_json text not null check(json_valid(details_json)),
  created_at text not null,
  updated_at text not null,
  primary key(subject_type, subject_id, blocker_key)
);
create index relationship_candidates_review_idx on relationship_candidates(review_status, relationship_type);
create index relationship_candidates_source_item_idx on relationship_candidates(source_item_id);
create index relationship_candidate_evidence_candidate_idx on relationship_candidate_evidence(relationship_candidate_id);
create index canonical_relationships_from_idx on canonical_relationships(from_entity_id, relationship_type);
create index canonical_relationships_to_idx on canonical_relationships(to_entity_id, relationship_type);
create index reconciliation_items_state_idx on reconciliation_items(state, subject_type, subject_id);
create index reconciliation_blockers_subject_idx on reconciliation_blockers(subject_type, subject_id);
`;

const EXPECTED_TABLES = new Set([
  "workbench_schema",
  "sources",
  "source_endpoints",
  "source_runs",
  "source_artifacts",
  "source_fields",
  "source_items",
  "entity_candidates",
  "entity_candidate_evidence",
  "relationship_candidates",
  "relationship_candidate_evidence",
  "legal_refs",
  "legal_ref_evidence",
  "datasets",
  "dataset_evidence",
  "review_items",
  "resolution_events",
  "canonical_entities",
  "canonical_relationships",
  "entity_legal_refs",
  "relationship_legal_refs",
  "reconciliation_items",
  "reconciliation_blockers",
]);

const EXPECTED_INDEXES = new Set([
  "source_endpoints_source_idx",
  "source_runs_source_status_idx",
  "source_artifacts_run_idx",
  "source_fields_endpoint_idx",
  "source_items_source_key_idx",
  "source_items_run_idx",
  "entity_candidates_review_idx",
  "entity_candidates_source_item_idx",
  "entity_candidate_evidence_candidate_idx",
  "relationship_candidates_review_idx",
  "relationship_candidates_source_item_idx",
  "relationship_candidate_evidence_candidate_idx",
  "legal_refs_source_item_idx",
  "legal_ref_evidence_ref_idx",
  "datasets_source_item_idx",
  "dataset_evidence_dataset_idx",
  "review_items_queue_idx",
  "review_items_subject_type_idx",
  "resolution_events_file_sequence_idx",
  "resolution_events_fact_signature_idx",
  "canonical_relationships_from_idx",
  "canonical_relationships_to_idx",
  "reconciliation_items_state_idx",
  "reconciliation_blockers_subject_idx",
]);

function currentSchemaRequiredMessage(version: number): string {
  return `Local workbench does not match the current schema contract (found version ${version}). Rebuild this ignored local DB or point --db at a current workbench.`;
}

function workbenchSchemaTableExists(store: WorkbenchStore): boolean {
  const rows = queryAll<{ name: string }>(
    store.db,
    "select name from sqlite_master where type = 'table' and name = 'workbench_schema'",
  );
  return rows.length > 0;
}

function userTableNames(store: WorkbenchStore): Set<string> {
  return new Set(
    queryAll<{ name: string }>(
      store.db,
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'",
    ).map((row) => row.name),
  );
}

function userIndexNames(store: WorkbenchStore): Set<string> {
  return new Set(
    queryAll<{ name: string }>(
      store.db,
      "select name from sqlite_master where type = 'index' and name not like 'sqlite_%'",
    ).map((row) => row.name),
  );
}

function assertCurrentWorkbenchContract(
  store: WorkbenchStore,
  schemaRow: WorkbenchSchemaContractRow | undefined,
): void {
  const version = schemaRow?.version ?? 0;
  if (
    !schemaRow ||
    schemaRow.version !== CURRENT_WORKBENCH_SCHEMA_VERSION ||
    schemaRow.name !== CURRENT_WORKBENCH_SCHEMA_NAME
  ) {
    throw new Error(currentSchemaRequiredMessage(version));
  }
  const tableNames = userTableNames(store);
  const missingTables = [...EXPECTED_TABLES].filter((name) => !tableNames.has(name));
  const unexpectedTables = [...tableNames].filter((name) => !EXPECTED_TABLES.has(name));
  if (missingTables.length > 0 || unexpectedTables.length > 0) {
    throw new Error(currentSchemaRequiredMessage(version));
  }
  const indexNames = userIndexNames(store);
  const missingIndexes = [...EXPECTED_INDEXES].filter((name) => !indexNames.has(name));
  const unexpectedIndexes = [...indexNames].filter((name) => !EXPECTED_INDEXES.has(name));
  if (missingIndexes.length > 0 || unexpectedIndexes.length > 0) {
    throw new Error(currentSchemaRequiredMessage(version));
  }
}

export function initWorkbench(store: WorkbenchStore): WorkbenchMeta {
  const existingTables = userTableNames(store);
  if (existingTables.has("workbench_schema")) {
    const schema = readWorkbenchSchemaContract(store);
    assertCurrentWorkbenchContract(store, schema);
    return {
      dbPath: store.dbPath,
      schema,
    };
  }
  if (existingTables.size > 0) {
    throw new Error(currentSchemaRequiredMessage(0));
  }
  withTransaction(store.db, () => {
    store.db.exec(`
create table workbench_schema (
  version integer primary key,
  name text not null,
  initialized_at text not null
);
`);
    store.db.exec(CREATE_WORKBENCH_SQL);
    run(
      store.db,
      "insert into workbench_schema(version, name, initialized_at) values(?, ?, ?)",
      [CURRENT_WORKBENCH_SCHEMA_VERSION, CURRENT_WORKBENCH_SCHEMA_NAME, nowIso()],
    );
  });
  return readWorkbenchMeta(store);
}

export function readWorkbenchMeta(store: WorkbenchStore): WorkbenchMeta {
  if (!workbenchSchemaTableExists(store)) {
    throw new Error(currentSchemaRequiredMessage(0));
  }
  const schema = readWorkbenchSchemaContract(store);
  assertCurrentWorkbenchContract(store, schema);
  return {
    dbPath: store.dbPath,
    schema,
  };
}

function readWorkbenchSchemaContract(store: WorkbenchStore): WorkbenchSchemaContractRow {
  const columns = new Set(
    queryAll<{ name: string }>(store.db, "pragma table_info(workbench_schema)").map((row) =>
      row.name
    ),
  );
  if (!columns.has("version") || !columns.has("name") || !columns.has("initialized_at")) {
    throw new Error(currentSchemaRequiredMessage(0));
  }
  const schema = queryAll<WorkbenchSchemaContractRow>(
    store.db,
    "select version, name, initialized_at as initializedAt from workbench_schema",
  );
  if (schema.length !== 1) {
    throw new Error(currentSchemaRequiredMessage(schema.at(-1)?.version ?? 0));
  }
  return schema[0];
}
