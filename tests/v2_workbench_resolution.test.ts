import { assertEquals, assertRejects } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
  openDcBoardFixture,
  openDcIndexFixture,
  openDcTaskForceFixture,
} from "./helpers/v2_fixtures.ts";

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
