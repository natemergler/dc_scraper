import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
  quickbaseAppointmentsCsvFixture,
  quickbaseFixture,
} from "./helpers/v2_fixtures.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("entity show review context explains deferred relationship candidates", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name, kind] of [
      ["dc.council_of_the_district_of_columbia", "Council of the District of Columbia", "council"],
      ["dc.committee_of_the_whole", "Committee of the Whole", "committee"],
      [
        "dc.office_of_the_chief_financial_officer",
        "Office of the Chief Financial Officer",
        "agency",
      ],
    ]
  ) {
    workbench.db.prepare(
      "insert or ignore into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name, kind);
  }
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture.replace(
            "</ul>",
            "<li>Council of the District of Columbia</li><li>Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)</li></ul>",
          );
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

  const councilView = workbench.entityView("dc.council_of_the_district_of_columbia");
  const circularReview = councilView.reviewItems.find((item) =>
    item.subjectId === "relationship.council.committees.committee_of_the_whole_oversight_3"
  );
  const acceptedCircularRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.council_of_the_district_of_columbia:overseen_by:dc.committee_of_the_whole'`,
  ).get() as { relationshipId: string } | undefined;
  const ocfoView = workbench.entityView("dc.office_of_the_chief_financial_officer");
  const exclusionReview = ocfoView.reviewItems.find((item) =>
    item.subjectId === "relationship.council.committees.committee_of_the_whole_oversight_4"
  );
  workbench.close();

  assertEquals(circularReview, undefined);
  assertEquals(
    acceptedCircularRelationship?.relationshipId,
    "dc.council_of_the_district_of_columbia:overseen_by:dc.committee_of_the_whole",
  );
  assertEquals(exclusionReview?.defaultAction, "defer");
  assertEquals(
    exclusionReview?.subject?.rawValue,
    "Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)",
  );
  assertEquals(
    exclusionReview?.details.whyDeferred,
    "Oversight text uses exclusion wording, so the compact edge needs a human decision.",
  );

  const entityShowOutput = await new Deno.Command(Deno.execPath(), {
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
      "dc.office_of_the_chief_financial_officer",
      "--db",
      dbPath,
    ],
  }).output();
  const entityShowText = new TextDecoder().decode(entityShowOutput.stdout);
  assertEquals(entityShowOutput.code, 0);
  assertStringIncludes(entityShowText, "open_review:");
  assertStringIncludes(
    entityShowText,
    "source: council.committees / Committee of the Whole oversight detail",
  );
  assertStringIncludes(
    entityShowText,
    "relationship: dc.office_of_the_chief_financial_officer --overseen_by--> dc.committee_of_the_whole",
  );
  assertStringIncludes(
    entityShowText,
    "raw value: Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)",
  );
  assertStringIncludes(
    entityShowText,
    "why: Oversight text uses exclusion wording, so the compact edge needs a human decision.",
  );
  assertStringIncludes(
    entityShowText,
    "review: deno task dc -- review relationships --source council.committees --subject-prefix relationship.council.committees.committee_of_the_whole_oversight_4",
  );
  const entityShowJsonOutput = await new Deno.Command(Deno.execPath(), {
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
      "dc.office_of_the_chief_financial_officer",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const entityShowJson = JSON.parse(new TextDecoder().decode(entityShowJsonOutput.stdout)) as {
    reviewItems: Array<{ subjectId: string; reviewCommand?: string }>;
  };
  assertEquals(entityShowJsonOutput.code, 0);
  assertEquals(
    entityShowJson.reviewItems.find((item) =>
      item.subjectId === "relationship.council.committees.committee_of_the_whole_oversight_4"
    )?.reviewCommand,
    `deno task dc -- review relationships --source council.committees --subject-prefix relationship.council.committees.committee_of_the_whole_oversight_4 --db ${dbPath}`,
  );
});

Deno.test("blocked relationships enter the live review order as unresolved symbols", async () => {
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
  assert(
    items.some((item) =>
      item.conflictKind === "unresolved_symbol" && blockedSubjectIds.has(item.subjectId)
    ),
  );
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
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.corrections_information_council', 'Corrections Information Council', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.review_list_oversight",
      sourceItemKey: "review-list-oversight-row",
      fromEntityRef: "dc.corrections_information_council",
      toEntityRef: "dc.council_of_the_district_of_columbia",
      relationshipType: "overseen_by",
      rawValue: "Corrections Information Council (excluding archived records)",
      needsReview: true,
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
  assertStringIncludes(text, "Browse rows:");
  assertStringIncludes(text, "[open browse] Review List Entity");
  assertStringIncludes(text, "entity candidate | board | default accept");
  assertStringIncludes(text, "source: test.review_list.entities / Custom entity row");
  assertStringIncludes(
    text,
    "ids: subject=candidate.test.review_list.entities.example",
  );
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
    decisionCount: number;
    browseCount: number;
    items: Array<{
      itemType: string;
      subjectId: string;
      summary: string;
      workKind: string;
      humanDecision: boolean;
    }>;
  };
  assertEquals(jsonOutput.code, 0);
  assertEquals(json.count, json.items.length);
  assertEquals(json.decisionCount, 0);
  assertEquals(json.browseCount, json.items.length);
  assert(json.items.every((item) => item.itemType === "entity_candidate"));
  assert(json.items.every((item) => item.subjectId.startsWith("candidate.test.review_list")));
  assertStringIncludes(json.items[0]?.summary ?? "", "[open browse] Review List Entity");
  assertStringIncludes(
    json.items[0]?.summary ?? "",
    "source: test.review_list.entities / Custom entity row",
  );
  assert(json.items.every((item) => item.workKind === "browse"));
  assert(json.items.every((item) => item.humanDecision === false));

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
      "relationship.council.committees.review_list_oversight",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const relationshipTypeJson = JSON.parse(
    new TextDecoder().decode(relationshipTypeJsonOutput.stdout),
  ) as {
    count: number;
    decisionCount: number;
    browseCount: number;
    items: Array<{
      itemType: string;
      subjectId: string;
      workKind: string;
      humanDecision: boolean;
      details: { relationshipType: string };
    }>;
  };
  assertEquals(relationshipTypeJsonOutput.code, 0);
  assert(relationshipTypeJson.count > 0);
  assertEquals(relationshipTypeJson.decisionCount, relationshipTypeJson.items.length);
  assertEquals(relationshipTypeJson.browseCount, 0);
  assert(
    relationshipTypeJson.items.every((item) =>
      item.itemType === "relationship_candidate" &&
      item.subjectId.startsWith("relationship.council.committees.review_list_oversight") &&
      item.details.relationshipType === "overseen_by" &&
      item.workKind === "decision" &&
      item.humanDecision === true
    ),
  );

  const decisionsJsonOutput = await new Deno.Command(Deno.execPath(), {
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
      "open",
      "--subject-prefix",
      "review_list",
      "--decisions",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const decisionsJson = JSON.parse(new TextDecoder().decode(decisionsJsonOutput.stdout)) as {
    count: number;
    decisionCount: number;
    browseCount: number;
    nextCommand?: string;
    items: Array<{
      subjectId: string;
      workKind: string;
      humanDecision: boolean;
      reviewCommand?: string;
    }>;
  };
  assertEquals(decisionsJsonOutput.code, 0);
  assertEquals(decisionsJson.count, 1);
  assertEquals(decisionsJson.decisionCount, 1);
  assertEquals(decisionsJson.browseCount, 0);
  assertEquals(
    decisionsJson.nextCommand,
    `deno task dc -- review relationships --source council.committees --subject-prefix relationship.council.committees.review_list_oversight --db ${dbPath}`,
  );
  assertEquals(
    decisionsJson.items[0]?.subjectId,
    "relationship.council.committees.review_list_oversight",
  );
  assertEquals(decisionsJson.items[0]?.workKind, "decision");
  assertEquals(decisionsJson.items[0]?.humanDecision, true);
  assertEquals(
    decisionsJson.items[0]?.reviewCommand,
    `deno task dc -- review relationships --source council.committees --subject-prefix relationship.council.committees.review_list_oversight --db ${dbPath}`,
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
      "relationship.council.committees.review_list_oversight",
      "--raw-value-contains",
      "Corrections",
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
  assertEquals(rawValueContainsJson.count, 1);
  assert(
    rawValueContainsJson.items.every((item) =>
      item.details.relationshipType === "overseen_by" &&
      item.details.rawValue.includes("Corrections")
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
      "entities",
      "--status",
      "open",
      "--type",
      "entity_candidate",
      "--subject-prefix",
      "candidate.test.review_list",
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

  const sourcePacketJsonOutput = await new Deno.Command(Deno.execPath(), {
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
      "packets",
      "--source",
      "council.committees",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const sourcePacketJson = JSON.parse(
    new TextDecoder().decode(sourcePacketJsonOutput.stdout),
  ) as { count: number; packets: Array<{ sourceId: string; summary: string }> };
  assertEquals(sourcePacketJsonOutput.code, 0);
  assert(sourcePacketJson.count > 0);
  assert(sourcePacketJson.packets.every((packet) => packet.sourceId === "council.committees"));
  assertStringIncludes(sourcePacketJson.packets[0]?.summary ?? "", "council.committees");
  assertStringIncludes(sourcePacketJson.packets[0]?.summary ?? "", "review:");
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
