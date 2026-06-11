import { assertEquals } from "@std/assert";
import {
  MayorExecutiveStructureReader,
  type MayorExecutiveStructureSource,
} from "../../src/readers/mayor_executive_structure.ts";
import { mayorExecutiveStructureSource } from "../../src/jurisdictions/dc/sources/mayor_executive_structure.ts";

const HTML_BY_URL = new Map<string, string>([
  [
    "https://mayor.dc.gov/page/organizational-charts-agencies-and-offices-under-mayors-authority",
    `
    <html>
      <head><title>Organizational Charts | mayor</title></head>
      <body>
        <h1>Organizational Charts for Agencies and Offices Under the Mayor&#039;s Authority</h1>
        <p>Contact: private@example.com</p>
      </body>
    </html>
    `,
  ],
  [
    "https://mayor.dc.gov/page/executive-branch-0",
    `
    <html>
      <head><title>Executive Branch | mayor</title></head>
      <body><h1>Executive Branch</h1></body>
    </html>
    `,
  ],
]);

Deno.test("MayorExecutiveStructureReader collects configured official-page entries", async () => {
  const reader = new MayorExecutiveStructureReader({
    fetcher: async (url) => {
      const html = HTML_BY_URL.get(url);
      if (!html) {
        return new Response("missing fixture", { status: 404 });
      }
      return new Response(html, { status: 200 });
    },
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source: mayorExecutiveStructureSource,
  });

  assertEquals(result.snapshots.length, 2);
  assertEquals(result.records.length, mayorExecutiveStructureSource.entries.length);
  assertEquals(result.snapshots[0].key, "organizational-charts");
  assertEquals(
    result.snapshots[0].payload.heading,
    "Organizational Charts for Agencies and Offices Under the Mayor's Authority",
  );

  const eom = result.records[0];
  assertEquals(eom.key, "executive-office-of-the-mayor");
  assertEquals(eom.payload.name, "Executive Office of the Mayor");
  assertEquals(eom.payload.entryKind, "office");
  assertEquals(eom.payload.sourceUrl, mayorExecutiveStructureSource.pages[0].url);
  assertEquals(Object.hasOwn(eom.payload, "email"), false);
  assertEquals(Object.hasOwn(eom.payload, "phone"), false);
});

Deno.test("MayorExecutiveStructureReader respects record limit", async () => {
  const source: MayorExecutiveStructureSource = {
    ...mayorExecutiveStructureSource,
  };
  const reader = new MayorExecutiveStructureReader({
    fetcher: async (url) => new Response(HTML_BY_URL.get(url) ?? "", { status: 200 }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
    limit: 2,
  });

  assertEquals(result.snapshots.length, 2);
  assertEquals(result.records.map((record) => record.key), [
    "executive-office-of-the-mayor",
    "office-of-communications",
  ]);
});

Deno.test("MayorExecutiveStructureReader reports fetch failures", async () => {
  const reader = new MayorExecutiveStructureReader({
    fetcher: async () => new Response("nope", { status: 503 }),
  });

  let message = "";
  try {
    await reader.collect({
      workspace: { root: "/tmp/workspace" },
      source: mayorExecutiveStructureSource,
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertEquals(
    message,
    "Mayor executive structure request failed for mayor.executive_structure: HTTP 503",
  );
});
