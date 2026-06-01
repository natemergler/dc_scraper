import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { Database } from "@db/sqlite";
import { buildV2Release } from "../src/v2/release.ts";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildKnownEntityRef } from "../src/v2/connectors/shared.ts";
import { parseLegalReference } from "../src/v2/domain.ts";
import { renderReviewItem } from "../src/v2/workbench/review_cli.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  admin311Fixture,
  admin311WrongLayerFixture,
  adminBudgetPageFixture,
  adminProcurementPageFixture,
  arcgisLayerDetailFixture,
  arcgisServiceLayersFixture,
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
  dcgisMetadataFixture,
  dcgisRowsFixture,
  legalEntrypointsFixture,
  limsFixture,
  openDcBoardFixture,
  openDcCommissionFixture,
  openDcIndexFixture,
  openDcTaskForceFixture,
  quickbaseAppointmentsCsvFixture,
  quickbaseFixture,
} from "./helpers/v2_fixtures.ts";

Deno.test("fresh v2 workbench initializes and init is idempotent", async () => {
  const dir = await Deno.makeTempDir();
  await ensureDir(join(dir, "data"));
  const dbPath = join(dir, "data", "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  const first = workbench.init();
  const second = workbench.init();
  const indexes = new Set(
    workbench.db.prepare("select name from sqlite_master where type = 'index'").all().map(
      (row) => (row as { name: string }).name,
    ),
  );
  workbench.close();
  assertEquals(first.schemaVersion, 5);
  assertEquals(second.schemaVersion, 5);
  assertEquals(second.migrations.length, 5);
  for (
    const indexName of [
      "source_runs_source_status_idx",
      "source_items_source_key_idx",
      "review_items_queue_idx",
      "canonical_relationships_to_idx",
      "resolution_events_file_sequence_idx",
    ]
  ) {
    assert(indexes.has(indexName), `missing index ${indexName}`);
  }
});

Deno.test("workbench schema rejects orphan rows and invalid statuses", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const foreignKeys = workbench.db.prepare("pragma foreign_keys").value<[number]>()?.[0];
  assertEquals(foreignKeys, 1);
  assertThrows(
    () =>
      workbench.db.prepare(
        "insert into source_runs(run_id, source_id, endpoint_id, started_at, status) values('run.orphan', 'missing.source', 'missing.endpoint', datetime('now'), 'success')",
      ).run(),
    Error,
    "FOREIGN KEY constraint failed",
  );
  assertThrows(
    () =>
      workbench.db.prepare(
        "insert into review_items(review_item_id, item_type, subject_id, reason, default_action, status, details_json, created_at, updated_at) values('review.invalid', 'entity_candidate', 'candidate.invalid', 'invalid fixture', 'accept', 'mystery', '{}', datetime('now'), datetime('now'))",
      ).run(),
    Error,
    "CHECK constraint failed",
  );
  assertThrows(
    () =>
      workbench.db.prepare(
        "insert into relationship_candidates(relationship_candidate_id, source_item_id, from_entity_ref, to_entity_ref, relationship_type, needs_review, review_status) values('relationship.invalid', 'missing.item', 'dc.a', 'dc.b', 'sort_of_near', 0, 'pending')",
      ).run(),
    Error,
    "CHECK constraint failed",
  );
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.a', 'A', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into resolution_events(event_id, event_type, subject_id, payload_json, resolution_file, sequence_number, created_at) values('event.constraint', 'accept_relationship_candidate', 'relationship.constraint', '{}', 'fixture.jsonl', 1, datetime('now'))",
  ).run();
  assertThrows(
    () =>
      workbench.db.prepare(
        "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.a:part_of:dc.missing', 'dc.a', 'part_of', 'dc.missing', 'accepted', 'event.constraint', datetime('now'))",
      ).run(),
    Error,
    "FOREIGN KEY constraint failed",
  );
  workbench.close();
});

Deno.test("local workbench artifacts are ignored by git", async () => {
  const paths = [
    "data/workbench.sqlite",
    "resolutions/2026-06-01/001-auto-review.jsonl",
    "snapshots/source.json",
    "candidates/generated.json",
    "candidates_patched/generated.json",
    "records/generated.yml",
    "checks/latest.md",
    "patches/generated.jsonl",
    "releases/latest/manifest.json",
  ];
  const output = await new Deno.Command("git", {
    cwd: Deno.cwd(),
    args: ["check-ignore", ...paths],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.code, 0);
  assertEquals(new TextDecoder().decode(output.stdout).trim().split("\n"), paths);
});

Deno.test("top-level CLI aliases make the workbench easy to enter", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "data", "workbench.sqlite");
  const initOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "init",
      "--db",
      dbPath,
    ],
  }).output();
  assertEquals(initOutput.code, 0);
  assertStringIncludes(new TextDecoder().decode(initOutput.stdout), "Initialized v2 workbench");

  const statusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
    ],
  }).output();
  assertEquals(statusOutput.code, 0);
  const statusText = new TextDecoder().decode(statusOutput.stdout);
  assertStringIncludes(statusText, "Schema version: 5");
  assertStringIncludes(statusText, "Sources: 0/");
  assertStringIncludes(statusText, "Review: 0 open, 0 deferred");
  assertStringIncludes(statusText, "Next: dc source list");

  const jsonStatusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(jsonStatusOutput.code, 0);
  const jsonStatus = JSON.parse(new TextDecoder().decode(jsonStatusOutput.stdout)) as {
    schemaVersion: number;
    sources: { fetched: number; total: number };
    review: { open: number; deferred: number };
    nextCommand: string;
  };
  assertEquals(jsonStatus.schemaVersion, 5);
  assertEquals(jsonStatus.sources.fetched, 0);
  assertEquals(jsonStatus.review.open, 0);
  assertEquals(jsonStatus.nextCommand, "dc source list");

  const sourceListOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "list",
      "--db",
      dbPath,
    ],
  }).output();
  assertEquals(sourceListOutput.code, 0);
  const sourceListText = new TextDecoder().decode(sourceListOutput.stdout);
  assertStringIncludes(sourceListText, "dcgis.agencies unfetched");
  assertStringIncludes(sourceListText, "mota.quickbase unfetched");

  const sourceListJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "list",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(sourceListJsonOutput.code, 0);
  const sourceListJson = JSON.parse(
    new TextDecoder().decode(sourceListJsonOutput.stdout),
  ) as Array<{ sourceId: string; title: string; status: string }>;
  assert(
    sourceListJson.some((row) =>
      row.sourceId === "dcgis.agencies" &&
      row.title === "District Government Agencies" &&
      row.status === "unfetched"
    ),
  );

  const unfetchedInspectOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "inspect",
      "dcgis.agencies",
      "--db",
      dbPath,
    ],
  }).output();
  const unfetchedInspectText = new TextDecoder().decode(unfetchedInspectOutput.stdout);
  assertEquals(unfetchedInspectOutput.code, 0);
  assertStringIncludes(unfetchedInspectText, "dcgis.agencies - District Government Agencies");
  assertStringIncludes(unfetchedInspectText, "Latest status: unfetched");

  const unfetchedInspectJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "inspect",
      "dcgis.agencies",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const unfetchedInspectJson = JSON.parse(
    new TextDecoder().decode(unfetchedInspectJsonOutput.stdout),
  ) as { sourceId: string; latestStatus: string; itemCount: number };
  assertEquals(unfetchedInspectJsonOutput.code, 0);
  assertEquals(unfetchedInspectJson.sourceId, "dcgis.agencies");
  assertEquals(unfetchedInspectJson.latestStatus, "unfetched");
  assertEquals(unfetchedInspectJson.itemCount, 0);
});

Deno.test("CLI command errors print a concise message", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const output = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "fetch",
      "not.a.source",
      "--db",
      dbPath,
    ],
  }).output();
  const stderr = new TextDecoder().decode(output.stderr);
  assertEquals(output.code, 1);
  assertStringIncludes(stderr, "Unknown v2 source: not.a.source");
  assert(!stderr.includes(" at "));
});

Deno.test("focused CLI help exits zero and does not run commands", async () => {
  const sourceHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "--help",
    ],
  }).output();
  const sourceText = new TextDecoder().decode(sourceHelp.stdout);
  assertEquals(sourceHelp.code, 0);
  assertStringIncludes(sourceText, "dc source list");
  assertStringIncludes(sourceText, "dc source fetch <source-id>");
  assertStringIncludes(sourceText, "dc source inspect <source-id>");

  const reviewHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "--help",
    ],
  }).output();
  const reviewText = new TextDecoder().decode(reviewHelp.stdout);
  assertEquals(reviewHelp.code, 0);
  assertStringIncludes(reviewText, "Usage:");
  assertStringIncludes(reviewText, "dc review [entities|relationships|legal|sources]");
  assertStringIncludes(reviewText, "dc review list");
  assert(!reviewText.includes("No review items remain."));

  const entityHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
      "--help",
    ],
  }).output();
  const entityText = new TextDecoder().decode(entityHelp.stdout);
  assertEquals(entityHelp.code, 0);
  assertStringIncludes(entityText, "dc entity search <query>");
  assertStringIncludes(entityText, "dc entity show <entity-id>");

  const releaseHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "--help",
    ],
  }).output();
  const releaseText = new TextDecoder().decode(releaseHelp.stdout);
  const releaseError = new TextDecoder().decode(releaseHelp.stderr);
  assertEquals(releaseHelp.code, 0);
  assertStringIncludes(releaseText, "Usage:");
  assertStringIncludes(releaseText, "dc release build");
  assertStringIncludes(releaseText, "dc release inspect");
  assertEquals(releaseError, "");
});

Deno.test("imports representative connector results and source inspection stays queryable after failures", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const responses = new Map<string, string>([
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json",
      JSON.stringify(dcgisMetadataFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json",
      JSON.stringify(dcgisRowsFixture),
    ],
    ["https://www.open-dc.gov/public-bodies", openDcIndexFixture],
    ["https://www.open-dc.gov/public-bodies/board-accountancy", openDcBoardFixture],
    [
      "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force",
      openDcTaskForceFixture,
    ],
    ["https://dccouncil.gov/committees/", councilCommitteesFixture],
    [
      "https://dccouncil.gov/committees/committee-of-the-whole/",
      councilCommitteeWholeDetailFixture,
    ],
    ["https://dccouncil.gov/committees/committee-on-health/", councilCommitteeHealthDetailFixture],
    ["https://lims.dccouncil.gov/api/Search/GetWhatsNew", limsFixture],
    [
      "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0",
      quickbaseFixture,
    ],
    [
      "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs",
      quickbaseAppointmentsCsvFixture,
    ],
    ["https://dc.gov/page/laws-regulations-and-courts", legalEntrypointsFixture],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/ServiceRequests/FeatureServer/21?f=json",
      admin311Fixture,
    ],
    ["https://cfo.dc.gov/budget", adminBudgetPageFixture],
    ["https://ocp.dc.gov/page/doing-business-dc-government", adminProcurementPageFixture],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer/46?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Certificate of Occupancy")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer/45?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Home Occupancy Permit")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer/5?f=json",
      JSON.stringify(arcgisLayerDetailFixture("ABCA Liquor License Locations")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/7?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Bias Crime")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/24?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Vehicular Crash Data")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/29?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Shot Spotter Gun Shots")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/10?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Certificate Of Occupancy Points")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/39?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Tax Lots")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/33?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Parcel Lots")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/35?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Reservations")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/8?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Mail Ballot Drop Boxes")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/9?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Election Day Vote Center")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/10?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Early Vote Center")),
    ],
  ]);
  const fetcher = async (url: string) => {
    const body = responses.get(url);
    if (!body) throw new Error(`Unexpected fixture url ${url}`);
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };
  for (
    const sourceId of [
      "dcgis.agencies",
      "open_dc.public_bodies",
      "council.committees",
      "council.lims",
      "mota.quickbase",
      "legal.entrypoints",
      "admin.service_requests_311",
      "admin.budget_sources",
      "admin.permits_licenses",
      "admin.crime_public_safety",
      "admin.procurement_sources",
      "admin.property_land",
      "admin.elections",
    ]
  ) {
    const connector = getConnector(sourceId);
    const result = await connector.run(createConnectorContext({ fetcher, limit: 2 }));
    await workbench.importConnectorResult(result, dataDir);
  }
  const dcgis = workbench.sourceSummary("dcgis.agencies");
  const quickbase = workbench.sourceSummary("mota.quickbase");
  const permitSummary = workbench.sourceSummary("admin.permits_licenses");
  const categories = new Set(workbench.datasets().map((dataset) => dataset.category));
  const hasRegisterRef = workbench.legalRefs().some((ref) => ref.ref_type === "dc_register");
  const branchCandidate = workbench.listReviewItems({ type: "entity_candidate" }).find((item) =>
    item.subjectId === "candidate.dcgis.agencies.branch_executive"
  );
  workbench.close();
  assertEquals(dcgis.fieldCount, 7);
  assertEquals(dcgis.entityCandidateCount, 3);
  assertEquals(dcgis.relationshipCandidateCount, 2);
  assert(branchCandidate);
  assertEquals(branchCandidate.details.kind, "branch");
  assertEquals(quickbase.latestStatus, "success");
  assertStringIncludes(quickbase.latestArtifactPath ?? "", "mota.quickbase");
  assertEquals(quickbase.itemCount > 0, true);
  assertEquals(quickbase.entityCandidateCount > 0, true);
  assertEquals(quickbase.relationshipCandidateCount > 0, true);
  assertEquals(hasRegisterRef, true);
  assertEquals(permitSummary.fieldCount > 0, true);
  assertEquals(categories.has("procurement"), true);
  assertEquals(categories.has("budget"), true);
  assertEquals(categories.has("crime_incidents"), true);
});

Deno.test("failed parsed imports keep artifacts but roll back partial typed rows", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await assertRejects(
    () =>
      workbench.importConnectorResult(
        {
          source: {
            sourceId: "test.bad_parse",
            title: "Bad Parse Fixture",
            kind: "fixture",
            accessMethod: "fixture",
            baseUrl: "https://example.test",
          },
          endpointResults: [{
            endpoint: {
              endpointId: "test.bad_parse.main",
              sourceId: "test.bad_parse",
              title: "Main",
              kind: "fixture",
              url: "https://example.test/source",
              method: "GET",
              captureMode: "fixture",
            },
            status: "success",
            artifacts: [{
              kind: "json",
              extension: "json",
              contentText: JSON.stringify({ ok: false }),
              fetchedUrl: "https://example.test/source",
            }],
            parsed: {
              items: [{
                itemKey: "known",
                itemType: "fixture",
                title: "Known Item",
                body: { name: "Known Item" },
              }],
              entityCandidates: [{
                candidateId: "candidate.test.bad_parse.missing",
                sourceItemKey: "missing",
                proposedEntityId: "dc.missing",
                name: "Missing",
                kind: "fixture",
                evidence: [],
              }],
            },
          }],
        },
        dataDir,
      ),
    Error,
    "Missing source item for key missing",
  );

  const runStatus = workbench.db.prepare(
    "select status, error_text as errorText from source_runs where source_id = ?",
  ).get("test.bad_parse") as { status: string; errorText: string };
  const counts = workbench.db.prepare(
    `select
       (select count(*) from source_artifacts) as artifacts,
       (select count(*) from source_items) as items,
       (select count(*) from entity_candidates) as entityCandidates`,
  ).get() as { artifacts: number; items: number; entityCandidates: number };
  workbench.close();

  assertEquals(runStatus.status, "failed");
  assertStringIncludes(runStatus.errorText, "Missing source item for key missing");
  assertEquals(counts, { artifacts: 1, items: 0, entityCandidates: 0 });
});

Deno.test("quickbase connector parses public CSV appointment rows into entities, relationships, and review items", async () => {
  const appointmentsCsvWithAlias = `${quickbaseAppointmentsCsvFixture.trim()}
"Commission on Nightlife and Culture (CNC)","Alcoholic Beverages and Cannabis Administration (ABCA) Designee","Filled","Mayoral Appointee, DC Agency Representative","Active"
`;
  const result = await getConnector("mota.quickbase").run(
    createConnectorContext({
      fetcher: async (url: string) => {
        const body = (() => {
          switch (url) {
            case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
              return quickbaseFixture;
            case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
              return appointmentsCsvWithAlias;
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        })();
        return {
          status: 200,
          text: async () => body,
          json: async <T>() => JSON.parse(body) as T,
        };
      },
    }),
  );
  assertEquals(result.endpointResults.length, 2);
  assertEquals(result.endpointResults[1].status, "success");
  const parsed = result.endpointResults[1].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 6);
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Downtown Revitalization Committee"
    ),
  );
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "District of Columbia Rental Housing Commission"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "overseen_by" &&
      candidate.toEntityRef === "dc.council_of_the_district_of_columbia"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by" &&
      candidate.rawValue === "Alcoholic Beverages and Cannabis Administration (ABCA) Designee" &&
      candidate.toEntityRef === "dc.alcoholic_beverage_and_cannabis_administration"
    ),
  );
  assert(
    parsed.reviewItems?.some((item) => item.itemType === "relationship_candidate"),
  );
  assert(
    parsed.reviewItems?.every((item) => item.itemType !== "source_status"),
  );
  assert(
    parsed.datasets?.some((dataset) => dataset.category === "appointments"),
  );
});

Deno.test("quickbase connector keeps contact columns out of public fact candidates", async () => {
  const csvWithContactColumns = quickbaseAppointmentsCsvFixture.replace(
    '"board status"',
    '"board status","Email","Phone","Private Notes"',
  ).replaceAll(
    '"Active"',
    '"Active","not-for-release@example.com","202-555-0100","private contact metadata"',
  );
  const result = await getConnector("mota.quickbase").run(
    createConnectorContext({
      fetcher: async (url: string) => {
        const body = (() => {
          switch (url) {
            case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
              return quickbaseFixture;
            case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
              return csvWithContactColumns;
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        })();
        return {
          status: 200,
          text: async () => body,
          json: async <T>() => JSON.parse(body) as T,
        };
      },
    }),
  );

  const parsed = result.endpointResults[1].parsed;
  assert(parsed);
  const publicFacts = JSON.stringify({
    entityCandidates: parsed.entityCandidates,
    relationshipCandidates: parsed.relationshipCandidates,
    datasets: parsed.datasets,
    reviewItems: parsed.reviewItems,
  });
  assert(!publicFacts.includes("not-for-release@example.com"));
  assert(!publicFacts.includes("202-555-0100"));
  assert(!publicFacts.includes("private contact metadata"));
});

Deno.test("Open DC detail evidence points to the detail artifact rather than the index artifact", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force":
          return openDcTaskForceFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    })();
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  const detailItem = workbench.db.prepare(
    `select source_items.source_item_id as sourceItemId,
            source_artifacts.path as artifactPath
     from source_items
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     where source_items.endpoint_id = ? and source_items.item_key = ?`,
  ).get("open_dc.public_bodies.detail", "board-accountancy") as {
    sourceItemId: string;
    artifactPath: string;
  };
  const indexItem = workbench.db.prepare(
    `select source_items.source_item_id as sourceItemId,
            source_artifacts.path as artifactPath
     from source_items
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     where source_items.endpoint_id = ? and source_items.item_key = ?`,
  ).get("open_dc.public_bodies.index", "board-accountancy") as {
    sourceItemId: string;
    artifactPath: string;
  };
  const evidence = workbench.db.prepare(
    `select artifact_path as artifactPath
     from entity_candidate_evidence
     where candidate_id = ?
     order by evidence_id
     limit 1`,
  ).get("candidate.open_dc.public_bodies.board_accountancy") as { artifactPath: string };
  const taskForceLegalRef = workbench.db.prepare(
    "select url from legal_refs where legal_ref_id = ?",
  ).get("legal.open_dc.public_bodies.adult_career_pathways_task_force_authority") as {
    url: string | null;
  };
  const endpointAliases = new Map(
    workbench.db.prepare(
      "select raw_value as rawValue, to_entity_ref as toEntityRef from relationship_candidates where raw_value in ('DLCP/OPL', 'DOES')",
    ).all().map((row) => {
      const alias = row as { rawValue: string; toEntityRef: string };
      return [alias.rawValue, alias.toEntityRef];
    }),
  );
  workbench.close();
  assert(detailItem.artifactPath !== indexItem.artifactPath);
  assertEquals(evidence.artifactPath, detailItem.artifactPath);
  assertEquals(taskForceLegalRef.url, null);
  assertEquals(
    endpointAliases.get("DLCP/OPL"),
    "dc.department_of_licensing_and_consumer_protection",
  );
  assertEquals(endpointAliases.get("DOES"), "dc.department_of_employment_services");
});

Deno.test("Open DC second detail-page shape yields administered and legal-authority relationship candidates plus document links", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body><a href="/public-bodies/commission-on-example-services">Commission on Example Services</a></body></html>`;
        case "https://www.open-dc.gov/public-bodies/commission-on-example-services":
          return openDcCommissionFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher, limit: 1 }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assert(
    detail.items?.some((item) =>
      item.itemType === "document_link" && String(item.body.href).includes("commission-charter.pdf")
    ),
  );
  assert(
    detail.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by" &&
      candidate.rawValue === "Office of the City Administrator"
    ),
  );
  assert(
    detail.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "authorized_by" &&
      candidate.rawValue === "Mayor's Order 2019-010"
    ),
  );
});

Deno.test("Open DC public bodies can be safely accepted before relationship review", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
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
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--subject-prefix",
      "candidate.open_dc.public_bodies",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted 2 safe review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const relationshipItem = reopened.listReviewItems({
    mode: "relationships",
    relationshipType: "governed_by",
    subjectPrefix: "relationship.open_dc.public_bodies",
  }).find((item) =>
    item.subjectId === "relationship.open_dc.public_bodies.board_accountancy_governing_agency"
  );
  assert(relationshipItem);
  const reviewText = renderReviewItem(reopened, relationshipItem);
  reopened.close();
  assertStringIncludes(reviewText, 'dc.board_of_accountancy "Board of Accountancy" (accepted)');
  assertStringIncludes(
    reviewText,
    "dc.department_of_licensing_and_consumer_protection (missing; accepting will create a placeholder entity)",
  );
});

Deno.test("multi-artifact connector imports keep schema and row evidence on the correct artifacts", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
          return JSON.stringify(dcgisRowsFixture);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    })();
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };
  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  const schemaArtifact = workbench.db.prepare(
    `select source_artifacts.path as artifactPath
     from source_fields
     join source_artifacts on source_artifacts.artifact_id = source_fields.artifact_id
     where source_fields.endpoint_id = ? and source_fields.field_name = ?`,
  ).get("dcgis.agencies.main", "AGENCY_NAME") as { artifactPath: string };
  const rowArtifact = workbench.db.prepare(
    `select source_artifacts.path as artifactPath
     from source_items
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     where source_items.endpoint_id = ? and source_items.item_key = ?`,
  ).get("dcgis.agencies.main", "1001") as { artifactPath: string };
  const evidence = workbench.db.prepare(
    `select artifact_path as artifactPath
     from entity_candidate_evidence
     where candidate_id = ?
     order by evidence_id
     limit 1`,
  ).get("candidate.dcgis.agencies.1001") as { artifactPath: string };
  workbench.close();
  assert(schemaArtifact.artifactPath !== rowArtifact.artifactPath);
  assertEquals(evidence.artifactPath, rowArtifact.artifactPath);
});

Deno.test("relationship acceptance creates a reviewable placeholder entity", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: "relationship.council.committees.committee_of_the_whole_part_of",
      payload: {},
    },
    resolutionsDir,
  );
  const placeholderView = workbench.entityView("dc.council_of_the_district_of_columbia");
  const reviewItems = workbench.listReviewItems("entities");
  workbench.close();
  assertEquals(placeholderView.reviewStatus, "placeholder");
  assertStringIncludes(placeholderView.placeholderReason ?? "", "relationship candidate");
  assert(
    reviewItems.some((item) =>
      item.itemType === "placeholder_entity" &&
      item.subjectId === "dc.council_of_the_district_of_columbia"
    ),
  );
});

Deno.test("relationship review renders endpoint status and placeholder implications", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  const item = workbench.listReviewItems({ mode: "relationships" }).find((reviewItem) =>
    reviewItem.subjectId === "relationship.council.committees.committee_of_the_whole_part_of"
  );
  assert(item);
  const before = renderReviewItem(workbench, item);
  assertStringIncludes(before, "relationship:");
  assertStringIncludes(before, "- type: part_of");
  assertStringIncludes(before, "- family: part_of -> dc.council_of_the_district_of_columbia");
  assertStringIncludes(before, 'dc.committee_of_the_whole "Committee of the Whole"');
  assertStringIncludes(before, "candidate pending");
  assertStringIncludes(
    before,
    "dc.council_of_the_district_of_columbia (missing; accepting will create a placeholder entity)",
  );
  assertStringIncludes(before, "e edit type/endpoints and accept");

  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.council.committees.committee_of_the_whole",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: item.subjectId,
      payload: {},
    },
    resolutionsDir,
  );
  const placeholderItem = workbench.listReviewItems({ mode: "relationships", status: "resolved" })
    .find((reviewItem) => reviewItem.subjectId === item.subjectId);
  assert(placeholderItem);
  const after = renderReviewItem(workbench, placeholderItem);
  workbench.close();
  assertStringIncludes(after, 'dc.committee_of_the_whole "Committee of the Whole" (accepted)');
  assertStringIncludes(
    after,
    'dc.council_of_the_district_of_columbia "Council Of The District Of Columbia" (placeholder; review placeholder before relying on this edge)',
  );
});

Deno.test("dc review relationships can edit endpoints before accepting", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.council.committees.committee_of_the_whole",
      payload: {},
    },
    resolutionsDir,
  );
  workbench.close();

  const reviewProcess = new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "relationships",
      "--subject-prefix",
      "relationship.council.committees.committee_of_the_whole_part_of",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = reviewProcess.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode("e\npart_of\n\ndc.council_of_the_district_of_columbia\n"),
  );
  await writer.close();
  const output = await reviewProcess.output();
  const text = new TextDecoder().decode(output.stdout);
  assertEquals(output.code, 0);
  assertStringIncludes(text, "Relationship type:");
  assertStringIncludes(text, "From entity id (blank keeps source):");
  assertStringIncludes(text, "To entity id (blank keeps source):");
  assertStringIncludes(text, "Saved resolution.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const relationships = reopened.canonicalRelationships();
  reopened.close();
  assertEquals(relationships.map((row) => row.id), [
    "dc.committee_of_the_whole:part_of:dc.council_of_the_district_of_columbia",
  ]);
});

Deno.test("Council committee oversight extraction only emits explicit source-backed overseen_by candidates", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("council.committees").run(createConnectorContext({ fetcher }));
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  const oversightCandidates =
    parsed.relationshipCandidates?.filter((candidate) =>
      candidate.relationshipType === "overseen_by"
    ) ?? [];
  assertEquals(oversightCandidates.length, 4);
  assert(
    oversightCandidates.every((candidate) =>
      candidate.sourceItemKey.includes(":oversight") && candidate.needsReview === true
    ),
  );
  assertEquals(
    oversightCandidates.some((candidate) => candidate.rawValue === "twitter"),
    false,
  );
  assert(
    oversightCandidates.some((candidate) =>
      candidate.rawValue === "Department of Health" &&
      candidate.fromEntityRef === "dc.dc_health"
    ),
  );
  assert(
    parsed.reviewItems?.some((item) =>
      item.subjectId === "relationship.council.committees.committee_on_health_oversight_1" &&
      item.reason === "Review Council committee oversight relationship"
    ),
  );
});

Deno.test("legal reference parsing normalizes common DC citation families", () => {
  assertEquals(
    parseLegalReference("D.C. Official Code § 1-204.22").normalizedCitation,
    "D.C. Code 1-204.22",
  );
  assertEquals(parseLegalReference("24 DCMR § 100.1").normalizedCitation, "24 DCMR 100.1");
  assertEquals(
    parseLegalReference("Mayor’s Order 2024-001").normalizedCitation,
    "Mayor's Order 2024-001",
  );
  assertEquals(
    parseLegalReference("Mayor's Order 2001-92 Amended 2002-142", "https://code.dccouncil.us/")
      .refType,
    "mayors_order",
  );
  assertEquals(
    parseLegalReference("71 D.C. Register 012345").normalizedCitation,
    "71 D.C. Register 012345",
  );
  assertEquals(
    parseLegalReference("District of Columbia Official Code").normalizedCitation,
    "D.C. Official Code",
  );
  assertEquals(
    parseLegalReference("Mayor's Orders", "https://dcregs.dc.gov/default.aspx").refType,
    "dc_register",
  );
  assertEquals(parseLegalReference("§ 25–202").normalizedCitation, "D.C. Code 25-202");
  assertEquals(parseLegalReference("4-1303.01a").normalizedCitation, "D.C. Code 4-1303.01a");
  assertEquals(
    parseLegalReference("D.C. Official Code § 47-2853.06(b)(1)").normalizedCitation,
    "D.C. Code 47-2853.06(b)(1)",
  );
});

Deno.test("known relationship endpoint aliases resolve to accepted-style entity ids", () => {
  assertEquals(
    buildKnownEntityRef("Mayor's Office of Veterans Affairs (MOVA)"),
    "dc.mayor_s_office_of_veterans_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Department of Health (DOH)"),
    "dc.dc_health",
  );
  assertEquals(buildKnownEntityRef("City Administrator"), "dc.office_of_the_city_administrator");
  assertEquals(buildKnownEntityRef("District of Columbia Auditor"), "dc.office_of_the_dc_auditor");
  assertEquals(
    buildKnownEntityRef("District of Columbia Board of Elections"),
    "dc.board_of_elections",
  );
  assertEquals(
    buildKnownEntityRef("District of Columbia Housing Authority"),
    "dc.dc_housing_authority",
  );
  assertEquals(
    buildKnownEntityRef("District of Columbia Public Library System"),
    "dc.dc_public_library",
  );
  assertEquals(
    buildKnownEntityRef("District of Columbia Water and Sewer Authority"),
    "dc.dc_water",
  );
  assertEquals(
    buildKnownEntityRef("Fire and Emergency Medical Services Department"),
    "dc.fire_and_emergency_medical_services",
  );
  assertEquals(
    buildKnownEntityRef("Office of the Attorney General for the District of Columbia"),
    "dc.office_of_the_attorney_general",
  );
  assertEquals(
    buildKnownEntityRef("Office of the People’s Counsel"),
    "dc.office_of_the_people_s_counsel_for_the_district_of_columbia",
  );
  assertEquals(
    buildKnownEntityRef("Bicycle Advisory Council"),
    "dc.bicycle_advisory_council_bac",
  );
  assertEquals(
    buildKnownEntityRef("Board of Barber and Cosmetology"),
    "dc.board_of_barber_and_cosmetology_bobc",
  );
  assertEquals(
    buildKnownEntityRef("Commission on Aging"),
    "dc.commission_on_aging_coa",
  );
  assertEquals(
    buildKnownEntityRef("Health Information Exchange Policy Board"),
    "dc.health_information_exchange_policy_board_hie",
  );
});

Deno.test("legal refs import into a reviewable queue and legal resolutions update release status truth", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const outDir = join(dir, "release");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        if (url === "https://dc.gov/page/laws-regulations-and-courts") {
          return legalEntrypointsFixture;
        }
        throw new Error(`Unexpected url ${url}`);
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(result, dataDir);

  const items = workbench.listReviewItems("legal");
  assertEquals(items.length, 3);
  assert(items.some((item) => item.defaultAction === "accept"));
  assert(items.some((item) => item.defaultAction === "defer"));

  const codeItem = items.find((item) => item.details.refType === "dc_code");
  const registerItem = items.find((item) => item.details.refType === "dc_register");
  const orderItem = items.find((item) => item.details.refType === "mayors_order");
  assert(codeItem);
  assert(registerItem);
  assert(orderItem);
  await workbench.appendResolutionEvent(
    { eventType: "accept_legal_ref", subjectId: codeItem.subjectId, payload: {} },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_legal_ref",
      subjectId: registerItem.subjectId,
      payload: { refType: "dcmr", normalizedCitation: "DCMR and D.C. Register entrypoint" },
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    { eventType: "reject_legal_ref", subjectId: orderItem.subjectId, payload: {} },
    resolutionsDir,
  );

  const resolvedItems = workbench.listReviewItems({ mode: "legal", status: "resolved" });
  assertEquals(resolvedItems.length, 3);
  await buildV2Release(workbench, outDir);
  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    release_summary: {
      legal_refs_by_review_status: Array<{ review_status: string; count: number }>;
      legal_refs_by_type: Array<{ ref_type: string; count: number }>;
    };
  };
  const statuses = new Map(
    manifest.release_summary.legal_refs_by_review_status.map((row) => [
      row.review_status,
      row.count,
    ]),
  );
  const types = new Map(
    manifest.release_summary.legal_refs_by_type.map((row) => [row.ref_type, row.count]),
  );
  workbench.close();
  assertEquals(statuses.get("accepted"), 2);
  assertEquals(statuses.get("rejected"), 1);
  assertEquals(types.get("dcmr"), 1);
});

Deno.test("batch accept-safe accepts scoped normalized legal refs and skips ambiguous rows", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        if (url === "https://dc.gov/page/laws-regulations-and-courts") {
          return legalEntrypointsFixture;
        }
        throw new Error(`Unexpected url ${url}`);
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(result, dataDir);
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "legal",
      "--subject-prefix",
      "legal.legal.entrypoints",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted 2 safe review item(s).");
  assertStringIncludes(batchText, "Skipped 1 item(s) that were not safe to auto-accept.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const statuses = reopened.db.prepare(
    "select review_status as reviewStatus, count(*) as count from legal_refs group by review_status",
  ).all() as Array<{ reviewStatus: string; count: number }>;
  const statusCounts = new Map(statuses.map((row) => [row.reviewStatus, row.count]));
  const pendingItem = reopened.listReviewItems({ mode: "legal" })[0];
  reopened.close();
  assertEquals(statusCounts.get("accepted"), 2);
  assertEquals(statusCounts.get("pending"), 1);
  assertEquals(pendingItem.details.refType, "dc_register");
});

Deno.test("batch defer marks scoped legal refs deferred without changing legal ref status", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        if (url === "https://dc.gov/page/laws-regulations-and-courts") {
          return legalEntrypointsFixture;
        }
        throw new Error(`Unexpected url ${url}`);
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(result, dataDir);
  workbench.close();

  const listOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--mode",
      "legal",
      "--subject-prefix",
      "legal.legal.entrypoints",
      "--ref-type",
      "dc_register",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const listed = JSON.parse(new TextDecoder().decode(listOutput.stdout)) as {
    count: number;
    items: Array<{ details: { refType: string } }>;
  };
  assertEquals(listOutput.code, 0);
  assertEquals(listed.count, 1);
  assertEquals(listed.items[0].details.refType, "dc_register");

  const deferOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "defer",
      "--mode",
      "legal",
      "--subject-prefix",
      "legal.legal.entrypoints",
      "--ref-type",
      "dc_register",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferOutput.code, 0);
  assertStringIncludes(new TextDecoder().decode(deferOutput.stdout), "Deferred 1 review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const deferred = reopened.listReviewItems({
    mode: "legal",
    status: "deferred",
    subjectPrefix: "legal.legal.entrypoints",
    refType: "dc_register",
  });
  const legalRef = reopened.db.prepare(
    "select review_status as reviewStatus from legal_refs where ref_type = 'dc_register'",
  ).get() as { reviewStatus: string };
  reopened.close();
  assertEquals(deferred.length, 1);
  assertEquals(legalRef.reviewStatus, "pending");
});

Deno.test("dc review legal supports scripted normalize-and-quit flow", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        if (url === "https://dc.gov/page/laws-regulations-and-courts") {
          return legalEntrypointsFixture;
        }
        throw new Error(`Unexpected url ${url}`);
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(result, dataDir);
  workbench.close();

  const child = new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "legal",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode("n\ndc_code\nD.C. Official Code\nq\n"));
  await writer.close();
  const output = await child.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  assertEquals(output.code, 0);
  assertEquals(stderr, "");
  assertStringIncludes(stdout, "Review item:");
  assertStringIncludes(stdout, "n normalize and accept");
  assertStringIncludes(stdout, "Saved resolution.");
  assertStringIncludes(stdout, "Review stopped.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const accepted = reopened.legalRefs().filter((ref) => ref.review_status === "accepted");
  reopened.close();
  assertEquals(accepted.length, 1);
  assertEquals(accepted[0].normalized_citation, "D.C. Official Code");
});

Deno.test("review ordering surfaces placeholders, blocked relationships, and high-confidence entities in a stable order", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
          return quickbaseFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
          return quickbaseAppointmentsCsvFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("mota.quickbase").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  const relationshipCandidate = workbench.listReviewItems({ mode: "relationships" }).find((item) =>
    item.subjectId.endsWith("_part_of")
  );
  assert(relationshipCandidate);
  const matchingEntityCandidateId = relationshipCandidate.subjectId
    .replace(/^relationship\./, "candidate.")
    .replace(/_part_of$/, "");
  const matchingEntityCandidate = workbench.listReviewItems({ type: "entity_candidate" }).find(
    (item) => item.subjectId === matchingEntityCandidateId,
  );
  assert(matchingEntityCandidate);
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: matchingEntityCandidate.subjectId,
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: relationshipCandidate.subjectId,
      payload: {},
    },
    resolutionsDir,
  );
  const items = workbench.listReviewItems();
  workbench.close();
  assertEquals(items[0].itemType, "placeholder_entity");
  assertEquals(items[0].subjectId, "dc.council_of_the_district_of_columbia");
  assert(items.every((item) => item.itemType !== "source_status"));
  assert(items.slice(1).some((item) => item.itemType === "relationship_candidate"));
  assert(items.slice(1).some((item) => item.itemType === "entity_candidate"));
});

Deno.test("review list filters by mode, status, type, and subject prefix", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  workbench.close();
  const output = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--mode",
      "entities",
      "--status",
      "open",
      "--type",
      "entity_candidate",
      "--subject-prefix",
      "candidate.council.committees",
      "--db",
      dbPath,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.code, 0);
  const text = new TextDecoder().decode(output.stdout);
  assertStringIncludes(text, "Review items:");
  assertStringIncludes(text, "entity_candidate");
  assert(!text.includes("source_status"));
  const jsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--mode",
      "entities",
      "--status",
      "open",
      "--type",
      "entity_candidate",
      "--subject-prefix",
      "candidate.council.committees",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const json = JSON.parse(new TextDecoder().decode(jsonOutput.stdout)) as {
    count: number;
    items: Array<{ itemType: string; subjectId: string }>;
  };
  assertEquals(jsonOutput.code, 0);
  assertEquals(json.count, json.items.length);
  assert(json.items.every((item) => item.itemType === "entity_candidate"));
  assert(json.items.every((item) => item.subjectId.startsWith("candidate.council.committees")));

  const relationshipTypeJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--mode",
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.council.committees",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const relationshipTypeJson = JSON.parse(
    new TextDecoder().decode(relationshipTypeJsonOutput.stdout),
  ) as {
    count: number;
    items: Array<{ itemType: string; subjectId: string; details: { relationshipType: string } }>;
  };
  assertEquals(relationshipTypeJsonOutput.code, 0);
  assert(relationshipTypeJson.count > 0);
  assert(
    relationshipTypeJson.items.every((item) =>
      item.itemType === "relationship_candidate" &&
      item.subjectId.startsWith("relationship.council.committees") &&
      item.details.relationshipType === "part_of"
    ),
  );

  const rawValueContainsJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees",
      "--raw-value-contains",
      "Health",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const rawValueContainsJson = JSON.parse(
    new TextDecoder().decode(rawValueContainsJsonOutput.stdout),
  ) as {
    count: number;
    items: Array<{ details: { rawValue: string; relationshipType: string } }>;
  };
  assertEquals(rawValueContainsJsonOutput.code, 0);
  assert(rawValueContainsJson.count > 0);
  assert(
    rawValueContainsJson.items.every((item) =>
      item.details.relationshipType === "overseen_by" &&
      item.details.rawValue.includes("Health")
    ),
  );

  const limitedJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--mode",
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.council.committees",
      "--limit",
      "1",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const limitedJson = JSON.parse(new TextDecoder().decode(limitedJsonOutput.stdout)) as {
    count: number;
    items: Array<{ itemType: string }>;
  };
  assertEquals(limitedJsonOutput.code, 0);
  assertEquals(limitedJson.count, 1);
  assertEquals(limitedJson.items.length, 1);

  const allStatusJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--status",
      "all",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const allStatusJson = JSON.parse(
    new TextDecoder().decode(allStatusJsonOutput.stdout),
  ) as { count: number; items: Array<{ itemType: string }> };
  assertEquals(allStatusJsonOutput.code, 0);
  assertEquals(allStatusJson.count, allStatusJson.items.length);
  assert(allStatusJson.count >= json.count);
});

Deno.test("deferred review items stay visible but sort behind open items", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  const deferredItem = workbench.listReviewItems({ type: "entity_candidate" })[0];
  assert(deferredItem);
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: deferredItem.reviewItemId,
      payload: {},
    },
    resolutionsDir,
  );
  const items = workbench.listReviewItems({ type: "entity_candidate" });
  workbench.close();
  assertEquals(items.at(-1)?.status, "deferred");
  assert(items.slice(0, -1).every((item) => item.status === "open"));
});

Deno.test("batch accept-safe writes JSONL resolution events and leaves risky review items alone", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  workbench.close();
  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted ");
  let resolutionFile = "";
  for await (const entry of Deno.readDir(resolutionsDir)) {
    if (!entry.isDirectory) continue;
    for await (const child of Deno.readDir(join(resolutionsDir, entry.name))) {
      if (child.isFile && child.name.endsWith(".jsonl")) {
        resolutionFile = join(resolutionsDir, entry.name, child.name);
      }
    }
  }
  assert(resolutionFile);
  const lines = (await Deno.readTextFile(resolutionFile)).trim().split("\n").filter(Boolean);
  assert(lines.length > 0);
  assert(lines.every((line) => JSON.parse(line).event_type === "accept_entity_candidate"));
  const reopened = new Workbench(dbPath);
  reopened.init();
  assert(reopened.listReviewItems({ mode: "relationships" }).length > 0);
  reopened.close();
});

Deno.test("batch accept-safe accepts filtered relationships only when endpoints are accepted", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.council.committees.committee_of_the_whole",
      payload: {},
    },
    resolutionsDir,
  );
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.council.committees",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted 1 safe review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const relationship = reopened.db.prepare(
    "select relationship_type as relationshipType, to_entity_id as toEntityId from canonical_relationships where from_entity_id = ?",
  ).get("dc.committee_of_the_whole") as { relationshipType: string; toEntityId: string };
  const unresolvedPartOf = reopened.listReviewItems({
    mode: "relationships",
    relationshipType: "part_of",
    subjectPrefix: "relationship.council.committees",
  });
  reopened.close();
  assertEquals(relationship.relationshipType, "part_of");
  assertEquals(relationship.toEntityId, "dc.council_of_the_district_of_columbia");
  assert(
    unresolvedPartOf.some((item) =>
      item.subjectId === "relationship.council.committees.committee_on_health_part_of"
    ),
  );
});

Deno.test("batch accept-safe accepts scoped Council oversight only for accepted endpoints", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  for (
    const subjectId of [
      "candidate.council.committees.committee_of_the_whole",
      "candidate.council.committees.committee_on_health",
    ]
  ) {
    await workbench.appendResolutionEvent(
      { eventType: "accept_entity_candidate", subjectId, payload: {} },
      resolutionsDir,
    );
  }
  for (
    const [entityId, name] of [
      ["dc.dc_health", "Department of Health"],
      ["dc.department_of_behavioral_health", "Department of Behavioral Health"],
    ]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted 2 safe review item(s).");
  assertStringIncludes(batchText, "Skipped 2 item(s) that were not safe to auto-accept.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const acceptedOversight = reopened.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'overseen_by' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  const remainingOversight = reopened.listReviewItems({
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees",
  });
  reopened.close();
  assertEquals(acceptedOversight.map((row) => row.relationshipId), [
    "dc.dc_health:overseen_by:dc.committee_on_health",
    "dc.department_of_behavioral_health:overseen_by:dc.committee_on_health",
  ]);
  assertEquals(remainingOversight.length, 2);
});

Deno.test("relationship raw-value filter narrows branch review slices and safe batch acceptance", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const mixedBranchRowsFixture = {
    features: [
      ...dcgisRowsFixture.features,
      {
        attributes: {
          AGENCY_ID: 2001,
          AGENCY_NAME: "District of Columbia Courts",
          TYPE: "Agency",
          BRANCH: "Judicial",
          MAYORAL_CLUSTER: "",
          WEB_URL: "https://dccourts.gov/",
          LEGISLATION: "",
        },
      },
      {
        attributes: {
          AGENCY_ID: 3001,
          AGENCY_NAME: "Example Settlement Fund",
          TYPE: "Fund",
          BRANCH: "Other",
          MAYORAL_CLUSTER: "",
          WEB_URL: "",
          LEGISLATION: "",
        },
      },
    ],
  };
  const bodyForUrl = (url: string): string => {
    switch (url) {
      case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
        return JSON.stringify(dcgisMetadataFixture);
      case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
        return JSON.stringify(mixedBranchRowsFixture);
      default:
        throw new Error(`Unexpected url ${url}`);
    }
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => bodyForUrl(url),
    json: async <T>() => JSON.parse(bodyForUrl(url)) as T,
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  workbench.close();

  const commonArgs = [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-run",
    "--allow-net",
    "--allow-ffi",
    "scripts/dc.ts",
  ];
  const entityBatchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      ...commonArgs,
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--subject-prefix",
      "candidate.dcgis.agencies",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(entityBatchOutput.code, 0);

  const executiveListOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      ...commonArgs,
      "review",
      "list",
      "--mode",
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.dcgis.agencies",
      "--raw-value",
      "Executive",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const executiveList = JSON.parse(
    new TextDecoder().decode(executiveListOutput.stdout),
  ) as {
    count: number;
    items: Array<{ details: { rawValue: string } }>;
  };
  assertEquals(executiveListOutput.code, 0);
  assertEquals(executiveList.count, 2);
  assert(executiveList.items.every((item) => item.details.rawValue === "Executive"));

  const relationshipBatchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      ...commonArgs,
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.dcgis.agencies",
      "--raw-value",
      "Executive",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(relationshipBatchOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(relationshipBatchOutput.stdout),
    "Accepted 2 safe review item(s).",
  );

  const broadRelationshipBatchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      ...commonArgs,
      "review",
      "batch",
      "accept-safe",
      "--mode",
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.dcgis.agencies",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(broadRelationshipBatchOutput.code, 0);
  const broadRelationshipBatchText = new TextDecoder().decode(
    broadRelationshipBatchOutput.stdout,
  );
  assertStringIncludes(broadRelationshipBatchText, "Accepted 1 safe review item(s).");
  assertStringIncludes(
    broadRelationshipBatchText,
    "Skipped 1 item(s) that were not safe to auto-accept.",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const relationshipCount = reopened.db.prepare(
    "select count(*) as count from canonical_relationships",
  ).get() as { count: number };
  const remainingBranches = reopened.listReviewItems({
    mode: "relationships",
    relationshipType: "part_of",
    subjectPrefix: "relationship.dcgis.agencies",
  }).map((item) => item.details.rawValue);
  reopened.close();
  assertEquals(relationshipCount.count, 3);
  assert(remainingBranches.includes("Other"));
  assert(!remainingBranches.includes("Executive"));
  assert(!remainingBranches.includes("Judicial"));
});

Deno.test("batch defer marks a scoped relationship review slice deferred", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const mixedBranchRowsFixture = {
    features: [
      ...dcgisRowsFixture.features,
      {
        attributes: {
          AGENCY_ID: 3001,
          AGENCY_NAME: "Example Settlement Fund",
          TYPE: "Fund",
          BRANCH: "Other",
          MAYORAL_CLUSTER: "",
          WEB_URL: "",
          LEGISLATION: "",
        },
      },
    ],
  };
  const bodyForUrl = (url: string): string => {
    switch (url) {
      case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
        return JSON.stringify(dcgisMetadataFixture);
      case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
        return JSON.stringify(mixedBranchRowsFixture);
      default:
        throw new Error(`Unexpected url ${url}`);
    }
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => bodyForUrl(url),
    json: async <T>() => JSON.parse(bodyForUrl(url)) as T,
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  workbench.close();

  const deferOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "defer",
      "--mode",
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.dcgis.agencies",
      "--raw-value",
      "Other",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferOutput.code, 0);
  assertStringIncludes(new TextDecoder().decode(deferOutput.stdout), "Deferred 1 review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const openOther = reopened.listReviewItems({
    mode: "relationships",
    status: "open",
    relationshipType: "part_of",
    subjectPrefix: "relationship.dcgis.agencies",
    rawValue: "Other",
  });
  const deferredOther = reopened.listReviewItems({
    mode: "relationships",
    status: "deferred",
    relationshipType: "part_of",
    subjectPrefix: "relationship.dcgis.agencies",
    rawValue: "Other",
  });
  reopened.close();
  assertEquals(openOther.length, 0);
  assertEquals(deferredOther.length, 1);
});

Deno.test("batch defer marks a raw-value substring relationship slice deferred", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  workbench.close();

  const deferOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "defer",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees",
      "--raw-value-contains",
      "Health",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferOutput.code, 0);
  assertStringIncludes(new TextDecoder().decode(deferOutput.stdout), "Deferred 2 review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const deferredHealth = reopened.listReviewItems({
    mode: "relationships",
    status: "deferred",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees",
    rawValueContains: "Health",
  });
  const openOversight = reopened.listReviewItems({
    mode: "relationships",
    status: "open",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees",
  });
  reopened.close();
  assertEquals(deferredHealth.length, 2);
  assertEquals(openOversight.length, 2);
});

Deno.test("resolution replay accepts entities, merges duplicates, accepts one directed relationship, and surfaces inverse display", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force":
          return openDcTaskForceFixture;
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.open_dc.public_bodies.board_accountancy",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.open_dc.public_bodies.adult_career_pathways_task_force",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "merge_entity_candidates",
      subjectId: "candidate.council.committees.committee_of_the_whole",
      payload: {
        entityId: "dc.council_of_the_district_of_columbia",
        candidateIds: ["candidate.council.committees.committee_of_the_whole"],
      },
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: "relationship.council.committees.committee_of_the_whole_part_of",
      payload: {},
    },
    resolutionsDir,
  );
  const entity = workbench.entityView("dc.council_of_the_district_of_columbia");
  await workbench.replayResolutionDirectory(resolutionsDir);
  const firstReplay = workbench.db.prepare(
    "select source_event_id as sourceEventId from canonical_relationships where relationship_id = ?",
  ).get("dc.committee_of_the_whole:part_of:dc.council_of_the_district_of_columbia") as {
    sourceEventId: string;
  };
  await workbench.replayResolutionDirectory(resolutionsDir);
  const secondReplay = workbench.db.prepare(
    "select source_event_id as sourceEventId from canonical_relationships where relationship_id = ?",
  ).get("dc.committee_of_the_whole:part_of:dc.council_of_the_district_of_columbia") as {
    sourceEventId: string;
  };
  workbench.close();
  assert(entity.incoming.some((row) => row.sourceEntityId === "dc.committee_of_the_whole"));
  assertEquals(entity.incoming.length, 1);
  assertEquals(entity.incoming[0].relationshipType, "has_part");
  assertEquals(firstReplay.sourceEventId, secondReplay.sourceEventId);
});

Deno.test("resolution replay rolls back the rebuild when a conflict is found", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const badReplayDir = join(dir, "bad-resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
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
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.open_dc.public_bodies.board_accountancy",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.open_dc.public_bodies.adult_career_pathways_task_force",
      payload: {},
    },
    resolutionsDir,
  );
  await ensureDir(join(badReplayDir, "2026-06-01"));
  await Deno.writeTextFile(
    join(badReplayDir, "2026-06-01", "001-conflict.jsonl"),
    [
      JSON.stringify({
        event_type: "accept_entity_candidate",
        subject_id: "candidate.open_dc.public_bodies.board_accountancy",
        payload: {},
      }),
      JSON.stringify({
        event_type: "set_entity_fields",
        subject_id: "dc.board_of_accountancy",
        payload: {
          entityId: "dc.board_of_accountancy",
          fields: { name: "Conflicting Accountancy Board" },
        },
      }),
    ].join("\n") + "\n",
  );

  await assertRejects(
    () => workbench.replayResolutionDirectory(badReplayDir),
    Error,
    "Conflict: dc.board_of_accountancy.name already set",
  );

  const entities = workbench.canonicalEntities();
  workbench.close();
  assertEquals(
    entities.map((entity) => entity.id),
    ["dc.adult_career_pathways_task_force", "dc.board_of_accountancy"],
  );
});

Deno.test("failed resolution append does not write a replay event", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 1 })),
    dataDir,
  );
  const first = await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.open_dc.public_bodies.board_accountancy",
      payload: {},
    },
    resolutionsDir,
  );

  await assertRejects(
    () =>
      workbench.appendResolutionEvent(
        {
          eventType: "set_entity_fields",
          subjectId: "dc.board_of_accountancy",
          payload: {
            entityId: "dc.board_of_accountancy",
            fields: { name: "Conflicting Accountancy Board" },
          },
        },
        resolutionsDir,
      ),
    Error,
    "Conflict: dc.board_of_accountancy.name already set",
  );

  const lines = (await Deno.readTextFile(first.filePath)).trim().split("\n");
  const eventCount = workbench.db.prepare(
    "select count(*) as count from resolution_events",
  ).get() as { count: number };
  workbench.close();
  assertEquals(lines.length, 1);
  assertEquals(eventCount.count, 1);
});

Deno.test("resolution append rejects unknown subjects without writing JSONL", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await assertRejects(
    () =>
      workbench.appendResolutionEvent(
        {
          eventType: "reject_entity_candidate",
          subjectId: "candidate.missing",
          payload: {},
        },
        resolutionsDir,
      ),
    Error,
    "Candidate not found: candidate.missing",
  );

  const eventCount = workbench.db.prepare(
    "select count(*) as count from resolution_events",
  ).get() as { count: number };
  workbench.close();
  assertEquals(eventCount.count, 0);
  await assertRejects(() => Deno.stat(resolutionsDir), Deno.errors.NotFound);
});

Deno.test("release builder creates focused v2 package with stable files and no raw source rows in entity csv", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, official_url, review_status, merged_candidate_ids, created_at, updated_at) values('dc.board_accountancy', 'Board of Accountancy', 'board', 'https://www.open-dc.gov/public-bodies/board-accountancy', 'accepted', '[\"candidate.open_dc.public_bodies.board_accountancy\"]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into resolution_events(event_id, event_type, subject_id, payload_json, resolution_file, sequence_number, created_at) values('event.1', 'accept_relationship_candidate', 'relationship.fixture', '{}', 'fixture.jsonl', 1, datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.board_accountancy:part_of:dc.council', 'dc.board_accountancy', 'part_of', 'dc.council', 'accepted', 'event.1', datetime('now'))",
  ).run();
  workbench.upsertSource(
    "open_dc.public_bodies",
    "Open DC Public Bodies",
    "public_body_pages",
    "official_page_html",
    "https://www.open-dc.gov/public-bodies",
  );
  workbench.upsertEndpoint({
    endpointId: "open_dc.public_bodies.detail",
    sourceId: "open_dc.public_bodies",
    title: "Open DC Public Body Detail",
    kind: "page",
    url: "https://www.open-dc.gov/public-bodies/board-accountancy",
    method: "GET",
    captureMode: "page",
  });
  workbench.db.prepare(
    "insert into source_runs(run_id, source_id, endpoint_id, started_at, finished_at, status) values('run.privacy', 'open_dc.public_bodies', 'open_dc.public_bodies.detail', datetime('now'), datetime('now'), 'success')",
  ).run();
  workbench.db.prepare(
    "insert into source_artifacts(artifact_id, run_id, endpoint_id, kind, path, fetched_url, content_hash, size_bytes, created_at) values('artifact.privacy', 'run.privacy', 'open_dc.public_bodies.detail', 'page', 'open_dc/public-bodies/detail.html', 'https://www.open-dc.gov/public-bodies/board-accountancy', 'sha256:fixture', 100, datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into source_items(source_item_id, source_id, endpoint_id, run_id, artifact_id, item_key, item_type, title, body_json) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run([
    "item.private_contact",
    "open_dc.public_bodies",
    "open_dc.public_bodies.detail",
    "run.privacy",
    "artifact.privacy",
    "board-accountancy",
    "public_body_detail",
    "Board of Accountancy",
    JSON.stringify({
      email: "not-for-release@example.com",
      phone: "202-555-0100",
      contact_notes: "private contact metadata",
    }),
  ]);
  workbench.db.prepare(
    "insert into datasets(dataset_id, source_item_id, name, category, owner_name, access_method, artifact_depth, official_url, review_status) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run([
    "dataset.council.lims.whats_new",
    "item.private_contact",
    "Council LIMS What's New feed",
    "legislative",
    "Council of the District of Columbia",
    "official_json_api",
    "sample",
    "https://lims.dccouncil.gov/api/Search/GetWhatsNew",
    "pending",
  ]);
  workbench.db.prepare(
    "insert into legal_refs(legal_ref_id, source_item_id, ref_type, citation_text, normalized_citation, url, review_status) values(?, ?, ?, ?, ?, ?, ?)",
  ).run([
    "legal.open_dc.public_bodies.board_accountancy_authority",
    "item.private_contact",
    "dc_code",
    "D.C. Official Code § 47-2853.06(b)(1)",
    "D.C. Code 47-2853.06(b)(1)",
    "https://code.dccouncil.us/us/dc/council/code/sections/47-2853.06#(b)(1)",
    "pending",
  ]);
  const outDir = join(dir, "release");
  const staleFile = join(outDir, "stale-extra-report.csv");
  await ensureDir(outDir);
  await Deno.writeTextFile(staleFile, "stale");
  const result = await buildV2Release(workbench, outDir);
  const entityCsv = await Deno.readTextFile(join(outDir, "entities.csv"));
  const sourcesCsv = await Deno.readTextFile(join(outDir, "sources.csv"));
  const legalRefsCsv = await Deno.readTextFile(join(outDir, "legal_refs.csv"));
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  const manifestText = await Deno.readTextFile(join(outDir, "manifest.json"));
  const manifest = JSON.parse(manifestText);
  const releaseDb = new Database(join(outDir, "dcgov.sqlite"));
  const releaseObjects = releaseDb.prepare(
    "select name from sqlite_master where type in ('table', 'view') and name not like 'sqlite_%' order by name",
  ).all().map((row) => String((row as { name: string }).name));
  const releaseDbContactHits = releaseDb.prepare(
    "select count(*) as count from legal_refs where source_item_id like '%not-for-release%' or citation_text like '%not-for-release%'",
  ).get() as { count: number };
  const relationshipForeignKeys = releaseDb.prepare(
    "pragma foreign_key_list(relationships)",
  ).all();
  releaseDb.close();
  workbench.close();
  assertEquals(
    result.fileNames.sort(),
    [
      "README.md",
      "dcgov.sqlite",
      "datasets.csv",
      "datasets.json",
      "entities.csv",
      "entities.json",
      "legal_refs.csv",
      "legal_refs.json",
      "manifest.json",
      "relationships.csv",
      "relationships.json",
      "sources.csv",
      "sources.json",
    ].sort(),
  );
  assertStringIncludes(
    entityCsv.split("\n")[0],
    "id,name,kind,branch,cluster,official_url,review_status",
  );
  assert(!entityCsv.includes("source_item_id"));
  assert(!entityCsv.includes("not-for-release@example.com"));
  assert(!legalRefsCsv.includes("not-for-release@example.com"));
  assert(!manifestText.includes("not-for-release@example.com"));
  assert(!manifestText.includes("202-555-0100"));
  assertEquals(releaseDbContactHits.count, 0);
  await assertRejects(() => Deno.stat(staleFile), Deno.errors.NotFound);
  assertStringIncludes(readme, "DCGov v2 Release");
  assertStringIncludes(readme, "Relationship coverage note:");
  assertStringIncludes(sourcesCsv, "latest_endpoint_id,latest_artifact_kind,latest_fetched_url");
  assert(!sourcesCsv.includes("/tmp/"));
  assertStringIncludes(
    legalRefsCsv,
    "id,ref_type,citation_text,normalized_citation,url,source_id,source_item_id,source_url,needs_review,review_status",
  );
  assertEquals(Array.isArray(manifest.release_summary.entities_by_review_status), true);
  assertEquals(Array.isArray(manifest.source_artifacts), true);
  assertEquals(releaseObjects, [
    "datasets",
    "entities",
    "incoming_relationships",
    "legal_refs",
    "relationships",
    "sources",
  ]);
  assertEquals(relationshipForeignKeys.length, 2);
  const inspectOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
    ],
  }).output();
  const inspectText = new TextDecoder().decode(inspectOutput.stdout);
  assertEquals(inspectOutput.code, 0);
  assertStringIncludes(inspectText, "Files: 13");
  assertStringIncludes(inspectText, "Entities: accepted=2");
  assertStringIncludes(inspectText, "Relationships: accepted=1");
  const inspectJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
      "--json",
    ],
  }).output();
  const inspectJson = JSON.parse(new TextDecoder().decode(inspectJsonOutput.stdout)) as {
    outDir: string;
    fileCount: number;
    releaseSummary: { source_count: number };
  };
  assertEquals(inspectJsonOutput.code, 0);
  assertEquals(inspectJson.outDir, outDir);
  assertEquals(inspectJson.fileCount, 13);
  assertEquals(inspectJson.releaseSummary.source_count, 1);
  if (manifest.source_artifacts.length > 0) {
    assertEquals(Object.keys(manifest.source_artifacts[0]).includes("content_hash"), true);
    assertEquals(Object.keys(manifest.source_artifacts[0]).includes("path"), false);
  }
});

Deno.test("release builder rejects email-shaped contact info in release rows", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, official_url, review_status, merged_candidate_ids, created_at, updated_at) values('dc.contact_leak', 'Contact Leak', 'board', 'mailto:not-for-release@example.com', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await assertRejects(
    () => buildV2Release(workbench, join(dir, "release")),
    Error,
    "Release output contains email-shaped contact info",
  );
  workbench.close();
});

Deno.test("release builder rejects relationships with missing endpoint entities", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.source', 'Source Entity', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.exec("pragma foreign_keys = off");
  workbench.db.prepare(
    "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values('dc.source:part_of:dc.missing', 'dc.source', 'part_of', 'dc.missing', 'accepted', 'event.1', datetime('now'))",
  ).run();
  workbench.db.exec("pragma foreign_keys = on");

  await assertRejects(
    () => buildV2Release(workbench, join(dir, "release")),
    Error,
    "FOREIGN KEY constraint failed",
  );
  workbench.close();
});

Deno.test("release builder rejects phone-shaped contact info in release rows", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, official_url, review_status, merged_candidate_ids, created_at, updated_at) values('dc.phone_leak', 'Phone Leak', 'board', 'tel:202-555-0100', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await assertRejects(
    () => buildV2Release(workbench, join(dir, "release")),
    Error,
    "Release output contains phone-shaped contact info",
  );
  workbench.close();
});

Deno.test("release builder rejects local path-shaped info in release rows", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, official_url, review_status, merged_candidate_ids, created_at, updated_at) values('dc.path_leak', 'Path Leak', 'board', '/file%253A///C%253A/Users/source-user/Documents/Downloads/53207.pdf', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await assertRejects(
    () => buildV2Release(workbench, join(dir, "release")),
    Error,
    "Release output contains local path-shaped info",
  );
  workbench.close();
});

Deno.test("admin 311 connector fails safely for non-311 layer metadata", async () => {
  const result = await getConnector("admin.service_requests_311").run(
    createConnectorContext({
      fetcher: async () => ({
        status: 200,
        text: async () => admin311WrongLayerFixture,
        json: async <T>() => JSON.parse(admin311WrongLayerFixture) as T,
      }),
    }),
  );
  assertEquals(result.endpointResults[0].status, "failed");
  assertStringIncludes(
    result.endpointResults[0].errorText ?? "",
    "Expected 311 service-request layer",
  );
  assertEquals(result.endpointResults[0].parsed, undefined);
});

Deno.test("scripted review CLI accepts a candidate and entity show renders evidence and backlinks", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
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
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  workbench.close();
  const reviewRun = new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "--mode",
      "entities",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const reviewProcess = reviewRun.spawn();
  const writer = reviewProcess.stdin.getWriter();
  await writer.write(new TextEncoder().encode("a\na\nq\n"));
  await writer.close();
  const reviewOutput = await reviewProcess.output();
  const reviewText = new TextDecoder().decode(reviewOutput.stdout);
  assertStringIncludes(reviewText, "What needs review");
  assertStringIncludes(reviewText, "Why this matters");
  assertStringIncludes(reviewText, "Default action: accept (Enter or a)");
  assertStringIncludes(
    reviewText,
    "Available actions: Enter accept, a accept, r reject, m merge, d defer, q quit",
  );
  assertStringIncludes(reviewText, "evidence:");
  assertStringIncludes(reviewText, "name <- Board of Accountancy");
  assertStringIncludes(reviewText, "source: open_dc.public_bodies @");
  assertStringIncludes(reviewText, "Saved resolution.");
  const searchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
      "search",
      "accountancy",
      "--db",
      dbPath,
    ],
  }).output();
  assertStringIncludes(new TextDecoder().decode(searchOutput.stdout), "dc.board_of_accountancy");
  const searchJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
      "search",
      "accountancy",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const searchJson = JSON.parse(
    new TextDecoder().decode(searchJsonOutput.stdout),
  ) as Array<{ entityId: string; name: string }>;
  assertEquals(searchJsonOutput.code, 0);
  assertEquals(searchJson[0].entityId, "dc.board_of_accountancy");
  const showOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
      "show",
      "dc.board_of_accountancy",
      "--db",
      dbPath,
    ],
  }).output();
  const showText = new TextDecoder().decode(showOutput.stdout);
  assertStringIncludes(showText, "Board of Accountancy");
  assertStringIncludes(showText, "evidence:");
  assertStringIncludes(showText, "@");
  assertStringIncludes(showText, "legal_refs:");
  const showJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
      "show",
      "dc.board_of_accountancy",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const showJson = JSON.parse(new TextDecoder().decode(showJsonOutput.stdout)) as {
    entityId: string;
    evidence: Array<{ fieldPath: string }>;
    legalRefs: Array<{ refType: string }>;
  };
  assertEquals(showJsonOutput.code, 0);
  assertEquals(showJson.entityId, "dc.board_of_accountancy");
  assert(showJson.evidence.some((row) => row.fieldPath === "name"));
  assert(showJson.legalRefs.some((row) => row.refType === "dc_code"));
});

Deno.test("interactive review Enter accepts the default action", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return openDcIndexFixture;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 1 })),
    dataDir,
  );
  workbench.close();

  const reviewRun = new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "--mode",
      "entities",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const reviewProcess = reviewRun.spawn();
  const writer = reviewProcess.stdin.getWriter();
  await writer.write(new TextEncoder().encode("\nq\n"));
  await writer.close();
  const reviewOutput = await reviewProcess.output();
  const reviewText = new TextDecoder().decode(reviewOutput.stdout);
  assertEquals(reviewOutput.code, 0);
  assertStringIncludes(reviewText, "Default action: accept (Enter or a)");
  assertStringIncludes(reviewText, "Saved resolution.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const entities = reopened.canonicalEntities();
  reopened.close();
  assertEquals(entities.map((entity) => entity.id), ["dc.board_of_accountancy"]);
});

Deno.test("interactive review quit reports remaining work and resume command", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
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
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  workbench.close();

  const reviewRun = new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "--mode",
      "entities",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const reviewProcess = reviewRun.spawn();
  const writer = reviewProcess.stdin.getWriter();
  await writer.write(new TextEncoder().encode("q\n"));
  await writer.close();
  const reviewOutput = await reviewProcess.output();
  const reviewText = new TextDecoder().decode(reviewOutput.stdout);
  assertEquals(reviewOutput.code, 0);
  assertStringIncludes(
    reviewText,
    "Review stopped. 2 item(s) remain. Resume with dc review entities.",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const items = reopened.listReviewItems({ mode: "entities" });
  reopened.close();
  assertEquals(items.length, 2);
  assert(items.every((item) => item.status === "open"));
});

Deno.test("interactive relationship review quit reports filtered resume command", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
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
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 2 })),
    dataDir,
  );
  workbench.close();

  const reviewRun = new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "relationships",
      "--relationship-type",
      "governed_by",
      "--subject-prefix",
      "relationship.open_dc.public_bodies",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const reviewProcess = reviewRun.spawn();
  const writer = reviewProcess.stdin.getWriter();
  await writer.write(new TextEncoder().encode("q\n"));
  await writer.close();
  const reviewOutput = await reviewProcess.output();
  const reviewText = new TextDecoder().decode(reviewOutput.stdout);
  assertEquals(reviewOutput.code, 0);
  assertStringIncludes(
    reviewText,
    "Resume with dc review relationships --subject-prefix relationship.open_dc.public_bodies --relationship-type governed_by.",
  );
});

Deno.test("interactive review does not resurface a deferred item in the same session", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        if (url === "https://dc.gov/page/laws-regulations-and-courts") {
          return legalEntrypointsFixture;
        }
        throw new Error(`Unexpected url ${url}`);
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(result, dataDir);
  workbench.close();

  const reviewProcess = new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "legal",
      "--subject-prefix",
      "legal.legal.entrypoints.https_dcregs_dc_gov",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = reviewProcess.stdin.getWriter();
  await writer.write(new TextEncoder().encode("\n"));
  await writer.close();
  const output = await reviewProcess.output();
  const text = new TextDecoder().decode(output.stdout);
  assertEquals(output.code, 0);
  assertStringIncludes(text, "Default action: defer (Enter or d)");
  assertStringIncludes(text, "Saved resolution.");
  assertStringIncludes(text, "No review items remain.");
  assertEquals(text.match(/Review item:/g)?.length, 1);

  const reopened = new Workbench(dbPath);
  reopened.init();
  const deferred = reopened.listReviewItems({
    mode: "legal",
    status: "deferred",
    subjectPrefix: "legal.legal.entrypoints.https_dcregs_dc_gov",
  });
  reopened.close();
  assertEquals(deferred.length, 1);
});
