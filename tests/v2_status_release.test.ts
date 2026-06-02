import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { buildV2Release } from "../src/v2/release.ts";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildReviewItemId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
} from "./helpers/v2_fixtures.ts";
import {
  syntheticEntitySourceResult,
  syntheticLegalRefSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("status surfaces placeholder risk with readable reason", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values('dc.placeholder_example', 'Placeholder Example', 'placeholder', 'placeholder', '[]', 1, 'fixture placeholder', datetime('now'), datetime('now'))",
  ).run();
  workbench.close();

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
  assertStringIncludes(statusText, "Placeholders: 1");
  assertStringIncludes(statusText, "Placeholder Example");
  assertStringIncludes(statusText, "fixture placeholder");

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
    placeholders: {
      count: number;
      byReason: Array<{ reason: string; count: number }>;
      firstPlaceholder?: {
        entityId: string;
        name: string;
        placeholderReason?: string | null;
      };
    };
  };
  assertEquals(jsonStatus.placeholders.count, 1);
  assertEquals(jsonStatus.placeholders.firstPlaceholder?.entityId, "dc.placeholder_example");
  assertEquals(jsonStatus.placeholders.firstPlaceholder?.name, "Placeholder Example");
  assertEquals(jsonStatus.placeholders.firstPlaceholder?.placeholderReason, "fixture placeholder");
  assert(
    jsonStatus.placeholders.byReason.some((row) =>
      row.reason === "fixture placeholder" && row.count === 1
    ),
  );
});

Deno.test("status surfaces stale review debt from prior decisions", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.signature.entities.example_v1", "Example Body"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.signature.entities.example_v1",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(
      "candidate.test.signature.entities.example_v2",
      "Example Body (Updated Source Text)",
    ),
    dataDir,
  );
  workbench.close();

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
  assertStringIncludes(statusText, "Stale review: 1");
  assertStringIncludes(statusText, "accepted");

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
    staleReview: {
      count: number;
      byPriorDecisionState: Array<{ priorDecisionState: string; count: number }>;
      firstStale?: {
        subjectId: string;
        priorDecisionState?: string;
        reason: string;
      };
    };
  };
  assertEquals(jsonStatus.staleReview.count, 1);
  assert(
    jsonStatus.staleReview.byPriorDecisionState.some((row) =>
      row.priorDecisionState === "accepted" && row.count === 1
    ),
  );
  assertEquals(
    jsonStatus.staleReview.firstStale?.subjectId,
    "candidate.test.signature.entities.example_v2",
  );
  assertEquals(jsonStatus.staleReview.firstStale?.priorDecisionState, "accepted");
  assertStringIncludes(
    jsonStatus.staleReview.firstStale?.reason ?? "",
    "changed since a prior accepted decision",
  );
});

Deno.test("status surfaces unresolved review debt by source and type", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.signature.entities.review_debt_v1", "Example Body"),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.review_debt_v1",
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId("legal.test.signature.legal_refs.review_debt_v1", "legal-ref"),
      payload: {},
    },
    resolutionsDir,
  );
  workbench.close();

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
  assertStringIncludes(statusText, "Review debt by type:");
  assertStringIncludes(statusText, "entity_candidate(open=1,deferred=0)");
  assertStringIncludes(statusText, "legal_ref(open=0,deferred=1)");
  assertStringIncludes(statusText, "Review debt by source:");
  assertStringIncludes(statusText, "test.signature.entities(open=1,deferred=0)");
  assertStringIncludes(statusText, "test.signature.legal_refs(open=0,deferred=1)");

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
    review: {
      byType: Array<{ itemType: string; openCount: number; deferredCount: number }>;
      bySource: Array<{ sourceId: string; openCount: number; deferredCount: number }>;
    };
  };
  assert(
    jsonStatus.review.byType.some((row) =>
      row.itemType === "entity_candidate" && row.openCount === 1 && row.deferredCount === 0
    ),
  );
  assert(
    jsonStatus.review.byType.some((row) =>
      row.itemType === "legal_ref" && row.openCount === 0 && row.deferredCount === 1
    ),
  );
  assert(
    jsonStatus.review.bySource.some((row) =>
      row.sourceId === "test.signature.entities" && row.openCount === 1 &&
      row.deferredCount === 0
    ),
  );
  assert(
    jsonStatus.review.bySource.some((row) =>
      row.sourceId === "test.signature.legal_refs" && row.openCount === 0 &&
      row.deferredCount === 1
    ),
  );
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
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into resolution_events(event_id, event_type, subject_id, payload_json, resolution_file, sequence_number, created_at) values('event.1', 'accept_relationship_candidate', 'relationship.fixture', '{}', 'fixture.jsonl', 1, datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.board_accountancy:part_of:dc.council', 'dc.board_accountancy', 'part_of', 'dc.council', 'accepted', 'event.1', datetime('now'))",
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
    "pending",
  ]);
  workbench.db.prepare(
    "insert into entity_legal_refs(entity_legal_ref_id, entity_id, legal_ref_id) values(?, ?, ?)",
  ).run([
    "entity_legal_ref.board_accountancy.authority",
    "dc.board_accountancy",
    "legal.open_dc.public_bodies.board_accountancy_authority",
  ]);
  const outDir = join(dir, "release");
  const staleFile = join(outDir, "stale-extra-report.csv");
  await ensureDir(outDir);
  await Deno.writeTextFile(staleFile, "stale");
  const result = await buildV2Release(workbench, outDir);
  const entityCsv = await Deno.readTextFile(join(outDir, "entities.csv"));
  const entityLegalRefsCsv = await Deno.readTextFile(join(outDir, "entity_legal_refs.csv"));
  const sourcesCsv = await Deno.readTextFile(join(outDir, "sources.csv"));
  const legalRefsCsv = await Deno.readTextFile(join(outDir, "legal_refs.csv"));
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
  assertEquals(
    result.fileNames.sort(),
    [
      "README.md",
      "dcgov.sqlite",
      "datasets.csv",
      "datasets.json",
      "entities.csv",
      "entities.json",
      "entity_legal_refs.csv",
      "entity_legal_refs.json",
      "legal_refs.csv",
      "legal_refs.json",
      "manifest.json",
      "relationships.csv",
      "relationships.json",
      "sources.csv",
      "sources.json",
    ].sort(),
  );
  assertStringIncludes(
    entityCsv.split("\n")[0],
    "id,name,kind,branch,cluster,official_url,review_status",
  );
  assert(!entityCsv.includes("source_item_id"));
  assert(!entityCsv.includes("not-for-release@example.com"));
  assertStringIncludes(
    entityLegalRefsCsv,
    "entity_id,entity_name,legal_ref_id,ref_type,citation_text,normalized_citation,url,review_status",
  );
  assertStringIncludes(entityLegalRefsCsv, "dc.board_accountancy");
  assertEquals(entityLegalRefsCsv.split("\n").length > 1, true);
  assert(!legalRefsCsv.includes("not-for-release@example.com"));
  assert(!manifestText.includes("not-for-release@example.com"));
  assert(!manifestText.includes("202-555-0100"));
  assertEquals(releaseDbContactHits.count, 0);
  await assertRejects(() => Deno.stat(staleFile), Deno.errors.NotFound);
  assertStringIncludes(readme, "DCGov v2 Release");
  assertStringIncludes(readme, "Relationship coverage note:");
  assertStringIncludes(readme, "`entity_legal_refs.*`: entity-linked legal reference attachments");
  assertStringIncludes(
    readme,
    "Civic role relationship types used by the workbench: holds, represents, member_of, and chairs.",
  );
  assertStringIncludes(readme, "entity legal refs: total=1");
  assertStringIncludes(sourcesCsv, "latest_endpoint_id,latest_artifact_kind,latest_fetched_url");
  assert(!sourcesCsv.includes("/tmp/"));
  assertStringIncludes(
    legalRefsCsv,
    "id,ref_type,citation_text,normalized_citation,url,source_id,source_item_id,source_url,needs_review,review_status",
  );
  assertEquals(Array.isArray(manifest.release_summary.entities_by_review_status), true);
  assertEquals(Array.isArray(manifest.source_artifacts), true);
  assertEquals(releaseObjects, [
    "datasets",
    "entities",
    "entity_legal_refs",
    "incoming_relationships",
    "legal_refs",
    "relationships",
    "sources",
  ]);
  assertEquals(relationshipForeignKeys.length, 2);
  const inspectOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
    ],
  }).output();
  const inspectText = new TextDecoder().decode(inspectOutput.stdout);
  assertEquals(inspectOutput.code, 0);
  assertStringIncludes(inspectText, "Files: 15");
  assertStringIncludes(inspectText, "Entities: accepted=2");
  assertStringIncludes(inspectText, "Relationships: accepted=1");
  const inspectJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
      "--json",
    ],
  }).output();
  const inspectJson = JSON.parse(new TextDecoder().decode(inspectJsonOutput.stdout)) as {
    outDir: string;
    fileCount: number;
    releaseSummary: { source_count: number };
  };
  assertEquals(inspectJsonOutput.code, 0);
  assertEquals(inspectJson.outDir, outDir);
  assertEquals(inspectJson.fileCount, 15);
  assertEquals(inspectJson.releaseSummary.source_count, 1);
  if (manifest.source_artifacts.length > 0) {
    assertEquals(Object.keys(manifest.source_artifacts[0]).includes("content_hash"), true);
    assertEquals(Object.keys(manifest.source_artifacts[0]).includes("path"), false);
  }
});

Deno.test("release summary surfaces unresolved review debt and placeholder risk neutrally", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'council', 'accepted', '[]', 0, null, datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values('dc.placeholder_example', 'Placeholder Example', 'placeholder', 'placeholder', '[]', 1, 'fixture placeholder', datetime('now'), datetime('now'))",
  ).run();

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

  const outDir = join(dir, "release");
  await buildV2Release(workbench, outDir);
  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    release_summary: {
      open_review_item_count: number;
      deferred_review_item_count: number;
      blocked_reconciliation_count: number;
      placeholder_entity_count: number;
      blocked_reconciliation_by_source: Array<{ source_id: string; count: number }>;
      review_status_note: string;
    };
  };
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  workbench.close();

  assert(manifest.release_summary.blocked_reconciliation_count > 0);
  assertEquals(manifest.release_summary.placeholder_entity_count, 1);
  assert(
    manifest.release_summary.blocked_reconciliation_by_source.some((row) =>
      row.source_id === "council.committees" && row.count > 0
    ),
  );
  assertStringIncludes(
    manifest.release_summary.review_status_note,
    "Release built with unresolved workbench state:",
  );
  assertStringIncludes(readme, "review status note:");
  assertStringIncludes(readme, "blocked by source: council.committees=");

  const inspectOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
    ],
  }).output();
  const inspectText = new TextDecoder().decode(inspectOutput.stdout);
  assertEquals(inspectOutput.code, 0);
  assertStringIncludes(inspectText, "Review status: open=");
  assertStringIncludes(inspectText, "Blocked by source: council.committees=");

  const inspectJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
      "--json",
    ],
  }).output();
  const inspectJson = JSON.parse(new TextDecoder().decode(inspectJsonOutput.stdout)) as {
    releaseSummary: {
      blocked_reconciliation_count: number;
      placeholder_entity_count: number;
      blocked_reconciliation_by_source: Array<{ source_id: string; count: number }>;
    };
  };
  assertEquals(inspectJsonOutput.code, 0);
  assert(inspectJson.releaseSummary.blocked_reconciliation_count > 0);
  assertEquals(inspectJson.releaseSummary.placeholder_entity_count, 1);
  assert(
    inspectJson.releaseSummary.blocked_reconciliation_by_source.some((row) =>
      row.source_id === "council.committees" && row.count > 0
    ),
  );
});

Deno.test("release summary surfaces stale review debt neutrally", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const outDir = join(dir, "release");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.signature.entities.example_v1", "Example Body"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.signature.entities.example_v1",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(
      "candidate.test.signature.entities.example_v2",
      "Example Body (Updated Source Text)",
    ),
    dataDir,
  );

  await buildV2Release(workbench, outDir);
  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    release_summary: {
      stale_review_item_count: number;
      stale_review_by_prior_decision_state: Array<{ prior_decision_state: string; count: number }>;
      review_status_note: string;
    };
  };
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  workbench.close();

  assertEquals(manifest.release_summary.stale_review_item_count, 1);
  assert(
    manifest.release_summary.stale_review_by_prior_decision_state.some((row) =>
      row.prior_decision_state === "accepted" && row.count === 1
    ),
  );
  assertStringIncludes(manifest.release_summary.review_status_note, "stale review=1");
  assertStringIncludes(readme, "stale review: 1");

  const inspectOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
    ],
  }).output();
  const inspectText = new TextDecoder().decode(inspectOutput.stdout);
  assertEquals(inspectOutput.code, 0);
  assertStringIncludes(inspectText, "stale=1");

  const inspectJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
      "--json",
    ],
  }).output();
  const inspectJson = JSON.parse(new TextDecoder().decode(inspectJsonOutput.stdout)) as {
    releaseSummary: {
      stale_review_item_count: number;
      stale_review_by_prior_decision_state: Array<{ prior_decision_state: string; count: number }>;
    };
  };
  assertEquals(inspectJsonOutput.code, 0);
  assertEquals(inspectJson.releaseSummary.stale_review_item_count, 1);
  assert(
    inspectJson.releaseSummary.stale_review_by_prior_decision_state.some((row) =>
      row.prior_decision_state === "accepted" && row.count === 1
    ),
  );
});

Deno.test("release summary surfaces unresolved review debt by source and type", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const outDir = join(dir, "release");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticEntitySourceResult(
      "candidate.test.signature.entities.release_review_debt_v1",
      "Example Body",
    ),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.release_review_debt_v1",
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(
        "legal.test.signature.legal_refs.release_review_debt_v1",
        "legal-ref",
      ),
      payload: {},
    },
    resolutionsDir,
  );

  await buildV2Release(workbench, outDir);
  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    release_summary: {
      review_debt_by_type: Array<{
        item_type: string;
        open_count: number;
        deferred_count: number;
      }>;
      review_debt_by_source: Array<{
        source_id: string;
        open_count: number;
        deferred_count: number;
      }>;
    };
  };
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  workbench.close();

  assert(
    manifest.release_summary.review_debt_by_type.some((row) =>
      row.item_type === "entity_candidate" && row.open_count === 1 && row.deferred_count === 0
    ),
  );
  assert(
    manifest.release_summary.review_debt_by_type.some((row) =>
      row.item_type === "legal_ref" && row.open_count === 0 && row.deferred_count === 1
    ),
  );
  assert(
    manifest.release_summary.review_debt_by_source.some((row) =>
      row.source_id === "test.signature.entities" && row.open_count === 1 &&
      row.deferred_count === 0
    ),
  );
  assert(
    manifest.release_summary.review_debt_by_source.some((row) =>
      row.source_id === "test.signature.legal_refs" && row.open_count === 0 &&
      row.deferred_count === 1
    ),
  );
  assertStringIncludes(readme, "review debt by type:");
  assertStringIncludes(readme, "entity_candidate(open=1,deferred=0)");
  assertStringIncludes(readme, "legal_ref(open=0,deferred=1)");
  assertStringIncludes(readme, "review debt by source:");
  assertStringIncludes(readme, "test.signature.entities(open=1,deferred=0)");
  assertStringIncludes(readme, "test.signature.legal_refs(open=0,deferred=1)");

  const inspectOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
    ],
  }).output();
  const inspectText = new TextDecoder().decode(inspectOutput.stdout);
  assertEquals(inspectOutput.code, 0);
  assertStringIncludes(inspectText, "Review debt by type:");
  assertStringIncludes(inspectText, "entity_candidate(open=1,deferred=0)");
  assertStringIncludes(inspectText, "legal_ref(open=0,deferred=1)");
  assertStringIncludes(inspectText, "Review debt by source:");
  assertStringIncludes(inspectText, "test.signature.entities(open=1,deferred=0)");
  assertStringIncludes(inspectText, "test.signature.legal_refs(open=0,deferred=1)");

  const inspectJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
      "--json",
    ],
  }).output();
  const inspectJson = JSON.parse(new TextDecoder().decode(inspectJsonOutput.stdout)) as {
    releaseSummary: {
      review_debt_by_type: Array<{
        item_type: string;
        open_count: number;
        deferred_count: number;
      }>;
      review_debt_by_source: Array<{
        source_id: string;
        open_count: number;
        deferred_count: number;
      }>;
    };
  };
  assertEquals(inspectJsonOutput.code, 0);
  assert(
    inspectJson.releaseSummary.review_debt_by_type.some((row) =>
      row.item_type === "entity_candidate" && row.open_count === 1 && row.deferred_count === 0
    ),
  );
  assert(
    inspectJson.releaseSummary.review_debt_by_type.some((row) =>
      row.item_type === "legal_ref" && row.open_count === 0 && row.deferred_count === 1
    ),
  );
  assert(
    inspectJson.releaseSummary.review_debt_by_source.some((row) =>
      row.source_id === "test.signature.entities" && row.open_count === 1 &&
      row.deferred_count === 0
    ),
  );
  assert(
    inspectJson.releaseSummary.review_debt_by_source.some((row) =>
      row.source_id === "test.signature.legal_refs" && row.open_count === 0 &&
      row.deferred_count === 1
    ),
  );
});

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
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, official_url, review_status, merged_candidate_ids, created_at, updated_at) values('dc.path_leak', 'Path Leak', 'board', '/file%253A///C%253A/Users/source-user/Documents/Downloads/53207.pdf', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await assertRejects(
    () => buildV2Release(workbench, join(dir, "release")),
    Error,
    "Release output contains local path-shaped info",
  );
  workbench.close();
});
