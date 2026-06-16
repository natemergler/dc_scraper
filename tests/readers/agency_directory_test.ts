import { assertEquals } from "@std/assert";

import { AgencyDirectoryReader } from "../../src/readers/agency_directory.ts";
import { agencyDirectorySource } from "../../src/jurisdictions/dc/sources/agency_directory.ts";

const INDEX_HTML = `
<html>
  <body>
    <table class="views-table cols-3">
      <tbody>
        <tr class="odd">
          <td class="views-field views-field-field-image"></td>
          <td class="views-field views-field-title"><br /><b>Office of the Secretary - OS</b><br />&nbsp;</td>
          <td class="views-field views-field-subdomain"><a href="https://os.dc.gov/">os.dc.gov</a></td>
        </tr>
        <tr class="even">
          <td class="views-field views-field-field-image"></td>
          <td class="views-field views-field-title"><br /><b>Generic Portal Row</b><br />&nbsp;</td>
          <td class="views-field views-field-subdomain"><a href="https://dc.gov/">dc.gov</a></td>
        </tr>
        <tr class="even">
          <td class="views-field views-field-field-image"></td>
          <td class="views-field views-field-title"><br /><b>Mayor&rsquo;s Office on Women&#39;s Policy and Initiatives</b><br />&nbsp;</td>
          <td class="views-field views-field-subdomain"><a href="/node/owpi">owpi.dc.gov</a></td>
        </tr>
        <tr class="odd">
          <td class="views-field views-field-field-image"></td>
          <td class="views-field views-field-title"><br /><b>Office of the Secretary - OS</b><br />&nbsp;</td>
          <td class="views-field views-field-subdomain"><a href="https://os.dc.gov/">os.dc.gov</a></td>
        </tr>
      </tbody>
    </table>
  </body>
</html>
`;

Deno.test("AgencyDirectoryReader collects directory names and official URLs", async () => {
  const reader = new AgencyDirectoryReader({
    fetcher: async () => new Response(INDEX_HTML, { status: 200 }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source: agencyDirectorySource,
  });

  assertEquals(result.snapshots.length, 1);
  assertEquals(result.records.length, 2);
  assertEquals(result.records[0].payload.directoryName, "Office of the Secretary - OS");
  assertEquals(result.records[0].payload.officialUrl, "https://os.dc.gov");
  assertEquals(result.records[0].payload.subdomain, "os.dc.gov");
  assertEquals(
    result.records[1].payload.directoryName,
    "Mayor's Office on Women's Policy and Initiatives",
  );
  assertEquals(result.records[1].payload.officialUrl, "https://dc.gov/node/owpi");
});

Deno.test("AgencyDirectoryReader respects record limit", async () => {
  const reader = new AgencyDirectoryReader({
    fetcher: async () => new Response(INDEX_HTML, { status: 200 }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source: agencyDirectorySource,
    limit: 1,
  });

  assertEquals(result.records.length, 1);
  assertEquals(result.records[0].payload.directoryName, "Office of the Secretary - OS");
});
