import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import {
  buildReviewItemId,
  type ConnectorResult,
  type RelationshipType,
} from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
  dcgisMetadataFixture,
  dcgisRowsFixture,
  quickbaseAppointmentsCsvFixture,
  quickbaseFixture,
} from "./helpers/v2_fixtures.ts";

Deno.test("quickbase relationship candidates with unresolved endpoints are blocked after import", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
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
    await getConnector("mota.quickbase").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const relationshipCandidates = workbench.db.prepare(
    "select count(*) as count from relationship_candidates where review_status = 'pending'",
  ).get() as { count: number };
  const relationshipReviewItems = workbench.listReviewItems({ mode: "relationships" });
  const blockedItems = workbench.db.prepare(
    `select subject_id as subjectId,
            state,
            reason,
            details_json as detailsJson
     from reconciliation_items
     where subject_type = 'relationship_candidate'
     order by subject_id`,
  ).all() as Array<{ subjectId: string; state: string; reason: string; detailsJson: string }>;
  workbench.close();

  assertEquals(relationshipCandidates.count > 0, true);
  assertEquals(relationshipReviewItems.length, 0);
  assert(blockedItems.length > 0);
  assertEquals(
    blockedItems.some((item) =>
      item.subjectId ===
        "relationship.mota.quickbase.district_of_columbia_rental_housing_commission_governed_by_office_of_housing_and_community_development_designee" &&
      item.state === "blocked" &&
      item.reason === "unresolved_endpoints"
    ),
    true,
  );
});

Deno.test("accepting a prerequisite entity reprocesses blocked relationships into review-ready work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
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

  const before = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "part_of",
    subjectPrefix: "relationship.council.committees",
  });
  const blockedBefore = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.council.committees.committee_of_the_whole_part_of'
       and state = 'blocked'`,
  ).get() as { count: number };

  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.council.committees.committee_of_the_whole",
      payload: {},
    },
    resolutionsDir,
  );

  const after = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "part_of",
    subjectPrefix: "relationship.council.committees",
  });
  const blockedAfter = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.council.committees.committee_of_the_whole_part_of'
       and state = 'blocked'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(before.length, 0);
  assertEquals(blockedBefore.count, 1);
  assert(
    after.some((item) =>
      item.subjectId === "relationship.council.committees.committee_of_the_whole_part_of"
    ),
  );
  assertEquals(blockedAfter.count, 0);
});

Deno.test("merging a prerequisite entity candidate reprocesses blocked relationships into review-ready work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.source_board', 'Source Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.reprocess.merge.relationships",
      relationshipCandidateId: "relationship.test.reprocess.merge",
      sourceItemKey: "merge-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.merged_target",
      relationshipType: "governed_by",
      rawValue: "Merged Target",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reprocess.merge.entities",
      candidateId: "candidate.test.reprocess.merge",
      sourceItemKey: "merge-entity-row",
      proposedEntityId: "dc.unmerged_target",
      name: "Merged Target",
      kind: "agency",
      observedName: "Merged Target",
    }),
    dataDir,
  );

  const before = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reprocess",
  });
  const blockedBefore = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reprocess.merge'
       and state = 'blocked'`,
  ).get() as { count: number };

  await workbench.appendResolutionEvent(
    {
      eventType: "merge_entity_candidates",
      subjectId: "candidate.test.reprocess.merge",
      payload: {
        entityId: "dc.merged_target",
        candidateIds: ["candidate.test.reprocess.merge"],
      },
    },
    resolutionsDir,
  );

  const after = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reprocess",
  });
  const blockedAfter = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reprocess.merge'
       and state = 'blocked'`,
  ).get() as { count: number };
  const mergedTarget = workbench.db.prepare(
    "select review_status as reviewStatus from canonical_entities where entity_id = 'dc.merged_target'",
  ).get() as { reviewStatus: string };
  workbench.close();

  assertEquals(before.length, 0);
  assertEquals(blockedBefore.count, 1);
  assertEquals(mergedTarget.reviewStatus, "accepted");
  assert(
    after.some((item) => item.subjectId === "relationship.test.reprocess.merge"),
  );
  assertEquals(blockedAfter.count, 0);
});

Deno.test("relationship review items are rebuilt from workbench state without connector templates", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
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

  const result = await getConnector("council.committees").run(createConnectorContext({ fetcher }));
  for (const endpointResult of result.endpointResults) {
    if (!endpointResult.parsed?.reviewItems) continue;
    endpointResult.parsed.reviewItems = endpointResult.parsed.reviewItems.filter((item) =>
      item.itemType !== "relationship_candidate"
    );
  }

  await workbench.importConnectorResult(result, dataDir);
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.council.committees.committee_of_the_whole",
      payload: {},
    },
    resolutionsDir,
  );

  const item = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "part_of",
    subjectPrefix: "relationship.council.committees",
  }).find((reviewItem) =>
    reviewItem.subjectId === "relationship.council.committees.committee_of_the_whole_part_of"
  );
  workbench.close();

  assert(item);
  assertEquals(item.reason, "Review committee to Council relationship");
  assertEquals(item.defaultAction, "accept");
  assertEquals(item.details.relationshipType, "part_of");
  assertEquals(item.details.fromEntityRef, "dc.committee_of_the_whole");
  assertEquals(item.details.toEntityRef, "dc.council_of_the_district_of_columbia");
});

Deno.test("blocked relationship acceptance fails instead of creating placeholder entities", async () => {
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

  const placeholder = workbench.db.prepare(
    "select count(*) as count from canonical_entities where is_placeholder = 1",
  ).get() as { count: number };
  workbench.close();

  assertEquals(placeholder.count, 0);
});

Deno.test("placeholder endpoints keep relationship candidates blocked until the placeholder is resolved", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'placeholder', 'placeholder', '[]', 1, 'fixture placeholder', datetime('now'), datetime('now'))",
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
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.council.committees.committee_of_the_whole",
      payload: {},
    },
    resolutionsDir,
  );

  const blockedBefore = workbench.db.prepare(
    `select details_json as detailsJson
     from reconciliation_items
     where subject_id = 'relationship.council.committees.committee_of_the_whole_part_of'
       and state = 'blocked'`,
  ).get() as { detailsJson: string } | undefined;
  const reviewBefore = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "part_of",
    subjectPrefix: "relationship.council.committees",
  });

  workbench.db.prepare(
    "update canonical_entities set name = 'Council of the District of Columbia', kind = 'council', review_status = 'accepted', is_placeholder = 0, placeholder_reason = null, updated_at = datetime('now') where entity_id = 'dc.council_of_the_district_of_columbia'",
  ).run();
  workbench.init();

  const blockedAfter = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.council.committees.committee_of_the_whole_part_of'
       and state = 'blocked'`,
  ).get() as { count: number };
  const reviewAfter = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "part_of",
    subjectPrefix: "relationship.council.committees",
  });
  workbench.close();

  assert(blockedBefore);
  assertStringIncludes(blockedBefore.detailsJson, '"state":"placeholder"');
  assertEquals(reviewBefore.length, 0);
  assertEquals(blockedAfter.count, 0);
  assert(
    reviewAfter.some((item) =>
      item.subjectId === "relationship.council.committees.committee_of_the_whole_part_of"
    ),
  );
});

Deno.test("relationship review defaults are rebuilt from workbench state without connector relationship review items", async () => {
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

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
          return JSON.stringify(mixedBranchRowsFixture);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return dcgisMetadataFixture as T;
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
          return mixedBranchRowsFixture as T;
        default:
          throw new Error(`Unexpected url ${url}`) as T;
      }
    },
  });

  const result = await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher }));
  const parsed = result.endpointResults[0]?.parsed;
  if (!parsed) throw new Error("Expected parsed DCGIS output");
  parsed.reviewItems = (parsed.reviewItems ?? []).filter((item) =>
    item.itemType !== "relationship_candidate"
  );

  await workbench.importConnectorResult(result, dataDir);
  for (const item of workbench.listReviewItems({ mode: "entities" })) {
    await workbench.appendResolutionEvent(
      {
        eventType: "accept_entity_candidate",
        subjectId: item.subjectId,
        payload: {},
      },
      resolutionsDir,
    );
  }

  const items = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "part_of",
    subjectPrefix: "relationship.dcgis.agencies",
  });
  const executiveItem = items.find((item) => item.details.rawValue === "Executive");
  const otherItem = items.find((item) => item.details.rawValue === "Other");
  workbench.close();

  assertEquals(executiveItem?.reason, "Review agency relationship inferred from branch metadata");
  assertEquals(executiveItem?.defaultAction, "accept");
  assertEquals(otherItem?.defaultAction, "defer");
});

Deno.test("accepted entity decisions are reused across refetch when candidate ids change", async () => {
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
    syntheticEntitySourceResult("candidate.test.signature.entities.example_v2", "Example Body"),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = 'candidate.test.signature.entities.example_v1'",
  ).get() as { payloadJson: string };
  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = 'candidate.test.signature.entities.example_v2'",
  ).get() as { reviewStatus: string };
  const canonical = workbench.db.prepare(
    "select merged_candidate_ids as mergedCandidateIds from canonical_entities where entity_id = 'dc.example_body'",
  ).get() as { mergedCandidateIds: string };
  const openItems = workbench.listReviewItems({ mode: "entities", status: "open" });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(payload.fact_signature ?? "", "entity_candidate:test.signature.entities");
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(secondCandidate.reviewStatus, "accepted");
  assertEquals(openItems.length, 0);
  assertEquals(
    JSON.parse(canonical.mergedCandidateIds) as string[],
    [
      "candidate.test.signature.entities.example_v1",
      "candidate.test.signature.entities.example_v2",
    ],
  );
});

Deno.test("changed entity evidence after a prior accept becomes stale review work instead of silent reuse", async () => {
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

  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = 'candidate.test.signature.entities.example_v2'",
  ).get() as { reviewStatus: string };
  const staleItem = workbench.listReviewItems({
    mode: "entities",
    status: "open",
  }).find((item) => item.subjectId === "candidate.test.signature.entities.example_v2");
  workbench.close();

  assertEquals(secondCandidate.reviewStatus, "pending");
  assert(staleItem);
  assertEquals(staleItem.details.priorDecisionState, "accepted");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior accepted decision");
});

Deno.test("deferred entity review decisions are reused across refetch when candidate ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstCandidateId = "candidate.test.signature.entities.example_defer_v1";
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(firstCandidateId, "Example Body"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(firstCandidateId, "entity-review"),
      payload: {},
    },
    resolutionsDir,
  );

  const secondCandidateId = "candidate.test.signature.entities.example_defer_v2";
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(secondCandidateId, "Example Body"),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = ?",
  ).get(buildReviewItemId(firstCandidateId, "entity-review")) as { payloadJson: string };
  const deferredItems = workbench.listReviewItems({
    mode: "entities",
    status: "deferred",
  });
  const openItems = workbench.listReviewItems({
    mode: "entities",
    status: "open",
  });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(payload.fact_signature ?? "", "entity_candidate:test.signature.entities");
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(
    deferredItems.some((item) => item.subjectId === secondCandidateId),
    true,
  );
  assertEquals(deferredItems.length, 1);
  assertEquals(openItems.length, 0);
});

Deno.test("changed entity evidence after a prior defer becomes stale open review work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstCandidateId = "candidate.test.signature.entities.example_defer_v1";
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(firstCandidateId, "Example Body"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(firstCandidateId, "entity-review"),
      payload: {},
    },
    resolutionsDir,
  );

  const secondCandidateId = "candidate.test.signature.entities.example_defer_v2";
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(secondCandidateId, "Example Body (Updated Source Text)"),
    dataDir,
  );

  const staleItem = workbench.listReviewItems({
    mode: "entities",
    status: "open",
  }).find((item) => item.subjectId === secondCandidateId);
  const deferredItems = workbench.listReviewItems({
    mode: "entities",
    status: "deferred",
  });
  workbench.close();

  assert(staleItem);
  assertEquals(staleItem.status, "open");
  assertEquals(staleItem.details.priorDecisionState, "deferred");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior deferred decision");
  assertEquals(deferredItems.length, 0);
});

Deno.test("accepted legal ref decisions are reused across refetch when legal ref ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.code_v1",
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_legal_ref",
      subjectId: "legal.test.signature.legal_refs.code_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.code_v2",
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = 'legal.test.signature.legal_refs.code_v1'",
  ).get() as { payloadJson: string };
  const secondLegalRef = workbench.db.prepare(
    "select review_status as reviewStatus from legal_refs where legal_ref_id = 'legal.test.signature.legal_refs.code_v2'",
  ).get() as { reviewStatus: string };
  const openItems = workbench.listReviewItems({ mode: "legal", status: "open" });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(payload.fact_signature ?? "", "legal_ref:test.signature.legal_refs");
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(secondLegalRef.reviewStatus, "accepted");
  assertEquals(openItems.length, 0);
});

Deno.test("changed legal ref evidence after a prior accept becomes stale review work instead of silent reuse", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.code_v1",
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_legal_ref",
      subjectId: "legal.test.signature.legal_refs.code_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.code_v2",
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22?changed=1",
    ),
    dataDir,
  );

  const secondLegalRef = workbench.db.prepare(
    "select review_status as reviewStatus from legal_refs where legal_ref_id = 'legal.test.signature.legal_refs.code_v2'",
  ).get() as { reviewStatus: string };
  const staleItem = workbench.listReviewItems({
    mode: "legal",
    status: "open",
  }).find((item) => item.subjectId === "legal.test.signature.legal_refs.code_v2");
  workbench.close();

  assertEquals(secondLegalRef.reviewStatus, "pending");
  assert(staleItem);
  assertEquals(staleItem.details.priorDecisionState, "accepted");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior accepted decision");
});

Deno.test("deferred legal ref review decisions are reused across refetch when legal ref ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstLegalRefId = "legal.test.signature.legal_refs.code_defer_v1";
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      firstLegalRefId,
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(firstLegalRefId, "legal-ref"),
      payload: {},
    },
    resolutionsDir,
  );

  const secondLegalRefId = "legal.test.signature.legal_refs.code_defer_v2";
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      secondLegalRefId,
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = ?",
  ).get(buildReviewItemId(firstLegalRefId, "legal-ref")) as { payloadJson: string };
  const deferredItems = workbench.listReviewItems({
    mode: "legal",
    status: "deferred",
  });
  const openItems = workbench.listReviewItems({
    mode: "legal",
    status: "open",
  });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(payload.fact_signature ?? "", "legal_ref:test.signature.legal_refs");
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(
    deferredItems.some((item) => item.subjectId === secondLegalRefId),
    true,
  );
  assertEquals(deferredItems.length, 1);
  assertEquals(openItems.length, 0);
});

Deno.test("changed legal ref evidence after a prior defer becomes stale open review work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstLegalRefId = "legal.test.signature.legal_refs.code_defer_v1";
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      firstLegalRefId,
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(firstLegalRefId, "legal-ref"),
      payload: {},
    },
    resolutionsDir,
  );

  const secondLegalRefId = "legal.test.signature.legal_refs.code_defer_v2";
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      secondLegalRefId,
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22?changed=1",
    ),
    dataDir,
  );

  const staleItem = workbench.listReviewItems({
    mode: "legal",
    status: "open",
  }).find((item) => item.subjectId === secondLegalRefId);
  const deferredItems = workbench.listReviewItems({
    mode: "legal",
    status: "deferred",
  });
  workbench.close();

  assert(staleItem);
  assertEquals(staleItem.status, "open");
  assertEquals(staleItem.details.priorDecisionState, "deferred");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior deferred decision");
  assertEquals(deferredItems.length, 0);
});

Deno.test("accepted relationship decisions are reused across refetch when relationship candidate ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_v1",
      "Target Agency",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId:
        "relationship.test.signature.relationships.source_board_governed_by_target_agency_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_v2",
      "Target Agency",
    ),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = 'relationship.test.signature.relationships.source_board_governed_by_target_agency_v1'",
  ).get() as { payloadJson: string };
  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from relationship_candidates where relationship_candidate_id = 'relationship.test.signature.relationships.source_board_governed_by_target_agency_v2'",
  ).get() as { reviewStatus: string };
  const relationshipCount = workbench.db.prepare(
    "select count(*) as count from canonical_relationships where relationship_id = 'dc.source_board:governed_by:dc.target_agency'",
  ).get() as { count: number };
  const openItems = workbench.listReviewItems({ mode: "relationships", status: "open" });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(
    payload.fact_signature ?? "",
    "relationship_candidate:test.signature.relationships",
  );
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(secondCandidate.reviewStatus, "accepted");
  assertEquals(relationshipCount.count, 1);
  assertEquals(openItems.length, 0);
});

Deno.test("rejected relationship decisions are reused across refetch when relationship candidate ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v1",
      "Target Agency",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "reject_relationship_candidate",
      subjectId:
        "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v2",
      "Target Agency",
    ),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = 'relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v1'",
  ).get() as { payloadJson: string };
  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from relationship_candidates where relationship_candidate_id = 'relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v2'",
  ).get() as { reviewStatus: string };
  const relationshipCount = workbench.db.prepare(
    "select count(*) as count from canonical_relationships where relationship_id = 'dc.source_board:governed_by:dc.target_agency'",
  ).get() as { count: number };
  const openItems = workbench.listReviewItems({ mode: "relationships", status: "open" });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(
    payload.fact_signature ?? "",
    "relationship_candidate:test.signature.relationships",
  );
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(secondCandidate.reviewStatus, "rejected");
  assertEquals(relationshipCount.count, 0);
  assertEquals(openItems.length, 0);
});

Deno.test("changed relationship evidence after a prior accept becomes stale review work instead of silent reuse", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_v1",
      "Target Agency",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId:
        "relationship.test.signature.relationships.source_board_governed_by_target_agency_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_v2",
      "Target Agency (Updated Source Text)",
    ),
    dataDir,
  );

  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from relationship_candidates where relationship_candidate_id = 'relationship.test.signature.relationships.source_board_governed_by_target_agency_v2'",
  ).get() as { reviewStatus: string };
  const staleItem = workbench.listReviewItems({
    mode: "relationships",
    status: "open",
  }).find((item) =>
    item.subjectId ===
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_v2"
  );
  workbench.close();

  assertEquals(secondCandidate.reviewStatus, "pending");
  assert(staleItem);
  assertEquals(staleItem.details.priorDecisionState, "accepted");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior accepted decision");
});

Deno.test("changed relationship evidence after a prior reject becomes stale review work instead of silent reuse", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v1",
      "Target Agency",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "reject_relationship_candidate",
      subjectId:
        "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v2",
      "Target Agency (Updated Source Text)",
    ),
    dataDir,
  );

  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from relationship_candidates where relationship_candidate_id = 'relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v2'",
  ).get() as { reviewStatus: string };
  const staleItem = workbench.listReviewItems({
    mode: "relationships",
    status: "open",
  }).find((item) =>
    item.subjectId ===
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v2"
  );
  workbench.close();

  assertEquals(secondCandidate.reviewStatus, "pending");
  assert(staleItem);
  assertEquals(staleItem.defaultAction, "reject");
  assertEquals(staleItem.details.priorDecisionState, "rejected");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior rejected decision");
});

Deno.test("deferred relationship review decisions are reused across refetch when candidate ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  const firstCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_defer_v1";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(firstCandidateId, "Target Agency"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(firstCandidateId, "governed_by"),
      payload: {},
    },
    resolutionsDir,
  );

  const secondCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_defer_v2";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(secondCandidateId, "Target Agency"),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = ?",
  ).get(buildReviewItemId(firstCandidateId, "governed_by")) as { payloadJson: string };
  const deferredItems = workbench.listReviewItems({
    mode: "relationships",
    status: "deferred",
  });
  const openItems = workbench.listReviewItems({
    mode: "relationships",
    status: "open",
  });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(
    payload.fact_signature ?? "",
    "relationship_candidate:test.signature.relationships",
  );
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(
    deferredItems.some((item) => item.subjectId === secondCandidateId),
    true,
  );
  assertEquals(deferredItems.length, 1);
  assertEquals(openItems.length, 0);
});

Deno.test("changed relationship evidence after a prior defer becomes stale open review work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  const firstCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_defer_v1";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(firstCandidateId, "Target Agency"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(firstCandidateId, "governed_by"),
      payload: {},
    },
    resolutionsDir,
  );

  const secondCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_defer_v2";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(secondCandidateId, "Target Agency (Updated Source Text)"),
    dataDir,
  );

  const staleItem = workbench.listReviewItems({
    mode: "relationships",
    status: "open",
  }).find((item) => item.subjectId === secondCandidateId);
  const deferredItems = workbench.listReviewItems({
    mode: "relationships",
    status: "deferred",
  });
  workbench.close();

  assert(staleItem);
  assertEquals(staleItem.status, "open");
  assertEquals(staleItem.details.priorDecisionState, "deferred");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior deferred decision");
  assertEquals(deferredItems.length, 0);
});

Deno.test("status json reports blocked reconciliation counts", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
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
    await getConnector("mota.quickbase").run(createConnectorContext({ fetcher })),
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
      "--json",
    ],
  }).output();
  const status = JSON.parse(new TextDecoder().decode(statusOutput.stdout)) as {
    reconciliation: {
      blocked: number;
      firstBlockedReason?: string;
      blockedByRelationshipType: Array<{ relationshipType: string; count: number }>;
      firstBlocked?: {
        subjectId: string;
        relationshipType: string;
        blockers: Array<{ blockerId: string; blockerState: string }>;
      };
    };
  };

  assertEquals(statusOutput.code, 0);
  assert(status.reconciliation.blocked > 0);
  assertEquals(status.reconciliation.firstBlockedReason, "unresolved_endpoints");
  assert(
    status.reconciliation.blockedByRelationshipType.some((row) =>
      row.relationshipType === "governed_by" && row.count > 0
    ),
  );
  assert(status.reconciliation.firstBlocked);
  assert(status.reconciliation.firstBlocked.blockers.length > 0);
});

Deno.test("status surfaces blocked work by source with readable blocker labels", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
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
      "--json",
    ],
  }).output();
  const status = JSON.parse(new TextDecoder().decode(statusOutput.stdout)) as {
    reconciliation: {
      blockedBySource: Array<{ sourceId: string; count: number }>;
      firstBlocked?: {
        sourceId: string;
        blockers: Array<{ blockerId: string; blockerState: string; blockerLabel: string }>;
      };
    };
  };

  assertEquals(statusOutput.code, 0);
  assert(
    status.reconciliation.blockedBySource.some((row) =>
      row.sourceId === "council.committees" && row.count > 0
    ),
  );
  assertEquals(status.reconciliation.firstBlocked?.sourceId, "council.committees");
  assert(
    status.reconciliation.firstBlocked?.blockers.some((blocker) =>
      blocker.blockerState === "pending_candidate" &&
      blocker.blockerLabel === "Committee of the Whole"
    ),
  );
});

Deno.test("rejecting a prerequisite keeps dependent relationships blocked with rejected blocker audit", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
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
  await workbench.appendResolutionEvent(
    {
      eventType: "reject_entity_candidate",
      subjectId: "candidate.council.committees.committee_of_the_whole",
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
      "--json",
    ],
  }).output();
  const status = JSON.parse(new TextDecoder().decode(statusOutput.stdout)) as {
    reconciliation: {
      blockedByBlockerState: Array<{ blockerState: string; count: number }>;
      firstBlocked?: {
        blockers: Array<{ blockerId: string; blockerState: string; blockerLabel: string }>;
      };
    };
  };

  assertEquals(statusOutput.code, 0);
  assert(
    status.reconciliation.blockedByBlockerState.some((row) =>
      row.blockerState === "rejected_candidate" && row.count > 0
    ),
  );
  assert(
    status.reconciliation.firstBlocked?.blockers.some((blocker) =>
      blocker.blockerState === "rejected_candidate" &&
      blocker.blockerLabel === "Committee of the Whole"
    ),
  );
});

Deno.test("stale prerequisite candidates surface stale blocker audit for dependent relationships", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.source_board', 'Source Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.stale.entities",
      candidateId: "candidate.test.reconciliation.stale.target_v1",
      sourceItemKey: "stale-target-row",
      proposedEntityId: "dc.stale_target",
      name: "Stale Target",
      kind: "agency",
      observedName: "Stale Target",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "reject_entity_candidate",
      subjectId: "candidate.test.reconciliation.stale.target_v1",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.stale.entities",
      candidateId: "candidate.test.reconciliation.stale.target_v2",
      sourceItemKey: "stale-target-row",
      proposedEntityId: "dc.stale_target",
      name: "Stale Target",
      kind: "agency",
      observedName: "Stale Target Updated",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.reconciliation.stale.relationships",
      relationshipCandidateId: "relationship.test.reconciliation.stale",
      sourceItemKey: "stale-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.stale_target",
      relationshipType: "governed_by",
      rawValue: "Stale Target Updated",
    }),
    dataDir,
  );

  const blocked = workbench.db.prepare(
    `select blocker_state as blockerState,
            details_json as detailsJson
     from reconciliation_blockers
     where subject_type = 'relationship_candidate'
       and subject_id = 'relationship.test.reconciliation.stale'`,
  ).get() as { blockerState: string; detailsJson: string } | undefined;
  const relationshipReviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reconciliation",
  });
  workbench.close();

  assert(blocked);
  assertEquals(blocked.blockerState, "stale_candidate");
  assertStringIncludes(blocked.detailsJson, '"state":"stale_candidate"');
  assertEquals(relationshipReviewItems.length, 0);

  const statusOutput = await new Deno.Command("deno", {
    args: ["run", "-A", "scripts/dc.ts", "status", "--db", dbPath, "--json"],
    cwd: Deno.cwd(),
  }).output();
  assertEquals(statusOutput.code, 0);
  const status = JSON.parse(new TextDecoder().decode(statusOutput.stdout)) as {
    reconciliation: {
      blockedByBlockerState: Array<{ blockerState: string; count: number }>;
      firstBlocked?: {
        subjectId: string;
        blockers: Array<{ blockerState: string; blockerLabel: string }>;
      };
    };
  };

  assert(
    status.reconciliation.blockedByBlockerState.some((row) =>
      row.blockerState === "stale_candidate" && row.count === 1
    ),
  );
  assertEquals(
    status.reconciliation.firstBlocked?.subjectId,
    "relationship.test.reconciliation.stale",
  );
  assert(
    status.reconciliation.firstBlocked?.blockers.some((blocker) =>
      blocker.blockerState === "stale_candidate" && blocker.blockerLabel === "Stale Target"
    ),
  );
});

function syntheticEntitySourceResult(candidateId: string, observedName: string): ConnectorResult {
  return {
    source: {
      sourceId: "test.signature.entities",
      title: "Test Signature Entities",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/signature-entities",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.signature.entities.main",
        sourceId: "test.signature.entities",
        title: "Signature entity rows",
        kind: "fixture",
        url: "https://example.com/signature-entities",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/signature-entities",
        contentText: JSON.stringify({ candidateId, observedName }),
      }],
      parsed: {
        items: [{
          itemKey: "example-row",
          itemType: "fixture_row",
          title: "Example row",
          body: { observedName },
        }],
        entityCandidates: [{
          candidateId,
          sourceItemKey: "example-row",
          proposedEntityId: "dc.example_body",
          name: "Example Body",
          kind: "board",
          evidence: [{
            fieldPath: "name",
            observedValue: observedName,
          }],
        }],
        reviewItems: [{
          reviewItemId: buildReviewItemId(candidateId, "entity-review"),
          itemType: "entity_candidate",
          subjectId: candidateId,
          reason: "Review fixture entity candidate",
          defaultAction: "accept",
          details: {
            name: "Example Body",
            kind: "board",
          },
        }],
      },
    }],
  };
}

function syntheticCustomEntitySourceResult(input: {
  sourceId: string;
  candidateId: string;
  sourceItemKey: string;
  proposedEntityId: string;
  name: string;
  kind: string;
  observedName: string;
}): ConnectorResult {
  return {
    source: {
      sourceId: input.sourceId,
      title: "Test Custom Entities",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: `https://example.com/${input.sourceId}`,
    },
    endpointResults: [{
      endpoint: {
        endpointId: `${input.sourceId}.main`,
        sourceId: input.sourceId,
        title: "Custom entity rows",
        kind: "fixture",
        url: `https://example.com/${input.sourceId}`,
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: `https://example.com/${input.sourceId}`,
        contentText: JSON.stringify({
          candidateId: input.candidateId,
          observedName: input.observedName,
        }),
      }],
      parsed: {
        items: [{
          itemKey: input.sourceItemKey,
          itemType: "fixture_row",
          title: "Custom entity row",
          body: { observedName: input.observedName },
        }],
        entityCandidates: [{
          candidateId: input.candidateId,
          sourceItemKey: input.sourceItemKey,
          proposedEntityId: input.proposedEntityId,
          name: input.name,
          kind: input.kind,
          evidence: [{
            fieldPath: "name",
            observedValue: input.observedName,
          }],
        }],
        reviewItems: [{
          reviewItemId: buildReviewItemId(input.candidateId, "entity-review"),
          itemType: "entity_candidate",
          subjectId: input.candidateId,
          reason: "Review fixture entity candidate",
          defaultAction: "accept",
          details: {
            name: input.name,
            kind: input.kind,
          },
        }],
      },
    }],
  };
}

function syntheticLegalRefSourceResult(
  legalRefId: string,
  citationText: string,
  url: string,
): ConnectorResult {
  return {
    source: {
      sourceId: "test.signature.legal_refs",
      title: "Test Signature Legal Refs",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/signature-legal-refs",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.signature.legal_refs.main",
        sourceId: "test.signature.legal_refs",
        title: "Signature legal ref rows",
        kind: "fixture",
        url: "https://example.com/signature-legal-refs",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/signature-legal-refs",
        contentText: JSON.stringify({ legalRefId, citationText, url }),
      }],
      parsed: {
        items: [{
          itemKey: "example-legal-row",
          itemType: "fixture_row",
          title: "Example legal row",
          body: { citationText, url },
        }],
        legalRefs: [{
          legalRefId,
          sourceItemKey: "example-legal-row",
          refType: "dc_code",
          citationText,
          normalizedCitation: "D.C. Code 1-204.22",
          url,
          evidence: [{
            fieldPath: "citation",
            observedValue: citationText,
          }],
        }],
      },
    }],
  };
}

function syntheticRelationshipSourceResult(
  relationshipCandidateId: string,
  rawValue: string,
): ConnectorResult {
  return syntheticCustomRelationshipSourceResult({
    sourceId: "test.signature.relationships",
    relationshipCandidateId,
    sourceItemKey: "example-relationship-row",
    fromEntityRef: "dc.source_board",
    toEntityRef: "dc.target_agency",
    relationshipType: "governed_by",
    rawValue,
  });
}

function syntheticCustomRelationshipSourceResult(input: {
  sourceId: string;
  relationshipCandidateId: string;
  sourceItemKey: string;
  fromEntityRef: string;
  toEntityRef: string;
  relationshipType: RelationshipType;
  rawValue: string;
}): ConnectorResult {
  return {
    source: {
      sourceId: input.sourceId,
      title: "Test Signature Relationships",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: `https://example.com/${input.sourceId}`,
    },
    endpointResults: [{
      endpoint: {
        endpointId: `${input.sourceId}.main`,
        sourceId: input.sourceId,
        title: "Signature relationship rows",
        kind: "fixture",
        url: `https://example.com/${input.sourceId}`,
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: `https://example.com/${input.sourceId}`,
        contentText: JSON.stringify({
          relationshipCandidateId: input.relationshipCandidateId,
          rawValue: input.rawValue,
        }),
      }],
      parsed: {
        items: [{
          itemKey: input.sourceItemKey,
          itemType: "fixture_row",
          title: "Example relationship row",
          body: { rawValue: input.rawValue },
        }],
        relationshipCandidates: [{
          relationshipCandidateId: input.relationshipCandidateId,
          sourceItemKey: input.sourceItemKey,
          fromEntityRef: input.fromEntityRef,
          toEntityRef: input.toEntityRef,
          relationshipType: input.relationshipType,
          rawValue: input.rawValue,
          needsReview: true,
          evidence: [{
            fieldPath: "governingAgency",
            observedValue: input.rawValue,
          }],
        }],
      },
    }],
  };
}
