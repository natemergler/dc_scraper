import { assertEquals } from "@std/assert";
import { LegalEntrypointsReader } from "../../src/readers/legal_entrypoints.ts";
import { legalEntrypointsSource } from "../../src/jurisdictions/dc/sources/legal_entrypoints.ts";

const LEGAL_INDEX_HTML = `
<html>
  <body>
    <a href="https://code.dccouncil.gov/">District of Columbia Official Code</a>
    <a href="https://dc.gov/node/106672">District of Columbia Official Code</a>
    <a href="https://dcregs.dc.gov/">DC Register / DCMR</a>
    <a href="https://www.dcregs.dc.gov/">DC Municipal Regulations and DC Register</a>
    <a href="https://mayor.dc.gov/page/mayors-orders">Mayor's Orders</a>
    <a href="https://dcregs.dc.gov/default.aspx">Mayor's Orders</a>
    <a href="https://dc.gov/page/laws-regulations-and-courts">Laws, Regulations and Courts</a>
    <a href="https://dc.gov/services?tid=58">Laws, Regulations and Courts services</a>
    <a href="https://mayor.dc.gov/">Mayor</a>
    <a href="/page/services">Services</a>
    <a href="https://dcregs.dc.gov/Common/DCMR/ChapterList.aspx?subtitleId=1">DCMR Title List</a>
  </body>
</html>
`;

Deno.test("LegalEntrypointsReader seeds and preserves official legal source links", async () => {
  const reader = new LegalEntrypointsReader({
    fetcher: async () =>
      new Response(LEGAL_INDEX_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source: legalEntrypointsSource,
  });

  assertEquals(result.snapshots.length, 1);
  assertEquals(result.records.map((record) => record.key), [
    "district-of-columbia-official-code",
    "dc-register-dcmr",
    "mayors-orders",
    "laws-regulations-and-courts",
    "dcmr-title-list",
  ]);
  assertEquals(result.records.map((record) => record.payload.name), [
    "District of Columbia Official Code",
    "DC Register / DCMR",
    "Mayor's Orders",
    "Laws, Regulations and Courts",
    "DCMR Title List",
  ]);
  assertEquals(result.records[0].payload.fromSeed, true);
  assertEquals(result.records[4].payload.fromSeed, false);
  assertEquals(
    result.records[4].payload.url,
    "https://dcregs.dc.gov/Common/DCMR/ChapterList.aspx?subtitleId=1",
  );
});

Deno.test("LegalEntrypointsReader respects record limit", async () => {
  const reader = new LegalEntrypointsReader({
    fetcher: async () => new Response(LEGAL_INDEX_HTML, { status: 200 }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source: legalEntrypointsSource,
    limit: 2,
  });

  assertEquals(result.records.map((record) => record.key), [
    "district-of-columbia-official-code",
    "dc-register-dcmr",
  ]);
});
