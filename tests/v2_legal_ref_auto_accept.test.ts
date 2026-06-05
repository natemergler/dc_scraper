import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { DC_LAW_INDEX_URL } from "../src/v2/connectors/dc_law_index.ts";
import { buildV2Release } from "../src/v2/release.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { dcgisBoardsCommissionsCouncilsMetadataFixture } from "./helpers/v2_fixtures.ts";
import { legalEntrypointsFixture } from "./helpers/v2_fixtures.ts";
import { syntheticLegalRefSourceResult } from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("recognized legal entrypoints auto-accept without generic navigation review", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: async (url: string) => ({
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
    }),
  }));

  await workbench.importConnectorResult(result, dataDir);

  const statuses = workbench.db.prepare(
    "select review_status as reviewStatus, count(*) as count from legal_refs group by review_status",
  ).all() as Array<{ reviewStatus: string; count: number }>;
  const statusCounts = new Map(statuses.map((row) => [row.reviewStatus, row.count]));
  const openItems = workbench.listReviewItems({ mode: "legal", status: "open" });
  workbench.close();

  assertEquals(statusCounts.get("accepted"), 3);
  assertEquals(statusCounts.get("pending"), undefined);
  assertEquals(openItems.length, 0);
});

Deno.test("recognized legal entrypoints auto-accept and update release status truth", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const outDir = join(dir, "release");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: async (url: string) => ({
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
    }),
  }));
  await workbench.importConnectorResult(result, dataDir);

  const items = workbench.listReviewItems({ mode: "legal" });
  assertEquals(items.length, 0);

  const resolvedItems = workbench.listReviewItems({ mode: "legal", status: "resolved" });
  assertEquals(resolvedItems.length, 3);
  await buildV2Release(workbench, outDir);
  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    release_summary: {
      legal_refs_by_review_status: Array<{ review_status: string; count: number }>;
      legal_refs_by_type: Array<{ ref_type: string; count: number }>;
    };
  };
  const statuses = new Map(
    manifest.release_summary.legal_refs_by_review_status.map((row) => [
      row.review_status,
      row.count,
    ]),
  );
  const types = new Map(
    manifest.release_summary.legal_refs_by_type.map((row) => [row.ref_type, row.count]),
  );
  const legalRefs = workbench.db.prepare(
    "select citation_text as citationText from legal_refs order by citation_text",
  ).all() as Array<{ citationText: string }>;
  workbench.close();
  assertEquals(statuses.get("accepted"), 3);
  assertEquals(types.get("dc_code"), 1);
  assertEquals(types.get("dc_register"), 1);
  assertEquals(types.get("mayors_order"), 1);
  assert(!legalRefs.some((row) => row.citationText === "Laws, Regulations and Courts"));
  assert(!legalRefs.some((row) => row.citationText === "Mayor"));
});

Deno.test("recognized legal citation families auto-accept on current schema", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  for (
    const [legalRefId, citationText] of [
      ["legal.test.signature.legal_refs.dc_law", "D.C. Law 22-155"],
      ["legal.test.signature.legal_refs.dc_act", "REACH Act (D.C. Act 23-521)"],
      ["legal.test.signature.legal_refs.public_law", "Public Law 89-774"],
      ["legal.test.signature.legal_refs.us_code", "33 U.S. Code § 1267"],
      ["legal.test.signature.legal_refs.dc_bill", "B21-0697"],
      [
        "legal.test.signature.legal_refs.reorganization_plan",
        "DC ST D.I, T. 1, Ch.15, Subch. XIV, Pt. A, 1996 Plan 4",
      ],
    ] as const
  ) {
    await workbench.importConnectorResult(
      syntheticLegalRefSourceResult(legalRefId, citationText, "https://example.com/legal", {
        needsReview: false,
        sourceItemKey: legalRefId,
      }),
      dataDir,
    );
  }

  const rows = workbench.db.prepare(
    "select ref_type as refType, review_status as reviewStatus, normalized_citation as normalizedCitation from legal_refs order by ref_type",
  ).all() as Array<{ refType: string; reviewStatus: string; normalizedCitation: string }>;
  const openItems = workbench.listReviewItems({ mode: "legal", status: "open" });
  workbench.close();

  assertEquals(openItems.length, 0);
  assertEquals(rows, [
    { refType: "dc_act", reviewStatus: "accepted", normalizedCitation: "D.C. Act 23-521" },
    { refType: "dc_bill", reviewStatus: "accepted", normalizedCitation: "D.C. Bill B21-0697" },
    { refType: "dc_law", reviewStatus: "accepted", normalizedCitation: "D.C. Law 22-155" },
    { refType: "public_law", reviewStatus: "accepted", normalizedCitation: "Public Law 89-774" },
    {
      refType: "reorganization_plan",
      reviewStatus: "accepted",
      normalizedCitation: "Reorganization Plan No. 4 of 1996",
    },
    { refType: "us_code", reviewStatus: "accepted", normalizedCitation: "33 U.S.C. § 1267" },
  ]);
});

Deno.test("Open DC title-only law-page authorities auto-accept as D.C. laws", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const result = await getConnector("open_dc.public_bodies").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        switch (url) {
          case "https://www.open-dc.gov/public-bodies":
            return `<html><body>
              <a href="/public-bodies/climate-commitment-interagency-taskforce">Climate Commitment Interagency Taskforce</a>
              <a href="/public-bodies/district-waterways-advisory-commission">District Waterways Advisory Commission</a>
            </body></html>`;
          case "https://www.open-dc.gov/public-bodies/climate-commitment-interagency-taskforce":
            return `<html><body>
              <h1 class="page-title">Climate Commitment Interagency Taskforce</h1>
              <div class="field field-name-field-enabling-statute-mayoral-order field-type-text field-label-inline clearfix">
                <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
                <div class="field-items"><div class="field-item even"><a href="https://code.dccouncil.gov/us/dc/council/laws/24-176">Climate Commitment Amendment Act of 2022</a></div></div>
              </div>
            </body></html>`;
          case "https://www.open-dc.gov/public-bodies/district-waterways-advisory-commission":
            return `<html><body>
              <h1 class="page-title">District Waterways Advisory Commission</h1>
              <div class="field field-name-field-enabling-statute-mayoral-order field-type-text field-label-inline clearfix">
                <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
                <div class="field-items"><div class="field-item even"><a href="https://code.dccouncil.gov/us/dc/council/laws/24-336">Office of District Waterways Management Establishment Act of 2022</a></div></div>
              </div>
            </body></html>`;
          default:
            throw new Error(`Unexpected url ${url}`);
        }
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(result, dataDir);

  const rows = workbench.db.prepare(
    "select citation_text as citationText, ref_type as refType, normalized_citation as normalizedCitation, review_status as reviewStatus from legal_refs order by citation_text",
  ).all() as Array<
    {
      citationText: string;
      refType: string;
      normalizedCitation: string;
      reviewStatus: string;
    }
  >;
  const openItems = workbench.listReviewItems({ mode: "legal", status: "open" });
  workbench.close();

  assertEquals(openItems.length, 0);
  assertEquals(rows, [
    {
      citationText: "Climate Commitment Amendment Act of 2022",
      refType: "dc_law",
      normalizedCitation: "D.C. Law 24-176",
      reviewStatus: "accepted",
    },
    {
      citationText: "Office of District Waterways Management Establishment Act of 2022",
      refType: "dc_law",
      normalizedCitation: "D.C. Law 24-336",
      reviewStatus: "accepted",
    },
  ]);
});

Deno.test("Open DC title-only law titles can resolve through the official D.C. law index", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const result = await getConnector("open_dc.public_bodies").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        switch (url) {
          case "https://www.open-dc.gov/public-bodies":
            return `<html><body>
              <a href="/public-bodies/opioid-abatement-advisory-commission">Opioid Abatement Advisory Commission</a>
            </body></html>`;
          case "https://www.open-dc.gov/public-bodies/opioid-abatement-advisory-commission":
            return `<html><body>
              <h1 class="page-title">Opioid Abatement Advisory Commission</h1>
              <div class="field field-name-field-enabling-statute-mayoral-order field-type-text field-label-inline clearfix">
                <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
                <div class="field-items"><div class="field-item even"><a href="https://code.dccouncil.gov/us/dc/council/code/sections/7-3212">Opioid Litigation Proceeds Amendment Act of 2022</a></div></div>
              </div>
            </body></html>`;
          case DC_LAW_INDEX_URL:
            return JSON.stringify([{
              citation: "D.C. Law 24-315",
              heading: "D.C. Law 24-315. Opioid Litigation Proceeds Amendment Act of 2022.",
              path: "/us/dc/council/laws/24-315",
            }]);
          default:
            throw new Error(`Unexpected url ${url}`);
        }
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(result, dataDir);

  const rows = workbench.db.prepare(
    "select citation_text as citationText, ref_type as refType, normalized_citation as normalizedCitation, url, review_status as reviewStatus from legal_refs order by citation_text",
  ).all() as Array<
    {
      citationText: string;
      refType: string;
      normalizedCitation: string;
      url: string;
      reviewStatus: string;
    }
  >;
  const openItems = workbench.listReviewItems({ mode: "legal", status: "open" });
  workbench.close();

  assertEquals(openItems.length, 0);
  assertEquals(rows, [{
    citationText: "Opioid Litigation Proceeds Amendment Act of 2022",
    refType: "dc_law",
    normalizedCitation: "D.C. Law 24-315",
    url: "https://code.dccouncil.gov/us/dc/council/laws/24-315",
    reviewStatus: "accepted",
  }]);
});

Deno.test("known ICC mayor order typo resolves through source-backed correction", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const openDcResult = await getConnector("open_dc.public_bodies").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        switch (url) {
          case "https://www.open-dc.gov/public-bodies":
            return `<html><body>
              <a href="/public-bodies/interagency-coordinating-council-icc">Interagency Coordinating Council (ICC)</a>
            </body></html>`;
          case "https://www.open-dc.gov/public-bodies/interagency-coordinating-council-icc":
            return `<html><body>
              <h1 class="page-title">Interagency Coordinating Council (ICC)</h1>
              <div class="field field-name-field-enabling-statute-mayoral-order field-type-text field-label-inline clearfix">
                <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
                <div class="field-items"><div class="field-item even">Mayor's Order 20012-49</div></div>
              </div>
            </body></html>`;
          default:
            throw new Error(`Unexpected url ${url}`);
        }
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(openDcResult, dataDir);

  const dcgisResult = await getConnector("dcgis.boards_commissions_councils").run(
    createConnectorContext({
      fetcher: async (url: string) => ({
        status: 200,
        text: async () => {
          switch (url) {
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
              return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
              return JSON.stringify({
                features: [{
                  attributes: {
                    ENTITY_ID: 2,
                    NAME: "Interagency Coordinating Council (ICC)",
                    SHORT_NAME: "ICC",
                    TYPE: "Council",
                    WEB_URL: "https://osse.dc.gov/service/dc-interagency-coordinating-council",
                    GOVERNING_AGENCY: "Office of the State Superintendent of Education (OSSE)",
                    AUTHORIZING_ORDER_LAW: "Mayor's Order 20012-49",
                    CLUSTER_DC: null,
                  },
                }],
              });
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        },
        json: async <T>() => {
          throw new Error(`No json fixture for ${url}`) as T;
        },
      }),
    }),
  );
  await workbench.importConnectorResult(dcgisResult, dataDir);

  const rows = workbench.db.prepare(
    "select legal_ref_id as legalRefId, ref_type as refType, normalized_citation as normalizedCitation, url, review_status as reviewStatus from legal_refs where citation_text = ? order by legal_ref_id",
  ).all("Mayor's Order 20012-49") as Array<
    {
      legalRefId: string;
      refType: string;
      normalizedCitation: string;
      url: string;
      reviewStatus: string;
    }
  >;
  const openItems = workbench.listReviewItems({ mode: "legal", status: "open" }).filter((item) =>
    item.details.citationText === "Mayor's Order 20012-49"
  );
  workbench.close();

  assertEquals(openItems.length, 0);
  assertEquals(rows, [
    {
      legalRefId: "legal.dcgis.boards_commissions_councils.2_legislation",
      refType: "mayors_order",
      normalizedCitation: "Mayor's Order 2012-49",
      url:
        "https://www.open-dc.gov/sites/default/files/Mayor%27s%20Order%202012-49-Interagency-Coordinating-Council.pdf",
      reviewStatus: "accepted",
    },
    {
      legalRefId: "legal.open_dc.public_bodies.interagency_coordinating_council_icc_authority",
      refType: "mayors_order",
      normalizedCitation: "Mayor's Order 2012-49",
      url:
        "https://www.open-dc.gov/sites/default/files/Mayor%27s%20Order%202012-49-Interagency-Coordinating-Council.pdf",
      reviewStatus: "accepted",
    },
  ]);
});

Deno.test("known SILC mayor order shorthand resolves through source-backed correction", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const dcgisResult = await getConnector("dcgis.boards_commissions_councils").run(
    createConnectorContext({
      fetcher: async (url: string) => ({
        status: 200,
        text: async () => {
          switch (url) {
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
              return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
              return JSON.stringify({
                features: [{
                  attributes: {
                    ENTITY_ID: 8,
                    NAME: "Statewide Independent Living Council (SILC)",
                    SHORT_NAME: "SILC",
                    TYPE: "Council",
                    WEB_URL: "https://dds.dc.gov/",
                    GOVERNING_AGENCY: "Department on Disability Services (DDS)",
                    AUTHORIZING_ORDER_LAW: "1993-148",
                    CLUSTER_DC: null,
                  },
                }],
              });
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        },
        json: async <T>() => {
          throw new Error(`No json fixture for ${url}`) as T;
        },
      }),
    }),
  );
  await workbench.importConnectorResult(dcgisResult, dataDir);

  const row = workbench.db.prepare(
    "select legal_ref_id as legalRefId, ref_type as refType, normalized_citation as normalizedCitation, url, review_status as reviewStatus from legal_refs where citation_text = ?",
  ).get("1993-148") as {
    legalRefId: string;
    refType: string;
    normalizedCitation: string;
    url: string | null;
    reviewStatus: string;
  };
  const openItems = workbench.listReviewItems({ mode: "legal", status: "open" }).filter((item) =>
    item.details.citationText === "1993-148"
  );
  workbench.close();

  assertEquals(openItems.length, 0);
  assertEquals(row, {
    legalRefId: "legal.dcgis.boards_commissions_councils.8_legislation",
    refType: "mayors_order",
    normalizedCitation: "Mayor's Order 93-148",
    url: null,
    reviewStatus: "accepted",
  });
});

Deno.test("known SILC mayor order amendment chain stays together and resolves through source-backed correction", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const dcgisResult = await getConnector("dcgis.boards_commissions_councils").run(
    createConnectorContext({
      fetcher: async (url: string) => ({
        status: 200,
        text: async () => {
          switch (url) {
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
              return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
              return JSON.stringify({
                features: [{
                  attributes: {
                    ENTITY_ID: 8,
                    NAME: "Statewide Independent Living Council (SILC)",
                    SHORT_NAME: "SILC",
                    TYPE: "Council",
                    WEB_URL: "https://dds.dc.gov/",
                    GOVERNING_AGENCY: "Department on Disability Services (DDS)",
                    AUTHORIZING_ORDER_LAW: "1993-148; amended by 2001-79 and 2012-154",
                    CLUSTER_DC: null,
                  },
                }],
              });
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        },
        json: async <T>() => {
          throw new Error(`No json fixture for ${url}`) as T;
        },
      }),
    }),
  );
  await workbench.importConnectorResult(dcgisResult, dataDir);

  const rows = workbench.db.prepare(
    "select legal_ref_id as legalRefId, citation_text as citationText, ref_type as refType, normalized_citation as normalizedCitation, url, review_status as reviewStatus from legal_refs where source_item_id in (select source_item_id from source_items where item_key = '8') order by legal_ref_id",
  ).all() as Array<{
    legalRefId: string;
    citationText: string;
    refType: string;
    normalizedCitation: string;
    url: string | null;
    reviewStatus: string;
  }>;
  const openItems = workbench.listReviewItems({ mode: "legal", status: "open" }).filter((item) =>
    item.subjectId.startsWith("legal.dcgis.boards_commissions_councils.8_legislation")
  );
  workbench.close();

  assertEquals(openItems.length, 0);
  assertEquals(rows, [{
    legalRefId: "legal.dcgis.boards_commissions_councils.8_legislation",
    citationText: "1993-148; amended by 2001-79 and 2012-154",
    refType: "mayors_order",
    normalizedCitation: "Mayor's Order 1993-148; amended by 2001-79 and 2012-154",
    url: "https://www.open-dc.gov/Mayors_Order_2012-154",
    reviewStatus: "accepted",
  }]);
});

Deno.test("known credit enhancement citation resolves through source-backed correction", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const openDcResult = await getConnector("open_dc.public_bodies").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        switch (url) {
          case "https://www.open-dc.gov/public-bodies":
            return `<html><body>
              <a href="/public-bodies/public-charter-school-credit-enhancement-committee">Public Charter School Credit Enhancement Committee</a>
            </body></html>`;
          case "https://www.open-dc.gov/public-bodies/public-charter-school-credit-enhancement-committee":
            return `<html><body>
              <h1 class="page-title">Public Charter School Credit Enhancement Committee</h1>
              <div class="field field-name-field-enabling-statute-mayoral-order field-type-text field-label-inline clearfix">
                <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
                <div class="field-items"><div class="field-item even">CDCR 26A-2600</div></div>
              </div>
            </body></html>`;
          default:
            throw new Error(`Unexpected url ${url}`);
        }
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(openDcResult, dataDir);

  const row = workbench.db.prepare(
    "select legal_ref_id as legalRefId, ref_type as refType, normalized_citation as normalizedCitation, url, review_status as reviewStatus from legal_refs where citation_text = ?",
  ).get("CDCR 26A-2600") as {
    legalRefId: string;
    refType: string;
    normalizedCitation: string;
    url: string | null;
    reviewStatus: string;
  };
  const openItems = workbench.listReviewItems({ mode: "legal", status: "open" }).filter((item) =>
    item.details.citationText === "CDCR 26A-2600"
  );
  workbench.close();

  assertEquals(openItems.length, 0);
  assertEquals(row, {
    legalRefId:
      "legal.open_dc.public_bodies.public_charter_school_credit_enhancement_committee_authority",
    refType: "mayors_order",
    normalizedCitation: "Mayor's Order 2016-037",
    url: null,
    reviewStatus: "accepted",
  });
});
