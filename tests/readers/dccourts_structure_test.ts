import { assertEquals } from "@std/assert";
import { DCCourtsStructureReader } from "../../src/readers/dccourts_structure.ts";
import { dccourtsStructureSource } from "../../src/jurisdictions/dc/sources/dccourts_structure.ts";

const HTML_BY_URL = new Map<string, string>([
  [
    "https://www.dccourts.gov/",
    `
    <html>
      <head><title>District of Columbia Courts</title></head>
      <body>
        <h1>District of Columbia Courts</h1>
        <p>The District of Columbia Courts are the judicial branch of the District.</p>
      </body>
    </html>
    `,
  ],
  [
    "https://www.dccourts.gov/court-of-appeals",
    `
    <html>
      <head><title>Court of Appeals | District of Columbia Courts</title></head>
      <body>
        <h1>Court of Appeals</h1>
        <p>The Court of Appeals is the highest court of the District of Columbia.</p>
      </body>
    </html>
    `,
  ],
  [
    "https://www.dccourts.gov/superior-court",
    `
    <html>
      <head><title>Superior Court | District of Columbia Courts</title></head>
      <body>
        <h1>Superior Court</h1>
        <p>The Superior Court handles trial-level matters.</p>
        <a href="/superior-court/superior-court-divisions/civil-division">Civil Division</a>
        <a href="https://www.dccourts.gov/superior-court/superior-court-divisions/tax-division">Tax Division</a>
        <a href="/superior-court/superior-court-divisions/civil-division">Civil Division</a>
        <a href="/superior-court/superior-court-divisions/crime-victims-compensation">Crime Victims Compensation Program</a>
        <a href="/superior-court/superior-court-divisions/auditor-master">Office of the Auditor-Master</a>
        <a href="/superior-court/superior-court-divisions/family-division/forms">Family Division</a>
      </body>
    </html>
    `,
  ],
]);

Deno.test("DCCourtsStructureReader collects court pages and direct Superior Court divisions", async () => {
  const reader = new DCCourtsStructureReader({
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
    source: dccourtsStructureSource,
  });

  assertEquals(result.snapshots.length, 3);
  assertEquals(result.records.map((record) => record.key), [
    "district-of-columbia-courts",
    "court-of-appeals",
    "superior-court",
    "civil-division",
    "tax-division",
  ]);

  const root = result.records[0];
  assertEquals(root.payload.name, "District of Columbia Courts");
  assertEquals(root.payload.entryKind, "court_system");
  assertEquals(root.payload.heading, "District of Columbia Courts");
  assertEquals(root.payload.fromSeed, false);

  const appeals = result.records[1];
  assertEquals(appeals.payload.name, "Court of Appeals");
  assertEquals(appeals.payload.entryKind, "court");
  assertEquals(appeals.payload.parentName, "District of Columbia Courts");

  const civil = result.records[3];
  assertEquals(civil.payload.name, "Civil Division");
  assertEquals(civil.payload.entryKind, "court_division");
  assertEquals(civil.payload.parentName, "Superior Court");
  assertEquals(
    civil.payload.url,
    "https://www.dccourts.gov/superior-court/superior-court-divisions/civil-division",
  );
  assertEquals(civil.payload.discoveryPageUrl, "https://www.dccourts.gov/superior-court");
  assertEquals(civil.payload.fromSeed, false);
});

Deno.test("DCCourtsStructureReader respects record limit", async () => {
  const reader = new DCCourtsStructureReader({
    fetcher: async (url) => new Response(HTML_BY_URL.get(url) ?? "", { status: 200 }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source: dccourtsStructureSource,
    limit: 4,
  });

  assertEquals(result.records.map((record) => record.key), [
    "district-of-columbia-courts",
    "court-of-appeals",
    "superior-court",
    "civil-division",
  ]);
});

Deno.test("DCCourtsStructureReader falls back to seeded official structure on HTTP 403", async () => {
  const reader = new DCCourtsStructureReader({
    fetcher: async () => new Response("blocked", { status: 403 }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source: dccourtsStructureSource,
  });

  assertEquals(result.snapshots.length, 3);
  assertEquals(
    result.records.some((record) => record.key === "district-of-columbia-courts"),
    true,
  );
  assertEquals(
    result.records.some((record) => record.key === "court-of-appeals"),
    true,
  );
  assertEquals(
    result.records.some((record) => record.key === "civil-division"),
    true,
  );
  assertEquals(result.records.every((record) => record.payload.fromSeed === true), true);
});
