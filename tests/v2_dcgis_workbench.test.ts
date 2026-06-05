import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildEntityId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  dcgisBoardsCommissionsCouncilsMetadataFixture,
  dcgisMetadataFixture,
  dcgisRowsFixture,
} from "./helpers/v2_fixtures.ts";
import { syntheticCustomEntitySourceResult } from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("multi-artifact connector imports keep schema and row evidence on the correct artifacts", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const progressMessages: string[] = [];
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(dcgisRowsFixture);
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
    await getConnector("dcgis.agencies").run(
      createConnectorContext({
        fetcher,
        onProgress: (event) => progressMessages.push(event.message),
      }),
    ),
    dataDir,
  );
  const schemaArtifact = workbench.db.prepare(
    `select source_artifacts.path as artifactPath
     from source_fields
     join source_artifacts on source_artifacts.artifact_id = source_fields.artifact_id
     where source_fields.endpoint_id = ? and source_fields.field_name = ?`,
  ).get("dcgis.agencies.main", "AGENCY_NAME") as { artifactPath: string };
  const rowArtifact = workbench.db.prepare(
    `select source_artifacts.path as artifactPath,
            source_artifacts.fetched_url as fetchedUrl
     from source_items
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     where source_items.endpoint_id = ? and source_items.item_key = ?`,
  ).get("dcgis.agencies.main", "1001") as { artifactPath: string; fetchedUrl: string };
  const evidence = workbench.db.prepare(
    `select artifact_path as artifactPath
     from entity_candidate_evidence
     where candidate_id = ?
     order by evidence_id
     limit 1`,
  ).get("candidate.dcgis.agencies.1001") as { artifactPath: string };
  workbench.close();
  assertEquals(progressMessages, [
    "Fetching DCGIS table metadata",
    "Fetching DCGIS rows starting at 1 (page 1, up to 1000)",
  ]);
  assertStringIncludes(rowArtifact.fetchedUrl, "outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME");
  assert(!rowArtifact.fetchedUrl.includes("outFields=*"));
  assert(schemaArtifact.artifactPath !== rowArtifact.artifactPath);
  assertEquals(evidence.artifactPath, rowArtifact.artifactPath);
});

Deno.test("DCGIS paged row evidence points to the row page artifact", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const metadata = { ...dcgisMetadataFixture, maxRecordCount: 1 };
  const firstPage = {
    features: [{
      attributes: {
        OBJECTID: 1,
        AGENCY_ID: "2001",
        AGENCY_NAME: "First DCGIS Agency",
        TYPE: "agency",
        WEB_URL: "https://example.com/first",
      },
    }],
  };
  const secondPage = {
    features: [{
      attributes: {
        OBJECTID: 2,
        AGENCY_ID: "2002",
        AGENCY_NAME: "Second DCGIS Agency",
        TYPE: "agency",
        WEB_URL: "https://example.com/second",
      },
    }],
  };
  const emptyPage = { features: [] };
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(metadata);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1&f=json":
          return JSON.stringify(firstPage);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=1&resultRecordCount=1&f=json":
          return JSON.stringify(secondPage);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=2&resultRecordCount=1&f=json":
          return JSON.stringify(emptyPage);
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
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  const secondRowArtifact = workbench.db.prepare(
    `select source_artifacts.path as artifactPath,
            source_artifacts.fetched_url as fetchedUrl
     from source_items
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     where source_items.endpoint_id = ? and source_items.item_key = ?`,
  ).get("dcgis.agencies.main", "2002") as { artifactPath: string; fetchedUrl: string };
  const secondEvidence = workbench.db.prepare(
    `select artifact_path as artifactPath
     from entity_candidate_evidence
     where candidate_id = ?
       and field_path = 'NAME'
     limit 1`,
  ).get("candidate.dcgis.agencies.2002") as { artifactPath: string };
  const rowArtifactCount = workbench.db.prepare(
    "select count(*) as count from source_artifacts where endpoint_id = ? and kind = 'rows'",
  ).get("dcgis.agencies.main") as { count: number };
  workbench.close();

  assertEquals(rowArtifactCount.count, 3);
  assertStringIncludes(secondRowArtifact.fetchedUrl, "resultOffset=1");
  assertEquals(secondEvidence.artifactPath, secondRowArtifact.artifactPath);
});

Deno.test("DCGIS resolved law-title legal refs import as accepted entity attachments", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const lawIndexUrl = "https://raw.githubusercontent.com/DCCouncil/law-html/master/index.json";
  const rowsWithLawTitle = {
    features: [{
      attributes: {
        OBJECTID: 1,
        AGENCY_ID: 1172,
        AGENCY_NAME: "District of Columbia Green Finance Authority",
        TYPE: "Authority",
        BRANCH: "Independent",
        MAYORAL_CLUSTER: null,
        WEB_URL: "https://dcgreenbank.com/",
        LEGISLATION: "District of Columbia Green Finance Authority Establishment Act of 2018",
      },
    }],
  };
  const lawIndexFixture = [{
    citation: "D.C. Law 22-155",
    heading: "D.C. Law 22-155. Green Finance Authority Establishment Act of 2018.",
    path: "/us/dc/council/laws/22-155",
  }];
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(rowsWithLawTitle);
        case lawIndexUrl:
          return JSON.stringify(lawIndexFixture);
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

  const result = await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher }));
  await workbench.importConnectorResult(result, dataDir);
  const entityId = buildEntityId("District of Columbia Green Finance Authority");
  const legalRef = workbench.db.prepare(
    "select ref_type as refType, normalized_citation as normalizedCitation, review_status as reviewStatus from legal_refs where legal_ref_id = ?",
  ).get("legal.dcgis.agencies.1172_legislation") as {
    refType: string;
    normalizedCitation: string;
    reviewStatus: string;
  };
  const attachment = workbench.db.prepare(
    "select entity_id as entityId from entity_legal_refs where legal_ref_id = ?",
  ).get("legal.dcgis.agencies.1172_legislation") as { entityId: string };
  const openReviewCount = workbench.db.prepare(
    "select count(*) as count from review_items where subject_id = ? and status = 'open'",
  ).get("legal.dcgis.agencies.1172_legislation") as { count: number };
  workbench.close();

  assertEquals(legalRef, {
    refType: "dc_law",
    normalizedCitation: "D.C. Law 22-155",
    reviewStatus: "accepted",
  });
  assertEquals(attachment.entityId, entityId);
  assertEquals(openReviewCount.count, 0);
});

Deno.test("DCGIS known agency aliases fill official URLs on existing oversight-backed entities", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "council.committees",
      candidateId: "candidate.council.committees.office_of_zoning",
      sourceItemKey: "council-office-of-zoning",
      proposedEntityId: "dc.office_of_zoning",
      name: "Office of Zoning",
      kind: "office",
      observedName: "Office of Zoning",
      confidence: 0.95,
    }),
    dataDir,
  );

  const rows = {
    features: [{
      attributes: {
        OBJECTID: 1,
        AGENCY_ID: 1019,
        AGENCY_NAME: "DC Office of Zoning",
        TYPE: "Office",
        WEB_URL: "https://dcoz.dc.gov/",
        BRANCH: "Independent",
        MAYORAL_CLUSTER: null,
        LEGISLATION: null,
      },
    }],
  };
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(rows);
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
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const canonical = workbench.db.prepare(
    `select name,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.office_of_zoning'`,
  ).get() as {
    name: string;
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const splitCanonical = workbench.db.prepare(
    `select count(*) as count
     from canonical_entities
     where entity_id = 'dc.dc_office_of_zoning'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(canonical.name, "Office of Zoning");
  assertEquals(canonical.officialUrl, "https://dcoz.dc.gov/");
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [
    "candidate.council.committees.office_of_zoning",
    "candidate.dcgis.agencies.1019",
  ]);
  assertEquals(splitCanonical.count, 0);
});

Deno.test("DCGIS bare year-number legal refs stay pending instead of importing as D.C. Code", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const rowsWithBareYearNumber = {
    features: [{
      attributes: {
        ENTITY_ID: 999,
        NAME: "Example Advisory Council",
        SHORT_NAME: "EAC",
        TYPE: "Council",
        WEB_URL: "https://example.dc.gov/eac",
        GOVERNING_AGENCY: null,
        AUTHORIZING_ORDER_LAW: "1993-148",
        CLUSTER_DC: null,
      },
    }],
  };
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(rowsWithBareYearNumber);
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

  const result = await getConnector("dcgis.boards_commissions_councils").run(
    createConnectorContext({ fetcher }),
  );
  await workbench.importConnectorResult(result, dataDir);
  const legalRef = result.endpointResults[0].parsed?.legalRefs?.[0];
  const row = workbench.db.prepare(
    "select ref_type as refType, normalized_citation as normalizedCitation, review_status as reviewStatus from legal_refs where legal_ref_id = ?",
  ).get("legal.dcgis.boards_commissions_councils.999_legislation") as {
    refType: string;
    normalizedCitation: string | null;
    reviewStatus: string;
  };
  const openReviewCount = workbench.db.prepare(
    "select count(*) as count from review_items where subject_id = ? and status = 'open'",
  ).get("legal.dcgis.boards_commissions_councils.999_legislation") as { count: number };
  workbench.close();

  assertEquals(legalRef?.refType, "unknown");
  assertEquals(legalRef?.normalizedCitation, undefined);
  assertEquals(legalRef?.needsReview, true);
  assertEquals(row, {
    refType: "unknown",
    normalizedCitation: null,
    reviewStatus: "pending",
  });
  assertEquals(openReviewCount.count, 1);
});

Deno.test("DCGIS malformed act labels auto-accept when law XML confirms the official act", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const rowsWithMalformedAct = {
    features: [{
      attributes: {
        ENTITY_ID: 76,
        NAME: "Out of School Time Grants and Youth Outcomes Commission",
        SHORT_NAME: "OST Commission",
        TYPE: "Commission",
        WEB_URL: "https://example.dc.gov/ost",
        GOVERNING_AGENCY: null,
        AUTHORIZING_ORDER_LAW: "D.G. AGT 21-679",
        CLUSTER_DC: null,
      },
    }],
  };
  const fetchedUrls: string[] = [];
  const fetcher = async (url: string) => {
    fetchedUrls.push(url);
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(rowsWithMalformedAct);
        case "https://raw.githubusercontent.com/DCCouncil/law-xml/main/us/dc/council/periods/21/index.xml":
          return `
            <container>
              <xi:include href="./laws/21-260.xml"/>
              <xi:include href="./laws/21-261.xml"/>
            </container>
          `;
        case "https://raw.githubusercontent.com/DCCouncil/law-xml/main/us/dc/council/periods/21/laws/21-260.xml":
          return `
            <document id="D.C. Law 21-260">
              <num type="law">21-260</num>
              <num type="act">21-678</num>
            </document>
          `;
        case "https://raw.githubusercontent.com/DCCouncil/law-xml/main/us/dc/council/periods/21/laws/21-261.xml":
          return `
            <document id="D.C. Law 21-261">
              <num type="law">21-261</num>
              <num type="bill">21-865</num>
              <num type="act">21-679</num>
              <heading type="short">Office of Out of School Time Grants and Youth Outcomes Establishment Act of 2016</heading>
            </document>
          `;
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

  const result = await getConnector("dcgis.boards_commissions_councils").run(
    createConnectorContext({ fetcher }),
  );
  await workbench.importConnectorResult(result, dataDir);
  const legalRef = result.endpointResults[0].parsed?.legalRefs?.[0];
  const row = workbench.db.prepare(
    "select ref_type as refType, normalized_citation as normalizedCitation, review_status as reviewStatus from legal_refs where legal_ref_id = ?",
  ).get("legal.dcgis.boards_commissions_councils.76_legislation") as {
    refType: string;
    normalizedCitation: string | null;
    reviewStatus: string;
  };
  const reviewItem = workbench.db.prepare(
    "select default_action as defaultAction, details_json as detailsJson from review_items where subject_id = ? and status = 'open'",
  ).get("legal.dcgis.boards_commissions_councils.76_legislation") as {
    defaultAction: string;
    detailsJson: string;
  } | undefined;
  workbench.close();
  assertEquals(
    fetchedUrls.includes("https://raw.githubusercontent.com/DCCouncil/law-html/master/index.json"),
    false,
  );
  assertEquals(fetchedUrls, [
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json",
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json",
    "https://raw.githubusercontent.com/DCCouncil/law-xml/main/us/dc/council/periods/21/index.xml",
    "https://raw.githubusercontent.com/DCCouncil/law-xml/main/us/dc/council/periods/21/laws/21-260.xml",
    "https://raw.githubusercontent.com/DCCouncil/law-xml/main/us/dc/council/periods/21/laws/21-261.xml",
  ]);
  assertEquals(result.endpointResults[0].artifacts.length, 4);
  assertEquals(legalRef?.refType, "dc_act");
  assertEquals(legalRef?.normalizedCitation, "D.C. Act 21-679");
  assertEquals(legalRef?.needsReview, false);
  assertEquals(row, {
    refType: "dc_act",
    normalizedCitation: "D.C. Act 21-679",
    reviewStatus: "accepted",
  });
  assertEquals(reviewItem, undefined);
});

Deno.test("dcgis agency taxonomy labels do not create branch review slices", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const mixedBranchRowsFixture = {
    features: [
      ...dcgisRowsFixture.features,
      {
        attributes: {
          AGENCY_ID: 2001,
          AGENCY_NAME: "District of Columbia Courts",
          TYPE: "Agency",
          BRANCH: "Judicial",
          MAYORAL_CLUSTER: "",
          WEB_URL: "https://dccourts.gov/",
          LEGISLATION: "",
        },
      },
      {
        attributes: {
          AGENCY_ID: 3001,
          AGENCY_NAME: "Example Residual Agency",
          TYPE: "Agency",
          BRANCH: "Other",
          MAYORAL_CLUSTER: "",
          WEB_URL: "",
          LEGISLATION: "",
        },
      },
      {
        attributes: {
          AGENCY_ID: 3002,
          AGENCY_NAME: "Example Settlement Fund",
          TYPE: "Budgetary",
          BRANCH: "Other",
          MAYORAL_CLUSTER: "",
          WEB_URL: "",
          LEGISLATION: "",
        },
      },
    ],
  };
  const bodyForUrl = (url: string): string => {
    switch (url) {
      case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
        return JSON.stringify(dcgisMetadataFixture);
      case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
        return JSON.stringify(mixedBranchRowsFixture);
      default:
        throw new Error(`Unexpected url ${url}`);
    }
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => bodyForUrl(url),
    json: async <T>() => JSON.parse(bodyForUrl(url)) as T,
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const candidateCount = workbench.db.prepare(
    "select count(*) as count from entity_candidates where candidate_id like 'candidate.dcgis.agencies.%'",
  ).get() as { count: number };
  const relationshipCount = workbench.db.prepare(
    "select count(*) as count from relationship_candidates where relationship_candidate_id like 'relationship.dcgis.agencies.%'",
  ).get() as { count: number };
  const remainingItems = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "part_of",
    subjectPrefix: "relationship.dcgis.agencies",
  });
  workbench.close();

  assertEquals(candidateCount.count, 5);
  assertEquals(relationshipCount.count, 0);
  assertEquals(remainingItems.length, 0);
});

Deno.test("dcgis budgetary agency rows without human-readable names stay as source evidence only", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const rowsFixture = {
    features: [{
      attributes: {
        AGENCY_ID: 3099,
        AGENCY_NAME: null,
        TYPE: "Budgetary",
        BRANCH: "Other",
        MAYORAL_CLUSTER: "",
        WEB_URL: "",
        LEGISLATION: "",
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
          return JSON.stringify(rowsFixture);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return dcgisMetadataFixture as T;
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return rowsFixture as T;
        default:
          throw new Error(`Unexpected url ${url}`) as T;
      }
    },
  });

  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const sourceItemCount = workbench.db.prepare(
    "select count(*) as count from source_items where source_id = 'dcgis.agencies'",
  ).get() as { count: number };
  const entityCandidateCount = workbench.db.prepare(
    "select count(*) as count from entity_candidates where candidate_id like 'candidate.dcgis.agencies.%'",
  ).get() as { count: number };
  const reviewItemCount = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix: "candidate.dcgis.agencies",
  }).length;
  workbench.close();

  assertEquals(sourceItemCount.count, 1);
  assertEquals(entityCandidateCount.count, 0);
  assertEquals(reviewItemCount, 0);
});

Deno.test("DCGIS known board URLs fill canonical official URLs during auto-promotion", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const rowsFixture = {
    features: [
      {
        attributes: {
          OBJECTID: 121,
          ENTITY_ID: 121,
          NAME: "Science Advisory Board",
          SHORT_NAME: "Science Advisory Board",
          TYPE: "Board",
          WEB_URL: "",
          GOVERNING_AGENCY: null,
          AUTHORIZING_ORDER_LAW: null,
          CLUSTER_DC: null,
        },
      },
      {
        attributes: {
          OBJECTID: 136,
          ENTITY_ID: 136,
          NAME: "Metropolitan Washington Council of Governments Board of Directors (COG)",
          SHORT_NAME: "MWCOG Board",
          TYPE: "Board",
          WEB_URL: "",
          GOVERNING_AGENCY: null,
          AUTHORIZING_ORDER_LAW: null,
          CLUSTER_DC: null,
        },
      },
    ],
  };

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(rowsFixture);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return dcgisBoardsCommissionsCouncilsMetadataFixture as T;
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return rowsFixture as T;
        default:
          throw new Error(`Unexpected url ${url}`) as T;
      }
    },
  });

  await workbench.importConnectorResult(
    await getConnector("dcgis.boards_commissions_councils").run(
      createConnectorContext({ fetcher }),
    ),
    dataDir,
  );

  const scienceBoard = workbench.db.prepare(
    `select official_url as officialUrl
     from canonical_entities
     where entity_id = 'dc.science_advisory_board'`,
  ).get() as { officialUrl: string | null } | undefined;
  const cogBoard = workbench.db.prepare(
    `select official_url as officialUrl
     from canonical_entities
     where entity_id = 'dc.metropolitan_washington_council_of_governments_board_of_directors'`,
  ).get() as { officialUrl: string | null } | undefined;
  workbench.close();

  assertEquals(scienceBoard?.officialUrl, "https://dfs.dc.gov/page/science-advisory-board");
  assertEquals(
    cogBoard?.officialUrl,
    "https://www.mwcog.org/committees/cog-board-of-directors/",
  );
});
