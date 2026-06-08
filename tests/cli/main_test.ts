import { Database } from "@db/sqlite";
import { join } from "@std/path";
import { assertEquals } from "@std/assert";

import { runCli } from "../../src/cli/main.ts";
import { closeWorkspace, initWorkspace, openWorkspace } from "../../src/workspace/workspace.ts";

Deno.test("collect command persists snapshots and records", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-collect-" });
  const restoreFetch = mockArcGISFetch(
    new Map([
      [
        "0",
        {
          features: [
            {
              attributes: {
                OBJECTID: 1,
                AGENCY_ID: "a-1",
                AGENCY_NAME: "Agency One",
                SHORT_NAME: "A1",
                AUTHORITY_ID: "au-1",
                AUTHORITY_NAME: "District Authority",
                SHORTNAME: "DA",
                GOVERNING_AGENCY: "District of Columbia",
              },
            },
            {
              attributes: {
                OBJECTID: 2,
                AGENCY_ID: "a-2",
                AGENCY_NAME: "Agency Two",
                SHORT_NAME: "A2",
              },
            },
            {
              attributes: {
                OBJECTID: 100,
                BOARD_ID: "b-1",
                BOARD_NAME: "City Board",
                SHORTNAME: "CB",
                AGENCY_ID: "a-1",
              },
            },
            {
              attributes: {
                OBJECTID: 200,
                COMMISSION_ID: "c-1",
                COMMISSION_NAME: "Budget Commission",
                SHORT_NAME: "BC",
                AGENCY_ID: "a-1",
                GOVERNING_AGENCY: "District One",
              },
            },
          ],
          exceededTransferLimit: false,
          objectIdFieldName: "OBJECTID",
        },
      ],
    ]),
  );

  try {
    const exitCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.agencies",
      "--limit",
      "2",
    ]);

    assertEquals(exitCode, 0);

    const db = openWorkspace(workspace);
    initWorkspace(db);
    assertEquals(countRows(db, "snapshots"), 1);
    assertEquals(countRows(db, "records"), 2);
    closeWorkspace(db);
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
  }
});

Deno.test("collect command supports dcgis.boards source", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-collect-boards-" });
  const restoreFetch = mockArcGISFetch(
    new Map([
      [
        "0",
        {
          features: [
            {
              attributes: {
                OBJECTID: 11,
                BOARD_ID: "b-1",
                BOARD_NAME: "Advisory Board",
                SHORT_NAME: "AB",
                AGENCY_ID: "a-1",
              },
            },
          ],
          exceededTransferLimit: false,
          objectIdFieldName: "OBJECTID",
        },
      ],
    ]),
  );

  try {
    const exitCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.boards",
      "--limit",
      "1",
    ]);

    assertEquals(exitCode, 0);

    const db = openWorkspace(workspace);
    initWorkspace(db);
    assertEquals(countRows(db, "snapshots"), 1);
    assertEquals(countRows(db, "records"), 1);
    closeWorkspace(db);
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
  }
});

Deno.test("collect command supports dcgis.commissions source", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-collect-commissions-" });
  const restoreFetch = mockArcGISFetch(
    new Map([
      [
        "0",
        {
          features: [
            {
              attributes: {
                OBJECTID: 20,
                COMMISSION_ID: "c-1",
                COMMISSION_NAME: "Neighborhood Commission",
                SHORT_NAME: "NC",
                AGENCY_ID: "a-1",
              },
            },
          ],
          exceededTransferLimit: false,
          objectIdFieldName: "OBJECTID",
        },
      ],
    ]),
  );

  try {
    const exitCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.commissions",
      "--limit",
      "1",
    ]);

    assertEquals(exitCode, 0);

    const db = openWorkspace(workspace);
    initWorkspace(db);
    assertEquals(countRows(db, "snapshots"), 1);
    assertEquals(countRows(db, "records"), 1);
    closeWorkspace(db);
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
  }
});

Deno.test("collect command supports dcgis.authorities source", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-collect-authorities-" });
  const restoreFetch = mockArcGISFetch(
    new Map([
      [
        "0",
        {
          features: [
            {
              attributes: {
                OBJECTID: 30,
                AUTHORITY_ID: "au-1",
                AUTHORITY_NAME: "City Authority",
                SHORT_NAME: "CA",
                AGENCY_ID: "a-1",
              },
            },
          ],
          exceededTransferLimit: false,
          objectIdFieldName: "OBJECTID",
        },
      ],
    ]),
  );

  try {
    const exitCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.authorities",
      "--limit",
      "1",
    ]);

    assertEquals(exitCode, 0);

    const db = openWorkspace(workspace);
    initWorkspace(db);
    assertEquals(countRows(db, "snapshots"), 1);
    assertEquals(countRows(db, "records"), 1);
    closeWorkspace(db);
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
  }
});

Deno.test("state commands generate index check committed state", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-output-" });
  const responses = [
    {
      features: [
        {
          attributes: {
            OBJECTID: 1,
            AGENCY_ID: "a-1",
            AGENCY_NAME: "Agency One",
            SHORT_NAME: "A1",
          },
        },
        {
          attributes: {
            OBJECTID: 2,
            AGENCY_ID: "a-2",
            AGENCY_NAME: "Agency Two",
            SHORT_NAME: "A2",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
    {
      features: [
        {
          attributes: {
            OBJECTID: 100,
            BOARD_ID: "b-1",
            BOARD_NAME: "City Board",
            SHORTNAME: "CB",
            AGENCY_ID: "a-1",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
    {
      features: [
        {
          attributes: {
            OBJECTID: 200,
            COMMISSION_ID: "c-1",
            COMMISSION_NAME: "Budget Commission",
            SHORT_NAME: "BC",
            AGENCY_ID: "a-1",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
    {
      features: [
        {
          attributes: {
            OBJECTID: 300,
            AUTHORITY_ID: "au-1",
            AUTHORITY_NAME: "District Authority",
            SHORT_NAME: "DA",
            AGENCY_ID: "a-1",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
  ];

  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
    const response = responses[callCount];
    callCount += 1;
    if (!response) {
      return new Response("missing fixture", { status: 404 });
    }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  const restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };

  try {
    const collectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.agencies",
      "--limit",
      "2",
    ]);
    assertEquals(collectCode, 0);

    const generateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(generateCode, 0);

    const stateEntries = await listEntryFiles(join(stateRoot, "entries"));
    assertEquals(stateEntries.includes("dc.agency:a-1.json"), true);
    assertEquals(stateEntries.includes("dc.agency:a-2.json"), true);

    const indexCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "index",
    ]);
    assertEquals(indexCode, 0);

    const db = openWorkspace(workspace);
    initWorkspace(db);
    assertEquals(countRows(db, "state_entries"), 2);
    assertEquals(countRows(db, "state_relations"), 0);
    closeWorkspace(db);

    const checkCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "check",
    ]);
    assertEquals(checkCode, 0);
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
  }
});

Deno.test("state generation applies revision overlays from ledger revisions", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-revision-" });
  const projectRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-cli-state-revision-project-",
  });
  const stateRoot = join(projectRoot, "state");
  const revisionRoot = join(projectRoot, "revisions");
  await Deno.mkdir(stateRoot, { recursive: true });
  await Deno.mkdir(revisionRoot, { recursive: true });

  const responses = [
    {
      features: [
        {
          attributes: {
            OBJECTID: 1,
            AGENCY_ID: "a-1",
            AGENCY_NAME: "Agency One",
            SHORT_NAME: "A1",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
  ];

  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
    const response = responses[callCount];
    callCount += 1;
    if (!response) {
      return new Response("missing fixture", { status: 404 });
    }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  await Deno.writeTextFile(
    join(revisionRoot, "entry-name-override.json"),
    JSON.stringify({
      id: "revision-1",
      source: "operator",
      targetKind: "entry",
      targetId: "dc.agency:a-1",
      patch: {
        name: "Agency One (canonical)",
      },
    }),
  );

  try {
    const collectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.agencies",
      "--limit",
      "1",
    ]);
    assertEquals(collectCode, 0);

    const generateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(generateCode, 0);

    const stateEntry = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.agency:a-1.json")),
    ) as { name: string };
    assertEquals(stateEntry.name, "Agency One (canonical)");
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("state generation fails when revision payload is invalid", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-revision-invalid-" });
  const projectRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-cli-state-revision-project-invalid-",
  });
  const stateRoot = join(projectRoot, "state");
  const revisionRoot = join(projectRoot, "revisions");
  await Deno.mkdir(stateRoot, { recursive: true });
  await Deno.mkdir(revisionRoot, { recursive: true });

  const response = {
    features: [
      {
        attributes: {
          OBJECTID: 1,
          AGENCY_ID: "a-1",
          AGENCY_NAME: "Agency One",
          SHORT_NAME: "A1",
        },
      },
    ],
    exceededTransferLimit: false,
    objectIdFieldName: "OBJECTID",
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  await Deno.writeTextFile(
    join(revisionRoot, "bad-revision.json"),
    JSON.stringify({
      id: "revision-bad",
      source: "operator",
      targetKind: "entry",
      targetId: "",
      patch: { name: "broken" },
    }),
  );

  try {
    const collectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.agencies",
      "--limit",
      "1",
    ]);
    assertEquals(collectCode, 0);

    const generateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(generateCode, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("state generation applies relation revision overlays", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-relation-revision-" });
  const projectRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-cli-state-relation-revision-project-",
  });
  const stateRoot = join(projectRoot, "state");
  const revisionRoot = join(projectRoot, "revisions");
  await Deno.mkdir(stateRoot, { recursive: true });
  await Deno.mkdir(revisionRoot, { recursive: true });

  const response = {
    features: [
      {
        attributes: {
          OBJECTID: 1,
          AGENCY_ID: "a-1",
          AGENCY_NAME: "Agency One",
          SHORT_NAME: "A1",
        },
      },
      {
        attributes: {
          OBJECTID: 2,
          AGENCY_ID: "a-2",
          AGENCY_NAME: "Agency Two",
          SHORT_NAME: "A2",
          PARENT_AGENCY_ID: "a-1",
        },
      },
    ],
    exceededTransferLimit: false,
    objectIdFieldName: "OBJECTID",
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  await Deno.writeTextFile(
    join(revisionRoot, "a2-affiliation.json"),
    JSON.stringify({
      id: "revision-a2-relations",
      source: "operator",
      targetKind: "relation",
      targetId: "dc.agency:a-2",
      patch: {
        relations: {
          "dc.relation:governs": [{
            kind: "dc.relation:governs",
            to: "dc.agency:a-1",
          }],
        },
      },
    }),
  );

  try {
    const collectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.agencies",
      "--limit",
      "2",
    ]);
    assertEquals(collectCode, 0);

    const generateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(generateCode, 0);

    const agencyTwo = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.agency:a-2.json")),
    ) as { relations: Record<string, Array<{ to: string }>> };
    assertEquals(agencyTwo.relations["dc.relation:governs"][0]?.to, "dc.agency:a-1");
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("state generation can compile agency and board sources together", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-multi-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-multi-output-" });
  const restoreFetch = mockArcGISFetch(
    new Map([
      [
        "0",
        {
          features: [
            {
              attributes: {
                OBJECTID: 1,
                AGENCY_ID: "a-1",
                AGENCY_NAME: "Agency One",
                SHORT_NAME: "A1",
                BOARD_ID: "b-1",
                BOARD_NAME: "Advisory Board",
                SHORTNAME: "AB",
              },
            },
          ],
          exceededTransferLimit: false,
          objectIdFieldName: "OBJECTID",
        },
      ],
    ]),
  );

  try {
    const agencyCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.agencies",
      "--limit",
      "1",
    ]);
    assertEquals(agencyCode, 0);

    const boardCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.boards",
      "--limit",
      "1",
    ]);
    assertEquals(boardCode, 0);

    const generateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(generateCode, 0);

    const stateEntries = await listEntryFiles(join(stateRoot, "entries"));
    assertEquals(stateEntries.includes("dc.agency:a-1.json"), true);
    assertEquals(stateEntries.includes("dc.board:b-1.json"), true);
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
  }
});

Deno.test("state generation can compile agency, board, and commission sources together", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-multi-3-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-multi-3-output-" });
  const responses = [
    {
      features: [
        {
          attributes: {
            OBJECTID: 1,
            AGENCY_ID: "a-1",
            AGENCY_NAME: "Agency One",
            SHORT_NAME: "A1",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
    {
      features: [
        {
          attributes: {
            OBJECTID: 100,
            BOARD_ID: "b-1",
            BOARD_NAME: "Advisory Board",
            SHORTNAME: "AB",
            AGENCY_ID: "a-1",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
    {
      features: [
        {
          attributes: {
            OBJECTID: 200,
            COMMISSION_ID: "c-1",
            COMMISSION_NAME: "City Commission",
            SHORT_NAME: "CC",
            AGENCY_ID: "a-1",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
  ];
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
    const response = responses[callCount];
    callCount += 1;
    if (!response) {
      return new Response("missing fixture", { status: 404 });
    }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  const restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };

  try {
    const agencyCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.agencies",
      "--limit",
      "1",
    ]);
    assertEquals(agencyCode, 0);

    const boardCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.boards",
      "--limit",
      "1",
    ]);
    assertEquals(boardCode, 0);

    const commissionCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.commissions",
      "--limit",
      "1",
    ]);
    assertEquals(commissionCode, 0);

    const generateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(generateCode, 0);

    const stateEntries = await listEntryFiles(join(stateRoot, "entries"));
    assertEquals(stateEntries.includes("dc.agency:a-1.json"), true);
    assertEquals(stateEntries.includes("dc.board:b-1.json"), true);
    assertEquals(stateEntries.includes("dc.commission:c-1.json"), true);
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
  }
});

Deno.test("state generation can compile ANC and SMD sources together with commissioner seats", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-anc-smd-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-anc-smd-output-" });
  const releaseRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-anc-smd-release-" });

  const responses = [
    {
      features: [
        {
          attributes: {
            OBJECTID: 1,
            ANC_ID: "1A",
            NAME: "ANC 1A",
            WEB_URL: "https://example/anc/1A",
            GIS_ID: "gis-1A",
          },
        },
        {
          attributes: {
            OBJECTID: 2,
            ANC_ID: "3/4G",
            NAME: "ANC 3/4G",
            WEB_URL: "https://example/anc/3-4G",
            GIS_ID: "gis-3-4G",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
    {
      features: [
        {
          attributes: {
            OBJECTID: 21,
            SMD_ID: "1A01",
            ANC_ID: "1A",
            NAME: "SMD 1A01",
            REP_NAME: "Jane Doe",
            FIRST_NAME: "Jane",
            LAST_NAME: "Doe",
            WEB_URL: "https://example/smd/1A01",
            EMAIL: "jane@example.com",
          },
        },
        {
          attributes: {
            OBJECTID: 22,
            SMD_ID: "3/4G01",
            ANC_ID: "3/4G",
            NAME: "SMD 3/4G01",
            REP_NAME: "John Smith",
            FIRST_NAME: "John",
            LAST_NAME: "Smith",
            WEB_URL: "https://example/smd/3-4G01",
            EMAIL: "john@example.com",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
  ];

  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
    const response = responses[callCount];
    callCount += 1;
    if (!response) {
      return new Response("missing fixture", { status: 404 });
    }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  try {
    const ancCollectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.ancs",
      "--limit",
      "2",
    ]);
    assertEquals(ancCollectCode, 0);

    const smdCollectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.smds",
      "--limit",
      "2",
    ]);
    assertEquals(smdCollectCode, 0);

    const generateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(generateCode, 0);

    const stateEntryFiles = await listEntryFiles(join(stateRoot, "entries"));
    assertEquals(stateEntryFiles.includes("dc.anc:1A.json"), true);
    assertEquals(stateEntryFiles.includes("dc.anc:3~2F4G.json"), true);
    assertEquals(stateEntryFiles.includes("dc.smd:1A01.json"), true);
    assertEquals(stateEntryFiles.includes("dc.smd:3~2F4G01.json"), true);
    assertEquals(stateEntryFiles.includes("dc.person:anc_commissioner_1A01.json"), false);
    assertEquals(stateEntryFiles.includes("dc.person:anc_commissioner_3~2F4G01.json"), false);
    assertEquals(stateEntryFiles.includes("dc.anc_commissioner_seat:1A01.json"), true);
    assertEquals(stateEntryFiles.includes("dc.anc_commissioner_seat:3~2F4G01.json"), true);

    const ancSlashEntry = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.anc:3~2F4G.json")),
    ) as {
      id: string;
      attributes: Record<string, unknown>;
      relations: Record<string, Array<{ kind: string; to: string }>>;
    };
    assertEquals(ancSlashEntry.id, "dc.anc:3~2F4G");
    assertEquals(ancSlashEntry.attributes.sourceAncId, "3/4G");
    assertEquals(ancSlashEntry.relations["dc.relation:contains"][0]?.to, "dc.smd:3~2F4G01");

    const smdSlashEntry = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.smd:3~2F4G01.json")),
    ) as {
      id: string;
      attributes: Record<string, unknown>;
      relations: Record<string, Array<{ kind: string; to: string }>>;
    };
    assertEquals(smdSlashEntry.id, "dc.smd:3~2F4G01");
    assertEquals(smdSlashEntry.attributes.sourceSmdId, "3/4G01");
    assertEquals(smdSlashEntry.attributes.sourceAncId, "3/4G");
    assertEquals(Object.hasOwn(smdSlashEntry.relations, "dc.relation:represents"), false);
    assertEquals(Object.hasOwn(smdSlashEntry.relations, "dc.relation:holds"), false);
    assertEquals(Object.hasOwn(smdSlashEntry.attributes, "email"), false);
    assertEquals(Object.hasOwn(smdSlashEntry.attributes, "officeEmail"), false);

    const seatSlashEntry = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.anc_commissioner_seat:3~2F4G01.json")),
    ) as {
      id: string;
      family: string;
      kind: string;
      attributes: Record<string, unknown>;
      relations: Record<string, Array<{ kind: string; to: string }>>;
    };
    assertEquals(seatSlashEntry.id, "dc.anc_commissioner_seat:3~2F4G01");
    assertEquals(seatSlashEntry.family, "position");
    assertEquals(seatSlashEntry.kind, "dc.anc_commissioner_seat");
    assertEquals(seatSlashEntry.attributes.sourceSmdId, "3/4G01");
    assertEquals(seatSlashEntry.attributes.sourceAncId, "3/4G");
    assertEquals(seatSlashEntry.attributes.sourceRepresentativeName, "John Smith");
    assertEquals(seatSlashEntry.attributes.sourceFirstName, "John");
    assertEquals(seatSlashEntry.attributes.sourceLastName, "Smith");
    assertEquals(seatSlashEntry.attributes.officeEmail, "john@example.com");
    assertEquals(seatSlashEntry.relations["dc.relation:represents"][0]?.to, "dc.smd:3~2F4G01");
    assertEquals(Object.hasOwn(seatSlashEntry.relations, "dc.relation:holds"), false);

    const indexCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "index",
    ]);
    assertEquals(indexCode, 0);

    const db = openWorkspace(workspace);
    initWorkspace(db);
    assertEquals(countRows(db, "state_entries"), 6);
    assertEquals(countRows(db, "state_relations"), 4);
    closeWorkspace(db);

    const checkCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "check",
    ]);
    assertEquals(checkCode, 0);

    const exportCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "--release-root",
      releaseRoot,
      "export",
    ]);
    assertEquals(exportCode, 0);

    const manifest = JSON.parse(await Deno.readTextFile(join(releaseRoot, "manifest.json")));
    assertEquals(manifest.counts.entries, 6);
    assertEquals(manifest.counts.relations, 4);
    assertEquals(manifest.counts.citations, 10);
    assertEquals(manifest.counts.sources, 2);
    assertEquals(manifest.counts.relationKinds["dc.relation:contains"], 2);
    assertEquals(manifest.counts.relationKinds["dc.relation:represents"], 2);

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "entries.csv"));
    assertEquals(entriesCsv.includes("dc.anc:3~2F4G"), true);
    assertEquals(entriesCsv.includes("dc.smd:3~2F4G01"), true);
    assertEquals(entriesCsv.includes("dc.anc_commissioner_seat:3~2F4G01"), true);
    assertEquals(entriesCsv.includes("Jane Doe"), true);
    assertEquals(entriesCsv.includes("John Smith"), true);
    assertEquals(entriesCsv.includes("jane@example.com"), true);
    assertEquals(entriesCsv.includes("john@example.com"), true);
    assertEquals(entriesCsv.includes("dc.person:anc_commissioner_3~2F4G01"), false);

    const relationsCsv = await Deno.readTextFile(join(releaseRoot, "relations.csv"));
    assertEquals(relationsCsv.includes("dc.relation:contains"), true);
    assertEquals(relationsCsv.includes("dc.relation:represents"), true);
    assertEquals(relationsCsv.includes("dc.anc:3~2F4G"), true);
    assertEquals(relationsCsv.includes("dc.smd:3~2F4G01"), true);
    assertEquals(relationsCsv.includes("dc.anc_commissioner_seat:3~2F4G01"), true);
    assertEquals(relationsCsv.includes("Jane Doe"), false);
    assertEquals(relationsCsv.includes("John Smith"), false);
    assertEquals(relationsCsv.includes("jane@example.com"), false);
    assertEquals(relationsCsv.includes("john@example.com"), false);
    assertEquals(relationsCsv.includes("dc.person:anc_commissioner_3~2F4G01"), false);

    const citationsCsv = await Deno.readTextFile(join(releaseRoot, "citations.csv"));
    assertEquals(citationsCsv.includes("3/4G01"), true);
    assertEquals(citationsCsv.includes("3/4G"), true);
    assertEquals(citationsCsv.includes("Jane Doe"), false);
    assertEquals(citationsCsv.includes("John Smith"), false);
    assertEquals(citationsCsv.includes("jane@example.com"), false);
    assertEquals(citationsCsv.includes("john@example.com"), false);

    const sourcesCsv = await Deno.readTextFile(join(releaseRoot, "sources.csv"));
    assertEquals(sourcesCsv.includes("dcgis.ancs"), true);
    assertEquals(sourcesCsv.includes("dcgis.smds"), true);
    assertEquals(sourcesCsv.includes("Jane Doe"), false);
    assertEquals(sourcesCsv.includes("John Smith"), false);
    assertEquals(sourcesCsv.includes("jane@example.com"), false);
    assertEquals(sourcesCsv.includes("john@example.com"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

Deno.test("state generation persists interpreter findings in workspace", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-findings-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-findings-output-" });
  const restoreFetch = mockArcGISFetch(
    new Map([
      [
        "0",
        {
          features: [
            {
              attributes: {
                OBJECTID: 1,
                AGENCY_ID: "a-1",
                AGENCY_NAME: "Agency One",
                SHORT_NAME: "A1",
              },
            },
            {
              attributes: {
                OBJECTID: 2,
                AGENCY_ID: "a-2",
                SHORT_NAME: "A2",
              },
            },
          ],
          exceededTransferLimit: false,
          objectIdFieldName: "OBJECTID",
        },
      ],
    ]),
  );

  try {
    const collectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.agencies",
      "--limit",
      "2",
    ]);
    assertEquals(collectCode, 0);

    const generateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(generateCode, 0);

    const db = openWorkspace(workspace);
    initWorkspace(db);
    try {
      assertEquals(countRows(db, "findings"), 1);
      const findingRow = db.db.prepare(
        "SELECT source, payload FROM findings ORDER BY id ASC",
      ).get() as { source: string; payload: string } | undefined;
      assertEquals(findingRow?.source, "dc.interpreter.agency_name_missing");
      const finding = JSON.parse(findingRow?.payload ?? "{}") as {
        kind: string;
        code: string;
      };
      assertEquals(finding.kind, "warn");
      assertEquals(finding.code, "dc.interpreter.agency_name_missing");
    } finally {
      closeWorkspace(db);
    }
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
  }
});

Deno.test("state generation can compile authority source", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-authority-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-authority-output-" });
  const responses = [
    {
      features: [
        {
          attributes: {
            OBJECTID: 1,
            AGENCY_ID: "a-1",
            AGENCY_NAME: "Agency One",
            SHORT_NAME: "A1",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
    {
      features: [
        {
          attributes: {
            OBJECTID: 101,
            AUTHORITY_ID: "au-1",
            AUTHORITY_NAME: "City Authority",
            SHORT_NAME: "CA",
            GOVERNING_AGENCY: "Agency One",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
  ];

  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
    const response = responses[callCount];
    callCount += 1;
    if (!response) {
      return new Response("missing fixture", { status: 404 });
    }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  }) as typeof globalThis.fetch;
  const restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };

  try {
    const agencyCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.agencies",
      "--limit",
      "1",
    ]);
    assertEquals(agencyCode, 0);

    const authorityCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.authorities",
      "--limit",
      "1",
    ]);
    assertEquals(authorityCode, 0);

    const generateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(generateCode, 0);

    const stateEntries = await listEntryFiles(join(stateRoot, "entries"));
    assertEquals(stateEntries.includes("dc.agency:a-1.json"), true);
    assertEquals(stateEntries.includes("dc.authority:au-1.json"), true);

    const authorityEntry = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.authority:au-1.json")),
    ) as { family: string; relations: Record<string, Array<{ to: string }>> };
    assertEquals(authorityEntry.family, "authority");
    assertEquals(authorityEntry.relations["dc.relation:governs"][0]?.to, "dc.agency:a-1");
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
  }
});

Deno.test(
  "state generation resolves board and commission governing agencies from name lookup",
  async () => {
    const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-multi-lookup-" });
    const stateRoot = await Deno.makeTempDir({
      prefix: "civic-ledger-cli-state-multi-lookup-output-",
    });
    const responses = [
      {
        features: [
          {
            attributes: {
              OBJECTID: 1,
              AGENCY_ID: "a-1",
              AGENCY_NAME: "District of Columbia",
              SHORT_NAME: "DC",
            },
          },
        ],
        exceededTransferLimit: false,
        objectIdFieldName: "OBJECTID",
      },
      {
        features: [
          {
            attributes: {
              ENTITY_ID: "b-1",
              OBJECTID: 101,
              NAME: "City Board",
              GOVERNING_AGENCY: "District Of Columbia",
            },
          },
        ],
        exceededTransferLimit: false,
        objectIdFieldName: "OBJECTID",
      },
      {
        features: [
          {
            attributes: {
              ENTITY_ID: "c-1",
              OBJECTID: 201,
              NAME: "City Commission",
              GOVERNING_AGENCY: "DC",
            },
          },
        ],
        exceededTransferLimit: false,
        objectIdFieldName: "OBJECTID",
      },
    ];

    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      const response = responses[callCount];
      callCount += 1;
      if (!response) {
        return new Response("missing fixture", { status: 404 });
      }
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const restoreFetch = () => {
      globalThis.fetch = originalFetch;
    };

    try {
      const agencyCode = await runCli([
        "--workspace",
        workspace,
        "collect",
        "dcgis.agencies",
        "--limit",
        "1",
      ]);
      assertEquals(agencyCode, 0);

      const boardCode = await runCli([
        "--workspace",
        workspace,
        "collect",
        "dcgis.boards",
        "--limit",
        "1",
      ]);
      assertEquals(boardCode, 0);

      const commissionCode = await runCli([
        "--workspace",
        workspace,
        "collect",
        "dcgis.commissions",
        "--limit",
        "1",
      ]);
      assertEquals(commissionCode, 0);

      const generateCode = await runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "state",
        "generate",
      ]);
      assertEquals(generateCode, 0);

      const boardEntry = JSON.parse(
        await Deno.readTextFile(join(stateRoot, "entries", "dc.board:b-1.json")),
      ) as { relations: Record<string, Array<{ to: string }>> };
      const commissionEntry = JSON.parse(
        await Deno.readTextFile(join(stateRoot, "entries", "dc.commission:c-1.json")),
      ) as { relations: Record<string, Array<{ to: string }>> };

      assertEquals(
        boardEntry.relations["dc.relation:governs"][0]?.to,
        "dc.agency:a-1",
      );
      assertEquals(
        commissionEntry.relations["dc.relation:governs"][0]?.to,
        "dc.agency:a-1",
      );
    } finally {
      restoreFetch();
      await Deno.remove(workspace, { recursive: true });
      await Deno.remove(stateRoot, { recursive: true });
    }
  },
);

Deno.test("state generation accepts agencies reports_to relations", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-relations-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-relations-output-" });
  const restoreFetch = mockArcGISFetch(
    new Map([
      [
        "0",
        {
          features: [
            {
              attributes: {
                OBJECTID: 1,
                AGENCY_ID: "a-1",
                AGENCY_NAME: "Agency One",
                SHORT_NAME: "A1",
              },
            },
            {
              attributes: {
                OBJECTID: 2,
                AGENCY_ID: "a-2",
                AGENCY_NAME: "Agency Two",
                SHORT_NAME: "A2",
                PARENT_AGENCY_ID: "a-1",
              },
            },
          ],
          exceededTransferLimit: false,
          objectIdFieldName: "OBJECTID",
        },
      ],
    ]),
  );

  try {
    const collectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.agencies",
      "--limit",
      "2",
    ]);
    assertEquals(collectCode, 0);

    const generateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(generateCode, 0);

    const checkCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "check",
    ]);
    assertEquals(checkCode, 0);
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
  }
});

Deno.test("export command indexes committed state and writes release artifacts", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-export-workspace-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-export-state-" });
  const releaseRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-export-release-" });

  const responses = [
    {
      features: [
        {
          attributes: {
            OBJECTID: 1,
            AGENCY_ID: "a-1",
            AGENCY_NAME: "Agency One",
            SHORT_NAME: "A1",
          },
        },
        {
          attributes: {
            OBJECTID: 2,
            AGENCY_ID: "a-2",
            AGENCY_NAME: "Agency Two",
            SHORT_NAME: "A2",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
    {
      features: [
        {
          attributes: {
            OBJECTID: 100,
            BOARD_ID: "b-1",
            BOARD_NAME: "City Board",
            SHORTNAME: "CB",
            AGENCY_ID: "a-1",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
    {
      features: [
        {
          attributes: {
            OBJECTID: 200,
            COMMISSION_ID: "c-1",
            COMMISSION_NAME: "Budget Commission",
            SHORT_NAME: "BC",
            AGENCY_ID: "a-1",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
    {
      features: [
        {
          attributes: {
            OBJECTID: 300,
            AUTHORITY_ID: "au-1",
            AUTHORITY_NAME: "District Authority",
            SHORT_NAME: "DA",
            AGENCY_ID: "a-1",
          },
        },
      ],
      exceededTransferLimit: false,
      objectIdFieldName: "OBJECTID",
    },
  ];

  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
    const response = responses[callCount];
    callCount += 1;
    if (!response) {
      return new Response("missing fixture", { status: 404 });
    }
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  const restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };

  try {
    const collectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.agencies",
      "--limit",
      "2",
    ]);
    assertEquals(collectCode, 0);

    const generateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(generateCode, 0);

    const boardCollectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.boards",
    ]);
    assertEquals(boardCollectCode, 0);

    const boardGenerateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(boardGenerateCode, 0);

    const commissionCollectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.commissions",
    ]);
    assertEquals(commissionCollectCode, 0);

    const commissionGenerateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(commissionGenerateCode, 0);

    const authorityCollectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.authorities",
      "--limit",
      "1",
    ]);
    assertEquals(authorityCollectCode, 0);

    const authorityGenerateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(authorityGenerateCode, 0);

    const exportCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "--release-root",
      releaseRoot,
      "export",
    ]);
    assertEquals(exportCode, 0);

    const expectedFiles = [
      "entries.csv",
      "relations.csv",
      "citations.csv",
      "sources.csv",
      "dc_board_affiliations.csv",
      "dc_commission_affiliations.csv",
      "dc_authority_affiliations.csv",
      "manifest.json",
      "ledger.sqlite",
      "README.md",
    ];

    for (const name of expectedFiles) {
      assertEquals(await exists(join(releaseRoot, name)), true);
    }

    const manifest = JSON.parse(await Deno.readTextFile(join(releaseRoot, "manifest.json")));
    assertEquals(manifest.jurisdiction, "dc");
    assertEquals(manifest.counts.entries, 5);
    assertEquals(manifest.counts.relations, 3);
    assertEquals(manifest.counts.relationKinds["dc.relation:governs"], 3);
    assertEquals(manifest.counts.boardAffiliations, 1);
    assertEquals(manifest.counts.commissionAffiliations, 1);
    assertEquals(manifest.counts.authorityAffiliations, 1);

    const affiliations = await Deno.readTextFile(join(releaseRoot, "dc_board_affiliations.csv"));
    assertEquals(affiliations.includes("dc.board:b-1"), true);
    assertEquals(affiliations.includes("dc.agency:a-1"), true);
    const commissionAffiliations = await Deno.readTextFile(
      join(releaseRoot, "dc_commission_affiliations.csv"),
    );
    assertEquals(commissionAffiliations.includes("dc.commission:c-1"), true);
    assertEquals(commissionAffiliations.includes("dc.agency:a-1"), true);

    const authorityAffiliations = await Deno.readTextFile(
      join(releaseRoot, "dc_authority_affiliations.csv"),
    );
    assertEquals(authorityAffiliations.includes("dc.authority:au-1"), true);
    assertEquals(authorityAffiliations.includes("dc.agency:a-1"), true);

    const ledgerDb = new Database(join(releaseRoot, "ledger.sqlite"));
    try {
      const entryCount = ledgerDb.prepare("SELECT COUNT(*) as count FROM entries").get() as {
        count: number;
      };
      assertEquals(entryCount.count, 5);
    } finally {
      ledgerDb.close();
    }
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

Deno.test("check fails when committed state has unknown relation kind", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-check-invalid-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-check-invalid-state-" });

  try {
    const stateEntries = `${stateRoot}/entries`;
    await Deno.mkdir(stateEntries, { recursive: true });
    await Deno.writeTextFile(
      `${stateEntries}/dc.agency:a-1.json`,
      JSON.stringify({
        id: "dc.agency:a-1",
        family: "organization",
        kind: "dc.agency",
        name: "Agency A",
        attributes: { shortName: "A" },
        citations: [{ source: "dcgis.agencies", sourceRecordId: "row-1" }],
        relations: {
          "dc.relation:unknown": [{
            kind: "dc.relation:unknown",
            to: "dc.agency:a-2",
            citations: [{ source: "dcgis.agencies", sourceRecordId: "row-1" }],
          }],
        },
      }),
    );

    await Deno.writeTextFile(
      `${stateEntries}/dc.agency:a-2.json`,
      JSON.stringify({
        id: "dc.agency:a-2",
        family: "organization",
        kind: "dc.agency",
        name: "Agency B",
        attributes: { shortName: "B" },
        citations: [{ source: "dcgis.agencies", sourceRecordId: "row-2" }],
        relations: {},
      }),
    );

    const checkCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "check",
    ]);

    assertEquals(checkCode, 1);
  } finally {
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
  }
});

Deno.test("collect fails on invalid limit input", async () => {
  const exitCode = await runCli([
    "collect",
    "dcgis.agencies",
    "--limit",
    "abc",
  ]);
  assertEquals(exitCode, 1);
});

Deno.test("export fails when state is empty", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-export-empty-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-export-empty-state-" });
  const releaseRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-export-empty-release-" });

  try {
    const code = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "--release-root",
      releaseRoot,
      "export",
    ]);

    assertEquals(code, 1);
  } finally {
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

Deno.test("export fails when state root is missing files", async () => {
  const workspace = await Deno.makeTempDir({
    prefix: "civic-ledger-cli-export-missing-state-root-",
  });
  const missingStateRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-cli-export-missing-state-data-",
  });
  const releaseRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-cli-export-missing-release-",
  });

  try {
    await Deno.remove(missingStateRoot, { recursive: true });

    const code = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      missingStateRoot,
      "--release-root",
      releaseRoot,
      "export",
    ]);

    assertEquals(code, 1);
  } finally {
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

Deno.test("CLI script prints help when run directly", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-net",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "src/cli/main.ts",
      "--help",
    ],
    cwd: new URL("../..", import.meta.url),
  });

  const output = await command.output();
  const stdout = stripAnsi(new TextDecoder().decode(output.stdout));

  assertEquals(output.code, 0);
  assertEquals(stdout.includes("Usage: dc"), true);
});

Deno.test("CLI task tolerates task separator before help", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["task", "civic", "--", "--help"],
    cwd: new URL("../..", import.meta.url),
  });

  const output = await command.output();
  const stdout = stripAnsi(new TextDecoder().decode(output.stdout));

  assertEquals(output.code, 0);
  assertEquals(stdout.includes("Usage: dc"), true);
});

async function listEntryFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isFile) {
      files.push(entry.name);
    }
  }
  return files;
}

function countRows(db: ReturnType<typeof openWorkspace>, table: string): number {
  const statement = db.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`);
  const row = statement.get() as { count: number } | undefined;
  return row?.count ?? 0;
}

function stripAnsi(input: string): string {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === "\u001b" && input[index + 1] === "[") {
      index += 2;
      while (index < input.length && input[index] !== "m") {
        index += 1;
      }
      continue;
    }
    output += input[index];
  }
  return output;
}

async function exists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

function mockArcGISFetch(responses: Map<string, Record<string, unknown>>): () => void {
  const originalFetch = globalThis.fetch;
  const mocked = async (
    input: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? new URL(input.url) : new URL(input.toString());
    const key = url.searchParams.get("resultOffset") ?? "0";
    const payload = responses.get(key);
    if (!payload) {
      return new Response("missing fixture", { status: 404 });
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };

  globalThis.fetch = mocked as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}
