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
}];

export function initWorkbench(store: WorkbenchStore): WorkbenchMeta {
  store.db.exec(`
create table if not exists schema_migrations (
  version integer primary key,
  name text not null,
  applied_at text not null
);
`);
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
