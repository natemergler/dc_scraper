import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { buildV2Release } from "../src/v2/release.ts";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildKnownEntityRef } from "../src/v2/connectors/shared.ts";
import { buildEntityId, parseLegalReference } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  admin311Fixture,
  admin311WrongLayerFixture,
  adminBudgetPageFixture,
  adminProcurementPageFixture,
  ancListingFixture,
  ancProfile34gFixture,
  ancProfile6cFixture,
  arcgisLayerDetailFixture,
  arcgisServiceLayersFixture,
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
  councilMembersFixture,
  dcgisBoardsCommissionsCouncilsMetadataFixture,
  dcgisBoardsCommissionsCouncilsRowsFixture,
  dcgisMetadataFixture,
  dcgisRowsFixture,
  legalEntrypointsFixture,
  limsFixture,
  openDcBoardFixture,
  openDcCommissionFixture,
  openDcIndexFixture,
  openDcStreetHarassmentFixture,
  openDcTaskForceFixture,
  quickbaseAppointmentsCsvFixture,
  quickbaseFixture,
} from "./helpers/v2_fixtures.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

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
  workbench.close();
  assertEquals(first.schemaVersion, 11);
  assertEquals(second.schemaVersion, 11);
  assertEquals(second.migrations.length, 11);
  for (
    const indexName of [
      "source_runs_source_status_idx",
      "source_items_source_key_idx",
      "review_items_queue_idx",
      "canonical_relationships_to_idx",
      "resolution_events_file_sequence_idx",
    ]
  ) {
    assert(indexes.has(indexName), `missing index ${indexName}`);
  }
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

Deno.test("top-level CLI aliases make the workbench easy to enter", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "data", "workbench.sqlite");
  const initOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "init",
      "--db",
      dbPath,
    ],
  }).output();
  assertEquals(initOutput.code, 0);
  assertStringIncludes(new TextDecoder().decode(initOutput.stdout), "Initialized v2 workbench");

  const statusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
    ],
  }).output();
  assertEquals(statusOutput.code, 0);
  const statusText = new TextDecoder().decode(statusOutput.stdout);
  assertStringIncludes(statusText, "Schema version: 11");
  assertStringIncludes(statusText, "Sources: 0/");
  assertStringIncludes(statusText, "Review: 0 open, 0 deferred");
  assertStringIncludes(statusText, "Reconciliation: 0 blocked");
  assertStringIncludes(statusText, "Next: dc source list");

  const jsonStatusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(jsonStatusOutput.code, 0);
  const jsonStatus = JSON.parse(new TextDecoder().decode(jsonStatusOutput.stdout)) as {
    schemaVersion: number;
    sources: { fetched: number; total: number };
    review: { open: number; deferred: number };
    reconciliation: { blocked: number };
    nextCommand: string;
  };
  assertEquals(jsonStatus.schemaVersion, 11);
  assertEquals(jsonStatus.sources.fetched, 0);
  assertEquals(jsonStatus.review.open, 0);
  assertEquals(jsonStatus.reconciliation.blocked, 0);
  assertEquals(jsonStatus.nextCommand, "dc source list");

  const sourceListOutput = await new Deno.Command(Deno.execPath(), {
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
  assertEquals(sourceListOutput.code, 0);
  const sourceListText = new TextDecoder().decode(sourceListOutput.stdout);
  assertStringIncludes(sourceListText, "dcgis.agencies unfetched");
  assertStringIncludes(sourceListText, "mota.quickbase unfetched");

  const sourceListJsonOutput = await new Deno.Command(Deno.execPath(), {
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
      "--json",
    ],
  }).output();
  assertEquals(sourceListJsonOutput.code, 0);
  const sourceListJson = JSON.parse(
    new TextDecoder().decode(sourceListJsonOutput.stdout),
  ) as Array<{ sourceId: string; title: string; status: string }>;
  assert(
    sourceListJson.some((row) =>
      row.sourceId === "dcgis.agencies" &&
      row.title === "District Government Agencies" &&
      row.status === "unfetched"
    ),
  );

  const unfetchedInspectOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "inspect",
      "dcgis.agencies",
      "--db",
      dbPath,
    ],
  }).output();
  const unfetchedInspectText = new TextDecoder().decode(unfetchedInspectOutput.stdout);
  assertEquals(unfetchedInspectOutput.code, 0);
  assertStringIncludes(unfetchedInspectText, "dcgis.agencies - District Government Agencies");
  assertStringIncludes(unfetchedInspectText, "Latest status: unfetched");

  const unfetchedInspectJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "inspect",
      "dcgis.agencies",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const unfetchedInspectJson = JSON.parse(
    new TextDecoder().decode(unfetchedInspectJsonOutput.stdout),
  ) as { sourceId: string; latestStatus: string; itemCount: number };
  assertEquals(unfetchedInspectJsonOutput.code, 0);
  assertEquals(unfetchedInspectJson.sourceId, "dcgis.agencies");
  assertEquals(unfetchedInspectJson.latestStatus, "unfetched");
  assertEquals(unfetchedInspectJson.itemCount, 0);
});

Deno.test("source list repairs legacy migration-version collisions in existing workbenches", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "data", "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.exec(`
update schema_migrations
set name = 'v2_public_body_seat_relationships'
where version = 7;
update schema_migrations
set name = 'v2_public_body_seat_status_relationships'
where version = 8;
drop table reconciliation_items;
drop table reconciliation_blockers;
`);
  workbench.close();

  const sourceListOutput = await new Deno.Command(Deno.execPath(), {
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
  assertEquals(sourceListOutput.code, 0);
  const sourceListText = new TextDecoder().decode(sourceListOutput.stdout);
  assertStringIncludes(sourceListText, "dcgis.agencies unfetched");
  assertStringIncludes(sourceListText, "mota.quickbase unfetched");

  const repairedWorkbench = new Workbench(dbPath);
  const meta = repairedWorkbench.init();
  const tables = new Set(
    repairedWorkbench.db.prepare("select name from sqlite_master where type = 'table'").all().map(
      (row) => (row as { name: string }).name,
    ),
  );
  repairedWorkbench.close();

  assertEquals(meta.schemaVersion, 11);
  assert(tables.has("reconciliation_items"));
  assert(tables.has("reconciliation_blockers"));
  assert(
    meta.migrations.some((migration) =>
      migration.version === 7 &&
      migration.name === "v2_relationship_reconciliation_foundation"
    ),
  );
  assert(
    meta.migrations.some((migration) =>
      migration.version === 8 &&
      migration.name === "v2_remove_relationship_review_templates"
    ),
  );
});

Deno.test("CLI command errors print a concise message", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const output = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "fetch",
      "not.a.source",
      "--db",
      dbPath,
    ],
  }).output();
  const stderr = new TextDecoder().decode(output.stderr);
  assertEquals(output.code, 1);
  assertStringIncludes(stderr, "Unknown v2 source: not.a.source");
  assert(!stderr.includes(" at "));
});

Deno.test("focused CLI help exits zero and does not run commands", async () => {
  const topLevelHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "--help",
    ],
  }).output();
  const topLevelText = new TextDecoder().decode(topLevelHelp.stdout);
  assertEquals(topLevelHelp.code, 0);
  assertStringIncludes(topLevelText, "Workflow:");
  assertStringIncludes(topLevelText, "dc source fetch --all");
  assertStringIncludes(topLevelText, "dc audit");
  assertStringIncludes(topLevelText, "dc review | dc review list --mode entities");

  const auditHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "audit",
      "--help",
    ],
  }).output();
  const auditText = new TextDecoder().decode(auditHelp.stdout);
  assertEquals(auditHelp.code, 0);
  assertStringIncludes(auditText, "Usage:");
  assertStringIncludes(auditText, "dc audit [--db <path>] [--json]");
  assertStringIncludes(auditText, "dc audit doctor [--db <path>] [--json]");

  const sourceHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "--help",
    ],
  }).output();
  const sourceText = new TextDecoder().decode(sourceHelp.stdout);
  assertEquals(sourceHelp.code, 0);
  assertStringIncludes(sourceText, "Workflow:");
  assertStringIncludes(sourceText, "dc source list");
  assertStringIncludes(sourceText, "dc source fetch <source-id>");
  assertStringIncludes(sourceText, "dc source fetch --all");
  assertStringIncludes(sourceText, "dc source inspect <source-id>");

  const reviewHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "--help",
    ],
  }).output();
  const reviewText = new TextDecoder().decode(reviewHelp.stdout);
  assertEquals(reviewHelp.code, 0);
  assertStringIncludes(reviewText, "Workflow:");
  assertStringIncludes(reviewText, "Usage:");
  assertStringIncludes(reviewText, "dc review [entities|relationships|legal|sources]");
  assertStringIncludes(reviewText, "dc review list");
  assert(!reviewText.includes("No review items remain."));

  const reviewModeHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "relationships",
      "--help",
    ],
  }).output();
  const reviewModeText = new TextDecoder().decode(reviewModeHelp.stdout);
  assertEquals(reviewModeHelp.code, 0);
  assertStringIncludes(reviewModeText, "dc review [entities|relationships|legal|sources]");
  assertStringIncludes(reviewModeText, "dc review batch accept-safe");
  assert(!reviewModeText.includes("No review items remain."));

  const reviewBatchHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "--help",
    ],
  }).output();
  const reviewBatchText = new TextDecoder().decode(reviewBatchHelp.stdout);
  assertEquals(reviewBatchHelp.code, 0);
  assertStringIncludes(reviewBatchText, "Workflow:");
  assertStringIncludes(reviewBatchText, "dc review batch accept-safe --mode entities");
  assertStringIncludes(reviewBatchText, "dc review batch defer-default --mode relationships");

  const entityHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
      "--help",
    ],
  }).output();
  const entityText = new TextDecoder().decode(entityHelp.stdout);
  assertEquals(entityHelp.code, 0);
  assertStringIncludes(entityText, "Workflow:");
  assertStringIncludes(entityText, "dc entity search <query>");
  assertStringIncludes(entityText, "dc entity show <entity-id>");

  const entityBare = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
    ],
  }).output();
  const entityBareText = new TextDecoder().decode(entityBare.stdout);
  assertEquals(entityBare.code, 0);
  assertStringIncludes(entityBareText, "dc entity");
  assertStringIncludes(entityBareText, "dc entity search <query>");

  const entitySearchHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
      "search",
      "--help",
    ],
  }).output();
  const entitySearchHelpText = new TextDecoder().decode(entitySearchHelp.stdout);
  assertEquals(entitySearchHelp.code, 0);
  assertStringIncludes(entitySearchHelpText, "dc entity search <query>");
  assert(!entitySearchHelpText.includes("[]"));

  const entityShowHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
      "show",
      "--help",
    ],
  }).output();
  const entityShowHelpText = new TextDecoder().decode(entityShowHelp.stdout);
  assertEquals(entityShowHelp.code, 0);
  assertStringIncludes(entityShowHelpText, "dc entity show <entity-id>");

  const releaseHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "--help",
    ],
  }).output();
  const releaseText = new TextDecoder().decode(releaseHelp.stdout);
  const releaseError = new TextDecoder().decode(releaseHelp.stderr);
  assertEquals(releaseHelp.code, 0);
  assertStringIncludes(releaseText, "Workflow:");
  assertStringIncludes(releaseText, "Usage:");
  assertStringIncludes(releaseText, "dc release build");
  assertStringIncludes(releaseText, "dc release inspect");
  assertEquals(releaseError, "");

  const releaseBare = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
    ],
  }).output();
  const releaseBareText = new TextDecoder().decode(releaseBare.stdout);
  assertEquals(releaseBare.code, 0);
  assertStringIncludes(releaseBareText, "dc release");
  assertStringIncludes(releaseBareText, "dc release build");

  const releaseBuildHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "build",
      "--help",
    ],
  }).output();
  const releaseBuildHelpText = new TextDecoder().decode(releaseBuildHelp.stdout);
  assertEquals(releaseBuildHelp.code, 0);
  assertStringIncludes(releaseBuildHelpText, "dc release build");
  assertStringIncludes(releaseBuildHelpText, "dc release inspect");
  assert(!releaseBuildHelpText.includes("Built v2 release"));

  const releaseInspectHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--help",
    ],
  }).output();
  const releaseInspectHelpText = new TextDecoder().decode(releaseInspectHelp.stdout);
  assertEquals(releaseInspectHelp.code, 0);
  assertStringIncludes(releaseInspectHelpText, "dc release inspect");
  assert(!releaseInspectHelpText.includes("Release: "));
});

Deno.test("source prefix commands guide the operator toward the next fetch action", async () => {
  const sourceOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
    ],
  }).output();
  const sourceText = new TextDecoder().decode(sourceOutput.stdout);
  assertEquals(sourceOutput.code, 0);
  assertStringIncludes(sourceText, "dc source");
  assertStringIncludes(sourceText, "Available sources:");
  assertStringIncludes(sourceText, "dcgis.agencies");
  assertStringIncludes(sourceText, "Tip: run `dc source list`");

  const fetchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "fetch",
    ],
  }).output();
  const fetchText = new TextDecoder().decode(fetchOutput.stdout);
  assertEquals(fetchOutput.code, 0);
  assertStringIncludes(fetchText, "dc source fetch <source-id>");
  assertStringIncludes(fetchText, "dc source fetch --all");
  assertStringIncludes(fetchText, "Tip: run `dc source fetch --all`");
  assertStringIncludes(fetchText, "dc source list");
});

Deno.test("review prefix commands guide the operator toward the next safe review action", async () => {
  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
    ],
  }).output();
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertEquals(batchOutput.code, 0);
  assertStringIncludes(batchText, "dc review batch");
  assertStringIncludes(batchText, "dc status");
  assertStringIncludes(batchText, "dc review batch accept-safe --mode entities");

  const batchFlagOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "--db",
      join(Deno.cwd(), "data", "workbench.sqlite"),
    ],
  }).output();
  const batchFlagText = new TextDecoder().decode(batchFlagOutput.stdout);
  assertEquals(batchFlagOutput.code, 0);
  assertStringIncludes(batchFlagText, "dc review batch");
  assertStringIncludes(batchFlagText, "dc status");

  const acceptSafeOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
    ],
  }).output();
  const acceptSafeText = new TextDecoder().decode(acceptSafeOutput.stdout);
  assertEquals(acceptSafeOutput.code, 0);
  assertStringIncludes(acceptSafeText, "dc review batch accept-safe");
  assertStringIncludes(acceptSafeText, "--mode entities");
  assertStringIncludes(acceptSafeText, "Tip: run `dc status`");
});

Deno.test("entity prefix commands guide the operator toward the next lookup action", async () => {
  const entityOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
    ],
  }).output();
  const entityText = new TextDecoder().decode(entityOutput.stdout);
  assertEquals(entityOutput.code, 0);
  assertStringIncludes(entityText, "dc entity");
  assertStringIncludes(entityText, "dc entity search");
  assertStringIncludes(entityText, "dc entity show");

  const searchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
      "search",
    ],
  }).output();
  const searchText = new TextDecoder().decode(searchOutput.stdout);
  assertEquals(searchOutput.code, 0);
  assertStringIncludes(searchText, "dc entity search <query>");
  assertStringIncludes(searchText, "Tip: run `dc entity search District`");
});

Deno.test("imports representative connector results and source inspection stays queryable after failures", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const responses = new Map<string, string>([
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json",
      JSON.stringify(dcgisMetadataFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json",
      JSON.stringify(dcgisRowsFixture),
    ],
    ["https://www.open-dc.gov/public-bodies", openDcIndexFixture],
    ["https://www.open-dc.gov/public-bodies/board-accountancy", openDcBoardFixture],
    [
      "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force",
      openDcTaskForceFixture,
    ],
    ["https://dccouncil.gov/committees/", councilCommitteesFixture],
    [
      "https://dccouncil.gov/committees/committee-of-the-whole/",
      councilCommitteeWholeDetailFixture,
    ],
    ["https://dccouncil.gov/committees/committee-on-health/", councilCommitteeHealthDetailFixture],
    ["https://lims.dccouncil.gov/api/Search/GetWhatsNew", limsFixture],
    [
      "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0",
      quickbaseFixture,
    ],
    [
      "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs",
      quickbaseAppointmentsCsvFixture,
    ],
    ["https://dc.gov/page/laws-regulations-and-courts", legalEntrypointsFixture],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/ServiceRequests/FeatureServer/21?f=json",
      admin311Fixture,
    ],
    ["https://cfo.dc.gov/budget", adminBudgetPageFixture],
    ["https://ocp.dc.gov/page/doing-business-dc-government", adminProcurementPageFixture],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer/46?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Certificate of Occupancy")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer/45?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Home Occupancy Permit")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer/5?f=json",
      JSON.stringify(arcgisLayerDetailFixture("ABCA Liquor License Locations")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/7?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Bias Crime")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/24?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Vehicular Crash Data")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/29?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Shot Spotter Gun Shots")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/10?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Certificate Of Occupancy Points")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/39?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Tax Lots")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/33?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Parcel Lots")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/35?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Reservations")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/8?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Mail Ballot Drop Boxes")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/9?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Election Day Vote Center")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/10?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Early Vote Center")),
    ],
  ]);
  const fetcher = async (url: string) => {
    const body = responses.get(url);
    if (!body) throw new Error(`Unexpected fixture url ${url}`);
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };
  for (
    const sourceId of [
      "dcgis.agencies",
      "open_dc.public_bodies",
      "council.committees",
      "council.lims",
      "mota.quickbase",
      "legal.entrypoints",
      "admin.service_requests_311",
      "admin.budget_sources",
      "admin.permits_licenses",
      "admin.crime_public_safety",
      "admin.procurement_sources",
      "admin.property_land",
      "admin.elections",
    ]
  ) {
    const connector = getConnector(sourceId);
    const result = await connector.run(createConnectorContext({ fetcher, limit: 2 }));
    await workbench.importConnectorResult(result, dataDir);
  }
  const dcgis = workbench.sourceSummary("dcgis.agencies");
  const quickbase = workbench.sourceSummary("mota.quickbase");
  const permitSummary = workbench.sourceSummary("admin.permits_licenses");
  const categories = new Set(workbench.datasets().map((dataset) => dataset.category));
  const hasRegisterRef = workbench.legalRefs().some((ref) => ref.ref_type === "dc_register");
  const branchEntity = workbench.db.prepare(
    "select entity_id as entityId, review_status as reviewStatus from canonical_entities where entity_id = 'dc.executive_branch'",
  ).get() as { entityId: string; reviewStatus: string } | undefined;
  workbench.close();
  assertEquals(dcgis.fieldCount, 7);
  assertEquals(dcgis.entityCandidateCount, 3);
  assertEquals(dcgis.relationshipCandidateCount, 2);
  assertEquals(branchEntity?.entityId, "dc.executive_branch");
  assertEquals(branchEntity?.reviewStatus, "accepted");
  assertEquals(quickbase.latestStatus, "success");
  assertStringIncludes(quickbase.latestArtifactPath ?? "", "mota.quickbase");
  assertEquals(quickbase.itemCount > 0, true);
  assertEquals(quickbase.entityCandidateCount > 0, true);
  assertEquals(quickbase.relationshipCandidateCount > 0, true);
  assertEquals(hasRegisterRef, true);
  assertEquals(permitSummary.fieldCount > 0, true);
  assertEquals(categories.has("procurement"), true);
  assertEquals(categories.has("budget"), true);
  assertEquals(categories.has("crime_incidents"), true);
});

Deno.test("failed parsed imports keep artifacts but roll back partial typed rows", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await assertRejects(
    () =>
      workbench.importConnectorResult(
        {
          source: {
            sourceId: "test.bad_parse",
            title: "Bad Parse Fixture",
            kind: "fixture",
            accessMethod: "fixture",
            baseUrl: "https://example.test",
          },
          endpointResults: [{
            endpoint: {
              endpointId: "test.bad_parse.main",
              sourceId: "test.bad_parse",
              title: "Main",
              kind: "fixture",
              url: "https://example.test/source",
              method: "GET",
              captureMode: "fixture",
            },
            status: "success",
            artifacts: [{
              kind: "json",
              extension: "json",
              contentText: JSON.stringify({ ok: false }),
              fetchedUrl: "https://example.test/source",
            }],
            parsed: {
              items: [{
                itemKey: "known",
                itemType: "fixture",
                title: "Known Item",
                body: { name: "Known Item" },
              }],
              entityCandidates: [{
                candidateId: "candidate.test.bad_parse.missing",
                sourceItemKey: "missing",
                proposedEntityId: "dc.missing",
                name: "Missing",
                kind: "fixture",
                evidence: [],
              }],
            },
          }],
        },
        dataDir,
      ),
    Error,
    "Missing source item for key missing",
  );

  const runStatus = workbench.db.prepare(
    "select status, error_text as errorText from source_runs where source_id = ?",
  ).get("test.bad_parse") as { status: string; errorText: string };
  const counts = workbench.db.prepare(
    `select
       (select count(*) from source_artifacts) as artifacts,
       (select count(*) from source_items) as items,
       (select count(*) from entity_candidates) as entityCandidates`,
  ).get() as { artifacts: number; items: number; entityCandidates: number };
  workbench.close();

  assertEquals(runStatus.status, "failed");
  assertStringIncludes(runStatus.errorText, "Missing source item for key missing");
  assertEquals(counts, { artifacts: 1, items: 0, entityCandidates: 0 });
});

Deno.test("quickbase connector parses public CSV appointment rows into entities, relationships, and review items", async () => {
  const appointmentsCsvWithAlias = `${quickbaseAppointmentsCsvFixture.trim()}
"Commission on Nightlife and Culture (CNC)","Alcoholic Beverages and Cannabis Administration (ABCA) Designee","Filled","Mayoral Appointee, DC Agency Representative","Active"
`;
  const result = await getConnector("mota.quickbase").run(
    createConnectorContext({
      fetcher: async (url: string) => {
        const body = (() => {
          switch (url) {
            case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
              return quickbaseFixture;
            case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
              return appointmentsCsvWithAlias;
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        })();
        return {
          status: 200,
          text: async () => body,
          json: async <T>() => JSON.parse(body) as T,
        };
      },
    }),
  );
  assertEquals(result.endpointResults.length, 2);
  assertEquals(result.endpointResults[1].status, "success");
  const parsed = result.endpointResults[1].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 6);
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Downtown Revitalization Committee"
    ),
  );
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "District of Columbia Rental Housing Commission"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "overseen_by" &&
      candidate.toEntityRef === "dc.council_of_the_district_of_columbia"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by" &&
      candidate.rawValue === "Alcoholic Beverages and Cannabis Administration (ABCA) Designee" &&
      candidate.toEntityRef === "dc.alcoholic_beverage_and_cannabis_administration"
    ),
  );
  assert(
    parsed.reviewItems?.some((item) => item.itemType === "relationship_candidate"),
  );
  assert(
    parsed.reviewItems?.every((item) => item.itemType !== "source_status"),
  );
  assert(
    parsed.datasets?.some((dataset) => dataset.category === "appointments"),
  );
});

Deno.test("quickbase connector keeps contact columns out of public fact candidates", async () => {
  const csvWithContactColumns = quickbaseAppointmentsCsvFixture.replace(
    '"board status"',
    '"board status","Email","Phone","Private Notes"',
  ).replaceAll(
    '"Active"',
    '"Active","not-for-release@example.com","202-555-0100","private contact metadata"',
  );
  const result = await getConnector("mota.quickbase").run(
    createConnectorContext({
      fetcher: async (url: string) => {
        const body = (() => {
          switch (url) {
            case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
              return quickbaseFixture;
            case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
              return csvWithContactColumns;
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        })();
        return {
          status: 200,
          text: async () => body,
          json: async <T>() => JSON.parse(body) as T,
        };
      },
    }),
  );

  const parsed = result.endpointResults[1].parsed;
  assert(parsed);
  const publicFacts = JSON.stringify({
    entityCandidates: parsed.entityCandidates,
    relationshipCandidates: parsed.relationshipCandidates,
    datasets: parsed.datasets,
    reviewItems: parsed.reviewItems,
  });
  assert(!publicFacts.includes("not-for-release@example.com"));
  assert(!publicFacts.includes("202-555-0100"));
  assert(!publicFacts.includes("private contact metadata"));
});

Deno.test("quickbase governing-agency parsing normalizes trusted designee seats and skips unsupported role seats", async () => {
  const csv = `
"board or commission - b or c","seat designation (specific role)","appointment status","appointee designation","board status"
"Example Role Board","Director of the Department of Employment Services (DOES) Designee","Filled","Jane Doe","Active"
"Example Charter Board","Public Charter School Board (PCSB) Designee","Filled","Alex Doe","Active"
"Example Licensing Board","Department of Consumer and Regulatory Affairs (DCRA) Designee","Filled","Sam Doe","Active"
"Example Professional Board","Licensed Independent Clinical Social Worker (LICSW)","Filled","Pat Doe","Active"
`.trim();
  const result = await getConnector("mota.quickbase").run(
    createConnectorContext({
      fetcher: async (url: string) => {
        const body = (() => {
          switch (url) {
            case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
              return quickbaseFixture;
            case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
              return csv;
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        })();
        return {
          status: 200,
          text: async () => body,
          json: async <T>() => JSON.parse(body) as T,
        };
      },
    }),
  );

  const relationships = result.endpointResults[1].parsed?.relationshipCandidates ?? [];
  assert(
    relationships.some((candidate) =>
      candidate.rawValue === "Director of the Department of Employment Services (DOES) Designee" &&
      candidate.toEntityRef === "dc.department_of_employment_services" &&
      candidate.needsReview === false
    ),
  );
  assert(
    relationships.some((candidate) =>
      candidate.rawValue === "Public Charter School Board (PCSB) Designee" &&
      candidate.toEntityRef === "dc.public_charter_school_board_pcsb" &&
      candidate.needsReview === false
    ),
  );
  assert(
    relationships.some((candidate) =>
      candidate.rawValue === "Department of Consumer and Regulatory Affairs (DCRA) Designee" &&
      candidate.toEntityRef === "dc.department_of_licensing_and_consumer_protection" &&
      candidate.needsReview === false
    ),
  );
  assertEquals(
    relationships.some((candidate) =>
      candidate.rawValue === "Licensed Independent Clinical Social Worker (LICSW)"
    ),
    false,
  );
});

Deno.test("Open DC detail evidence points to the detail artifact rather than the index artifact", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force":
          return openDcTaskForceFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    })();
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  const detailItem = workbench.db.prepare(
    `select source_items.source_item_id as sourceItemId,
            source_artifacts.path as artifactPath
     from source_items
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     where source_items.endpoint_id = ? and source_items.item_key = ?`,
  ).get("open_dc.public_bodies.detail", "board-accountancy") as {
    sourceItemId: string;
    artifactPath: string;
  };
  const indexItem = workbench.db.prepare(
    `select source_items.source_item_id as sourceItemId,
            source_artifacts.path as artifactPath
     from source_items
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     where source_items.endpoint_id = ? and source_items.item_key = ?`,
  ).get("open_dc.public_bodies.index", "board-accountancy") as {
    sourceItemId: string;
    artifactPath: string;
  };
  const evidence = workbench.db.prepare(
    `select artifact_path as artifactPath
     from entity_candidate_evidence
     where candidate_id = ?
     order by evidence_id
     limit 1`,
  ).get("candidate.open_dc.public_bodies.board_accountancy") as { artifactPath: string };
  const taskForceLegalRef = workbench.db.prepare(
    "select url from legal_refs where legal_ref_id = ?",
  ).get("legal.open_dc.public_bodies.adult_career_pathways_task_force_authority") as {
    url: string | null;
  };
  const endpointAliases = new Map(
    workbench.db.prepare(
      "select raw_value as rawValue, to_entity_ref as toEntityRef from relationship_candidates where raw_value in ('DLCP/OPL', 'DOES')",
    ).all().map((row) => {
      const alias = row as { rawValue: string; toEntityRef: string };
      return [alias.rawValue, alias.toEntityRef];
    }),
  );
  workbench.close();
  assert(detailItem.artifactPath !== indexItem.artifactPath);
  assertEquals(evidence.artifactPath, detailItem.artifactPath);
  assertEquals(taskForceLegalRef.url, null);
  assertEquals(
    endpointAliases.get("DLCP/OPL"),
    "dc.department_of_licensing_and_consumer_protection",
  );
  assertEquals(endpointAliases.get("DOES"), "dc.department_of_employment_services");
});

Deno.test("Open DC second detail-page shape yields administered and legal-authority relationship candidates plus document links", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body><a href="/public-bodies/commission-on-example-services">Commission on Example Services</a></body></html>`;
        case "https://www.open-dc.gov/public-bodies/commission-on-example-services":
          return openDcCommissionFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher, limit: 1 }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assert(
    detail.items?.some((item) =>
      item.itemType === "document_link" && String(item.body.href).includes("commission-charter.pdf")
    ),
  );
  assert(
    detail.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by" &&
      candidate.rawValue === "Office of the City Administrator"
    ),
  );
  assert(
    detail.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "authorized_by" &&
      candidate.rawValue === "Mayor's Order 2019-010"
    ),
  );
});

Deno.test("Open DC fetch includes priority Council oversight endpoint pages beyond the default limit", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/board-accountancy">Board of Accountancy</a>
            <a href="/public-bodies/advisory-committee-street-harassment">Advisory Committee on Street Harassment</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/advisory-committee-street-harassment":
          return openDcStreetHarassmentFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher, limit: 1 }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assert(
    detail.entityCandidates?.some((candidate) =>
      candidate.candidateId ===
        "candidate.open_dc.public_bodies.advisory_committee_street_harassment"
    ),
  );
  assert(
    detail.relationshipCandidates?.some((candidate) =>
      candidate.rawValue === "Office of Human Rights" &&
      candidate.toEntityRef === "dc.office_of_human_rights"
    ),
  );
});

Deno.test("Open DC public bodies can be safely accepted before relationship review", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force":
          return openDcTaskForceFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--subject-prefix",
      "candidate.open_dc.public_bodies",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted 0 safe review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const relationshipItems = reopened.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.open_dc.public_bodies",
  });
  const acceptedRelationships = reopened.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id in (
       'dc.board_of_accountancy:governed_by:dc.department_of_licensing_and_consumer_protection',
       'dc.adult_career_pathways_task_force:governed_by:dc.department_of_employment_services'
     )
     order by relationship_id`,
  ).all() as Array<{ relationshipId: string }>;
  const acceptedAuthorityCandidates = reopened.db.prepare(
    `select review_status as reviewStatus
     from relationship_candidates
     where relationship_candidate_id in (
       'relationship.open_dc.public_bodies.board_accountancy_authorized_by',
       'relationship.open_dc.public_bodies.adult_career_pathways_task_force_authorized_by'
     )
     order by relationship_candidate_id`,
  ).all() as Array<{ reviewStatus: string }>;
  const blockedRelationship = reopened.db.prepare(
    `select reason, details_json as detailsJson
     from reconciliation_items
     where subject_id = 'relationship.open_dc.public_bodies.board_accountancy_governing_agency'`,
  ).get() as { reason: string; detailsJson: string } | undefined;
  reopened.close();

  assertEquals(relationshipItems.length, 0);
  assertEquals(acceptedRelationships.length, 0);
  assertEquals(acceptedAuthorityCandidates.length, 2);
  assert(acceptedAuthorityCandidates.every((candidate) => candidate.reviewStatus === "accepted"));
  assert(blockedRelationship);
  assertEquals(blockedRelationship.reason, "unresolved_endpoints");
  assertStringIncludes(
    blockedRelationship.detailsJson,
    "dc.department_of_licensing_and_consumer_protection",
  );
});

Deno.test("multi-artifact connector imports keep schema and row evidence on the correct artifacts", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
          return JSON.stringify(dcgisRowsFixture);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    })();
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };
  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  const schemaArtifact = workbench.db.prepare(
    `select source_artifacts.path as artifactPath
     from source_fields
     join source_artifacts on source_artifacts.artifact_id = source_fields.artifact_id
     where source_fields.endpoint_id = ? and source_fields.field_name = ?`,
  ).get("dcgis.agencies.main", "AGENCY_NAME") as { artifactPath: string };
  const rowArtifact = workbench.db.prepare(
    `select source_artifacts.path as artifactPath
     from source_items
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     where source_items.endpoint_id = ? and source_items.item_key = ?`,
  ).get("dcgis.agencies.main", "1001") as { artifactPath: string };
  const evidence = workbench.db.prepare(
    `select artifact_path as artifactPath
     from entity_candidate_evidence
     where candidate_id = ?
     order by evidence_id
     limit 1`,
  ).get("candidate.dcgis.agencies.1001") as { artifactPath: string };
  workbench.close();
  assert(schemaArtifact.artifactPath !== rowArtifact.artifactPath);
  assertEquals(evidence.artifactPath, rowArtifact.artifactPath);
});

Deno.test("DCGIS boards, commissions, and councils connector preserves overlaps conservatively", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsRowsFixture);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("dcgis.boards_commissions_councils").run(
    createConnectorContext({ fetcher }),
  );
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 3);
  assertEquals(parsed.entityCandidates?.length, 3);
  assertEquals(parsed.relationshipCandidates?.length, 2);
  assertEquals(parsed.legalRefs?.length, 3);
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Board of Accountancy" && candidate.duplicateHint ===
        "https://www.dcopla.com/accountancy/"
    ),
  );
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Rental Housing Commission" && candidate.kind === "commission"
    ),
  );
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Advisory Neighborhood Commissions" && candidate.kind === "commission"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by" &&
      candidate.rawValue === "Department of Housing and Community Development"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by" &&
      candidate.rawValue === "DC Department of Licensing and Consumer Protection"
    ),
  );
  assert(
    parsed.reviewItems?.some((item) =>
      item.subjectId === "candidate.dcgis.boards_commissions_councils.29"
    ),
  );
});

Deno.test("Council members connector captures seats and ward representations", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/councilmembers/":
          return councilMembersFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("council.members").run(createConnectorContext({ fetcher }));
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 1);
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Council Chairman"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "District of Columbia"));
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "holds" && candidate.rawValue === "Council Chairman"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("Ward 6")
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("District of Columbia")
    ),
  );
});

Deno.test("Council ward parsing skips order inference when a ward label is absent", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/councilmembers/":
          return `
<html><body>
  <main>
    <h3>Ward Members</h3>
    <ul>
      <li><a href="https://dccouncil.gov/council/charles-allen/">Councilmember Charles Allen</a></li>
    </ul>
  </main>
</body></html>
`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("council.members").run(createConnectorContext({ fetcher }));
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assert(
    parsed.entityCandidates?.some((candidate) => candidate.name === "Councilmember Charles Allen"),
  );
  assert(
    !parsed.entityCandidates?.some((candidate) => candidate.name === "Ward 1 Council Seat"),
  );
  assert(
    !parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("Ward 1")
    ),
  );
});

Deno.test("Council committee member parsing captures chair and member relationships", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("council.committees").run(createConnectorContext({ fetcher }));
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  const chairs =
    parsed.relationshipCandidates?.filter((candidate) => candidate.relationshipType === "chairs") ??
      [];
  const members =
    parsed.relationshipCandidates?.filter((candidate) =>
      candidate.relationshipType === "member_of"
    ) ?? [];
  assertEquals(chairs.length, 1);
  assert(
    chairs.some((candidate) =>
      candidate.fromEntityRef === buildEntityId("At-Large Councilmember Christina Henderson") &&
      candidate.toEntityRef === buildEntityId("Committee on Health")
    ),
  );
  assert(
    members.some((candidate) =>
      candidate.fromEntityRef === buildEntityId("Ward 6 Councilmember Charles Allen") &&
      candidate.toEntityRef === buildEntityId("Committee on Health")
    ),
  );
  assert(
    members.some((candidate) =>
      candidate.fromEntityRef === buildEntityId("At-Large Councilmember Christina Henderson")
    ),
  );
});

Deno.test("OANC ANC profiles connector captures wards, SMDs, and commissioners without contact data", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://oanc.dc.gov/anc-profile-listing":
          return ancListingFixture;
        case "https://oanc.dc.gov/anc-profile/anc-34g":
          return ancProfile34gFixture;
        case "https://oanc.dc.gov/anc-profile/anc-6c":
          return ancProfile6cFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("oanc.anc_profiles").run(
    createConnectorContext({ fetcher, limit: 2 }),
  );
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 3);
  assertEquals(parsed.legalRefs?.length, 2);
  const anc34gItem = parsed.items?.find((item) => item.itemKey === "anc-34g");
  const anc6cItem = parsed.items?.find((item) => item.itemKey === "anc-6c");
  const anc34gBody = anc34gItem?.body as {
    wardNumbers?: number[];
    commissioners?: Array<{ name: string; role?: string }>;
  };
  const anc6cBody = anc6cItem?.body as {
    wardNumbers?: number[];
    commissioners?: Array<{ name: string; role?: string }>;
  };
  assertEquals(anc34gBody.wardNumbers, [3, 4]);
  assertEquals(anc6cBody.wardNumbers, [6]);
  assertEquals(anc34gBody.commissioners?.[0].role, "Vice Chairperson");
  assertEquals(anc6cBody.commissioners?.[1].role, "Chairperson");
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Advisory Neighborhood Commissions"
    ),
  );
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "ANC 3/4G"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Ward 3"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Ward 4"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "SMD 6C01"));
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "part_of" && candidate.toEntityRef === buildEntityId("Ward 3")
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "part_of" && candidate.toEntityRef === buildEntityId("Ward 4")
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("SMD 6C01")
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "member_of" &&
      candidate.toEntityRef === buildEntityId("ANC 6C")
    ),
  );
});

Deno.test("public body comparison report surfaces exact overlaps across the three source lanes", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsRowsFixture);
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force":
          return openDcTaskForceFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
          return quickbaseFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
          return quickbaseAppointmentsCsvFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.boards_commissions_councils").run(
      createConnectorContext({ fetcher }),
    ),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("mota.quickbase").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  const report = workbench.comparePublicBodies();
  assert(report.sharedNameCount >= 2);
  assert(
    report.rows.some((row) =>
      row.sourceIds.length > 1 && row.displayName.includes("Board of Accountancy")
    ),
  );
  assert(
    report.rows.some((row) =>
      row.sourceIds.length > 1 && row.displayName.includes("Adult Career Pathways Task Force")
    ),
  );
  assert(
    report.sourceSummaries.some((source) =>
      source.sourceId === "dcgis.boards_commissions_councils" && source.sharedNameCount >= 1
    ),
  );
  workbench.close();
  const compareOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "compare",
      "public-bodies",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(compareOutput.code, 0);
  const compareJson = JSON.parse(new TextDecoder().decode(compareOutput.stdout)) as {
    sharedNameCount: number;
  };
  assert(compareJson.sharedNameCount >= 2);
});

Deno.test("public body comparison report stays usable when Quickbase is unfetched", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsRowsFixture);
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force":
          return openDcTaskForceFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.boards_commissions_councils").run(
      createConnectorContext({ fetcher }),
    ),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  const report = workbench.comparePublicBodies();
  const quickbaseSummary = report.sourceSummaries.find((source) =>
    source.sourceId === "mota.quickbase"
  );
  assert(quickbaseSummary);
  assertEquals(quickbaseSummary.latestStatus, "unfetched");
  assertEquals(quickbaseSummary.normalizedNameCount, 0);
  assertEquals(quickbaseSummary.sharedNameCount, 0);
  assertEquals(quickbaseSummary.exclusiveNameCount, 0);
  assert(
    report.rows.some((row) =>
      row.sourceIds.length > 1 && row.displayName.includes("Board of Accountancy")
    ),
  );
  workbench.close();

  const compareOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "compare",
      "public-bodies",
      "--db",
      dbPath,
      "--json",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(compareOutput.code, 0);
  const compareJson = JSON.parse(new TextDecoder().decode(compareOutput.stdout)) as {
    sourceSummaries: Array<{
      sourceId: string;
      latestStatus?: string;
      normalizedNameCount: number;
      sharedNameCount: number;
      exclusiveNameCount: number;
    }>;
    rows: Array<{ sourceIds: string[]; displayName: string }>;
  };
  const quickbaseJson = compareJson.sourceSummaries.find((source) =>
    source.sourceId === "mota.quickbase"
  );
  assert(quickbaseJson);
  assertEquals(quickbaseJson.latestStatus, "unfetched");
  assertEquals(quickbaseJson.normalizedNameCount, 0);
  assertEquals(quickbaseJson.sharedNameCount, 0);
  assertEquals(quickbaseJson.exclusiveNameCount, 0);
  assert(
    compareJson.rows.some((row) =>
      row.sourceIds.length > 1 && row.displayName.includes("Board of Accountancy")
    ),
  );
});

Deno.test("relationship acceptance rejects blocked endpoints instead of creating placeholders", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await assertRejects(
    () =>
      workbench.appendResolutionEvent(
        {
          eventType: "accept_relationship_candidate",
          subjectId: "relationship.council.committees.committee_of_the_whole_part_of",
          payload: {},
        },
        resolutionsDir,
      ),
    Error,
    "Cannot accept blocked relationship candidate",
  );
  const placeholderCount = workbench.db.prepare(
    "select count(*) as count from canonical_entities where is_placeholder = 1",
  ).get() as { count: number };
  workbench.close();
  assertEquals(placeholderCount.count, 0);
});

Deno.test("blocked relationship reconciliation stores endpoint status for audit", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  const reconciliationItem = workbench.db.prepare(
    `select details_json as detailsJson
     from reconciliation_items
     where subject_id = 'relationship.council.committees.committee_of_the_whole_part_of'`,
  ).get() as { detailsJson: string } | undefined;
  workbench.close();
  assert(reconciliationItem);
  assertStringIncludes(
    reconciliationItem.detailsJson,
    '"fromEndpoint":{"entityId":"dc.committee_of_the_whole","state":"accepted"',
  );
  assertStringIncludes(
    reconciliationItem.detailsJson,
    '"toEndpoint":{"entityId":"dc.council_of_the_district_of_columbia","state":"missing"',
  );
});

Deno.test("dc review relationships can edit endpoints before accepting", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name, kind] of [
      ["dc.source_board", "Source Board", "board"],
      ["dc.council_of_the_district_of_columbia", "Council of the District of Columbia", "council"],
    ]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name, kind);
  }
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_cli.relationships",
      relationshipCandidateId: "relationship.test.review_cli.editable",
      sourceItemKey: "review-cli-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.council_of_the_district_of_columbia",
      relationshipType: "governed_by",
      rawValue: "Council of the District of Columbia",
      needsReview: true,
    }),
    dataDir,
  );
  workbench.close();

  const reviewProcess = new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "relationships",
      "--subject-prefix",
      "relationship.test.review_cli.editable",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = reviewProcess.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode("e\npart_of\n\ndc.council_of_the_district_of_columbia\n"),
  );
  await writer.close();
  const output = await reviewProcess.output();
  const text = new TextDecoder().decode(output.stdout);
  assertEquals(output.code, 0);
  assertStringIncludes(text, "Relationship type:");
  assertStringIncludes(text, "From entity id (blank keeps source):");
  assertStringIncludes(text, "To entity id (blank keeps source):");
  assertStringIncludes(text, "Saved resolution.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const relationships = reopened.canonicalRelationships();
  reopened.close();
  assertEquals(relationships.map((row) => row.id), [
    "dc.source_board:part_of:dc.council_of_the_district_of_columbia",
  ]);
});

Deno.test("Council committee oversight extraction only emits explicit source-backed overseen_by candidates", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("council.committees").run(createConnectorContext({ fetcher }));
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  const oversightCandidates =
    parsed.relationshipCandidates?.filter((candidate) =>
      candidate.relationshipType === "overseen_by"
    ) ?? [];
  assertEquals(oversightCandidates.length, 4);
  assert(
    oversightCandidates.every((candidate) =>
      candidate.sourceItemKey.includes(":oversight") && candidate.needsReview === true
    ),
  );
  assertEquals(
    oversightCandidates.some((candidate) => candidate.rawValue === "twitter"),
    false,
  );
  assert(
    oversightCandidates.some((candidate) =>
      candidate.rawValue === "Department of Health" &&
      candidate.fromEntityRef === "dc.dc_health"
    ),
  );
  assert(
    parsed.reviewItems?.some((item) =>
      item.subjectId === "relationship.council.committees.committee_on_health_oversight_1" &&
      item.reason === "Review Council committee oversight relationship"
    ),
  );
});

Deno.test("Council classified remaining oversight endpoints default to defer", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return `<html><body>
            <h1>Committee on Health</h1>
            <h2>Agencies Under This Committee</h2>
            <ul>
              <li>Department of Health</li>
              <li>Cedar Hill Hospital</li>
              <li>All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health</li>
            </ul>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("council.committees").run(createConnectorContext({ fetcher }));
  const items = result.endpointResults[0].parsed?.reviewItems ?? [];
  const healthItem = items.find((item) =>
    item.details.rawValue === "Department of Health" &&
    item.subjectId.includes("committee_on_health_oversight")
  );
  const cedarHillItem = items.find((item) => item.details.rawValue === "Cedar Hill Hospital");
  const groupedItem = items.find((item) =>
    item.details.rawValue ===
      "All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health"
  );

  assertEquals(healthItem?.defaultAction, "accept");
  assertEquals(cedarHillItem?.defaultAction, "defer");
  assertEquals(groupedItem?.defaultAction, "defer");
});

Deno.test("legal reference parsing normalizes common DC citation families", () => {
  assertEquals(
    parseLegalReference("D.C. Official Code § 1-204.22").normalizedCitation,
    "D.C. Code 1-204.22",
  );
  assertEquals(parseLegalReference("24 DCMR § 100.1").normalizedCitation, "24 DCMR 100.1");
  assertEquals(
    parseLegalReference("Mayor’s Order 2024-001").normalizedCitation,
    "Mayor's Order 2024-001",
  );
  assertEquals(
    parseLegalReference("Mayor's Order 2001-92 Amended 2002-142", "https://code.dccouncil.us/")
      .refType,
    "mayors_order",
  );
  assertEquals(
    parseLegalReference("71 D.C. Register 012345").normalizedCitation,
    "71 D.C. Register 012345",
  );
  assertEquals(
    parseLegalReference("District of Columbia Official Code").normalizedCitation,
    "D.C. Official Code",
  );
  assertEquals(
    parseLegalReference("Mayor's Orders", "https://dcregs.dc.gov/default.aspx").refType,
    "dc_register",
  );
  assertEquals(parseLegalReference("§ 25–202").normalizedCitation, "D.C. Code 25-202");
  assertEquals(parseLegalReference("4-1303.01a").normalizedCitation, "D.C. Code 4-1303.01a");
  assertEquals(
    parseLegalReference("D.C. Official Code § 47-2853.06(b)(1)").normalizedCitation,
    "D.C. Code 47-2853.06(b)(1)",
  );
});

Deno.test("known relationship endpoint aliases resolve to accepted-style entity ids", () => {
  assertEquals(
    buildKnownEntityRef("Mayor's Office of Veterans Affairs (MOVA)"),
    "dc.mayor_s_office_of_veterans_affairs",
  );
  assertEquals(
    buildKnownEntityRef("DC Department of Licensing and Consumer Protection"),
    "dc.department_of_licensing_and_consumer_protection",
  );
  assertEquals(
    buildKnownEntityRef("Department of Health (DOH)"),
    "dc.dc_health",
  );
  assertEquals(buildKnownEntityRef("City Administrator"), "dc.office_of_the_city_administrator");
  assertEquals(buildKnownEntityRef("District of Columbia Auditor"), "dc.office_of_the_dc_auditor");
  assertEquals(
    buildKnownEntityRef("District of Columbia Board of Elections"),
    "dc.board_of_elections",
  );
  assertEquals(
    buildKnownEntityRef("District of Columbia Housing Authority"),
    "dc.dc_housing_authority",
  );
  assertEquals(
    buildKnownEntityRef("District of Columbia Public Library System"),
    "dc.dc_public_library",
  );
  assertEquals(
    buildKnownEntityRef("District of Columbia Water and Sewer Authority"),
    "dc.dc_water",
  );
  assertEquals(
    buildKnownEntityRef("Fire and Emergency Medical Services Department"),
    "dc.fire_and_emergency_medical_services",
  );
  assertEquals(
    buildKnownEntityRef("Office of the Attorney General for the District of Columbia"),
    "dc.office_of_the_attorney_general",
  );
  assertEquals(
    buildKnownEntityRef("Office of the People’s Counsel"),
    "dc.office_of_the_people_s_counsel_for_the_district_of_columbia",
  );
  assertEquals(
    buildKnownEntityRef("Bicycle Advisory Council"),
    "dc.bicycle_advisory_council",
  );
  assertEquals(
    buildKnownEntityRef("Board of Barber and Cosmetology"),
    "dc.board_of_barber_and_cosmetology",
  );
  assertEquals(
    buildKnownEntityRef("Commission on Aging"),
    "dc.commission_on_aging",
  );
  assertEquals(
    buildKnownEntityRef("Health Information Exchange Policy Board"),
    "dc.health_information_exchange_policy_board_hie",
  );
  assertEquals(
    buildKnownEntityRef("Board of Review of Anti-Deficiency Violations"),
    "dc.board_of_review_for_anti_deficiency_violations",
  );
  assertEquals(
    buildKnownEntityRef("Citizen Review Panel on Child Abuse and Neglect"),
    "dc.citizen_review_panel_on_child_abuse_and_neglect",
  );
  assertEquals(
    buildKnownEntityRef("Commission on Nightlife and Culture"),
    "dc.commission_on_nightlife_and_culture",
  );
  assertEquals(
    buildKnownEntityRef("Commission on Women"),
    "dc.commission_for_women",
  );
  assertEquals(
    buildKnownEntityRef("District of Columbia Sentencing Commission"),
    "dc.district_of_columbia_sentencing_commission",
  );
  assertEquals(
    buildKnownEntityRef("Destination DC"),
    "dc.destination_dc",
  );
  assertEquals(
    buildKnownEntityRef("Department of Consumer and Regulatory Affairs"),
    "dc.department_of_licensing_and_consumer_protection",
  );
  assertEquals(
    buildKnownEntityRef("Deputy Mayor for Planning and Economic Development (DMPED)"),
    "dc.office_of_the_deputy_mayor_for_planning_and_economic_development",
  );
  assertEquals(
    buildKnownEntityRef("Deputy Mayor for Public Safety and Justice/Operations (DMPSJ/O)"),
    "dc.office_of_the_deputy_mayor_for_public_safety_and_justice",
  );
  assertEquals(
    buildKnownEntityRef("Inspector General"),
    "dc.office_of_the_inspector_general",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office on Asian and Pacific Islander Affairs"),
    "dc.mayor_s_office_on_asian_and_pacific_island_affairs",
  );
  assertEquals(
    buildKnownEntityRef("MPD"),
    "dc.metropolitan_police_department",
  );
  assertEquals(
    buildKnownEntityRef("Office on Returning Citizen Affairs"),
    "dc.mayor_s_office_on_returning_citizen_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Office of City Administrator"),
    "dc.office_of_the_city_administrator",
  );
  assertEquals(
    buildKnownEntityRef("Office of Religious Affairs"),
    "dc.mayor_s_office_of_religious_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Public Charter School Board (PCSB)"),
    "dc.public_charter_school_board_pcsb",
  );
  assertEquals(
    buildKnownEntityRef("Rental Housing Commission"),
    "dc.rental_housing_commission",
  );
  assertEquals(
    buildKnownEntityRef("Secretary of State of the District of Columbia"),
    "dc.office_of_the_secretary",
  );
  assertEquals(
    buildKnownEntityRef("State Superintendent of Education"),
    "dc.office_of_the_state_superintendent_of_education",
  );
});

Deno.test("safe legal refs auto-accept on import and remaining legal resolutions update release status truth", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const outDir = join(dir, "release");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        if (url === "https://dc.gov/page/laws-regulations-and-courts") {
          return legalEntrypointsFixture;
        }
        throw new Error(`Unexpected url ${url}`);
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(result, dataDir);

  const items = workbench.listReviewItems("legal");
  assertEquals(items.length, 1);
  assert(items.every((item) => item.defaultAction === "defer"));

  const registerItem = items.find((item) => item.details.refType === "dc_register");
  assert(registerItem);
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_legal_ref",
      subjectId: registerItem.subjectId,
      payload: { refType: "dcmr", normalizedCitation: "DCMR and D.C. Register entrypoint" },
    },
    resolutionsDir,
  );

  const resolvedItems = workbench.listReviewItems({ mode: "legal", status: "resolved" });
  assertEquals(resolvedItems.length, 3);
  await buildV2Release(workbench, outDir);
  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    release_summary: {
      legal_refs_by_review_status: Array<{ review_status: string; count: number }>;
      legal_refs_by_type: Array<{ ref_type: string; count: number }>;
    };
  };
  const statuses = new Map(
    manifest.release_summary.legal_refs_by_review_status.map((row) => [
      row.review_status,
      row.count,
    ]),
  );
  const types = new Map(
    manifest.release_summary.legal_refs_by_type.map((row) => [row.ref_type, row.count]),
  );
  workbench.close();
  assertEquals(statuses.get("accepted"), 3);
  assertEquals(types.get("dcmr"), 1);
});

Deno.test("batch accept-safe skips remaining ambiguous legal refs after safe import auto-accept", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        if (url === "https://dc.gov/page/laws-regulations-and-courts") {
          return legalEntrypointsFixture;
        }
        throw new Error(`Unexpected url ${url}`);
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(result, dataDir);
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "legal",
      "--subject-prefix",
      "legal.legal.entrypoints",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted 0 safe review item(s).");
  assertStringIncludes(batchText, "Skipped 1 item(s) that were not safe to auto-accept.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const statuses = reopened.db.prepare(
    "select review_status as reviewStatus, count(*) as count from legal_refs group by review_status",
  ).all() as Array<{ reviewStatus: string; count: number }>;
  const statusCounts = new Map(statuses.map((row) => [row.reviewStatus, row.count]));
  const pendingItem = reopened.listReviewItems({ mode: "legal" })[0];
  reopened.close();
  assertEquals(statusCounts.get("accepted"), 2);
  assertEquals(statusCounts.get("pending"), 1);
  assertEquals(pendingItem.details.refType, "dc_register");
});

Deno.test("batch defer marks scoped legal refs deferred without changing legal ref status", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        if (url === "https://dc.gov/page/laws-regulations-and-courts") {
          return legalEntrypointsFixture;
        }
        throw new Error(`Unexpected url ${url}`);
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(result, dataDir);
  workbench.close();

  const listOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--mode",
      "legal",
      "--subject-prefix",
      "legal.legal.entrypoints",
      "--ref-type",
      "dc_register",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const listed = JSON.parse(new TextDecoder().decode(listOutput.stdout)) as {
    count: number;
    items: Array<{ details: { refType: string } }>;
  };
  assertEquals(listOutput.code, 0);
  assertEquals(listed.count, 1);
  assertEquals(listed.items[0].details.refType, "dc_register");

  const deferOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "defer",
      "--mode",
      "legal",
      "--subject-prefix",
      "legal.legal.entrypoints",
      "--ref-type",
      "dc_register",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferOutput.code, 0);
  assertStringIncludes(new TextDecoder().decode(deferOutput.stdout), "Deferred 1 review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const deferred = reopened.listReviewItems({
    mode: "legal",
    status: "deferred",
    subjectPrefix: "legal.legal.entrypoints",
    refType: "dc_register",
  });
  const legalRef = reopened.db.prepare(
    "select review_status as reviewStatus from legal_refs where ref_type = 'dc_register'",
  ).get() as { reviewStatus: string };
  reopened.close();
  assertEquals(deferred.length, 1);
  assertEquals(legalRef.reviewStatus, "pending");
});

Deno.test("blocked relationships stay out of the live review order while entity review remains stable", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
          return quickbaseFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
          return quickbaseAppointmentsCsvFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("mota.quickbase").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_queue.entities",
      candidateId: "candidate.test.review_queue.entities.example",
      sourceItemKey: "review-queue-entity-row",
      proposedEntityId: "dc.review_queue_entity",
      name: "Review Queue Entity",
      kind: "board",
      observedName: "Review Queue Entity",
    }),
    dataDir,
  );
  const items = workbench.listReviewItems();
  const blockedSubjectIds = new Set(
    workbench.db.prepare(
      "select subject_id as subjectId from reconciliation_items where subject_type = 'relationship_candidate' and state = 'blocked'",
    ).all().map((row) => (row as { subjectId: string }).subjectId),
  );
  const blockedRelationships = workbench.db.prepare(
    "select count(*) as count from reconciliation_items where subject_type = 'relationship_candidate' and state = 'blocked'",
  ).get() as { count: number };
  workbench.close();
  assert(blockedRelationships.count > 0);
  assert(items.every((item) => item.itemType !== "source_status"));
  assert(items.every((item) => !blockedSubjectIds.has(item.subjectId)));
  assert(items.some((item) => item.itemType === "entity_candidate"));
});

Deno.test("review list filters by mode, status, type, and subject prefix", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  for (
    const [entityId, name] of [
      ["dc.dc_health", "Department of Health"],
      ["dc.department_of_behavioral_health", "Department of Behavioral Health"],
    ]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_list.entities",
      candidateId: "candidate.test.review_list.entities.example",
      sourceItemKey: "review-list-entity-row",
      proposedEntityId: "dc.review_list_entity",
      name: "Review List Entity",
      kind: "board",
      observedName: "Review List Entity",
    }),
    dataDir,
  );
  workbench.close();
  const output = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--mode",
      "entities",
      "--status",
      "open",
      "--type",
      "entity_candidate",
      "--subject-prefix",
      "candidate.test.review_list",
      "--db",
      dbPath,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.code, 0);
  const text = new TextDecoder().decode(output.stdout);
  assertStringIncludes(text, "Review items:");
  assertStringIncludes(text, "entity_candidate");
  assert(!text.includes("source_status"));
  const jsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--mode",
      "entities",
      "--status",
      "open",
      "--type",
      "entity_candidate",
      "--subject-prefix",
      "candidate.test.review_list",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const json = JSON.parse(new TextDecoder().decode(jsonOutput.stdout)) as {
    count: number;
    items: Array<{ itemType: string; subjectId: string }>;
  };
  assertEquals(jsonOutput.code, 0);
  assertEquals(json.count, json.items.length);
  assert(json.items.every((item) => item.itemType === "entity_candidate"));
  assert(json.items.every((item) => item.subjectId.startsWith("candidate.test.review_list")));

  const relationshipTypeJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const relationshipTypeJson = JSON.parse(
    new TextDecoder().decode(relationshipTypeJsonOutput.stdout),
  ) as {
    count: number;
    items: Array<{ itemType: string; subjectId: string; details: { relationshipType: string } }>;
  };
  assertEquals(relationshipTypeJsonOutput.code, 0);
  assert(relationshipTypeJson.count > 0);
  assert(
    relationshipTypeJson.items.every((item) =>
      item.itemType === "relationship_candidate" &&
      item.subjectId.startsWith("relationship.council.committees") &&
      item.details.relationshipType === "overseen_by"
    ),
  );

  const rawValueContainsJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees.committee_on_health_oversight",
      "--raw-value-contains",
      "Health",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const rawValueContainsJson = JSON.parse(
    new TextDecoder().decode(rawValueContainsJsonOutput.stdout),
  ) as {
    count: number;
    items: Array<{ details: { rawValue: string; relationshipType: string } }>;
  };
  assertEquals(rawValueContainsJsonOutput.code, 0);
  assert(
    rawValueContainsJson.items.every((item) =>
      item.details.relationshipType === "overseen_by" &&
      item.details.rawValue.includes("Health")
    ),
  );

  const limitedJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees.committee_on_health_oversight",
      "--limit",
      "1",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const limitedJson = JSON.parse(new TextDecoder().decode(limitedJsonOutput.stdout)) as {
    count: number;
    items: Array<{ itemType: string }>;
  };
  assertEquals(limitedJsonOutput.code, 0);
  assertEquals(limitedJson.count, 1);
  assertEquals(limitedJson.items.length, 1);

  const allStatusJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--status",
      "all",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const allStatusJson = JSON.parse(
    new TextDecoder().decode(allStatusJsonOutput.stdout),
  ) as { count: number; items: Array<{ itemType: string }> };
  assertEquals(allStatusJsonOutput.code, 0);
  assertEquals(allStatusJson.count, allStatusJson.items.length);
  assert(allStatusJson.count >= json.count);
});

Deno.test("deferred review items stay visible but sort behind open items", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.deferred.entities.one",
      candidateId: "candidate.test.deferred.entities.one",
      sourceItemKey: "deferred-entity-row-one",
      proposedEntityId: "dc.deferred_entity_one",
      name: "Deferred Entity One",
      kind: "board",
      observedName: "Deferred Entity One",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.deferred.entities.two",
      candidateId: "candidate.test.deferred.entities.two",
      sourceItemKey: "deferred-entity-row-two",
      proposedEntityId: "dc.deferred_entity_two",
      name: "Deferred Entity Two",
      kind: "board",
      observedName: "Deferred Entity Two",
    }),
    dataDir,
  );
  const deferredItem = workbench.listReviewItems({ type: "entity_candidate" })[0];
  assert(deferredItem);
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: deferredItem.reviewItemId,
      payload: {},
    },
    resolutionsDir,
  );
  const items = workbench.listReviewItems({ type: "entity_candidate" });
  workbench.close();
  assertEquals(items.at(-1)?.status, "deferred");
  assert(items.slice(0, -1).every((item) => item.status === "open"));
});

Deno.test("batch accept-safe writes JSONL resolution events and leaves risky review items alone", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.batch_accept_safe.entities",
      candidateId: "candidate.test.batch_accept_safe.entities.example",
      sourceItemKey: "batch-accept-safe-entity-row",
      proposedEntityId: "dc.batch_accept_safe_entity",
      name: "Batch Accept Safe Entity",
      kind: "board",
      observedName: "Batch Accept Safe Entity",
      confidence: 0.99,
    }),
    dataDir,
  );
  workbench.close();
  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted ");
  let resolutionFile = "";
  for await (const entry of Deno.readDir(resolutionsDir)) {
    if (!entry.isDirectory) continue;
    for await (const child of Deno.readDir(join(resolutionsDir, entry.name))) {
      if (child.isFile && child.name.endsWith(".jsonl")) {
        resolutionFile = join(resolutionsDir, entry.name, child.name);
      }
    }
  }
  assert(resolutionFile);
  const lines = (await Deno.readTextFile(resolutionFile)).trim().split("\n").filter(Boolean);
  assert(lines.length > 0);
  assert(lines.every((line) => JSON.parse(line).event_type === "accept_entity_candidate"));
  const reopened = new Workbench(dbPath);
  reopened.init();
  const blockedRelationships = reopened.db.prepare(
    "select count(*) as count from reconciliation_items where subject_type = 'relationship_candidate' and state = 'blocked'",
  ).get() as { count: number };
  reopened.close();
  assert(blockedRelationships.count > 0);
});

Deno.test("batch accept-safe accepts seeded Council oversight prerequisites and the unblocked oversight relationship", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.committee_on_the_judiciary_and_public_safety', 'Committee on the Judiciary and Public Safety', 'committee', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.batch_seeded_oversight",
      sourceItemKey: "batch-seeded-oversight-row",
      fromEntityRef: "dc.child_support_guideline_commission",
      toEntityRef: "dc.committee_on_the_judiciary_and_public_safety",
      relationshipType: "overseen_by",
      rawValue: "Child Support Guideline Commission",
    }),
    dataDir,
  );
  workbench.close();

  const entityBatchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--subject-prefix",
      "candidate.council.committees.relationship_council_committees_batch_seeded_oversight",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(entityBatchOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(entityBatchOutput.stdout),
    "Accepted 1 safe review item(s).",
  );

  const reopenedAfterEntityBatch = new Workbench(dbPath);
  reopenedAfterEntityBatch.init();
  const seededEntity = reopenedAfterEntityBatch.db.prepare(
    `select entity_id as entityId, review_status as reviewStatus
     from canonical_entities
     where entity_id = 'dc.child_support_guideline_commission'`,
  ).get() as { entityId: string; reviewStatus: string } | undefined;
  const reviewReadyOversight = reopenedAfterEntityBatch.listReviewItems({
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees.batch_seeded_oversight",
  });
  reopenedAfterEntityBatch.close();
  assertEquals(seededEntity?.entityId, "dc.child_support_guideline_commission");
  assertEquals(seededEntity?.reviewStatus, "accepted");
  assertEquals(reviewReadyOversight.length, 1);
  assertEquals(reviewReadyOversight[0]?.defaultAction, "accept");

  const relationshipBatchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees.batch_seeded_oversight",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(relationshipBatchOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(relationshipBatchOutput.stdout),
    "Accepted 1 safe review item(s).",
  );

  const reopenedAfterRelationshipBatch = new Workbench(dbPath);
  reopenedAfterRelationshipBatch.init();
  const acceptedRelationship = reopenedAfterRelationshipBatch.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.child_support_guideline_commission:overseen_by:dc.committee_on_the_judiciary_and_public_safety'`,
  ).get() as { relationshipId: string } | undefined;
  const remainingOversight = reopenedAfterRelationshipBatch.listReviewItems({
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees.batch_seeded_oversight",
  });
  reopenedAfterRelationshipBatch.close();
  assertEquals(
    acceptedRelationship?.relationshipId,
    "dc.child_support_guideline_commission:overseen_by:dc.committee_on_the_judiciary_and_public_safety",
  );
  assertEquals(remainingOversight.length, 0);
});

Deno.test("batch accept-safe accepts seeded DCGIS governing-agency prerequisites and auto-accepts the unblocked relationship", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.commission_on_out_of_school_time_grants_and_youth_outcomes', 'Commission on Out of School Time Grants and Youth Outcomes', 'commission', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "dcgis.boards_commissions_councils",
      relationshipCandidateId:
        "relationship.dcgis.boards_commissions_councils.batch_seeded_governing_agency",
      sourceItemKey: "batch-seeded-governing-agency-row",
      fromEntityRef: "dc.commission_on_out_of_school_time_grants_and_youth_outcomes",
      toEntityRef: "dc.office_of_out_of_school_time_grants_and_youth_outcomes",
      relationshipType: "governed_by",
      rawValue: "Office of Out of School Time Grants and Youth Outcomes",
      needsReview: false,
    }),
    dataDir,
  );
  workbench.close();

  const entityBatchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--subject-prefix",
      "candidate.dcgis.boards_commissions_councils.relationship_dcgis_boards_commissions_councils_batch_seeded_governing_agency",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(entityBatchOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(entityBatchOutput.stdout),
    "Accepted 1 safe review item(s).",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const seededEntity = reopened.db.prepare(
    `select entity_id as entityId, review_status as reviewStatus
     from canonical_entities
     where entity_id = 'dc.office_of_out_of_school_time_grants_and_youth_outcomes'`,
  ).get() as { entityId: string; reviewStatus: string } | undefined;
  const acceptedRelationship = reopened.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.commission_on_out_of_school_time_grants_and_youth_outcomes:governed_by:dc.office_of_out_of_school_time_grants_and_youth_outcomes'`,
  ).get() as { relationshipId: string } | undefined;
  const remainingRelationshipReview = reopened.listReviewItems({
    mode: "relationships",
    relationshipType: "governed_by",
    subjectPrefix: "relationship.dcgis.boards_commissions_councils.batch_seeded_governing_agency",
  });
  reopened.close();
  assertEquals(
    seededEntity?.entityId,
    "dc.office_of_out_of_school_time_grants_and_youth_outcomes",
  );
  assertEquals(seededEntity?.reviewStatus, "accepted");
  assertEquals(
    acceptedRelationship?.relationshipId,
    "dc.commission_on_out_of_school_time_grants_and_youth_outcomes:governed_by:dc.office_of_out_of_school_time_grants_and_youth_outcomes",
  );
  assertEquals(remainingRelationshipReview.length, 0);
});

Deno.test("batch accept-safe skips non-committee seeded endpoint candidates", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.seeded.batch",
      relationshipCandidateId: "relationship.test.seeded.batch.direct_endpoint",
      sourceItemKey: "direct-endpoint-row",
      fromEntityRef: "dc.parent_entity",
      toEntityRef: "dc.batch_safe_unknown_board",
      relationshipType: "part_of",
      rawValue: "Batch Safe Unknown Board",
      needsReview: false,
    }),
    dataDir,
  );
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--subject-prefix",
      "candidate.test.seeded.batch.relationship_test_seeded_batch_direct_endpoint",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted 0 safe review item(s).");
  assertStringIncludes(batchText, "Skipped 1 item(s) that were not safe to auto-accept.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const candidateStatus = reopened.db.prepare(
    `select review_status as reviewStatus
     from entity_candidates
     where candidate_id = 'candidate.test.seeded.batch.relationship_test_seeded_batch_direct_endpoint_to_endpoint'`,
  ).get() as { reviewStatus: string } | undefined;
  const canonicalEntity = reopened.db.prepare(
    `select entity_id as entityId
     from canonical_entities
     where entity_id = 'dc.batch_safe_unknown_board'`,
  ).get() as { entityId: string } | undefined;
  reopened.close();
  assertEquals(candidateStatus?.reviewStatus, "pending");
  assertEquals(canonicalEntity, undefined);
});

Deno.test("batch accept-safe accepts filtered relationships only when endpoints are accepted", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  for (
    const [entityId, name] of [
      ["dc.dc_health", "Department of Health"],
      ["dc.department_of_behavioral_health", "Department of Behavioral Health"],
    ]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees.committee_on_health_oversight",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted 2 safe review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const acceptedOversight = reopened.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'overseen_by' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  const unresolvedOversight = reopened.listReviewItems({
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees.committee_on_health_oversight",
  });
  reopened.close();
  assertEquals(acceptedOversight.map((row) => row.relationshipId), [
    "dc.dc_health:overseen_by:dc.committee_on_health",
    "dc.department_of_behavioral_health:overseen_by:dc.committee_on_health",
  ]);
  assertEquals(unresolvedOversight.length, 0);
});

Deno.test("batch accept-safe accepts scoped Council oversight only for accepted endpoints", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  for (
    const subjectId of [
      "candidate.council.committees.committee_of_the_whole",
      "candidate.council.committees.committee_on_health",
    ]
  ) {
    await workbench.appendResolutionEvent(
      { eventType: "accept_entity_candidate", subjectId, payload: {} },
      resolutionsDir,
    );
  }
  for (
    const [entityId, name] of [
      ["dc.dc_health", "Department of Health"],
      ["dc.department_of_behavioral_health", "Department of Behavioral Health"],
    ]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted 2 safe review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const acceptedOversight = reopened.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'overseen_by' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  const remainingOversight = reopened.listReviewItems({
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees",
  });
  const blockedOversight = reopened.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_type = 'relationship_candidate'
       and subject_id like 'relationship.council.committees.%'
       and details_json like '%"relationshipType":"overseen_by"%'`,
  ).get() as { count: number };
  reopened.close();
  assertEquals(acceptedOversight.map((row) => row.relationshipId), [
    "dc.dc_health:overseen_by:dc.committee_on_health",
    "dc.department_of_behavioral_health:overseen_by:dc.committee_on_health",
  ]);
  assertEquals(remainingOversight.length, 0);
  assertEquals(blockedOversight.count, 2);
});

Deno.test("batch defer-default defers only scoped default-defer relationship items", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const healthDetailWithDeferredRows = `<html><body>
    <h1>Committee on Health</h1>
    <h2>Agencies Under This Committee</h2>
    <ul>
      <li>Department of Health</li>
      <li>Cedar Hill Hospital</li>
      <li>All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health</li>
    </ul>
  </body></html>`;
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return healthDetailWithDeferredRows;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "defer-default",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Deferred 0 default-defer review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const openOversight = reopened.listReviewItems({
    mode: "relationships",
    status: "open",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees",
  });
  const deferredOversight = reopened.listReviewItems({
    mode: "relationships",
    status: "deferred",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees",
  });
  const blockedOversight = reopened.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_type = 'relationship_candidate'
       and details_json like '%"relationshipType":"overseen_by"%'`,
  ).get() as { count: number };
  reopened.close();
  assertEquals(openOversight.length, 0);
  assertEquals(deferredOversight.length, 0);
  assert(blockedOversight.count >= 3);
});

Deno.test("batch defer-default requires a scoped review slice", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "defer-default",
      "--mode",
      "relationships",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 1);
  assertStringIncludes(
    new TextDecoder().decode(batchOutput.stderr),
    "Batch defer-default requires --mode, --subject-prefix, and at least one narrowing filter.",
  );
});

Deno.test("relationship raw-value filter narrows branch review slices and safe batch acceptance", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const mixedBranchRowsFixture = {
    features: [
      ...dcgisRowsFixture.features,
      {
        attributes: {
          AGENCY_ID: 2001,
          AGENCY_NAME: "District of Columbia Courts",
          TYPE: "Agency",
          BRANCH: "Judicial",
          MAYORAL_CLUSTER: "",
          WEB_URL: "https://dccourts.gov/",
          LEGISLATION: "",
        },
      },
      {
        attributes: {
          AGENCY_ID: 3001,
          AGENCY_NAME: "Example Settlement Fund",
          TYPE: "Fund",
          BRANCH: "Other",
          MAYORAL_CLUSTER: "",
          WEB_URL: "",
          LEGISLATION: "",
        },
      },
    ],
  };
  const bodyForUrl = (url: string): string => {
    switch (url) {
      case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
        return JSON.stringify(dcgisMetadataFixture);
      case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
        return JSON.stringify(mixedBranchRowsFixture);
      default:
        throw new Error(`Unexpected url ${url}`);
    }
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => bodyForUrl(url),
    json: async <T>() => JSON.parse(bodyForUrl(url)) as T,
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  workbench.close();

  const commonArgs = [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-run",
    "--allow-net",
    "--allow-ffi",
    "scripts/dc.ts",
  ];
  const entityBatchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      ...commonArgs,
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--subject-prefix",
      "candidate.dcgis.agencies",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(entityBatchOutput.code, 0);

  const executiveListOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      ...commonArgs,
      "review",
      "list",
      "--mode",
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.dcgis.agencies",
      "--raw-value",
      "Executive",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const executiveList = JSON.parse(
    new TextDecoder().decode(executiveListOutput.stdout),
  ) as {
    count: number;
    items: Array<{ details: { rawValue: string } }>;
  };
  assertEquals(executiveListOutput.code, 0);
  assertEquals(executiveList.count, 0);
  assertEquals(executiveList.items.length, 0);

  const relationshipBatchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      ...commonArgs,
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.dcgis.agencies",
      "--raw-value",
      "Executive",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(relationshipBatchOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(relationshipBatchOutput.stdout),
    "Accepted 0 safe review item(s).",
  );

  const broadRelationshipBatchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      ...commonArgs,
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.dcgis.agencies",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(broadRelationshipBatchOutput.code, 0);
  const broadRelationshipBatchText = new TextDecoder().decode(
    broadRelationshipBatchOutput.stdout,
  );
  assertStringIncludes(broadRelationshipBatchText, "Accepted 0 safe review item(s).");
  assertStringIncludes(
    broadRelationshipBatchText,
    "Skipped 1 item(s) that were not safe to auto-accept.",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const relationshipCount = reopened.db.prepare(
    "select count(*) as count from canonical_relationships",
  ).get() as { count: number };
  const remainingItems = reopened.listReviewItems({
    mode: "relationships",
    relationshipType: "part_of",
    subjectPrefix: "relationship.dcgis.agencies",
  });
  const remainingBranches = remainingItems.map((item) => item.details.rawValue);
  const otherBranchItem = remainingItems.find((item) => item.details.rawValue === "Other");
  reopened.close();
  assertEquals(relationshipCount.count, 3);
  assertEquals(otherBranchItem?.defaultAction, "defer");
  assert(remainingBranches.includes("Other"));
  assert(!remainingBranches.includes("Executive"));
  assert(!remainingBranches.includes("Judicial"));
});

Deno.test("batch defer marks a scoped relationship review slice deferred", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const mixedBranchRowsFixture = {
    features: [
      ...dcgisRowsFixture.features,
      {
        attributes: {
          AGENCY_ID: 3001,
          AGENCY_NAME: "Example Settlement Fund",
          TYPE: "Fund",
          BRANCH: "Other",
          MAYORAL_CLUSTER: "",
          WEB_URL: "",
          LEGISLATION: "",
        },
      },
    ],
  };
  const bodyForUrl = (url: string): string => {
    switch (url) {
      case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
        return JSON.stringify(dcgisMetadataFixture);
      case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
        return JSON.stringify(mixedBranchRowsFixture);
      default:
        throw new Error(`Unexpected url ${url}`);
    }
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => bodyForUrl(url),
    json: async <T>() => JSON.parse(bodyForUrl(url)) as T,
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  workbench.close();

  const entityBatchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--subject-prefix",
      "candidate.dcgis.agencies",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(entityBatchOutput.code, 0);

  const deferOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "defer",
      "--mode",
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.dcgis.agencies",
      "--raw-value",
      "Other",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferOutput.code, 0);
  assertStringIncludes(new TextDecoder().decode(deferOutput.stdout), "Deferred 1 review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const openOther = reopened.listReviewItems({
    mode: "relationships",
    status: "open",
    relationshipType: "part_of",
    subjectPrefix: "relationship.dcgis.agencies",
    rawValue: "Other",
  });
  const deferredOther = reopened.listReviewItems({
    mode: "relationships",
    status: "deferred",
    relationshipType: "part_of",
    subjectPrefix: "relationship.dcgis.agencies",
    rawValue: "Other",
  });
  reopened.close();
  assertEquals(openOther.length, 0);
  assertEquals(deferredOther.length, 1);
});

Deno.test("batch defer marks a raw-value substring relationship slice deferred", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  for (
    const subjectId of [
      "candidate.council.committees.committee_of_the_whole",
      "candidate.council.committees.committee_on_health",
    ]
  ) {
    await workbench.appendResolutionEvent(
      { eventType: "accept_entity_candidate", subjectId, payload: {} },
      resolutionsDir,
    );
  }
  for (
    const [entityId, name] of [
      ["dc.dc_health", "Department of Health"],
      ["dc.department_of_behavioral_health", "Department of Behavioral Health"],
    ]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }
  workbench.close();

  const deferOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "defer",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees",
      "--raw-value-contains",
      "Health",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferOutput.code, 0);
  assertStringIncludes(new TextDecoder().decode(deferOutput.stdout), "Deferred 2 review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const deferredHealth = reopened.listReviewItems({
    mode: "relationships",
    status: "deferred",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees",
    rawValueContains: "Health",
  });
  const openOversight = reopened.listReviewItems({
    mode: "relationships",
    status: "open",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees",
  });
  reopened.close();
  assertEquals(deferredHealth.length, 2);
  assertEquals(openOversight.length, 0);
});

Deno.test("resolution replay rebuilds accepted entities deterministically", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force":
          return openDcTaskForceFixture;
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.open_dc.public_bodies.board_accountancy",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.open_dc.public_bodies.adult_career_pathways_task_force",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.council.committees.committee_of_the_whole",
      payload: {},
    },
    resolutionsDir,
  );
  const entity = workbench.entityView("dc.committee_of_the_whole");
  await workbench.replayResolutionDirectory(resolutionsDir);
  const firstReplay = workbench.entityView("dc.committee_of_the_whole");
  await workbench.replayResolutionDirectory(resolutionsDir);
  const secondReplay = workbench.entityView("dc.committee_of_the_whole");
  workbench.close();
  assertEquals(entity.entityId, "dc.committee_of_the_whole");
  assertEquals(firstReplay.entityId, "dc.committee_of_the_whole");
  assertEquals(secondReplay.entityId, "dc.committee_of_the_whole");
  assertEquals(firstReplay.name, secondReplay.name);
  assertEquals(firstReplay.reviewStatus, "accepted");
  assertEquals(secondReplay.reviewStatus, "accepted");
});

Deno.test("resolution replay rolls back the rebuild when a conflict is found", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const badReplayDir = join(dir, "bad-resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force":
          return openDcTaskForceFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.open_dc.public_bodies.board_accountancy",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.open_dc.public_bodies.adult_career_pathways_task_force",
      payload: {},
    },
    resolutionsDir,
  );
  await ensureDir(join(badReplayDir, "2026-06-01"));
  await Deno.writeTextFile(
    join(badReplayDir, "2026-06-01", "001-conflict.jsonl"),
    [
      JSON.stringify({
        event_type: "accept_entity_candidate",
        subject_id: "candidate.open_dc.public_bodies.board_accountancy",
        payload: {},
      }),
      JSON.stringify({
        event_type: "set_entity_fields",
        subject_id: "dc.board_of_accountancy",
        payload: {
          entityId: "dc.board_of_accountancy",
          fields: { name: "Conflicting Accountancy Board" },
        },
      }),
    ].join("\n") + "\n",
  );

  await assertRejects(
    () => workbench.replayResolutionDirectory(badReplayDir),
    Error,
    "Conflict: dc.board_of_accountancy.name already set",
  );

  const entities = workbench.canonicalEntities();
  workbench.close();
  assertEquals(
    entities.map((entity) => entity.id),
    ["dc.adult_career_pathways_task_force", "dc.board_of_accountancy"],
  );
});

Deno.test("failed resolution append does not write a replay event", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 1 })),
    dataDir,
  );
  const first = await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.open_dc.public_bodies.board_accountancy",
      payload: {},
    },
    resolutionsDir,
  );
  const eventCountBeforeFailure = workbench.db.prepare(
    "select count(*) as count from resolution_events",
  ).get() as { count: number };

  await assertRejects(
    () =>
      workbench.appendResolutionEvent(
        {
          eventType: "set_entity_fields",
          subjectId: "dc.board_of_accountancy",
          payload: {
            entityId: "dc.board_of_accountancy",
            fields: { name: "Conflicting Accountancy Board" },
          },
        },
        resolutionsDir,
      ),
    Error,
    "Conflict: dc.board_of_accountancy.name already set",
  );

  const lines = (await Deno.readTextFile(first.filePath)).trim().split("\n");
  const eventCount = workbench.db.prepare(
    "select count(*) as count from resolution_events",
  ).get() as { count: number };
  workbench.close();
  assertEquals(lines.length, 1);
  assertEquals(eventCount.count, eventCountBeforeFailure.count);
});

Deno.test("resolution append rejects unknown subjects without writing JSONL", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await assertRejects(
    () =>
      workbench.appendResolutionEvent(
        {
          eventType: "reject_entity_candidate",
          subjectId: "candidate.missing",
          payload: {},
        },
        resolutionsDir,
      ),
    Error,
    "Candidate not found: candidate.missing",
  );

  const eventCount = workbench.db.prepare(
    "select count(*) as count from resolution_events",
  ).get() as { count: number };
  workbench.close();
  assertEquals(eventCount.count, 0);
  await assertRejects(() => Deno.stat(resolutionsDir), Deno.errors.NotFound);
});

Deno.test("admin 311 connector fails safely for non-311 layer metadata", async () => {
  const result = await getConnector("admin.service_requests_311").run(
    createConnectorContext({
      fetcher: async () => ({
        status: 200,
        text: async () => admin311WrongLayerFixture,
        json: async <T>() => JSON.parse(admin311WrongLayerFixture) as T,
      }),
    }),
  );
  assertEquals(result.endpointResults[0].status, "failed");
  assertStringIncludes(
    result.endpointResults[0].errorText ?? "",
    "Expected 311 service-request layer",
  );
  assertEquals(result.endpointResults[0].parsed, undefined);
});
