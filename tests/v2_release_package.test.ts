import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { buildV2Release, type ReleaseBuildProgressEvent } from "../src/v2/release.ts";
import { renderReleaseBuildProgress } from "../src/v2/cli_release.ts";
import { buildReleaseInspection } from "../src/v2/release_inspect.ts";
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
  assertEquals(events.find((event) => event.phase === "write-files")?.fileCount, 14);
  assertEquals(events.find((event) => event.phase === "write-manifest")?.fileCount, 17);

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

  const output = await new Deno.Command(Deno.execPath(), {
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
      "--db",
      dbPath,
      "--out",
      outDir,
    ],
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  assertEquals(output.code, 0);
  assertStringIncludes(stdout, `Built release ${outDir}`);
  assert(!stdout.includes("Writing dcgov.sqlite"));
  assertStringIncludes(stderr, "Release build: Preparing release directory");
  assertStringIncludes(stderr, "Release build: Writing dcgov.sqlite");
  assertStringIncludes(stderr, "Release build: Writing README and manifest files=17");
});

Deno.test("release build CLI accepts --output as an alias for --out", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const outDir = join(dir, "release-output-alias");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.close();

  const output = await new Deno.Command(Deno.execPath(), {
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
      "--db",
      dbPath,
      "--output",
      outDir,
    ],
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);

  assertEquals(output.code, 0);
  assertStringIncludes(stdout, `Built release ${outDir}`);
  assertEquals(await exists(join(outDir, "manifest.json")), true);
});

Deno.test("release inspect CLI accepts --output as an alias for --out", async () => {
  const outDir = await makeMinimalReleaseDir();

  const output = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--output",
      outDir,
      "--json",
    ],
  }).output();
  const inspection = JSON.parse(new TextDecoder().decode(output.stdout)) as { outDir: string };

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
    "pending",
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
  const entityCsv = await Deno.readTextFile(join(outDir, "entities.csv"));
  const entityLegalRefsCsv = await Deno.readTextFile(join(outDir, "entity_legal_refs.csv"));
  const relationshipLegalRefsCsv = await Deno.readTextFile(
    join(outDir, "relationship_legal_refs.csv"),
  );
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
      "relationship_legal_refs.csv",
      "relationship_legal_refs.json",
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
  assertStringIncludes(
    relationshipLegalRefsCsv,
    "relationship_id,from_entity_id,from_entity_name,relationship_type,to_entity_id,to_entity_name,legal_ref_id,ref_type,citation_text,normalized_citation,url,review_status",
  );
  assertStringIncludes(relationshipLegalRefsCsv, "dc.board_accountancy:part_of:dc.council");
  assert(!legalRefsCsv.includes("not-for-release@example.com"));
  assert(!manifestText.includes("not-for-release@example.com"));
  assert(!manifestText.includes("202-555-0100"));
  assertEquals(releaseDbContactHits.count, 0);
  await assertRejects(() => Deno.stat(staleFile), Deno.errors.NotFound);
  assertStringIncludes(readme, "DCGov Release");
  assertStringIncludes(
    readme,
    "`README.md`: package overview, model semantics, and release counts",
  );
  assertStringIncludes(
    readme,
    "`manifest.json`: package metadata, file hashes, source inventory/artifact summary, and release summary",
  );
  assertStringIncludes(readme, "`entity_legal_refs.*`: entity-linked legal reference attachments");
  assertStringIncludes(
    readme,
    "`relationship_legal_refs.*`: relationship-linked legal reference attachments",
  );
  assertStringIncludes(readme, "## Model semantics");
  assertStringIncludes(
    readme,
    "`entities.*`: canonical civic entities such as public bodies, offices, seats/roles, status markers, and source-backed public official observations.",
  );
  assertStringIncludes(
    readme,
    "Public official observations are source-backed role or seat observations, not a personnel or contact directory.",
  );
  assertStringIncludes(
    readme,
    "`relationships.*`: one directed fact per row, `from_entity_id --relationship_type--> to_entity_id`.",
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
  assertStringIncludes(sourcesCsv, "latest_endpoint_id,latest_artifact_kind,latest_fetched_url");
  assertStringIncludes(sourcesCsv, "https://www.open-dc.gov/public-bodies/board-accountancy");
  assert(!sourcesCsv.includes(auxiliaryArtifactUrl));
  assertStringIncludes(manifestText, auxiliaryArtifactUrl);
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
    "relationship_legal_refs",
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
  assertStringIncludes(inspectText, "Files: 17");
  assertStringIncludes(inspectText, "Package integrity: ok");
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
    packageIntegrity: string;
    packageProblems: Array<{ fileName: string; problem: string }>;
    releaseSummary: { source_count: number };
  };
  assertEquals(inspectJsonOutput.code, 0);
  assertEquals(inspectJson.outDir, outDir);
  assertEquals(inspectJson.fileCount, 17);
  assertEquals(inspectJson.packageIntegrity, "ok");
  assertEquals(inspectJson.packageProblems, []);
  assertEquals(inspectJson.releaseSummary.source_count, 1);
  if (manifest.source_artifacts.length > 0) {
    assertEquals(Object.keys(manifest.source_artifacts[0]).includes("content_hash"), true);
    assertEquals(Object.keys(manifest.source_artifacts[0]).includes("path"), false);
  }
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
  await Deno.writeTextFile(join(outDir, "entities.csv"), "changed\n");
  await Deno.remove(join(outDir, "relationships.json"));
  await Deno.writeTextFile(join(outDir, "extra.csv"), "stale\n");
  await ensureDir(join(outDir, "raw_rows"));
  await Deno.writeTextFile(join(outDir, "raw_rows", "rows.json"), "stale\n");

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
      "--json",
    ],
  }).output();

  assertEquals(inspectOutput.code, 0);
  const inspectJson = JSON.parse(new TextDecoder().decode(inspectOutput.stdout)) as {
    readiness: string;
    packageIntegrity: string;
    packageProblems: Array<{ fileName: string; problem: string }>;
  };
  assertEquals(inspectJson.readiness, "not-ready");
  assertEquals(inspectJson.packageIntegrity, "problem");
  assert(
    inspectJson.packageProblems.some((problem) =>
      problem.fileName === "entities.csv" && problem.problem === "sha256 mismatch"
    ),
  );
  assert(
    inspectJson.packageProblems.some((problem) =>
      problem.fileName === "dcgov.sqlite" && problem.problem === "sha256 mismatch"
    ),
  );
  assert(
    inspectJson.packageProblems.some((problem) =>
      problem.fileName === "relationships.json" && problem.problem === "missing file"
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
