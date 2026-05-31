import { assertEquals } from "@std/assert";
import {
  fetchArcgisMetadata,
  fetchArcgisTable,
  fetchJsonApiManifest,
  FetchLike,
  fetchPageManifest,
} from "../src/fetchers.ts";
import { makeTempRepo } from "./helpers/temp_repo.ts";

Deno.test("fetches an ArcGIS table snapshot from a fixture response", async () => {
  const repoPath = await makeTempRepo();
  const http = fixtureHttp({
    "https://example.test/table?f=json": {
      id: 6,
      name: "District Government Agencies",
      fields: [{ name: "OBJECTID" }, { name: "NAME" }],
    },
    "https://example.test/table/query?where=1%3D1&outFields=*&returnGeometry=false&f=json&resultOffset=0&resultRecordCount=2000":
      {
        features: [
          { attributes: { OBJECTID: 20, NAME: "Office of the Chief Financial Officer" } },
        ],
      },
  });

  const result = await fetchArcgisTable(repoPath, {
    id: "fixture.agencies",
    family: "fixture",
    kind: "arcgis_table",
    title: "Fixture agencies",
    table_name: "fixture.agencies",
    url: "https://example.test/table",
  }, http);

  assertEquals(result.status, "success");
  assertEquals(result.rowCount, 1);

  const snapshot = JSON.parse(await Deno.readTextFile(result.path));
  assertEquals(snapshot.status, "success");
  assertEquals(snapshot.payload.rows[0].NAME, "Office of the Chief Financial Officer");
});

Deno.test("fetches an ArcGIS metadata snapshot without raw rows", async () => {
  const repoPath = await makeTempRepo();
  const http = fixtureHttp({
    "https://example.test/pass?f=json": {
      id: 17,
      name: "PASS Payments",
      fields: [{ name: "OBJECTID" }, { name: "PAYMENTAMOUNT" }],
    },
    "https://example.test/pass/query?where=1%3D1&returnCountOnly=true&f=json": {
      count: 120000,
    },
  });

  const result = await fetchArcgisMetadata(repoPath, {
    id: "pass.payments",
    family: "pass",
    kind: "arcgis_metadata",
    title: "PASS Payments",
    table_name: "government_operations.pass_payments",
    url: "https://example.test/pass",
  }, http);

  assertEquals(result.status, "success");
  assertEquals(result.rowCount, 120000);

  const snapshot = JSON.parse(await Deno.readTextFile(result.path));
  assertEquals(snapshot.payload.row_count, 120000);
  assertEquals(snapshot.payload.rows, undefined);
  assertEquals(snapshot.payload.metadata.name, "PASS Payments");
});

Deno.test("fetches a JSON API manifest from fixture endpoints", async () => {
  const repoPath = await makeTempRepo();
  const http = fixtureHttp({
    "https://example.test/api/master": { pagination: { totalCount: 10 }, masterData: {} },
    "POST https://example.test/api/upcoming": [{ hearingId: 1 }, { hearingId: 2 }],
    "POST https://example.test/api/aspnet": {
      d: JSON.stringify({ status: true, list: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
    },
  });

  const result = await fetchJsonApiManifest(repoPath, {
    id: "fixture.api",
    family: "fixture",
    kind: "json_api_manifest",
    title: "Fixture API",
    url: "https://example.test/",
    endpoints: [
      { id: "master", url: "https://example.test/api/master" },
      {
        id: "upcoming",
        url: "https://example.test/api/upcoming",
        method: "POST",
        body: {},
      },
      {
        id: "aspnet",
        url: "https://example.test/api/aspnet",
        method: "POST",
        body: {},
      },
    ],
  }, http);

  assertEquals(result.status, "success");
  assertEquals(result.itemCount, 15);

  const snapshot = JSON.parse(await Deno.readTextFile(result.path));
  assertEquals(snapshot.payload.endpoint_count, 3);
  assertEquals(snapshot.payload.total_item_count, 15);
  assertEquals(snapshot.payload.endpoints[0].item_count, 10);
  assertEquals(snapshot.payload.endpoints[1].item_count, 2);
  assertEquals(snapshot.payload.endpoints[2].item_count, 3);
});

Deno.test("fetches a publication page manifest from a fixture response", async () => {
  const repoPath = await makeTempRepo();
  const http = fixtureHttp({
    "https://example.test/reports": `<!doctype html>
      <html>
        <head>
          <title>Budget reports</title>
          <link rel="stylesheet" href="/assets/app.css">
          <script src="/assets/app.js"></script>
        </head>
        <body>
          <a href="/files/fy2026-budget.pdf">FY 2026 Budget</a>
          <a href="https://example.test/files/acfr.pdf">ACFR</a>
        </body>
      </html>`,
  });

  const result = await fetchPageManifest(repoPath, {
    id: "fixture.reports",
    family: "fixture",
    kind: "page_manifest",
    title: "Fixture reports",
    url: "https://example.test/reports",
  }, http);

  assertEquals(result.status, "success");
  assertEquals(result.itemCount, 4);

  const snapshot = JSON.parse(await Deno.readTextFile(result.path));
  assertEquals(snapshot.payload.page_title, "Budget reports");
  assertEquals(snapshot.payload.asset_count, 2);
  assertEquals(snapshot.payload.assets, [
    { kind: "script", url: "https://example.test/assets/app.js" },
    { kind: "stylesheet", url: "https://example.test/assets/app.css" },
  ]);
  assertEquals(
    snapshot.payload.links.some((link: { url: string }) =>
      link.url === "https://example.test/files/fy2026-budget.pdf"
    ),
    true,
  );
});

function fixtureHttp(payloads: Record<string, unknown>): FetchLike {
  return {
    async fetch(url: string, init?: { method?: string }) {
      const key = init?.method === "POST" ? `POST ${url}` : url;
      const payload = payloads[key];
      return {
        ok: payload !== undefined,
        status: payload === undefined ? 404 : 200,
        async json() {
          return payload;
        },
        async text() {
          return payload === undefined
            ? "not found"
            : typeof payload === "string"
            ? payload
            : JSON.stringify(payload);
        },
      };
    },
  };
}
