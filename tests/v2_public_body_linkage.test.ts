import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildEntityId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  dcgisBoardsCommissionsCouncilsMetadataFixture,
  dcgisMetadataFixture,
  dcgisRowsFixture,
} from "./helpers/v2_fixtures.ts";

Deno.test("DCGIS public-body rows named for a governing agency derive the public body name", async () => {
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
  const reviewItem = workbench.listReviewItems({
    type: "entity_candidate",
    subjectPrefix: "candidate.dcgis.boards_commissions_councils.26",
  })[0];
  const relationshipReviewItem = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.dcgis.boards_commissions_councils.26_governing_agency",
  })[0];
  const evidenceFields = workbench.db.prepare(
    "select field_path as fieldPath from entity_candidate_evidence where candidate_id = ? order by field_path",
  ).all("candidate.dcgis.boards_commissions_councils.26") as Array<{ fieldPath: string }>;
  const relationship = workbench.db.prepare(
    `select from_entity_ref as fromEntityRef,
            relationship_type as relationshipType,
            to_entity_ref as toEntityRef,
            review_status as reviewStatus
       from relationship_candidates
      where relationship_candidate_id = ?`,
  ).get("relationship.dcgis.boards_commissions_councils.26_governing_agency") as {
    fromEntityRef: string;
    relationshipType: string;
    toEntityRef: string;
    reviewStatus: string;
  } | undefined;
  const canonicalRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
       from canonical_relationships
      where relationship_id = ?`,
  ).get(
    "dc.alcoholic_beverage_and_cannabis_board:governed_by:dc.alcoholic_beverage_and_cannabis_administration",
  ) as { relationshipId: string } | undefined;
  const legalAttachment = workbench.db.prepare(
    `select entity_id as entityId,
            legal_ref_id as legalRefId
       from entity_legal_refs
      where legal_ref_id = ?`,
  ).get("legal.dcgis.boards_commissions_councils.26_legislation") as {
    entityId: string;
    legalRefId: string;
  } | undefined;
  workbench.close();

  assertEquals(candidate?.proposedEntityId, "dc.alcoholic_beverage_and_cannabis_board");
  assertEquals(candidate?.name, "Alcoholic Beverage and Cannabis Board");
  assertEquals(candidate?.kind, "board");
  assertEquals(candidate?.reviewStatus, "accepted");
  assertEquals(reviewItem, undefined);
  assertEquals(relationship, undefined);
  assertEquals(relationshipReviewItem, undefined);
  assertEquals(canonicalRelationship, undefined);
  assertEquals(legalAttachment?.entityId, "dc.alcoholic_beverage_and_cannabis_board");
  assertEquals(
    legalAttachment?.legalRefId,
    "legal.dcgis.boards_commissions_councils.26_legislation",
  );
  assert(evidenceFields.some((row) => row.fieldPath === "GOVERNING_AGENCY"));
  assert(evidenceFields.some((row) => row.fieldPath === "AUTHORIZING_ORDER_LAW"));
});

Deno.test("DCGIS barber board service-page governance rows do not emit stale DC Health governing edges", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const bccRows = {
    features: [{
      attributes: {
        ENTITY_ID: 32,
        NAME: "Board of Barber and Cosmetology",
        SHORT_NAME: "Board of Barber and Cosmetology",
        TYPE: "Board",
        WEB_URL: "https://dchealth.dc.gov/service/barber-cosmetology-and-personal-grooming",
        GOVERNING_AGENCY: "DC Health",
        AUTHORIZING_ORDER_LAW: "D.C. Code § 47-2853.06",
        CLUSTER_DC: null,
      },
    }],
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
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
    await getConnector("dcgis.boards_commissions_councils").run(
      createConnectorContext({ fetcher }),
    ),
    dataDir,
  );

  const relationship = workbench.db.prepare(
    `select review_status as reviewStatus
       from relationship_candidates
      where relationship_candidate_id = 'relationship.dcgis.boards_commissions_councils.32_governing_agency'`,
  ).get() as { reviewStatus: string } | undefined;
  const canonicalRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
       from canonical_relationships
      where relationship_id = 'dc.board_of_barber_and_cosmetology:governed_by:dc.dc_health'`,
  ).get() as { relationshipId: string } | undefined;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.dcgis.boards_commissions_councils.32_governing_agency",
  });
  workbench.close();

  assertEquals(relationship, undefined);
  assertEquals(canonicalRelationship, undefined);
  assertEquals(reviewItems.length, 0);
});

Deno.test("DCGIS real estate commission legacy service-page rows do not emit stale Department of Buildings governing edges", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const recRows = {
    features: [{
      attributes: {
        ENTITY_ID: 117,
        NAME: "Real Estate Commission",
        SHORT_NAME: "Real Estate Commission",
        TYPE: "Commission",
        WEB_URL: "https://www.dcopla.com/realestate/",
        GOVERNING_AGENCY: "Department of Buildings",
        AUTHORIZING_ORDER_LAW: "D.C. Code § 47-2853.06",
        CLUSTER_DC: null,
      },
    }],
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(recRows);
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

  const relationship = workbench.db.prepare(
    `select review_status as reviewStatus
       from relationship_candidates
      where relationship_candidate_id = 'relationship.dcgis.boards_commissions_councils.117_governing_agency'`,
  ).get() as { reviewStatus: string } | undefined;
  const canonicalRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
       from canonical_relationships
      where relationship_id = 'dc.real_estate_commission:governed_by:dc.department_of_buildings'`,
  ).get() as { relationshipId: string } | undefined;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.dcgis.boards_commissions_councils.117_governing_agency",
  });
  workbench.close();

  assertEquals(relationship, undefined);
  assertEquals(canonicalRelationship, undefined);
  assertEquals(reviewItems.length, 0);
});

Deno.test("DCGIS OST commission rows do not emit the subordinate OST office as the governing agency", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const ostRows = {
    features: [{
      attributes: {
        ENTITY_ID: 76,
        NAME: "Commission on Out of School Time Grants and Youth Outcomes",
        SHORT_NAME: "Commission on Out of School Time Grants and Youth Outcomes",
        TYPE: "Commission",
        WEB_URL: null,
        GOVERNING_AGENCY: "Office of Out of School Time Grants and Youth Outcomes",
        AUTHORIZING_ORDER_LAW: "D.C. Law 21-261",
        CLUSTER_DC: null,
      },
    }],
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(ostRows);
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

  const relationship = workbench.db.prepare(
    `select review_status as reviewStatus
       from relationship_candidates
      where relationship_candidate_id = 'relationship.dcgis.boards_commissions_councils.76_governing_agency'`,
  ).get() as { reviewStatus: string } | undefined;
  const canonicalRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
       from canonical_relationships
      where relationship_id = 'dc.commission_on_out_of_school_time_grants_and_youth_outcomes:governed_by:dc.office_of_out_of_school_time_grants_and_youth_outcomes'`,
  ).get() as { relationshipId: string } | undefined;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.dcgis.boards_commissions_councils.76_governing_agency",
  });
  workbench.close();

  assertEquals(relationship, undefined);
  assertEquals(canonicalRelationship, undefined);
  assertEquals(reviewItems.length, 0);
});

Deno.test("DCGIS POST board MPD page rows do not emit stale MPD governing edges", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const postRows = {
    features: [{
      attributes: {
        ENTITY_ID: 113,
        NAME: "Police Officers Standards and Training Board (POST)",
        SHORT_NAME: "Police Officers Standards and Training Board (POST)",
        TYPE: "Board",
        WEB_URL:
          "https://mpdc.dc.gov/page/dc-post-board-police-officers-standards-and-training-board",
        GOVERNING_AGENCY: "Metropolitan Police Department",
        AUTHORIZING_ORDER_LAW: "D.C. Code § 5-107.03",
        CLUSTER_DC: null,
      },
    }],
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(postRows);
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

  const relationship = workbench.db.prepare(
    `select review_status as reviewStatus
       from relationship_candidates
      where relationship_candidate_id = 'relationship.dcgis.boards_commissions_councils.113_governing_agency'`,
  ).get() as { reviewStatus: string } | undefined;
  const canonicalRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
       from canonical_relationships
      where relationship_id = 'dc.police_officers_standards_and_training_board:governed_by:dc.metropolitan_police_department'`,
  ).get() as { relationshipId: string } | undefined;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.dcgis.boards_commissions_councils.113_governing_agency",
  });
  workbench.close();

  assertEquals(relationship, undefined);
  assertEquals(canonicalRelationship, undefined);
  assertEquals(reviewItems.length, 0);
});

Deno.test("governance suffix public-body leads become deferred relationship review work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  async function importComparisonCandidate(input: {
    sourceId: string;
    title: string;
    candidateId: string;
    name: string;
    kind: string;
    officialUrl?: string;
  }) {
    await workbench.importConnectorResult({
      source: {
        sourceId: input.sourceId,
        title: input.title,
        kind: "fixture",
        accessMethod: "fixture",
        baseUrl: `https://example.com/${input.sourceId}`,
      },
      endpointResults: [{
        endpoint: {
          endpointId: `${input.sourceId}.main`,
          sourceId: input.sourceId,
          title: `${input.title} rows`,
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
          contentText: JSON.stringify({ name: input.name }),
        }],
        parsed: {
          items: [{
            itemKey: `${input.candidateId}.row`,
            itemType: "fixture_row",
            title: input.name,
            body: { name: input.name },
          }],
          entityCandidates: [{
            candidateId: input.candidateId,
            sourceItemKey: `${input.candidateId}.row`,
            proposedEntityId: buildEntityId(input.name),
            name: input.name,
            kind: input.kind,
            officialUrl: input.officialUrl,
            confidence: 1,
            evidence: [{
              fieldPath: "name",
              observedValue: input.name,
            }],
          }],
        },
      }],
    }, dataDir);
  }

  await importComparisonCandidate({
    sourceId: "council.committees",
    title: "Council Committees Fixture",
    candidateId: "candidate.council.committees.example_authority",
    name: "Example Authority",
    kind: "public_body",
  });
  await importComparisonCandidate({
    sourceId: "dcgis.boards_commissions_councils",
    title: "DCGIS Fixture",
    candidateId: "candidate.dcgis.boards_commissions_councils.example_authority_board",
    name: "Example Authority Board of Directors",
    kind: "board",
    officialUrl: "https://example.com/authority-board",
  });
  await importComparisonCandidate({
    sourceId: "council.committees",
    title: "Council Committees Fixture",
    candidateId: "candidate.council.committees.seu",
    name: "Sustainable Energy Utility",
    kind: "public_body",
  });
  await importComparisonCandidate({
    sourceId: "dcgis.boards_commissions_councils",
    title: "DCGIS Fixture",
    candidateId: "candidate.dcgis.boards_commissions_councils.seu_advisory_board",
    name: "Sustainable Energy Utility Advisory Board",
    kind: "board",
    officialUrl: "https://doee.dc.gov/service/dc-seu-advisory-board",
  });

  const relationship = workbench.db.prepare(
    `select relationship_candidate_id as relationshipCandidateId,
            from_entity_ref as fromEntityRef,
            to_entity_ref as toEntityRef,
            relationship_type as relationshipType,
            needs_review as needsReview,
            review_status as reviewStatus
     from relationship_candidates
     where relationship_candidate_id like 'relationship.public_body_linkage.%'`,
  ).get() as {
    relationshipCandidateId: string;
    fromEntityRef: string;
    toEntityRef: string;
    relationshipType: string;
    needsReview: number;
    reviewStatus: string;
  } | undefined;
  assert(relationship);
  assertEquals(relationship.fromEntityRef, "dc.example_authority");
  assertEquals(
    relationship.toEntityRef,
    "dc.example_authority_board_of_directors",
  );
  assertEquals(relationship.relationshipType, "governed_by");
  assertEquals(relationship.needsReview, 1);
  assertEquals(relationship.reviewStatus, "pending");

  const reviewItem = workbench.listReviewItems({
    type: "relationship_candidate",
    status: "open",
  }).find((item) => item.subjectId === relationship.relationshipCandidateId);
  assert(reviewItem);
  assertEquals(reviewItem.defaultAction, "defer");
  assertEquals(reviewItem.reason, "Review public-body governance-suffix linkage lead");
  assertEquals(
    reviewItem.details.whyDeferred,
    "The source names a related board, but suffix similarity does not prove governance or that the link should be materialized.",
  );

  const accepted = workbench.db.prepare(
    "select count(*) as count from canonical_relationships where relationship_type = 'governed_by' and from_entity_id = ? and to_entity_id = ?",
  ).get(relationship.fromEntityRef, relationship.toEntityRef) as { count: number };
  assertEquals(accepted.count, 0);

  const advisoryLead = workbench.db.prepare(
    `select count(*) as count
     from relationship_candidates
     where relationship_candidate_id like 'relationship.public_body_linkage.%'
       and from_entity_ref = 'dc.sustainable_energy_utility'
       and to_entity_ref = 'dc.sustainable_energy_utility_advisory_board'`,
  ).get() as { count: number };
  assertEquals(advisoryLead.count, 0);
  workbench.close();
});

Deno.test("known governance-suffix public-body links auto-accept when they are source-backed safe relationships", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  async function importComparisonCandidate(input: {
    sourceId: string;
    title: string;
    candidateId: string;
    name: string;
    kind: string;
    officialUrl?: string;
  }) {
    await workbench.importConnectorResult({
      source: {
        sourceId: input.sourceId,
        title: input.title,
        kind: "fixture",
        accessMethod: "fixture",
        baseUrl: `https://example.com/${input.sourceId}`,
      },
      endpointResults: [{
        endpoint: {
          endpointId: `${input.sourceId}.main`,
          sourceId: input.sourceId,
          title: `${input.title} rows`,
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
          contentText: JSON.stringify({ name: input.name }),
        }],
        parsed: {
          items: [{
            itemKey: `${input.candidateId}.row`,
            itemType: "fixture_row",
            title: input.name,
            body: { name: input.name },
          }],
          entityCandidates: [{
            candidateId: input.candidateId,
            sourceItemKey: `${input.candidateId}.row`,
            proposedEntityId: buildEntityId(input.name),
            name: input.name,
            kind: input.kind,
            officialUrl: input.officialUrl,
            confidence: 1,
            evidence: [{
              fieldPath: "name",
              observedValue: input.name,
            }],
          }],
        },
      }],
    }, dataDir);
  }

  await importComparisonCandidate({
    sourceId: "council.committees",
    title: "Council Committees Fixture",
    candidateId: "candidate.council.committees.mwaa",
    name: "Metropolitan Washington Airports Authority",
    kind: "public_body",
  });
  await importComparisonCandidate({
    sourceId: "dcgis.boards_commissions_councils",
    title: "DCGIS Fixture",
    candidateId: "candidate.dcgis.boards_commissions_councils.mwaa_board",
    name: "Metropolitan Washington Airports Authority Board of Directors",
    kind: "board",
    officialUrl: "https://www.mwaa.com/about/board-directors",
  });

  const candidate = workbench.db.prepare(
    `select review_status as reviewStatus,
            needs_review as needsReview
       from relationship_candidates
      where relationship_candidate_id = ?`,
  ).get(
    "relationship.public_body_linkage.dc_metropolitan_washington_airports_authority_governed_by_dc_metropolitan_washington_airports_authority_board_of_directors",
  ) as { reviewStatus: string; needsReview: number } | undefined;
  const accepted = workbench.db.prepare(
    "select count(*) as count from canonical_relationships where relationship_id = ?",
  ).get(
    "dc.metropolitan_washington_airports_authority:governed_by:dc.metropolitan_washington_airports_authority_board_of_directors",
  ) as { count: number };
  const reviewItems = workbench.listReviewItems({
    type: "relationship_candidate",
    status: "open",
  }).filter((item) =>
    item.subjectId ===
      "relationship.public_body_linkage.dc_metropolitan_washington_airports_authority_governed_by_dc_metropolitan_washington_airports_authority_board_of_directors"
  );
  workbench.close();

  assertEquals(candidate?.reviewStatus, "accepted");
  assertEquals(candidate?.needsReview, 1);
  assertEquals(accepted.count, 1);
  assertEquals(reviewItems.length, 0);
});
