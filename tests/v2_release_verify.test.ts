import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import type { ConnectorResult, RelationshipType } from "../src/v2/domain.ts";
import { readGitCommit } from "../src/v2/git.ts";
import { buildV2Release } from "../src/v2/release.ts";
import { verifyWorkbenchRelease } from "../src/v2/release_verify.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
  syntheticEntitySourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("release manifest includes stable provenance fields", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const outDir = join(dir, "release");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.release.manifest.board", "Release Board"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.release.manifest.board",
      payload: {},
    },
    resolutionsDir,
  );
  await buildV2Release(workbench, outDir, { sourceProfile: "tier0" });
  workbench.close();

  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    manifest_version: number;
    release_id: string;
    tool_version: string;
    git_commit: string;
    source_profile: string;
  };

  assertEquals(manifest.manifest_version, 1);
  assertEquals(manifest.source_profile, "tier0");
  assert(typeof manifest.release_id === "string" && manifest.release_id.length > 0);
  assert(typeof manifest.tool_version === "string" && manifest.tool_version.length > 0);
  assert(typeof manifest.git_commit === "string" && manifest.git_commit.length > 0);
});

Deno.test("release git provenance reads refs from Git worktree common dir", async () => {
  const dir = await Deno.makeTempDir();
  const repoRoot = join(dir, "checkout");
  const commonGitDir = join(dir, "repo.git");
  const worktreeGitDir = join(commonGitDir, "worktrees", "checkout");
  const refPath = join(commonGitDir, "refs", "heads", "campaign", "release-test");
  const commit = "0123456789abcdef0123456789abcdef01234567";
  await ensureDir(repoRoot);
  await ensureDir(worktreeGitDir);
  await ensureDir(join(commonGitDir, "refs", "heads", "campaign"));
  await Deno.writeTextFile(join(repoRoot, ".git"), `gitdir: ${worktreeGitDir}\n`);
  await Deno.writeTextFile(join(worktreeGitDir, "HEAD"), "ref: refs/heads/campaign/release-test\n");
  await Deno.writeTextFile(join(worktreeGitDir, "commondir"), "../..\n");
  await Deno.writeTextFile(refPath, `${commit}\n`);

  assertEquals(await readGitCommit(repoRoot), commit);
});

Deno.test("release verify exits zero for a ready workbench", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.release.verify.ready",
      candidateId: "candidate.test.release.verify.ready",
      sourceItemKey: "ready-board-row",
      proposedEntityId: "dc.ready_board",
      name: "Ready Board",
      kind: "board",
      observedName: "Ready Board",
      officialUrl: "https://example.com/ready-board",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.release.verify.ready",
      payload: {},
    },
    resolutionsDir,
  );
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    readiness: string;
    buildCommand?: string;
    nextCommand: string;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.readiness, "usable");
  assertEquals(body.buildCommand, `deno task dc -- release build --db ${dbPath}`);
  assertEquals(body.nextCommand, `deno task dc -- release build --db ${dbPath}`);

  const text = await runReleaseVerifyText(dbPath);
  assertEquals(text.code, 0);
  assertStringIncludes(text.stdout, `Build: deno task dc -- release build --db ${dbPath}`);
});

Deno.test("release verify is not ready before any source is fetched", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    readiness: string;
    nextCommand: string;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.readiness, "not-ready");
  assertEquals(body.reasons.includes("no sources fetched"), true);
  assertEquals(body.nextCommand, `deno task dc -- source list --db ${dbPath}`);
});

Deno.test("release verify surfaces failed source detail", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.upsertSource(
    "dcgis.agencies",
    "DCGIS Agencies",
    "fixture",
    "fixture",
    "https://example.com/dcgis/agencies",
    undefined,
  );
  workbench.upsertEndpoint({
    endpointId: "dcgis.agencies.fixture",
    sourceId: "dcgis.agencies",
    title: "DCGIS Agencies fixture",
    kind: "fixture",
    url: "https://example.com/dcgis/agencies",
    method: "GET",
    captureMode: "rows",
  });
  workbench.db.prepare(
    "insert into source_runs(run_id, source_id, endpoint_id, started_at, finished_at, status, error_text) values('run.release_verify.failed_source', 'dcgis.agencies', 'dcgis.agencies.fixture', datetime('now'), datetime('now'), 'failed', ?)",
  ).run("Fixture source failed during release verification");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    firstFailedSourceId?: string;
    firstFailedSourceErrorText?: string;
    nextCommand: string;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("failed sources: 1"), true);
  assertEquals(body.firstFailedSourceId, "dcgis.agencies");
  assertEquals(
    body.firstFailedSourceErrorText,
    "Fixture source failed during release verification",
  );
  assertEquals(body.nextCommand, `deno task dc -- source inspect dcgis.agencies --db ${dbPath}`);

  const text = await runReleaseVerifyText(dbPath);
  assertEquals(text.code, 1);
  assertStringIncludes(text.stdout, "First failed source: dcgis.agencies");
  assertStringIncludes(
    text.stdout,
    "Failure detail: Fixture source failed during release verification",
  );
});

Deno.test("release verify routes placeholder blockers to audit", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values('dc.placeholder_release_verify', 'Placeholder Release Verify', 'placeholder', 'placeholder', '[]', 1, 'fixture placeholder', datetime('now'), datetime('now'))",
  ).run();
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    nextCommand: string;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("placeholder entities: 1"), true);
  assertEquals(body.nextCommand, `deno task dc -- audit --db ${dbPath}`);
});

Deno.test("release verify accepts source-backed entity rows", async () => {
  const { dbPath, workbench } = await readyEntityWorkbench();
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    entityProvenanceCheckedCount: number;
    entityProvenanceProblems: Array<{ entityId: string; candidateId: string; message: string }>;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.entityProvenanceCheckedCount, 1);
  assertEquals(body.entityProvenanceProblems, []);
});

Deno.test("release verify treats browse-only additions as usable", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.release.verify.warning", "Warning Board"),
    dataDir,
  );
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    readiness: string;
    sourceArtifactProblems: unknown[];
    relationshipProvenanceCheckedCount: number;
    relationshipProvenanceProblems: unknown[];
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.readiness, "usable");
  assertEquals(body.reasons, []);
  assertEquals(body.sourceArtifactProblems, []);
  assertEquals(body.relationshipProvenanceCheckedCount, 0);
  assertEquals(body.relationshipProvenanceProblems, []);
});

Deno.test("release verify surfaces non-blocking review warnings", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.release.verify.warning",
      candidateId: "candidate.test.release.verify.warning",
      sourceItemKey: "warning-entity-row",
      proposedEntityId: "dc.release_verify_warning",
      name: "Release Verify Warning Board",
      kind: "board",
      observedName: "Release Verify Warning Board",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(
      "candidate.test.release.verify.deferred_warning",
      "Release Verify Deferred Warning Board",
    ),
    dataDir,
  );
  const deferredItem = workbench.listReviewItems({
    type: "entity_candidate",
    subjectPrefix: "candidate.test.release.verify.deferred_warning",
  })[0];
  assert(deferredItem);
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: deferredItem.reviewItemId,
      payload: {},
    },
    resolutionsDir,
  );
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    readiness: string;
    warningReasons?: string[];
    buildCommand?: string;
    warningReviewCommand?: string;
    nextCommand: string;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.readiness, "usable-with-warnings");
  assertEquals(body.warningReasons, ["open decisions: 1", "deferred review items: 1"]);
  assertEquals(body.buildCommand, `deno task dc -- release build --db ${dbPath}`);
  assertEquals(
    body.warningReviewCommand,
    `deno task dc -- review list --status all --decisions --db ${dbPath}`,
  );
  assertEquals(body.nextCommand, `deno task dc -- release build --db ${dbPath}`);

  const text = await runReleaseVerifyText(dbPath);
  assertEquals(text.code, 0);
  assertStringIncludes(text.stdout, "Release verify: ready");
  assertStringIncludes(text.stdout, "Readiness: usable-with-warnings");
  assertStringIncludes(text.stdout, "No blocking release issues found.");
  assertStringIncludes(text.stdout, "Warnings:");
  assertStringIncludes(text.stdout, "- open decisions: 1");
  assertStringIncludes(text.stdout, "- deferred review items: 1");
  assertStringIncludes(text.stdout, "Warnings do not block release build.");
  assertStringIncludes(text.stdout, `Build: deno task dc -- release build --db ${dbPath}`);
  assertStringIncludes(
    text.stdout,
    `Review warnings: deno task dc -- review list --status all --decisions --db ${dbPath}`,
  );
});

Deno.test("release verify warns on accepted multi-governor entities", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.release.verify.multi_governor",
      candidateId: "candidate.test.release.verify.multi_governor.board",
      sourceItemKey: "board",
      proposedEntityId: "dc.multi_governor_board",
      name: "Release Verify Multi Governor Board",
      kind: "board",
      officialUrl: "https://example.com/board",
      observedName: "Release Verify Multi Governor Board",
      confidence: 0.95,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.release.verify.multi_governor",
      candidateId: "candidate.test.release.verify.multi_governor.agency_a",
      sourceItemKey: "agency-a",
      proposedEntityId: "dc.multi_governor_agency_a",
      name: "Release Verify Multi Governor Agency A",
      kind: "agency",
      officialUrl: "https://example.com/agency-a",
      observedName: "Release Verify Multi Governor Agency A",
      confidence: 0.95,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.release.verify.multi_governor",
      candidateId: "candidate.test.release.verify.multi_governor.agency_b",
      sourceItemKey: "agency-b",
      proposedEntityId: "dc.multi_governor_agency_b",
      name: "Release Verify Multi Governor Agency B",
      kind: "agency",
      officialUrl: "https://example.com/agency-b",
      observedName: "Release Verify Multi Governor Agency B",
      confidence: 0.95,
    }),
    dataDir,
  );
  for (
    const subjectId of [
      "candidate.test.release.verify.multi_governor.board",
      "candidate.test.release.verify.multi_governor.agency_a",
      "candidate.test.release.verify.multi_governor.agency_b",
    ]
  ) {
    await workbench.appendResolutionEvent(
      { eventType: "accept_entity_candidate", subjectId, payload: {} },
      resolutionsDir,
    );
  }
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.release.verify.multi_governor",
      relationshipCandidateId: "relationship.test.release.verify.multi_governor.a",
      sourceItemKey: "governor-a",
      fromEntityRef: "dc.multi_governor_board",
      toEntityRef: "dc.multi_governor_agency_a",
      relationshipType: "governed_by",
      rawValue: "Release Verify Multi Governor Agency A",
      needsReview: false,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.release.verify.multi_governor",
      relationshipCandidateId: "relationship.test.release.verify.multi_governor.b",
      sourceItemKey: "governor-b",
      fromEntityRef: "dc.multi_governor_board",
      toEntityRef: "dc.multi_governor_agency_b",
      relationshipType: "governed_by",
      rawValue: "Release Verify Multi Governor Agency B",
      needsReview: false,
    }),
    dataDir,
  );
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    readiness: string;
    warningReasons?: string[];
    buildCommand?: string;
    warningReviewCommand?: string;
    nextCommand: string;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.readiness, "usable-with-warnings");
  assertEquals(body.warningReasons, ["multi-governor entities: 1"]);
  assertEquals(body.buildCommand, `deno task dc -- release build --db ${dbPath}`);
  assertEquals(body.warningReviewCommand, undefined);
  assertEquals(body.nextCommand, `deno task dc -- release build --db ${dbPath}`);

  const text = await runReleaseVerifyText(dbPath);
  assertEquals(text.code, 0);
  assertStringIncludes(text.stdout, "Release verify: ready");
  assertStringIncludes(text.stdout, "Readiness: usable-with-warnings");
  assertStringIncludes(text.stdout, "Warnings:");
  assertStringIncludes(text.stdout, "- multi-governor entities: 1");
  assertStringIncludes(text.stdout, `Build: deno task dc -- release build --db ${dbPath}`);
});

Deno.test("release verify warns on accepted public bodies missing official URLs", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.release.verify.missing_public_url",
      candidateId: "candidate.test.release.verify.missing_public_url.body",
      sourceItemKey: "body",
      proposedEntityId: "dc.missing_public_url_body",
      name: "Release Verify Missing Public URL Body",
      kind: "public_body",
      observedName: "Release Verify Missing Public URL Body",
      confidence: 0.95,
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.release.verify.missing_public_url.body",
      payload: {},
    },
    resolutionsDir,
  );
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    readiness: string;
    warningReasons?: string[];
    buildCommand?: string;
    nextCommand: string;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.readiness, "usable-with-warnings");
  assertEquals(body.warningReasons, ["public bodies missing official URLs: 1"]);
  assertEquals(body.buildCommand, `deno task dc -- release build --db ${dbPath}`);
  assertEquals(body.nextCommand, `deno task dc -- release build --db ${dbPath}`);

  const text = await runReleaseVerifyText(dbPath);
  assertEquals(text.code, 0);
  assertStringIncludes(text.stdout, "Release verify: ready");
  assertStringIncludes(text.stdout, "Readiness: usable-with-warnings");
  assertStringIncludes(text.stdout, "Warnings:");
  assertStringIncludes(text.stdout, "- public bodies missing official URLs: 1");
  assertStringIncludes(text.stdout, `Build: deno task dc -- release build --db ${dbPath}`);
});

Deno.test("release verify fills known official URLs before warning on public bodies", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "council.committees",
      candidateId: "candidate.test.release.verify.known_url.green_finance",
      sourceItemKey: "green-finance-authority",
      proposedEntityId: "dc.green_finance_authority",
      name: "Green Finance Authority",
      kind: "public_body",
      observedName: "Green Finance Authority",
      confidence: 0.95,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "council.committees",
      candidateId: "candidate.test.release.verify.known_url.age_friendly",
      sourceItemKey: "age-friendly-task-force",
      proposedEntityId: "dc.age_friendly_dc_task_force",
      name: "Age-Friendly DC Task Force",
      kind: "task_force",
      observedName: "Age-Friendly DC Task Force",
      confidence: 0.95,
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.release.verify.known_url.green_finance",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.release.verify.known_url.age_friendly",
      payload: {},
    },
    resolutionsDir,
  );

  const greenFinance = workbench.db.prepare(
    `select official_url as officialUrl
     from canonical_entities
     where entity_id = 'dc.green_finance_authority'`,
  ).get() as { officialUrl: string | null };
  const ageFriendly = workbench.db.prepare(
    `select official_url as officialUrl
     from canonical_entities
     where entity_id = 'dc.age_friendly_dc_task_force'`,
  ).get() as { officialUrl: string | null };
  workbench.close();

  assertEquals(
    greenFinance.officialUrl,
    "https://cfo.dc.gov/publication/2027-kb0-green-finance-authority",
  );
  assertEquals(
    ageFriendly.officialUrl,
    "https://agefriendly.dc.gov/page/age-friendly-dc-task-force",
  );

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    readiness: string;
    warningReasons?: string[];
    buildCommand?: string;
    nextCommand: string;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.readiness, "usable");
  assertEquals(body.warningReasons, []);
  assertEquals(body.buildCommand, `deno task dc -- release build --db ${dbPath}`);
  assertEquals(body.nextCommand, `deno task dc -- release build --db ${dbPath}`);
});

Deno.test("release verify fills known community-affairs and partner public-body URLs", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const rows = [
    {
      candidateId: "candidate.test.release.verify.known_url.african_affairs",
      proposedEntityId: "dc.office_and_commission_on_african_affairs",
      name: "Office and Commission on African Affairs",
      kind: "commission",
    },
    {
      candidateId: "candidate.test.release.verify.known_url.african_american_affairs",
      proposedEntityId: "dc.office_and_commission_on_african_american_affairs",
      name: "Office and Commission on African American Affairs",
      kind: "commission",
    },
    {
      candidateId: "candidate.test.release.verify.known_url.caribbean_affairs",
      proposedEntityId: "dc.office_on_caribbean_affairs",
      name: "Office on Caribbean Affairs",
      kind: "office",
    },
    {
      candidateId: "candidate.test.release.verify.known_url.religious_affairs",
      proposedEntityId: "dc.office_on_religious_affairs",
      name: "Office on Religious Affairs",
      kind: "office",
    },
    {
      candidateId: "candidate.test.release.verify.known_url.cog_board",
      proposedEntityId: "dc.metropolitan_washington_council_of_governments_board_of_directors",
      name: "Metropolitan Washington Council of Governments Board of Directors (COG)",
      kind: "board",
    },
    {
      candidateId: "candidate.test.release.verify.known_url.science_board",
      proposedEntityId: "dc.science_advisory_board",
      name: "Science Advisory Board",
      kind: "board",
    },
  ];
  for (const row of rows) {
    await workbench.importConnectorResult(
      syntheticCustomEntitySourceResult({
        sourceId: "council.committees",
        candidateId: row.candidateId,
        sourceItemKey: row.candidateId,
        proposedEntityId: row.proposedEntityId,
        name: row.name,
        kind: row.kind,
        observedName: row.name,
        confidence: 0.95,
      }),
      dataDir,
    );
    await workbench.appendResolutionEvent(
      {
        eventType: "accept_entity_candidate",
        subjectId: row.candidateId,
        payload: {},
      },
      resolutionsDir,
    );
  }

  const urlRows = workbench.db.prepare(
    `select entity_id as entityId, official_url as officialUrl
     from canonical_entities
     order by entity_id`,
  ).all() as Array<{ entityId: string; officialUrl: string | null }>;
  const urls = new Map(urlRows.map((row) => [row.entityId, row.officialUrl]));
  workbench.close();

  assertEquals(
    urls.get("dc.office_and_commission_on_african_affairs"),
    "https://communityaffairs.dc.gov/moaa",
  );
  assertEquals(
    urls.get("dc.office_and_commission_on_african_american_affairs"),
    "https://communityaffairs.dc.gov/moaaa",
  );
  assertEquals(urls.get("dc.office_on_caribbean_affairs"), "https://communityaffairs.dc.gov/mocca");
  assertEquals(urls.get("dc.office_on_religious_affairs"), "https://communityaffairs.dc.gov/mora");
  assertEquals(
    urls.get("dc.metropolitan_washington_council_of_governments_board_of_directors"),
    "https://www.mwcog.org/committees/cog-board-of-directors/",
  );
  assertEquals(
    urls.get("dc.science_advisory_board"),
    "https://dfs.dc.gov/page/science-advisory-board",
  );

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    readiness: string;
    warningReasons?: string[];
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.readiness, "usable");
  assertEquals(body.warningReasons, []);
});

Deno.test("release verify fills known oversight and human-rights public-body URLs", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const rows = [
    {
      candidateId: "candidate.test.release.verify.known_url.oijjfo",
      proposedEntityId: "dc.office_of_independent_juvenile_justice_facilities_oversight",
      name: "Office of Independent Juvenile Justice Facilities Oversight",
      kind: "office",
    },
    {
      candidateId: "candidate.test.release.verify.known_url.human_rights",
      proposedEntityId: "dc.office_of_and_commission_on_human_rights",
      name: "Office of and Commission on Human Rights",
      kind: "commission",
    },
  ];
  for (const row of rows) {
    await workbench.importConnectorResult(
      syntheticCustomEntitySourceResult({
        sourceId: "council.committees",
        candidateId: row.candidateId,
        sourceItemKey: row.candidateId,
        proposedEntityId: row.proposedEntityId,
        name: row.name,
        kind: row.kind,
        observedName: row.name,
        confidence: 0.95,
      }),
      dataDir,
    );
    await workbench.appendResolutionEvent(
      {
        eventType: "accept_entity_candidate",
        subjectId: row.candidateId,
        payload: {},
      },
      resolutionsDir,
    );
  }

  const urlRows = workbench.db.prepare(
    `select entity_id as entityId, official_url as officialUrl
     from canonical_entities
     order by entity_id`,
  ).all() as Array<{ entityId: string; officialUrl: string | null }>;
  const urls = new Map(urlRows.map((row) => [row.entityId, row.officialUrl]));
  workbench.close();

  assertEquals(
    urls.get("dc.office_of_independent_juvenile_justice_facilities_oversight"),
    "https://oijjfo.dc.gov/",
  );
  assertEquals(
    urls.get("dc.office_of_and_commission_on_human_rights"),
    "https://ohr.dc.gov/page/hearing-unit-and-dc-commission-human-rights",
  );

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    readiness: string;
    warningReasons?: string[];
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.readiness, "usable");
  assertEquals(body.warningReasons, []);
});

Deno.test("release verify surfaces public-body variant leads as release warnings", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "open_dc.public_bodies",
      candidateId: "candidate.open_dc.board_of_architecture_variant",
      sourceItemKey: "board-of-architecture-open-dc",
      proposedEntityId: "dc.board_of_architecture_interior_design_and_landscape_architect",
      name: "Board of Architecture, Interior Design and Landscape Architect",
      kind: "board",
      observedName: "Board of Architecture, Interior Design and Landscape Architect",
      officialUrl: "https://example.com/open-dc/board-of-architecture",
      confidence: 0.92,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.boards_commissions_councils",
      candidateId: "candidate.dcgis.board_of_architecture_variant",
      sourceItemKey: "board-of-architecture-dcgis",
      proposedEntityId: "dc.board_of_architecture_interior_design_and_landscape_architecture",
      name: "Board of Architecture, Interior Design, and Landscape Architecture",
      kind: "board",
      observedName: "Board of Architecture, Interior Design, and Landscape Architecture",
      officialUrl: "https://example.com/dcgis/board-of-architecture",
      confidence: 0.95,
    }),
    dataDir,
  );
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    warningReasons?: string[];
    buildCommand?: string;
    warningReviewCommand?: string;
    publicBodyCompareCommand?: string;
    nextCommand: string;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.warningReasons, [
    "public body duplicate-risk leads: 1",
  ]);
  assertEquals(body.buildCommand, `deno task dc -- release build --db ${dbPath}`);
  assertEquals(
    body.publicBodyCompareCommand,
    `deno task dc -- source compare public-bodies --db ${dbPath}`,
  );
  assertEquals(body.nextCommand, `deno task dc -- release build --db ${dbPath}`);

  const text = await runReleaseVerifyText(dbPath);
  assertEquals(text.code, 0);
  assertStringIncludes(text.stdout, "- public body duplicate-risk leads: 1");
  assertStringIncludes(text.stdout, `Build: deno task dc -- release build --db ${dbPath}`);
  assertStringIncludes(
    text.stdout,
    `Compare public bodies: deno task dc -- source compare public-bodies --db ${dbPath}`,
  );
});

Deno.test("release verify accepts source-backed relationship rows", async () => {
  const { dbPath, workbench } = await readyRelationshipWorkbench();
  workbench.db.prepare("update source_artifacts set fetched_url = 'https://fda.gov/source.json'")
    .run();
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    relationshipProvenanceCheckedCount: number;
    relationshipProvenanceProblems: Array<{ relationshipId: string; message: string }>;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.relationshipProvenanceCheckedCount, 1);
  assertEquals(body.relationshipProvenanceProblems, []);
});

Deno.test("release verify batches relationship evidence lookup across rows", async () => {
  const { workbench, dataDir, resolutionsDir } = await readyRelationshipWorkbench();
  await addAcceptedRelationship(workbench, dataDir, resolutionsDir, {
    suffix: "oversight",
    relationshipType: "overseen_by",
  });
  await addAcceptedRelationship(workbench, dataDir, resolutionsDir, {
    suffix: "authority",
    relationshipType: "authorized_by",
  });

  const prepareCount = countRelationshipEvidencePrepares(workbench);
  workbench.close();

  assertEquals(prepareCount, 1);
});

Deno.test("release verify accepts source-backed dataset and legal ref rows", async () => {
  const { dbPath, workbench } = await sourceBackedInventoryWorkbench();
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    datasetProvenanceCheckedCount: number;
    datasetProvenanceProblems: Array<{ datasetId: string; message: string }>;
    legalRefProvenanceCheckedCount: number;
    legalRefProvenanceProblems: Array<{ legalRefId: string; message: string }>;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.datasetProvenanceCheckedCount, 1);
  assertEquals(body.datasetProvenanceProblems, []);
  assertEquals(body.legalRefProvenanceCheckedCount, 1);
  assertEquals(body.legalRefProvenanceProblems, []);
});

Deno.test("release verify ignores unknown legal refs outside the public release row family", async () => {
  const { dbPath, workbench } = await sourceBackedInventoryWorkbench();
  const sourceItem = workbench.db.prepare(
    "select source_item_id as sourceItemId from source_items order by source_item_id limit 1",
  ).get() as { sourceItemId: string };
  workbench.db.prepare(
    "insert into legal_refs(legal_ref_id, source_item_id, ref_type, citation_text, normalized_citation, url, review_status) values('legal.test.release.verify.accepted_unknown', ?, 'unknown', 'Organizational ByLaws', null, null, 'accepted')",
  ).run(sourceItem.sourceItemId);
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    legalRefProvenanceCheckedCount: number;
    legalRefProvenanceProblems: Array<{ legalRefId: string; message: string }>;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.legalRefProvenanceCheckedCount, 1);
  assertEquals(body.legalRefProvenanceProblems, []);
});

Deno.test("release verify batches inventory evidence lookup across rows", async () => {
  const { workbench } = await sourceBackedInventoryWorkbench();
  duplicateInventoryRows(workbench, 3);

  const prepares = countInventoryEvidencePrepares(workbench);
  workbench.close();

  assertEquals(prepares.datasetEvidence, 1);
  assertEquals(prepares.legalRefEvidence, 1);
});

Deno.test("release verify accepts source-backed legal attachment rows", async () => {
  const { dbPath, workbench } = await sourceBackedLegalAttachmentWorkbench();
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    entityLegalRefProvenanceCheckedCount: number;
    entityLegalRefProvenanceProblems: Array<
      { attachmentId: string; entityId: string; legalRefId: string; message: string }
    >;
    relationshipLegalRefProvenanceCheckedCount: number;
    relationshipLegalRefProvenanceProblems: Array<{
      attachmentId: string;
      relationshipId: string;
      legalRefId: string;
      message: string;
    }>;
    legalAttachmentAudit: {
      acceptedLegalRefs: number;
      explicitEntityLegalRefInputs: number;
      explicitRelationshipLegalRefInputs: number;
      entityLegalRefAttachments: number;
      relationshipLegalRefAttachments: number;
      legalRelationshipCooccurrenceSources: Array<{
        sourceId: string;
        sourceItemCount: number;
        acceptedLegalRefs: number;
        acceptedRelationshipCandidates: number;
      }>;
    };
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.entityLegalRefProvenanceCheckedCount, 1);
  assertEquals(body.entityLegalRefProvenanceProblems, []);
  assertEquals(body.relationshipLegalRefProvenanceCheckedCount, 1);
  assertEquals(body.relationshipLegalRefProvenanceProblems, []);
  assertEquals(body.legalAttachmentAudit, {
    acceptedLegalRefs: 1,
    explicitEntityLegalRefInputs: 1,
    explicitRelationshipLegalRefInputs: 1,
    entityLegalRefAttachments: 1,
    relationshipLegalRefAttachments: 1,
    legalRelationshipCooccurrenceSources: [],
  });
});

Deno.test("release verify text explains zero relationship legal attachments as no explicit inputs", async () => {
  const { dbPath, workbench } = await sourceBackedInventoryWorkbench();
  workbench.close();

  const output = await runReleaseVerifyText(dbPath);
  assertEquals(output.code, 0);
  assertStringIncludes(
    output.stdout,
    "Legal attachment audit: accepted legal refs=1, explicit entity inputs=0, explicit relationship inputs=0, released entity attachments=0, released relationship attachments=0.",
  );
});

Deno.test("release verify reports dataset and legal ref rows without source evidence", async () => {
  const { dbPath, workbench } = await sourceBackedInventoryWorkbench();
  workbench.db.prepare(
    "delete from dataset_evidence where dataset_id = ?",
  ).run("dataset.test.release.verify.inventory");
  workbench.db.prepare(
    "update legal_ref_evidence set artifact_path = 'missing/legal-ref.json' where legal_ref_id = ?",
  ).run("legal.test.release.verify.inventory");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    datasetProvenanceCheckedCount: number;
    datasetProvenanceProblems: Array<{ datasetId: string; message: string }>;
    legalRefProvenanceCheckedCount: number;
    legalRefProvenanceProblems: Array<{ legalRefId: string; message: string }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("dataset row provenance: 1 problem"), true);
  assertEquals(body.reasons.includes("legal ref row provenance: 1 problem"), true);
  assertEquals(body.datasetProvenanceCheckedCount, 1);
  assertEquals(body.datasetProvenanceProblems.length, 1);
  assertEquals(
    body.datasetProvenanceProblems[0].datasetId,
    "dataset.test.release.verify.inventory",
  );
  assertStringIncludes(body.datasetProvenanceProblems[0].message, "missing dataset evidence");
  assertEquals(body.legalRefProvenanceCheckedCount, 1);
  assertEquals(body.legalRefProvenanceProblems.length, 1);
  assertEquals(
    body.legalRefProvenanceProblems[0].legalRefId,
    "legal.test.release.verify.inventory",
  );
  assertStringIncludes(
    body.legalRefProvenanceProblems[0].message,
    "evidence artifact_path does not resolve to a source artifact",
  );
});

Deno.test("release verify does not duplicate legal ref evidence problems onto attachment rows", async () => {
  const { dbPath, workbench } = await sourceBackedLegalAttachmentWorkbench();
  workbench.db.prepare(
    "update legal_ref_evidence set artifact_path = 'missing/legal-attachment.json' where legal_ref_id = ?",
  ).run("legal.test.release.verify.attachment");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    legalRefProvenanceProblems: Array<{ legalRefId: string; message: string }>;
    entityLegalRefProvenanceCheckedCount: number;
    entityLegalRefProvenanceProblems: Array<
      { attachmentId: string; entityId: string; legalRefId: string; message: string }
    >;
    relationshipLegalRefProvenanceCheckedCount: number;
    relationshipLegalRefProvenanceProblems: Array<{
      attachmentId: string;
      relationshipId: string;
      legalRefId: string;
      message: string;
    }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("legal ref row provenance: 1 problem"), true);
  assertEquals(body.reasons.includes("entity legal ref row provenance: 1 problem"), false);
  assertEquals(body.reasons.includes("relationship legal ref row provenance: 1 problem"), false);
  assertEquals(body.legalRefProvenanceProblems.length, 1);
  assertEquals(body.entityLegalRefProvenanceCheckedCount, 1);
  assertEquals(body.entityLegalRefProvenanceProblems, []);
  assertEquals(body.relationshipLegalRefProvenanceCheckedCount, 1);
  assertEquals(body.relationshipLegalRefProvenanceProblems, []);
});

Deno.test("release verify reports dangling legal attachment links", async () => {
  const { dbPath, workbench } = await sourceBackedLegalAttachmentWorkbench();
  workbench.db.prepare(
    "update entity_legal_refs set entity_id = ? where legal_ref_id = ?",
  ).run("dc.missing_entity", "legal.test.release.verify.attachment");
  workbench.db.prepare(
    "update relationship_legal_refs set relationship_id = ? where legal_ref_id = ?",
  ).run("dc.source_board:governed_by:dc.missing_agency", "legal.test.release.verify.attachment");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    entityLegalRefProvenanceCheckedCount: number;
    entityLegalRefProvenanceProblems: Array<
      { attachmentId: string; entityId: string; legalRefId: string; message: string }
    >;
    relationshipLegalRefProvenanceCheckedCount: number;
    relationshipLegalRefProvenanceProblems: Array<{
      attachmentId: string;
      relationshipId: string;
      legalRefId: string;
      message: string;
    }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("entity legal ref row provenance: 1 problem"), true);
  assertEquals(body.reasons.includes("relationship legal ref row provenance: 1 problem"), true);
  assertEquals(body.entityLegalRefProvenanceCheckedCount, 1);
  assertEquals(body.entityLegalRefProvenanceProblems.length, 1);
  assertEquals(
    body.entityLegalRefProvenanceProblems[0].attachmentId,
    "dc.source_board:legal.test.release.verify.attachment",
  );
  assertEquals(body.entityLegalRefProvenanceProblems[0].entityId, "dc.missing_entity");
  assertEquals(
    body.entityLegalRefProvenanceProblems[0].legalRefId,
    "legal.test.release.verify.attachment",
  );
  assertStringIncludes(
    body.entityLegalRefProvenanceProblems[0].message,
    "entity_id does not resolve to a canonical entity",
  );
  assertEquals(body.relationshipLegalRefProvenanceCheckedCount, 1);
  assertEquals(body.relationshipLegalRefProvenanceProblems.length, 1);
  assertEquals(
    body.relationshipLegalRefProvenanceProblems[0].attachmentId,
    "dc.source_board:governed_by:dc.target_agency:legal.test.release.verify.attachment",
  );
  assertEquals(
    body.relationshipLegalRefProvenanceProblems[0].relationshipId,
    "dc.source_board:governed_by:dc.missing_agency",
  );
  assertEquals(
    body.relationshipLegalRefProvenanceProblems[0].legalRefId,
    "legal.test.release.verify.attachment",
  );
  assertStringIncludes(
    body.relationshipLegalRefProvenanceProblems[0].message,
    "relationship_id does not resolve to a canonical relationship",
  );
});

Deno.test("release verify reports legal attachment relationship id drift", async () => {
  const { dbPath, workbench } = await sourceBackedLegalAttachmentWorkbench();
  workbench.db.prepare(
    "update canonical_relationships set from_entity_id = ? where relationship_id = ?",
  ).run("dc.target_agency", "dc.source_board:governed_by:dc.target_agency");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    relationshipProvenanceProblems: Array<{ relationshipId: string; message: string }>;
    relationshipLegalRefProvenanceProblems: Array<{
      relationshipId: string;
      legalRefId: string;
      message: string;
    }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("relationship row provenance: 1 problem"), true);
  assertEquals(body.reasons.includes("relationship legal ref row provenance: 1 problem"), true);
  assertEquals(body.relationshipProvenanceProblems.length, 1);
  assertEquals(body.relationshipLegalRefProvenanceProblems.length, 1);
  assertStringIncludes(
    body.relationshipLegalRefProvenanceProblems[0].message,
    "relationship_id does not match canonical relationship fields",
  );
});

Deno.test("release verify rejects private dataset and legal ref row URLs", async () => {
  const { dbPath, workbench } = await sourceBackedInventoryWorkbench();
  workbench.db.prepare(
    "update datasets set official_url = 'http://localhost/dataset' where dataset_id = ?",
  ).run("dataset.test.release.verify.inventory");
  workbench.db.prepare(
    "update legal_refs set url = 'file:///tmp/legal-ref.html' where legal_ref_id = ?",
  ).run("legal.test.release.verify.inventory");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    datasetProvenanceProblems: Array<{ message: string }>;
    legalRefProvenanceProblems: Array<{ message: string }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("dataset row provenance: 1 problem"), true);
  assertEquals(body.reasons.includes("legal ref row provenance: 1 problem"), true);
  assertStringIncludes(
    body.datasetProvenanceProblems[0].message,
    "official_url is not a public http/https URL",
  );
  assertStringIncludes(
    body.legalRefProvenanceProblems[0].message,
    "url is not a public http/https URL",
  );
});

Deno.test("release verify text reports dataset and legal ref provenance problems", async () => {
  const { dbPath, workbench } = await sourceBackedInventoryWorkbench();
  workbench.db.prepare(
    "delete from dataset_evidence where dataset_id = ?",
  ).run("dataset.test.release.verify.inventory");
  workbench.db.prepare(
    "update legal_ref_evidence set artifact_path = 'missing/legal-ref.json' where legal_ref_id = ?",
  ).run("legal.test.release.verify.inventory");
  workbench.close();

  const output = await runReleaseVerifyText(dbPath);
  assertEquals(output.code, 1);
  assertStringIncludes(output.stdout, "Dataset row provenance checked: 1 dataset row.");
  assertStringIncludes(output.stdout, "Legal ref row provenance checked: 1 legal ref row.");
  assertStringIncludes(output.stdout, "Dataset row provenance problems:");
  assertStringIncludes(output.stdout, "Legal ref row provenance problems:");
  assertStringIncludes(output.stdout, "missing dataset evidence");
  assertStringIncludes(
    output.stdout,
    "evidence artifact_path does not resolve to a source artifact",
  );
});

Deno.test("release verify text reports legal attachment provenance problems", async () => {
  const { dbPath, workbench } = await sourceBackedLegalAttachmentWorkbench();
  workbench.db.prepare(
    "update entity_legal_refs set entity_id = ? where legal_ref_id = ?",
  ).run("dc.missing_entity", "legal.test.release.verify.attachment");
  workbench.db.prepare(
    "update relationship_legal_refs set relationship_id = ? where legal_ref_id = ?",
  ).run("dc.source_board:governed_by:dc.missing_agency", "legal.test.release.verify.attachment");
  workbench.close();

  const output = await runReleaseVerifyText(dbPath);
  assertEquals(output.code, 1);
  assertStringIncludes(output.stdout, "Entity legal ref row provenance checked: 1 attachment row.");
  assertStringIncludes(
    output.stdout,
    "Relationship legal ref row provenance checked: 1 attachment row.",
  );
  assertStringIncludes(output.stdout, "Entity legal ref row provenance problems:");
  assertStringIncludes(output.stdout, "Relationship legal ref row provenance problems:");
  assertStringIncludes(output.stdout, "legal.test.release.verify.attachment");
  assertStringIncludes(output.stdout, "entity_id does not resolve to a canonical entity");
  assertStringIncludes(
    output.stdout,
    "relationship_id does not resolve to a canonical relationship",
  );
});

Deno.test("release verify accepts camelCase relationship decision payloads", async () => {
  const { dbPath, workbench } = await readyRelationshipWorkbench();
  workbench.db.prepare(
    "update resolution_events set payload_json = ? where subject_id = ?",
  ).run([
    JSON.stringify({
      resolvedFromEntityId: "dc.source_board",
      resolvedRelationshipType: "governed_by",
      resolvedToEntityId: "dc.target_agency",
    }),
    "relationship.test.release.verify.source_governed_by_target",
  ]);
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    relationshipProvenanceCheckedCount: number;
    relationshipProvenanceProblems: Array<{ relationshipId: string; message: string }>;
  };
  assertEquals(result.code, 0);
  assertEquals(body.ready, true);
  assertEquals(body.reasons, []);
  assertEquals(body.relationshipProvenanceCheckedCount, 1);
  assertEquals(body.relationshipProvenanceProblems, []);
});

Deno.test("release verify fails fast on bad artifact provenance without treating review warnings as blockers", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.release.verify.blocked", "Blocked Board"),
    dataDir,
  );
  workbench.db.prepare("update source_artifacts set fetched_url = '/tmp/local-only.html'").run();
  workbench.close();

  const output = await runReleaseVerifyText(dbPath);

  assertEquals(output.code, 1);
  assertStringIncludes(output.stdout, "Release verify: not ready");
  assertStringIncludes(output.stdout, "source artifact provenance: 1 problem");
  assertStringIncludes(output.stdout, "fetched_url is not a public http/https URL");
  assertEquals(output.stderr, "");
});

Deno.test("release verify reports accepted entities without source evidence", async () => {
  const { dbPath, workbench } = await readyEntityWorkbench();
  workbench.db.prepare(
    "delete from entity_candidate_evidence where candidate_id = ?",
  ).run("candidate.test.release.verify.entity");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    entityProvenanceCheckedCount: number;
    entityProvenanceProblems: Array<{ entityId: string; candidateId: string; message: string }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("entity row provenance: 1 problem"), true);
  assertEquals(body.entityProvenanceCheckedCount, 1);
  assertEquals(body.entityProvenanceProblems.length, 1);
  assertEquals(body.entityProvenanceProblems[0].entityId, "dc.release_entity");
  assertEquals(
    body.entityProvenanceProblems[0].candidateId,
    "candidate.test.release.verify.entity",
  );
  assertStringIncludes(
    body.entityProvenanceProblems[0].message,
    "missing entity candidate evidence",
  );
});

Deno.test("release verify reports accepted entity rows without candidate links", async () => {
  const { dbPath, workbench } = await readyEntityWorkbench();
  workbench.db.prepare(
    "update canonical_entities set merged_candidate_ids = '[]' where entity_id = ?",
  ).run("dc.release_entity");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    entityProvenanceCheckedCount: number;
    entityProvenanceProblems: Array<{ entityId: string; candidateId: string; message: string }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("entity row provenance: 1 problem"), true);
  assertEquals(body.entityProvenanceCheckedCount, 1);
  assertEquals(body.entityProvenanceProblems.length, 1);
  assertEquals(body.entityProvenanceProblems[0].entityId, "dc.release_entity");
  assertEquals(body.entityProvenanceProblems[0].candidateId, "unknown");
  assertStringIncludes(
    body.entityProvenanceProblems[0].message,
    "missing accepted entity candidate reference",
  );
});

Deno.test("release verify rejects private entity row URLs", async () => {
  const { dbPath, workbench } = await readyEntityWorkbench();
  workbench.db.prepare(
    "update canonical_entities set official_url = 'http://localhost/entity' where entity_id = ?",
  ).run("dc.release_entity");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    entityProvenanceProblems: Array<{ entityId: string; candidateId: string; message: string }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("entity row provenance: 1 problem"), true);
  assertEquals(body.entityProvenanceProblems.length, 1);
  assertEquals(body.entityProvenanceProblems[0].entityId, "dc.release_entity");
  assertStringIncludes(
    body.entityProvenanceProblems[0].message,
    "official_url is not a public http/https URL",
  );
});

Deno.test("release verify reports accepted relationships without source evidence", async () => {
  const { dbPath, workbench } = await readyRelationshipWorkbench();
  workbench.db.prepare(
    "delete from relationship_candidate_evidence where relationship_candidate_id = ?",
  ).run("relationship.test.release.verify.source_governed_by_target");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    relationshipProvenanceCheckedCount: number;
    relationshipProvenanceProblems: Array<{ relationshipId: string; message: string }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("relationship row provenance: 1 problem"), true);
  assertEquals(body.relationshipProvenanceCheckedCount, 1);
  assertEquals(body.relationshipProvenanceProblems.length, 1);
  assertEquals(
    body.relationshipProvenanceProblems[0].relationshipId,
    "dc.source_board:governed_by:dc.target_agency",
  );
  assertStringIncludes(
    body.relationshipProvenanceProblems[0].message,
    "missing relationship candidate evidence",
  );
});

Deno.test("release verify text reports entity provenance problems", async () => {
  const { dbPath, workbench } = await readyEntityWorkbench();
  workbench.db.prepare(
    "update entity_candidate_evidence set artifact_path = 'missing/entity.json' where candidate_id = ?",
  ).run("candidate.test.release.verify.entity");
  workbench.close();

  const output = await runReleaseVerifyText(dbPath);
  assertEquals(output.code, 1);
  assertStringIncludes(output.stdout, "Entity rows checked: 1 accepted entity row.");
  assertStringIncludes(output.stdout, "Entity row provenance problems:");
  assertStringIncludes(
    output.stdout,
    "evidence artifact_path does not resolve to a source artifact",
  );
});

Deno.test("release verify text reports relationship provenance problems", async () => {
  const { dbPath, workbench } = await readyRelationshipWorkbench();
  workbench.db.prepare(
    "delete from relationship_candidate_evidence where relationship_candidate_id = ?",
  ).run("relationship.test.release.verify.source_governed_by_target");
  workbench.close();

  const output = await runReleaseVerifyText(dbPath);
  assertEquals(output.code, 1);
  assertStringIncludes(output.stdout, "Relationship rows checked: 1 accepted relationship row.");
  assertStringIncludes(output.stdout, "Relationship row provenance problems:");
  assertStringIncludes(output.stdout, "missing relationship candidate evidence");
});

Deno.test("release verify follows relationship evidence artifact paths", async () => {
  const { dbPath, workbench } = await readyRelationshipWorkbench();
  workbench.db.prepare(
    "update relationship_candidate_evidence set artifact_path = 'missing/evidence.json' where relationship_candidate_id = ?",
  ).run("relationship.test.release.verify.source_governed_by_target");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    relationshipProvenanceCheckedCount: number;
    relationshipProvenanceProblems: Array<{ relationshipId: string; message: string }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("relationship row provenance: 1 problem"), true);
  assertEquals(body.relationshipProvenanceCheckedCount, 1);
  assertEquals(body.relationshipProvenanceProblems.length, 1);
  assertStringIncludes(
    body.relationshipProvenanceProblems[0].message,
    "evidence artifact_path does not resolve to a source artifact",
  );
});

Deno.test("release verify reports relationship rows that drift from accepted decisions", async () => {
  const { dbPath, workbench } = await readyRelationshipWorkbench();
  workbench.db.prepare(
    "update canonical_relationships set relationship_type = 'part_of' where relationship_id = ?",
  ).run("dc.source_board:governed_by:dc.target_agency");
  workbench.close();

  const result = await runReleaseVerifyJson(dbPath);
  const body = result.body as {
    ready: boolean;
    reasons: string[];
    relationshipProvenanceCheckedCount: number;
    relationshipProvenanceProblems: Array<{ relationshipId: string; message: string }>;
  };
  assertEquals(result.code, 1);
  assertEquals(body.ready, false);
  assertEquals(body.reasons.includes("relationship row provenance: 1 problem"), true);
  assertEquals(body.relationshipProvenanceCheckedCount, 1);
  assertEquals(body.relationshipProvenanceProblems.length, 1);
  assertStringIncludes(
    body.relationshipProvenanceProblems[0].message,
    "canonical row does not match accepted relationship decision",
  );
});

Deno.test("release verify rejects private relationship evidence URLs", async () => {
  for (
    const fetchedUrl of [
      "http://localhost/source.json",
      "http://intranet/source.json",
      "http://host.docker.internal/source.json",
      "http://[::ffff:127.0.0.1]/source.json",
    ]
  ) {
    const { dbPath, workbench } = await readyRelationshipWorkbench();
    workbench.db.prepare("update source_artifacts set fetched_url = ?").run(fetchedUrl);
    workbench.close();

    const result = await runReleaseVerifyJson(dbPath);
    const body = result.body as {
      ready: boolean;
      sourceArtifactProblems: Array<{ message: string }>;
      relationshipProvenanceProblems: Array<{ relationshipId: string; message: string }>;
    };
    assertEquals(result.code, 1, fetchedUrl);
    assertEquals(body.ready, false, fetchedUrl);
    assertEquals(body.sourceArtifactProblems.length > 0, true, fetchedUrl);
    assertEquals(body.relationshipProvenanceProblems.length, 1, fetchedUrl);
    assertStringIncludes(
      body.relationshipProvenanceProblems[0].message,
      "fetched_url is not a public http/https URL",
    );
  }
});

async function runReleaseVerifyJson(dbPath: string): Promise<{
  code: number;
  body: unknown;
}> {
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
      "verify",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();

  return {
    code: output.code,
    body: JSON.parse(new TextDecoder().decode(output.stdout)),
  };
}

async function runReleaseVerifyText(
  dbPath: string,
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
      "release",
      "verify",
      "--db",
      dbPath,
    ],
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

async function addAcceptedRelationship(
  workbench: Workbench,
  dataDir: string,
  resolutionsDir: string,
  input: {
    suffix: string;
    relationshipType: RelationshipType;
  },
): Promise<void> {
  const relationshipCandidateId = `relationship.test.release.verify.source_${input.suffix}_target`;
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: `test.release.verify.relationships.${input.suffix}`,
      relationshipCandidateId,
      sourceItemKey: `relationship-row-${input.suffix}`,
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: input.relationshipType,
      rawValue: `Target Agency ${input.suffix}`,
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: relationshipCandidateId,
      payload: {},
    },
    resolutionsDir,
  );
}

function countRelationshipEvidencePrepares(workbench: Workbench): number {
  const originalPrepare = workbench.db.prepare.bind(workbench.db);
  const prepareOwner = workbench.db as unknown as {
    prepare(sql: string): ReturnType<typeof workbench.db.prepare>;
  };
  let prepareCount = 0;
  prepareOwner.prepare = (sql: string) => {
    const normalizedSql = sql.replaceAll(/\s+/g, " ");
    if (normalizedSql.includes("from relationship_candidate_evidence")) {
      prepareCount += 1;
    }
    return originalPrepare(sql);
  };
  try {
    verifyWorkbenchRelease(workbench);
  } finally {
    prepareOwner.prepare = originalPrepare;
  }
  return prepareCount;
}

function duplicateInventoryRows(workbench: Workbench, totalRows: number): void {
  for (let index = 2; index <= totalRows; index += 1) {
    const suffix = String(index);
    workbench.db.prepare(
      `insert into datasets(
         dataset_id, source_item_id, name, category, owner_name, access_method, artifact_depth,
         official_url, review_status
       )
       select ?, source_item_id, name || ' ' || ?, category, owner_name, access_method,
              artifact_depth, official_url, review_status
       from datasets
       where dataset_id = ?`,
    ).run(
      `dataset.test.release.verify.inventory.${suffix}`,
      suffix,
      "dataset.test.release.verify.inventory",
    );
    workbench.db.prepare(
      `insert into dataset_evidence(
         evidence_id, dataset_id, source_id, source_item_id, field_path, observed_value,
         artifact_path
       )
       select ?, ?, source_id, source_item_id, field_path, observed_value, artifact_path
       from dataset_evidence
       where dataset_id = ?`,
    ).run(
      `evidence.dataset.test.release.verify.inventory.${suffix}`,
      `dataset.test.release.verify.inventory.${suffix}`,
      "dataset.test.release.verify.inventory",
    );
    workbench.db.prepare(
      `insert into legal_refs(
         legal_ref_id, source_item_id, ref_type, citation_text, normalized_citation, url,
         review_status
       )
       select ?, source_item_id, ref_type, citation_text, normalized_citation, url, review_status
       from legal_refs
       where legal_ref_id = ?`,
    ).run(
      `legal.test.release.verify.inventory.${suffix}`,
      "legal.test.release.verify.inventory",
    );
    workbench.db.prepare(
      `insert into legal_ref_evidence(
         evidence_id, legal_ref_id, source_id, source_item_id, field_path, observed_value,
         artifact_path
       )
       select ?, ?, source_id, source_item_id, field_path, observed_value, artifact_path
       from legal_ref_evidence
       where legal_ref_id = ?`,
    ).run(
      `evidence.legal.test.release.verify.inventory.${suffix}`,
      `legal.test.release.verify.inventory.${suffix}`,
      "legal.test.release.verify.inventory",
    );
  }
}

function countInventoryEvidencePrepares(workbench: Workbench): {
  datasetEvidence: number;
  legalRefEvidence: number;
} {
  const originalPrepare = workbench.db.prepare.bind(workbench.db);
  const prepareOwner = workbench.db as unknown as {
    prepare(sql: string): ReturnType<typeof workbench.db.prepare>;
  };
  let datasetEvidence = 0;
  let legalRefEvidence = 0;
  prepareOwner.prepare = (sql: string) => {
    const normalizedSql = sql.replaceAll(/\s+/g, " ");
    if (normalizedSql.includes("from dataset_evidence")) datasetEvidence += 1;
    if (normalizedSql.includes("from legal_ref_evidence")) legalRefEvidence += 1;
    return originalPrepare(sql);
  };
  try {
    verifyWorkbenchRelease(workbench);
  } finally {
    prepareOwner.prepare = originalPrepare;
  }
  return { datasetEvidence, legalRefEvidence };
}

async function readyEntityWorkbench(): Promise<{
  dbPath: string;
  workbench: Workbench;
}> {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.release.verify.entity_source",
      candidateId: "candidate.test.release.verify.entity",
      sourceItemKey: "entity-row",
      proposedEntityId: "dc.release_entity",
      name: "Release Entity",
      kind: "board",
      observedName: "Release Entity",
      officialUrl: "https://example.com/release-entity",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.release.verify.entity",
      payload: {},
    },
    resolutionsDir,
  );

  return { dbPath, workbench };
}

async function readyRelationshipWorkbench(): Promise<{
  dbPath: string;
  dataDir: string;
  resolutionsDir: string;
  workbench: Workbench;
}> {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.release.verify.source_entity",
      candidateId: "candidate.test.release.verify.source_board",
      sourceItemKey: "source-board-row",
      proposedEntityId: "dc.source_board",
      name: "Source Board",
      kind: "board",
      observedName: "Source Board",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.release.verify.source_board",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.release.verify.target_entity",
      candidateId: "candidate.test.release.verify.target_agency",
      sourceItemKey: "target-agency-row",
      proposedEntityId: "dc.target_agency",
      name: "Target Agency",
      kind: "agency",
      observedName: "Target Agency",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.release.verify.target_agency",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.release.verify.relationships",
      relationshipCandidateId: "relationship.test.release.verify.source_governed_by_target",
      sourceItemKey: "relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "governed_by",
      rawValue: "Target Agency",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: "relationship.test.release.verify.source_governed_by_target",
      payload: {},
    },
    resolutionsDir,
  );

  return { dbPath, dataDir, resolutionsDir, workbench };
}

async function sourceBackedLegalAttachmentWorkbench(): Promise<{
  dbPath: string;
  workbench: Workbench;
}> {
  const { dbPath, dataDir, resolutionsDir, workbench } = await readyRelationshipWorkbench();
  await workbench.importConnectorResult(syntheticLegalAttachmentSourceResult(), dataDir);
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_legal_ref",
      subjectId: "legal.test.release.verify.attachment",
      payload: {},
    },
    resolutionsDir,
  );
  return { dbPath, workbench };
}

async function sourceBackedInventoryWorkbench(): Promise<{
  dbPath: string;
  workbench: Workbench;
}> {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(syntheticInventorySourceResult(), dataDir);
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_legal_ref",
      subjectId: "legal.test.release.verify.inventory",
      payload: {},
    },
    resolutionsDir,
  );

  return { dbPath, workbench };
}

function syntheticInventorySourceResult(): ConnectorResult {
  return {
    source: {
      sourceId: "test.release.verify.inventory",
      title: "Test Release Inventory",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/release-inventory",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.release.verify.inventory.main",
        sourceId: "test.release.verify.inventory",
        title: "Release inventory rows",
        kind: "fixture",
        url: "https://example.com/release-inventory",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/release-inventory",
        contentText: JSON.stringify({
          datasetId: "dataset.test.release.verify.inventory",
          legalRefId: "legal.test.release.verify.inventory",
        }),
      }],
      parsed: {
        items: [{
          itemKey: "dataset-row",
          itemType: "fixture_dataset",
          title: "Dataset row",
          body: { name: "Inventory Dataset" },
        }, {
          itemKey: "legal-ref-row",
          itemType: "fixture_legal_ref",
          title: "Legal ref row",
          body: { citationText: "D.C. Code § 1-204.22" },
        }],
        datasets: [{
          datasetId: "dataset.test.release.verify.inventory",
          sourceItemKey: "dataset-row",
          name: "Inventory Dataset",
          category: "inventory",
          ownerName: "District of Columbia",
          accessMethod: "public_web",
          artifactDepth: "sample",
          officialUrl: "https://example.com/release-inventory/dataset",
          evidence: [{
            fieldPath: "name",
            observedValue: "Inventory Dataset",
          }],
        }],
        legalRefs: [{
          legalRefId: "legal.test.release.verify.inventory",
          sourceItemKey: "legal-ref-row",
          refType: "dc_code",
          citationText: "D.C. Code § 1-204.22",
          normalizedCitation: "D.C. Code 1-204.22",
          url: "https://code.dccouncil.gov/us/dc/council/code/sections/1-204.22",
          needsReview: true,
          evidence: [{
            fieldPath: "citation",
            observedValue: "D.C. Code § 1-204.22",
          }],
        }],
      },
    }],
  };
}

function syntheticLegalAttachmentSourceResult(): ConnectorResult {
  return {
    source: {
      sourceId: "test.release.verify.legal_attachment",
      title: "Test Release Legal Attachment",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/release-legal-attachment",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.release.verify.legal_attachment.main",
        sourceId: "test.release.verify.legal_attachment",
        title: "Release legal attachment rows",
        kind: "fixture",
        url: "https://example.com/release-legal-attachment",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/release-legal-attachment",
        contentText: JSON.stringify({
          legalRefId: "legal.test.release.verify.attachment",
          entityId: "dc.source_board",
          relationshipId: "dc.source_board:governed_by:dc.target_agency",
        }),
      }],
      parsed: {
        items: [{
          itemKey: "legal-attachment-row",
          itemType: "fixture_legal_ref",
          title: "Legal attachment row",
          body: { citationText: "D.C. Code § 1-204.04" },
        }],
        legalRefs: [{
          legalRefId: "legal.test.release.verify.attachment",
          sourceItemKey: "legal-attachment-row",
          refType: "dc_code",
          citationText: "D.C. Code § 1-204.04",
          normalizedCitation: "D.C. Code 1-204.04",
          url: "https://code.dccouncil.gov/us/dc/council/code/sections/1-204.04",
          needsReview: true,
          attachEntityRef: "dc.source_board",
          attachRelationshipRef: "dc.source_board:governed_by:dc.target_agency",
          evidence: [{
            fieldPath: "citation",
            observedValue: "D.C. Code § 1-204.04",
          }],
        }],
      },
    }],
  };
}
