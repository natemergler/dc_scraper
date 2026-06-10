import { assertEquals } from "@std/assert";
import {
  OpenDCPublicBodiesReader,
  type OpenDCPublicBodiesSource,
} from "../../src/readers/open_dc_public_bodies.ts";

const RELATIVE_INDEX_HTML = `
<html>
<body>
  <table>
    <tr><td><a href="/public-bodies/advisory-board/">Advisory Board (AB)</a></td></tr>
    <tr><td><a href="/public-bodies/planning-commission">Planning Commission</a></td></tr>
    <tr><td><a href="/public-bodies/water-authority/">Water Authority</a></td></tr>
  </table>
</body>
</html>
`;

const ABSOLUTE_INDEX_HTML = `
<html>
<body>
  <table>
    <tr><td><a href="https://www.open-dc.gov/public-bodies/advisory-board/">Advisory Board (AB)</a></td></tr>
    <tr><td><a href="https://www.open-dc.gov/public-bodies/planning-commission">Planning Commission</a></td></tr>
    <tr><td><a href="https://www.open-dc.gov/public-bodies/water-authority/">Water Authority</a></td></tr>
  </table>
</body>
</html>
`;

const DETAIL_ADVISORY_BOARD = `
<html>
<body>
  <h1>Advisory Board</h1>
  <h3>Enabling Statute or Mayoral Order</h3>
  <p><a href="https://code.dccouncil.gov/us/dc/council/code/sections/1-123">D.C. Law 10-50</a></p>
  <h3>Governing Agency or Agency Acronym</h3>
  <p>Department of Public Works (DPW)</p>
  <h3>Administering Agency</h3>
  <p>Office of the Mayor</p>
  <h3>Point of Contact</h3>
  <p>john.doe@dc.gov</p>
  <h3>Members</h3>
  <table><tr><td>Member 1</td></tr></table>
  <h3>Meetings</h3>
  <p>Monthly</p>
</body>
</html>
`;

const DETAIL_PLANNING_COMMISSION = `
<html>
<body>
  <h1>Planning Commission</h1>
  <h3>Enabling Statute or Mayoral Order</h3>
  <p>D.C. Code § 1-200</p>
  <h3>Governing Agency or Agency Acronym</h3>
  <p>Office of Planning (OP)</p>
  <h3>Administering Agency</h3>
  <p>Office of Planning</p>
</body>
</html>
`;

const DETAIL_WATER_AUTHORITY = `
<html>
<body>
  <h1>Water Authority</h1>
  <h3>Governing Agency or Agency Acronym</h3>
  <p>N/A</p>
  <h3>Administering Agency</h3>
  <p>Executive Office of the Mayor</p>
</body>
</html>
`;

Deno.test("OpenDCPublicBodiesReader collects index links from relative URLs", async () => {
  const source: OpenDCPublicBodiesSource = {
    id: "open_dc.public_bodies",
    jurisdiction: "dc",
    type: "open_dc.public_bodies",
    indexUrl: "https://www.open-dc.gov/public-bodies/",
  };

  const reader = new OpenDCPublicBodiesReader({
    fetcher: async () => new Response(RELATIVE_INDEX_HTML, { status: 200 }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
  });

  assertEquals(result.records.length, 3);
  assertEquals(result.records[0].key, "advisory-board");
  assertEquals(
    result.records[0].payload.detailUrl,
    "https://www.open-dc.gov/public-bodies/advisory-board",
  );
  assertEquals(result.records[1].key, "planning-commission");
  assertEquals(
    result.records[1].payload.detailUrl,
    "https://www.open-dc.gov/public-bodies/planning-commission",
  );
  assertEquals(result.records[2].key, "water-authority");
  assertEquals(
    result.records[2].payload.detailUrl,
    "https://www.open-dc.gov/public-bodies/water-authority",
  );
});

Deno.test("OpenDCPublicBodiesReader collects index links from absolute URLs", async () => {
  const source: OpenDCPublicBodiesSource = {
    id: "open_dc.public_bodies",
    jurisdiction: "dc",
    type: "open_dc.public_bodies",
    indexUrl: "https://www.open-dc.gov/public-bodies/",
  };

  const reader = new OpenDCPublicBodiesReader({
    fetcher: async () => new Response(ABSOLUTE_INDEX_HTML, { status: 200 }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
  });

  assertEquals(result.records.length, 3);
  assertEquals(result.records[0].key, "advisory-board");
  assertEquals(result.records[1].key, "planning-commission");
  assertEquals(result.records[2].key, "water-authority");
});

Deno.test("OpenDCPublicBodiesReader fetches and parses detail pages", async () => {
  const detailMap = new Map<string, string>([
    ["https://www.open-dc.gov/public-bodies/advisory-board", DETAIL_ADVISORY_BOARD],
    ["https://www.open-dc.gov/public-bodies/planning-commission", DETAIL_PLANNING_COMMISSION],
    ["https://www.open-dc.gov/public-bodies/water-authority", DETAIL_WATER_AUTHORITY],
  ]);

  const source: OpenDCPublicBodiesSource = {
    id: "open_dc.public_bodies",
    jurisdiction: "dc",
    type: "open_dc.public_bodies",
    indexUrl: "https://www.open-dc.gov/public-bodies/",
  };

  const reader = new OpenDCPublicBodiesReader({
    fetcher: async (url) => {
      const html = detailMap.get(url);
      if (html) {
        return new Response(html, { status: 200 });
      }
      return new Response(RELATIVE_INDEX_HTML, { status: 200 });
    },
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
  });

  assertEquals(result.records.length, 3);

  const advisory = result.records.find((r) => r.key === "advisory-board")!;
  assertEquals(advisory.payload.name, "Advisory Board (AB)");
  assertEquals(advisory.payload.enablingStatute, "D.C. Law 10-50");
  assertEquals(
    advisory.payload.enablingStatuteUrl,
    "https://code.dccouncil.gov/us/dc/council/code/sections/1-123",
  );
  assertEquals(advisory.payload.governingAgency, "Department of Public Works");
  assertEquals(advisory.payload.governingAgencyAcronym, "DPW");
  assertEquals(advisory.payload.administeringAgency, "Office of the Mayor");

  const planning = result.records.find((r) => r.key === "planning-commission")!;
  assertEquals(planning.payload.name, "Planning Commission");
  assertEquals(planning.payload.enablingStatute, "D.C. Code § 1-200");
  assertEquals(planning.payload.governingAgency, "Office of Planning");
  assertEquals(planning.payload.governingAgencyAcronym, "OP");
  assertEquals(planning.payload.administeringAgency, "Office of Planning");

  const water = result.records.find((r) => r.key === "water-authority")!;
  assertEquals(water.payload.name, "Water Authority");
  assertEquals(water.payload.governingAgency, "N/A");
  assertEquals(water.payload.administeringAgency, "Executive Office of the Mayor");
});

Deno.test("OpenDCPublicBodiesReader excludes contact, members, meetings data", async () => {
  const source: OpenDCPublicBodiesSource = {
    id: "open_dc.public_bodies",
    jurisdiction: "dc",
    type: "open_dc.public_bodies",
    indexUrl: "https://www.open-dc.gov/public-bodies/",
  };

  const reader = new OpenDCPublicBodiesReader({
    fetcher: async (url) => {
      if (url.includes("advisory-board")) {
        return new Response(DETAIL_ADVISORY_BOARD, { status: 200 });
      }
      return new Response(RELATIVE_INDEX_HTML, { status: 200 });
    },
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
  });

  const advisory = result.records.find((r) => r.key === "advisory-board")!;
  const payloadKeys = Object.keys(advisory.payload as Record<string, unknown>);
  assertEquals(payloadKeys.includes("pointOfContact"), false);
  assertEquals(payloadKeys.includes("members"), false);
  assertEquals(payloadKeys.includes("meetings"), false);
  assertEquals(payloadKeys.includes("phone"), false);
  assertEquals(payloadKeys.includes("email"), false);
});

Deno.test("OpenDCPublicBodiesReader deduplicates slugs", async () => {
  const duplicateIndex = `
    <a href="https://www.open-dc.gov/public-bodies/advisory-board/">Advisory Board</a>
    <a href="/public-bodies/advisory-board/">Advisory Board (AB)</a>
  `;

  const source: OpenDCPublicBodiesSource = {
    id: "open_dc.public_bodies",
    jurisdiction: "dc",
    type: "open_dc.public_bodies",
    indexUrl: "https://www.open-dc.gov/public-bodies/",
  };

  const reader = new OpenDCPublicBodiesReader({
    fetcher: async (url) => {
      if (url === source.indexUrl) {
        return new Response(duplicateIndex, { status: 200 });
      }
      return new Response(DETAIL_ADVISORY_BOARD, { status: 200 });
    },
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
  });

  assertEquals(result.records.length, 1);
  assertEquals(result.records[0].key, "advisory-board");
});

Deno.test("OpenDCPublicBodiesReader fetches supplemental index when configured", async () => {
  let supplementalFetched = false;

  const source: OpenDCPublicBodiesSource = {
    id: "open_dc.public_bodies",
    jurisdiction: "dc",
    type: "open_dc.public_bodies",
    indexUrl: "https://www.open-dc.gov/public-bodies/",
    supplementalIndexUrl: "https://www.open-dc.gov/public-bodies-general-0/",
  };

  const reader = new OpenDCPublicBodiesReader({
    fetcher: async (url) => {
      if (url === source.supplementalIndexUrl) {
        supplementalFetched = true;
        return new Response(
          `
          <a href="/public-bodies/supplemental-body/">Supplemental Body</a>
        `,
          { status: 200 },
        );
      }
      return new Response(RELATIVE_INDEX_HTML, { status: 200 });
    },
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
  });

  assertEquals(supplementalFetched, true);
  assertEquals(result.records.length, 4);
  const supplemental = result.records.find((r) => r.key === "supplemental-body");
  assertEquals(supplemental?.payload.fromSupplementalIndex, true);
});

Deno.test("OpenDCPublicBodiesReader handles fetch error", async () => {
  const source: OpenDCPublicBodiesSource = {
    id: "open_dc.public_bodies",
    jurisdiction: "dc",
    type: "open_dc.public_bodies",
    indexUrl: "https://www.open-dc.gov/public-bodies/",
  };

  const reader = new OpenDCPublicBodiesReader({
    fetcher: async () => new Response("Not Found", { status: 404 }),
  });

  try {
    await reader.collect({
      workspace: { root: "/tmp/workspace" },
      source,
    });
    assertEquals(true, false, "should have thrown");
  } catch (error) {
    assertEquals(
      (error as Error).message,
      "Open DC public body request failed for open_dc.public_bodies: HTTP 404",
    );
  }
});

Deno.test("OpenDCPublicBodiesReader respects limit", async () => {
  const source: OpenDCPublicBodiesSource = {
    id: "open_dc.public_bodies",
    jurisdiction: "dc",
    type: "open_dc.public_bodies",
    indexUrl: "https://www.open-dc.gov/public-bodies/",
  };

  const reader = new OpenDCPublicBodiesReader({
    fetcher: async () => new Response(RELATIVE_INDEX_HTML, { status: 200 }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
    limit: 1,
  });

  assertEquals(result.records.length, 1);
  assertEquals(result.records[0].key, "advisory-board");
});

const DRUPAL_DETAIL_BOARD = `
<html><body>
  <h1 class="page-title">Board of Accountancy</h1>
  <div class="field field-name-field-statute-mayors-order field-type-link-field field-label-inline clearfix">
    <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
    <div class="field-items"><div class="field-item even"><a href="https://code.dccouncil.us/us/dc/council/code/sections/47-2853.06">D.C. Official Code § 47-2853.06(b)(1)</a></div></div>
  </div>
  <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
    <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
    <div class="field-items"><div class="field-item even">DLCP/OPL</div></div>
  </div>
  <div class="field field-name-field-administering-agency field-type-taxonomy-term-reference field-label-inline clearfix">
    <div class="field-label">Administering Agency / Agency Acronym:&nbsp;</div>
    <div class="field-items"><div class="field-item even">Department of Licensing and Consumer Protection</div></div>
  </div>
  <div class="field field-name-field-members field-type-text">
    <div class="field-label">Members:&nbsp;</div>
    <div class="field-items"><div class="field-item even">John Smith, Jane Doe</div></div>
  </div>
  <div class="field field-name-field-contact field-type-text">
    <div class="field-label">Point of Contact:&nbsp;</div>
    <div class="field-items"><div class="field-item even">board@example.gov</div></div>
  </div>
  <div class="view view-meetings-calendar">
    <a href="/public-bodies/board-accountancy/meetings">Meeting calendar</a>
  </div>
  <div class="field field-name-field-associated-documents field-type-link-field">
    <a href="https://www.open-dc.gov/sites/default/files/charter.pdf">Board Charter</a>
  </div>
</body></html>
`;

const DRUPAL_INDEX_BOARD = `
<a href="https://www.open-dc.gov/public-bodies/board-accountancy/">Board of Accountancy</a>
`;

Deno.test("OpenDCPublicBodiesReader parses Drupal-style detail page with enabling statute link and governing agency", async () => {
  const source: OpenDCPublicBodiesSource = {
    id: "open_dc.public_bodies",
    jurisdiction: "dc",
    type: "open_dc.public_bodies",
    indexUrl: "https://www.open-dc.gov/public-bodies/",
  };

  const reader = new OpenDCPublicBodiesReader({
    fetcher: async (url) => {
      if (url.includes("board-accountancy")) {
        return new Response(DRUPAL_DETAIL_BOARD, { status: 200 });
      }
      return new Response(DRUPAL_INDEX_BOARD, { status: 200 });
    },
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
    limit: 1,
  });

  assertEquals(result.records.length, 1);
  const record = result.records[0];
  assertEquals(record.key, "board-accountancy");
  assertEquals(record.payload.enablingStatute, "D.C. Official Code § 47-2853.06(b)(1)");
  assertEquals(
    record.payload.enablingStatuteUrl,
    "https://code.dccouncil.us/us/dc/council/code/sections/47-2853.06",
  );
  assertEquals(record.payload.governingAgency, "DLCP/OPL");
  assertEquals(
    record.payload.administeringAgency,
    "Department of Licensing and Consumer Protection",
  );
});

Deno.test("OpenDCPublicBodiesReader excludes contact and member data from Drupal-style payload", async () => {
  const source: OpenDCPublicBodiesSource = {
    id: "open_dc.public_bodies",
    jurisdiction: "dc",
    type: "open_dc.public_bodies",
    indexUrl: "https://www.open-dc.gov/public-bodies/",
  };

  const reader = new OpenDCPublicBodiesReader({
    fetcher: async (url) => {
      if (url.includes("board-accountancy")) {
        return new Response(DRUPAL_DETAIL_BOARD, { status: 200 });
      }
      return new Response(DRUPAL_INDEX_BOARD, { status: 200 });
    },
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
    limit: 1,
  });

  const payloadKeys = Object.keys(result.records[0].payload as Record<string, unknown>);
  assertEquals(payloadKeys.includes("members"), false);
  assertEquals(payloadKeys.includes("pointOfContact"), false);
  assertEquals(payloadKeys.includes("phone"), false);
  assertEquals(payloadKeys.includes("email"), false);
  assertEquals(payloadKeys.includes("meetingLinks"), false);
  assertEquals(payloadKeys.includes("documentLinks"), false);
});

const DRUPAL_DETAIL_TASK_FORCE = `
<html><body>
  <h1 class="page-title">Adult Career Pathways Task Force</h1>
  <div class="field field-name-field-statute-mayors-order field-type-link-field field-label-inline clearfix">
    <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
    <div class="field-items"><div class="field-item even"><a href="https://www.open-dc.gov/file/mayors-order-2023-058.pdf">Mayor's Order 2023-058</a></div></div>
  </div>
  <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
    <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
    <div class="field-items"><div class="field-item even">DOES</div></div>
  </div>
</body></html>
`;

Deno.test("OpenDCPublicBodiesReader parses Drupal-style task force with governing agency acronym", async () => {
  const index =
    `<a href="/public-bodies/adult-career-pathways-task-force/">Adult Career Pathways Task Force</a>`;

  const source: OpenDCPublicBodiesSource = {
    id: "open_dc.public_bodies",
    jurisdiction: "dc",
    type: "open_dc.public_bodies",
    indexUrl: "https://www.open-dc.gov/public-bodies/",
  };

  const reader = new OpenDCPublicBodiesReader({
    fetcher: async (url) => {
      if (url.includes("adult-career-pathways-task-force")) {
        return new Response(DRUPAL_DETAIL_TASK_FORCE, { status: 200 });
      }
      return new Response(index, { status: 200 });
    },
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
    limit: 1,
  });

  assertEquals(result.records.length, 1);
  const record = result.records[0];
  assertEquals(record.payload.name, "Adult Career Pathways Task Force");
  assertEquals(record.payload.enablingStatute, "Mayor's Order 2023-058");
  assertEquals(
    record.payload.enablingStatuteUrl,
    "https://www.open-dc.gov/file/mayors-order-2023-058.pdf",
  );
  assertEquals(record.payload.governingAgency, "DOES");
  assertEquals(record.payload.governingAgencyAcronym, undefined);
});

const DRUPAL_DETAIL_COMMISSION = `
<html><body>
  <h1 class="page-title">Commission on Example Services</h1>
  <div class="field field-name-field-statute-mayors-order field-type-text field-label-inline clearfix">
    <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
    <div class="field-items"><div class="field-item even">Mayor's Order 2019-010</div></div>
  </div>
  <div class="field field-name-field-administering-agency field-type-taxonomy-term-reference field-label-inline clearfix">
    <div class="field-label">Administering Agency / Agency Acronym:&nbsp;</div>
    <div class="field-items"><div class="field-item even">Office of the City Administrator</div></div>
  </div>
  <div class="view view-meetings-calendar">
    <a href="/public-bodies/commission-on-example-services/meetings">Meeting calendar</a>
  </div>
  <div class="field field-name-field-associated-documents field-type-link-field">
    <a href="https://www.open-dc.gov/sites/default/files/commission-charter.pdf">Commission Charter</a>
  </div>
</body></html>
`;

Deno.test("OpenDCPublicBodiesReader parses Drupal-style commission with administering agency", async () => {
  const index =
    `<a href="/public-bodies/commission-on-example-services/">Commission on Example Services</a>`;

  const source: OpenDCPublicBodiesSource = {
    id: "open_dc.public_bodies",
    jurisdiction: "dc",
    type: "open_dc.public_bodies",
    indexUrl: "https://www.open-dc.gov/public-bodies/",
  };

  const reader = new OpenDCPublicBodiesReader({
    fetcher: async (url) => {
      if (url.includes("commission-on-example-services")) {
        return new Response(DRUPAL_DETAIL_COMMISSION, { status: 200 });
      }
      return new Response(index, { status: 200 });
    },
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
    limit: 1,
  });

  assertEquals(result.records.length, 1);
  const record = result.records[0];
  assertEquals(record.payload.enablingStatute, "Mayor's Order 2019-010");
  assertEquals(record.payload.enablingStatuteUrl, undefined);
  assertEquals(record.payload.administeringAgency, "Office of the City Administrator");
});

Deno.test("OpenDCPublicBodiesReader existing h3/p fixtures still pass with Drupal-aware parser", async () => {
  const detailMap = new Map<string, string>([
    ["https://www.open-dc.gov/public-bodies/advisory-board", DETAIL_ADVISORY_BOARD],
    ["https://www.open-dc.gov/public-bodies/planning-commission", DETAIL_PLANNING_COMMISSION],
    ["https://www.open-dc.gov/public-bodies/water-authority", DETAIL_WATER_AUTHORITY],
  ]);

  const source: OpenDCPublicBodiesSource = {
    id: "open_dc.public_bodies",
    jurisdiction: "dc",
    type: "open_dc.public_bodies",
    indexUrl: "https://www.open-dc.gov/public-bodies/",
  };

  const reader = new OpenDCPublicBodiesReader({
    fetcher: async (url) => {
      const html = detailMap.get(url);
      if (html) {
        return new Response(html, { status: 200 });
      }
      return new Response(RELATIVE_INDEX_HTML, { status: 200 });
    },
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
  });

  assertEquals(result.records.length, 3);

  const advisory = result.records.find((r) => r.key === "advisory-board")!;
  assertEquals(advisory.payload.enablingStatute, "D.C. Law 10-50");
  assertEquals(
    advisory.payload.enablingStatuteUrl,
    "https://code.dccouncil.gov/us/dc/council/code/sections/1-123",
  );
  assertEquals(advisory.payload.governingAgency, "Department of Public Works");
  assertEquals(advisory.payload.governingAgencyAcronym, "DPW");
  assertEquals(advisory.payload.administeringAgency, "Office of the Mayor");

  const planning = result.records.find((r) => r.key === "planning-commission")!;
  assertEquals(planning.payload.enablingStatute, "D.C. Code § 1-200");
  assertEquals(planning.payload.governingAgency, "Office of Planning");
  assertEquals(planning.payload.governingAgencyAcronym, "OP");
  assertEquals(planning.payload.administeringAgency, "Office of Planning");

  const water = result.records.find((r) => r.key === "water-authority")!;
  assertEquals(water.payload.governingAgency, "N/A");
  assertEquals(water.payload.administeringAgency, "Executive Office of the Mayor");
});
