import { assertEquals } from "@std/assert";
import { BegaStructureReader, type BegaStructureSource } from "../../src/readers/bega_structure.ts";
import { begaStructureSource } from "../../src/jurisdictions/dc/sources/bega_structure.ts";

const HTML_BY_URL = new Map<string, string>([
  [
    "https://bega.dc.gov/node/61616/",
    `
    <html>
      <head><title>About BEGA | bega</title></head>
      <body>
        <h1 class="page-title">About BEGA</h1>
        <p>The Board of Ethics and Government Accountability (BEGA) is an independent agency.</p>
        <p>Contact: private@example.com</p>
      </body>
    </html>
    `,
  ],
  [
    "https://bega.dc.gov/page/office-government-ethics",
    `
    <html>
      <head><title>Office of Government Ethics | bega</title></head>
      <body>
        <h1 id="page-title">Office of Government Ethics</h1>
        <p>The Office of Government Ethics (OGE) administers the Code of Conduct.</p>
      </body>
    </html>
    `,
  ],
  [
    "https://www.open-dc.gov/office-open-government",
    `
    <html>
      <head><title>Office of Open Government | Open DC</title></head>
      <body>
        <h1>Office of Open Government</h1>
        <p>The Office of Open Government (OOG) ensures open meetings compliance.</p>
      </body>
    </html>
    `,
  ],
]);

Deno.test("BegaStructureReader collects configured institution pages", async () => {
  const reader = new BegaStructureReader({
    fetcher: async (url) => {
      const html = HTML_BY_URL.get(url);
      if (!html) {
        return new Response("missing fixture", { status: 404 });
      }
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source: begaStructureSource,
  });

  assertEquals(result.snapshots.length, 3);
  assertEquals(result.records.length, 3);

  const [bega, oge, oog] = result.records;
  assertEquals(bega.key, "board-of-ethics-and-government-accountability");
  assertEquals(bega.payload.name, "Board of Ethics and Government Accountability");
  assertEquals(bega.payload.entryKind, "agency");
  assertEquals(bega.payload.heading, "About BEGA");
  assertEquals(
    bega.payload.summary,
    "The Board of Ethics and Government Accountability (BEGA) is an independent agency.",
  );

  assertEquals(oge.key, "office-of-government-ethics");
  assertEquals(oge.payload.name, "Office of Government Ethics");
  assertEquals(oge.payload.entryKind, "office");
  assertEquals(oge.payload.parentName, "Board of Ethics and Government Accountability");

  assertEquals(oog.key, "office-of-open-government");
  assertEquals(oog.payload.name, "Office of Open Government");
  assertEquals(oog.payload.entryKind, "office");
  assertEquals(oog.payload.parentName, "Board of Ethics and Government Accountability");
});

Deno.test("BegaStructureReader respects record limit", async () => {
  const source: BegaStructureSource = {
    ...begaStructureSource,
  };
  const reader = new BegaStructureReader({
    fetcher: async (url) => new Response(HTML_BY_URL.get(url) ?? "", { status: 200 }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
    limit: 2,
  });

  assertEquals(result.snapshots.length, 2);
  assertEquals(result.records.map((record) => record.key), [
    "board-of-ethics-and-government-accountability",
    "office-of-government-ethics",
  ]);
});

Deno.test("BegaStructureReader drops JavaScript-required shell text", async () => {
  const reader = new BegaStructureReader({
    fetcher: async () =>
      new Response(
        `
        <html>
          <head><title>Office of Open Government | Open DC</title></head>
          <body>
            <h1>You need to change a setting in your web browser</h1>
            <p>This website requires a browser feature called JavaScript.</p>
            <p>Please see: How to enable JavaScript in your browser.</p>
            <p>Thank you.</p>
          </body>
        </html>
        `,
        { status: 200 },
      ),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source: {
      id: "bega.structure",
      jurisdiction: "dc",
      type: "bega.structure",
      pages: [{
        key: "office-of-open-government",
        name: "Office of Open Government",
        url: "https://www.open-dc.gov/office-open-government",
        entryKind: "office",
        parentName: "Board of Ethics and Government Accountability",
      }],
    },
  });

  assertEquals(result.records.length, 1);
  assertEquals(result.records[0].payload.name, "Office of Open Government");
  assertEquals(result.records[0].payload.heading, undefined);
  assertEquals(result.records[0].payload.summary, undefined);
  assertEquals(result.records[0].payload.pageTitle, "Office of Open Government | Open DC");
});
