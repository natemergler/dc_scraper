import { assert, assertEquals, assertRejects } from "@std/assert";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import {
  dcgisBoardsCommissionsCouncilsMetadataFixture,
  dcgisBoardsCommissionsCouncilsRowsFixture,
  dcgisMetadataFixture,
} from "./helpers/v2_fixtures.ts";

Deno.test("DCGIS connector fails loudly on ArcGIS query error payloads", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify({
            error: {
              code: 400,
              message: "Failed to execute query.",
              details: ["Invalid field name"],
            },
          });
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await assertRejects(
    () => getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    Error,
    "dcgis.agencies Failed to execute query.: Invalid field name",
  );
});

Deno.test("DCGIS legal refs resolve exact D.C. law titles through the official law index", async () => {
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
    heading: "Green Finance Authority Establishment Act of 2018",
    path: "/us/dc/council/laws/22-155",
  }];
  const fetchedUrls: string[] = [];
  const fetcher = async (url: string) => {
    fetchedUrls.push(url);
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
  const parsed = result.endpointResults[0].parsed;
  const legalRef = parsed?.legalRefs?.[0];
  assertEquals(fetchedUrls.includes(lawIndexUrl), true);
  assertEquals(result.endpointResults[0].artifacts.length, 3);
  assertEquals(result.endpointResults[0].artifacts[2].fetchedUrl, lawIndexUrl);
  assertEquals(legalRef?.refType, "dc_law");
  assertEquals(
    legalRef?.citationText,
    "District of Columbia Green Finance Authority Establishment Act of 2018",
  );
  assertEquals(legalRef?.normalizedCitation, "D.C. Law 22-155");
  assertEquals(legalRef?.url, "https://code.dccouncil.gov/us/dc/council/laws/22-155");
  assertEquals(legalRef?.needsReview, false);
  assertEquals(legalRef?.evidence?.map((row) => row.fieldPath), [
    "LEGISLATION",
    "DCCouncil law index",
  ]);
  assertEquals(legalRef?.evidence?.[1]?.artifactIndex, 2);
});

Deno.test("DCGIS legal refs keep duplicate D.C. law title matches in review", async () => {
  const lawIndexUrl = "https://raw.githubusercontent.com/DCCouncil/law-html/master/index.json";
  const rowsWithDuplicateTitle = {
    features: [{
      attributes: {
        OBJECTID: 1,
        AGENCY_ID: 2001,
        AGENCY_NAME: "Duplicate Title Agency",
        TYPE: "Agency",
        WEB_URL: "https://example.dc.gov/duplicate-title",
        LEGISLATION: "District of Columbia Reused Amendment Act of 2013",
      },
    }],
  };
  const lawIndexFixture = [{
    t: "D.C. Law 20-1. Reused Amendment Act of 2013.",
    p: "/us/dc/council/laws/20-1",
    sc: "D.C. Law 20-1",
  }, {
    t: "D.C. Law 20-2. Reused Amendment Act of 2013.",
    p: "/us/dc/council/laws/20-2",
    sc: "D.C. Law 20-2",
  }];
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(rowsWithDuplicateTitle);
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
  const legalRef = result.endpointResults[0].parsed?.legalRefs?.[0];
  assertEquals(legalRef?.refType, "unknown");
  assertEquals(legalRef?.normalizedCitation, undefined);
  assertEquals(legalRef?.needsReview, true);
  assertEquals(legalRef?.evidence?.map((row) => row.fieldPath), ["LEGISLATION"]);
});

Deno.test("DCGIS boards, commissions, and councils connector preserves overlaps conservatively", async () => {
  const rowsWithCompoundLegalRef = {
    features: [
      ...dcgisBoardsCommissionsCouncilsRowsFixture.features,
      {
        attributes: {
          ENTITY_ID: 126,
          NAME: "Forensic Science Advisory Board",
          SHORT_NAME: "Forensic Science Advisory Board",
          ACRONYM: null,
          GOVERNING_AGENCY: "Office of the Chief Medical Examiner",
          ADDRESS: null,
          TYPE: "Board",
          WEB_URL: "https://ocme.dc.gov/",
          AUTHORIZING_ORDER_LAW:
            "DC. ST. D.I., T.1, Ch 15, Subch. III, Pt. 1, 1979 Plan 2 (IV. B. (2)); 5-1402 et seq.",
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
          return JSON.stringify(rowsWithCompoundLegalRef);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("dcgis.boards_commissions_councils").run(
    createConnectorContext({ fetcher }),
  );
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 4);
  assertEquals(parsed.entityCandidates?.length, 4);
  assertEquals(parsed.relationshipCandidates?.length, 3);
  assertEquals(parsed.legalRefs?.length, 5);
  const ancLegalRef = parsed.legalRefs?.find((legalRef) =>
    legalRef.legalRefId === "legal.dcgis.boards_commissions_councils.25_legislation"
  );
  assertEquals(ancLegalRef?.refType, "dc_bill");
  assertEquals(ancLegalRef?.normalizedCitation, "D.C. Bill B21-0697");
  assertEquals(ancLegalRef?.evidence?.[0]?.fieldPath, "AUTHORIZING_ORDER_LAW");
  const compoundLegalRefs = parsed.legalRefs
    ?.filter((legalRef) => legalRef.sourceItemKey === "126")
    .map((legalRef) => ({
      refType: legalRef.refType,
      normalizedCitation: legalRef.normalizedCitation,
      needsReview: legalRef.needsReview,
    }));
  assertEquals(compoundLegalRefs, [
    {
      refType: "reorganization_plan",
      normalizedCitation: "Reorganization Plan No. 2 of 1979",
      needsReview: false,
    },
    { refType: "dc_code", normalizedCitation: "D.C. Code 5-1402", needsReview: false },
  ]);
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Board of Accountancy" && candidate.duplicateHint ===
        "https://www.dcopla.com/accountancy/"
    ),
  );
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Rental Housing Commission" && candidate.kind === "commission"
    ),
  );
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Advisory Neighborhood Commissions" && candidate.kind === "commission"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by" &&
      candidate.rawValue === "Department of Housing and Community Development"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by" &&
      candidate.rawValue === "DC Department of Licensing and Consumer Protection"
    ),
  );
  assert(
    parsed.reviewItems?.some((item) =>
      item.subjectId === "candidate.dcgis.boards_commissions_councils.29"
    ),
  );
});

Deno.test("DCGIS public-body derivation requires source URL and legal-authority evidence", async () => {
  const rows = {
    features: [{
      attributes: {
        ENTITY_ID: 5001,
        NAME: "Example Administration",
        SHORT_NAME: "Example Administration",
        ACRONYM: null,
        GOVERNING_AGENCY: "Example Administration",
        ADDRESS: null,
        TYPE: "Board",
        WEB_URL: "https://example.dc.gov/",
        AUTHORIZING_ORDER_LAW: "D.C. Code § 1-123",
        CLUSTER_DC: null,
      },
    }, {
      attributes: {
        ENTITY_ID: 5002,
        NAME: "Sample Administration",
        SHORT_NAME: "Sample Administration",
        ACRONYM: null,
        GOVERNING_AGENCY: "Sample Administration",
        ADDRESS: null,
        TYPE: "Board",
        WEB_URL: "https://example.dc.gov/page/sample-board",
        AUTHORIZING_ORDER_LAW: null,
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
          return JSON.stringify(rows);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  const result = await getConnector("dcgis.boards_commissions_councils").run(
    createConnectorContext({ fetcher }),
  );
  const parsed = result.endpointResults[0].parsed;

  assertEquals(
    parsed?.entityCandidates?.map((candidate) => candidate.name),
    ["Example Administration", "Sample Administration"],
  );
  assertEquals(parsed?.relationshipCandidates?.length, 0);
  assert(
    parsed?.reviewItems?.some((item) =>
      item.subjectId === "candidate.dcgis.boards_commissions_councils.5001"
    ),
  );
  assert(
    parsed?.reviewItems?.some((item) =>
      item.subjectId === "candidate.dcgis.boards_commissions_councils.5002"
    ),
  );
});

Deno.test("DCGIS known official URLs fill blank board urls conservatively", async () => {
  const rows = {
    features: [{
      attributes: {
        ENTITY_ID: 121,
        NAME: "Science Advisory Board",
        SHORT_NAME: "Science Advisory Board",
        ACRONYM: null,
        GOVERNING_AGENCY: "Department of Forensic Sciences",
        ADDRESS: null,
        TYPE: "Board",
        WEB_URL: null,
        AUTHORIZING_ORDER_LAW: null,
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
          return JSON.stringify(rows);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  const result = await getConnector("dcgis.boards_commissions_councils").run(
    createConnectorContext({ fetcher }),
  );
  const candidate = result.endpointResults[0].parsed?.entityCandidates?.[0];

  assertEquals(candidate?.name, "Science Advisory Board");
  assertEquals(candidate?.officialUrl, "https://dfs.dc.gov/page/science-advisory-board");
});
