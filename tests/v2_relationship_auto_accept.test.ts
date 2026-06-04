import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildEntityId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
  councilMembersFixture,
  dcgisBoardsCommissionsCouncilsMetadataFixture,
  dcgisBoardsCommissionsCouncilsRowsFixture,
  quickbaseFixture,
} from "./helpers/v2_fixtures.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("accepted-endpoint default-accept relationships auto-accept without source allowlist", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.example_agency', 'Example Agency', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.executive_branch', 'Executive Branch', 'branch', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "dcgis.agencies",
      relationshipCandidateId: "relationship.test.auto_accept.dcgis.part_of",
      sourceItemKey: "auto-accept-dcgis-row",
      fromEntityRef: "dc.example_agency",
      toEntityRef: "dc.executive_branch",
      relationshipType: "part_of",
      rawValue: "Executive",
      needsReview: false,
    }),
    dataDir,
  );

  const relationship = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = 'dc.example_agency:part_of:dc.executive_branch'",
  ).get() as { relationshipId: string } | undefined;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.auto_accept.dcgis",
  });
  workbench.close();

  assertEquals(relationship?.relationshipId, "dc.example_agency:part_of:dc.executive_branch");
  assertEquals(reviewItems.length, 0);
});

Deno.test("default-defer dcgis relationships stay in review instead of auto-accepting", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.example_agency', 'Example Agency', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.other_branch', 'Other Branch', 'branch', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "dcgis.agencies",
      relationshipCandidateId: "relationship.test.auto_accept.dcgis.other",
      sourceItemKey: "auto-accept-dcgis-other-row",
      fromEntityRef: "dc.example_agency",
      toEntityRef: "dc.other_branch",
      relationshipType: "part_of",
      rawValue: "Other",
      needsReview: false,
    }),
    dataDir,
  );

  const relationship = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = 'dc.example_agency:part_of:dc.other_branch'",
  ).get() as { relationshipId: string } | undefined;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.auto_accept.dcgis.other",
  });
  workbench.close();

  assertEquals(relationship, undefined);
  assertEquals(reviewItems.length, 1);
  assertEquals(reviewItems[0]?.defaultAction, "defer");
  assertEquals(
    reviewItems[0]?.details.whyDeferred,
    'The source only labels the parent branch as "Other", so this relationship still needs a human decision.',
  );
});

Deno.test("accepting a prerequisite entity can auto-accept a newly safe Open DC relationship", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.board_accountancy', 'Board of Accountancy', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "open_dc.public_bodies",
      relationshipCandidateId: "relationship.test.auto_accept.open_dc.governing_agency",
      sourceItemKey: "auto-accept-open-dc-row",
      fromEntityRef: "dc.board_accountancy",
      toEntityRef: "dc.target_agency",
      relationshipType: "governed_by",
      rawValue: "Target Agency",
      needsReview: false,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.auto_accept.manual_entity",
      candidateId: "candidate.test.auto_accept.manual_entity.target_agency",
      sourceItemKey: "auto-accept-target-agency",
      proposedEntityId: "dc.target_agency",
      name: "Target Agency",
      kind: "agency",
      observedName: "Target Agency",
      confidence: 0.4,
    }),
    dataDir,
  );

  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.auto_accept.manual_entity.target_agency",
      payload: {},
    },
    resolutionsDir,
  );

  const relationship = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = 'dc.board_accountancy:governed_by:dc.target_agency'",
  ).get() as { relationshipId: string } | undefined;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.auto_accept.open_dc",
  });
  workbench.close();

  assertEquals(relationship?.relationshipId, "dc.board_accountancy:governed_by:dc.target_agency");
  assertEquals(reviewItems.length, 0);
});

Deno.test("Quickbase trusted designee authority relationships auto-accept when endpoints are accepted", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [
      ["dc.department_of_employment_services", "Department of Employment Services"],
      ["dc.public_charter_school_board_pcsb", "Public Charter School Board"],
      [
        "dc.department_of_licensing_and_consumer_protection",
        "Department of Licensing and Consumer Protection",
      ],
    ]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  const csv = `
"board or commission - b or c","seat designation (specific role)","appointment status","appointee designation","board status"
"Example Role Board","Director of the Department of Employment Services (DOES) Designee","Filled","Jane Doe","Active"
"Example Charter Board","Public Charter School Board (PCSB) Designee","Filled","Alex Doe","Active"
"Example Licensing Board","Department of Consumer and Regulatory Affairs (DCRA) Designee","Filled","Sam Doe","Active"
`.trim();
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
          return quickbaseFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
          return csv;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    })();
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };

  await workbench.importConnectorResult(
    await getConnector("mota.quickbase").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const relationships = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id in (
       ?,
       ?,
       ?
     )
     order by relationship_id`,
  ).all(
    `${
      buildEntityId("Example Charter Board Public Charter School Board Designee")
    }:designated_by:dc.public_charter_school_board_pcsb`,
    `${
      buildEntityId(
        "Example Licensing Board Department of Consumer and Regulatory Affairs Designee",
      )
    }:designated_by:dc.department_of_licensing_and_consumer_protection`,
    `${
      buildEntityId("Example Role Board Director of the Department of Employment Services Designee")
    }:designated_by:dc.department_of_employment_services`,
  ) as Array<{ relationshipId: string }>;
  const pendingGoverningRelationships = workbench.db.prepare(
    "select count(*) as count from relationship_candidates where relationship_type = 'governed_by'",
  ).get() as { count: number };
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.mota.quickbase",
    relationshipType: "governed_by",
  });
  workbench.close();

  assertEquals(relationships.length, 3);
  assertEquals(pendingGoverningRelationships.count, 0);
  assertEquals(reviewItems.length, 0);
});

Deno.test("Quickbase Mayoral Appointee authority seeds Mayor and auto-accepts unblocked relationship", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.alcoholic_beverage_and_cannabis_administration', 'Alcoholic Beverages and Cannabis Administration', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  const appointmentsCsvWithAlias = `
"board or commission - b or c","seat designation (specific role)","appointment status","appointee designation","board status"
"Commission on Nightlife and Culture (CNC)","Alcoholic Beverages and Cannabis Administration (ABCA) Designee","Filled","Mayoral Appointee, DC Agency Representative","Active"
`.trim();
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
          return quickbaseFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
          return appointmentsCsvWithAlias;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    })();
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };

  await workbench.importConnectorResult(
    await getConnector("mota.quickbase").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const acceptedRelationships = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  const mayor = workbench.db.prepare(
    "select entity_id as entityId, name, kind, review_status as reviewStatus from canonical_entities where entity_id = 'dc.mayor'",
  ).get() as { entityId: string; name: string; kind: string; reviewStatus: string } | undefined;
  const seededMayor = workbench.db.prepare(
    `select entity_candidates.name,
            entity_candidates.kind,
            entity_candidates.review_status as reviewStatus,
            entity_candidate_evidence.observed_value as observedValue
     from entity_candidates
     join entity_candidate_evidence
       on entity_candidate_evidence.candidate_id = entity_candidates.candidate_id
     where entity_candidates.proposed_entity_id = 'dc.mayor'`,
  ).get() as
    | { name: string; kind: string; reviewStatus: string; observedValue: string }
    | undefined;
  const remainingReviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.mota.quickbase",
  });
  const quickbaseGovernedByCandidates = workbench.db.prepare(
    `select count(*) as count
     from relationship_candidates
     join source_items using(source_item_id)
     where source_items.source_id = 'mota.quickbase'
       and relationship_candidates.relationship_type = 'governed_by'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(acceptedRelationships.map((row) => row.relationshipId), [
    "dc.commission_on_nightlife_and_culture:has_seat:dc.commission_on_nightlife_and_culture_cnc_alcoholic_beverages_and_cannabis_administration_designee",
    "dc.commission_on_nightlife_and_culture_cnc_alcoholic_beverages_and_cannabis_administration_designee:appointed_by:dc.mayor",
    "dc.commission_on_nightlife_and_culture_cnc_alcoholic_beverages_and_cannabis_administration_designee:designated_by:dc.alcoholic_beverage_and_cannabis_administration",
    "dc.commission_on_nightlife_and_culture_cnc_alcoholic_beverages_and_cannabis_administration_designee:has_status:status.filled",
  ]);
  assertEquals(mayor, {
    entityId: "dc.mayor",
    name: "Mayor",
    kind: "office",
    reviewStatus: "accepted",
  });
  assertEquals(seededMayor, {
    name: "Mayor",
    kind: "office",
    reviewStatus: "accepted",
    observedValue: "Mayoral Appointee",
  });
  assertEquals(remainingReviewItems.length, 0);
  assertEquals(quickbaseGovernedByCandidates.count, 0);
});

Deno.test("Quickbase designating-only authority seats do not create board governance review work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const csv = `
"board or commission - b or c","seat designation (specific role)","appointment status","appointee designation","board status"
"Example Designating Only Board","Office of the Chief of Staff (COS) Designee","Filled","Mayoral Appointee, DC Agency Representative","Active"
`.trim();
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
          return quickbaseFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
          return csv;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    })();
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };

  await workbench.importConnectorResult(
    await getConnector("mota.quickbase").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const seatId = buildEntityId(
    "Example Designating Only Board Office of the Chief of Staff Designee",
  );
  const chiefOfStaff = workbench.db.prepare(
    "select entity_id as entityId, name, kind, review_status as reviewStatus from canonical_entities where entity_id = 'dc.office_of_the_chief_of_staff'",
  ).get() as { entityId: string; name: string; kind: string; reviewStatus: string } | undefined;
  const acceptedRelationships = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  const governedByRows = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'governed_by'",
  ).all() as Array<{ relationshipId: string }>;
  const remainingGovernanceReviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.mota.quickbase",
    relationshipType: "governed_by",
  });
  workbench.close();

  assertEquals(chiefOfStaff, {
    entityId: "dc.office_of_the_chief_of_staff",
    name: "Office of the Chief of Staff",
    kind: "office",
    reviewStatus: "accepted",
  });
  assertEquals(acceptedRelationships.map((row) => row.relationshipId), [
    `dc.example_designating_only_board:has_seat:${seatId}`,
    `${seatId}:appointed_by:dc.mayor`,
    `${seatId}:designated_by:dc.office_of_the_chief_of_staff`,
    `${seatId}:has_status:status.filled`,
  ]);
  assertEquals(governedByRows.length, 0);
  assertEquals(remainingGovernanceReviewItems.length, 0);
});

Deno.test("Quickbase DC agency representative authority endpoints auto-materialize from organization text", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const csv = `
"board or commission - b or c","seat designation (specific role)","appointment status","appointee designation","board status"
"Example Agency Representative Board","Office of Example Policy (OEP) Designee","Filled","Mayoral Appointee, DC Agency Representative","Active"
`.trim();
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
          return quickbaseFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
          return csv;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    })();
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };

  await workbench.importConnectorResult(
    await getConnector("mota.quickbase").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const seatId = buildEntityId(
    "Example Agency Representative Board Office of Example Policy Designee",
  );
  const examplePolicyOffice = workbench.db.prepare(
    "select entity_id as entityId, name, kind, review_status as reviewStatus from canonical_entities where entity_id = 'dc.office_of_example_policy'",
  ).get() as { entityId: string; name: string; kind: string; reviewStatus: string } | undefined;
  const acceptedRelationship = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = ?",
  ).get(`${seatId}:designated_by:dc.office_of_example_policy`) as
    | { relationshipId: string }
    | undefined;
  const remainingAuthorityReviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.mota.quickbase",
    relationshipType: "designated_by",
  });
  workbench.close();

  assertEquals(examplePolicyOffice, {
    entityId: "dc.office_of_example_policy",
    name: "Office of Example Policy",
    kind: "office",
    reviewStatus: "accepted",
  });
  assertEquals(
    acceptedRelationship?.relationshipId,
    `${seatId}:designated_by:dc.office_of_example_policy`,
  );
  assertEquals(remainingAuthorityReviewItems.length, 0);
});

Deno.test("Quickbase accepted-endpoint appointee observation relationships auto-accept during import", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const csv = `
"board or commission - b or c","seat designation (specific role)","appointment status","appointee designation","board status"
"Council of the District of Columbia","Chairperson","Filled","John Smith","Active"
`.trim();
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
          return quickbaseFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
          return csv;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    })();
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };

  await workbench.importConnectorResult(
    await getConnector("mota.quickbase").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const acceptedRelationships = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  const remainingReviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.mota.quickbase",
  });
  workbench.close();

  assertEquals(acceptedRelationships.map((row) => row.relationshipId), [
    "dc.council_of_the_district_of_columbia:has_seat:dc.council_of_the_district_of_columbia_chairperson",
    "dc.council_of_the_district_of_columbia_chairperson:has_status:status.filled",
    "observation.council_of_the_district_of_columbia_row_1_john_smith:has_status:status.filled",
    "observation.council_of_the_district_of_columbia_row_1_john_smith:holds:dc.council_of_the_district_of_columbia_chairperson",
  ]);
  assertEquals(remainingReviewItems.length, 0);
});

Deno.test("Accepted-endpoint DC Courts structure relationships auto-accept during import", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name, kind] of [
      [
        "dc.superior_court_of_the_district_of_columbia",
        "Superior Court of the District of Columbia",
        "court",
      ],
      ["dc.district_of_columbia_courts", "District of Columbia Courts", "court_system"],
    ] as const
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name, kind);
  }

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "dccourts.structure",
      relationshipCandidateId: "relationship.test.auto_accept.dccourts.part_of",
      sourceItemKey: "dccourts-structure-row",
      fromEntityRef: "dc.superior_court_of_the_district_of_columbia",
      toEntityRef: "dc.district_of_columbia_courts",
      relationshipType: "part_of",
      rawValue: "Superior Court -> DC Courts",
      needsReview: true,
    }),
    dataDir,
  );

  const relationship = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = 'dc.superior_court_of_the_district_of_columbia:part_of:dc.district_of_columbia_courts'",
  ).get() as { relationshipId: string } | undefined;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.auto_accept.dccourts",
  });
  workbench.close();

  assertEquals(
    relationship?.relationshipId,
    "dc.superior_court_of_the_district_of_columbia:part_of:dc.district_of_columbia_courts",
  );
  assertEquals(reviewItems.length, 0);
});

Deno.test("accepted-endpoint Council oversight relationships auto-accept when default action is accept", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name, kind] of [
      ["dc.child_support_guideline_commission", "Child Support Guideline Commission", "commission"],
      [
        "dc.committee_on_the_judiciary_and_public_safety",
        "Committee on the Judiciary and Public Safety",
        "committee",
      ],
      ["dc.department_of_buildings", "Department of Buildings", "agency"],
      ["dc.office_of_the_attorney_general", "Office of the Attorney General", "agency"],
    ] as const
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name, kind);
  }

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.auto_accept.council.oversight",
      sourceItemKey: "council-oversight-row",
      fromEntityRef: "dc.child_support_guideline_commission",
      toEntityRef: "dc.committee_on_the_judiciary_and_public_safety",
      relationshipType: "overseen_by",
      rawValue: "Child Support Guideline Commission",
      needsReview: true,
    }),
    dataDir,
  );

  const relationship = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = 'dc.child_support_guideline_commission:overseen_by:dc.committee_on_the_judiciary_and_public_safety'",
  ).get() as { relationshipId: string } | undefined;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.test.auto_accept.council",
  });
  workbench.close();

  assertEquals(
    relationship?.relationshipId,
    "dc.child_support_guideline_commission:overseen_by:dc.committee_on_the_judiciary_and_public_safety",
  );
  assertEquals(reviewItems.length, 0);
});

Deno.test("accepted-endpoint Council oversight relationships honor source-specific default actions", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name, kind] of [
      [
        "dc.committee_on_facilities_and_procurement",
        "Committee on Facilities and Procurement",
        "committee",
      ],
      [
        "dc.committee_on_the_judiciary_and_public_safety",
        "Committee on the Judiciary and Public Safety",
        "committee",
      ],
      ["dc.committee_of_the_whole", "Committee of the Whole", "committee"],
      [
        "dc.council_of_the_district_of_columbia",
        "Council of the District of Columbia",
        "council",
      ],
    ] as const
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name, kind);
  }

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.auto_accept.council.exact_oversight",
      sourceItemKey: "council-exact-oversight-row",
      fromEntityRef: "dc.committee_on_facilities_and_procurement",
      toEntityRef: "dc.committee_on_the_judiciary_and_public_safety",
      relationshipType: "overseen_by",
      rawValue: "Committee on Facilities and Procurement",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.auto_accept.council.including_oversight",
      sourceItemKey: "council-including-oversight-row",
      fromEntityRef: "dc.department_of_buildings",
      toEntityRef: "dc.committee_on_the_judiciary_and_public_safety",
      relationshipType: "overseen_by",
      rawValue: "Department of Buildings (including construction codes)",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.auto_accept.council.jointly_oversight",
      sourceItemKey: "council-jointly-oversight-row",
      fromEntityRef: "dc.office_of_the_attorney_general",
      toEntityRef: "dc.committee_on_the_judiciary_and_public_safety",
      relationshipType: "overseen_by",
      rawValue:
        "Office of the Attorney General (jointly, only for oversight purposes, with the Committee on Youth Affairs)",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.auto_accept.council.self_oversight",
      sourceItemKey: "council-self-oversight-row",
      fromEntityRef: "dc.council_of_the_district_of_columbia",
      toEntityRef: "dc.committee_of_the_whole",
      relationshipType: "overseen_by",
      rawValue: "Council of the District of Columbia",
      needsReview: true,
    }),
    dataDir,
  );

  const relationships = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'overseen_by' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.test.auto_accept.council",
  });
  const selfRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.council_of_the_district_of_columbia:overseen_by:dc.committee_of_the_whole'`,
  ).get() as { relationshipId: string } | undefined;
  const selfCandidate = workbench.db.prepare(
    `select review_status as reviewStatus
     from relationship_candidates
     where relationship_candidate_id = 'relationship.test.auto_accept.council.self_oversight'`,
  ).get() as { reviewStatus: string } | undefined;
  workbench.close();

  assertEquals(relationships.map((row) => row.relationshipId), [
    "dc.committee_on_facilities_and_procurement:overseen_by:dc.committee_on_the_judiciary_and_public_safety",
    "dc.council_of_the_district_of_columbia:overseen_by:dc.committee_of_the_whole",
    "dc.department_of_buildings:overseen_by:dc.committee_on_the_judiciary_and_public_safety",
    "dc.office_of_the_attorney_general:overseen_by:dc.committee_on_the_judiciary_and_public_safety",
  ]);
  assertEquals(
    selfRelationship?.relationshipId,
    "dc.council_of_the_district_of_columbia:overseen_by:dc.committee_of_the_whole",
  );
  assertEquals(selfCandidate?.reviewStatus, "accepted");
  assertEquals(reviewItems.length, 0);
});

Deno.test("accepted-endpoint Council exclusion oversight auto-accepts when excluded body is separately overseen", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name, kind] of [
      ["dc.committee_of_the_whole", "Committee of the Whole", "committee"],
      ["dc.committee_on_human_services", "Committee on Human Services", "committee"],
      [
        "dc.office_of_the_chief_financial_officer",
        "Office of the Chief Financial Officer",
        "office",
      ],
      ["dc.office_of_lottery_and_gaming", "Office of Lottery and Gaming", "office"],
    ] as const
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name, kind);
  }

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.auto_accept.council.olg_oversight",
      sourceItemKey: "council-olg-oversight-row",
      fromEntityRef: "dc.office_of_lottery_and_gaming",
      toEntityRef: "dc.committee_on_human_services",
      relationshipType: "overseen_by",
      rawValue: "Office of Lottery and Gaming",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.auto_accept.council.ocfo_excluding_olg",
      sourceItemKey: "council-ocfo-excluding-olg-row",
      fromEntityRef: "dc.office_of_the_chief_financial_officer",
      toEntityRef: "dc.committee_of_the_whole",
      relationshipType: "overseen_by",
      rawValue:
        "Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)",
      needsReview: true,
    }),
    dataDir,
  );

  const relationships = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'overseen_by' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.test.auto_accept.council.ocfo_excluding_olg",
  });
  const ocfoCandidate = workbench.db.prepare(
    `select review_status as reviewStatus
     from relationship_candidates
     where relationship_candidate_id = 'relationship.test.auto_accept.council.ocfo_excluding_olg'`,
  ).get() as { reviewStatus: string } | undefined;
  workbench.close();

  assertEquals(relationships.map((row) => row.relationshipId), [
    "dc.office_of_lottery_and_gaming:overseen_by:dc.committee_on_human_services",
    "dc.office_of_the_chief_financial_officer:overseen_by:dc.committee_of_the_whole",
  ]);
  assertEquals(ocfoCandidate?.reviewStatus, "accepted");
  assertEquals(reviewItems.length, 0);
});

Deno.test("accepted-endpoint Council exclusion oversight stays reviewable without separate accepted committee proof", async () => {
  for (
    const scenario of [
      {
        name: "missing separate oversight",
        excludedEntityKind: "office",
        excludedEntityStatus: "accepted",
        separateOversightTargetKind: "committee",
        separateOversightTargetRef: undefined,
      },
      {
        name: "placeholder excluded body",
        excludedEntityKind: "office",
        excludedEntityStatus: "accepted",
        excludedEntityPlaceholder: true,
        separateOversightTargetKind: "committee",
        separateOversightTargetRef: "dc.committee_on_human_services",
      },
      {
        name: "same scoped committee",
        excludedEntityKind: "office",
        excludedEntityStatus: "accepted",
        separateOversightTargetKind: "committee",
        separateOversightTargetRef: "dc.committee_of_the_whole",
      },
      {
        name: "non-committee separate target",
        excludedEntityKind: "office",
        excludedEntityStatus: "accepted",
        separateOversightTargetKind: "agency",
        separateOversightTargetRef: "dc.department_of_human_services",
      },
    ] as const
  ) {
    const dir = await Deno.makeTempDir();
    const dbPath = join(dir, "workbench.sqlite");
    const dataDir = join(dir, "artifacts");
    const workbench = new Workbench(dbPath);
    workbench.init();
    for (
      const [entityId, name, kind, isPlaceholder] of [
        ["dc.committee_of_the_whole", "Committee of the Whole", "committee", 0],
        [
          "dc.office_of_the_chief_financial_officer",
          "Office of the Chief Financial Officer",
          "office",
          0,
        ],
        [
          "dc.office_of_lottery_and_gaming",
          "Office of Lottery and Gaming",
          scenario.excludedEntityKind,
          scenario.excludedEntityPlaceholder ? 1 : 0,
        ],
        [
          "dc.committee_on_human_services",
          "Committee on Human Services",
          scenario.separateOversightTargetKind,
          0,
        ],
        [
          "dc.department_of_human_services",
          "Department of Human Services",
          scenario.separateOversightTargetKind,
          0,
        ],
      ] as const
    ) {
      workbench.db.prepare(
        "insert into canonical_entities(entity_id, name, kind, review_status, is_placeholder, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, ?, ?, '[]', datetime('now'), datetime('now'))",
      ).run(entityId, name, kind, scenario.excludedEntityStatus, isPlaceholder);
    }

    if (scenario.separateOversightTargetRef) {
      await workbench.importConnectorResult(
        syntheticCustomRelationshipSourceResult({
          sourceId: "council.committees",
          relationshipCandidateId: `relationship.test.auto_accept.council.${
            scenario.name.replaceAll(" ", "_")
          }_proof`,
          sourceItemKey: `council-${scenario.name.replaceAll(" ", "-")}-proof-row`,
          fromEntityRef: "dc.office_of_lottery_and_gaming",
          toEntityRef: scenario.separateOversightTargetRef,
          relationshipType: "overseen_by",
          rawValue: "Office of Lottery and Gaming",
          needsReview: true,
        }),
        dataDir,
      );
    }
    await workbench.importConnectorResult(
      syntheticCustomRelationshipSourceResult({
        sourceId: "council.committees",
        relationshipCandidateId: `relationship.test.auto_accept.council.${
          scenario.name.replaceAll(" ", "_")
        }_ocfo_excluding_olg`,
        sourceItemKey: `council-${scenario.name.replaceAll(" ", "-")}-ocfo-excluding-olg-row`,
        fromEntityRef: "dc.office_of_the_chief_financial_officer",
        toEntityRef: "dc.committee_of_the_whole",
        relationshipType: "overseen_by",
        rawValue:
          "Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)",
        needsReview: true,
      }),
      dataDir,
    );

    const ocfoRelationship = workbench.db.prepare(
      `select relationship_id as relationshipId
       from canonical_relationships
       where relationship_id = 'dc.office_of_the_chief_financial_officer:overseen_by:dc.committee_of_the_whole'`,
    ).get() as { relationshipId: string } | undefined;
    const ocfoCandidate = workbench.db.prepare(
      `select review_status as reviewStatus
       from relationship_candidates
       where relationship_candidate_id = ?`,
    ).get(
      `relationship.test.auto_accept.council.${
        scenario.name.replaceAll(" ", "_")
      }_ocfo_excluding_olg`,
    ) as { reviewStatus: string } | undefined;
    const reviewItems = workbench.listReviewItems({
      mode: "relationships",
      relationshipType: "overseen_by",
      subjectPrefix: `relationship.test.auto_accept.council.${
        scenario.name.replaceAll(" ", "_")
      }_ocfo_excluding_olg`,
    });
    workbench.close();

    assertEquals(ocfoRelationship, undefined, scenario.name);
    assertEquals(ocfoCandidate?.reviewStatus, "pending", scenario.name);
    assertEquals(reviewItems.length, 1, scenario.name);
    assertEquals(reviewItems[0]?.defaultAction, "defer", scenario.name);
  }
});

Deno.test("DCGIS governing agency relationships auto-accept when alias endpoints are already accepted", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [
      [
        "dc.department_of_housing_and_community_development",
        "Department of Housing and Community Development",
      ],
      [
        "dc.department_of_licensing_and_consumer_protection",
        "Department of Licensing and Consumer Protection",
      ],
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
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsRowsFixture);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("dcgis.boards_commissions_councils").run(
      createConnectorContext({ fetcher }),
    ),
    dataDir,
  );

  const relationships = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id in (
       'dc.board_of_accountancy:governed_by:dc.department_of_licensing_and_consumer_protection',
       'dc.rental_housing_commission:governed_by:dc.department_of_housing_and_community_development'
     )
     order by relationship_id`,
  ).all() as Array<{ relationshipId: string }>;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.dcgis.boards_commissions_councils",
  });
  workbench.close();

  assertEquals(relationships.length, 2);
  assertEquals(reviewItems.length, 0);
});

Deno.test("OANC commissioner entities auto-promote and explicit ANC structure relationships auto-accept", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "oanc.anc_profiles",
      candidateId: "candidate.test.auto_accept.oanc.anc",
      sourceItemKey: "anc-1a",
      proposedEntityId: "dc.anc_1a",
      name: "ANC 1A",
      kind: "commission",
      observedName: "ANC 1A",
      confidence: 0.98,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "oanc.anc_profiles",
      candidateId: "candidate.test.auto_accept.oanc.smd",
      sourceItemKey: "anc-1a",
      proposedEntityId: "dc.smd_1a01",
      name: "SMD 1A01",
      kind: "smd",
      observedName: "SMD 1A01",
      confidence: 0.98,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "oanc.anc_profiles",
      candidateId: "candidate.test.auto_accept.oanc.commissioner",
      sourceItemKey: "anc-1a",
      proposedEntityId: "dc.jane_commissioner",
      name: "Jane Commissioner",
      kind: "public_official",
      observedName: "Jane Commissioner",
      confidence: 0.95,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "oanc.anc_profiles",
      relationshipCandidateId: "relationship.test.auto_accept.oanc.represents",
      sourceItemKey: "anc-1a",
      fromEntityRef: "dc.jane_commissioner",
      toEntityRef: "dc.smd_1a01",
      relationshipType: "represents",
      rawValue: "1A01",
      needsReview: false,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "oanc.anc_profiles",
      relationshipCandidateId: "relationship.test.auto_accept.oanc.member_of",
      sourceItemKey: "anc-1a",
      fromEntityRef: "dc.jane_commissioner",
      toEntityRef: "dc.anc_1a",
      relationshipType: "member_of",
      rawValue: "Jane Commissioner",
      needsReview: false,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "oanc.anc_profiles",
      relationshipCandidateId: "relationship.test.auto_accept.oanc.part_of",
      sourceItemKey: "anc-1a",
      fromEntityRef: "dc.smd_1a01",
      toEntityRef: "dc.anc_1a",
      relationshipType: "part_of",
      rawValue: "1A01",
      needsReview: false,
    }),
    dataDir,
  );

  const commissioner = workbench.db.prepare(
    "select review_status as reviewStatus from canonical_entities where entity_id = 'dc.jane_commissioner'",
  ).get() as { reviewStatus: string } | undefined;
  const relationships = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id in (
       'dc.jane_commissioner:represents:dc.smd_1a01',
       'dc.jane_commissioner:member_of:dc.anc_1a',
       'dc.smd_1a01:part_of:dc.anc_1a'
     )
     order by relationship_id`,
  ).all() as Array<{ relationshipId: string }>;
  const entityItems = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix: "candidate.test.auto_accept.oanc",
  });
  const relationshipItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.auto_accept.oanc",
  });
  workbench.close();

  assertEquals(commissioner?.reviewStatus, "accepted");
  assertEquals(relationships.length, 3);
  assertEquals(entityItems.length, 0);
  assertEquals(relationshipItems.length, 0);
});

Deno.test("Council member entities auto-promote and explicit seat relationships auto-accept", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "council.members",
      candidateId: "candidate.test.auto_accept.council.person",
      sourceItemKey: "council-members-page",
      proposedEntityId: "dc.alex_councilmember",
      name: "Alex Councilmember",
      kind: "public_official",
      observedName: "Alex Councilmember",
      confidence: 0.99,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "council.members",
      candidateId: "candidate.test.auto_accept.council.role",
      sourceItemKey: "council-members-page",
      proposedEntityId: "dc.ward_1_council_seat",
      name: "Ward 1 Council Seat",
      kind: "council_role",
      observedName: "Ward 1 Council Seat",
      confidence: 0.99,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "council.members",
      candidateId: "candidate.test.auto_accept.council.ward",
      sourceItemKey: "council-members-page",
      proposedEntityId: "dc.ward_1",
      name: "Ward 1",
      kind: "ward",
      observedName: "Ward 1",
      confidence: 0.99,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.members",
      relationshipCandidateId: "relationship.test.auto_accept.council.holds",
      sourceItemKey: "council-members-page",
      fromEntityRef: "dc.alex_councilmember",
      toEntityRef: "dc.ward_1_council_seat",
      relationshipType: "holds",
      rawValue: "Ward 1 Council Seat",
      needsReview: false,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.members",
      relationshipCandidateId: "relationship.test.auto_accept.council.part_of",
      sourceItemKey: "council-members-page",
      fromEntityRef: "dc.ward_1_council_seat",
      toEntityRef: "dc.council_of_the_district_of_columbia",
      relationshipType: "part_of",
      rawValue: "Council of the District of Columbia",
      needsReview: false,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.members",
      relationshipCandidateId: "relationship.test.auto_accept.council.represents",
      sourceItemKey: "council-members-page",
      fromEntityRef: "dc.ward_1_council_seat",
      toEntityRef: "dc.ward_1",
      relationshipType: "represents",
      rawValue: "ward-1",
      needsReview: false,
    }),
    dataDir,
  );

  const person = workbench.db.prepare(
    "select review_status as reviewStatus from canonical_entities where entity_id = 'dc.alex_councilmember'",
  ).get() as { reviewStatus: string } | undefined;
  const relationships = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id in (
       'dc.alex_councilmember:holds:dc.ward_1_council_seat',
       'dc.ward_1_council_seat:part_of:dc.council_of_the_district_of_columbia',
       'dc.ward_1_council_seat:represents:dc.ward_1'
     )
     order by relationship_id`,
  ).all() as Array<{ relationshipId: string }>;
  const entityItems = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix: "candidate.test.auto_accept.council",
  });
  const relationshipItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.auto_accept.council",
  });
  workbench.close();

  assertEquals(person?.reviewStatus, "accepted");
  assertEquals(relationships.length, 3);
  assertEquals(entityItems.length, 0);
  assertEquals(relationshipItems.length, 0);
});

Deno.test("Council committee chair, member, and part_of relationships auto-accept once member entities exist", async () => {
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
        case "https://dccouncil.gov/councilmembers/":
          return councilMembersFixture;
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
    await getConnector("council.members").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const acceptedRelationships = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id in (
       ?,
       ?,
       ?
     )
     order by relationship_id`,
  ).all(
    `${buildEntityId("At-Large Councilmember Christina Henderson")}:chairs:${
      buildEntityId("Committee on Health")
    }`,
    `${buildEntityId("Ward 6 Councilmember Charles Allen")}:member_of:${
      buildEntityId("Committee on Health")
    }`,
    `${buildEntityId("Committee on Health")}:part_of:${
      buildEntityId("Council of the District of Columbia")
    }`,
  ) as Array<{ relationshipId: string }>;
  const pendingCommitteeStructure = workbench.db.prepare(
    `select count(*) as count
     from relationship_candidates
     join source_items on source_items.source_item_id = relationship_candidates.source_item_id
     where source_items.source_id = 'council.committees'
       and relationship_candidates.review_status = 'pending'
       and relationship_candidates.relationship_type in ('chairs', 'member_of', 'part_of')`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(acceptedRelationships.length, 3);
  assertEquals(pendingCommitteeStructure.count, 0);
});

Deno.test("Committee of the Whole roster omissions become deferred relationship review", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const cowWithMissingWard8 = `
<html><body>
  <h1>Committee of the Whole</h1>
  <p>The Chairman of the Council is the Chairman of the Committee of the Whole (COW), and all Councilmembers are part of the committee.</p>
  <main>
    <h2>Councilmembers</h2>
    <h4>Chairperson</h4>
    <p><a href="https://dccouncil.gov/council/phil-mendelson/">Chairman Phil Mendelson</a></p>
    <h4>Councilmembers</h4>
    <ul>
      <li><a href="https://dccouncil.gov/council/anita-bonds/">At-Large Councilmember Anita Bonds</a></li>
      <li><a href="https://dccouncil.gov/council/robert-white/">At-Large Councilmember Robert C. White, Jr.</a></li>
      <li><a href="https://dccouncil.gov/council/christina-henderson/">At-Large Councilmember Christina Henderson</a></li>
      <li><a href="https://dccouncil.gov/council/doni-crawford/">At-Large Councilmember Doni Crawford</a></li>
      <li><a href="https://dccouncil.gov/council/brianne-nadeau/">Ward 1 Councilmember Brianne K. Nadeau</a></li>
      <li><a href="https://dccouncil.gov/council/brooke-pinto/">Ward 2 Councilmember Brooke Pinto</a></li>
      <li><a href="https://dccouncil.gov/council/matthew-frumin/">Ward 3 Councilmember Matthew Frumin</a></li>
      <li><a href="https://dccouncil.gov/council/janeese-lewis-george/">Ward 4 Councilmember Janeese Lewis George</a></li>
      <li><a href="https://dccouncil.gov/council/zachary-parker/">Ward 5 Councilmember Zachary Parker</a></li>
      <li><a href="https://dccouncil.gov/council/charles-allen/">Ward 6 Councilmember Charles Allen</a></li>
      <li><a href="https://dccouncil.gov/council/wendell-felder/">Ward 7 Councilmember Wendell Felder</a></li>
    </ul>
  </main>
</body></html>
`;

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/councilmembers/":
          return councilMembersFixture;
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return cowWithMissingWard8;
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
    await getConnector("council.members").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const ward7CowRelationshipId = `${
    buildEntityId("Ward 7 Councilmember Wendell Felder")
  }:member_of:${buildEntityId("Committee of the Whole")}`;
  const ward8CowRelationshipId = `${
    buildEntityId("Ward 8 Councilmember Trayon White, Jr.")
  }:member_of:${buildEntityId("Committee of the Whole")}`;
  const ward7Relationship = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = ?",
  ).get(ward7CowRelationshipId) as { relationshipId: string } | undefined;
  const ward8Relationship = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = ?",
  ).get(ward8CowRelationshipId) as { relationshipId: string } | undefined;
  const ward8Candidate = workbench.db.prepare(
    `select relationship_candidate_id as relationshipCandidateId,
            needs_review as needsReview,
            review_status as reviewStatus,
            raw_value as rawValue
     from relationship_candidates
     where from_entity_ref = ?
       and to_entity_ref = ?
       and relationship_type = 'member_of'`,
  ).get(
    buildEntityId("Ward 8 Councilmember Trayon White, Jr."),
    buildEntityId("Committee of the Whole"),
  ) as {
    relationshipCandidateId: string;
    needsReview: number;
    reviewStatus: string;
    rawValue: string;
  } | undefined;
  const ward8Review = ward8Candidate
    ? workbench.listReviewItems({
      mode: "relationships",
      subjectPrefix: ward8Candidate.relationshipCandidateId,
    })[0]
    : undefined;
  workbench.close();

  assertEquals(ward7Relationship?.relationshipId, ward7CowRelationshipId);
  assertEquals(ward8Relationship, undefined);
  assertEquals(ward8Candidate?.needsReview, 1);
  assertEquals(ward8Candidate?.reviewStatus, "pending");
  assert(ward8Candidate?.rawValue.includes("absent from the explicit committee roster"));
  assertEquals(
    ward8Review?.reason,
    "Review Committee of the Whole roster/prose membership tension",
  );
  assertEquals(ward8Review?.defaultAction, "defer");
  assert(
    String(ward8Review?.details.whyDeferred).includes(
      "explicit committee roster omits this member",
    ),
  );
});
