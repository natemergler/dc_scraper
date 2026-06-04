import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { Database } from "@db/sqlite";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { DEFAULT_SQLITE_BUSY_TIMEOUT_MS, Workbench } from "../src/v2/workbench.ts";

function queryPlanDetails(
  db: Database,
  sql: string,
  params: string[] = [],
): string[] {
  return db.prepare(`explain query plan ${sql}`).all(...params).map((row) =>
    (row as { detail: string }).detail
  );
}

async function runSourceList(dbPath: string): Promise<Deno.CommandOutput> {
  return await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "list",
      "--db",
      dbPath,
    ],
  }).output();
}

Deno.test("fresh v2 workbench initializes and init is idempotent", async () => {
  const dir = await Deno.makeTempDir();
  await ensureDir(join(dir, "data"));
  const dbPath = join(dir, "data", "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  const first = workbench.init();
  const second = workbench.init();
  const indexes = new Set(
    workbench.db.prepare("select name from sqlite_master where type = 'index'").all().map(
      (row) => (row as { name: string }).name,
    ),
  );
  const busyTimeout = workbench.db.prepare("pragma busy_timeout").value<[number]>()?.[0];
  const journalMode = workbench.db.prepare("pragma journal_mode").value<[string]>()?.[0];
  workbench.close();
  assertEquals(first.schema.version, 17);
  assertEquals(second.schema.version, 17);
  assertEquals(second.schema, {
    version: 17,
    name: "v2_current_workbench_schema",
    initializedAt: second.schema.initializedAt,
  });
  assertEquals(busyTimeout, DEFAULT_SQLITE_BUSY_TIMEOUT_MS);
  assertEquals(journalMode, "wal");
  for (
    const indexName of [
      "source_runs_source_status_idx",
      "source_items_source_key_idx",
      "entity_candidates_proposed_idx",
      "relationship_candidates_pending_fact_idx",
      "review_items_queue_idx",
      "review_items_subject_type_idx",
      "canonical_relationships_to_idx",
      "resolution_events_file_sequence_idx",
      "resolution_events_fact_signature_idx",
    ]
  ) {
    assert(indexes.has(indexName), `missing index ${indexName}`);
  }
});

Deno.test("workbench schema indexes replay and review lookup hot paths", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const replayPlan = queryPlanDetails(
    workbench.db,
    `select event_type as eventType,
            event_id as eventId,
            json_extract(payload_json, '$.evidence_hash') as evidenceHash
     from resolution_events
     where event_type in ('accept_relationship_candidate', 'reject_relationship_candidate')
       and json_extract(payload_json, '$.fact_signature') = ?
     order by created_at desc, event_id desc
     limit 1`,
    ["relationship.fact.signature"],
  );
  const reviewPlan = queryPlanDetails(
    workbench.db,
    `select status
     from review_items
     where subject_id = ?
       and item_type = 'relationship_candidate'`,
    ["relationship.mota.quickbase.example"],
  );
  const endpointCandidatePlan = queryPlanDetails(
    workbench.db,
    `select entity_candidates.proposed_entity_id as proposedEntityId,
            source_items.source_id as sourceId,
            source_runs.started_at as runStartedAt,
            entity_candidates.review_status as reviewStatus
     from entity_candidates
     join source_items on source_items.source_item_id = entity_candidates.source_item_id
     join source_runs on source_runs.run_id = source_items.run_id
     where entity_candidates.proposed_entity_id in (?, ?)
     order by source_runs.started_at desc,
              entity_candidates.candidate_id desc`,
    ["dc.example_one", "dc.example_two"],
  );
  const pendingRelationshipPlan = queryPlanDetails(
    workbench.db,
    `select relationship_candidates.relationship_candidate_id as relationshipCandidateId
     from relationship_candidates
     join source_items on source_items.source_item_id = relationship_candidates.source_item_id
     where relationship_candidates.review_status = 'pending'`,
  );
  const autoAcceptOpenPlan = queryPlanDetails(
    workbench.db,
    `select relationship_candidates.relationship_candidate_id as relationshipCandidateId
     from review_items
     join relationship_candidates
       on relationship_candidates.relationship_candidate_id = review_items.subject_id
      and relationship_candidates.review_status = 'pending'
     join source_items on source_items.source_item_id = relationship_candidates.source_item_id
     where review_items.status = 'open'
       and review_items.item_type = 'relationship_candidate'`,
  );
  const sameFactPlan = queryPlanDetails(
    workbench.db,
    `select relationship_candidates.from_entity_ref as fromEntityRef,
            relationship_candidates.relationship_type as relationshipType,
            relationship_candidates.to_entity_ref as toEntityRef
     from relationship_candidates
     join review_items
       on review_items.subject_id = relationship_candidates.relationship_candidate_id
      and review_items.item_type = 'relationship_candidate'
     where relationship_candidates.review_status = 'pending'
       and review_items.status in ('open', 'deferred')
       and (
         review_items.default_action = 'defer'
         or json_extract(review_items.details_json, '$.whyDeferred') is not null
       )
     group by relationship_candidates.from_entity_ref,
              relationship_candidates.relationship_type,
              relationship_candidates.to_entity_ref`,
  );
  workbench.close();

  assert(
    replayPlan.some((detail) => detail.includes("resolution_events_fact_signature_idx")),
    `expected replay lookup to use resolution_events_fact_signature_idx; plan: ${
      replayPlan.join(" | ")
    }`,
  );
  assert(
    replayPlan.every((detail) => !detail.includes("USE TEMP B-TREE")),
    `expected replay lookup index order to avoid a temp sort; plan: ${replayPlan.join(" | ")}`,
  );
  assert(
    reviewPlan.some((detail) => detail.includes("review_items_subject_type_idx")),
    `expected review lookup to use review_items_subject_type_idx; plan: ${reviewPlan.join(" | ")}`,
  );
  assert(
    endpointCandidatePlan.some((detail) => detail.includes("entity_candidates_proposed_idx")),
    `expected endpoint candidate lookup to use entity_candidates_proposed_idx; plan: ${
      endpointCandidatePlan.join(" | ")
    }`,
  );
  assert(
    pendingRelationshipPlan.some((detail) =>
      detail.includes("relationship_candidates_review_idx") ||
      detail.includes("relationship_candidates_pending_fact_idx")
    ),
    `expected reconciliation to use an indexed pending relationship candidate lookup; plan: ${
      pendingRelationshipPlan.join(" | ")
    }`,
  );
  assert(
    autoAcceptOpenPlan.some((detail) => detail.includes("review_items_queue_idx")),
    `expected auto-accept to start from review_items_queue_idx; plan: ${
      autoAcceptOpenPlan.join(" | ")
    }`,
  );
  assert(
    sameFactPlan.some((detail) => detail.includes("relationship_candidates_pending_fact_idx")),
    `expected same-fact lookup to use relationship_candidates_pending_fact_idx; plan: ${
      sameFactPlan.join(" | ")
    }`,
  );
  assert(
    sameFactPlan.every((detail) => !detail.includes("USE TEMP B-TREE")),
    `expected same-fact lookup to avoid temp b-tree; plan: ${sameFactPlan.join(" | ")}`,
  );
});

Deno.test("workbench schema rejects orphan rows and invalid statuses", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const foreignKeys = workbench.db.prepare("pragma foreign_keys").value<[number]>()?.[0];
  assertEquals(foreignKeys, 1);
  assertThrows(
    () =>
      workbench.db.prepare(
        "insert into source_runs(run_id, source_id, endpoint_id, started_at, status) values('run.orphan', 'missing.source', 'missing.endpoint', datetime('now'), 'success')",
      ).run(),
    Error,
    "FOREIGN KEY constraint failed",
  );
  assertThrows(
    () =>
      workbench.db.prepare(
        "insert into review_items(review_item_id, item_type, subject_id, reason, default_action, status, details_json, created_at, updated_at) values('review.invalid', 'entity_candidate', 'candidate.invalid', 'invalid fixture', 'accept', 'mystery', '{}', datetime('now'), datetime('now'))",
      ).run(),
    Error,
    "CHECK constraint failed",
  );
  assertThrows(
    () =>
      workbench.db.prepare(
        "insert into relationship_candidates(relationship_candidate_id, source_item_id, from_entity_ref, to_entity_ref, relationship_type, needs_review, review_status) values('relationship.invalid', 'missing.item', 'dc.a', 'dc.b', 'sort_of_near', 0, 'pending')",
      ).run(),
    Error,
    "CHECK constraint failed",
  );
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.a', 'A', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into resolution_events(event_id, event_type, subject_id, payload_json, resolution_file, sequence_number, created_at) values('event.constraint', 'accept_relationship_candidate', 'relationship.constraint', '{}', 'fixture.jsonl', 1, datetime('now'))",
  ).run();
  assertThrows(
    () =>
      workbench.db.prepare(
        "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.a:part_of:dc.missing', 'dc.a', 'part_of', 'dc.missing', 'accepted', 'event.constraint', datetime('now'))",
      ).run(),
    Error,
    "FOREIGN KEY constraint failed",
  );
  workbench.close();
});

Deno.test("local workbench artifacts are ignored by git", async () => {
  const paths = [
    "data/workbench.sqlite",
    "resolutions/2026-06-01/001-auto-review.jsonl",
    "snapshots/source.json",
    "candidates/generated.json",
    "candidates_patched/generated.json",
    "records/generated.yml",
    "checks/latest.md",
    "patches/generated.jsonl",
    "releases/latest/manifest.json",
  ];
  const output = await new Deno.Command("git", {
    cwd: Deno.cwd(),
    args: ["check-ignore", ...paths],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.code, 0);
  assertEquals(new TextDecoder().decode(output.stdout).trim().split("\n"), paths);
});

Deno.test("source list fails fast for non-current local workbench DBs", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "data", "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.exec("update workbench_schema set name = 'v2_old_schema'");
  workbench.close();

  const sourceListOutput = await runSourceList(dbPath);
  assertEquals(sourceListOutput.code, 1);
  assertEquals(new TextDecoder().decode(sourceListOutput.stdout), "");
  assertStringIncludes(
    new TextDecoder().decode(sourceListOutput.stderr),
    "Local workbench DB is not a current dc_scraper workbench (found schema version 17). Point --db at a current workbench.sqlite, or delete this ignored local DB and let dc init create a fresh one.",
  );
});

Deno.test("source list does not mutate non-current databases", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "data", "workbench.sqlite");
  await ensureDir(join(dir, "data"));
  const db = new Database(dbPath);
  db.exec(`
    create table old_workbench_state (
      id text primary key,
      value text not null
    );
    insert into old_workbench_state(id, value)
    values('schema', 'not current');
  `);
  db.close();

  const sourceListOutput = await runSourceList(dbPath);
  assertEquals(sourceListOutput.code, 1);
  assertStringIncludes(
    new TextDecoder().decode(sourceListOutput.stderr),
    "Local workbench DB is not a current dc_scraper workbench (found schema version 0). Point --db at a current workbench.sqlite, or delete this ignored local DB and let dc init create a fresh one.",
  );

  const reopened = new Database(dbPath);
  const tables = new Set(
    reopened.prepare("select name from sqlite_master where type = 'table'").all().map((row) =>
      (row as { name: string }).name
    ),
  );
  reopened.close();
  assertEquals(tables.has("old_workbench_state"), true);
  assertEquals(tables.has("workbench_schema"), false);
});

Deno.test("source list rejects a current schema record when required tables are missing", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "data", "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.exec("drop table reconciliation_items");
  workbench.close();

  const sourceListOutput = await runSourceList(dbPath);

  assertEquals(sourceListOutput.code, 1);
  assertStringIncludes(
    new TextDecoder().decode(sourceListOutput.stderr),
    "Local workbench DB is not a current dc_scraper workbench (found schema version 17). Point --db at a current workbench.sqlite, or delete this ignored local DB and let dc init create a fresh one.",
  );
});

Deno.test("source list rejects current schema records with unexpected local tables", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "data", "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.exec(`
    create table scratch_notes (
      note text primary key
    );
  `);
  workbench.close();

  const sourceListOutput = await runSourceList(dbPath);

  assertEquals(sourceListOutput.code, 1);
  assertStringIncludes(
    new TextDecoder().decode(sourceListOutput.stderr),
    "Local workbench DB is not a current dc_scraper workbench (found schema version 17). Point --db at a current workbench.sqlite, or delete this ignored local DB and let dc init create a fresh one.",
  );
});
