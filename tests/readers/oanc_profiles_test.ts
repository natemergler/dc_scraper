import { assertEquals } from "@std/assert";
import { OancProfilesReader } from "../../src/readers/oanc_profiles.ts";
import { oancProfilesSource } from "../../src/jurisdictions/dc/sources/oanc_profiles.ts";

const HTML_BY_URL = new Map<string, string>([
  [
    "https://oanc.dc.gov/landing-page/ancs-ward",
    `
    <html>
      <body>
        <h2>Ward 4</h2>
        <a href="/anc-profile/anc-4e">ANC 4E</a>
        <h2>Ward 6</h2>
        <a href="https://oanc.dc.gov/anc-profile/anc-6-8f">ANC 6/8F</a>
        <h2>Ward 8</h2>
        <a href="https://oanc.dc.gov/anc-profile/anc-6-8f">ANC 6/8F</a>
      </body>
    </html>
    `,
  ],
  [
    "https://oanc.dc.gov/anc-profile/anc-4e",
    `
    <html>
      <body>
        <h1>ANC 4E</h1>
        <p>Email: 4e@example.com</p>
        <p>Website: https://anc4e.example</p>
        <p>Advisory Neighborhood Commission 4E represents the Crestwood and 16th Street Heights neighborhoods.</p>
        <p>Meeting Location: Virtual</p>
        <a href="/financials">Financials</a>
      </body>
    </html>
    `,
  ],
  [
    "https://oanc.dc.gov/anc-profile/anc-6-8f",
    `
    <html>
      <body>
        <h1>ANC 6/8F</h1>
        <p>Advisory Neighborhood Commission 6/8F represents the Navy Yard and Buzzard Point neighborhoods.</p>
      </body>
    </html>
    `,
  ],
]);

Deno.test("OancProfilesReader collects profile URLs and represented-neighborhood summaries only", async () => {
  const reader = new OancProfilesReader({
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
    source: oancProfilesSource,
  });

  assertEquals(result.snapshots.length, 3);
  assertEquals(result.records.length, 2);
  assertEquals(result.records[0].key, "4E");
  assertEquals(result.records[0].payload.profileUrl, "https://oanc.dc.gov/anc-profile/anc-4e");
  assertEquals(result.records[0].payload.wardNumbers, ["4"]);
  assertEquals(
    result.records[0].payload.representedNeighborhoods,
    "the Crestwood and 16th Street Heights neighborhoods",
  );
  assertEquals(result.records[1].payload.wardNumbers, ["6", "8"]);
  const payloadKeys = Object.keys(result.records[0].payload);
  assertEquals(payloadKeys.includes("email"), false);
  assertEquals(payloadKeys.includes("phone"), false);
  assertEquals(payloadKeys.includes("meetingLocation"), false);
  assertEquals(payloadKeys.includes("financials"), false);
});

Deno.test("OancProfilesReader respects record limit", async () => {
  const reader = new OancProfilesReader({
    fetcher: async (url) => new Response(HTML_BY_URL.get(url) ?? "", { status: 200 }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source: oancProfilesSource,
    limit: 1,
  });

  assertEquals(result.snapshots.length, 2);
  assertEquals(result.records.map((record) => record.key), ["4E"]);
});
