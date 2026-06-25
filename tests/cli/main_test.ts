import { Database } from "@db/sqlite";
import { join } from "@std/path";
import { assertEquals } from "@std/assert";

import { runCli } from "../../src/cli/main.ts";
import { closeWorkspace, initWorkspace, openWorkspace } from "../../src/workspace/workspace.ts";

Deno.test("root, init, status, and sources list guide a fresh operator", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-onboarding-" });
  const projectRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-onboarding-project-" });
  const stateRoot = join(projectRoot, "state");
  const releaseRoot = join(projectRoot, "release");

  try {
    const initResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "--release-root",
        releaseRoot,
        "init",
      ])
    );
    assertEquals(initResult.code, 0);
    assertEquals(initResult.output.includes("Civic Ledger workspace ready"), true);
    assertEquals(initResult.output.includes("deno task civic sources list"), true);

    const rootStatus = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "--release-root",
        releaseRoot,
      ])
    );
    assertEquals(rootStatus.code, 0);
    assertEquals(rootStatus.output.includes("Civic Ledger Status"), true);
    assertEquals(rootStatus.output.includes("Sources:   0/"), true);
    assertEquals(
      rootStatus.output.includes("Coverage:  "),
      true,
    );
    assertEquals(rootStatus.output.includes("rows; collected 0, collected_empty 0"), true);
    assertEquals(rootStatus.output.includes("Review:    0 persisted items"), true);
    assertEquals(rootStatus.output.includes("Next: deno task civic collect all"), true);
    assertEquals(rootStatus.output.includes("Operator flow:"), true);
    assertEquals(rootStatus.output.includes("deno task civic revision validate"), true);
    assertEquals(
      rootStatus.output.includes(`deno task civic release verify ${releaseRoot}`),
      true,
    );

    const statusJsonResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "--release-root",
        releaseRoot,
        "status",
        "--json",
      ])
    );
    assertEquals(statusJsonResult.code, 0);
    const statusJson = JSON.parse(statusJsonResult.output) as {
      workspace: string;
      stateRoot: string;
      releaseRoot: string;
      sourceCount: number;
      collectedSourceCount: number;
      sourceCoverageCount: number;
      sourceCoverageStatusCounts: Record<string, number>;
      sourceCoverageReleaseStatusCounts: Record<string, number>;
      recordCount: number;
      stateEntryCount: number;
      reviewItemCount: number;
      reviewQueueCounts: Record<string, number>;
      nextAction: string;
      operatorFlow: string[];
    };
    assertEquals(statusJson.workspace, workspace);
    assertEquals(statusJson.stateRoot, stateRoot);
    assertEquals(statusJson.releaseRoot, releaseRoot);
    assertEquals(statusJson.sourceCount > 0, true);
    assertEquals(statusJson.collectedSourceCount, 0);
    assertEquals(statusJson.sourceCoverageCount > statusJson.sourceCount, true);
    assertEquals(statusJson.sourceCoverageStatusCounts.collected, 0);
    assertEquals(statusJson.sourceCoverageStatusCounts.collected_empty, 0);
    assertEquals(
      statusJson.sourceCoverageStatusCounts.not_collected,
      statusJson.sourceCoverageCount,
    );
    assertEquals(statusJson.sourceCoverageReleaseStatusCounts.inventory_only > 0, true);
    assertEquals(statusJson.sourceCoverageReleaseStatusCounts.not_collected > 0, true);
    assertEquals(statusJson.recordCount, 0);
    assertEquals(statusJson.stateEntryCount, 0);
    assertEquals(statusJson.reviewItemCount, 0);
    assertEquals(statusJson.reviewQueueCounts.blocking, 0);
    assertEquals(statusJson.reviewQueueCounts.deferred, 0);
    assertEquals(statusJson.nextAction, "deno task civic collect all");
    assertEquals(statusJson.operatorFlow.includes("deno task civic state generate"), true);
    assertEquals(
      statusJson.operatorFlow.includes(`deno task civic release verify ${releaseRoot}`),
      true,
    );

    const sourcesResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "sources",
        "list",
        "--json",
      ])
    );
    assertEquals(sourcesResult.code, 0);
    const sourcesJson = JSON.parse(sourcesResult.output) as {
      sourceCount: number;
      sources: Array<{ id: string; family: string; type: string }>;
      sourceCoverageCount: number;
      sourceCoverageFamilyCount: number;
      sourceCoverageFamilyRollup: Array<{
        family: string;
        rows: number;
        collectionStatuses: Record<string, number>;
        releaseStatuses: Record<string, number>;
      }>;
      sourceCoverage: Array<{
        source: string;
        sourceType: string;
        family: string;
        publisher?: string;
        accessMethod?: string;
        sourceUrl?: string;
        catalogConfidence?: string;
        collectionStatus: string;
        readerStatus: string;
        interpreterStatus: string;
        releaseStatus: string;
        snapshotCount: number;
        recordCount: number;
        citationCount: number;
      }>;
      sourceCoverageStatusCounts: Record<string, number>;
      sourceCoverageReleaseStatusCounts: Record<string, number>;
    };
    assertEquals(sourcesJson.sourceCount > 0, true);
    assertEquals(
      sourcesJson.sources.some((source) => source.id === "dcgis.agencies"),
      true,
    );
    assertEquals(sourcesJson.sourceCoverageCount > sourcesJson.sourceCount, true);
    assertEquals(sourcesJson.sourceCoverageStatusCounts.collected, 0);
    assertEquals(sourcesJson.sourceCoverageStatusCounts.collected_empty, 0);
    assertEquals(
      sourcesJson.sourceCoverageStatusCounts.not_collected,
      sourcesJson.sourceCoverageCount,
    );
    assertEquals(sourcesJson.sourceCoverageReleaseStatusCounts.inventory_only > 0, true);
    assertEquals(sourcesJson.sourceCoverageReleaseStatusCounts.not_collected > 0, true);
    assertEquals(
      sourcesJson.sourceCoverageFamilyCount,
      sourcesJson.sourceCoverageFamilyRollup.length,
    );
    const legalFamilyRollup = sourcesJson.sourceCoverageFamilyRollup.find((rollup) =>
      rollup.family === "legal_provenance"
    );
    assertEquals(
      Object.values(legalFamilyRollup?.collectionStatuses ?? {}).reduce(
        (total, count) => total + count,
        0,
      ),
      legalFamilyRollup?.rows,
    );
    assertEquals((legalFamilyRollup?.collectionStatuses.not_collected ?? 0) > 0, true);
    assertEquals((legalFamilyRollup?.releaseStatuses.inventory_only ?? 0) > 0, true);
    const openDataCoverage = sourcesJson.sourceCoverage.find((coverage) =>
      coverage.source === "inventory.open_data_catalog"
    );
    assertEquals(openDataCoverage?.sourceType, "inventory.backlog");
    assertEquals(
      openDataCoverage?.publisher,
      "Office of the Chief Technology Officer / District of Columbia",
    );
    assertEquals(openDataCoverage?.accessMethod, "ArcGIS Hub catalog");
    assertEquals(openDataCoverage?.sourceUrl, "https://opendata.dc.gov/");
    assertEquals(openDataCoverage?.catalogConfidence, "high");
    assertEquals(openDataCoverage?.collectionStatus, "not_collected");
    assertEquals(openDataCoverage?.readerStatus, "inventory_only");
    assertEquals(openDataCoverage?.interpreterStatus, "not_wired");
    assertEquals(openDataCoverage?.releaseStatus, "inventory_only");
    assertEquals(openDataCoverage?.snapshotCount, 0);
    assertEquals(openDataCoverage?.recordCount, 0);
    assertEquals(openDataCoverage?.citationCount, 0);

    const humanSourcesResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "sources",
        "list",
      ])
    );
    assertEquals(humanSourcesResult.code, 0);
    assertEquals(humanSourcesResult.output.includes("SCOPE"), true);
    assertEquals(humanSourcesResult.output.includes("STATUS"), true);
    assertEquals(humanSourcesResult.output.includes("not_collected"), true);
    assertEquals(humanSourcesResult.output.includes("Coverage rows:"), true);
    assertEquals(humanSourcesResult.output.includes("release:"), true);
    assertEquals(humanSourcesResult.output.includes("Family coverage:"), true);
    assertEquals(humanSourcesResult.output.includes("source_inventory"), true);
    assertEquals(humanSourcesResult.output.includes("legal_provenance"), true);
    assertEquals(humanSourcesResult.output.includes("Inventory-only backlog rows:"), true);
    assertEquals(humanSourcesResult.output.includes("inventory.open_data_catalog"), true);
    assertEquals(humanSourcesResult.output.includes("inventory.budget_finance"), true);
    assertEquals(humanSourcesResult.output.includes("inventory_only"), true);
    assertEquals(humanSourcesResult.output.includes("publisher/access/sourceUrl/confidence"), true);
    assertEquals(humanSourcesResult.output.includes("_local/source_coverage.csv"), true);
  } finally {
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("status color can be forced for human output without coloring JSON", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-color-" });
  const projectRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-color-project-" });
  const stateRoot = join(projectRoot, "state");

  const previousColor = Deno.env.get("CIVIC_LEDGER_COLOR");
  const previousNoColor = Deno.env.get("NO_COLOR");

  try {
    Deno.env.set("CIVIC_LEDGER_COLOR", "always");
    Deno.env.delete("NO_COLOR");

    const colorResult = await captureConsole(
      () =>
        runCli([
          "--workspace",
          workspace,
          "--state-root",
          stateRoot,
          "status",
        ]),
      { stripAnsi: false },
    );
    assertEquals(colorResult.code, 0);
    assertEquals(colorResult.output.includes("\x1b["), true);
    assertEquals(colorResult.output.includes("\x1b[33mnot_collected\x1b[39m"), true);
    assertEquals(colorResult.output.includes("\x1b[31mnot_collected\x1b[39m"), false);

    const jsonResult = await captureConsole(
      () =>
        runCli([
          "--workspace",
          workspace,
          "--state-root",
          stateRoot,
          "status",
          "--json",
        ]),
      { stripAnsi: false },
    );
    assertEquals(jsonResult.code, 0);
    assertEquals(jsonResult.output.includes("\x1b["), false);
    JSON.parse(jsonResult.output);

    const sourcesColorResult = await captureConsole(
      () =>
        runCli([
          "--workspace",
          workspace,
          "--state-root",
          stateRoot,
          "sources",
          "list",
        ]),
      { stripAnsi: false },
    );
    assertEquals(sourcesColorResult.code, 0);
    assertEquals(sourcesColorResult.output.includes("\x1b["), true);

    const sourcesJsonResult = await captureConsole(
      () =>
        runCli([
          "--workspace",
          workspace,
          "--state-root",
          stateRoot,
          "sources",
          "list",
          "--json",
        ]),
      { stripAnsi: false },
    );
    assertEquals(sourcesJsonResult.code, 0);
    assertEquals(sourcesJsonResult.output.includes("\x1b["), false);
    JSON.parse(sourcesJsonResult.output);

    Deno.env.set("CIVIC_LEDGER_COLOR", "never");
    const plainResult = await captureConsole(
      () =>
        runCli([
          "--workspace",
          workspace,
          "--state-root",
          stateRoot,
          "status",
        ]),
      { stripAnsi: false },
    );
    assertEquals(plainResult.code, 0);
    assertEquals(plainResult.output.includes("\x1b["), false);
  } finally {
    if (previousColor === undefined) {
      Deno.env.delete("CIVIC_LEDGER_COLOR");
    } else {
      Deno.env.set("CIVIC_LEDGER_COLOR", previousColor);
    }
    if (previousNoColor === undefined) {
      Deno.env.delete("NO_COLOR");
    } else {
      Deno.env.set("NO_COLOR", previousNoColor);
    }
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("state generation explains empty fresh workspace", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-empty-workspace-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-empty-state-" });

  try {
    const code = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(code, 1);
  } finally {
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
  }
});

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
    assertEquals(
      committeeEntryFiles.includes("dc.elected_office:at-large-councilmember.json"),
      true,
    );
    assertEquals(committeeEntryFiles.includes("dc.elected_office:council-chairman.json"), true);
    assertEquals(committeeEntryFiles.includes("dc.ward:8.json"), true);

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
    assertEquals(
      chairEntry.relations["dc.relation:holds"][0]?.to,
      "dc.elected_office:council-chairman",
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
    assertEquals(
      ward8Entry.relations["dc.relation:holds"][0]?.to,
      "dc.elected_office:ward-8-councilmember",
    );
    assertEquals(ward8Entry.relations["dc.relation:represents"][0]?.to, "dc.ward:8");

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
    assertEquals(countRows(db, "state_entries"), 16);
    assertEquals(countRows(db, "state_relations"), 23);
    closeWorkspace(db);

    const checkCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "check",
    ]);
    assertEquals(checkCode, 0);

    const exportResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "--release-root",
        releaseRoot,
        "export",
      ])
    );
    assertEquals(exportResult.code, 0);
    assertEquals(exportResult.output.includes("GovGraph projection: 16 nodes"), true);
    assertEquals(exportResult.output.includes("blocking review items 0"), true);
    assertEquals(exportResult.output.includes("Release artifact highlights:"), true);
    assertEquals(exportResult.output.includes("manifest.json / SHA256SUMS / README.md"), true);
    assertEquals(
      exportResult.output.includes("govgraph_nodes.json / govgraph_edges.json"),
      true,
    );

    const manifest = JSON.parse(await Deno.readTextFile(join(releaseRoot, "manifest.json")));
    assertEquals(manifest.counts.entries, 16);
    assertEquals(manifest.counts.relations, 23);
    assertEquals(manifest.counts.relationKinds["dc.relation:chairs"], 2);
    assertEquals(manifest.counts.relationKinds["dc.relation:member_of"], 9);
    assertEquals(manifest.counts.relationKinds["dc.relation:holds"], 6);
    assertEquals(manifest.counts.relationKinds["dc.relation:represents"], 6);

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_entries.csv"));
    assertEquals(entriesCsv.includes("dc.committee:committee-of-the-whole"), true);
    assertEquals(entriesCsv.includes("dc.councilmember:phil-mendelson"), true);
    assertEquals(entriesCsv.includes("dc.elected_office:council-chairman"), true);
    assertEquals(entriesCsv.includes("dc.ward:8"), true);
    assertEquals(entriesCsv.includes("Committee of the Whole"), true);
    assertEquals(entriesCsv.includes("Trayon White"), true);

    const relationsCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_relations.csv"));
    assertEquals(relationsCsv.includes("dc.relation:chairs"), true);
    assertEquals(relationsCsv.includes("dc.relation:holds"), true);
    assertEquals(relationsCsv.includes("dc.relation:member_of"), true);
    assertEquals(relationsCsv.includes("dc.relation:represents"), true);
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
  const releaseRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-release-" });
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
    assertEquals(stateEntries.includes("dc.agency:agency-one.json"), true);
    assertEquals(stateEntries.includes("dc.agency:agency-two.json"), true);

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
    assertEquals(countRows(db, "fragments"), 2);
    assertEquals(countRows(db, "baselines"), 1);
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

    const statusResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "--release-root",
        releaseRoot,
        "status",
      ])
    );
    assertEquals(statusResult.code, 0);
    assertEquals(
      statusResult.output.includes(
        `Next: deno task civic check, then deno task civic export, then deno task civic release verify ${releaseRoot}`,
      ),
      true,
    );

    const statusJsonResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "--release-root",
        releaseRoot,
        "status",
        "--json",
      ])
    );
    assertEquals(statusJsonResult.code, 0);
    const statusJson = JSON.parse(statusJsonResult.output) as {
      nextAction: string;
      operatorFlow: string[];
    };
    assertEquals(
      statusJson.nextAction,
      `deno task civic check, then deno task civic export, then deno task civic release verify ${releaseRoot}`,
    );
    assertEquals(
      statusJson.operatorFlow.includes(`deno task civic release verify ${releaseRoot}`),
      true,
    );
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

Deno.test("reconcile candidates reports review packets from committed state", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-reconcile-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-reconcile-state-" });
  const responses = [
    {
      features: [
        {
          attributes: {
            OBJECTID: 1,
            AGENCY_ID: "a-1",
            AGENCY_NAME: "Shared Agency",
            SHORT_NAME: "SA",
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
            OBJECTID: 2,
            BOARD_ID: "b-1",
            BOARD_NAME: "Shared Agency",
            SHORT_NAME: "SB",
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
      "1",
    ]);
    assertEquals(collectCode, 0);

    const collectBoardCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.boards",
      "--limit",
      "1",
    ]);
    assertEquals(collectBoardCode, 0);

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
      targetId: "dc.agency:agency-one",
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
      await Deno.readTextFile(join(stateRoot, "entries", "dc.agency:agency-one.json")),
    ) as { name: string };
    assertEquals(stateEntry.name, "Agency One (canonical)");
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("state generation applies suppress revisions from ledger revisions", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-suppress-revision-" });
  const projectRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-cli-state-suppress-revision-project-",
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
          AGENCY_NAME: "Agency One Shadow",
          SHORT_NAME: "A1",
        },
      },
      {
        attributes: {
          OBJECTID: 2,
          AGENCY_ID: "shadow",
          AGENCY_NAME: "Agency One",
          SHORT_NAME: "Shadow",
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
    join(revisionRoot, "suppress-shadow.json"),
    JSON.stringify({
      id: "suppress-shadow",
      source: "operator",
      targetKind: "entry",
      targetId: "dc.agency:agency-one-shadow",
      rationale: "Reviewed duplicate source shadow.",
      evidence: [{ source: "dcgis.agencies", sourceRecordId: "2" }],
      patch: { suppress: true },
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

    const stateEntryFiles = await listEntryFiles(join(stateRoot, "entries"));
    assertEquals(stateEntryFiles.includes("dc.agency:agency-one.json"), true);
    assertEquals(stateEntryFiles.includes("dc.agency:agency-one-shadow.json"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("state generation persists review revisions from ledger revisions", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-state-review-revision-" });
  const projectRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-cli-state-review-revision-project-",
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
          AGENCY_NAME: "Agency Two",
          SHORT_NAME: "A1",
        },
      },
      {
        attributes: {
          OBJECTID: 2,
          AGENCY_ID: "a-2",
          AGENCY_NAME: "Agency One",
          SHORT_NAME: "A2",
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
    join(revisionRoot, "preserve-distinct.json"),
    JSON.stringify({
      id: "preserve-distinct",
      source: "operator",
      targetKind: "entry",
      targetId: "dc.agency:agency-one",
      rationale: "Reviewed duplicate-looking names and preserved them as distinct.",
      evidence: [{ source: "dcgis.agencies", sourceRecordId: "1" }],
      patch: {
        review: {
          decision: "preserve_distinct",
          relatedEntryIds: ["dc.agency:agency-two"],
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

    const agencyOne = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.agency:agency-one.json")),
    ) as { attributes: { revisionReviews?: unknown[] } };
    const agencyTwoExists = await exists(join(stateRoot, "entries", "dc.agency:agency-two.json"));
    assertEquals(agencyTwoExists, true);
    assertEquals(agencyOne.attributes.revisionReviews, [{
      decision: "preserve_distinct",
      evidence: [{ source: "dcgis.agencies", sourceRecordId: "1" }],
      rationale: "Reviewed duplicate-looking names and preserved them as distinct.",
      relatedEntryIds: ["dc.agency:agency-two"],
      revisionId: "preserve-distinct",
      source: "operator",
    }]);
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
      targetId: "dc.agency:agency-two",
      patch: {
        relations: {
          "dc.relation:governs": [{
            kind: "dc.relation:governs",
            to: "dc.agency:agency-one",
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
      await Deno.readTextFile(join(stateRoot, "entries", "dc.agency:agency-two.json")),
    ) as { relations: Record<string, Array<{ to: string }>> };
    assertEquals(agencyTwo.relations["dc.relation:governs"][0]?.to, "dc.agency:agency-one");
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
    assertEquals(stateEntries.includes("dc.agency:agency-one.json"), true);
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
    assertEquals(stateEntries.includes("dc.agency:agency-one.json"), true);
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

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_entries.csv"));
    assertEquals(entriesCsv.includes("dc.anc:3~2F4G"), true);
    assertEquals(entriesCsv.includes("dc.smd:3~2F4G01"), true);
    assertEquals(entriesCsv.includes("dc.anc_commissioner_seat:3~2F4G01"), true);
    assertEquals(entriesCsv.includes("Jane Doe"), true);
    assertEquals(entriesCsv.includes("John Smith"), true);
    assertEquals(entriesCsv.includes("jane@example.com"), false);
    assertEquals(entriesCsv.includes("john@example.com"), false);
    assertEquals(entriesCsv.includes("dc.person:anc_commissioner_3~2F4G01"), false);

    const relationsCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_relations.csv"));
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

    const citationsCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_citations.csv"));
    assertEquals(citationsCsv.includes("3/4G01"), true);
    assertEquals(citationsCsv.includes("3/4G"), true);
    assertEquals(citationsCsv.includes("Jane Doe"), false);
    assertEquals(citationsCsv.includes("John Smith"), false);
    assertEquals(citationsCsv.includes("jane@example.com"), false);
    assertEquals(citationsCsv.includes("john@example.com"), false);

    const sourcesCsv = await Deno.readTextFile(join(releaseRoot, "_local/source_counts.csv"));
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
    assertEquals(stateEntries.includes("dc.agency:agency-one.json"), true);
    assertEquals(stateEntries.includes("dc.authority:au-1.json"), true);

    const authorityEntry = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.authority:au-1.json")),
    ) as { family: string; relations: Record<string, Array<{ to: string }>> };
    assertEquals(authorityEntry.family, "authority");
    assertEquals(authorityEntry.relations["dc.relation:governs"][0]?.to, "dc.agency:agency-one");
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
        "dc.agency:district-of-columbia",
      );
      assertEquals(
        commissionEntry.relations["dc.relation:governs"][0]?.to,
        "dc.agency:district-of-columbia",
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
  const downloadedAssetsRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-cli-downloaded-assets-",
  });

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

    const exportResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "--release-root",
        releaseRoot,
        "export",
      ])
    );
    assertEquals(exportResult.code, 0);
    assertEquals(
      exportResult.output.includes(`Verify release: deno task civic release verify ${releaseRoot}`),
      true,
    );

    const expectedFiles = [
      "_local/ledger_entries.csv",
      "_local/ledger_relations.csv",
      "_local/ledger_citations.csv",
      "_local/source_counts.csv",
      "_local/dc_board_affiliations.csv",
      "_local/dc_commission_affiliations.csv",
      "_local/dc_authority_affiliations.csv",
      "govgraph_nodes.json",
      "govgraph_edges.json",
      "govgraph_summary.json",
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
    assertEquals(manifest.counts.govGraphNodes, 5);
    assertEquals(manifest.counts.govGraphEdges, 3);

    const affiliations = await Deno.readTextFile(
      join(releaseRoot, "_local/dc_board_affiliations.csv"),
    );
    assertEquals(affiliations.includes("dc.board:b-1"), true);
    assertEquals(affiliations.includes("dc.agency:agency-one"), true);
    const commissionAffiliations = await Deno.readTextFile(
      join(releaseRoot, "_local/dc_commission_affiliations.csv"),
    );
    assertEquals(commissionAffiliations.includes("dc.commission:c-1"), true);
    assertEquals(commissionAffiliations.includes("dc.agency:agency-one"), true);

    const authorityAffiliations = await Deno.readTextFile(
      join(releaseRoot, "_local/dc_authority_affiliations.csv"),
    );
    assertEquals(authorityAffiliations.includes("dc.authority:au-1"), true);
    assertEquals(authorityAffiliations.includes("dc.agency:agency-one"), true);

    const govGraphEdges = JSON.parse(
      await Deno.readTextFile(join(releaseRoot, "govgraph_edges.json")),
    ) as Array<Record<string, unknown>>;
    assertEquals(govGraphEdges.length, 3);
    assertEquals(
      govGraphEdges.every((edge) => edge.verb === "administered_by"),
      true,
    );

    const ledgerDb = new Database(join(releaseRoot, "ledger.sqlite"));
    try {
      const entryCount = ledgerDb.prepare("SELECT COUNT(*) as count FROM ledger_entries").get() as {
        count: number;
      };
      assertEquals(entryCount.count, 5);
    } finally {
      ledgerDb.close();
    }

    const verifyResult = await captureConsole(() =>
      runCli([
        "--release-root",
        releaseRoot,
        "release",
        "verify",
      ])
    );
    assertEquals(verifyResult.code, 0);
    assertEquals(verifyResult.output.includes("release verified:"), true);
    assertEquals(verifyResult.output.includes("manifest.json"), true);
    assertEquals(
      verifyResult.output.includes(
        "schema version, release identity, artifact counts, kind rollups, zero blocking/actionable/drafted review items, review posture/categories/deferred descriptions, source coverage metadata/statuses, and GovGraph summary agreements passed",
      ),
      true,
    );

    const verifyJsonResult = await captureConsole(
      () =>
        runCli([
          "--release-root",
          releaseRoot,
          "release",
          "verify",
          "--json",
        ]),
      { stripAnsi: false },
    );
    assertEquals(verifyJsonResult.code, 0);
    assertEquals(verifyJsonResult.output.includes("\x1b["), false);
    const verifyJson = JSON.parse(verifyJsonResult.output) as {
      releaseRoot: string;
      manifestPath: string;
      valid: boolean;
      checkedFileCount: number;
      errors: string[];
    };
    assertEquals(verifyJson.releaseRoot, releaseRoot);
    assertEquals(verifyJson.manifestPath, join(releaseRoot, "manifest.json"));
    assertEquals(verifyJson.valid, true);
    assertEquals(verifyJson.checkedFileCount > 0, true);
    assertEquals(verifyJson.errors, []);

    const manifestPath = join(releaseRoot, "manifest.json");
    const manifestForPublish = JSON.parse(await Deno.readTextFile(manifestPath)) as Record<
      string,
      unknown
    >;
    const originalProvenance = manifestForPublish.provenance;
    manifestForPublish.provenance = {
      ...(originalProvenance as Record<string, unknown>),
      workingTreeStatus: "dirty",
      workingTreeChangedPathCount: 1,
    };
    await Deno.writeTextFile(manifestPath, JSON.stringify(manifestForPublish, null, 2) + "\n");
    const publishVerifyResult = await captureConsole(() =>
      runCli([
        "--release-root",
        releaseRoot,
        "release",
        "verify",
        "--publish",
      ])
    );
    assertEquals(publishVerifyResult.code, 1);
    assertEquals(
      publishVerifyResult.output.includes(
        "manifest.provenance.workingTreeStatus must be clean for publish",
      ),
      true,
    );
    const publishVerifyJsonResult = await captureConsole(() =>
      runCli([
        "--release-root",
        releaseRoot,
        "release",
        "verify",
        "--publish",
        "--json",
      ])
    );
    assertEquals(publishVerifyJsonResult.code, 1);
    const publishVerifyJson = JSON.parse(publishVerifyJsonResult.output) as {
      valid: boolean;
      publishReady: boolean;
      publishErrors: string[];
    };
    assertEquals(publishVerifyJson.valid, false);
    assertEquals(publishVerifyJson.publishReady, false);
    assertEquals(
      publishVerifyJson.publishErrors.some((error) =>
        error.includes("workingTreeStatus must be clean for publish")
      ),
      true,
    );
    manifestForPublish.provenance = originalProvenance;
    await Deno.writeTextFile(manifestPath, JSON.stringify(manifestForPublish, null, 2) + "\n");
    const restoredPublishVerification = await captureConsole(() =>
      runCli([
        "--release-root",
        releaseRoot,
        "release",
        "verify",
      ])
    );
    assertEquals(restoredPublishVerification.code, 0);

    const assetsResult = await captureConsole(() =>
      runCli([
        "--release-root",
        releaseRoot,
        "release",
        "assets",
      ])
    );
    assertEquals(assetsResult.code, 0);
    assertEquals(assetsResult.output.includes("release assets:"), true);
    assertEquals(assetsResult.output.includes("public_csv"), true);
    assertEquals(assetsResult.output.includes("dc_agencies.csv"), true);
    assertEquals(
      assetsResult.output.indexOf("public_csv") < assetsResult.output.indexOf("database"),
      true,
    );
    assertEquals(assetsResult.output.includes("manifest.json"), true);

    const assetsJsonResult = await captureConsole(
      () =>
        runCli([
          "--release-root",
          releaseRoot,
          "release",
          "assets",
          "--json",
        ]),
      { stripAnsi: false },
    );
    assertEquals(assetsJsonResult.code, 0);
    assertEquals(assetsJsonResult.output.includes("\x1b["), false);
    const assetsJson = JSON.parse(assetsJsonResult.output) as {
      releaseRoot: string;
      manifestPath: string;
      valid: boolean;
      assetCount: number;
      categoryCounts: Record<string, number>;
      assets: Array<{
        path: string;
        category: string;
        byteSize: number;
        sha256: string;
        rowCount?: number;
        columnCount?: number;
        columns?: string[];
      }>;
    };
    assertEquals(assetsJson.releaseRoot, releaseRoot);
    assertEquals(assetsJson.manifestPath, join(releaseRoot, "manifest.json"));
    assertEquals(assetsJson.valid, true);
    const manifestReleaseAssetCount = (manifest.outputCatalog as Array<{ releaseAsset: boolean }>)
      .filter((item) => item.releaseAsset).length;
    assertEquals(assetsJson.assetCount, manifestReleaseAssetCount + 1);
    assertEquals(assetsJson.categoryCounts.public_csv > 0, true);
    assertEquals(assetsJson.categoryCounts.machine_json, 4);
    assertEquals(assetsJson.categoryCounts.documentation, 2);
    assertEquals(assetsJson.categoryCounts.traceability_csv ?? 0, 0);
    assertEquals(
      assetsJson.assets.some((asset) => asset.path === "_local/ledger_entries.csv"),
      false,
    );
    assertEquals(
      assetsJson.assets.some((asset) => asset.path === "_local/source_coverage.csv"),
      false,
    );
    assertEquals(
      assetsJson.assets.some((asset) => asset.path === "_local/dc_board_affiliations.csv"),
      false,
    );
    assertEquals(
      assetsJson.assets.some((asset) => asset.path === "_local/dc_smd_commissioners.csv"),
      false,
    );
    const councilmemberAsset = assetsJson.assets.find((asset) =>
      asset.path === "dc_councilmembers.csv"
    );
    assertEquals(typeof councilmemberAsset?.rowCount, "number");
    assertEquals(councilmemberAsset?.columnCount, 10);
    assertEquals(councilmemberAsset?.columns?.includes("source_url"), true);
    assertEquals(
      assetsJson.assets.some((asset) =>
        asset.path === "dc_agencies.csv" &&
        asset.category === "public_csv" &&
        asset.byteSize > 0 &&
        /^[0-9a-f]{64}$/.test(asset.sha256)
      ),
      true,
    );
    assertEquals(
      assetsJson.assets.some((asset) =>
        asset.path === "manifest.json" &&
        asset.category === "machine_json" &&
        asset.byteSize > 0 &&
        /^[0-9a-f]{64}$/.test(asset.sha256)
      ),
      true,
    );
    assertEquals(
      assetsJson.assets.some((asset) =>
        asset.path === "SHA256SUMS" &&
        asset.category === "documentation" &&
        asset.byteSize > 0 &&
        /^[0-9a-f]{64}$/.test(asset.sha256)
      ),
      true,
    );

    for (const asset of assetsJson.assets) {
      await Deno.copyFile(join(releaseRoot, asset.path), join(downloadedAssetsRoot, asset.path));
    }

    const verifyDownloadedResult = await captureConsole(() =>
      runCli([
        "release",
        "verify-downloaded",
        releaseRoot,
        downloadedAssetsRoot,
      ])
    );
    assertEquals(verifyDownloadedResult.code, 0);
    assertEquals(
      verifyDownloadedResult.output.includes("downloaded release assets verified:"),
      true,
    );

    const verifyDownloadedJsonResult = await captureConsole(() =>
      runCli([
        "release",
        "verify-downloaded",
        releaseRoot,
        downloadedAssetsRoot,
        "--json",
      ])
    );
    assertEquals(verifyDownloadedJsonResult.code, 0);
    const verifyDownloadedJson = JSON.parse(verifyDownloadedJsonResult.output) as {
      valid: boolean;
      expectedAssetCount: number;
      downloadedFileCount: number;
      checkedAssetCount: number;
      errors: string[];
    };
    assertEquals(verifyDownloadedJson.valid, true);
    assertEquals(verifyDownloadedJson.expectedAssetCount, assetsJson.assets.length);
    assertEquals(verifyDownloadedJson.downloadedFileCount, assetsJson.assets.length);
    assertEquals(verifyDownloadedJson.checkedAssetCount, assetsJson.assets.length);
    assertEquals(verifyDownloadedJson.errors, []);

    manifestForPublish.provenance = {
      ...(originalProvenance as Record<string, unknown>),
      workingTreeStatus: "dirty",
      workingTreeChangedPathCount: 1,
    };
    await Deno.writeTextFile(manifestPath, JSON.stringify(manifestForPublish, null, 2) + "\n");

    const uploadPlanBlockedResult = await captureConsole(() =>
      runCli([
        "--release-root",
        releaseRoot,
        "release",
        "upload-plan",
        "dc-civic-ledger-test",
      ])
    );
    assertEquals(uploadPlanBlockedResult.code, 1);
    assertEquals(
      uploadPlanBlockedResult.output.includes("is not publish-ready"),
      true,
    );
    assertEquals(
      uploadPlanBlockedResult.output.includes("Use --allow-local-candidate only for dry-run"),
      true,
    );

    const uploadPlanBlockedJsonResult = await captureConsole(() =>
      runCli([
        "--release-root",
        releaseRoot,
        "release",
        "upload-plan",
        "dc-civic-ledger-test",
        "--json",
      ])
    );
    assertEquals(uploadPlanBlockedJsonResult.code, 1);
    const uploadPlanBlockedJson = JSON.parse(uploadPlanBlockedJsonResult.output) as {
      valid: boolean;
      publishReady: boolean;
      publishErrors: string[];
    };
    assertEquals(uploadPlanBlockedJson.valid, false);
    assertEquals(uploadPlanBlockedJson.publishReady, false);
    assertEquals(uploadPlanBlockedJson.publishErrors.length > 0, true);

    const uploadPlanResult = await captureConsole(() =>
      runCli([
        "--release-root",
        releaseRoot,
        "release",
        "upload-plan",
        "dc-civic-ledger-test",
        "--allow-local-candidate",
      ])
    );
    assertEquals(uploadPlanResult.code, 0);
    assertEquals(uploadPlanResult.output.includes("Local-candidate upload plan"), true);
    assertEquals(uploadPlanResult.output.includes("gh"), true);
    assertEquals(uploadPlanResult.output.includes("release"), true);
    assertEquals(uploadPlanResult.output.includes("delete-asset"), true);
    assertEquals(uploadPlanResult.output.includes("dc-civic-ledger-test.tar.gz"), true);
    assertEquals(uploadPlanResult.output.includes("upload"), true);
    assertEquals(uploadPlanResult.output.includes("dc_agencies.csv"), true);
    assertEquals(uploadPlanResult.output.includes("SHA256SUMS"), true);
    assertEquals(uploadPlanResult.output.includes("verify-downloaded"), true);

    const uploadPlanJsonResult = await captureConsole(() =>
      runCli([
        "--release-root",
        releaseRoot,
        "release",
        "upload-plan",
        "dc-civic-ledger-test",
        "--json",
        "--allow-local-candidate",
      ])
    );
    assertEquals(uploadPlanJsonResult.code, 0);
    const uploadPlanJson = JSON.parse(uploadPlanJsonResult.output) as {
      valid: boolean;
      publishReady: boolean;
      allowLocalCandidate: boolean;
      assetCount: number;
      obsoleteAssetCommands: string[][];
      uploadCommand: string[];
      downloadCommand: string[];
      verifyDownloadedCommand: string[];
    };
    assertEquals(uploadPlanJson.valid, true);
    assertEquals(uploadPlanJson.publishReady, false);
    assertEquals(uploadPlanJson.allowLocalCandidate, true);
    assertEquals(uploadPlanJson.assetCount, assetsJson.assets.length);
    assertEquals(uploadPlanJson.obsoleteAssetCommands[0]?.includes("delete-asset"), true);
    assertEquals(
      uploadPlanJson.obsoleteAssetCommands[0]?.includes("dc-civic-ledger-test.tar.gz"),
      true,
    );
    assertEquals(uploadPlanJson.uploadCommand.includes("gh"), true);
    assertEquals(uploadPlanJson.uploadCommand.includes("--clobber"), true);
    assertEquals(uploadPlanJson.downloadCommand.includes("download"), true);
    assertEquals(uploadPlanJson.verifyDownloadedCommand.includes("verify-downloaded"), true);

    const previousColor = Deno.env.get("CIVIC_LEDGER_COLOR");
    const previousNoColor = Deno.env.get("NO_COLOR");
    try {
      Deno.env.set("CIVIC_LEDGER_COLOR", "always");
      Deno.env.delete("NO_COLOR");
      const colorVerifyResult = await captureConsole(
        () =>
          runCli([
            "--release-root",
            releaseRoot,
            "release",
            "verify",
          ]),
        { stripAnsi: false },
      );
      assertEquals(colorVerifyResult.code, 0);
      assertEquals(colorVerifyResult.output.includes("\x1b["), true);
    } finally {
      if (previousColor === undefined) {
        Deno.env.delete("CIVIC_LEDGER_COLOR");
      } else {
        Deno.env.set("CIVIC_LEDGER_COLOR", previousColor);
      }
      if (previousNoColor === undefined) {
        Deno.env.delete("NO_COLOR");
      } else {
        Deno.env.set("NO_COLOR", previousNoColor);
      }
    }

    const positionalVerifyResult = await captureConsole(() =>
      runCli([
        "release",
        "verify",
        releaseRoot,
      ])
    );
    assertEquals(positionalVerifyResult.code, 0);

    await Deno.writeTextFile(join(releaseRoot, "_local/source_counts.csv"), "tampered\n");
    const failedVerifyResult = await captureConsole(() =>
      runCli([
        "--release-root",
        releaseRoot,
        "release",
        "verify",
      ])
    );
    assertEquals(failedVerifyResult.code, 1);
    assertEquals(failedVerifyResult.output.includes("release verification failed"), true);
    assertEquals(failedVerifyResult.output.includes("sha256 mismatch for sourcesCsv"), true);

    const failedVerifyJsonResult = await captureConsole(
      () =>
        runCli([
          "--release-root",
          releaseRoot,
          "release",
          "verify",
          "--json",
        ]),
      { stripAnsi: false },
    );
    assertEquals(failedVerifyJsonResult.code, 1);
    assertEquals(failedVerifyJsonResult.output.includes("\x1b["), false);
    const failedVerifyJson = JSON.parse(failedVerifyJsonResult.output) as {
      valid: boolean;
      errors: string[];
    };
    assertEquals(failedVerifyJson.valid, false);
    assertEquals(
      failedVerifyJson.errors.some((error) => error.includes("sha256 mismatch for sourcesCsv")),
      true,
    );
  } finally {
    restoreFetch();
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
    await Deno.remove(downloadedAssetsRoot, { recursive: true });
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
    const result = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "--release-root",
        releaseRoot,
        "export",
      ])
    );

    assertEquals(result.code, 1);
    assertEquals(result.output.includes("deno task civic state generate"), true);
    assertEquals(result.output.includes("deno task civic check"), true);
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

Deno.test("check explains missing committed state", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-check-missing-" });
  const missingStateRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-cli-check-missing-state-",
  });

  try {
    await Deno.remove(missingStateRoot, { recursive: true });
    const result = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        missingStateRoot,
        "check",
      ])
    );

    assertEquals(result.code, 1);
    assertEquals(result.output.includes("committed state has no entries"), true);
    assertEquals(result.output.includes("deno task civic state generate"), true);
  } finally {
    await Deno.remove(workspace, { recursive: true });
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

Deno.test("review list help explains committed-state refresh", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-net",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "src/cli/main.ts",
      "review",
      "list",
      "--help",
    ],
    cwd: new URL("../..", import.meta.url),
  });

  const output = await command.output();
  const stdout = stripAnsi(new TextDecoder().decode(output.stdout));

  assertEquals(output.code, 0);
  assertEquals(stdout.includes("Refresh from committed state"), true);
});

Deno.test("README points at the public release tables", async () => {
  const readme = await Deno.readTextFile(new URL("../../README.md", import.meta.url));
  const normalizedReadme = readme.replaceAll(/\s+/g, " ");

  assertEquals(normalizedReadme.includes("dc_agencies.csv"), true);
  assertEquals(normalizedReadme.includes("dc_councilmembers.csv"), true);
  assertEquals(normalizedReadme.includes("dc_public_bodies.csv"), true);
  assertEquals(normalizedReadme.includes("_local/ledger_entries.csv"), false);
  assertEquals(normalizedReadme.includes("Each GitHub release uploads 21 files"), true);
  assertEquals(normalizedReadme.includes("the generated release `README.md`"), true);
  assertEquals(normalizedReadme.includes("govgraph_nodes.json"), true);
  assertEquals(normalizedReadme.includes("Trace and compatibility tables live in"), false);
});

Deno.test("README documents release verification command", async () => {
  const readme = await Deno.readTextFile(new URL("../../README.md", import.meta.url));
  const normalizedReadme = readme.replaceAll(/\s+/g, " ");

  assertEquals(normalizedReadme.includes("deno task civic release verify releases/latest"), true);
  assertEquals(
    normalizedReadme.includes("deno task civic release assets releases/latest --json"),
    false,
  );
  assertEquals(normalizedReadme.includes("deno task civic release upload-plan <tag>"), false);
  assertEquals(
    normalizedReadme.includes("deno task civic release verify-downloaded releases/latest"),
    false,
  );
  assertEquals(normalizedReadme.includes("deno task civic release verify --publish"), false);
});

Deno.test("README stays short", async () => {
  const readme = await Deno.readTextFile(new URL("../../README.md", import.meta.url));

  assertEquals(readme.split("\n").length < 55, true);
});

Deno.test("release verify help explains manifest contract checks", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-net",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "src/cli/main.ts",
      "release",
      "verify",
      "--help",
    ],
    cwd: new URL("../..", import.meta.url),
  });

  const output = await command.output();
  const stdout = stripAnsi(new TextDecoder().decode(output.stdout));

  assertEquals(output.code, 0);
  assertEquals(
    stdout.includes(
      "release identity, payload metadata, source coverage statuses, review category posture, zero blockers, and manifest contracts",
    ),
    true,
  );
  assertEquals(stdout.includes("Emit release verification result as JSON"), true);
  assertEquals(stdout.includes("Require publish-grade provenance"), true);
});

Deno.test("release assets help explains uploadable manifest assets", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-net",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "src/cli/main.ts",
      "release",
      "assets",
      "--help",
    ],
    cwd: new URL("../..", import.meta.url),
  });

  const output = await command.output();
  const stdout = stripAnsi(new TextDecoder().decode(output.stdout));

  assertEquals(output.code, 0);
  assertEquals(stdout.includes("individually uploadable release assets"), true);
  assertEquals(stdout.includes("verified manifest catalog"), true);
  assertEquals(stdout.includes("Emit release asset metadata as JSON"), true);
});

Deno.test("release upload-plan help explains GitHub upload commands", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-net",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "src/cli/main.ts",
      "release",
      "upload-plan",
      "--help",
    ],
    cwd: new URL("../..", import.meta.url),
  });

  const output = await command.output();
  const stdout = stripAnsi(new TextDecoder().decode(output.stdout));

  assertEquals(output.code, 0);
  assertEquals(stdout.includes("publish-ready release"), true);
  assertEquals(stdout.includes("Emit upload and verification commands as JSON arrays"), true);
  assertEquals(stdout.includes("Bypass publish provenance checks"), true);
});

Deno.test("release verify-downloaded help explains downloaded asset verification", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-net",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "src/cli/main.ts",
      "release",
      "verify-downloaded",
      "--help",
    ],
    cwd: new URL("../..", import.meta.url),
  });

  const output = await command.output();
  const stdout = stripAnsi(new TextDecoder().decode(output.stdout));

  assertEquals(output.code, 0);
  assertEquals(stdout.includes("downloaded GitHub release assets"), true);
  assertEquals(stdout.includes("Emit downloaded asset verification result as JSON"), true);
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

    const statusAfterGenerate = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "status",
      ])
    );
    assertEquals(statusAfterGenerate.code, 0);
    assertEquals(
      statusAfterGenerate.output.includes(
        "Review:    1 persisted items (blocking 0, actionable 0, drafted 0, applied 0, deferred 1)",
      ),
      true,
    );
    assertEquals(
      statusAfterGenerate.output.includes("Review queue: deno task civic review deferred"),
      true,
    );

    const previousColor = Deno.env.get("CIVIC_LEDGER_COLOR");
    const previousNoColor = Deno.env.get("NO_COLOR");
    try {
      Deno.env.set("CIVIC_LEDGER_COLOR", "always");
      Deno.env.delete("NO_COLOR");
      const colorStatusAfterGenerate = await captureConsole(
        () =>
          runCli([
            "--workspace",
            workspace,
            "--state-root",
            stateRoot,
            "status",
          ]),
        { stripAnsi: false },
      );
      assertEquals(colorStatusAfterGenerate.code, 0);
      assertEquals(
        colorStatusAfterGenerate.output.includes(
          "Review queue: \x1b[36mdeno task civic review deferred\x1b[39m",
        ),
        true,
      );
    } finally {
      if (previousColor === undefined) {
        Deno.env.delete("CIVIC_LEDGER_COLOR");
      } else {
        Deno.env.set("CIVIC_LEDGER_COLOR", previousColor);
      }
      if (previousNoColor === undefined) {
        Deno.env.delete("NO_COLOR");
      } else {
        Deno.env.set("NO_COLOR", previousNoColor);
      }
    }

    const deferredJsonResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "deferred",
        "--json",
      ])
    );
    assertEquals(deferredJsonResult.code, 0);
    const deferredJson = JSON.parse(deferredJsonResult.output) as {
      reviewItemCount: number;
      deferredReviewItemCount: number;
      totalReviewItemCount: number;
      groupCount: number;
      shownGroupCount: number;
      limit: number | null;
      groups: Array<{
        category: string;
        label: string;
        count: number;
        sampleItemId: string;
        sampleSummary: string;
        sampleSourceRecords: Array<{
          source: string;
          sourceRecordId: string;
          found: boolean;
          urls: string[];
        }>;
        inspectCommand: string;
        description: string | null;
      }>;
    };
    assertEquals(deferredJson.reviewItemCount, 1);
    assertEquals(deferredJson.deferredReviewItemCount, 1);
    assertEquals(deferredJson.totalReviewItemCount, 1);
    assertEquals(deferredJson.groupCount, deferredJson.groups.length);
    assertEquals(deferredJson.shownGroupCount, deferredJson.groups.length);
    assertEquals(deferredJson.limit, null);
    const openDcDeferredGroup = deferredJson.groups.find((group) =>
      group.category === "out_of_scope_candidate" &&
      group.label === "dc.promotion.opendc_public_body_review_required"
    );
    if (!openDcDeferredGroup) {
      throw new Error("expected Open DC deferred review group");
    }
    assertEquals(openDcDeferredGroup.count > 0, true);
    assertEquals(openDcDeferredGroup.sampleItemId.length > 0, true);
    assertEquals(openDcDeferredGroup.sampleSummary.includes("was not promoted because"), true);
    assertEquals(
      openDcDeferredGroup.sampleSourceRecords.some((record) =>
        record.source === "open_dc.public_bodies" &&
        record.found &&
        record.urls.some((url) => url.includes("open-dc.gov/public-bodies/"))
      ),
      true,
    );
    assertEquals(
      openDcDeferredGroup.inspectCommand.includes(
        `review show ${openDcDeferredGroup.sampleItemId}`,
      ),
      true,
    );
    assertEquals(
      openDcDeferredGroup.description?.includes("current release cannot safely promote"),
      true,
    );

    const deferredShowJsonResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "show",
        openDcDeferredGroup.sampleItemId,
        "--json",
      ])
    );
    assertEquals(deferredShowJsonResult.code, 0);
    const deferredShowJson = JSON.parse(deferredShowJsonResult.output) as {
      sourceRecordSummaries: Array<{
        source: string;
        sourceRecordId: string;
        found: boolean;
        urls: string[];
      }>;
      sourceRecords: Array<{
        source: string;
        sourceRecordId: string;
        found: boolean;
        payload?: Record<string, unknown>;
      }>;
    };
    assertEquals(
      deferredShowJson.sourceRecordSummaries.some((record) =>
        record.source === "open_dc.public_bodies" &&
        record.found &&
        record.urls.some((url) => url.includes("open-dc.gov/public-bodies/"))
      ),
      true,
    );
    assertEquals(
      deferredShowJson.sourceRecords.some((record) =>
        record.source === "open_dc.public_bodies" &&
        record.found &&
        typeof record.payload?.detailUrl === "string"
      ),
      true,
    );

    const deferredShowHumanResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "show",
        openDcDeferredGroup.sampleItemId,
      ])
    );
    assertEquals(deferredShowHumanResult.code, 0);
    assertEquals(deferredShowHumanResult.output.includes("Source records:"), true);
    assertEquals(
      deferredShowHumanResult.output.includes("open-dc.gov/public-bodies/"),
      true,
    );

    const limitedDeferredGroupsJsonResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "deferred",
        "--json",
        "--limit",
        "1",
      ])
    );
    assertEquals(limitedDeferredGroupsJsonResult.code, 0);
    const limitedDeferredGroupsJson = JSON.parse(limitedDeferredGroupsJsonResult.output) as {
      deferredReviewItemCount: number;
      groupCount: number;
      shownGroupCount: number;
      limit: number | null;
      groups: unknown[];
    };
    assertEquals(limitedDeferredGroupsJson.deferredReviewItemCount, 1);
    assertEquals(limitedDeferredGroupsJson.limit, 1);
    assertEquals(limitedDeferredGroupsJson.shownGroupCount, 1);
    assertEquals(limitedDeferredGroupsJson.groups.length, 1);
    assertEquals(limitedDeferredGroupsJson.groupCount, 1);

    const deferredHumanResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "deferred",
      ])
    );
    assertEquals(deferredHumanResult.code, 0);
    assertEquals(
      deferredHumanResult.output.includes(
        "why: Open DC supplied a public-body candidate that the current release cannot safely promote",
      ),
      true,
    );
    assertEquals(deferredHumanResult.output.includes("sample summary:"), true);
    assertEquals(deferredHumanResult.output.includes("sample sources:"), true);
    assertEquals(deferredHumanResult.output.includes("open-dc.gov/public-bodies/"), true);
    assertEquals(deferredHumanResult.output.includes("inspect: deno task civic review show"), true);

    const limitedDeferredGroupsHumanResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "deferred",
        "--limit",
        "1",
      ])
    );
    assertEquals(limitedDeferredGroupsHumanResult.code, 0);
    assertEquals(
      limitedDeferredGroupsHumanResult.output.includes("1 deferred, 1 total review items"),
      true,
    );

    const openListDefaultJsonResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "list",
        "--status",
        "open",
        "--json",
      ])
    );
    assertEquals(openListDefaultJsonResult.code, 0);
    const openListDefaultJson = JSON.parse(openListDefaultJsonResult.output) as {
      reviewItemCount: number;
      totalReviewItemCount: number;
      filter: {
        status: string;
        queue: string;
        defaultQueueApplied: boolean;
        statusMatchedReviewItemCount: number;
        queueMatchedReviewItemCount: number;
        deferredMatchedReviewItemCount: number;
      };
      reviewQueueCounts: Record<string, number>;
      statusFilteredReviewQueueCounts: Record<string, number>;
      items: unknown[];
    };
    assertEquals(openListDefaultJson.reviewItemCount, 0);
    assertEquals(openListDefaultJson.totalReviewItemCount, 1);
    assertEquals(openListDefaultJson.filter.status, "open");
    assertEquals(openListDefaultJson.filter.queue, "inbox");
    assertEquals(openListDefaultJson.filter.defaultQueueApplied, true);
    assertEquals(openListDefaultJson.filter.statusMatchedReviewItemCount, 1);
    assertEquals(openListDefaultJson.filter.queueMatchedReviewItemCount, 0);
    assertEquals(openListDefaultJson.filter.deferredMatchedReviewItemCount, 1);
    assertEquals(openListDefaultJson.reviewQueueCounts.deferred, 1);
    assertEquals(openListDefaultJson.statusFilteredReviewQueueCounts.deferred, 1);
    assertEquals(openListDefaultJson.items.length, 0);

    const openListDefaultHumanResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "list",
        "--status",
        "open",
      ])
    );
    assertEquals(openListDefaultHumanResult.code, 0);
    assertEquals(
      openListDefaultHumanResult.output.includes("Filter: status=open, queue=inbox"),
      true,
    );
    assertEquals(
      openListDefaultHumanResult.output.includes(
        "1 item(s) matched status before queue filtering.",
      ),
      true,
    );
    assertEquals(openListDefaultHumanResult.output.includes("--queue deferred"), true);

    const limitedDeferredJsonResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "list",
        "--queue",
        "deferred",
        "--status",
        "open",
        "--limit",
        "3",
        "--json",
      ])
    );
    assertEquals(limitedDeferredJsonResult.code, 0);
    const limitedDeferredJson = JSON.parse(limitedDeferredJsonResult.output) as {
      reviewItemCount: number;
      filter: {
        queue: string;
        limit: number | null;
        queueMatchedReviewItemCount: number;
        shownReviewItemCount: number;
      };
      items: unknown[];
    };
    assertEquals(limitedDeferredJson.reviewItemCount, 1);
    assertEquals(limitedDeferredJson.filter.queue, "deferred");
    assertEquals(limitedDeferredJson.filter.limit, 3);
    assertEquals(limitedDeferredJson.filter.queueMatchedReviewItemCount, 1);
    assertEquals(limitedDeferredJson.filter.shownReviewItemCount, 1);
    assertEquals(limitedDeferredJson.items.length, 1);

    const limitedDeferredHumanResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "list",
        "--queue",
        "deferred",
        "--status",
        "open",
        "--limit",
        "3",
      ])
    );
    assertEquals(limitedDeferredHumanResult.code, 0);
    assertEquals(limitedDeferredHumanResult.output.includes("1 shown, 1 matching, 1 total"), true);
    assertEquals(limitedDeferredHumanResult.output.includes("Use --queue all"), false);

    const limitedAllQueueHumanResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "list",
        "--queue",
        "all",
        "--status",
        "open",
        "--limit",
        "3",
      ])
    );
    assertEquals(limitedAllQueueHumanResult.code, 0);
    assertEquals(limitedAllQueueHumanResult.output.includes("1 shown, 1 matching, 1 total"), true);
    assertEquals(limitedAllQueueHumanResult.output.includes("Use --queue all"), false);

    const stateEntries = await listEntryFiles(join(stateRoot, "entries"));
    assertEquals(stateEntries.includes("dc.board:advisory-board.json"), true);
    assertEquals(stateEntries.includes("dc.commission:planning-commission.json"), true);
    assertEquals(stateEntries.includes("dc.authority:water-authority.json"), true);
    assertEquals(stateEntries.includes("dc.agency:climate-task-force.json"), false);
    assertEquals(stateEntries.includes("dc.board:board-accountancy.json"), true);
    assertEquals(stateEntries.includes("dc.agency:department-of-public-works.json"), true);
    assertEquals(stateEntries.includes("dc.legal_authority:d-c-code-1-123.json"), true);
    assertEquals(stateEntries.includes("dc.legal_authority:d-c-law-10-50.json"), true);
    assertEquals(stateEntries.includes("dc.legal_authority:d-c-code-1-200.json"), true);
    assertEquals(stateEntries.includes("dc.legal_authority:d-c-code-47-2853-06-b-1.json"), true);
    assertEquals(stateEntries.includes("dc.agency:meetings.json"), false);

    const advisoryEntry = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.board:advisory-board.json")),
    ) as {
      relations: Record<string, Array<{ to: string }>>;
    };
    assertEquals(
      advisoryEntry.relations["dc.relation:governs"]?.[0]?.to,
      "dc.agency:department-of-public-works",
    );
    assertEquals(
      advisoryEntry.relations["dc.relation:authorized_by"]?.map((relation) => relation.to).sort(),
      [
        "dc.legal_authority:d-c-code-1-123",
        "dc.legal_authority:d-c-law-10-50",
      ],
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
    assertEquals(countRows(db, "fragments"), 15);
    assertEquals(countRows(db, "baselines"), 1);
    assertEquals(countRows(db, "state_entries"), 9);
    assertEquals(countRows(db, "state_relations"), 5);
    const baselineRow = db.db.prepare(
      "SELECT payload FROM baselines ORDER BY id DESC LIMIT 1",
    ).get() as { payload: string } | undefined;
    const baseline = JSON.parse(baselineRow?.payload ?? "{}") as {
      entries?: Record<string, unknown>;
    };
    assertEquals(Object.hasOwn(baseline.entries ?? {}, "dc.agency:climate-task-force"), false);
    const promotionFinding = db.db.prepare(
      "SELECT payload FROM findings WHERE source = ?",
    ).get(["dc.promotion.opendc_public_body_review_required"]) as { payload: string } | undefined;
    assertEquals(Boolean(promotionFinding), true);
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
    assertEquals(manifest.counts.entries, 9);
    assertEquals(manifest.counts.relations, 5);
    assertEquals(manifest.counts.relationKinds["dc.relation:authorized_by"], 4);
    assertEquals(manifest.counts.relationKinds["dc.relation:governs"], 1);

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_entries.csv"));
    assertEquals(entriesCsv.includes("Advisory Board"), true);
    assertEquals(entriesCsv.includes("Planning Commission"), true);
    assertEquals(entriesCsv.includes("Water Authority"), true);
    assertEquals(entriesCsv.includes("Climate Task Force"), false);
    assertEquals(entriesCsv.includes("Board of Accountancy"), true);
    assertEquals(entriesCsv.includes("Department of Public Works"), true);
    assertEquals(entriesCsv.includes("D.C. Law 10-50"), true);
    assertEquals(entriesCsv.includes("D.C. Code § 1-123"), true);

    const relationsCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_relations.csv"));
    assertEquals(relationsCsv.includes("dc.relation:governs"), true);
    assertEquals(relationsCsv.includes("dc.relation:authorized_by"), true);
    assertEquals(relationsCsv.includes("dc.board:advisory-board"), true);
    assertEquals(relationsCsv.includes("dc.agency:department-of-public-works"), true);
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

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_entries.csv"));
    assertEquals(entriesCsv.includes("Board of Ethics and Government Accountability"), true);
    assertEquals(entriesCsv.includes("Office of Government Ethics"), true);
    assertEquals(entriesCsv.includes("Office of Open Government"), true);

    const relationsCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_relations.csv"));
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

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_entries.csv"));
    assertEquals(entriesCsv.includes("District of Columbia Courts"), true);
    assertEquals(entriesCsv.includes("Court of Appeals"), true);
    assertEquals(entriesCsv.includes("Superior Court"), true);
    assertEquals(entriesCsv.includes("Civil Division"), true);
    assertEquals(entriesCsv.includes("Tax Division"), true);
    assertEquals(entriesCsv.includes("Crime Victims Compensation Program"), false);
    assertEquals(entriesCsv.includes("Office of the Auditor-Master"), false);

    const relationsCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_relations.csv"));
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

Deno.test("CLI flow with dccourts.structure falls back to seeded official structure on 403", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-dccourts-seeded-" });
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-cli-dccourts-seeded-state-" });

  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    (async () => new Response("blocked", { status: 403 })) as typeof globalThis.fetch;

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
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
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

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_entries.csv"));
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
          <div class="field field-name-body field-type-text-with-summary field-label-hidden">
            <div class="field-items">
              <div class="field-item even" property="content:encoded">
                <p><strong><a href="/sites/default/files/dc/sites/mayormb/page_content/attachments/OCA080921.pdf">Executive Office of the Mayor (EOM)</a>:</strong></p>
                <ul>
                  <li><strong>Office of Communications</strong>: Works to ensure that the media, residents of and visitors to the District, and District employees have access to accurate, timely information from the Mayor.</li>
                  <li><strong>Mayor's Office of Community Relations and Services (MOCRS)</strong>: Serves as the Mayor's primary constituent services organization by providing rapid and complete responses to constituent requests, complaints, and questions.</li>
                </ul>
                <p>Phone: (202) 727-2643</p>
                <p>Email: mayor@example.com</p>
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
              </div>
            </div>
          </div>
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
      attributes: Record<string, unknown>;
      relations: Record<string, Array<{ kind: string; to: string }>>;
    };
    assertEquals(communicationsEntry.kind, "dc.office");
    assertEquals(
      communicationsEntry.attributes.description,
      "Works to ensure that the media, residents of and visitors to the District, and District employees have access to accurate, timely information from the Mayor.",
    );
    assertEquals(
      communicationsEntry.relations["dc.relation:part_of"][0]?.to,
      "dc.office:executive-office-of-the-mayor",
    );

    const eomEntry = JSON.parse(
      await Deno.readTextFile(
        join(stateRoot, "entries", "dc.office:executive-office-of-the-mayor.json"),
      ),
    ) as {
      attributes: Record<string, unknown>;
    };
    assertEquals(eomEntry.attributes.officialUrl, "https://mayor.dc.gov/");

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

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_entries.csv"));
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
          <p>Website: <a href="https://anc4e.example">anc4e.example</a></p>
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
                    <td>(202) 390-2229</td>
                    <td><a href="mailto:4e01@example.com">4e01@example.com</a></td>
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
      headers: {
        "content-type": "text/html",
        ...(key.includes("/anc-profile/")
          ? { "last-modified": "Tue, 16 Jun 2026 21:58:02 GMT" }
          : {}),
      },
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
    assertEquals(ancEntry.attributes.officialUrl, "https://anc4e.example/");
    assertEquals(ancEntry.attributes.sourcePageLastModified, undefined);

    const seatEntry = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.anc_commissioner_seat:4E01.json")),
    ) as {
      attributes: Record<string, unknown>;
    };
    assertEquals(seatEntry.attributes.currentHolderName, 'Aretha "Nikki" Jones');
    assertEquals(seatEntry.attributes.officerRole, "Treasurer");
    assertEquals(seatEntry.attributes.sourcePageLastModified, undefined);

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

    const entriesCsv = await Deno.readTextFile(join(releaseRoot, "_local/ledger_entries.csv"));
    assertEquals(entriesCsv.includes("Crestwood and 16th Street Heights"), true);
    assertEquals(entriesCsv.includes("4e@example.com"), false);
    assertEquals(entriesCsv.includes("4e01@example.com"), false);
    assertEquals(entriesCsv.includes("(202) 727-9945"), false);
    assertEquals(entriesCsv.includes("(202) 390-2229"), false);
    assertEquals(entriesCsv.includes("Meeting Location"), false);
    assertEquals(entriesCsv.includes("Financials"), false);

    const govGraphNodes = JSON.parse(
      await Deno.readTextFile(join(releaseRoot, "govgraph_nodes.json")),
    ) as Array<{ id: string; description?: string }>;
    assertEquals(
      govGraphNodes.find((node) => node.id === "dc.anc_commissioner_seat:4E01")?.description,
      'Current commissioner: Aretha "Nikki" Jones. Officer role: Treasurer.',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(stateRoot, { recursive: true });
    await Deno.remove(releaseRoot, { recursive: true });
  }
});

Deno.test("review workflow lists, shows, drafts, validates, and applies revisions", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-cli-review-workflow-" });
  const projectRoot = await Deno.makeTempDir({
    prefix: "civic-ledger-cli-review-workflow-project-",
  });
  const stateRoot = join(projectRoot, "state");
  const revisionRoot = join(projectRoot, "revisions");
  await Deno.mkdir(stateRoot, { recursive: true });

  const responses = [
    {
      features: [
        {
          attributes: {
            OBJECTID: 1,
            AGENCY_ID: "a-1",
            AGENCY_NAME: "Shared Agency",
            SHORT_NAME: "SA",
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
            OBJECTID: 2,
            BOARD_ID: "b-1",
            BOARD_NAME: "Shared Agency",
            SHORT_NAME: "SB",
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
  const previousColor = Deno.env.get("CIVIC_LEDGER_COLOR");
  const previousNoColor = Deno.env.get("NO_COLOR");

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

    const collectBoardCode = await runCli([
      "--workspace",
      workspace,
      "collect",
      "dcgis.boards",
      "--limit",
      "1",
    ]);
    assertEquals(collectBoardCode, 0);

    const compileCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "compile",
    ]);
    assertEquals(compileCode, 0);

    const itemId = "same_normalized_name:shared-agency";
    const listResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "list",
        "--json",
      ])
    );
    assertEquals(listResult.code, 0);
    const listJson = JSON.parse(listResult.output) as {
      reviewItemCount: number;
      items: Array<{
        id: string;
        status: string;
        publicOutputImpact: boolean;
        blocksCurrentOutput: boolean;
        blocks: { releaseReadiness: boolean };
        queue: string;
        queueLabel: string;
      }>;
    };
    assertEquals(listJson.reviewItemCount, 1);
    assertEquals(listJson.items[0].id, itemId);
    assertEquals(listJson.items[0].status, "open");
    assertEquals(listJson.items[0].publicOutputImpact, true);
    assertEquals(listJson.items[0].blocksCurrentOutput, true);
    assertEquals(listJson.items[0].blocks.releaseReadiness, true);
    assertEquals(listJson.items[0].queue, "blocking");
    assertEquals(listJson.items[0].queueLabel, "Blocking");

    const dashboardResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
      ])
    );
    assertEquals(dashboardResult.code, 0);
    assertEquals(dashboardResult.output.includes("Civic Ledger Review"), true);
    assertEquals(dashboardResult.output.includes("Blocking"), true);
    assertEquals(dashboardResult.output.includes("deno task civic review next"), true);

    Deno.env.set("CIVIC_LEDGER_COLOR", "always");
    Deno.env.delete("NO_COLOR");
    const colorDashboardResult = await captureConsole(
      () =>
        runCli([
          "--workspace",
          workspace,
          "--state-root",
          stateRoot,
          "review",
        ]),
      { stripAnsi: false },
    );
    assertEquals(colorDashboardResult.code, 0);
    assertEquals(colorDashboardResult.output.includes("\x1b["), true);

    const colorListResult = await captureConsole(
      () =>
        runCli([
          "--workspace",
          workspace,
          "--state-root",
          stateRoot,
          "review",
          "list",
        ]),
      { stripAnsi: false },
    );
    assertEquals(colorListResult.code, 0);
    assertEquals(colorListResult.output.includes("\x1b["), true);

    const colorListJsonResult = await captureConsole(
      () =>
        runCli([
          "--workspace",
          workspace,
          "--state-root",
          stateRoot,
          "review",
          "list",
          "--json",
        ]),
      { stripAnsi: false },
    );
    assertEquals(colorListJsonResult.code, 0);
    assertEquals(colorListJsonResult.output.includes("\x1b["), false);
    JSON.parse(colorListJsonResult.output);

    const inboxResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "inbox",
        "--json",
      ])
    );
    assertEquals(inboxResult.code, 0);
    const inboxJson = JSON.parse(inboxResult.output) as {
      reviewItemCount: number;
      items: Array<{ id: string }>;
    };
    assertEquals(inboxJson.reviewItemCount, 1);
    assertEquals(inboxJson.items[0].id, itemId);

    const nextResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "next",
      ])
    );
    assertEquals(nextResult.code, 0);
    assertEquals(
      nextResult.output.includes(
        "Do these similarly named entries represent distinct civic things?",
      ),
      true,
    );
    assertEquals(nextResult.output.includes("Blocks current output: yes"), true);
    assertEquals(nextResult.output.includes("Release blocker if open: yes"), true);

    const nextJsonResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "next",
        "--json",
      ])
    );
    assertEquals(nextJsonResult.code, 0);
    const nextJson = JSON.parse(nextJsonResult.output) as {
      reviewItemCount: number;
      reviewQueueCounts: Record<string, number>;
      next: { id: string; queue: string; queueLabel: string } | null;
    };
    assertEquals(nextJson.reviewItemCount, 1);
    assertEquals(nextJson.reviewQueueCounts.blocking, 1);
    assertEquals(nextJson.reviewQueueCounts.actionable, 0);
    assertEquals(nextJson.next?.id, itemId);
    assertEquals(nextJson.next?.queue, "blocking");
    assertEquals(nextJson.next?.queueLabel, "Blocking");

    const showResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "show",
        itemId,
        "--json",
      ])
    );
    assertEquals(showResult.code, 0);
    const showJson = JSON.parse(showResult.output) as {
      id: string;
      queue: string;
      queueLabel: string;
      publicOutputImpact: boolean;
      blocksCurrentOutput: boolean;
      suggestedResolutions: string[];
      sourceRecords: Array<{
        source: string;
        sourceRecordId: string;
        found: boolean;
        snapshotKey?: string;
        payload?: Record<string, unknown>;
      }>;
    };
    assertEquals(showJson.id, itemId);
    assertEquals(showJson.queue, "blocking");
    assertEquals(showJson.queueLabel, "Blocking");
    assertEquals(showJson.publicOutputImpact, true);
    assertEquals(showJson.blocksCurrentOutput, true);
    assertEquals(showJson.suggestedResolutions.includes("preserve-distinct"), true);
    assertEquals(showJson.sourceRecords.length, 2);
    const sourceRecordsById = new Map(
      showJson.sourceRecords.map((record) => [`${record.source}:${record.sourceRecordId}`, record]),
    );
    assertEquals(sourceRecordsById.get("dcgis.agencies:1")?.found, true);
    assertEquals(
      sourceRecordsById.get("dcgis.agencies:1")?.payload?.AGENCY_NAME,
      "Shared Agency",
    );
    assertEquals(sourceRecordsById.get("dcgis.boards:2")?.found, true);
    assertEquals(sourceRecordsById.get("dcgis.boards:2")?.payload?.BOARD_NAME, "Shared Agency");

    const resolveCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "review",
      "resolve",
      itemId,
      "--as",
      "preserve-distinct",
      "--target",
      "dc.agency:shared-agency",
    ]);
    assertEquals(resolveCode, 0);

    const draftFiles = await listEntryFiles(join(workspace, "draft-revisions"));
    assertEquals(draftFiles.length, 1);
    const draft = JSON.parse(
      await Deno.readTextFile(join(workspace, "draft-revisions", draftFiles[0])),
    ) as { id: string };
    const draftId = draft.id;

    const validateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "revision",
      "validate",
    ]);
    assertEquals(validateCode, 0);

    const applyCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "revision",
      "apply-draft",
      draftFiles[0],
    ]);
    assertEquals(applyCode, 0);
    assertEquals(await exists(join(revisionRoot, `${draftId}.json`)), true);
    assertEquals(await exists(join(workspace, "draft-revisions", draftFiles[0])), false);

    const regenerateCode = await runCli([
      "--workspace",
      workspace,
      "--state-root",
      stateRoot,
      "state",
      "generate",
    ]);
    assertEquals(regenerateCode, 0);

    const agency = JSON.parse(
      await Deno.readTextFile(join(stateRoot, "entries", "dc.agency:shared-agency.json")),
    ) as { attributes: { revisionReviews?: unknown[] } };
    assertEquals(Array.isArray(agency.attributes.revisionReviews), true);

    const appliedListResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "list",
        "--queue",
        "applied",
        "--json",
      ])
    );
    assertEquals(appliedListResult.code, 0);
    const appliedListJson = JSON.parse(appliedListResult.output) as {
      reviewItemCount: number;
      items: Array<{
        id: string;
        status: string;
        publicOutputImpact: boolean;
        blocksCurrentOutput: boolean;
        blocks: { releaseReadiness: boolean };
        queue: string;
        queueLabel: string;
      }>;
    };
    assertEquals(appliedListJson.reviewItemCount, 2);
    const appliedConflict = appliedListJson.items.find((item) => item.id === itemId);
    assertEquals(appliedConflict?.status, "applied");
    assertEquals(appliedConflict?.publicOutputImpact, true);
    assertEquals(appliedConflict?.blocks.releaseReadiness, false);
    assertEquals(appliedConflict?.blocksCurrentOutput, false);
    assertEquals(appliedConflict?.queue, "applied");
    assertEquals(appliedConflict?.queueLabel, "Applied");

    const quietNextResult = await captureConsole(() =>
      runCli([
        "--workspace",
        workspace,
        "--state-root",
        stateRoot,
        "review",
        "next",
      ])
    );
    assertEquals(quietNextResult.code, 0);
    const reviewHeadingIndex = quietNextResult.output.indexOf("Civic Ledger Review");
    const noActionIndex = quietNextResult.output.indexOf("No actionable review items.");
    assertEquals(reviewHeadingIndex >= 0, true);
    assertEquals(noActionIndex > reviewHeadingIndex, true);

    const colorQuietNextResult = await captureConsole(
      () =>
        runCli([
          "--workspace",
          workspace,
          "--state-root",
          stateRoot,
          "review",
          "next",
        ]),
      { stripAnsi: false },
    );
    assertEquals(colorQuietNextResult.code, 0);
    assertEquals(colorQuietNextResult.output.includes("Blocking       \x1b[32m0"), true);
    assertEquals(colorQuietNextResult.output.includes("Blocking       \x1b[36m0"), false);
  } finally {
    restoreFetch();
    if (previousColor === undefined) {
      Deno.env.delete("CIVIC_LEDGER_COLOR");
    } else {
      Deno.env.set("CIVIC_LEDGER_COLOR", previousColor);
    }
    if (previousNoColor === undefined) {
      Deno.env.delete("NO_COLOR");
    } else {
      Deno.env.set("NO_COLOR", previousNoColor);
    }
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(projectRoot, { recursive: true });
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

async function captureConsole(
  fn: () => Promise<number>,
  options: { stripAnsi?: boolean } = {},
): Promise<{ code: number; output: string }> {
  const originalLog = console.log;
  const originalError = console.error;
  const output: string[] = [];
  console.log = (...args: unknown[]) => {
    output.push(args.map((arg) => String(arg)).join(" "));
  };
  console.error = (...args: unknown[]) => {
    output.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const code = await fn();
    const joined = output.join("\n");
    return { code, output: options.stripAnsi === false ? joined : stripAnsi(joined) };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
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
