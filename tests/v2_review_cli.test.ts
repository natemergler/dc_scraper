import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { Workbench } from "../src/v2/workbench.ts";
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
