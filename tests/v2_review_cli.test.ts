import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildReviewItemId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { renderReviewItem } from "../src/v2/workbench/review_cli.ts";
import {
  legalEntrypointsFixture,
  openDcBoardFixture,
  openDcIndexFixture,
  openDcTaskForceFixture,
} from "./helpers/v2_fixtures.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

function openDcPublicBodiesFetcher() {
  return async (url: string) => ({
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
}

function legalEntrypointsFetcher() {
  return async (url: string) => ({
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
  });
}

Deno.test("relationship review rendering batches endpoint status lookup", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  seedAcceptedEntity(workbench, "dc.target_agency", "Target Agency", "agency");
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_cli.render_relationships",
      relationshipCandidateId: "relationship.test.review_cli.rendered",
      sourceItemKey: "rendered-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "governed_by",
      rawValue: "Target Agency",
      needsReview: true,
    }),
    dataDir,
  );
  const item = workbench.listReviewItems({ mode: "relationships" })[0];

  const queryCounts = countRenderEndpointStatusPrepares(workbench, item);
  workbench.close();

  assertEquals(queryCounts.endpointCandidateStatusQueries, 1);
  assertEquals(queryCounts.endpointCanonicalQueries, 1);
  assertStringIncludes(queryCounts.output, "Review: Target Agency");
  assertStringIncludes(queryCounts.output, "- from: dc.source_board");
  assertStringIncludes(queryCounts.output, "- to: dc.target_agency");
});

Deno.test("dc review legal supports scripted normalize-and-quit flow for the remaining ambiguous ref", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: legalEntrypointsFetcher(),
  }));
  await workbench.importConnectorResult(result, dataDir);
  workbench.close();

  const child = new Deno.Command(Deno.execPath(), {
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
      "legal",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode("n\ndcmr\nDCMR and D.C. Register entrypoint\nq\n"));
  await writer.close();
  const output = await child.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  assertEquals(output.code, 0);
  assertEquals(stderr, "");
  assertStringIncludes(stdout, "Review: DC Register / DCMR");
  assertStringIncludes(stdout, "legal ref | dc register | open");
  assertStringIncludes(stdout, "n normalize and accept");
  assertStringIncludes(stdout, "Saved resolution.");
  assertStringIncludes(stdout, "No review items remain.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const accepted = reopened.legalRefs().filter((ref) => ref.review_status === "accepted");
  reopened.close();
  assertEquals(accepted.length, 3);
  assertEquals(
    accepted.some((ref) => ref.normalized_citation === "DCMR and D.C. Register entrypoint"),
    true,
  );
});

function countRenderEndpointStatusPrepares(
  workbench: Workbench,
  item: ReturnType<Workbench["listReviewItems"]>[number],
): {
  endpointCandidateStatusQueries: number;
  endpointCanonicalQueries: number;
  output: string;
} {
  const originalPrepare = workbench.db.prepare.bind(workbench.db);
  const prepareOwner = workbench.db as unknown as {
    prepare(sql: string): ReturnType<typeof workbench.db.prepare>;
  };
  let endpointCandidateStatusQueries = 0;
  let endpointCanonicalQueries = 0;
  let output = "";
  prepareOwner.prepare = (sql: string) => {
    const normalizedSql = sql.replaceAll(/\s+/g, " ");
    if (
      normalizedSql.includes("from entity_candidates") &&
      normalizedSql.includes("where entity_candidates.proposed_entity_id in")
    ) {
      endpointCandidateStatusQueries += 1;
    }
    if (
      normalizedSql.includes("from canonical_entities") &&
      normalizedSql.includes("where entity_id in") &&
      normalizedSql.includes("is_placeholder")
    ) {
      endpointCanonicalQueries += 1;
    }
    return originalPrepare(sql);
  };
  try {
    output = renderReviewItem(workbench, item);
  } finally {
    prepareOwner.prepare = originalPrepare;
  }
  return { endpointCandidateStatusQueries, endpointCanonicalQueries, output };
}

Deno.test("scripted review CLI accepts a candidate and entity show renders evidence and backlinks", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({
      fetcher: openDcPublicBodiesFetcher(),
      limit: 2,
    })),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_cli.entities",
      candidateId: "candidate.test.review_cli.board_accountancy",
      sourceItemKey: "review-cli-board-accountancy",
      proposedEntityId: "dc.board_of_accountancy",
      name: "Board of Accountancy",
      kind: "board",
      observedName: "Board of Accountancy",
    }),
    dataDir,
  );
  workbench.close();
  const reviewRun = new Deno.Command(Deno.execPath(), {
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
      "--mode",
      "entities",
      "--subject-prefix",
      "candidate.test.review_cli",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const reviewProcess = reviewRun.spawn();
  const writer = reviewProcess.stdin.getWriter();
  await writer.write(new TextEncoder().encode("a\na\nq\n"));
  await writer.close();
  const reviewOutput = await reviewProcess.output();
  const reviewText = new TextDecoder().decode(reviewOutput.stdout);
  assertStringIncludes(reviewText, "Review: Board of Accountancy");
  assertStringIncludes(reviewText, "entity candidate | board | open");
  assertStringIncludes(reviewText, "source: test.review_cli.entities / Custom entity row");
  assertStringIncludes(reviewText, "reason: Review fixture entity candidate");
  assertStringIncludes(reviewText, "default: accept (Enter or a)");
  assertStringIncludes(
    reviewText,
    "actions: Enter accept, a accept, r reject, m merge, d defer, q quit",
  );
  assertStringIncludes(
    reviewText,
    "ids: subject=candidate.test.review_cli.board_accountancy",
  );
  assertStringIncludes(reviewText, "evidence:");
  assertStringIncludes(reviewText, "test.review_cli.entities: name <- Board of Accountancy");
  assertStringIncludes(reviewText, "artifact:");
  assertStringIncludes(reviewText, "Saved resolution.");
  const searchOutput = await new Deno.Command(Deno.execPath(), {
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
      "entity",
      "search",
      "accountancy",
      "--db",
      dbPath,
    ],
  }).output();
  assertStringIncludes(new TextDecoder().decode(searchOutput.stdout), "dc.board_of_accountancy");
  const searchJsonOutput = await new Deno.Command(Deno.execPath(), {
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
      "entity",
      "search",
      "accountancy",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const searchJson = JSON.parse(
    new TextDecoder().decode(searchJsonOutput.stdout),
  ) as Array<{ entityId: string; name: string }>;
  assertEquals(searchJsonOutput.code, 0);
  assertEquals(searchJson[0].entityId, "dc.board_of_accountancy");
  const showOutput = await new Deno.Command(Deno.execPath(), {
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
      "entity",
      "show",
      "dc.board_of_accountancy",
      "--db",
      dbPath,
    ],
  }).output();
  const showText = new TextDecoder().decode(showOutput.stdout);
  assertStringIncludes(showText, "Board of Accountancy");
  assertStringIncludes(showText, "evidence:");
  assertStringIncludes(showText, "open_dc.public_bodies:");
  assertStringIncludes(showText, "artifact:");
  assertStringIncludes(showText, "legal_refs:");
  const showJsonOutput = await new Deno.Command(Deno.execPath(), {
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
      "entity",
      "show",
      "dc.board_of_accountancy",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const showJson = JSON.parse(new TextDecoder().decode(showJsonOutput.stdout)) as {
    entityId: string;
    evidence: Array<{ fieldPath: string }>;
    legalRefs: Array<{ refType: string }>;
  };
  assertEquals(showJsonOutput.code, 0);
  assertEquals(showJson.entityId, "dc.board_of_accountancy");
  assert(showJson.evidence.some((row) => row.fieldPath === "name"));
  assert(showJson.legalRefs.some((row) => row.refType === "dc_code"));
});

Deno.test("interactive review Enter accepts the default action", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_cli.enter",
      candidateId: "candidate.test.review_cli.enter.board_accountancy",
      sourceItemKey: "review-cli-enter-board-accountancy",
      proposedEntityId: "dc.board_of_accountancy",
      name: "Board of Accountancy",
      kind: "board",
      observedName: "Board of Accountancy",
    }),
    dataDir,
  );
  workbench.close();

  const reviewRun = new Deno.Command(Deno.execPath(), {
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
      "--mode",
      "entities",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const reviewProcess = reviewRun.spawn();
  const writer = reviewProcess.stdin.getWriter();
  await writer.write(new TextEncoder().encode("\nq\n"));
  await writer.close();
  const reviewOutput = await reviewProcess.output();
  const reviewText = new TextDecoder().decode(reviewOutput.stdout);
  assertEquals(reviewOutput.code, 0);
  assertStringIncludes(reviewText, "default: accept (Enter or a)");
  assertStringIncludes(reviewText, "Saved resolution.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const entities = reopened.canonicalEntities();
  reopened.close();
  assertEquals(entities.map((entity) => entity.id), ["dc.board_of_accountancy"]);
});

Deno.test("interactive review quit reports remaining work and resume command", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_cli.quit_one",
      candidateId: "candidate.test.review_cli.quit_one.board_accountancy",
      sourceItemKey: "review-cli-quit-board-accountancy",
      proposedEntityId: "dc.board_of_accountancy",
      name: "Board of Accountancy",
      kind: "board",
      observedName: "Board of Accountancy",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_cli.quit_two",
      candidateId: "candidate.test.review_cli.quit_two.task_force",
      sourceItemKey: "review-cli-quit-task-force",
      proposedEntityId: "dc.adult_career_pathways_task_force",
      name: "Adult Career Pathways Task Force",
      kind: "task_force",
      observedName: "Adult Career Pathways Task Force",
    }),
    dataDir,
  );
  workbench.close();

  const reviewRun = new Deno.Command(Deno.execPath(), {
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
      "--mode",
      "entities",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const reviewProcess = reviewRun.spawn();
  const writer = reviewProcess.stdin.getWriter();
  await writer.write(new TextEncoder().encode("q\n"));
  await writer.close();
  const reviewOutput = await reviewProcess.output();
  const reviewText = new TextDecoder().decode(reviewOutput.stdout);
  assertEquals(reviewOutput.code, 0);
  assertStringIncludes(
    reviewText,
    "Review stopped. 2 item(s) remain. Resume with deno task dc -- review entities.",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const items = reopened.listReviewItems({ mode: "entities" });
  reopened.close();
  assertEquals(items.length, 2);
  assert(items.every((item) => item.status === "open"));
});

Deno.test("interactive review starts with an inbox summary for the current slice", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  seedAcceptedEntity(workbench, "dc.target_agency", "Target Agency", "agency");
  seedAcceptedEntity(workbench, "dc.alt_agency", "Alt Agency", "agency");
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_cli.inbox",
      relationshipCandidateId: "relationship.test.review_cli.inbox.one",
      sourceItemKey: "review-cli-inbox-row-one",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Health",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_cli.inbox",
      relationshipCandidateId: "relationship.test.review_cli.inbox.two",
      sourceItemKey: "review-cli-inbox-row-two",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.alt_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Education",
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
      "--mode",
      "relationships",
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
  await writer.write(new TextEncoder().encode("q\n"));
  await writer.close();
  const output = await reviewProcess.output();
  const stdout = new TextDecoder().decode(output.stdout);

  assertEquals(output.code, 0);
  assertStringIncludes(stdout, "Review inbox");
  assertStringIncludes(stdout, "Open items in this slice: 2");
  assertStringIncludes(stdout, "Top grouped slices:");
  assertStringIncludes(
    stdout,
    "- [2 open] test.review_cli.inbox overseen_by - Review relationship candidate",
  );
});

Deno.test("interactive review prioritizes decisions that unblock relationships", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_cli.graph_priority",
      candidateId: "candidate.test.review_cli.graph_priority.low_impact",
      sourceItemKey: "graph-priority-low-impact-row",
      proposedEntityId: "dc.low_impact_board",
      name: "Low Impact Board",
      kind: "board",
      observedName: "Low Impact Board",
      confidence: 0.4,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_cli.graph_priority",
      candidateId: "candidate.test.review_cli.graph_priority.unblocking_agency",
      sourceItemKey: "graph-priority-unblocking-agency-row",
      proposedEntityId: "dc.unblocking_agency",
      name: "Unblocking Agency",
      kind: "agency",
      observedName: "Unblocking Agency",
      confidence: 0.4,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_cli.graph_priority",
      relationshipCandidateId: "relationship.test.review_cli.graph_priority.blocked",
      sourceItemKey: "graph-priority-blocked-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.unblocking_agency",
      relationshipType: "overseen_by",
      rawValue: "Unblocking Agency",
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
      "--mode",
      "entities",
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
  await writer.write(new TextEncoder().encode("q\n"));
  await writer.close();
  const output = await reviewProcess.output();
  const stdout = new TextDecoder().decode(output.stdout);

  assertEquals(output.code, 0);
  assertStringIncludes(stdout, "Decision impact: unblocks 1 blocked relationship.");
  assertStringIncludes(stdout, "Review: Unblocking Agency");
  assertEquals(stdout.includes("Review: Low Impact Board"), false);
});

Deno.test("interactive review --status deferred does not treat deferred items as actionable impact", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_cli.deferred_priority",
      candidateId: "candidate.test.review_cli.deferred_priority.target",
      sourceItemKey: "deferred-priority-target-row",
      proposedEntityId: "dc.deferred_priority_target",
      name: "Deferred Priority Target",
      kind: "agency",
      observedName: "Deferred Priority Target",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_cli.deferred_priority",
      relationshipCandidateId: "relationship.test.review_cli.deferred_priority.blocked",
      sourceItemKey: "deferred-priority-blocked-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.deferred_priority_target",
      relationshipType: "overseen_by",
      rawValue: "Deferred Priority Target",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(
        "candidate.test.review_cli.deferred_priority.target",
        "entity-review",
      ),
      payload: {},
    },
    resolutionsDir,
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
      "--mode",
      "entities",
      "--status",
      "deferred",
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
  await writer.write(new TextEncoder().encode("q\n"));
  await writer.close();
  const output = await reviewProcess.output();
  const stdout = new TextDecoder().decode(output.stdout);

  assertEquals(output.code, 0);
  assertStringIncludes(stdout, "Review: Deferred Priority Target");
  assertEquals(stdout.includes("Decision impact:"), false);
});

Deno.test("interactive review --status all still prioritizes open unblocking work ahead of deferred items", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "aaa.deferred_priority",
      candidateId: "candidate.aaa.deferred_priority.only",
      sourceItemKey: "aaa-deferred-priority-row",
      proposedEntityId: "dc.aaa_deferred_priority",
      name: "Deferred First Alphabetically",
      kind: "board",
      observedName: "Deferred First Alphabetically",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId("candidate.aaa.deferred_priority.only", "entity-review"),
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "zzz.open_priority",
      candidateId: "candidate.zzz.open_priority.target",
      sourceItemKey: "zzz-open-priority-target-row",
      proposedEntityId: "dc.zzz_open_priority_target",
      name: "Open Priority Target",
      kind: "agency",
      observedName: "Open Priority Target",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "zzz.open_priority",
      relationshipCandidateId: "relationship.zzz.open_priority.blocked",
      sourceItemKey: "zzz-open-priority-blocked-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.zzz_open_priority_target",
      relationshipType: "overseen_by",
      rawValue: "Open Priority Target",
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
      "--mode",
      "entities",
      "--status",
      "all",
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
  await writer.write(new TextEncoder().encode("q\n"));
  await writer.close();
  const output = await reviewProcess.output();
  const stdout = new TextDecoder().decode(output.stdout);

  assertEquals(output.code, 0);
  assertStringIncludes(stdout, "Decision impact: unblocks 1 blocked relationship.");
  assertStringIncludes(stdout, "Review: Open Priority Target");
  assertEquals(stdout.includes("Review: Deferred First Alphabetically"), false);
});

Deno.test("interactive review stays inside the current packet until it clears", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_cli.zzz_packet",
      candidateId: "candidate.test.review_cli.zzz_packet.one",
      sourceItemKey: "review-cli-zzz-packet-one",
      proposedEntityId: "dc.zzz_packet_one",
      name: "Zzz Packet One",
      kind: "board",
      observedName: "Zzz Packet One",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_cli.zzz_packet",
      candidateId: "candidate.test.review_cli.zzz_packet.two",
      sourceItemKey: "review-cli-zzz-packet-two",
      proposedEntityId: "dc.zzz_packet_two",
      name: "Zzz Packet Two",
      kind: "board",
      observedName: "Zzz Packet Two",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_cli.aaa_other",
      candidateId: "candidate.test.review_cli.aaa_other.one",
      sourceItemKey: "review-cli-aaa-other-one",
      proposedEntityId: "dc.aaa_other_one",
      name: "Aaa Other One",
      kind: "board",
      observedName: "Aaa Other One",
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
      "--mode",
      "entities",
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
  await writer.write(new TextEncoder().encode("\nq\n"));
  await writer.close();
  const output = await reviewProcess.output();
  const stdout = new TextDecoder().decode(output.stdout);

  assertEquals(output.code, 0);
  assertStringIncludes(stdout, "Review: Zzz Packet One");
  assertStringIncludes(stdout, "Saved resolution.");
  assertStringIncludes(stdout, "Review: Zzz Packet Two");
  assertEquals(stdout.includes("Review: Aaa Other One"), false);
});

Deno.test("interactive review resume command preserves quoted filters", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  seedAcceptedEntity(workbench, "dc.target_agency", "Target Agency", "agency");
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_cli.quoted_resume",
      relationshipCandidateId: "relationship.test.review_cli.quoted_resume.one",
      sourceItemKey: "review-cli-quoted-resume-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Health's Work",
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
      "--relationship-type",
      "overseen_by",
      "--raw-value-contains",
      "Committee on Health's Work",
      "--subject-prefix",
      "relationship.test.review_cli.quoted_resume",
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
  await writer.write(new TextEncoder().encode("q\n"));
  await writer.close();
  const reviewOutput = await reviewProcess.output();
  const reviewText = new TextDecoder().decode(reviewOutput.stdout);

  assertEquals(reviewOutput.code, 0);
  assertStringIncludes(
    reviewText,
    "Resume with deno task dc -- review relationships --subject-prefix relationship.test.review_cli.quoted_resume --relationship-type overseen_by --raw-value-contains 'Committee on Health'\\''s Work'.",
  );
});

Deno.test("interactive relationship review quit reports filtered resume command", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({
      fetcher: openDcPublicBodiesFetcher(),
      limit: 2,
    })),
    dataDir,
  );
  workbench.close();

  const reviewRun = new Deno.Command(Deno.execPath(), {
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
      "--relationship-type",
      "governed_by",
      "--subject-prefix",
      "relationship.open_dc.public_bodies",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const reviewProcess = reviewRun.spawn();
  const writer = reviewProcess.stdin.getWriter();
  await writer.write(new TextEncoder().encode("q\n"));
  await writer.close();
  const reviewOutput = await reviewProcess.output();
  const reviewText = new TextDecoder().decode(reviewOutput.stdout);
  assertEquals(reviewOutput.code, 0);
  assertStringIncludes(reviewText, "No review items remain.");
});

Deno.test("interactive review does not resurface a deferred item in the same session", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: legalEntrypointsFetcher(),
  }));
  await workbench.importConnectorResult(result, dataDir);
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
      "legal",
      "--subject-prefix",
      "legal.legal.entrypoints.https_dcregs_dc_gov",
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
  await writer.write(new TextEncoder().encode("\n"));
  await writer.close();
  const output = await reviewProcess.output();
  const text = new TextDecoder().decode(output.stdout);
  assertEquals(output.code, 0);
  assertStringIncludes(text, "default: defer (Enter or d)");
  assertStringIncludes(text, "Saved resolution.");
  assertStringIncludes(text, "No review items remain.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const deferred = reopened.listReviewItems({
    mode: "legal",
    status: "deferred",
    subjectPrefix: "legal.legal.entrypoints.https_dcregs_dc_gov",
  });
  reopened.close();
  assertEquals(deferred.length, 1);
});

function seedAcceptedEntity(
  workbench: Workbench,
  entityId: string,
  name: string,
  kind: string,
): void {
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run([entityId, name, kind]);
}
