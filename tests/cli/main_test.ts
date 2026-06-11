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

Deno.test("collect command supports dcgis.councils source", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-collect-councils-" });
  const restoreFetch = mockArcGISFetch(
    new Map([
      [
        "0",
        {
          features: [
            {
              attributes: {
                OBJECTID: 21,
                ENTITY_ID: "co-1",
                NAME: "Food Policy Council",
                SHORT_NAME: "FPC",
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
      "dcgis.councils",
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

Deno.test("state generation can compile Council committees and councilmembers together", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-council-committees-" });
  const stateRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-cli-council-committees-state-",
  });
  const releaseRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-cli-council-committees-release-",
  });

  const responses = new Map<string, string>([
    [
      "https://dccouncil.gov/councilmembers/",
      `
      <a href="https://dccouncil.gov/council/phil-mendelson/">Chairman Phil Mendelson</a>
      <a href="https://dccouncil.gov/council/anita-bonds/">At-Large Councilmember Anita Bonds</a>
      <a href="https://dccouncil.gov/council/ward-2-councilmember-brooke-pinto/">Ward 2 Councilmember Brooke Pinto</a>
      <a href="https://dccouncil.gov/council/zachary-parker/">Ward 5 Councilmember Zachary Parker</a>
      <a href="https://dccouncil.gov/council/at-large-councilmember-doni-crawford/">At-Large Councilmember Doni Crawford</a>
      <a href="https://dccouncil.gov/council/councilmember-trayon-white-sr/">Ward 8 Councilmember Trayon White, Sr.</a>
      `,
    ],
    [
      "https://dccouncil.gov/committees/",
      `
      <h3>Committees</h3>
      <ul>
        <li><a href="https://dccouncil.gov/committees/committee-of-the-whole/">Committee of the Whole</a></li>
        <li><a href="https://dccouncil.gov/committees/committee-on-youth-affairs/">Committee on Youth Affairs</a></li>
      </ul>
      `,
    ],
    [
      "https://dccouncil.gov/committees/committee-of-the-whole/",
      `
      <h1>Committee of the Whole</h1>
      <h2>Councilmembers</h2>
      <h4>Chairperson</h4>
      <p><a href="https://dccouncil.gov/council/phil-mendelson/">Chairman Phil Mendelson</a></p>
      <hr>
      <h4>Councilmembers</h4>
      <ul>
        <li><a href="https://dccouncil.gov/council/anita-bonds/">At-Large Councilmember Anita Bonds</a></li>
      </ul>
      <h2>Agencies Under This Committee</h2>
      `,
    ],
    [
      "https://dccouncil.gov/committees/committee-on-youth-affairs/",
      `
      <h1>Committee on Youth Affairs</h1>
      <h2>Councilmembers</h2>
      <h4>Chairperson</h4>
      <p><a href="https://dccouncil.gov/council/zachary-parker/">Ward 5 Councilmember Zachary Parker</a></p>
      <hr>
      <h4>Councilmembers</h4>
      <ul>
        <li><a href="https://dccouncil.gov/council/at-large-councilmember-doni-crawford/">At-Large Councilmember Doni Crawford</a></li>
        <li><a href="https://dccouncil.gov/council/ward-2-councilmember-brooke-pinto/">Ward 2 Councilmember Brooke Pinto</a></li>
      </ul>
      <h2>Agencies Under This Committee</h2>
      `,
    ],
  ]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const key = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const body = responses.get(key);
    if (!body) {
      return new Response("missing fixture", { status: 404 });
    }
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof globalThis.fetch;

  try {
    const membersCollectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dccouncil.members",
      "--limit",
      "6",
    ]);
    assertEquals(membersCollectCode, 0);

    const collectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dccouncil.committees",
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

    const committeeEntryFiles = await listEntryFiles(join(stateRoot, "entries"));
    assertEquals(committeeEntryFiles.includes("dc.committee:committee-of-the-whole.json"), true);
    assertEquals(
      committeeEntryFiles.includes("dc.committee:committee-on-youth-affairs.json"),
      true,
    );
    assertEquals(committeeEntryFiles.includes("dc.councilmember:phil-mendelson.json"), true);
    assertEquals(committeeEntryFiles.includes("dc.councilmember:anita-bonds.json"), true);
    assertEquals(
      committeeEntryFiles.includes("dc.councilmember:councilmember-trayon-white-sr.json"),
      true,
    );

    const committeeEntry = JSON.parse(
      await Deno.readTextFile(
        join(stateRoot, "entries", "dc.committee:committee-of-the-whole.json"),
      ),
    ) as {
      id: string;
      kind: string;
      attributes: Record<string, unknown>;
      relations: Record<string, Array<{ kind: string; to: string }>>;
    };
    assertEquals(committeeEntry.id, "dc.committee:committee-of-the-whole");
    assertEquals(committeeEntry.kind, "dc.committee");
    assertEquals(committeeEntry.attributes.sourceCommitteeSlug, "committee-of-the-whole");
    assertEquals(Object.hasOwn(committeeEntry.relations, "dc.relation:member_of"), false);

    const chairEntry = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.councilmember:phil-mendelson.json")),
    ) as {
      id: string;
      family: string;
      kind: string;
      attributes: Record<string, unknown>;
      relations: Record<string, Array<{ kind: string; to: string }>>;
    };
    assertEquals(chairEntry.id, "dc.councilmember:phil-mendelson");
    assertEquals(chairEntry.family, "person");
    assertEquals(chairEntry.kind, "dc.councilmember");
    assertEquals(chairEntry.attributes.sourceProfileSlug, "phil-mendelson");
    assertEquals(
      chairEntry.relations["dc.relation:chairs"][0]?.to,
      "dc.committee:committee-of-the-whole",
    );
    assertEquals(
      chairEntry.relations["dc.relation:member_of"][0]?.to,
      "dc.committee:committee-of-the-whole",
    );

    const ward8Entry = JSON.parse(
      await Deno.readTextFile(
        join(stateRoot, "entries", "dc.councilmember:councilmember-trayon-white-sr.json"),
      ),
    ) as {
      id: string;
      relations: Record<string, Array<{ kind: string; to: string }>>;
    };
    assertEquals(
      ward8Entry.relations["dc.relation:member_of"][0]?.to,
      "dc.committee:committee-of-the-whole",
    );

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
    assertEquals(countRows(db, "state_entries"), 8);
    assertEquals(countRows(db, "state_relations"), 11);
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
    assertEquals(manifest.counts.entries, 8);
    assertEquals(manifest.counts.relations, 11);
    assertEquals(manifest.counts.relationKinds["dc.relation:chairs"], 2);
    assertEquals(manifest.counts.relationKinds["dc.relation:member_of"], 9);

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "entries.csv"));
    assertEquals(entriesCsv.includes("dc.committee:committee-of-the-whole"), true);
    assertEquals(entriesCsv.includes("dc.councilmember:phil-mendelson"), true);
    assertEquals(entriesCsv.includes("Committee of the Whole"), true);
    assertEquals(entriesCsv.includes("Trayon White"), true);

    const relationsCsv = await Deno.readTextFile(join(releaseRoot, "relations.csv"));
    assertEquals(relationsCsv.includes("dc.relation:chairs"), true);
    assertEquals(relationsCsv.includes("dc.relation:member_of"), true);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
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

Deno.test("reconcile candidates reports review packets from committed state", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-reconcile-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-reconcile-state-" });
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
                AGENCY_NAME: "Shared Agency",
                SHORT_NAME: "SA1",
              },
            },
            {
              attributes: {
                OBJECTID: 2,
                AGENCY_ID: "a-2",
                AGENCY_NAME: "Shared Agency",
                SHORT_NAME: "SA2",
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

    const reconcileCode = await runCli([
      "--state-root",
      stateRoot,
      "--limit",
      "1",
      "reconcile",
      "candidates",
    ]);
    assertEquals(reconcileCode, 0);
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

Deno.test("state generation can compile agency, board, commission, and council sources together", async () => {
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
    {
      features: [
        {
          attributes: {
            OBJECTID: 210,
            ENTITY_ID: "co-1",
            NAME: "Food Policy Council",
            SHORT_NAME: "FPC",
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

    const councilCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.councils",
      "--limit",
      "1",
    ]);
    assertEquals(councilCode, 0);

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
    assertEquals(stateEntries.includes("dc.council:co-1.json"), true);
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
    assertEquals(Object.hasOwn(seatSlashEntry.attributes, "officeEmail"), false);
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
    assertEquals(entriesCsv.includes("jane@example.com"), false);
    assertEquals(entriesCsv.includes("john@example.com"), false);
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

Deno.test("CLI flow with open_dc.public_bodies and dcgis.agencies produces entries and relations", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-opendc-flow-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-opendc-flow-state-" });
  const releaseRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-opendc-flow-release-" });

  const openDcIndex = `
    <a href="/public-bodies/advisory-board/">Advisory Board (AB)</a>
    <a href="/public-bodies/planning-commission">Planning Commission</a>
    <a href="/public-bodies/water-authority/">Water Authority</a>
    <a href="/public-bodies/climate-task-force/">Climate Task Force</a>
    <a href="/public-bodies/board-accountancy/">Board of Accountancy</a>
    <a href="/public-bodies/meetings">Meetings</a>
  `;

  const detailMap = new Map<string, string>([
    [
      "advisory-board",
      `<html><body>
        <h3>Enabling Statute or Mayoral Order</h3>
        <p><a href="https://code.dccouncil.gov/us/dc/council/code/sections/1-123">D.C. Law 10-50</a></p>
        <h3>Governing Agency or Agency Acronym</h3>
        <p>Department of Public Works (DPW)</p>
        <h3>Administering Agency</h3>
        <p>Office of the Mayor</p>
      </body></html>`,
    ],
    [
      "planning-commission",
      `<html><body>
        <h3>Enabling Statute or Mayoral Order</h3>
        <p>D.C. Code § 1-200</p>
        <h3>Governing Agency or Agency Acronym</h3>
        <p>Office of Planning (OP)</p>
        <h3>Administering Agency</h3>
        <p>Office of Planning</p>
      </body></html>`,
    ],
    [
      "water-authority",
      `<html><body>
        <h3>Governing Agency or Agency Acronym</h3>
        <p>N/A</p>
        <h3>Administering Agency</h3>
        <p>Executive Office of the Mayor</p>
      </body></html>`,
    ],
    [
      "climate-task-force",
      `<html><body>
        <h3>Enabling Statute or Mayoral Order</h3>
        <p>Mayor's Order 2021-007</p>
        <h3>Governing Agency or Agency Acronym</h3>
        <p>DOEE</p>
      </body></html>`,
    ],
    [
      "board-accountancy",
      `<html><body>
        <h1 class="page-title">Board of Accountancy</h1>
        <div class="field field-name-field-statute-mayors-order field-type-link-field field-label-inline clearfix">
          <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
          <div class="field-items"><div class="field-item even"><a href="https://code.dccouncil.us/us/dc/council/code/sections/47-2853.06">D.C. Official Code § 47-2853.06(b)(1)</a></div></div>
        </div>
        <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
          <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
          <div class="field-items"><div class="field-item even">DLCP</div></div>
        </div>
        <div class="view view-meetings-calendar"><a href="/public-bodies/board-accountancy/meetings">Calendar</a></div>
      </body></html>`,
    ],
  ]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, _init?: RequestInit) => {
    const urlStr = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    if (urlStr.includes("maps2.dcgis.dc.gov")) {
      const url = new URL(urlStr);
      const key = url.searchParams.get("resultOffset") ?? "0";
      if (key === "0") {
        return new Response(
          JSON.stringify({
            features: [
              {
                attributes: {
                  OBJECTID: 1,
                  AGENCY_ID: "dpw",
                  AGENCY_NAME: "Department of Public Works",
                  SHORT_NAME: "DPW",
                },
              },
            ],
            exceededTransferLimit: false,
            objectIdFieldName: "OBJECTID",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response("missing fixture", { status: 404 });
    }
    if (urlStr.includes("open-dc.gov")) {
      if (urlStr.includes("/public-bodies/")) {
        for (const [slug, html] of detailMap) {
          if (urlStr.includes(slug)) {
            return new Response(html, {
              status: 200,
              headers: { "content-type": "text/html" },
            });
          }
        }
      }
      return new Response(openDcIndex, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response("missing fixture", { status: 404 });
  }) as typeof globalThis.fetch;
  const restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };

  try {
    const collectAgencies = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.agencies",
      "--limit",
      "1",
    ]);
    assertEquals(collectAgencies, 0);

    const collectOpenDc = await runCli([
      "--workspace",
      workspace,
      "collect",
      "open_dc.public_bodies",
      "--limit",
      "5",
    ]);
    assertEquals(collectOpenDc, 0);

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
    assertEquals(stateEntries.includes("dc.board:advisory-board.json"), true);
    assertEquals(stateEntries.includes("dc.commission:planning-commission.json"), true);
    assertEquals(stateEntries.includes("dc.authority:water-authority.json"), true);
    assertEquals(stateEntries.includes("dc.agency:climate-task-force.json"), true);
    assertEquals(stateEntries.includes("dc.board:board-accountancy.json"), true);
    assertEquals(stateEntries.includes("dc.agency:dpw.json"), true);
    assertEquals(stateEntries.includes("dc.agency:meetings.json"), false);

    const advisoryEntry = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.board:advisory-board.json")),
    ) as {
      relations: Record<string, Array<{ to: string }>>;
    };
    assertEquals(
      advisoryEntry.relations["dc.relation:governs"]?.[0]?.to,
      "dc.agency:dpw",
    );

    const waterAuthorityEntry = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.authority:water-authority.json")),
    ) as {
      relations: Record<string, Array<{ to: string }>>;
    };
    assertEquals(
      waterAuthorityEntry.relations["dc.relation:governs"],
      undefined,
    );

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
    assertEquals(countRows(db, "state_relations"), 1);
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
    assertEquals(manifest.counts.relations, 1);
    assertEquals(manifest.counts.relationKinds["dc.relation:governs"], 1);

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "entries.csv"));
    assertEquals(entriesCsv.includes("Advisory Board"), true);
    assertEquals(entriesCsv.includes("Planning Commission"), true);
    assertEquals(entriesCsv.includes("Water Authority"), true);
    assertEquals(entriesCsv.includes("Climate Task Force"), true);
    assertEquals(entriesCsv.includes("Board of Accountancy"), true);
    assertEquals(entriesCsv.includes("Department of Public Works"), true);

    const relationsCsv = await Deno.readTextFile(join(releaseRoot, "relations.csv"));
    assertEquals(relationsCsv.includes("dc.relation:governs"), true);
    assertEquals(relationsCsv.includes("dc.board:advisory-board"), true);
    assertEquals(relationsCsv.includes("dc.agency:dpw"), true);
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

Deno.test("CLI flow with bega.structure produces offices and part_of relations", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-bega-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-bega-state-" });
  const releaseRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-bega-release-" });

  const responses = new Map<string, string>([
    [
      "https://bega.dc.gov/node/61616/",
      `
      <html>
        <head><title>About BEGA | bega</title></head>
        <body>
          <h1 class="page-title">About BEGA</h1>
          <p>The Board of Ethics and Government Accountability (BEGA) is an independent agency.</p>
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

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const key = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const body = responses.get(key);
    if (!body) {
      return new Response("missing fixture", { status: 404 });
    }
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof globalThis.fetch;

  try {
    const collectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "bega.structure",
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
    assertEquals(
      stateEntries.includes("dc.agency:board-of-ethics-and-government-accountability.json"),
      true,
    );
    assertEquals(stateEntries.includes("dc.office:office-of-government-ethics.json"), true);
    assertEquals(stateEntries.includes("dc.office:office-of-open-government.json"), true);

    const ogeEntry = JSON.parse(
      await Deno.readTextFile(
        join(stateRoot, "entries", "dc.office:office-of-government-ethics.json"),
      ),
    ) as {
      kind: string;
      relations: Record<string, Array<{ kind: string; to: string }>>;
    };
    assertEquals(ogeEntry.kind, "dc.office");
    assertEquals(
      ogeEntry.relations["dc.relation:part_of"][0]?.to,
      "dc.agency:board-of-ethics-and-government-accountability",
    );

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
    assertEquals(countRows(db, "state_entries"), 3);
    assertEquals(countRows(db, "state_relations"), 2);
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
    assertEquals(manifest.counts.entries, 3);
    assertEquals(manifest.counts.relations, 2);
    assertEquals(manifest.counts.relationKinds["dc.relation:part_of"], 2);

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "entries.csv"));
    assertEquals(entriesCsv.includes("Board of Ethics and Government Accountability"), true);
    assertEquals(entriesCsv.includes("Office of Government Ethics"), true);
    assertEquals(entriesCsv.includes("Office of Open Government"), true);

    const relationsCsv = await Deno.readTextFile(join(releaseRoot, "relations.csv"));
    assertEquals(relationsCsv.includes("dc.relation:part_of"), true);
    assertEquals(relationsCsv.includes("dc.office:office-of-government-ethics"), true);
    assertEquals(
      relationsCsv.includes("dc.agency:board-of-ethics-and-government-accountability"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

Deno.test("CLI flow with dccourts.structure produces courts and division part_of relations", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-dccourts-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-dccourts-state-" });
  const releaseRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-dccourts-release-" });

  const responses = new Map<string, string>([
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
          <a href="/superior-court/superior-court-divisions/tax-division">Tax Division</a>
          <a href="/superior-court/superior-court-divisions/crime-victims-compensation">Crime Victims Compensation Program</a>
          <a href="/superior-court/superior-court-divisions/auditor-master">Office of the Auditor-Master</a>
          <a href="/superior-court/superior-court-divisions/family-division/forms">Family Division</a>
        </body>
      </html>
      `,
    ],
  ]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const key = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const body = responses.get(key);
    if (!body) {
      return new Response("missing fixture", { status: 404 });
    }
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof globalThis.fetch;

  try {
    const collectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dccourts.structure",
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
    assertEquals(stateEntries.includes("dc.court_system:district-of-columbia-courts.json"), true);
    assertEquals(stateEntries.includes("dc.court:court-of-appeals.json"), true);
    assertEquals(stateEntries.includes("dc.court:superior-court.json"), true);
    assertEquals(stateEntries.includes("dc.court_division:civil-division.json"), true);
    assertEquals(stateEntries.includes("dc.court_division:tax-division.json"), true);
    assertEquals(
      stateEntries.includes("dc.court_division:crime-victims-compensation.json"),
      false,
    );
    assertEquals(stateEntries.includes("dc.court_division:auditor-master.json"), false);
    assertEquals(stateEntries.includes("dc.court_division:family-division.json"), false);

    const civilEntry = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.court_division:civil-division.json")),
    ) as {
      kind: string;
      relations: Record<string, Array<{ kind: string; to: string }>>;
    };
    assertEquals(civilEntry.kind, "dc.court_division");
    assertEquals(civilEntry.relations["dc.relation:part_of"][0]?.to, "dc.court:superior-court");

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
    assertEquals(countRows(db, "state_entries"), 5);
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
    assertEquals(manifest.counts.entries, 5);
    assertEquals(manifest.counts.relations, 4);
    assertEquals(manifest.counts.relationKinds["dc.relation:part_of"], 4);

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "entries.csv"));
    assertEquals(entriesCsv.includes("District of Columbia Courts"), true);
    assertEquals(entriesCsv.includes("Court of Appeals"), true);
    assertEquals(entriesCsv.includes("Superior Court"), true);
    assertEquals(entriesCsv.includes("Civil Division"), true);
    assertEquals(entriesCsv.includes("Tax Division"), true);
    assertEquals(entriesCsv.includes("Crime Victims Compensation Program"), false);
    assertEquals(entriesCsv.includes("Office of the Auditor-Master"), false);

    const relationsCsv = await Deno.readTextFile(join(releaseRoot, "relations.csv"));
    assertEquals(relationsCsv.includes("dc.relation:part_of"), true);
    assertEquals(relationsCsv.includes("dc.court:court-of-appeals"), true);
    assertEquals(relationsCsv.includes("dc.court:superior-court"), true);
    assertEquals(relationsCsv.includes("dc.court_division:civil-division"), true);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

Deno.test("CLI flow with legal.entrypoints produces legal source anchors", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-legal-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-legal-state-" });
  const releaseRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-legal-release-" });

  const legalHtml = `
  <html>
    <body>
      <a href="https://code.dccouncil.gov/">District of Columbia Official Code</a>
      <a href="https://dcregs.dc.gov/">DC Register / DCMR</a>
      <a href="https://mayor.dc.gov/page/mayors-orders">Mayor's Orders</a>
      <a href="https://dc.gov/page/laws-regulations-and-courts">Laws, Regulations and Courts</a>
      <a href="https://mayor.dc.gov/">Mayor</a>
      <a href="/page/services">Services</a>
      <a href="https://dcregs.dc.gov/Common/DCMR/ChapterList.aspx?subtitleId=1">DCMR Title List</a>
    </body>
  </html>
  `;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const key = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    if (key !== "https://dc.gov/page/laws-regulations-and-courts") {
      return new Response("missing fixture", { status: 404 });
    }
    return new Response(legalHtml, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof globalThis.fetch;

  try {
    const collectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "legal.entrypoints",
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
    assertEquals(
      stateEntries.includes("dc.legal_source:district-of-columbia-official-code.json"),
      true,
    );
    assertEquals(stateEntries.includes("dc.legal_source:dc-register-dcmr.json"), true);
    assertEquals(stateEntries.includes("dc.legal_source:mayors-orders.json"), true);
    assertEquals(stateEntries.includes("dc.legal_source:laws-regulations-and-courts.json"), true);
    assertEquals(stateEntries.includes("dc.legal_source:dcmr-title-list.json"), true);
    assertEquals(stateEntries.includes("dc.legal_source:mayor.json"), false);

    const codeEntry = JSON.parse(
      await Deno.readTextFile(
        join(stateRoot, "entries", "dc.legal_source:district-of-columbia-official-code.json"),
      ),
    ) as {
      family: string;
      kind: string;
      relations: Record<string, unknown>;
    };
    assertEquals(codeEntry.family, "authority");
    assertEquals(codeEntry.kind, "dc.legal_source");
    assertEquals(codeEntry.relations, {});

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
    assertEquals(countRows(db, "state_entries"), 5);
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
    assertEquals(manifest.counts.entries, 5);
    assertEquals(manifest.counts.relations, 0);

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "entries.csv"));
    assertEquals(entriesCsv.includes("District of Columbia Official Code"), true);
    assertEquals(entriesCsv.includes("DC Register / DCMR"), true);
    assertEquals(entriesCsv.includes("Mayor's Orders"), true);
    assertEquals(entriesCsv.includes("Laws, Regulations and Courts"), true);
    assertEquals(entriesCsv.includes("DCMR Title List"), true);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

Deno.test("CLI flow with mayor.executive_structure produces EOM offices", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-mayor-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-mayor-state-" });
  const releaseRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-mayor-release-" });

  const mayorPages = new Map<string, string>([
    [
      "https://mayor.dc.gov/page/organizational-charts-agencies-and-offices-under-mayors-authority",
      `
      <html>
        <head><title>Organizational Charts | mayor</title></head>
        <body>
          <h1>Organizational Charts for Agencies and Offices Under the Mayor's Authority</h1>
          <p>Phone: (202) 727-2643</p>
          <p>Email: mayor@example.com</p>
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

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const key = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const html = mayorPages.get(key);
    if (!html) {
      return new Response("missing fixture", { status: 404 });
    }
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof globalThis.fetch;

  try {
    const collectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "mayor.executive_structure",
      "--limit",
      "3",
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
    assertEquals(stateEntries.includes("dc.office:executive-office-of-the-mayor.json"), true);
    assertEquals(stateEntries.includes("dc.office:office-of-communications.json"), true);
    assertEquals(
      stateEntries.includes("dc.office:mayors-office-of-community-relations-and-services.json"),
      true,
    );

    const communicationsEntry = JSON.parse(
      await Deno.readTextFile(
        join(stateRoot, "entries", "dc.office:office-of-communications.json"),
      ),
    ) as {
      kind: string;
      relations: Record<string, Array<{ kind: string; to: string }>>;
    };
    assertEquals(communicationsEntry.kind, "dc.office");
    assertEquals(
      communicationsEntry.relations["dc.relation:part_of"][0]?.to,
      "dc.office:executive-office-of-the-mayor",
    );

    const indexCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "index",
    ]);
    assertEquals(indexCode, 0);

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
    assertEquals(manifest.counts.entries, 3);
    assertEquals(manifest.counts.relations, 2);

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "entries.csv"));
    assertEquals(entriesCsv.includes("Executive Office of the Mayor"), true);
    assertEquals(entriesCsv.includes("Office of Communications"), true);
    assertEquals(entriesCsv.includes("mayor@example.com"), false);
    assertEquals(entriesCsv.includes("(202) 727-2643"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

Deno.test("CLI flow with oanc.profiles enriches ANC profiles without contact fields", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-oanc-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-oanc-state-" });
  const releaseRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-oanc-release-" });

  const oancPages = new Map<string, string>([
    [
      "https://oanc.dc.gov/landing-page/ancs-ward",
      `<html><body><a href="/anc-profile/anc-4e">ANC 4E</a></body></html>`,
    ],
    [
      "https://oanc.dc.gov/anc-profile/anc-4e",
      `
      <html>
        <body>
          <h1>ANC 4E</h1>
          <p>Email: 4e@example.com</p>
          <p>Phone: (202) 727-9945</p>
          <p>Advisory Neighborhood Commission 4E represents the Crestwood and 16th Street Heights neighborhoods.</p>
          <p>Meeting Location: Virtual</p>
          <a href="/financials">Financials</a>
        </body>
      </html>
      `,
    ],
  ]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const key = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const html = oancPages.get(key);
    if (!html) {
      return new Response("missing fixture", { status: 404 });
    }
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof globalThis.fetch;

  try {
    const collectCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "oanc.profiles",
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

    const ancEntry = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.anc:4E.json")),
    ) as {
      attributes: Record<string, unknown>;
    };
    assertEquals(
      ancEntry.attributes.sourceOancProfileUrl,
      "https://oanc.dc.gov/anc-profile/anc-4e",
    );
    assertEquals(
      ancEntry.attributes.representedNeighborhoods,
      "the Crestwood and 16th Street Heights neighborhoods",
    );

    const indexCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "index",
    ]);
    assertEquals(indexCode, 0);

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

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "entries.csv"));
    assertEquals(entriesCsv.includes("Crestwood and 16th Street Heights"), true);
    assertEquals(entriesCsv.includes("4e@example.com"), false);
    assertEquals(entriesCsv.includes("(202) 727-9945"), false);
    assertEquals(entriesCsv.includes("Meeting Location"), false);
    assertEquals(entriesCsv.includes("Financials"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
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
