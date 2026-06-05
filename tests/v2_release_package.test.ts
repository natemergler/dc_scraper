import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import {
  buildV2Release,
  RELEASE_FILE_NAMES,
  type ReleaseBuildProgressEvent,
} from "../src/v2/release.ts";
import { renderReleaseBuildProgress } from "../src/v2/cli_release.ts";
import { buildReleaseInspection, renderReleaseInspection } from "../src/v2/release_inspect.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { syntheticEntitySourceResult } from "./helpers/v2_reconciliation_helpers.ts";
import { assertReleaseReadmeOmitsWorkbenchStatusLanguage } from "./helpers/v2_release_readme_assertions.ts";

Deno.test("release inspection readiness summarizes unresolved work severity", async () => {
  const outDir = await makeMinimalReleaseDir();
  assertEquals(
    (await buildReleaseInspection(outDir, {
      files: [],
      release_summary: {
        source_count: 1,
        open_review_item_count: 0,
        deferred_review_item_count: 0,
        stale_review_item_count: 0,
        blocked_reconciliation_count: 0,
        placeholder_entity_count: 0,
        failed_source_count: 0,
      },
    })).readiness,
    "usable",
  );
  assertEquals(
    (await buildReleaseInspection(outDir, {
      files: [],
      release_summary: {
        source_count: 1,
        open_review_item_count: 2,
        deferred_review_item_count: 0,
        stale_review_item_count: 0,
        blocked_reconciliation_count: 0,
        placeholder_entity_count: 0,
        failed_source_count: 0,
      },
    })).readiness,
    "usable-with-warnings",
  );
  assertEquals(
    (await buildReleaseInspection(outDir, {
      files: [],
      release_summary: {
        source_count: 1,
        open_review_item_count: 0,
        deferred_review_item_count: 0,
        stale_review_item_count: 1,
        blocked_reconciliation_count: 0,
        placeholder_entity_count: 0,
        failed_source_count: 0,
      },
    })).readiness,
    "not-ready",
  );
});

Deno.test("release inspection treats zero-source packages as not-ready", async () => {
  const outDir = await makeMinimalReleaseDir();
  const inspection = await buildReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 0,
      open_review_item_count: 0,
      deferred_review_item_count: 0,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 0,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });

  assertEquals(inspection.packageIntegrity, "ok");
  assertEquals(inspection.readiness, "not-ready");
});

Deno.test("release inspection treats missing file manifest as not-ready", async () => {
  const outDir = await makeMinimalReleaseDir();
  const inspection = await buildReleaseInspection(outDir, {
    release_summary: {
      open_review_item_count: 0,
      deferred_review_item_count: 0,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 0,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });

  assertEquals(inspection.packageIntegrity, "unknown");
  assertEquals(inspection.readiness, "not-ready");
});

Deno.test("release inspection renders legal attachment counts from the manifest", async () => {
  const outDir = await makeMinimalReleaseDir();
  const text = await renderReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_review_item_count: 0,
      deferred_review_item_count: 0,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 0,
      placeholder_entity_count: 0,
      failed_source_count: 0,
      entity_legal_refs_count: 3,
      relationship_legal_refs_count: 0,
    },
  });

  assertStringIncludes(text, "Legal attachments: entity=3, relationship=0");
});

Deno.test("release inspection renders readiness reasons from the manifest", async () => {
  const outDir = await makeMinimalReleaseDir();
  const text = await renderReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 2,
      deferred_review_item_count: 1,
      stale_review_item_count: 1,
      blocked_reconciliation_count: 0,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });

  assertStringIncludes(text, "Release readiness: not-ready");
  assertStringIncludes(
    text,
    "Readiness reasons: stale review items: 1",
  );
  assertStringIncludes(text, "Warnings: open decisions: 2; deferred review items: 1");
});

Deno.test("release inspection json separates warning reasons from blocking reasons", async () => {
  const outDir = await makeMinimalReleaseDir();
  const inspection = await buildReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 2,
      deferred_review_item_count: 1,
      stale_review_item_count: 1,
      blocked_reconciliation_count: 0,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });

  assertEquals(inspection.readiness, "not-ready");
  assertEquals(inspection.readinessReasons, ["stale review items: 1"]);
  assertEquals(inspection.warningReasons, [
    "open decisions: 2",
    "deferred review items: 1",
  ]);
  assertEquals(
    inspection.warningReviewCommand,
    "deno task dc -- review list --status all --decisions",
  );
});

Deno.test("release inspection surfaces public-body variant compare handoff", async () => {
  const outDir = await makeMinimalReleaseDir();
  const text = await renderReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 0,
      deferred_review_item_count: 0,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 0,
      public_body_variant_lead_count: 1,
      public_body_release_risk_variant_lead_count: 1,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });
  const inspection = await buildReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 0,
      deferred_review_item_count: 0,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 0,
      public_body_variant_lead_count: 1,
      public_body_release_risk_variant_lead_count: 1,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });

  assertEquals(inspection.readiness, "usable-with-warnings");
  assertEquals(inspection.warningReasons, ["public body duplicate-risk leads: 1"]);
  assertEquals(
    inspection.publicBodyCompareCommand,
    "deno task dc -- source compare public-bodies",
  );
  assertEquals(inspection.nextCommand, "deno task dc -- source compare public-bodies");
  assertStringIncludes(
    text,
    "Compare public bodies: deno task dc -- source compare public-bodies",
  );
  assertStringIncludes(text, "Next: deno task dc -- source compare public-bodies");
});

Deno.test("release inspection warns on accepted multi-governor entities", async () => {
  const outDir = await makeMinimalReleaseDir();
  const text = await renderReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 0,
      deferred_review_item_count: 0,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 0,
      accepted_multi_governor_entity_count: 3,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });
  const inspection = await buildReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 0,
      deferred_review_item_count: 0,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 0,
      accepted_multi_governor_entity_count: 3,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });

  assertEquals(inspection.readiness, "usable-with-warnings");
  assertEquals(inspection.warningReasons, ["multi-governor entities: 3"]);
  assertStringIncludes(text, "Warnings: multi-governor entities: 3");
});

Deno.test("release inspection warns on accepted public bodies missing official URLs", async () => {
  const outDir = await makeMinimalReleaseDir();
  const text = await renderReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 0,
      deferred_review_item_count: 0,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 0,
      accepted_multi_governor_entity_count: 0,
      accepted_public_body_missing_official_url_count: 25,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });
  const inspection = await buildReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 0,
      deferred_review_item_count: 0,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 0,
      accepted_multi_governor_entity_count: 0,
      accepted_public_body_missing_official_url_count: 25,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });

  assertEquals(inspection.readiness, "usable-with-warnings");
  assertEquals(inspection.warningReasons, ["public bodies missing official URLs: 25"]);
  assertStringIncludes(text, "Warnings: public bodies missing official URLs: 25");
});

Deno.test("release inspection points browse-only rows back to review list", async () => {
  const outDir = await makeMinimalReleaseDir();
  const text = await renderReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 0,
      open_review_item_count: 1,
      browse_only_open_review_item_count: 1,
      deferred_review_item_count: 0,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 0,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });
  const inspection = await buildReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 0,
      open_review_item_count: 1,
      browse_only_open_review_item_count: 1,
      deferred_review_item_count: 0,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 0,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });

  assertEquals(inspection.readiness, "usable");
  assertEquals(inspection.warningReasons, []);
  assertEquals(inspection.browseCommand, "deno task dc -- review list --status all");
  assertEquals(inspection.nextCommand, "deno task dc -- review list --status all");
  assertStringIncludes(text, "Browse rows: deno task dc -- review list --status all");
  assertStringIncludes(text, "Next: deno task dc -- review list --status all");
});

Deno.test("release inspection points blocker states back to audit before warnings", async () => {
  const outDir = await makeMinimalReleaseDir();
  const text = await renderReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 2,
      deferred_review_item_count: 1,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 1,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });
  const inspection = await buildReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 2,
      deferred_review_item_count: 1,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 1,
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });

  assertEquals(inspection.readiness, "not-ready");
  assertEquals(
    inspection.warningReviewCommand,
    "deno task dc -- review list --status all --decisions",
  );
  assertEquals(inspection.nextCommand, "deno task dc -- audit");
  assertStringIncludes(text, "Next: deno task dc -- audit");
});

Deno.test("release inspection points blocked sources straight to source inspection", async () => {
  const outDir = await makeMinimalReleaseDir();
  const text = await renderReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 2,
      deferred_review_item_count: 1,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 1,
      blocked_reconciliation_by_source: [{ source_id: "open_dc.public_bodies", count: 1 }],
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });
  const inspection = await buildReleaseInspection(outDir, {
    files: [],
    release_summary: {
      source_count: 1,
      open_human_decision_review_item_count: 2,
      deferred_review_item_count: 1,
      stale_review_item_count: 0,
      blocked_reconciliation_count: 1,
      blocked_reconciliation_by_source: [{ source_id: "open_dc.public_bodies", count: 1 }],
      placeholder_entity_count: 0,
      failed_source_count: 0,
    },
  });

  assertEquals(inspection.readiness, "not-ready");
  assertEquals(inspection.inspectCommand, "deno task dc -- source inspect open_dc.public_bodies");
  assertEquals(inspection.nextCommand, "deno task dc -- source inspect open_dc.public_bodies");
  assertStringIncludes(
    text,
    "Inspect source: deno task dc -- source inspect open_dc.public_bodies",
  );
  assertStringIncludes(text, "Next: deno task dc -- source inspect open_dc.public_bodies");
});

Deno.test("release builder reports progress phases for long package builds", async () => {
  const dir = await Deno.makeTempDir();
  const workbench = new Workbench(join(dir, "workbench.sqlite"));
  workbench.init();
  const events: ReleaseBuildProgressEvent[] = [];

  await buildV2Release(workbench, join(dir, "release"), {
    gitCommit: "fixture",
    repoRoot: dir,
    onProgress: (event) => events.push(event),
  });
  workbench.close();

  assertEquals(events.map((event) => event.phase), [
    "prepare",
    "read-workbench",
    "summarize",
    "write-files",
    "write-sqlite",
    "write-manifest",
  ]);
  assertEquals(events.find((event) => event.phase === "summarize")?.counts?.entities, 0);
  assertEquals(
    events.find((event) => event.phase === "write-files")?.fileCount,
    RELEASE_FILE_NAMES.length - 3,
  );
  assertEquals(
    events.find((event) => event.phase === "write-manifest")?.fileCount,
    RELEASE_FILE_NAMES.length,
  );

  assertStringIncludes(
    renderReleaseBuildProgress(events.find((event) => event.phase === "read-workbench")!),
    "Release build: Reading accepted release rows",
  );
  assertStringIncludes(
    renderReleaseBuildProgress(events.find((event) => event.phase === "write-sqlite")!),
    "Release build: Writing dcgov.sqlite",
  );
  assertStringIncludes(
    renderReleaseBuildProgress(events.find((event) => event.phase === "summarize")!),
    "entities=0 relationships=0 sources=0 datasets=0 legal_refs=0",
  );
});

Deno.test("release build CLI keeps final success on stdout and progress on stderr", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const outDir = join(dir, "release");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.close();

  const output = await runDcCli([
    "release",
    "build",
    "--db",
    dbPath,
    "--out",
    outDir,
  ]);
  const stdout = output.stdout;
  const stderr = output.stderr;

  assertEquals(output.code, 0);
  assertStringIncludes(stdout, `Built release ${outDir}`);
  assertStringIncludes(stdout, `Inspect: deno task dc -- release inspect --out ${outDir}`);
  assertStringIncludes(stdout, `Next: deno task dc -- release inspect --out ${outDir}`);
  assert(!stdout.includes("Writing dcgov.sqlite"));
  assertStringIncludes(stderr, "Release build: Preparing release directory");
  assertStringIncludes(stderr, "Release build: Writing dcgov.sqlite");
  assertStringIncludes(
    stderr,
    `Release build: Writing README and manifest files=${RELEASE_FILE_NAMES.length}`,
  );
});

Deno.test("release build CLI json includes inspect handoff while progress stays on stderr", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const outDir = join(dir, "release-json");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.close();

  const output = await runDcCli([
    "release",
    "build",
    "--db",
    dbPath,
    "--out",
    outDir,
    "--json",
  ]);
  const result = JSON.parse(output.stdout) as {
    outDir: string;
    fileNames: string[];
    inspectCommand: string;
    nextCommand: string;
  };

  assertEquals(output.code, 0);
  assertEquals(result.outDir, outDir);
  assertEquals(result.inspectCommand, `deno task dc -- release inspect --out ${outDir}`);
  assertEquals(result.nextCommand, `deno task dc -- release inspect --out ${outDir}`);
  assertEquals(result.fileNames.includes("manifest.json"), true);
  assert(!output.stdout.includes("Built release"));
  assertStringIncludes(output.stderr, "Release build: Preparing release directory");
});

Deno.test("release build CLI accepts --output as an alias for --out", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const outDir = join(dir, "release-output-alias");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.close();

  const output = await runDcCli([
    "release",
    "build",
    "--db",
    dbPath,
    "--output",
    outDir,
  ]);
  const stdout = output.stdout;

  assertEquals(output.code, 0);
  assertStringIncludes(stdout, `Built release ${outDir}`);
  assertStringIncludes(stdout, `Inspect: deno task dc -- release inspect --out ${outDir}`);
  assertStringIncludes(stdout, `Next: deno task dc -- release inspect --out ${outDir}`);
  assertEquals(await exists(join(outDir, "manifest.json")), true);
});

Deno.test("release inspect CLI accepts --output as an alias for --out", async () => {
  const outDir = await makeMinimalReleaseDir();

  const output = await runDcCli([
    "release",
    "inspect",
    "--output",
    outDir,
    "--json",
  ]);
  const inspection = JSON.parse(output.stdout) as { outDir: string };

  assertEquals(output.code, 0);
  assertEquals(inspection.outDir, outDir);
});

Deno.test("release builder creates focused v2 package with stable files and no raw source rows in entity csv", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, official_url, review_status, merged_candidate_ids, created_at, updated_at) values('dc.board_accountancy', 'Board of Accountancy', 'board', 'https://www.open-dc.gov/public-bodies/board-accountancy', 'accepted', '[\"candidate.open_dc.public_bodies.board_accountancy\"]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.139', '139', 'budgetary', 'accepted', '[\"candidate.dcgis.agencies.1160\"]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.example_settlement_fund', 'Example Settlement Fund', 'budgetary', 'accepted', '[\"candidate.dcgis.agencies.3002\"]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, official_url, review_status, merged_candidate_ids, created_at, updated_at) values('dc.april_board_of_accountancy', 'April Board of Accountancy -', 'board', 'https://www.open-dc.gov/public-bodies/april-board-accountancy-recess', 'accepted', '[\"candidate.open_dc.public_bodies.april_board_accountancy_recess\"]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, official_url, review_status, merged_candidate_ids, created_at, updated_at) values('dc.jobs_wages_and_benefits_working_group', 'Working group on jobs, wages and benefits will be a time phased advisory group to the Mayor', 'public_body', 'https://www.open-dc.gov/public-bodies/working-group-jobs-wages-and-benefits-will-be-time-phased-advisory-group-mayor', 'accepted', '[\"candidate.open_dc.public_bodies.working_group_jobs_wages_and_benefits_will_be_time_phased_advisory_group_mayor\"]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values('dc.pending_body', 'Pending Body', 'placeholder', 'placeholder', '[]', 1, 'fixture placeholder', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into resolution_events(event_id, event_type, subject_id, payload_json, resolution_file, sequence_number, created_at) values('event.1', 'accept_relationship_candidate', 'relationship.fixture', '{}', 'fixture.jsonl', 1, datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.board_accountancy:part_of:dc.council', 'dc.board_accountancy', 'part_of', 'dc.council', 'accepted', 'event.1', datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.april_board_of_accountancy:part_of:dc.council', 'dc.april_board_of_accountancy', 'part_of', 'dc.council', 'accepted', 'event.1', datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.jobs_wages_and_benefits_working_group:part_of:dc.council', 'dc.jobs_wages_and_benefits_working_group', 'part_of', 'dc.council', 'accepted', 'event.1', datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.board_accountancy:part_of:dc.pending_body', 'dc.board_accountancy', 'part_of', 'dc.pending_body', 'accepted', 'event.1', datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.board_accountancy:overseen_by:dc.council', 'dc.board_accountancy', 'overseen_by', 'dc.council', 'rejected', 'event.1', datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.example_settlement_fund:overseen_by:dc.council', 'dc.example_settlement_fund', 'overseen_by', 'dc.council', 'accepted', 'event.1', datetime('now'))",
  ).run();
  workbench.upsertSource(
    "open_dc.public_bodies",
    "Open DC Public Bodies",
    "public_body_pages",
    "official_page_html",
    "https://www.open-dc.gov/public-bodies",
  );
  workbench.upsertEndpoint({
    endpointId: "open_dc.public_bodies.detail",
    sourceId: "open_dc.public_bodies",
    title: "Open DC Public Body Detail",
    kind: "page",
    url: "https://www.open-dc.gov/public-bodies/board-accountancy",
    method: "GET",
    captureMode: "page",
  });
  workbench.db.prepare(
    "insert into source_runs(run_id, source_id, endpoint_id, started_at, finished_at, status) values('run.privacy', 'open_dc.public_bodies', 'open_dc.public_bodies.detail', datetime('now'), datetime('now'), 'success')",
  ).run();
  workbench.db.prepare(
    "insert into source_artifacts(artifact_id, run_id, endpoint_id, kind, path, fetched_url, content_hash, size_bytes, created_at) values('artifact.privacy', 'run.privacy', 'open_dc.public_bodies.detail', 'page', 'open_dc/public-bodies/detail.html', 'https://www.open-dc.gov/public-bodies/board-accountancy', 'sha256:fixture', 100, datetime('now'))",
  ).run();
  const auxiliaryArtifactUrl =
    "https://raw.githubusercontent.com/DCCouncil/law-html/master/index.json";
  workbench.db.prepare(
    "insert into source_artifacts(artifact_id, run_id, endpoint_id, kind, path, fetched_url, content_hash, size_bytes, created_at) values('artifact.auxiliary', 'run.privacy', 'open_dc.public_bodies.detail', 'json', 'open_dc/public-bodies/auxiliary.json', ?, 'sha256:auxiliary', 101, datetime('now', '+1 second'))",
  ).run(auxiliaryArtifactUrl);
  workbench.db.prepare(
    "insert into source_items(source_item_id, source_id, endpoint_id, run_id, artifact_id, item_key, item_type, title, body_json) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run([
    "item.private_contact",
    "open_dc.public_bodies",
    "open_dc.public_bodies.detail",
    "run.privacy",
    "artifact.privacy",
    "board-accountancy",
    "public_body_detail",
    "Board of Accountancy",
    JSON.stringify({
      email: "not-for-release@example.com",
      phone: "202-555-0100",
      contact_notes: "private contact metadata",
    }),
  ]);
  workbench.db.prepare(
    "insert into datasets(dataset_id, source_item_id, name, category, owner_name, access_method, artifact_depth, official_url, review_status) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run([
    "dataset.council.lims.whats_new",
    "item.private_contact",
    "Council LIMS What's New feed",
    "legislative",
    "Council of the District of Columbia",
    "official_json_api",
    "sample",
    "https://lims.dccouncil.gov/api/Search/GetWhatsNew",
    "pending",
  ]);
  workbench.db.prepare(
    "insert into legal_refs(legal_ref_id, source_item_id, ref_type, citation_text, normalized_citation, url, review_status) values(?, ?, ?, ?, ?, ?, ?)",
  ).run([
    "legal.open_dc.public_bodies.board_accountancy_authority",
    "item.private_contact",
    "dc_code",
    "D.C. Official Code § 47-2853.06(b)(1)",
    "D.C. Code 47-2853.06(b)(1)",
    "https://code.dccouncil.us/us/dc/council/code/sections/47-2853.06#(b)(1)",
    "accepted",
  ]);
  workbench.db.prepare(
    "insert into entity_legal_refs(entity_legal_ref_id, entity_id, legal_ref_id) values(?, ?, ?)",
  ).run([
    "entity_legal_ref.board_accountancy.authority",
    "dc.board_accountancy",
    "legal.open_dc.public_bodies.board_accountancy_authority",
  ]);
  workbench.db.prepare(
    "insert into relationship_legal_refs(relationship_legal_ref_id, relationship_id, legal_ref_id) values(?, ?, ?)",
  ).run([
    "relationship_legal_ref.board_accountancy.part_of.authority",
    "dc.board_accountancy:part_of:dc.council",
    "legal.open_dc.public_bodies.board_accountancy_authority",
  ]);
  const outDir = join(dir, "release");
  const staleFile = join(outDir, "stale-extra-report.csv");
  await ensureDir(outDir);
  await Deno.writeTextFile(staleFile, "stale");
  const result = await buildV2Release(workbench, outDir);
  const entityCsv = await Deno.readTextFile(join(outDir, "entities", "all_entities.csv"));
  const electedCsv = await Deno.readTextFile(join(outDir, "entities", "elected_and_seats.csv"));
  const boardsCsv = await Deno.readTextFile(
    join(outDir, "entities", "boards_commissions_public_bodies.csv"),
  );
  const relationshipsCsv = await Deno.readTextFile(
    join(outDir, "relationships", "all_relationships.csv"),
  );
  const structureRelationshipsCsv = await Deno.readTextFile(
    join(outDir, "relationships", "structure_relationships.csv"),
  );
  const entityLegalAuthoritiesCsv = await Deno.readTextFile(
    join(outDir, "references", "entity_legal_authorities.csv"),
  );
  const relationshipLegalAuthoritiesCsv = await Deno.readTextFile(
    join(outDir, "references", "relationship_legal_authorities.csv"),
  );
  const entitySourcesCsv = await Deno.readTextFile(
    join(outDir, "references", "entity_sources.csv"),
  );
  const relationshipSourcesCsv = await Deno.readTextFile(
    join(outDir, "references", "relationship_sources.csv"),
  );
  const sourcesCsv = await Deno.readTextFile(join(outDir, "01_sources_and_portals.csv"));
  const datasetsCsv = await Deno.readTextFile(join(outDir, "02_public_datasets.csv"));
  const legalRefsCsv = await Deno.readTextFile(join(outDir, "03_legal_authorities.csv"));
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  const manifestText = await Deno.readTextFile(join(outDir, "manifest.json"));
  const manifest = JSON.parse(manifestText);
  const releaseDb = new Database(join(outDir, "dcgov.sqlite"));
  const releaseObjects = releaseDb.prepare(
    "select name from sqlite_master where type in ('table', 'view') and name not like 'sqlite_%' order by name",
  ).all().map((row) => String((row as { name: string }).name));
  const releaseDbContactHits = releaseDb.prepare(
    "select count(*) as count from legal_refs where source_item_id like '%not-for-release%' or citation_text like '%not-for-release%'",
  ).get() as { count: number };
  const relationshipForeignKeys = releaseDb.prepare(
    "pragma foreign_key_list(relationships)",
  ).all();
  releaseDb.close();
  workbench.close();
  assertEquals(result.fileNames.sort(), [...RELEASE_FILE_NAMES].sort());
  for (const fileName of result.fileNames) {
    assertStringIncludes(readme, fileName);
  }
  assertStringIncludes(
    entityCsv.split("\n")[0],
    "entity_id,name,entity_group,entity_type,entity_subtype,description,scope,parent_entity_id,parent_entity_name,branch_or_cluster,ward,official_url,primary_source_id,primary_source_name,legal_authority_count,relationship_count,source_count,release_note",
  );
  assert(!entityCsv.includes("source_item_id"));
  assert(!entityCsv.includes("dc.139,139,budgetary"));
  assert(!entityCsv.includes("dc.example_settlement_fund"));
  assert(!entityCsv.includes("dc.april_board_of_accountancy"));
  assert(!entityCsv.includes("dc.jobs_wages_and_benefits_working_group"));
  assert(!entityCsv.includes("dc.pending_body"));
  assert(!entityCsv.includes("not-for-release@example.com"));
  assertStringIncludes(entityCsv, "dc.board_accountancy,Board of Accountancy");
  assertStringIncludes(entityCsv, "board_commission_public_body");
  assertStringIncludes(entityCsv, "dc.council,Council of the District of Columbia");
  assertStringIncludes(boardsCsv, "dc.board_accountancy,Board of Accountancy");
  assert(!electedCsv.includes("dc.board_accountancy"));
  assertStringIncludes(
    relationshipsCsv.split("\n")[0],
    "relationship_id,relationship_group,relationship_type,from_entity_id,from_name,from_group,from_type,to_entity_id,to_name,to_group,to_type,source_id,source_name,legal_authority_id,release_note",
  );
  assertStringIncludes(
    relationshipsCsv,
    "dc.board_accountancy:part_of:dc.council,structure,part_of,dc.board_accountancy,Board of Accountancy",
  );
  assertStringIncludes(structureRelationshipsCsv, "dc.board_accountancy:part_of:dc.council");
  assertStringIncludes(
    entityLegalAuthoritiesCsv,
    "entity_id,entity_name,legal_authority_id,authority_type,citation_text,normalized_citation,public_url,review_status",
  );
  assertStringIncludes(entityLegalAuthoritiesCsv, "dc.board_accountancy");
  assertEquals(entityLegalAuthoritiesCsv.split("\n").length > 1, true);
  assertStringIncludes(
    relationshipLegalAuthoritiesCsv,
    "relationship_id,from_entity_id,from_name,relationship_type,to_entity_id,to_name,legal_authority_id,authority_type,citation_text,normalized_citation,public_url,review_status",
  );
  assertStringIncludes(relationshipLegalAuthoritiesCsv, "dc.board_accountancy:part_of:dc.council");
  assertStringIncludes(
    entitySourcesCsv.split("\n")[0],
    "entity_id,entity_name,source_id,source_name,source_item_label,source_field,observed_value,public_url,artifact_hash,note",
  );
  assertStringIncludes(
    relationshipSourcesCsv.split("\n")[0],
    "relationship_id,relationship_type,from_entity_id,from_name,to_entity_id,to_name,source_id,source_name,source_item_label,source_field,observed_value,public_url,artifact_hash,note",
  );
  assert(!relationshipsCsv.includes("dc.example_settlement_fund:overseen_by:dc.council"));
  assert(!relationshipsCsv.includes("dc.april_board_of_accountancy"));
  assert(!relationshipsCsv.includes("dc.jobs_wages_and_benefits_working_group:part_of:dc.council"));
  assert(!relationshipsCsv.includes("dc.board_accountancy:part_of:dc.pending_body"));
  assert(!relationshipsCsv.includes("dc.board_accountancy:overseen_by:dc.council"));
  assert(!legalRefsCsv.includes("not-for-release@example.com"));
  assert(!manifestText.includes("not-for-release@example.com"));
  assert(!manifestText.includes("202-555-0100"));
  assertEquals(releaseDbContactHits.count, 0);
  await assertRejects(() => Deno.stat(staleFile), Deno.errors.NotFound);
  assertStringIncludes(readme, "DCGov Release");
  assertStringIncludes(
    readme,
    "`entities/all_entities.csv`: human-readable entity directory",
  );
  assertStringIncludes(
    readme,
    "`relationships/all_relationships.csv`: directed relationships with endpoint names",
  );
  assertStringIncludes(
    readme,
    "`references/entity_legal_authorities.csv`: entity-linked legal authority attachments",
  );
  assertStringIncludes(readme, "## Model semantics");
  assertStringIncludes(readme, "## Package counts");
  assertStringIncludes(
    readme,
    "CSV files are human-facing grouped views; `dcgov.sqlite` is the full queryable package.",
  );
  assertStringIncludes(
    readme,
    "Public official observations are source-backed role or seat observations, not a personnel or contact directory.",
  );
  assertStringIncludes(
    readme,
    "`relationships/all_relationships.csv`: one directed fact per row, with endpoint names and groups.",
  );
  assertStringIncludes(
    readme,
    "Relationship families: structure (`part_of`, `has_seat`, `has_status`), authority/source (`governed_by`, `overseen_by`, `appointed_by`, `designated_by`, `authorized_by`, `published_by`), and civic role (`holds`, `represents`, `member_of`, `chairs`).",
  );
  assertStringIncludes(
    readme,
    "Relationship direction guide: `part_of` points from a component to its containing entity;",
  );
  assertStringIncludes(
    readme,
    "`has_seat`/`has_status` point from a body, seat, or observation to the seat/status marker;",
  );
  assertStringIncludes(
    readme,
    "DC city/county distinctions are not inferred beyond source-backed civic structure labels.",
  );
  assertStringIncludes(readme, "entities: total=2");
  assertStringIncludes(readme, "relationships: total=1");
  assertStringIncludes(readme, "entity legal refs: total=1");
  assertStringIncludes(readme, "relationship legal refs: total=1");
  assertStringIncludes(readme, "legal refs: total=1");
  assertReleaseReadmeOmitsWorkbenchStatusLanguage(readme);
  assertStringIncludes(
    sourcesCsv.split("\n")[0],
    "source_id,source_name,source_group,publisher,public_url,access_method,capture_depth,release_role,dataset_count,entity_count,relationship_count,legal_authority_count,notes",
  );
  assertStringIncludes(sourcesCsv, "https://www.open-dc.gov/public-bodies/board-accountancy");
  assert(!sourcesCsv.includes(auxiliaryArtifactUrl));
  assertStringIncludes(
    datasetsCsv.split("\n")[0],
    "dataset_id,name,dataset_group,publisher,source_id,source_name,public_url,access_method,capture_depth,release_note",
  );
  assertStringIncludes(
    legalRefsCsv.split("\n")[0],
    "legal_authority_id,authority_type,law_family,citation_text,normalized_citation,title_or_label,statutory_or_administrative,public_url,source_id,source_name,attached_entity_id,attached_entity_name,attached_relationship_id,review_status,release_note",
  );
  assertStringIncludes(manifestText, auxiliaryArtifactUrl);
  assert(!sourcesCsv.includes("/tmp/"));
  assertEquals(Array.isArray(manifest.release_summary.entities_by_review_status), true);
  assertEquals(Array.isArray(manifest.source_artifacts), true);
  assertEquals(releaseObjects, [
    "datasets",
    "entities",
    "entity_legal_refs",
    "incoming_relationships",
    "legal_refs",
    "relationship_legal_refs",
    "relationships",
    "sources",
  ]);
  assertEquals(relationshipForeignKeys.length, 2);
  const inspectOutput = await runDcCli(["release", "inspect", "--out", outDir]);
  const inspectText = inspectOutput.stdout;
  assertEquals(inspectOutput.code, 0);
  assertStringIncludes(inspectText, `Files: ${RELEASE_FILE_NAMES.length}`);
  assertStringIncludes(inspectText, "Package integrity: ok");
  assertStringIncludes(inspectText, "Entities: accepted=2");
  assertStringIncludes(inspectText, "Relationships: accepted=1");
  const inspectJsonOutput = await runDcCli(["release", "inspect", "--out", outDir, "--json"]);
  const inspectJson = JSON.parse(inspectJsonOutput.stdout) as {
    outDir: string;
    fileCount: number;
    packageIntegrity: string;
    packageProblems: Array<{ fileName: string; problem: string }>;
    releaseSummary: { source_count: number };
  };
  assertEquals(inspectJsonOutput.code, 0);
  assertEquals(inspectJson.outDir, outDir);
  assertEquals(inspectJson.fileCount, RELEASE_FILE_NAMES.length);
  assertEquals(inspectJson.packageIntegrity, "ok");
  assertEquals(inspectJson.packageProblems, []);
  assertEquals(inspectJson.releaseSummary.source_count, 1);
  if (manifest.source_artifacts.length > 0) {
    assertEquals(Object.keys(manifest.source_artifacts[0]).includes("content_hash"), true);
    assertEquals(Object.keys(manifest.source_artifacts[0]).includes("path"), false);
  }
});

Deno.test("release builder excludes unknown legal refs from public package rows", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.legal_unknown_body', 'Legal Unknown Body', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.legal_authority', 'Legal Authority', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into resolution_events(event_id, event_type, subject_id, payload_json, resolution_file, sequence_number, created_at) values('event.pending_unknown_relationship', 'accept_relationship_candidate', 'relationship.pending_unknown', '{}', 'fixture.jsonl', 1, datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.legal_unknown_body:authorized_by:dc.legal_authority', 'dc.legal_unknown_body', 'authorized_by', 'dc.legal_authority', 'accepted', 'event.pending_unknown_relationship', datetime('now'))",
  ).run();
  workbench.upsertSource(
    "test.pending_unknown_legal_refs",
    "Pending Unknown Legal Refs",
    "fixture",
    "fixture",
    "https://example.com/pending-unknown-legal-refs",
  );
  workbench.upsertEndpoint({
    endpointId: "test.pending_unknown_legal_refs.main",
    sourceId: "test.pending_unknown_legal_refs",
    title: "Pending Unknown Legal Refs",
    kind: "fixture",
    url: "https://example.com/pending-unknown-legal-refs",
    method: "GET",
    captureMode: "rows",
  });
  workbench.db.prepare(
    "insert into source_runs(run_id, source_id, endpoint_id, started_at, finished_at, status) values('run.pending_unknown_legal_refs', 'test.pending_unknown_legal_refs', 'test.pending_unknown_legal_refs.main', datetime('now'), datetime('now'), 'success')",
  ).run();
  workbench.db.prepare(
    "insert into source_artifacts(artifact_id, run_id, endpoint_id, kind, path, fetched_url, content_hash, size_bytes, created_at) values('artifact.pending_unknown_legal_refs', 'run.pending_unknown_legal_refs', 'test.pending_unknown_legal_refs.main', 'rows', 'pending-unknown-legal-refs.json', 'https://example.com/pending-unknown-legal-refs', 'sha256:pending-unknown', 100, datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into source_items(source_item_id, source_id, endpoint_id, run_id, artifact_id, item_key, item_type, title, body_json) values('item.pending_unknown_legal_ref', 'test.pending_unknown_legal_refs', 'test.pending_unknown_legal_refs.main', 'run.pending_unknown_legal_refs', 'artifact.pending_unknown_legal_refs', 'pending-unknown', 'fixture_legal_ref', 'Organizational ByLaws', '{}')",
  ).run();
  workbench.db.prepare(
    "insert into legal_refs(legal_ref_id, source_item_id, ref_type, citation_text, normalized_citation, url, review_status) values('legal.pending_unknown.by_laws', 'item.pending_unknown_legal_ref', 'unknown', 'Organizational ByLaws', null, null, 'accepted')",
  ).run();
  workbench.db.prepare(
    "insert into entity_legal_refs(entity_legal_ref_id, entity_id, legal_ref_id) values('entity_legal_ref.pending_unknown.by_laws', 'dc.legal_unknown_body', 'legal.pending_unknown.by_laws')",
  ).run();
  workbench.db.prepare(
    "insert into relationship_legal_refs(relationship_legal_ref_id, relationship_id, legal_ref_id) values('relationship_legal_ref.pending_unknown.by_laws', 'dc.legal_unknown_body:authorized_by:dc.legal_authority', 'legal.pending_unknown.by_laws')",
  ).run();

  const outDir = join(dir, "release");
  await buildV2Release(workbench, outDir);

  const legalRefsCsv = await Deno.readTextFile(join(outDir, "03_legal_authorities.csv"));
  const entityLegalAuthoritiesCsv = await Deno.readTextFile(
    join(outDir, "references", "entity_legal_authorities.csv"),
  );
  const relationshipLegalAuthoritiesCsv = await Deno.readTextFile(
    join(outDir, "references", "relationship_legal_authorities.csv"),
  );
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json")));
  const releaseDb = new Database(join(outDir, "dcgov.sqlite"));
  const releaseDbCounts = releaseDb.prepare(
    "select (select count(*) from legal_refs) as legalRefs, (select count(*) from entity_legal_refs) as entityLegalRefs, (select count(*) from relationship_legal_refs) as relationshipLegalRefs",
  ).get() as { legalRefs: number; entityLegalRefs: number; relationshipLegalRefs: number };
  releaseDb.close();
  workbench.close();

  assert(!legalRefsCsv.includes("Organizational ByLaws"));
  assertEquals(
    legalRefsCsv.trim(),
    "legal_authority_id,authority_type,law_family,citation_text,normalized_citation,title_or_label,statutory_or_administrative,public_url,source_id,source_name,attached_entity_id,attached_entity_name,attached_relationship_id,review_status,release_note",
  );
  assertEquals(
    entityLegalAuthoritiesCsv.trim(),
    "entity_id,entity_name,legal_authority_id,authority_type,citation_text,normalized_citation,public_url,review_status",
  );
  assertEquals(
    relationshipLegalAuthoritiesCsv.trim(),
    "relationship_id,from_entity_id,from_name,relationship_type,to_entity_id,to_name,legal_authority_id,authority_type,citation_text,normalized_citation,public_url,review_status",
  );
  assertStringIncludes(readme, "legal refs: total=0");
  assertStringIncludes(readme, "entity legal refs: total=0");
  assertStringIncludes(readme, "relationship legal refs: total=0");
  assertEquals(manifest.release_summary.legal_refs_by_review_status, []);
  assertEquals(manifest.release_summary.legal_refs_by_type, []);
  assertEquals(releaseDbCounts, {
    legalRefs: 0,
    entityLegalRefs: 0,
    relationshipLegalRefs: 0,
  });
  assertReleaseReadmeOmitsWorkbenchStatusLanguage(readme);
});

Deno.test("release inspect reports missing, changed, and unexpected package files", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const outDir = join(dir, "release");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.release.integrity.board", "Integrity Board"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.release.integrity.board",
      payload: {},
    },
    resolutionsDir,
  );
  await buildV2Release(workbench, outDir);
  workbench.close();

  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    files: Array<{ name: string; sha256: string }>;
  };
  const sqliteSha = manifest.files.find((file) => file.name === "dcgov.sqlite")?.sha256;
  assertEquals(sqliteSha, await fileByteSha(join(outDir, "dcgov.sqlite")));
  await mutateFileWithoutChangingDecodedText(join(outDir, "dcgov.sqlite"));
  await Deno.writeTextFile(join(outDir, "entities", "all_entities.csv"), "changed\n");
  await Deno.remove(join(outDir, "relationships", "structure_relationships.csv"));
  await ensureDir(join(outDir, "entities", "scratch"));
  await Deno.writeTextFile(join(outDir, "entities", "scratch", "rows.csv"), "stale\n");
  await Deno.writeTextFile(join(outDir, "extra.csv"), "stale\n");
  await ensureDir(join(outDir, "raw_rows"));
  await Deno.writeTextFile(join(outDir, "raw_rows", "rows.json"), "stale\n");

  const inspectOutput = await runDcCli(["release", "inspect", "--out", outDir, "--json"]);

  assertEquals(inspectOutput.code, 0);
  const inspectJson = JSON.parse(inspectOutput.stdout) as {
    readiness: string;
    readinessReasons: string[];
    packageIntegrity: string;
    packageProblems: Array<{ fileName: string; problem: string }>;
  };
  assertEquals(inspectJson.readiness, "not-ready");
  assertEquals(inspectJson.packageIntegrity, "problem");
  assert(
    inspectJson.packageProblems.some((problem) =>
      problem.fileName === "entities/all_entities.csv" && problem.problem === "sha256 mismatch"
    ),
  );
  assert(
    inspectJson.packageProblems.some((problem) =>
      problem.fileName === "dcgov.sqlite" && problem.problem === "sha256 mismatch"
    ),
  );
  assert(
    inspectJson.packageProblems.some((problem) =>
      problem.fileName === "relationships/structure_relationships.csv" &&
      problem.problem === "missing file"
    ),
  );
  assert(
    inspectJson.packageProblems.some((problem) =>
      problem.fileName === "extra.csv" && problem.problem === "unexpected file"
    ),
  );
  assert(
    inspectJson.packageProblems.some((problem) =>
      problem.fileName === "raw_rows/" && problem.problem === "unexpected directory"
    ),
  );
  assert(
    inspectJson.packageProblems.some((problem) =>
      problem.fileName === "entities/scratch/" && problem.problem === "unexpected directory"
    ),
  );
  assertEquals(inspectJson.readinessReasons, [
    `package integrity problems: ${inspectJson.packageProblems.length}`,
  ]);
});

async function makeMinimalReleaseDir(): Promise<string> {
  const outDir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(outDir, "manifest.json"), "{}");
  return outDir;
}

async function fileByteSha(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const stableBytes = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes.buffer);
  return `sha256:${
    Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
  }`;
}

async function mutateFileWithoutChangingDecodedText(path: string): Promise<void> {
  const bytes = await Deno.readFile(path);
  const originalText = new TextDecoder().decode(bytes);
  for (let index = 0; index < bytes.length; index += 1) {
    for (const replacement of [0x80, 0x81, 0x82, 0xff]) {
      if (bytes[index] === replacement) continue;
      const mutated = bytes.slice();
      mutated[index] = replacement;
      if (new TextDecoder().decode(mutated) === originalText) {
        await Deno.writeFile(path, mutated);
        return;
      }
    }
  }
  throw new Error("Could not find a byte mutation that preserves decoded text");
}

Deno.test("release builder rejects email-shaped contact info in release rows", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, official_url, review_status, merged_candidate_ids, created_at, updated_at) values('dc.contact_leak', 'Contact Leak', 'board', 'mailto:not-for-release@example.com', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await assertRejects(
    () => buildV2Release(workbench, join(dir, "release")),
    Error,
    "Release output contains email-shaped contact info",
  );
  workbench.close();
});

Deno.test("release builder omits contact-shaped unresolved review labels from release summary", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const outDir = join(dir, "release");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    `insert into review_items(
      review_item_id,
      item_type,
      subject_id,
      reason,
      default_action,
      status,
      details_json,
      created_at,
      updated_at
    ) values(
      'review.contact_leak',
      'entity_candidate',
      'candidate.test.contact_leak.1',
      'Review internal contact label',
      'defer',
      'open',
      '{"name":"not-for-release@example.com"}',
      datetime('now'),
      datetime('now')
    )`,
  ).run();

  await buildV2Release(workbench, outDir);
  const manifest = await Deno.readTextFile(join(outDir, "manifest.json"));
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  assert(!manifest.includes("not-for-release@example.com"));
  assert(!readme.includes("not-for-release@example.com"));
  workbench.close();
});

Deno.test("release builder rejects relationships with missing endpoint entities", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.source', 'Source Entity', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.exec("pragma foreign_keys = off");
  workbench.db.prepare(
    "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.source:part_of:dc.missing', 'dc.source', 'part_of', 'dc.missing', 'accepted', 'event.1', datetime('now'))",
  ).run();
  workbench.db.exec("pragma foreign_keys = on");

  await assertRejects(
    () => buildV2Release(workbench, join(dir, "release")),
    Error,
    "FOREIGN KEY constraint failed",
  );
  workbench.close();
});

Deno.test("release builder rejects phone-shaped contact info in release rows", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, official_url, review_status, merged_candidate_ids, created_at, updated_at) values('dc.phone_leak', 'Phone Leak', 'board', 'tel:202-555-0100', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await assertRejects(
    () => buildV2Release(workbench, join(dir, "release")),
    Error,
    "Release output contains phone-shaped contact info",
  );
  workbench.close();
});

Deno.test("release builder rejects local path-shaped info in release rows", async () => {
  for (
    const [entityId, officialUrl] of [
      [
        "dc.path_leak_windows",
        "/file%253A///C%253A/Users/source-user/Documents/Downloads/53207.pdf",
      ],
      [
        "dc.path_leak_posix",
        "/var/tmp/dc-scraper/source.json",
      ],
    ] as const
  ) {
    const dir = await Deno.makeTempDir();
    const dbPath = join(dir, "workbench.sqlite");
    const workbench = new Workbench(dbPath);
    workbench.init();
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, official_url, review_status, merged_candidate_ids, created_at, updated_at) values(?, 'Path Leak', 'board', ?, 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, officialUrl);

    await assertRejects(
      () => buildV2Release(workbench, join(dir, "release")),
      Error,
      "Release output contains local path-shaped info",
    );
    workbench.close();
  }
});

async function runDcCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      ...args,
    ],
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}
