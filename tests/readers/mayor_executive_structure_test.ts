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
        <div class="field field-name-body field-type-text-with-summary field-label-hidden">
          <div class="field-items">
            <div class="field-item even" property="content:encoded">
              <p><strong><a href="/sites/default/files/dc/sites/mayormb/page_content/attachments/OCA080921.pdf">Executive Office of the Mayor (EOM)</a>:</strong></p>
              <ul>
                <li><strong>Office of Communications</strong>: Works to ensure that the media, residents of and visitors to the District, and District employees have access to accurate, timely information from the Mayor.</li>
                <li><strong>Mayor&#039;s Office of Community Relations and Services (MOCRS)</strong>: Serves as the Mayor&#039;s primary constituent services organization by providing rapid and complete responses to constituent requests, complaints, and questions.</li>
                <li><strong>Mayor&#039;s Office of Community Affairs (MOCA)</strong>: Fosters communication and relationships across all eight wards and between the community and District agencies.</li>
                <li><a href="/sites/default/files/dc/sites/mayormb/page_content/attachments/OSecretary.pdf"><strong>Office of the Secretary (OS)</strong></a>: Serves as the District of Columbia&#039;s primary liaison with the diplomatic and international community and is the official resource for executive orders, historic records and ceremonial documents.</li>
              </ul>
              <p><a href="/sites/default/files/dc/sites/mayormb/page_content/attachments/OCA2.pdf"><strong>Office of the City Administrator (OCA)</strong></a>: Responsible for the day-to-day management of the District government, setting operational goals, and implementing the legislative actions and policy decisions of the Mayor and DC Council.</p>
            </div>
          </div>
        </div>
      </body>
    </html>
    `,
  ],
  [
    "https://mayor.dc.gov/page/executive-branch-0",
    `
    <html>
      <head><title>Executive Branch | mayor</title></head>
      <body>
        <h1>Executive Branch</h1>
        <div class="field field-name-body field-type-text-with-summary field-label-hidden">
          <div class="field-items">
            <div class="field-item even" property="content:encoded">
              <p><strong><a href="https://mayor.dc.gov" title="Executive Office of the Mayor">Executive Office of the Mayor</a></strong></p>
              <ul>
                <li><a href="https://moca.dc.gov/">Office of Community Affairs</a><br />The mission of the Office of Community Affairs is to meet the needs of the residents of the District of Columbia and engage the District&#039;s diverse communities in civic life.</li>
                <li><a href="http://os.dc.gov" title="Office of the Secretary">Office of the Secretary</a><br />The Office of the Secretary provides protocol, authentication and public records management services to the Mayor and District government agencies.</li>
              </ul>
              <p><a href="https://oca.dc.gov"><strong>Office of the City Administrator</strong></a><br />Provides oversight and support to the Deputy Mayors and increases government effectiveness with cross-agency and targeted improvement initiatives.</p>
            </div>
          </div>
        </div>
      </body>
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
  assertEquals(eom.payload.officialUrl, "https://mayor.dc.gov/");
  assertEquals(eom.payload.sourcePageUrls, [
    "https://mayor.dc.gov/page/organizational-charts-agencies-and-offices-under-mayors-authority",
    "https://mayor.dc.gov/page/executive-branch-0",
  ]);
  assertEquals(Object.hasOwn(eom.payload, "email"), false);
  assertEquals(Object.hasOwn(eom.payload, "phone"), false);

  const communications = result.records.find((record) => record.key === "office-of-communications");
  assertEquals(
    communications?.payload.description,
    "Works to ensure that the media, residents of and visitors to the District, and District employees have access to accurate, timely information from the Mayor.",
  );
  assertEquals(communications?.payload.officialUrl, undefined);

  const communityAffairs = result.records.find((record) =>
    record.key === "mayors-office-of-community-affairs"
  );
  assertEquals(communityAffairs?.payload.officialUrl, "https://moca.dc.gov/");
  assertEquals(
    communityAffairs?.payload.description,
    "The mission of the Office of Community Affairs is to meet the needs of the residents of the District of Columbia and engage the District's diverse communities in civic life.",
  );

  const cityAdministrator = result.records.find((record) =>
    record.key === "office-of-the-city-administrator"
  );
  assertEquals(cityAdministrator?.payload.officialUrl, "https://oca.dc.gov/");
  assertEquals(
    cityAdministrator?.payload.description,
    "Responsible for the day-to-day management of the District government, setting operational goals, and implementing the legislative actions and policy decisions of the Mayor and DC Council.",
  );
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
