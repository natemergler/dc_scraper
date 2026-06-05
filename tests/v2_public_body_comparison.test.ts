import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildEntityId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  ancListingFixture,
  ancProfile34gFixture,
  ancProfile6cFixture,
  dcgisBoardsCommissionsCouncilsMetadataFixture,
  dcgisBoardsCommissionsCouncilsRowsFixture,
  openDcBoardFixture,
  openDcIndexFixture,
  openDcTaskForceFixture,
  quickbaseAppointmentsCsvFixture,
  quickbaseFixture,
} from "./helpers/v2_fixtures.ts";

Deno.test("public body comparison report stays on public-body candidates and includes ANC overlap", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsRowsFixture);
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force":
          return openDcTaskForceFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
          return quickbaseFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
          return quickbaseAppointmentsCsvFixture;
        case "https://oanc.dc.gov/anc-profile-listing":
          return ancListingFixture;
        case "https://oanc.dc.gov/anc-profile/anc-6c":
          return ancProfile6cFixture;
        case "https://oanc.dc.gov/anc-profile/anc-34g":
          return ancProfile34gFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.boards_commissions_councils").run(
      createConnectorContext({ fetcher }),
    ),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("mota.quickbase").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("oanc.anc_profiles").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  const report = workbench.comparePublicBodies();
  assert(report.sharedNameCount >= 3);
  assert(
    report.rows.some((row) =>
      row.sourceIds.length > 1 && row.displayName.includes("Board of Accountancy")
    ),
  );
  assert(
    report.rows.some((row) =>
      row.sourceIds.length > 1 && row.displayName.includes("Adult Career Pathways Task Force")
    ),
  );
  assert(
    report.rows.some((row) =>
      row.sourceIds.length > 1 && row.displayName.includes("Advisory Neighborhood Commissions")
    ),
  );
  assert(
    !report.rows.some((row) => row.displayName === "Active / filled seat"),
  );
  assert(
    !report.rows.some((row) => row.displayName === "Jane Doe"),
  );
  assert(
    report.sourceSummaries.some((source) =>
      source.sourceId === "dcgis.boards_commissions_councils" && source.sharedNameCount >= 1
    ),
  );
  assert(
    report.sourceSummaries.some((source) =>
      source.sourceId === "oanc.anc_profiles" && source.sharedNameCount >= 1
    ),
  );
  const quickbaseSummary = report.sourceSummaries.find((source) =>
    source.sourceId === "mota.quickbase"
  );
  assert(quickbaseSummary);
  assert(quickbaseSummary.normalizedNameCount >= 5);
  workbench.close();
  const compareOutput = await runDcCli([
    "source",
    "compare",
    "public-bodies",
    "--db",
    dbPath,
    "--json",
  ]);
  assertEquals(compareOutput.code, 0);
  const compareJson = JSON.parse(compareOutput.stdout) as {
    sharedNameCount: number;
    rows: Array<{ displayName: string; sourceIds: string[] }>;
    sourceSummaries: Array<{ sourceId: string; normalizedNameCount: number }>;
  };
  assert(compareJson.sharedNameCount >= 3);
  assert(
    compareJson.rows.some((row) =>
      row.displayName === "Advisory Neighborhood Commissions" &&
      row.sourceIds.includes("dcgis.boards_commissions_councils") &&
      row.sourceIds.includes("oanc.anc_profiles")
    ),
  );
  assert(
    !compareJson.rows.some((row) => row.displayName === "John Smith"),
  );
  const quickbaseJsonSummary = compareJson.sourceSummaries.find((row) =>
    row.sourceId === "mota.quickbase"
  );
  assert(quickbaseJsonSummary);
  assert(quickbaseJsonSummary.normalizedNameCount >= 5);
});

Deno.test("public body comparison report separates likely variants from exact overlaps", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const timestamp = new Date().toISOString();

  const sourceDefs = [
    {
      sourceId: "dcgis.boards_commissions_councils",
      title: "DCGIS Boards",
      candidates: ["Board of Accountancy"],
    },
    {
      sourceId: "open_dc.public_bodies",
      title: "Open DC Public Bodies",
      candidates: [
        "Board of Accountancy",
        "Advisory Board on Veterans Affairs for the District of Columbia",
      ],
    },
    {
      sourceId: "mota.quickbase",
      title: "MOTA Quickbase",
      candidates: ["Advisory Board on Veterans Affairs for the District of Columbia (ABVA)"],
    },
  ] as const;

  for (const source of sourceDefs) {
    const endpointId = `${source.sourceId}.endpoint`;
    const runId = `${source.sourceId}.run`;
    const artifactId = `${source.sourceId}.artifact`;
    workbench.db.prepare(
      "insert into sources(source_id, title, kind, access_method, base_url, updated_at) values(?, ?, ?, ?, ?, ?)",
    ).run(
      source.sourceId,
      source.title,
      "web",
      "http",
      `https://${source.sourceId}.example`,
      timestamp,
    );
    workbench.db.prepare(
      "insert into source_endpoints(endpoint_id, source_id, title, kind, url, method, capture_mode, updated_at) values(?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      endpointId,
      source.sourceId,
      `${source.title} endpoint`,
      "html",
      `https://${source.sourceId}.example/data`,
      "GET",
      "full",
      timestamp,
    );
    workbench.db.prepare(
      "insert into source_runs(run_id, source_id, endpoint_id, started_at, finished_at, status) values(?, ?, ?, ?, ?, ?)",
    ).run(runId, source.sourceId, endpointId, timestamp, timestamp, "success");
    workbench.db.prepare(
      "insert into source_artifacts(artifact_id, run_id, endpoint_id, kind, path, fetched_url, content_hash, size_bytes, created_at) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      artifactId,
      runId,
      endpointId,
      "page",
      `${dir}/${source.sourceId}.html`,
      `https://${source.sourceId}.example/data`,
      `${source.sourceId}-hash`,
      128,
      timestamp,
    );

    for (const [index, name] of source.candidates.entries()) {
      const sourceItemId = `${source.sourceId}.item.${index + 1}`;
      workbench.db.prepare(
        "insert into source_items(source_item_id, source_id, endpoint_id, run_id, artifact_id, item_key, item_type, title, body_json) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        sourceItemId,
        source.sourceId,
        endpointId,
        runId,
        artifactId,
        `item-${index + 1}`,
        "row",
        name,
        "{}",
      );
      workbench.db.prepare(
        "insert into entity_candidates(candidate_id, source_item_id, proposed_entity_id, name, normalized_name, kind, raw_kind, review_status) values(?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        `candidate.${source.sourceId}.${index + 1}`,
        sourceItemId,
        buildEntityId(name),
        name,
        name,
        "board",
        "Board",
        "pending",
      );
    }
  }

  const report = workbench.comparePublicBodies();
  assertEquals(report.sharedNameCount, 1);
  assertEquals(report.conservativeVariantMatchCount, 1);
  assert(
    report.rows.some((row) =>
      row.displayName === "Board of Accountancy" &&
      row.sourceIds.includes("dcgis.boards_commissions_councils") &&
      row.sourceIds.includes("open_dc.public_bodies")
    ),
  );
  assert(
    !report.rows.some((row) =>
      row.displayName ===
        "Advisory Board on Veterans Affairs for the District of Columbia (ABVA)" &&
      row.sourceIds.length > 1
    ),
  );
  assertEquals(
    report.conservativeVariantMatches.map((row) => row.variantName),
    ["Advisory Board on Veterans Affairs for the District of Columbia"],
  );
  assertEquals(
    report.conservativeVariantMatches[0]?.names.map((row) => row.displayName),
    [
      "Advisory Board on Veterans Affairs for the District of Columbia",
      "Advisory Board on Veterans Affairs for the District of Columbia (ABVA)",
    ],
  );
  assertEquals(
    report.conservativeVariantMatches[0]?.sourceIds,
    ["mota.quickbase", "open_dc.public_bodies"],
  );
  workbench.close();

  const jsonOutput = await runDcCli([
    "source",
    "compare",
    "public-bodies",
    "--db",
    dbPath,
    "--json",
  ]);
  assertEquals(jsonOutput.code, 0);
  const compareJson = JSON.parse(jsonOutput.stdout) as {
    sharedNameCount: number;
    conservativeVariantMatchCount: number;
    conservativeVariantMatches: Array<{
      variantName: string;
      sourceIds: string[];
      names: Array<{ displayName: string; sourceId: string }>;
    }>;
  };
  assertEquals(compareJson.sharedNameCount, 1);
  assertEquals(compareJson.conservativeVariantMatchCount, 1);
  assertEquals(
    compareJson.conservativeVariantMatches[0]?.variantName,
    "Advisory Board on Veterans Affairs for the District of Columbia",
  );
  assertEquals(compareJson.conservativeVariantMatches[0]?.sourceIds, [
    "mota.quickbase",
    "open_dc.public_bodies",
  ]);
  assertEquals(
    compareJson.conservativeVariantMatches[0]?.names.map((row) => row.displayName),
    [
      "Advisory Board on Veterans Affairs for the District of Columbia",
      "Advisory Board on Veterans Affairs for the District of Columbia (ABVA)",
    ],
  );

  const humanOutput = await runDcCli([
    "source",
    "compare",
    "public-bodies",
    "--db",
    dbPath,
  ]);
  assertEquals(humanOutput.code, 0);
  const humanText = humanOutput.stdout;
  assertStringIncludes(humanText, "Shared exact names: 1");
  assertStringIncludes(
    humanText,
    "Conservative variant matches (linkage leads, not exact overlaps): 1",
  );
  assertStringIncludes(
    humanText,
    "Advisory Board on Veterans Affairs for the District of Columbia (ABVA)",
  );
});

Deno.test("public body comparison surfaces council body and board suffix leads without merging them", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const timestamp = new Date().toISOString();

  const sourceDefs = [
    {
      sourceId: "council.committees",
      title: "Council Committees",
      candidates: [{ name: "Metropolitan Washington Airports Authority", kind: "public_body" }],
    },
    {
      sourceId: "dcgis.boards_commissions_councils",
      title: "DCGIS Boards",
      candidates: [{
        name: "Metropolitan Washington Airports Authority Board of Directors (MWAA)",
        kind: "board",
        officialUrl: "https://www.mwaa.com/about/board-directors",
      }],
    },
  ] as const;

  for (const source of sourceDefs) {
    const endpointId = `${source.sourceId}.endpoint`;
    const runId = `${source.sourceId}.run`;
    const artifactId = `${source.sourceId}.artifact`;
    workbench.db.prepare(
      "insert into sources(source_id, title, kind, access_method, base_url, updated_at) values(?, ?, ?, ?, ?, ?)",
    ).run(
      source.sourceId,
      source.title,
      "web",
      "http",
      `https://${source.sourceId}.example`,
      timestamp,
    );
    workbench.db.prepare(
      "insert into source_endpoints(endpoint_id, source_id, title, kind, url, method, capture_mode, updated_at) values(?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      endpointId,
      source.sourceId,
      `${source.title} endpoint`,
      "html",
      `https://${source.sourceId}.example/data`,
      "GET",
      "full",
      timestamp,
    );
    workbench.db.prepare(
      "insert into source_runs(run_id, source_id, endpoint_id, started_at, finished_at, status) values(?, ?, ?, ?, ?, ?)",
    ).run(runId, source.sourceId, endpointId, timestamp, timestamp, "success");
    workbench.db.prepare(
      "insert into source_artifacts(artifact_id, run_id, endpoint_id, kind, path, fetched_url, content_hash, size_bytes, created_at) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      artifactId,
      runId,
      endpointId,
      "page",
      `${dir}/${source.sourceId}.html`,
      `https://${source.sourceId}.example/data`,
      `${source.sourceId}-hash`,
      128,
      timestamp,
    );

    for (const [index, candidate] of source.candidates.entries()) {
      const sourceItemId = `${source.sourceId}.item.${index + 1}`;
      workbench.db.prepare(
        "insert into source_items(source_item_id, source_id, endpoint_id, run_id, artifact_id, item_key, item_type, title, body_json) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        sourceItemId,
        source.sourceId,
        endpointId,
        runId,
        artifactId,
        `item-${index + 1}`,
        "row",
        candidate.name,
        "{}",
      );
      workbench.db.prepare(
        "insert into entity_candidates(candidate_id, source_item_id, proposed_entity_id, name, normalized_name, kind, raw_kind, official_url, review_status) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        `candidate.${source.sourceId}.${index + 1}`,
        sourceItemId,
        buildEntityId(candidate.name),
        candidate.name,
        candidate.name,
        candidate.kind,
        candidate.kind,
        "officialUrl" in candidate ? candidate.officialUrl : null,
        "pending",
      );
    }
  }

  const report = workbench.comparePublicBodies();
  workbench.close();

  assertEquals(report.sharedNameCount, 0);
  assertEquals(report.conservativeVariantMatchCount, 1);
  assertEquals(report.releaseRiskVariantMatchCount, 0);
  assertEquals(
    report.conservativeVariantMatches[0]?.variantName,
    "Metropolitan Washington Airports Authority",
  );
  assertEquals(report.conservativeVariantMatches[0]?.matchKinds, ["governance_suffix"]);
  assertEquals(report.conservativeVariantMatches[0]?.sourceIds, [
    "council.committees",
    "dcgis.boards_commissions_councils",
  ]);
  assertEquals(
    report.conservativeVariantMatches[0]?.names.map((row) => row.displayName),
    [
      "Metropolitan Washington Airports Authority",
      "Metropolitan Washington Airports Authority Board of Directors (MWAA)",
    ],
  );
  assertEquals(
    report.conservativeVariantMatches[0]?.names.map((row) => ({
      candidateId: row.candidateId,
      proposedEntityId: row.proposedEntityId,
      kind: row.kind,
      officialUrl: row.officialUrl,
      reviewStatus: row.reviewStatus,
    })),
    [
      {
        candidateId: "candidate.council.committees.1",
        proposedEntityId: "dc.metropolitan_washington_airports_authority",
        kind: "public_body",
        officialUrl: null,
        reviewStatus: "pending",
      },
      {
        candidateId: "candidate.dcgis.boards_commissions_councils.1",
        proposedEntityId: "dc.metropolitan_washington_airports_authority_board_of_directors_mwaa",
        kind: "board",
        officialUrl: "https://www.mwaa.com/about/board-directors",
        reviewStatus: "pending",
      },
    ],
  );
});

Deno.test("public body comparison report stays usable when Quickbase is unfetched", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsRowsFixture);
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force":
          return openDcTaskForceFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.boards_commissions_councils").run(
      createConnectorContext({ fetcher }),
    ),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  const report = workbench.comparePublicBodies();
  const quickbaseSummary = report.sourceSummaries.find((source) =>
    source.sourceId === "mota.quickbase"
  );
  assert(quickbaseSummary);
  assertEquals(quickbaseSummary.latestStatus, "unfetched");
  assertEquals(quickbaseSummary.normalizedNameCount, 0);
  assertEquals(quickbaseSummary.sharedNameCount, 0);
  assertEquals(quickbaseSummary.exclusiveNameCount, 0);
  assert(
    report.rows.some((row) =>
      row.sourceIds.length > 1 && row.displayName.includes("Board of Accountancy")
    ),
  );
  workbench.close();

  const compareOutput = await runDcCli([
    "source",
    "compare",
    "public-bodies",
    "--db",
    dbPath,
    "--json",
  ]);
  assertEquals(compareOutput.code, 0);
  const compareJson = JSON.parse(compareOutput.stdout) as {
    sourceSummaries: Array<{
      sourceId: string;
      latestStatus?: string;
      normalizedNameCount: number;
      sharedNameCount: number;
      exclusiveNameCount: number;
    }>;
    rows: Array<{ sourceIds: string[]; displayName: string }>;
  };
  const quickbaseJson = compareJson.sourceSummaries.find((source) =>
    source.sourceId === "mota.quickbase"
  );
  assert(quickbaseJson);
  assertEquals(quickbaseJson.latestStatus, "unfetched");
  assertEquals(quickbaseJson.normalizedNameCount, 0);
  assertEquals(quickbaseJson.sharedNameCount, 0);
  assertEquals(quickbaseJson.exclusiveNameCount, 0);
  assert(
    compareJson.rows.some((row) =>
      row.sourceIds.length > 1 && row.displayName.includes("Board of Accountancy")
    ),
  );
});

Deno.test("public body comparison keeps conservative variant matches separate from exact overlaps", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  async function importComparisonCandidate(input: {
    sourceId: string;
    title: string;
    candidateId: string;
    name: string;
    kind: string;
    rawKind?: string;
  }) {
    await workbench.importConnectorResult({
      source: {
        sourceId: input.sourceId,
        title: input.title,
        kind: "fixture",
        accessMethod: "fixture",
        baseUrl: `https://example.com/${input.sourceId}`,
      },
      endpointResults: [{
        endpoint: {
          endpointId: `${input.sourceId}.main`,
          sourceId: input.sourceId,
          title: `${input.title} rows`,
          kind: "fixture",
          url: `https://example.com/${input.sourceId}`,
          method: "GET",
          captureMode: "rows",
        },
        status: "success",
        artifacts: [{
          kind: "rows",
          extension: "json",
          fetchedUrl: `https://example.com/${input.sourceId}`,
          contentText: JSON.stringify({ name: input.name }),
        }],
        parsed: {
          items: [{
            itemKey: `${input.candidateId}.row`,
            itemType: "fixture_row",
            title: input.name,
            body: { name: input.name },
          }],
          entityCandidates: [{
            candidateId: input.candidateId,
            sourceItemKey: `${input.candidateId}.row`,
            proposedEntityId: buildEntityId(input.name),
            name: input.name,
            kind: input.kind,
            rawKind: input.rawKind,
            evidence: [{
              fieldPath: "name",
              observedValue: input.name,
            }],
          }],
        },
      }],
    }, dataDir);
  }

  await importComparisonCandidate({
    sourceId: "dcgis.boards_commissions_councils",
    title: "DCGIS Fixture",
    candidateId: "candidate.dcgis.board_of_example",
    name: "Board of Example",
    kind: "board",
  });
  await importComparisonCandidate({
    sourceId: "open_dc.public_bodies",
    title: "Open DC Fixture",
    candidateId: "candidate.open_dc.board_of_example_boe",
    name: "Board of Example (BOE)",
    kind: "board",
  });
  await importComparisonCandidate({
    sourceId: "mota.quickbase",
    title: "Quickbase Fixture",
    candidateId: "candidate.quickbase.board_of_example_advisory",
    name: "Board of Example (Advisory Board)",
    kind: "board",
  });

  const report = workbench.comparePublicBodies();
  assertEquals(report.sharedNameCount, 0);
  assertEquals(report.rows.filter((row) => row.sourceIds.length > 1).length, 0);
  assertEquals(report.conservativeVariantMatchCount, 1);
  assertEquals(report.releaseRiskVariantMatchCount, 0);
  assertEquals(report.conservativeVariantMatches.length, 1);
  const variant = report.conservativeVariantMatches[0];
  assertEquals(variant.variantName, "Board of Example");
  assertEquals(variant.matchKinds, ["acronym_parenthetical", "parenthetical_alias"]);
  assertEquals(variant.sourceIds, [
    "dcgis.boards_commissions_councils",
    "mota.quickbase",
    "open_dc.public_bodies",
  ]);
  assertEquals(
    variant.names.map((row) => `${row.sourceId}:${row.displayName}`),
    [
      "dcgis.boards_commissions_councils:Board of Example",
      "mota.quickbase:Board of Example (Advisory Board)",
      "open_dc.public_bodies:Board of Example (BOE)",
    ],
  );
  workbench.close();
});

Deno.test("public body comparison catches profession-tail board variants conservatively", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  async function importComparisonCandidate(input: {
    sourceId: string;
    title: string;
    candidateId: string;
    name: string;
    kind: string;
    rawKind?: string;
  }) {
    await workbench.importConnectorResult({
      source: {
        sourceId: input.sourceId,
        title: input.title,
        kind: "fixture",
        accessMethod: "fixture",
        baseUrl: `https://example.com/${input.sourceId}`,
      },
      endpointResults: [{
        endpoint: {
          endpointId: `${input.sourceId}.main`,
          sourceId: input.sourceId,
          title: `${input.title} rows`,
          kind: "fixture",
          url: `https://example.com/${input.sourceId}`,
          method: "GET",
          captureMode: "rows",
        },
        status: "success",
        artifacts: [{
          kind: "rows",
          extension: "json",
          fetchedUrl: `https://example.com/${input.sourceId}`,
          contentText: JSON.stringify({ name: input.name }),
        }],
        parsed: {
          items: [{
            itemKey: `${input.candidateId}.row`,
            itemType: "fixture_row",
            title: input.name,
            body: { name: input.name },
          }],
          entityCandidates: [{
            candidateId: input.candidateId,
            sourceItemKey: `${input.candidateId}.row`,
            proposedEntityId: buildEntityId(input.name),
            name: input.name,
            kind: input.kind,
            rawKind: input.rawKind,
            evidence: [{
              fieldPath: "name",
              observedValue: input.name,
            }],
          }],
        },
      }],
    }, dataDir);
  }

  await importComparisonCandidate({
    sourceId: "open_dc.public_bodies",
    title: "Open DC Fixture",
    candidateId: "candidate.open_dc.board_of_architecture_variant",
    name: "Board of Architecture, Interior Design and Landscape Architect",
    kind: "board",
  });
  await importComparisonCandidate({
    sourceId: "dcgis.boards_commissions_councils",
    title: "DCGIS Fixture",
    candidateId: "candidate.dcgis.board_of_architecture_variant",
    name: "Board of Architecture, Interior Design, and Landscape Architecture",
    kind: "board",
  });

  const report = workbench.comparePublicBodies();
  assertEquals(report.sharedNameCount, 0);
  assertEquals(report.rows.filter((row) => row.sourceIds.length > 1).length, 0);
  assertEquals(report.conservativeVariantMatchCount, 1);
  assertEquals(
    report.conservativeVariantMatches[0]?.variantName,
    "Board of Architecture, Interior Design, and Landscape Architecture",
  );
  assertEquals(report.conservativeVariantMatches[0]?.matchKinds, ["profession_suffix"]);
  assertEquals(
    report.conservativeVariantMatches[0]?.names.map((row) => `${row.sourceId}:${row.displayName}`),
    [
      "dcgis.boards_commissions_councils:Board of Architecture, Interior Design, and Landscape Architecture",
      "open_dc.public_bodies:Board of Architecture, Interior Design and Landscape Architect",
    ],
  );
  workbench.close();
});

async function runDcCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      ...args,
    ],
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}
