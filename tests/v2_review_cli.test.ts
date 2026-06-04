import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildReviewItemId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { renderReviewItem } from "../src/v2/workbench/review_cli.ts";
import {
  dcgisBoardsCommissionsCouncilsMetadataFixture,
  dcgisMetadataFixture,
  dcgisRowsFixture,
  openDcBoardFixture,
  openDcIndexFixture,
  openDcTaskForceFixture,
} from "./helpers/v2_fixtures.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
  syntheticLegalRefSourceResult,
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
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.cli_unknown",
      "Mystery legal authority",
      "https://example.com/mystery-legal-authority",
    ),
    dataDir,
  );
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
  await writer.write(
    new TextEncoder().encode("\nn\ndcmr\nDCMR and D.C. Register entrypoint\nq\n"),
  );
  await writer.close();
  const output = await child.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  assertEquals(output.code, 0);
  assertEquals(stderr, "");
  assertStringIncludes(stdout, "Review: Mystery legal authority");
  assertStringIncludes(stdout, "legal ref | unknown | open");
  assertStringIncludes(
    stdout,
    "impact: accept keeps this citation as source-backed legal context; reject drops it; defer keeps it pending.",
  );
  assertStringIncludes(stdout, "n normalize and accept");
  assertStringIncludes(stdout, "Saved resolution.");
  assertStringIncludes(stdout, "No review items remain.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const accepted = reopened.legalRefs().filter((ref) => ref.review_status === "accepted");
  reopened.close();
  assertEquals(accepted.length, 1);
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

Deno.test("scripted review CLI accepts an explicit entity decision and entity show renders evidence and backlinks", async () => {
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
      needsReview: true,
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
  await writer.write(new TextEncoder().encode("\na\na\nq\n"));
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
    "impact: accept promotes this candidate into canonical entities; reject or defer keeps it out of the release for now.",
  );
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

Deno.test("entity conflict review rendering explains defer impact", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.conflicted_review_body', 'Conflicted Review Body', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_cli.conflicted_entity",
      candidateId: "candidate.test.review_cli.conflicted_entity.board",
      sourceItemKey: "conflicted-review-row",
      proposedEntityId: "dc.conflicted_review_body",
      name: "Conflicted Review Body",
      kind: "board",
      observedName: "Conflicted Review Body",
      confidence: 0.99,
    }),
    dataDir,
  );

  const item = workbench.listReviewItems({ mode: "entities" })[0];
  const text = renderReviewItem(workbench, item);
  workbench.close();

  assertStringIncludes(
    text,
    "reason: Resolve entity candidate that conflicts with an accepted entity",
  );
  assertStringIncludes(
    text,
    "why deferred: Candidate kind board conflicts with accepted agency for the same entity id.",
  );
  assertStringIncludes(text, "default: defer (Enter or d)");
  assertStringIncludes(
    text,
    "impact: accept attaches this board candidate to existing agency dc.conflicted_review_body; defer keeps the source conflict out of the release until decided.",
  );
  assert(!text.includes("accept promotes this candidate into canonical entities"));
});

Deno.test("DCGIS public-body agency-name rows derive distinct public body before review", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const bccRows = {
    features: [{
      attributes: {
        ENTITY_ID: 26,
        NAME: "Alcoholic Beverage and Cannabis Administration",
        SHORT_NAME: "Alcoholic Beverage and Cannabis Administration",
        ACRONYM: null,
        GOVERNING_AGENCY: "Alcoholic Beverage and Cannabis Administration",
        ADDRESS: null,
        TYPE: "Board",
        WEB_URL: "https://abca.dc.gov/page/abc-board",
        AUTHORIZING_ORDER_LAW: "D.C. Code § 25-201",
        CLUSTER_DC: null,
      },
    }],
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(dcgisRowsFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(bccRows);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("dcgis.boards_commissions_councils").run(
      createConnectorContext({ fetcher }),
    ),
    dataDir,
  );

  const candidate = workbench.db.prepare(
    `select proposed_entity_id as proposedEntityId,
            name,
            kind,
            review_status as reviewStatus
       from entity_candidates
      where candidate_id = ?`,
  ).get("candidate.dcgis.boards_commissions_councils.26") as {
    proposedEntityId: string;
    name: string;
    kind: string;
    reviewStatus: string;
  } | undefined;
  const item = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix: "candidate.dcgis.boards_commissions_councils.26",
  })[0];
  workbench.close();

  assertEquals(candidate?.proposedEntityId, "dc.alcoholic_beverage_and_cannabis_board");
  assertEquals(candidate?.name, "Alcoholic Beverage and Cannabis Board");
  assertEquals(candidate?.kind, "board");
  assertEquals(candidate?.reviewStatus, "accepted");
  assertEquals(item, undefined);
});

Deno.test("interactive review Enter accepts the default action for an explicit entity decision", async () => {
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
      needsReview: true,
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
  await writer.write(new TextEncoder().encode("\n\nq\n"));
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

Deno.test("interactive review explains available actions after an unavailable action", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_cli.invalid_action",
      candidateId: "candidate.test.review_cli.invalid_action.board_accountancy",
      sourceItemKey: "review-cli-invalid-action-board-accountancy",
      proposedEntityId: "dc.board_of_accountancy",
      name: "Board of Accountancy",
      kind: "board",
      observedName: "Board of Accountancy",
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
  await writer.write(new TextEncoder().encode("\nx\na\nq\n"));
  await writer.close();
  const output = await reviewProcess.output();
  const stdout = new TextDecoder().decode(output.stdout);

  assertEquals(output.code, 0);
  assertStringIncludes(
    stdout,
    "That action is not available. Use Enter accept, a accept, r reject, m merge, d defer, or q quit.",
  );
  assertStringIncludes(stdout, "Saved resolution.");
});

Deno.test("interactive review sends plain source-backed additions to browse surfaces", async () => {
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
    "No human decisions remain. Browse 2 unresolved review item(s) with deno task dc -- review list --mode entities or deno task dc -- review packets --mode entities.",
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
  await writer.write(new TextEncoder().encode("\n\nq\n"));
  await writer.close();
  const output = await reviewProcess.output();
  const stdout = new TextDecoder().decode(output.stdout);

  assertEquals(output.code, 0);
  assertStringIncludes(stdout, "Decision inbox");
  assertStringIncludes(stdout, "Open items in this slice: 2");
  assertStringIncludes(stdout, "Choose a packet by the decision it will put in front of you:");
  assertStringIncludes(
    stdout,
    "1. [recommended] Alt Agency - test.review_cli.inbox overseen_by [default defer; packet 1 open]",
  );
  assertStringIncludes(
    stdout,
    "2. Target Agency - test.review_cli.inbox overseen_by [default defer; packet 1 open]",
  );
});

Deno.test("interactive review gives deferred relationship packets packet-level inbox titles", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(
    workbench,
    "dc.behavioral_health_planning_council",
    "Behavioral Health Planning Council",
    "council",
  );
  seedAcceptedEntity(
    workbench,
    "dc.health_literacy_council",
    "Health Literacy Council",
    "council",
  );
  seedAcceptedEntity(workbench, "dc.department_of_buildings", "Department of Buildings", "agency");
  seedAcceptedEntity(workbench, "dc.committee_on_health", "Committee on Health", "committee");
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.review_cli.defer_packets.health_named.one",
      sourceItemKey: "review-cli-defer-health-named-one",
      fromEntityRef: "dc.behavioral_health_planning_council",
      toEntityRef: "dc.committee_on_health",
      relationshipType: "overseen_by",
      rawValue: "Behavioral Health Planning Council",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.review_cli.defer_packets.health_named.two",
      sourceItemKey: "review-cli-defer-health-named-two",
      fromEntityRef: "dc.health_literacy_council",
      toEntityRef: "dc.committee_on_health",
      relationshipType: "overseen_by",
      rawValue: "Health Literacy Council",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.review_cli.defer_packets.health_scoped",
      sourceItemKey: "review-cli-defer-health-scoped",
      fromEntityRef: "dc.department_of_buildings",
      toEntityRef: "dc.committee_on_health",
      relationshipType: "overseen_by",
      rawValue: "Department of Buildings (excluding construction codes)",
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
  assertStringIncludes(stdout, "Decision inbox");
  assertStringIncludes(
    stdout,
    "1. [recommended] Committee on Health exclusion oversight - council.committees overseen_by [default defer; packet 1 open]",
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
      needsReview: true,
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
  await writer.write(new TextEncoder().encode("\n\nq\n"));
  await writer.close();
  const output = await reviewProcess.output();
  const stdout = new TextDecoder().decode(output.stdout);

  assertEquals(output.code, 0);
  assertStringIncludes(
    stdout,
    "1. [recommended] Unblocking Agency - test.review_cli.graph_priority entity candidate [default accept; packet 1 open; unblocks 1]",
  );
  assertStringIncludes(stdout, "Decision impact: unblocks 1 blocked relationship.");
  assertStringIncludes(stdout, "Review: Unblocking Agency");
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
  await writer.write(new TextEncoder().encode("\n\nq\n"));
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
      needsReview: true,
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
  await writer.write(new TextEncoder().encode("\n\nq\n"));
  await writer.close();
  const output = await reviewProcess.output();
  const stdout = new TextDecoder().decode(output.stdout);

  assertEquals(output.code, 0);
  assertStringIncludes(
    stdout,
    "1. [recommended] Open Priority Target - zzz.open_priority entity candidate [default accept; packet 1 open; unblocks 1]",
  );
  assertStringIncludes(stdout, "Decision impact: unblocks 1 blocked relationship.");
  assertStringIncludes(stdout, "Review: Open Priority Target");
  assertEquals(stdout.includes("Review: Deferred First Alphabetically"), false);
});

Deno.test("interactive decision inbox ranks smaller high-impact packets ahead of larger low-impact packets", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "aaa.low_impact",
      candidateId: "candidate.aaa.low_impact.one",
      sourceItemKey: "aaa-low-impact-one",
      proposedEntityId: "dc.aaa_low_impact_one",
      name: "Aaa Low Impact One",
      kind: "board",
      observedName: "Aaa Low Impact One",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "aaa.low_impact",
      candidateId: "candidate.aaa.low_impact.two",
      sourceItemKey: "aaa-low-impact-two",
      proposedEntityId: "dc.aaa_low_impact_two",
      name: "Aaa Low Impact Two",
      kind: "board",
      observedName: "Aaa Low Impact Two",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "zzz.high_impact",
      candidateId: "candidate.zzz.high_impact.target",
      sourceItemKey: "zzz-high-impact-target",
      proposedEntityId: "dc.zzz_high_impact_target",
      name: "Zzz High Impact Target",
      kind: "agency",
      observedName: "Zzz High Impact Target",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "zzz.high_impact",
      relationshipCandidateId: "relationship.zzz.high_impact.blocked",
      sourceItemKey: "zzz-high-impact-blocked-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.zzz_high_impact_target",
      relationshipType: "overseen_by",
      rawValue: "Zzz High Impact Target",
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
  assert(
    stdout.indexOf("1. [recommended] Zzz High Impact Target") <
      stdout.indexOf("2. Aaa Low Impact One"),
  );
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
      needsReview: true,
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
      needsReview: true,
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
  await writer.write(new TextEncoder().encode("\n\nq\n"));
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
  await writer.write(new TextEncoder().encode("\nq\n"));
  await writer.close();
  const reviewOutput = await reviewProcess.output();
  const reviewText = new TextDecoder().decode(reviewOutput.stdout);

  assertEquals(reviewOutput.code, 0);
  assertStringIncludes(
    reviewText,
    "Resume with deno task dc -- review relationships --subject-prefix relationship.test.review_cli.quoted_resume --relationship-type overseen_by --raw-value-contains 'Committee on Health'\\''s Work'.",
  );
});

Deno.test("interactive review browse commands preserve source filters for plain additions", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_cli.source_resume",
      candidateId: "candidate.test.review_cli.source_resume.board",
      sourceItemKey: "review-cli-source-resume-row",
      proposedEntityId: "dc.source_resume_board",
      name: "Source Resume Board",
      kind: "board",
      observedName: "Source Resume Board",
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
      "--source",
      "test.review_cli.source_resume",
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
    "No human decisions remain. Browse 1 unresolved review item(s) with deno task dc -- review list --source test.review_cli.source_resume or deno task dc -- review packets --source test.review_cli.source_resume.",
  );
});

Deno.test("interactive review points to audit when only blocked reconciliation remains", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_cli.blocked_only",
      relationshipCandidateId: "relationship.test.review_cli.blocked_only.governed_by",
      sourceItemKey: "review-cli-blocked-only-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.missing_agency",
      relationshipType: "governed_by",
      rawValue: "Missing Agency",
      needsReview: false,
    }),
    dataDir,
  );
  workbench.close();

  const reviewOutput = await new Deno.Command(Deno.execPath(), {
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
      "--source",
      "test.review_cli.blocked_only",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const reviewText = new TextDecoder().decode(reviewOutput.stdout);

  assertEquals(reviewOutput.code, 0);
  assertStringIncludes(
    reviewText,
    "No direct review decisions remain. 1 blocked reconciliation item remains.",
  );
  assertStringIncludes(
    reviewText,
    "First blocked: Missing Agency [governed_by from test.review_cli.blocked_only]",
  );
  assertStringIncludes(reviewText, "Inspect blocked dependencies with deno task dc -- audit.");
  assertEquals(reviewText.includes("No review items remain."), false);
});

Deno.test("interactive relationship review reports filtered blocked reconciliation", async () => {
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
  assertStringIncludes(
    reviewText,
    "No direct review decisions remain. 2 blocked reconciliation items remain.",
  );
  assertStringIncludes(reviewText, "First blocked:");
  assertStringIncludes(reviewText, "[governed_by from open_dc.public_bodies]");
  assertStringIncludes(reviewText, "Inspect blocked dependencies with deno task dc -- audit.");
});

Deno.test("interactive review auto-accepts accepted-endpoint additive relationships before rendering", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(
    workbench,
    "dc.superior_court_of_the_district_of_columbia",
    "Superior Court of the District of Columbia",
    "court",
  );
  seedAcceptedEntity(
    workbench,
    "dc.district_of_columbia_courts",
    "District of Columbia Courts",
    "court_system",
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "dccourts.structure",
      relationshipCandidateId: "relationship.test.review_cli.auto_accept.dccourts.part_of",
      sourceItemKey: "review-cli-auto-accept-dccourts-row",
      fromEntityRef: "dc.superior_court_of_the_district_of_columbia",
      toEntityRef: "dc.district_of_columbia_courts",
      relationshipType: "part_of",
      rawValue: "Superior Court -> DC Courts",
      needsReview: true,
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
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.test.review_cli.auto_accept.dccourts",
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
  assertEquals(reviewText.includes("Decision inbox"), false);
});

Deno.test("interactive review does not resurface a deferred item in the same session", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.cli_defer",
      "Mystery legal authority",
      "https://example.com/mystery-legal-authority",
    ),
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
      "legal",
      "--subject-prefix",
      "legal.test.signature.legal_refs.cli_defer",
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
  await writer.write(new TextEncoder().encode("\n\n"));
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
    subjectPrefix: "legal.test.signature.legal_refs.cli_defer",
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
