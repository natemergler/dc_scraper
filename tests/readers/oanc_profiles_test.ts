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
        <div class="font-heavy">Commissioners</div>
        <div>
          <div class="uk-overflow-auto">
            <table class="uk-table uk-table-striped">
              <thead><tr><th>SMD</th><th>Name</th><th>Address</th><th>Phone</th><th>Email</th></tr></thead>
              <tbody>
                <tr>
                  <td>4E01</td>
                  <td><div>Aretha "Nikki" Jones</div><div><em>Treasurer</em></div></td>
                  <td>Washington, DC 20011</td>
                  <td>(202) 555-1111</td>
                  <td><a href="mailto:4e01@example.com">4e01@example.com</a></td>
                </tr>
                <tr>
                  <td>4E02</td>
                  <td>Vince Micone</td>
                  <td>Washington, DC 20011</td>
                  <td>(202) 555-2222</td>
                  <td><a href="mailto:4e02@example.com">4e02@example.com</a></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
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

const SPLIT_CARD_HTML_BY_URL = new Map<string, string>([
  [
    "https://oanc.dc.gov/landing-page/ancs-ward",
    `
    <html>
      <body>
        <h2>Ward 3</h2>
        <div class="anc-item">
          <a href="/anc-profile/anc-3c"><img src="/anc3c.png" alt="Avatar"></a>
          <div>
            <a href="https://anc3c.dc.gov/Commissioner-Directory" title="ANC 3C">ANC 3C</a>
          </div>
        </div>
        <div class="anc-item">
          <a href="https://anc3g.dc.gov/"><img src="/anc34g.png" alt="Avatar"></a>
          <div>
            <a href="https://anc3g.dc.gov/Commissioner-Directory" title="ANC 3/4G">ANC 3/4G</a>
          </div>
        </div>
        <h2>Ward 4</h2>
        <div class="anc-item">
          <a href="/anc-profile/anc-34g"><img src="/anc34g.png" alt="Avatar"></a>
          <div>
            <a href="https://anc3g.dc.gov/Commissioner-Directory" title="ANC 3/4G">ANC 3/4G</a>
          </div>
        </div>
      </body>
    </html>
    `,
  ],
  [
    "https://oanc.dc.gov/anc-profile/anc-3c",
    `
    <html>
      <body>
        <h1>ANC 3C</h1>
        <p>Website: https://anc3c.dc.gov/</p>
        <p>Advisory Neighborhood Commission 3C represents the Cleveland Park and Woodley Park neighborhoods.</p>
      </body>
    </html>
    `,
  ],
  [
    "https://oanc.dc.gov/anc-profile/anc-34g",
    `
    <html>
      <body>
        <h1>ANC 3/4G</h1>
        <p>Website: http://anc3g.dc.gov/</p>
        <p>Advisory Neighborhood Commission 3/4G represents the Chevy Chase, Barnaby Woods, and Hawthorne neighborhoods.</p>
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
      return new Response(html, {
        status: 200,
        headers: url.includes("/anc-profile/")
          ? { "last-modified": "Tue, 16 Jun 2026 21:58:02 GMT" }
          : undefined,
      });
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
  assertEquals(result.records[0].payload.officialUrl, "https://anc4e.example/");
  assertEquals(result.records[0].payload.pageLastModified, "2026-06-16T21:58:02.000Z");
  assertEquals(result.records[0].payload.commissioners, [{
    smdId: "4E01",
    name: `Aretha "Nikki" Jones`,
    officerRole: "Treasurer",
  }, {
    smdId: "4E02",
    name: "Vince Micone",
  }]);
  assertEquals(result.records[1].payload.wardNumbers, ["6", "8"]);
  const payloadKeys = Object.keys(result.records[0].payload);
  assertEquals(payloadKeys.includes("email"), false);
  assertEquals(payloadKeys.includes("phone"), false);
  assertEquals(payloadKeys.includes("meetingLocation"), false);
  assertEquals(payloadKeys.includes("financials"), false);
});

Deno.test("OancProfilesReader respects record limit", async () => {
  const reader = new OancProfilesReader({
    fetcher: async (url) =>
      new Response(HTML_BY_URL.get(url) ?? "", {
        status: 200,
        headers: url.includes("/anc-profile/")
          ? { "last-modified": "Tue, 16 Jun 2026 21:58:02 GMT" }
          : undefined,
      }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source: oancProfilesSource,
    limit: 1,
  });

  assertEquals(result.snapshots.length, 2);
  assertEquals(result.records.map((record) => record.key), ["4E"]);
});

Deno.test("OancProfilesReader collects split cards with external label links", async () => {
  const reader = new OancProfilesReader({
    fetcher: async (url) => {
      const html = SPLIT_CARD_HTML_BY_URL.get(url);
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

  const records = new Map(result.records.map((record) => [record.key, record]));
  const anc3c = records.get("3C");
  const anc34g = records.get("3/4G");

  assertEquals(result.records.length, 2);
  assertEquals(anc3c?.payload.profileUrl, "https://oanc.dc.gov/anc-profile/anc-3c");
  assertEquals(anc3c?.payload.wardNumbers, ["3"]);
  assertEquals(anc3c?.payload.officialUrl, "https://anc3c.dc.gov/");
  assertEquals(anc34g?.payload.profileUrl, "https://oanc.dc.gov/anc-profile/anc-34g");
  assertEquals(anc34g?.payload.wardNumbers, ["3", "4"]);
  assertEquals(anc34g?.payload.officialUrl, "http://anc3g.dc.gov/");
});
