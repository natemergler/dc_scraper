import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { Database } from "@db/sqlite";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { buildV2Release } from "../src/v2/release.ts";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildKnownEntityRef } from "../src/v2/connectors/shared.ts";
import {
  buildEntityId,
  buildReviewItemId,
  type ConnectorResult,
  inverseRelationshipType,
  parseLegalReference,
} from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { importConnectorResult as importConnectorResultIntoStore } from "../src/v2/workbench/import.ts";
import {
  admin311Fixture,
  admin311WrongLayerFixture,
  adminBudgetPageFixture,
  adminProcurementPageFixture,
  ancListingFixture,
  ancProfile34gFixture,
  ancProfile6cFixture,
  arcgisLayerDetailFixture,
  arcgisServiceLayersFixture,
  begaAboutFixture,
  begaOgeFixture,
  begaOogFixture,
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
  councilMembersFixture,
  dcCourtOfAppealsFixture,
  dcCourtsHomeFixture,
  dcgisBoardsCommissionsCouncilsMetadataFixture,
  dcgisBoardsCommissionsCouncilsRowsFixture,
  dcgisMetadataFixture,
  dcgisRowsFixture,
  dcSuperiorCourtFixture,
  enterpriseDatasetInventoryMetadataFixture,
  enterpriseDatasetInventoryRowsPageOneFixture,
  enterpriseDatasetInventoryRowsPageTwoFixture,
  governmentOperationsCatalogFixture,
  legalEntrypointsFixture,
  limsFixture,
  openDcBoardFixture,
  openDcCommissionFixture,
  openDcIndexFixture,
  openDcStreetHarassmentFixture,
  openDcTaskForceFixture,
  quickbaseAppointmentsCsvFixture,
  quickbaseFixture,
} from "./helpers/v2_fixtures.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
  syntheticLegalRefSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("status, review list, and entity search stay usable during an external writer lock", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.district_test_board', 'District Test Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.locking.entities",
      candidateId: "candidate.test.locking.entities.example_board",
      sourceItemKey: "locking-board-row",
      proposedEntityId: "dc.example_locking_board",
      name: "Example Locking Board",
      kind: "board",
      observedName: "Example Locking Board",
      confidence: 0.4,
    }),
    dataDir,
  );
  workbench.close();

  const lockingDb = new Database(dbPath);
  lockingDb.exec("begin exclusive");
  try {
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
    assertStringIncludes(statusText, "Decisions: 0 open, 0 deferred");
    assertStringIncludes(statusText, "Browse: 1 source-backed row");

    const reviewListOutput = await new Deno.Command(Deno.execPath(), {
      cwd: Deno.cwd(),
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-ffi",
        "scripts/dc.ts",
        "review",
        "list",
        "--mode",
        "entities",
        "--db",
        dbPath,
        "--limit",
        "1",
      ],
    }).output();
    assertEquals(reviewListOutput.code, 0);
    const reviewListText = new TextDecoder().decode(reviewListOutput.stdout);
    assertStringIncludes(reviewListText, "Browse rows: 1");

    const entitySearchOutput = await new Deno.Command(Deno.execPath(), {
      cwd: Deno.cwd(),
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-ffi",
        "scripts/dc.ts",
        "entity",
        "search",
        "District",
        "--db",
        dbPath,
      ],
    }).output();
    assertEquals(entitySearchOutput.code, 0);
    const entitySearchText = new TextDecoder().decode(entitySearchOutput.stdout);
    assertStringIncludes(entitySearchText, "District Test Board");
  } finally {
    lockingDb.exec("rollback");
    lockingDb.close();
  }
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
  assertStringIncludes(statusText, "Schema version: 17");
  assertStringIncludes(statusText, "Sources: 0/");
  assertStringIncludes(statusText, "Decisions: 0 open, 0 deferred");
  assertStringIncludes(statusText, "Reconciliation: 0 blocked");
  assertStringIncludes(statusText, "Next: deno task dc -- source list");

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
    reconciliation: { blocked: number };
    nextCommand: string;
  };
  assertEquals(jsonStatus.schemaVersion, 17);
  assertEquals(jsonStatus.sources.fetched, 0);
  assertEquals(jsonStatus.review.open, 0);
  assertEquals(jsonStatus.reconciliation.blocked, 0);
  assertEquals(jsonStatus.nextCommand, "deno task dc -- source list");

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
  const topLevelHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "--help",
    ],
  }).output();
  const topLevelText = new TextDecoder().decode(topLevelHelp.stdout);
  assertEquals(topLevelHelp.code, 0);
  assertStringIncludes(topLevelText, "Workflow:");
  assertStringIncludes(topLevelText, "deno task dc -- source fetch --all");
  assertStringIncludes(topLevelText, "deno task dc -- audit");
  assertStringIncludes(topLevelText, "Browse:");
  assertStringIncludes(
    topLevelText,
    "deno task dc -- entity search accountancy | deno task dc -- review list --status all",
  );
  assertStringIncludes(
    topLevelText,
    "deno task dc -- review | deno task dc -- review packets --mode relationships",
  );

  const auditHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "audit",
      "--help",
    ],
  }).output();
  const auditText = new TextDecoder().decode(auditHelp.stdout);
  assertEquals(auditHelp.code, 0);
  assertStringIncludes(auditText, "Usage:");
  assertStringIncludes(auditText, "deno task dc -- audit [--db <path>] [--json]");
  assert(!auditText.includes("audit status"));
  assert(!auditText.includes("doctor"));
  assert(!auditText.includes("DB: "));

  const statusHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--help",
    ],
  }).output();
  const statusHelpText = new TextDecoder().decode(statusHelp.stdout);
  assertEquals(statusHelp.code, 0);
  assertStringIncludes(
    statusHelpText,
    "deno task dc -- status [--db <path>] [--json]",
  );
  assert(!statusHelpText.includes("audit status"));
  assert(!statusHelpText.includes("DB: "));

  const auditStatusHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "audit",
      "status",
      "--help",
    ],
    stderr: "piped",
  }).output();
  const auditStatusHelpError = new TextDecoder().decode(auditStatusHelp.stderr);
  assertEquals(auditStatusHelp.code, 2);
  assertStringIncludes(auditStatusHelpError, "Unknown command: audit status --help");

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
  assertStringIncludes(sourceText, "Workflow:");
  assertStringIncludes(sourceText, "deno task dc -- source list");
  assertStringIncludes(sourceText, "deno task dc -- source fetch <source-id>");
  assertStringIncludes(sourceText, "deno task dc -- source fetch --all");
  assertStringIncludes(sourceText, "deno task dc -- source inspect <source-id>");

  const workbenchHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "workbench",
      "--help",
    ],
  }).output();
  const workbenchHelpText = new TextDecoder().decode(workbenchHelp.stdout);
  assertEquals(workbenchHelp.code, 0);
  assertStringIncludes(workbenchHelpText, "deno task dc -- workbench");
  assertStringIncludes(workbenchHelpText, "deno task dc -- init [--db <path>]");
  assertStringIncludes(workbenchHelpText, "deno task dc -- status [--db <path>] [--json]");

  const initHelpDb = join(await Deno.makeTempDir(), "workbench.sqlite");
  const initHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "init",
      "--help",
      "--db",
      initHelpDb,
    ],
  }).output();
  const initHelpText = new TextDecoder().decode(initHelp.stdout);
  assertEquals(initHelp.code, 0);
  assertStringIncludes(initHelpText, "deno task dc -- workbench");
  assert(!initHelpText.includes("Initialized v2 workbench"));

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
  assertStringIncludes(reviewText, "Workflow:");
  assertStringIncludes(reviewText, "Run `deno task dc -- status` or `deno task dc -- audit`");
  assertStringIncludes(reviewText, "Browse source-backed rows");
  assertStringIncludes(reviewText, "review list --decisions");
  assertStringIncludes(reviewText, "Inspect grouped decision work");
  assertStringIncludes(
    reviewText,
    "Run `deno task dc -- review` when the slice needs a human decision",
  );
  assertStringIncludes(reviewText, "Usage:");
  assertStringIncludes(reviewText, "--include-review-item-ids");
  assertStringIncludes(
    reviewText,
    "deno task dc -- review [entities|relationships|legal|sources]",
  );
  assertStringIncludes(reviewText, "deno task dc -- review list");
  assertStringIncludes(reviewText, "Advanced maintenance:");
  const reviewWorkflowText = reviewText.slice(
    reviewText.indexOf("Workflow:"),
    reviewText.indexOf("Usage:"),
  );
  assert(!reviewWorkflowText.includes("review batch"));
  assert(!reviewText.includes("No review items remain."));

  const reviewModeHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "relationships",
      "--help",
    ],
  }).output();
  const reviewModeText = new TextDecoder().decode(reviewModeHelp.stdout);
  assertEquals(reviewModeHelp.code, 0);
  assertStringIncludes(
    reviewModeText,
    "deno task dc -- review [entities|relationships|legal|sources]",
  );
  const reviewModeWorkflowText = reviewModeText.slice(
    reviewModeText.indexOf("Workflow:"),
    reviewModeText.indexOf("Usage:"),
  );
  assert(!reviewModeWorkflowText.includes("review batch"));
  assertStringIncludes(reviewModeText, "deno task dc -- review batch accept-safe");
  assert(!reviewModeText.includes("No review items remain."));

  const reviewBatchHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "--help",
    ],
  }).output();
  const reviewBatchText = new TextDecoder().decode(reviewBatchHelp.stdout);
  assertEquals(reviewBatchHelp.code, 0);
  assertStringIncludes(reviewBatchText, "Workflow:");
  assertStringIncludes(
    reviewBatchText,
    "deno task dc -- review batch accept-safe --mode entities",
  );
  assertStringIncludes(
    reviewBatchText,
    "deno task dc -- review batch defer-default --mode relationships",
  );

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
  assertStringIncludes(entityText, "Workflow:");
  assertStringIncludes(entityText, "deno task dc -- entity search <query>");
  assertStringIncludes(entityText, "deno task dc -- entity show <entity-id>");

  const entityBare = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
    ],
  }).output();
  const entityBareText = new TextDecoder().decode(entityBare.stdout);
  assertEquals(entityBare.code, 0);
  assertStringIncludes(entityBareText, "deno task dc -- entity");
  assertStringIncludes(entityBareText, "deno task dc -- entity search <query>");

  const entitySearchHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
      "search",
      "--help",
    ],
  }).output();
  const entitySearchHelpText = new TextDecoder().decode(entitySearchHelp.stdout);
  assertEquals(entitySearchHelp.code, 0);
  assertStringIncludes(entitySearchHelpText, "deno task dc -- entity search <query>");
  assert(!entitySearchHelpText.includes("[]"));

  const entityShowHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
      "show",
      "--help",
    ],
  }).output();
  const entityShowHelpText = new TextDecoder().decode(entityShowHelp.stdout);
  assertEquals(entityShowHelp.code, 0);
  assertStringIncludes(entityShowHelpText, "deno task dc -- entity show <entity-id>");

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
  assertStringIncludes(releaseText, "Workflow:");
  assertStringIncludes(releaseText, "Usage:");
  assertStringIncludes(releaseText, "deno task dc -- release build");
  assertStringIncludes(releaseText, "deno task dc -- release inspect");
  assertEquals(releaseError, "");

  const releaseBare = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
    ],
  }).output();
  const releaseBareText = new TextDecoder().decode(releaseBare.stdout);
  assertEquals(releaseBare.code, 0);
  assertStringIncludes(releaseBareText, "deno task dc -- release");
  assertStringIncludes(releaseBareText, "deno task dc -- release build");

  const releaseBuildHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "build",
      "--help",
    ],
  }).output();
  const releaseBuildHelpText = new TextDecoder().decode(releaseBuildHelp.stdout);
  assertEquals(releaseBuildHelp.code, 0);
  assertStringIncludes(releaseBuildHelpText, "deno task dc -- release build");
  assertStringIncludes(releaseBuildHelpText, "deno task dc -- release inspect");
  assertStringIncludes(releaseBuildHelpText, "Verify package readiness and provenance");
  assert(!releaseBuildHelpText.includes("current workbench readiness"));
  assert(!releaseBuildHelpText.includes("Built release"));

  const releaseInspectHelp = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--help",
    ],
  }).output();
  const releaseInspectHelpText = new TextDecoder().decode(releaseInspectHelp.stdout);
  assertEquals(releaseInspectHelp.code, 0);
  assertStringIncludes(releaseInspectHelpText, "deno task dc -- release inspect");
  assert(!releaseInspectHelpText.includes("Release: "));
});

Deno.test("source prefix commands guide the operator toward the next fetch action", async () => {
  const sourceOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
    ],
  }).output();
  const sourceText = new TextDecoder().decode(sourceOutput.stdout);
  assertEquals(sourceOutput.code, 0);
  assertStringIncludes(sourceText, "deno task dc -- source");
  assertStringIncludes(sourceText, "Available sources:");
  assertStringIncludes(sourceText, "dcgis.agencies");
  assertStringIncludes(sourceText, "Tip: run `deno task dc -- source list`");
  assertStringIncludes(sourceText, "to fetch every configured source into this workbench");
  assert(!sourceText.includes("full smoke"));

  const compareOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "compare",
    ],
  }).output();
  const compareText = new TextDecoder().decode(compareOutput.stdout);
  assertEquals(compareOutput.code, 0);
  assertStringIncludes(compareText, "deno task dc -- source compare public-bodies");
  assertStringIncludes(
    compareText,
    "Tip: run `deno task dc -- source compare public-bodies`",
  );

  const fetchOutput = await new Deno.Command(Deno.execPath(), {
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
    ],
  }).output();
  const fetchText = new TextDecoder().decode(fetchOutput.stdout);
  assertEquals(fetchOutput.code, 0);
  assertStringIncludes(fetchText, "deno task dc -- source fetch <source-id>");
  assertStringIncludes(fetchText, "deno task dc -- source fetch --all");
  assertStringIncludes(fetchText, "Tip: run `deno task dc -- source fetch --all`");
  assertStringIncludes(fetchText, "to fetch every configured source into this workbench");
  assert(!fetchText.includes("full smoke"));
  assertStringIncludes(fetchText, "deno task dc -- source list");

  const listHelpOutput = await new Deno.Command(Deno.execPath(), {
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
      "--help",
    ],
  }).output();
  const listHelpText = new TextDecoder().decode(listHelpOutput.stdout);
  assertEquals(listHelpOutput.code, 0);
  assertStringIncludes(listHelpText, "deno task dc -- source list");
  assert(!listHelpText.includes("unfetched"));
});

Deno.test("review prefix commands guide the operator toward the next safe review action", async () => {
  const batchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
    ],
  }).output();
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertEquals(batchOutput.code, 0);
  assertStringIncludes(batchText, "deno task dc -- review batch");
  assertStringIncludes(batchText, "deno task dc -- review packets");
  assertStringIncludes(batchText, "deno task dc -- review list");
  assertStringIncludes(
    batchText,
    "deno task dc -- review batch accept-safe --mode entities",
  );

  const batchFlagOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "--db",
      join(Deno.cwd(), "data", "workbench.sqlite"),
    ],
  }).output();
  const batchFlagText = new TextDecoder().decode(batchFlagOutput.stdout);
  assertEquals(batchFlagOutput.code, 0);
  assertStringIncludes(batchFlagText, "deno task dc -- review batch");
  assertStringIncludes(batchFlagText, "deno task dc -- review packets");

  const acceptSafeOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "batch",
      "accept-safe",
    ],
  }).output();
  const acceptSafeText = new TextDecoder().decode(acceptSafeOutput.stdout);
  assertEquals(acceptSafeOutput.code, 0);
  assertStringIncludes(acceptSafeText, "deno task dc -- review batch accept-safe");
  assertStringIncludes(acceptSafeText, "--mode entities");
  assertStringIncludes(acceptSafeText, "Tip: choose a narrow slice");
});

Deno.test("entity prefix commands guide the operator toward the next lookup action", async () => {
  const entityOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
    ],
  }).output();
  const entityText = new TextDecoder().decode(entityOutput.stdout);
  assertEquals(entityOutput.code, 0);
  assertStringIncludes(entityText, "deno task dc -- entity");
  assertStringIncludes(entityText, "deno task dc -- entity search");
  assertStringIncludes(entityText, "deno task dc -- entity show");

  const searchOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "entity",
      "search",
    ],
  }).output();
  const searchText = new TextDecoder().decode(searchOutput.stdout);
  assertEquals(searchOutput.code, 0);
  assertStringIncludes(searchText, "deno task dc -- entity search <query>");
  assertStringIncludes(searchText, "Tip: run `deno task dc -- entity search District`");
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
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=2&f=json",
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
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer?f=json",
      JSON.stringify(governmentOperationsCatalogFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5?f=json",
      JSON.stringify(enterpriseDatasetInventoryMetadataFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=2&f=json",
      JSON.stringify(enterpriseDatasetInventoryRowsPageOneFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=2&resultRecordCount=2&f=json",
      JSON.stringify(enterpriseDatasetInventoryRowsPageTwoFixture),
    ],
    ["https://www.dccourts.gov/", dcCourtsHomeFixture],
    ["https://www.dccourts.gov/court-of-appeals", dcCourtOfAppealsFixture],
    ["https://www.dccourts.gov/superior-court", dcSuperiorCourtFixture],
    ["https://bega.dc.gov/node/61616/", begaAboutFixture],
    ["https://bega.dc.gov/page/office-government-ethics", begaOgeFixture],
    ["https://www.open-dc.gov/office-open-government", begaOogFixture],
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
      "admin.enterprise_dataset_inventory",
      "dccourts.structure",
      "bega.structure",
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
  const enterpriseInventory = workbench.sourceSummary("admin.enterprise_dataset_inventory");
  const courtsSummary = workbench.sourceSummary("dccourts.structure");
  const begaSummary = workbench.sourceSummary("bega.structure");
  const permitSummary = workbench.sourceSummary("admin.permits_licenses");
  const categories = new Set(workbench.datasets().map((dataset) => dataset.category));
  const hasRegisterRef = workbench.legalRefs().some((ref) => ref.ref_type === "dc_register");
  workbench.close();
  assertEquals(dcgis.fieldCount, 7);
  assertEquals(dcgis.entityCandidateCount, 2);
  assertEquals(dcgis.relationshipCandidateCount, 0);
  assertEquals(quickbase.latestStatus, "success");
  assertStringIncludes(quickbase.latestArtifactPath ?? "", "mota.quickbase");
  assertEquals(quickbase.itemCount > 0, true);
  assertEquals(quickbase.entityCandidateCount > 0, true);
  assertEquals(quickbase.relationshipCandidateCount > 0, true);
  assertEquals(enterpriseInventory.itemCount, 10);
  assertEquals(enterpriseInventory.fieldCount, 9);
  assertEquals(courtsSummary.itemCount, 3);
  assertEquals(courtsSummary.entityCandidateCount, 12);
  assertEquals(courtsSummary.relationshipCandidateCount, 11);
  assertEquals(begaSummary.itemCount, 3);
  assertEquals(begaSummary.entityCandidateCount, 3);
  assertEquals(begaSummary.relationshipCandidateCount, 2);
  assertEquals(hasRegisterRef, true);
  assertEquals(permitSummary.fieldCount > 0, true);
  assertEquals(categories.has("procurement"), true);
  assertEquals(categories.has("budget"), true);
  assertEquals(categories.has("crime_incidents"), true);
  assertEquals(categories.has("public_services"), true);
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

Deno.test("Open DC second detail-page shape yields administered relationship, legal ref, and document links", async () => {
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
  assertEquals(
    detail.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "authorized_by"
    ),
    false,
  );
  assert(
    detail.legalRefs?.some((legalRef) =>
      legalRef.legalRefId ===
        "legal.open_dc.public_bodies.commission_on_example_services_authority" &&
      legalRef.attachEntityRef === "dc.commission_on_example_services" &&
      legalRef.attachRelationshipRef === undefined
    ),
  );
});

Deno.test("Open DC keeps non-legal authority text as source evidence instead of legal ref work", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/apple-tree-early-learning-pcs">Apple Tree Early Learning PCS</a>
            <a href="/public-bodies/working-group-jobs-wages-and-benefits">Working Group on Jobs, Wages and Benefits</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/apple-tree-early-learning-pcs":
          return `<html><body>
            <h1 class="page-title">Apple Tree Early Learning PCS</h1>
            <div class="field field-name-field-enabling-statute-mayoral-order field-type-text field-label-inline clearfix">
              <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
              <div class="field-items"><div class="field-item even"><a href="https://www.appletreeinstitute.org/">N/A</a></div></div>
            </div>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/working-group-jobs-wages-and-benefits":
          return `<html><body>
            <h1 class="page-title">Working Group on Jobs, Wages and Benefits</h1>
            <div class="field field-name-field-enabling-statute-mayoral-order field-type-text field-label-inline clearfix">
              <div class="field-label">Enabling Statute / Mayoral Order:&nbsp;</div>
              <div class="field-items"><div class="field-item even">MO 2016-083</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assertEquals(
    detail.items?.find((item) => item.itemKey === "apple-tree-early-learning-pcs")?.body
      .enablingAuthority,
    "N/A",
  );
  assertEquals(
    detail.legalRefs?.map((legalRef) => ({
      legalRefId: legalRef.legalRefId,
      citationText: legalRef.citationText,
      normalizedCitation: legalRef.normalizedCitation,
      refType: legalRef.refType,
    })),
    [{
      legalRefId: "legal.open_dc.public_bodies.working_group_jobs_wages_and_benefits_authority",
      citationText: "MO 2016-083",
      normalizedCitation: "Mayor's Order 2016-083",
      refType: "mayors_order",
    }],
  );
});

Deno.test("Open DC fetch includes priority Council oversight endpoint pages beyond an explicit limit", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/board-accountancy">Board of Accountancy</a>
            <a href="/public-bodies/advisory-committee-street-harassment">Advisory Committee on Street Harassment</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/advisory-committee-street-harassment":
          return openDcStreetHarassmentFixture;
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
    detail.entityCandidates?.some((candidate) =>
      candidate.candidateId ===
        "candidate.open_dc.public_bodies.advisory_committee_street_harassment"
    ),
  );
  assert(
    detail.relationshipCandidates?.some((candidate) =>
      candidate.rawValue === "Office of Human Rights" &&
      candidate.toEntityRef === "dc.office_of_human_rights"
    ),
  );
});

Deno.test("Open DC default fetch reaches every canonical detail page", async () => {
  const slugs = Array.from({ length: 20 }, (_, index) => `body-${index + 1}`);
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      if (url === "https://www.open-dc.gov/public-bodies") {
        return `<html><body>${
          slugs.map((slug, index) => `<a href="/public-bodies/${slug}">Body ${index + 1}</a>`).join(
            "",
          )
        }</body></html>`;
      }
      const slug = url.split("/").pop();
      if (slug && slugs.includes(slug)) {
        const name = slug.replace("body-", "Body ");
        return `<html><body><h1 class="page-title">${name}</h1></body></html>`;
      }
      throw new Error(`Unexpected url ${url}`);
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  assertEquals(result.endpointResults[1].artifacts.length, 20);
});

Deno.test("Open DC default fetch keeps all canonical detail pages and prefers cleaner duplicate slugs", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/board-accountancy-0">Board of Accountancy</a>
            <a href="/public-bodies/board-accountancy">Board of Accountancy</a>
            <a href="/public-bodies/adult-career-pathways-task-force">Adult Career Pathways Task Force</a>
          </body></html>`;
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
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  assertEquals(result.endpointResults[1].artifacts.length, 2);
  assertEquals(
    result.endpointResults[1].artifacts.map((item) => item.fetchedUrl),
    [
      "https://www.open-dc.gov/public-bodies/board-accountancy",
      "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force",
    ],
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assertEquals(detail.entityCandidates?.length, 2);
  assert(
    detail.entityCandidates?.some((candidate) =>
      candidate.candidateId === "candidate.open_dc.public_bodies.board_accountancy" &&
      candidate.officialUrl === "https://www.open-dc.gov/public-bodies/board-accountancy"
    ),
  );
  assert(
    detail.entityCandidates?.some((candidate) =>
      candidate.candidateId ===
        "candidate.open_dc.public_bodies.adult_career_pathways_task_force"
    ),
  );
});

Deno.test("Open DC acronym parentheticals reuse the base public-body identity", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/juvenile-justice-advisory-group-jjag">Juvenile Justice Advisory Group (JJAG)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/juvenile-justice-advisory-group-jjag":
          return `<html><body><h1 class="page-title">Juvenile Justice Advisory Group (JJAG)</h1></body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assertEquals(detail.entityCandidates?.[0]?.name, "Juvenile Justice Advisory Group");
  assertEquals(
    detail.entityCandidates?.[0]?.proposedEntityId,
    "dc.juvenile_justice_advisory_group",
  );
});

Deno.test("Open DC acronym parentheticals still honor known entity aliases", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/public-charter-school-board-pcsb">Public Charter School Board (PCSB)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/public-charter-school-board-pcsb":
          return `<html><body><h1 class="page-title">Public Charter School Board (PCSB)</h1></body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assertEquals(detail.entityCandidates?.[0]?.name, "Public Charter School Board");
  assertEquals(
    detail.entityCandidates?.[0]?.proposedEntityId,
    "dc.public_charter_school_board_pcsb",
  );
});

Deno.test("Open DC known alias parentheticals reuse the accepted full-label identity", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc">Washington D.C. Convention and Tourism Corporation (Destination DC)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc":
          return `<html><body><h1 class="page-title">Washington D.C. Convention and Tourism Corporation (Destination DC)</h1></body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assertEquals(
    detail.entityCandidates?.[0]?.name,
    "Washington D.C. Convention and Tourism Corporation (Destination DC)",
  );
  assertEquals(
    detail.entityCandidates?.[0]?.proposedEntityId,
    "dc.washington_d_c_convention_and_tourism_corporation",
  );
});

Deno.test("Open DC default bounded fetch prioritizes resolvable alias pages over generic early rows", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/board-accountancy">Board of Accountancy</a>
            <a href="/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc">Washington D.C. Convention and Tourism Corporation (Destination DC)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc":
          return `<html><body><h1 class="page-title">Washington D.C. Convention and Tourism Corporation (Destination DC)</h1></body></html>`;
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
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher, limit: 1 }),
  );
  assertEquals(
    result.endpointResults[1].artifacts.map((item) => item.fetchedUrl),
    [
      "https://www.open-dc.gov/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc",
    ],
  );
  const detail = result.endpointResults[1].parsed;
  assert(detail);
  assertEquals(
    detail.entityCandidates?.[0]?.name,
    "Washington D.C. Convention and Tourism Corporation (Destination DC)",
  );
  assertEquals(
    detail.entityCandidates?.[0]?.proposedEntityId,
    "dc.washington_d_c_convention_and_tourism_corporation",
  );
});

Deno.test("Open DC default bounded fetch does not boost acronym-only pages ahead of generic early rows", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/board-accountancy">Board of Accountancy</a>
            <a href="/public-bodies/district-columbia-taxicab-commission-dctc">District of Columbia Taxicab Commission (DCTC)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/board-accountancy":
          return openDcBoardFixture;
        case "https://www.open-dc.gov/public-bodies/district-columbia-taxicab-commission-dctc":
          return `<html><body><h1 class="page-title">District of Columbia Taxicab Commission (DCTC)</h1></body></html>`;
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
  assertEquals(
    result.endpointResults[1].artifacts.map((item) => item.fetchedUrl),
    [
      "https://www.open-dc.gov/public-bodies/board-accountancy",
    ],
  );
});

Deno.test("Open DC known alias refinements fill official URLs on existing full-label entities", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "council.committees",
      candidateId:
        "candidate.mota.quickbase.washington_d_c_convention_and_tourism_corporation_destination_dc",
      sourceItemKey: "quickbase-washington-dc-convention-and-tourism-corporation-destination-dc",
      proposedEntityId: "dc.washington_d_c_convention_and_tourism_corporation",
      name: "Washington D.C. Convention and Tourism Corporation (Destination DC)",
      kind: "public_body",
      observedName: "Washington D.C. Convention and Tourism Corporation (Destination DC)",
      confidence: 0.95,
    }),
    dataDir,
  );

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc">Washington D.C. Convention and Tourism Corporation (Destination DC)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc":
          return `<html><body><h1 class="page-title">Washington D.C. Convention and Tourism Corporation (Destination DC)</h1></body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  await workbench.importConnectorResult(result, dataDir);

  const canonical = workbench.db.prepare(
    `select name,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.washington_d_c_convention_and_tourism_corporation'`,
  ).get() as {
    name: string;
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const splitCanonical = workbench.db.prepare(
    `select count(*) as count
     from canonical_entities
     where entity_id = 'dc.destination_dc'`,
  ).get() as { count: number };
  const openReview = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix:
      "candidate.open_dc.public_bodies.washington_dc_convention_and_tourism_corporation_destination_dc",
  });
  workbench.close();

  assertEquals(
    canonical.name,
    "Washington D.C. Convention and Tourism Corporation (Destination DC)",
  );
  assertEquals(
    canonical.officialUrl,
    "https://www.open-dc.gov/public-bodies/washington-dc-convention-and-tourism-corporation-destination-dc",
  );
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [
    "candidate.mota.quickbase.washington_d_c_convention_and_tourism_corporation_destination_dc",
    "candidate.open_dc.public_bodies.washington_dc_convention_and_tourism_corporation_destination_dc",
  ]);
  assertEquals(splitCanonical.count, 0);
  assertEquals(openReview.length, 0);
});

Deno.test("Open DC non-acronym parenthetical refinements reuse accepted-style public-body identity", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "mota.quickbase",
      candidateId: "candidate.mota.quickbase.commission_for_national_and_community_service",
      sourceItemKey: "quickbase-commission-for-national-and-community-service",
      proposedEntityId: "dc.commission_for_national_and_community_service",
      name: "Commission for National and Community Service (Serve DC)",
      kind: "public_body",
      observedName: "Commission for National and Community Service (Serve DC)",
      confidence: 0.95,
    }),
    dataDir,
  );

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body>
            <a href="/public-bodies/commission-national-and-community-service-serve-dc">Commission for National and Community Service (Serve DC)</a>
          </body></html>`;
        case "https://www.open-dc.gov/public-bodies/commission-national-and-community-service-serve-dc":
          return `<html><body>
            <h1 class="page-title">Commission for National and Community Service (Serve DC)</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">ServeDC</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("open_dc.public_bodies").run(
    createConnectorContext({ fetcher }),
  );
  await workbench.importConnectorResult(result, dataDir);

  const canonical = workbench.db.prepare(
    `select name,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.commission_for_national_and_community_service'`,
  ).get() as {
    name: string;
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const splitCanonical = workbench.db.prepare(
    `select count(*) as count
     from canonical_entities
     where entity_id = 'dc.commission_for_national_and_community_service_serve_dc'`,
  ).get() as { count: number };
  const selfAliasRelationship = workbench.db.prepare(
    `select count(*) as count
     from relationship_candidates
     where raw_value = 'ServeDC'`,
  ).get() as { count: number };
  const openReview = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix:
      "candidate.open_dc.public_bodies.commission_national_and_community_service_serve_dc",
  });
  workbench.close();

  assertEquals(canonical.name, "Commission for National and Community Service (Serve DC)");
  assertEquals(
    canonical.officialUrl,
    "https://www.open-dc.gov/public-bodies/commission-national-and-community-service-serve-dc",
  );
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [
    "candidate.mota.quickbase.commission_for_national_and_community_service",
    "candidate.open_dc.public_bodies.commission_national_and_community_service_serve_dc",
  ]);
  assertEquals(splitCanonical.count, 0);
  assertEquals(selfAliasRelationship.count, 0);
  assertEquals(openReview.length, 0);
});

Deno.test("Open DC long-form citizen review panel detail reuses the accepted short-form alias identity", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "open_dc.public_bodies",
      candidateId: "candidate.open_dc.public_bodies.citizen_review_panel_child_abuse_and_neglect",
      sourceItemKey: "open-dc-citizen-review-panel-child-abuse-and-neglect",
      proposedEntityId: buildKnownEntityRef("Citizen Review Panel for Child Abuse and Neglect"),
      name: "Citizen Review Panel for Child Abuse and Neglect",
      kind: "public_body",
      officialUrl:
        "https://www.open-dc.gov/public-bodies/citizen-review-panel-child-abuse-and-neglect",
      observedName: "Citizen Review Panel for Child Abuse and Neglect",
      confidence: 0.92,
    }),
    dataDir,
  );

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "council.committees",
      candidateId: "candidate.council.committees.citizen_review_panel_on_child_abuse_and_neglect",
      sourceItemKey: "council-citizen-review-panel-oversight-endpoint",
      proposedEntityId: buildKnownEntityRef("Citizen Review Panel on Child Abuse and Neglect"),
      name: "Citizen Review Panel on Child Abuse and Neglect",
      kind: "public_body",
      observedName: "Citizen Review Panel on Child Abuse and Neglect",
      confidence: 0.95,
    }),
    dataDir,
  );

  const canonical = workbench.db.prepare(
    `select entity_id as entityId,
            name,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.citizen_review_panel_for_child_abuse_and_neglect'`,
  ).get() as {
    entityId: string;
    name: string;
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const splitCanonical = workbench.db.prepare(
    `select count(*) as count
     from canonical_entities
     where entity_id = 'dc.citizen_review_panel_on_child_abuse_and_neglect'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(canonical.entityId, "dc.citizen_review_panel_for_child_abuse_and_neglect");
  assertEquals(
    canonical.officialUrl,
    "https://www.open-dc.gov/public-bodies/citizen-review-panel-child-abuse-and-neglect",
  );
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [
    "candidate.open_dc.public_bodies.citizen_review_panel_child_abuse_and_neglect",
    "candidate.council.committees.citizen_review_panel_on_child_abuse_and_neglect",
  ]);
  assertEquals(splitCanonical.count, 0);
});

Deno.test("Open DC long-form sentencing commission detail absorbs later short-form public-body aliases", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "open_dc.public_bodies",
      candidateId: "candidate.open_dc.public_bodies.district_columbia_sentencing_commission",
      sourceItemKey: "open-dc-district-columbia-sentencing-commission",
      proposedEntityId: buildKnownEntityRef("District of Columbia Sentencing Commission"),
      name: "District of Columbia Sentencing Commission",
      kind: "commission",
      officialUrl: "https://www.open-dc.gov/public-bodies/district-columbia-sentencing-commission",
      observedName: "District of Columbia Sentencing Commission",
      confidence: 0.92,
    }),
    dataDir,
  );

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "mota.quickbase",
      candidateId: "candidate.mota.quickbase.sentencing_commission",
      sourceItemKey: "quickbase-sentencing-commission",
      proposedEntityId: buildKnownEntityRef("Sentencing Commission"),
      name: "Sentencing Commission",
      kind: "public_body",
      observedName: "Sentencing Commission",
      confidence: 0.95,
    }),
    dataDir,
  );

  const canonical = workbench.db.prepare(
    `select entity_id as entityId,
            name,
            kind,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.district_of_columbia_sentencing_commission'`,
  ).get() as {
    entityId: string;
    name: string;
    kind: string;
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const splitCanonical = workbench.db.prepare(
    `select count(*) as count
     from canonical_entities
     where entity_id = 'dc.sentencing_commission'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(canonical.entityId, "dc.district_of_columbia_sentencing_commission");
  assertEquals(canonical.kind, "commission");
  assertEquals(
    canonical.officialUrl,
    "https://www.open-dc.gov/public-bodies/district-columbia-sentencing-commission",
  );
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [
    "candidate.open_dc.public_bodies.district_columbia_sentencing_commission",
    "candidate.mota.quickbase.sentencing_commission",
  ]);
  assertEquals(splitCanonical.count, 0);
});

Deno.test("Open DC keeps taxonomy-only agency labels as evidence instead of relationship endpoints", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body><a href="/public-bodies/board-elections">Board of Elections</a></body></html>`;
        case "https://www.open-dc.gov/public-bodies/board-elections":
          return `<html><body>
            <h1 class="page-title">Board of Elections</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">Independent Agency</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  const result = await getConnector("open_dc.public_bodies").run(createConnectorContext({
    fetcher,
  }));
  const detail = result.endpointResults[1].parsed;
  assertEquals(detail?.relationshipCandidates?.length ?? 0, 0);
  assertEquals(detail?.items?.[0]?.body.governingAgency, "Independent Agency");
});

Deno.test("Open DC surfaces suspicious agency labels as source review work", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body><a href="/public-bodies/common-lottery-board">Common Lottery Board</a></body></html>`;
        case "https://www.open-dc.gov/public-bodies/common-lottery-board":
          return `<html><body>
            <h1 class="page-title">Common Lottery Board</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">Department of Eduaction</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  const result = await getConnector("open_dc.public_bodies").run(createConnectorContext({
    fetcher,
  }));
  const detail = result.endpointResults[1].parsed;
  assertEquals(detail?.relationshipCandidates?.length ?? 0, 0);
  const sourceReview = detail?.reviewItems?.find((item) => item.itemType === "source_status");
  assert(sourceReview);
  assertEquals(sourceReview.subjectId, "open_dc.public_bodies");
  assertEquals(sourceReview.defaultAction, "defer");
  assertEquals(sourceReview.details.needsReview, true);
  assertEquals(sourceReview.details.rawValue, "Department of Eduaction");
  assertEquals(sourceReview.details.fieldPath, "governingAgency");
});

Deno.test("Open DC refetch removes stale suspicious agency source review work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const connector = getConnector("open_dc.public_bodies");
  const fetcherForAgencyLabel = (agencyLabel: string) => async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body><a href="/public-bodies/common-lottery-board">Common Lottery Board</a></body></html>`;
        case "https://www.open-dc.gov/public-bodies/common-lottery-board":
          return `<html><body>
            <h1 class="page-title">Common Lottery Board</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">${agencyLabel}</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await connector.run(createConnectorContext({
      fetcher: fetcherForAgencyLabel("Department of Eduaction"),
    })),
    dataDir,
  );

  const firstReviewCount = workbench.db.prepare(
    `select count(*) as count
     from review_items
     where item_type = 'source_status'
       and json_extract(details_json, '$.rawValue') = 'Department of Eduaction'`,
  ).get() as { count: number };
  assertEquals(firstReviewCount.count, 1);

  await workbench.importConnectorResult(
    await connector.run(createConnectorContext({
      fetcher: fetcherForAgencyLabel("Independent Agency"),
    })),
    dataDir,
  );

  const staleReviewCount = workbench.db.prepare(
    `select count(*) as count
     from review_items
     where item_type = 'source_status'
       and json_extract(details_json, '$.rawValue') = 'Department of Eduaction'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(staleReviewCount.count, 0);
});

Deno.test("Open DC governing agency labels can resolve qualified deputy mayor aliases", async () => {
  const indexFixture = `
  <html><body>
    <a href="/public-bodies/juvenile-abscondence-review-committee">Juvenile Abscondence Review Committee</a>
  </body></html>
  `;
  const detailFixture = `
  <html><body>
    <h1 class="page-title">Juvenile Abscondence Review Committee</h1>
    <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
      <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
      <div class="field-items"><div class="field-item even">Deputy Mayor for Public Safety and Justice/Operations (DMPSJ/O)</div></div>
    </div>
  </body></html>
  `;
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return indexFixture;
        case "https://www.open-dc.gov/public-bodies/juvenile-abscondence-review-committee":
          return detailFixture;
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
    detail.relationshipCandidates?.some((candidate) =>
      candidate.rawValue === "Deputy Mayor for Public Safety and Justice/Operations (DMPSJ/O)" &&
      candidate.toEntityRef === "dc.office_of_the_deputy_mayor_for_public_safety_and_justice"
    ),
  );
});

Deno.test("DC Courts connector captures the root courts structure and direct Superior Court divisions only", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.dccourts.gov/":
          return dcCourtsHomeFixture;
        case "https://www.dccourts.gov/court-of-appeals":
          return dcCourtOfAppealsFixture;
        case "https://www.dccourts.gov/superior-court":
          return dcSuperiorCourtFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("dccourts.structure").run(createConnectorContext({ fetcher }));
  const items = result.endpointResults.flatMap((endpoint) => endpoint.parsed?.items ?? []);
  const entityCandidates = result.endpointResults.flatMap((endpoint) =>
    endpoint.parsed?.entityCandidates ?? []
  );
  const relationshipCandidates = result.endpointResults.flatMap((endpoint) =>
    endpoint.parsed?.relationshipCandidates ?? []
  );
  assertEquals(result.endpointResults.length, 3);
  assertEquals(items.length, 3);
  assertEquals(entityCandidates.length, 12);
  assertEquals(relationshipCandidates.length, 11);
  assert(
    entityCandidates.some((candidate) =>
      candidate.name === "District of Columbia Courts" && candidate.kind === "court_system"
    ),
  );
  assert(
    entityCandidates.some((candidate) =>
      candidate.name === "Court of Appeals" && candidate.kind === "court"
    ),
  );
  assert(
    entityCandidates.some((candidate) =>
      candidate.name === "Special Operations Division" && candidate.kind === "court_division"
    ),
  );
  assert(
    !entityCandidates.some((candidate) => candidate.name === "Crime Victims Compensation Program"),
  );
  assert(
    !entityCandidates.some((candidate) => candidate.name === "Office of the Auditor-Master"),
  );
  assert(
    relationshipCandidates.some((candidate) =>
      candidate.relationshipType === "part_of" &&
      candidate.fromEntityRef === buildEntityId("Court of Appeals") &&
      candidate.toEntityRef === buildEntityId("District of Columbia Courts")
    ),
  );
  assert(
    relationshipCandidates.some((candidate) =>
      candidate.relationshipType === "part_of" &&
      candidate.fromEntityRef === buildEntityId("Tax Division") &&
      candidate.toEntityRef === buildEntityId("Superior Court")
    ),
  );
});

Deno.test("BEGA connector captures BEGA with the OGE and OOG offices only", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://bega.dc.gov/node/61616/":
          return begaAboutFixture;
        case "https://bega.dc.gov/page/office-government-ethics":
          return begaOgeFixture;
        case "https://www.open-dc.gov/office-open-government":
          return begaOogFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("bega.structure").run(createConnectorContext({ fetcher }));
  const items = result.endpointResults.flatMap((endpoint) => endpoint.parsed?.items ?? []);
  const entityCandidates = result.endpointResults.flatMap((endpoint) =>
    endpoint.parsed?.entityCandidates ?? []
  );
  const relationshipCandidates = result.endpointResults.flatMap((endpoint) =>
    endpoint.parsed?.relationshipCandidates ?? []
  );
  assertEquals(result.endpointResults.length, 3);
  assertEquals(items.length, 3);
  assertEquals(entityCandidates.length, 3);
  assertEquals(relationshipCandidates.length, 2);
  assert(
    entityCandidates.some((candidate) =>
      candidate.name === "Board of Ethics and Government Accountability" && candidate.kind ===
        "agency"
    ),
  );
  assert(
    entityCandidates.some((candidate) =>
      candidate.name === "Office of Government Ethics" && candidate.kind === "office"
    ),
  );
  assert(
    entityCandidates.some((candidate) =>
      candidate.name === "Office of Open Government" && candidate.kind === "office"
    ),
  );
  assert(
    relationshipCandidates.some((candidate) =>
      candidate.relationshipType === "part_of" &&
      candidate.fromEntityRef === buildEntityId("Office of Government Ethics") &&
      candidate.toEntityRef === buildEntityId("Board of Ethics and Government Accountability")
    ),
  );
  assert(
    relationshipCandidates.some((candidate) =>
      candidate.relationshipType === "part_of" &&
      candidate.fromEntityRef === buildEntityId("Office of Open Government") &&
      candidate.toEntityRef === buildEntityId("Board of Ethics and Government Accountability")
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
  assertStringIncludes(batchText, "Accepted 0 safe review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const relationshipItems = reopened.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.open_dc.public_bodies",
  });
  const acceptedRelationships = reopened.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id in (
       'dc.board_of_accountancy:governed_by:dc.department_of_licensing_and_consumer_protection',
       'dc.adult_career_pathways_task_force:governed_by:dc.department_of_employment_services'
     )
     order by relationship_id`,
  ).all() as Array<{ relationshipId: string }>;
  const acceptedAuthorityCandidates = reopened.db.prepare(
    `select review_status as reviewStatus
     from relationship_candidates
     where relationship_candidate_id in (
       'relationship.open_dc.public_bodies.board_accountancy_authorized_by',
       'relationship.open_dc.public_bodies.adult_career_pathways_task_force_authorized_by'
     )
     order by relationship_candidate_id`,
  ).all() as Array<{ reviewStatus: string }>;
  const blockedRelationship = reopened.db.prepare(
    `select reason, details_json as detailsJson
     from reconciliation_items
     where subject_id = 'relationship.open_dc.public_bodies.board_accountancy_governing_agency'`,
  ).get() as { reason: string; detailsJson: string } | undefined;
  reopened.close();

  assertEquals(relationshipItems.length, 0);
  assertEquals(acceptedRelationships.length, 0);
  assertEquals(acceptedAuthorityCandidates.length, 0);
  assert(blockedRelationship);
  assertEquals(blockedRelationship.reason, "unresolved_endpoints");
  assertStringIncludes(
    blockedRelationship.detailsJson,
    "dc.department_of_licensing_and_consumer_protection",
  );
});

Deno.test("multi-artifact connector imports keep schema and row evidence on the correct artifacts", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const progressMessages: string[] = [];
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
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
    await getConnector("dcgis.agencies").run(
      createConnectorContext({
        fetcher,
        onProgress: (event) => progressMessages.push(event.message),
      }),
    ),
    dataDir,
  );
  const schemaArtifact = workbench.db.prepare(
    `select source_artifacts.path as artifactPath
     from source_fields
     join source_artifacts on source_artifacts.artifact_id = source_fields.artifact_id
     where source_fields.endpoint_id = ? and source_fields.field_name = ?`,
  ).get("dcgis.agencies.main", "AGENCY_NAME") as { artifactPath: string };
  const rowArtifact = workbench.db.prepare(
    `select source_artifacts.path as artifactPath,
            source_artifacts.fetched_url as fetchedUrl
     from source_items
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     where source_items.endpoint_id = ? and source_items.item_key = ?`,
  ).get("dcgis.agencies.main", "1001") as { artifactPath: string; fetchedUrl: string };
  const evidence = workbench.db.prepare(
    `select artifact_path as artifactPath
     from entity_candidate_evidence
     where candidate_id = ?
     order by evidence_id
     limit 1`,
  ).get("candidate.dcgis.agencies.1001") as { artifactPath: string };
  workbench.close();
  assertEquals(progressMessages, [
    "Fetching DCGIS table metadata",
    "Fetching DCGIS rows starting at 1 (page 1, up to 1000)",
  ]);
  assertStringIncludes(rowArtifact.fetchedUrl, "outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME");
  assert(!rowArtifact.fetchedUrl.includes("outFields=*"));
  assert(schemaArtifact.artifactPath !== rowArtifact.artifactPath);
  assertEquals(evidence.artifactPath, rowArtifact.artifactPath);
});

Deno.test("DCGIS paged row evidence points to the row page artifact", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const metadata = { ...dcgisMetadataFixture, maxRecordCount: 1 };
  const firstPage = {
    features: [{
      attributes: {
        OBJECTID: 1,
        AGENCY_ID: "2001",
        AGENCY_NAME: "First DCGIS Agency",
        TYPE: "agency",
        WEB_URL: "https://example.com/first",
      },
    }],
  };
  const secondPage = {
    features: [{
      attributes: {
        OBJECTID: 2,
        AGENCY_ID: "2002",
        AGENCY_NAME: "Second DCGIS Agency",
        TYPE: "agency",
        WEB_URL: "https://example.com/second",
      },
    }],
  };
  const emptyPage = { features: [] };
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(metadata);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1&f=json":
          return JSON.stringify(firstPage);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=1&resultRecordCount=1&f=json":
          return JSON.stringify(secondPage);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=2&resultRecordCount=1&f=json":
          return JSON.stringify(emptyPage);
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
  const secondRowArtifact = workbench.db.prepare(
    `select source_artifacts.path as artifactPath,
            source_artifacts.fetched_url as fetchedUrl
     from source_items
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     where source_items.endpoint_id = ? and source_items.item_key = ?`,
  ).get("dcgis.agencies.main", "2002") as { artifactPath: string; fetchedUrl: string };
  const secondEvidence = workbench.db.prepare(
    `select artifact_path as artifactPath
     from entity_candidate_evidence
     where candidate_id = ?
       and field_path = 'NAME'
     limit 1`,
  ).get("candidate.dcgis.agencies.2002") as { artifactPath: string };
  const rowArtifactCount = workbench.db.prepare(
    "select count(*) as count from source_artifacts where endpoint_id = ? and kind = 'rows'",
  ).get("dcgis.agencies.main") as { count: number };
  workbench.close();

  assertEquals(rowArtifactCount.count, 3);
  assertStringIncludes(secondRowArtifact.fetchedUrl, "resultOffset=1");
  assertEquals(secondEvidence.artifactPath, secondRowArtifact.artifactPath);
});

Deno.test("DCGIS connector fails loudly on ArcGIS query error payloads", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify({
            error: {
              code: 400,
              message: "Failed to execute query.",
              details: ["Invalid field name"],
            },
          });
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await assertRejects(
    () => getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    Error,
    "dcgis.agencies Failed to execute query.: Invalid field name",
  );
});

Deno.test("DCGIS legal refs resolve exact D.C. law titles through the official law index", async () => {
  const lawIndexUrl = "https://raw.githubusercontent.com/DCCouncil/law-html/master/index.json";
  const rowsWithLawTitle = {
    features: [{
      attributes: {
        OBJECTID: 1,
        AGENCY_ID: 1172,
        AGENCY_NAME: "District of Columbia Green Finance Authority",
        TYPE: "Authority",
        BRANCH: "Independent",
        MAYORAL_CLUSTER: null,
        WEB_URL: "https://dcgreenbank.com/",
        LEGISLATION: "District of Columbia Green Finance Authority Establishment Act of 2018",
      },
    }],
  };
  const lawIndexFixture = [{
    citation: "D.C. Law 22-155",
    heading: "Green Finance Authority Establishment Act of 2018",
    path: "/us/dc/council/laws/22-155",
  }];
  const fetchedUrls: string[] = [];
  const fetcher = async (url: string) => {
    fetchedUrls.push(url);
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(rowsWithLawTitle);
        case lawIndexUrl:
          return JSON.stringify(lawIndexFixture);
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

  const result = await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher }));
  const parsed = result.endpointResults[0].parsed;
  const legalRef = parsed?.legalRefs?.[0];
  assertEquals(fetchedUrls.includes(lawIndexUrl), true);
  assertEquals(result.endpointResults[0].artifacts.length, 3);
  assertEquals(result.endpointResults[0].artifacts[2].fetchedUrl, lawIndexUrl);
  assertEquals(legalRef?.refType, "dc_law");
  assertEquals(
    legalRef?.citationText,
    "District of Columbia Green Finance Authority Establishment Act of 2018",
  );
  assertEquals(legalRef?.normalizedCitation, "D.C. Law 22-155");
  assertEquals(legalRef?.url, "https://code.dccouncil.gov/us/dc/council/laws/22-155");
  assertEquals(legalRef?.needsReview, false);
  assertEquals(legalRef?.evidence?.map((row) => row.fieldPath), [
    "LEGISLATION",
    "DCCouncil law index",
  ]);
  assertEquals(legalRef?.evidence?.[1]?.artifactIndex, 2);
});

Deno.test("DCGIS resolved law-title legal refs import as accepted entity attachments", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const lawIndexUrl = "https://raw.githubusercontent.com/DCCouncil/law-html/master/index.json";
  const rowsWithLawTitle = {
    features: [{
      attributes: {
        OBJECTID: 1,
        AGENCY_ID: 1172,
        AGENCY_NAME: "District of Columbia Green Finance Authority",
        TYPE: "Authority",
        BRANCH: "Independent",
        MAYORAL_CLUSTER: null,
        WEB_URL: "https://dcgreenbank.com/",
        LEGISLATION: "District of Columbia Green Finance Authority Establishment Act of 2018",
      },
    }],
  };
  const lawIndexFixture = [{
    citation: "D.C. Law 22-155",
    heading: "D.C. Law 22-155. Green Finance Authority Establishment Act of 2018.",
    path: "/us/dc/council/laws/22-155",
  }];
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(rowsWithLawTitle);
        case lawIndexUrl:
          return JSON.stringify(lawIndexFixture);
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

  const result = await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher }));
  await workbench.importConnectorResult(result, dataDir);
  const entityId = buildEntityId("District of Columbia Green Finance Authority");
  const legalRef = workbench.db.prepare(
    "select ref_type as refType, normalized_citation as normalizedCitation, review_status as reviewStatus from legal_refs where legal_ref_id = ?",
  ).get("legal.dcgis.agencies.1172_legislation") as {
    refType: string;
    normalizedCitation: string;
    reviewStatus: string;
  };
  const attachment = workbench.db.prepare(
    "select entity_id as entityId from entity_legal_refs where legal_ref_id = ?",
  ).get("legal.dcgis.agencies.1172_legislation") as { entityId: string };
  const openReviewCount = workbench.db.prepare(
    "select count(*) as count from review_items where subject_id = ? and status = 'open'",
  ).get("legal.dcgis.agencies.1172_legislation") as { count: number };
  workbench.close();

  assertEquals(legalRef, {
    refType: "dc_law",
    normalizedCitation: "D.C. Law 22-155",
    reviewStatus: "accepted",
  });
  assertEquals(attachment.entityId, entityId);
  assertEquals(openReviewCount.count, 0);
});

Deno.test("DCGIS bare year-number legal refs stay pending instead of importing as D.C. Code", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const rowsWithBareYearNumber = {
    features: [{
      attributes: {
        ENTITY_ID: 8,
        NAME: "Statewide Independent Living Council (SILC)",
        SHORT_NAME: "SILC",
        TYPE: "Council",
        WEB_URL: "https://dds.dc.gov/page/statewide-independent-living-council",
        GOVERNING_AGENCY: null,
        AUTHORIZING_ORDER_LAW: "1993-148",
        CLUSTER_DC: null,
      },
    }],
  };
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(rowsWithBareYearNumber);
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

  const result = await getConnector("dcgis.boards_commissions_councils").run(
    createConnectorContext({ fetcher }),
  );
  await workbench.importConnectorResult(result, dataDir);
  const legalRef = result.endpointResults[0].parsed?.legalRefs?.[0];
  const row = workbench.db.prepare(
    "select ref_type as refType, normalized_citation as normalizedCitation, review_status as reviewStatus from legal_refs where legal_ref_id = ?",
  ).get("legal.dcgis.boards_commissions_councils.8_legislation") as {
    refType: string;
    normalizedCitation: string | null;
    reviewStatus: string;
  };
  const openReviewCount = workbench.db.prepare(
    "select count(*) as count from review_items where subject_id = ? and status = 'open'",
  ).get("legal.dcgis.boards_commissions_councils.8_legislation") as { count: number };
  workbench.close();

  assertEquals(legalRef?.refType, "unknown");
  assertEquals(legalRef?.normalizedCitation, undefined);
  assertEquals(legalRef?.needsReview, true);
  assertEquals(row, {
    refType: "unknown",
    normalizedCitation: null,
    reviewStatus: "pending",
  });
  assertEquals(openReviewCount.count, 1);
});

Deno.test("DCGIS legal refs do not fetch the law index for malformed act labels", async () => {
  const rowsWithMalformedAct = {
    features: [{
      attributes: {
        ENTITY_ID: 76,
        NAME: "Out of School Time Grants and Youth Outcomes Commission",
        SHORT_NAME: "OST Commission",
        TYPE: "Commission",
        WEB_URL: "https://example.dc.gov/ost",
        GOVERNING_AGENCY: null,
        AUTHORIZING_ORDER_LAW: "D.G. AGT 21-679",
        CLUSTER_DC: null,
      },
    }],
  };
  const fetchedUrls: string[] = [];
  const fetcher = async (url: string) => {
    fetchedUrls.push(url);
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(rowsWithMalformedAct);
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

  const result = await getConnector("dcgis.boards_commissions_councils").run(
    createConnectorContext({ fetcher }),
  );
  const legalRef = result.endpointResults[0].parsed?.legalRefs?.[0];
  assertEquals(
    fetchedUrls.includes("https://raw.githubusercontent.com/DCCouncil/law-html/master/index.json"),
    false,
  );
  assertEquals(result.endpointResults[0].artifacts.length, 2);
  assertEquals(legalRef?.refType, "unknown");
  assertEquals(legalRef?.normalizedCitation, undefined);
  assertEquals(legalRef?.needsReview, true);
});

Deno.test("DCGIS legal refs keep duplicate D.C. law title matches in review", async () => {
  const lawIndexUrl = "https://raw.githubusercontent.com/DCCouncil/law-html/master/index.json";
  const rowsWithDuplicateTitle = {
    features: [{
      attributes: {
        OBJECTID: 1,
        AGENCY_ID: 2001,
        AGENCY_NAME: "Duplicate Title Agency",
        TYPE: "Agency",
        WEB_URL: "https://example.dc.gov/duplicate-title",
        LEGISLATION: "District of Columbia Reused Amendment Act of 2013",
      },
    }],
  };
  const lawIndexFixture = [{
    t: "D.C. Law 20-1. Reused Amendment Act of 2013.",
    p: "/us/dc/council/laws/20-1",
    sc: "D.C. Law 20-1",
  }, {
    t: "D.C. Law 20-2. Reused Amendment Act of 2013.",
    p: "/us/dc/council/laws/20-2",
    sc: "D.C. Law 20-2",
  }];
  const fetcher = async (url: string) => {
    const body = (() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(rowsWithDuplicateTitle);
        case lawIndexUrl:
          return JSON.stringify(lawIndexFixture);
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

  const result = await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher }));
  const legalRef = result.endpointResults[0].parsed?.legalRefs?.[0];
  assertEquals(legalRef?.refType, "unknown");
  assertEquals(legalRef?.normalizedCitation, undefined);
  assertEquals(legalRef?.needsReview, true);
  assertEquals(legalRef?.evidence?.map((row) => row.fieldPath), ["LEGISLATION"]);
});

Deno.test("DCGIS boards, commissions, and councils connector preserves overlaps conservatively", async () => {
  const rowsWithCompoundLegalRef = {
    features: [
      ...dcgisBoardsCommissionsCouncilsRowsFixture.features,
      {
        attributes: {
          ENTITY_ID: 126,
          NAME: "Forensic Science Advisory Board",
          SHORT_NAME: "Forensic Science Advisory Board",
          ACRONYM: null,
          GOVERNING_AGENCY: "Office of the Chief Medical Examiner",
          ADDRESS: null,
          TYPE: "Board",
          WEB_URL: "https://ocme.dc.gov/",
          AUTHORIZING_ORDER_LAW:
            "DC. ST. D.I., T.1, Ch 15, Subch. III, Pt. 1, 1979 Plan 2 (IV. B. (2)); 5-1402 et seq.",
          CLUSTER_DC: null,
        },
      },
    ],
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(rowsWithCompoundLegalRef);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("dcgis.boards_commissions_councils").run(
    createConnectorContext({ fetcher }),
  );
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 4);
  assertEquals(parsed.entityCandidates?.length, 4);
  assertEquals(parsed.relationshipCandidates?.length, 3);
  assertEquals(parsed.legalRefs?.length, 5);
  const ancLegalRef = parsed.legalRefs?.find((legalRef) =>
    legalRef.legalRefId === "legal.dcgis.boards_commissions_councils.25_legislation"
  );
  assertEquals(ancLegalRef?.refType, "dc_bill");
  assertEquals(ancLegalRef?.normalizedCitation, "D.C. Bill B21-0697");
  assertEquals(ancLegalRef?.evidence?.[0]?.fieldPath, "AUTHORIZING_ORDER_LAW");
  const compoundLegalRefs = parsed.legalRefs
    ?.filter((legalRef) => legalRef.sourceItemKey === "126")
    .map((legalRef) => ({
      refType: legalRef.refType,
      normalizedCitation: legalRef.normalizedCitation,
      needsReview: legalRef.needsReview,
    }));
  assertEquals(compoundLegalRefs, [
    {
      refType: "reorganization_plan",
      normalizedCitation: "Reorganization Plan No. 2 of 1979",
      needsReview: false,
    },
    { refType: "dc_code", normalizedCitation: "D.C. Code 5-1402", needsReview: false },
  ]);
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Board of Accountancy" && candidate.duplicateHint ===
        "https://www.dcopla.com/accountancy/"
    ),
  );
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Rental Housing Commission" && candidate.kind === "commission"
    ),
  );
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Advisory Neighborhood Commissions" && candidate.kind === "commission"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by" &&
      candidate.rawValue === "Department of Housing and Community Development"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "governed_by" &&
      candidate.rawValue === "DC Department of Licensing and Consumer Protection"
    ),
  );
  assert(
    parsed.reviewItems?.some((item) =>
      item.subjectId === "candidate.dcgis.boards_commissions_councils.29"
    ),
  );
});

Deno.test("DCGIS public-body rows named for a governing agency derive the public body name", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const bccRows = {
    features: [{
      attributes: {
        ENTITY_ID: 26,
        NAME: "Alcoholic Beverage and Cannabis Administration",
        SHORT_NAME: "Alcoholic Beverage and Cannabis Administration",
        ACRONYM: null,
        GOVERNING_AGENCY: "Alcoholic Beverage and Cannabis Administration",
        ADDRESS: null,
        TYPE: "Board",
        WEB_URL: "https://abca.dc.gov/page/abc-board",
        AUTHORIZING_ORDER_LAW: "D.C. Code § 25-201",
        CLUSTER_DC: null,
      },
    }],
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(dcgisRowsFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(bccRows);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("dcgis.boards_commissions_councils").run(
      createConnectorContext({ fetcher }),
    ),
    dataDir,
  );

  const candidate = workbench.db.prepare(
    `select proposed_entity_id as proposedEntityId,
            name,
            kind,
            review_status as reviewStatus
     from entity_candidates
     where candidate_id = ?`,
  ).get("candidate.dcgis.boards_commissions_councils.26") as {
    proposedEntityId: string;
    name: string;
    kind: string;
    reviewStatus: string;
  } | undefined;
  const reviewItem = workbench.listReviewItems({
    type: "entity_candidate",
    subjectPrefix: "candidate.dcgis.boards_commissions_councils.26",
  })[0];
  const relationshipReviewItem = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.dcgis.boards_commissions_councils.26_governing_agency",
  })[0];
  const evidenceFields = workbench.db.prepare(
    "select field_path as fieldPath from entity_candidate_evidence where candidate_id = ? order by field_path",
  ).all("candidate.dcgis.boards_commissions_councils.26") as Array<{ fieldPath: string }>;
  const relationship = workbench.db.prepare(
    `select from_entity_ref as fromEntityRef,
            relationship_type as relationshipType,
            to_entity_ref as toEntityRef,
            review_status as reviewStatus
       from relationship_candidates
      where relationship_candidate_id = ?`,
  ).get("relationship.dcgis.boards_commissions_councils.26_governing_agency") as {
    fromEntityRef: string;
    relationshipType: string;
    toEntityRef: string;
    reviewStatus: string;
  } | undefined;
  const canonicalRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
       from canonical_relationships
      where relationship_id = ?`,
  ).get(
    "dc.alcoholic_beverage_and_cannabis_board:governed_by:dc.alcoholic_beverage_and_cannabis_administration",
  ) as { relationshipId: string } | undefined;
  const legalAttachment = workbench.db.prepare(
    `select entity_id as entityId,
            legal_ref_id as legalRefId
       from entity_legal_refs
      where legal_ref_id = ?`,
  ).get("legal.dcgis.boards_commissions_councils.26_legislation") as {
    entityId: string;
    legalRefId: string;
  } | undefined;
  workbench.close();

  assertEquals(candidate?.proposedEntityId, "dc.alcoholic_beverage_and_cannabis_board");
  assertEquals(candidate?.name, "Alcoholic Beverage and Cannabis Board");
  assertEquals(candidate?.kind, "board");
  assertEquals(candidate?.reviewStatus, "accepted");
  assertEquals(reviewItem, undefined);
  assertEquals(relationship?.fromEntityRef, "dc.alcoholic_beverage_and_cannabis_board");
  assertEquals(relationship?.relationshipType, "governed_by");
  assertEquals(relationship?.toEntityRef, "dc.alcoholic_beverage_and_cannabis_administration");
  assertEquals(relationship?.reviewStatus, "pending");
  assertEquals(relationshipReviewItem?.defaultAction, "defer");
  assertStringIncludes(
    String(relationshipReviewItem?.details.whyDeferred),
    "same organization as both the public body and its governing agency",
  );
  assertEquals(canonicalRelationship, undefined);
  assertEquals(legalAttachment?.entityId, "dc.alcoholic_beverage_and_cannabis_board");
  assertEquals(
    legalAttachment?.legalRefId,
    "legal.dcgis.boards_commissions_councils.26_legislation",
  );
  assert(evidenceFields.some((row) => row.fieldPath === "GOVERNING_AGENCY"));
  assert(evidenceFields.some((row) => row.fieldPath === "AUTHORIZING_ORDER_LAW"));
});

Deno.test("DCGIS public-body derivation requires source URL and legal-authority evidence", async () => {
  const rows = {
    features: [{
      attributes: {
        ENTITY_ID: 5001,
        NAME: "Example Administration",
        SHORT_NAME: "Example Administration",
        ACRONYM: null,
        GOVERNING_AGENCY: "Example Administration",
        ADDRESS: null,
        TYPE: "Board",
        WEB_URL: "https://example.dc.gov/",
        AUTHORIZING_ORDER_LAW: "D.C. Code § 1-123",
        CLUSTER_DC: null,
      },
    }, {
      attributes: {
        ENTITY_ID: 5002,
        NAME: "Sample Administration",
        SHORT_NAME: "Sample Administration",
        ACRONYM: null,
        GOVERNING_AGENCY: "Sample Administration",
        ADDRESS: null,
        TYPE: "Board",
        WEB_URL: "https://example.dc.gov/page/sample-board",
        AUTHORIZING_ORDER_LAW: null,
        CLUSTER_DC: null,
      },
    }],
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24?f=json":
          return JSON.stringify(dcgisBoardsCommissionsCouncilsMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24/query?where=1%3D1&outFields=OBJECTID%2CENTITY_ID%2CNAME%2CSHORT_NAME%2CTYPE%2CWEB_URL%2CGOVERNING_AGENCY%2CAUTHORIZING_ORDER_LAW%2CCLUSTER_DC&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(rows);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  const result = await getConnector("dcgis.boards_commissions_councils").run(
    createConnectorContext({ fetcher }),
  );
  const parsed = result.endpointResults[0].parsed;

  assertEquals(
    parsed?.entityCandidates?.map((candidate) => candidate.name),
    ["Example Administration", "Sample Administration"],
  );
  assertEquals(parsed?.relationshipCandidates?.length, 0);
  assert(
    parsed?.reviewItems?.some((item) =>
      item.subjectId === "candidate.dcgis.boards_commissions_councils.5001"
    ),
  );
  assert(
    parsed?.reviewItems?.some((item) =>
      item.subjectId === "candidate.dcgis.boards_commissions_councils.5002"
    ),
  );
});

Deno.test("Council members connector captures seats and ward representations", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/councilmembers/":
          return councilMembersFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("council.members").run(createConnectorContext({ fetcher }));
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 1);
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Council of the District of Columbia" &&
      candidate.kind === "council" &&
      candidate.officialUrl === "https://dccouncil.gov/"
    ),
  );
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Council Chairman"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "District of Columbia"));
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "holds" && candidate.rawValue === "Council Chairman"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("Ward 6")
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("District of Columbia")
    ),
  );
});

Deno.test("Council member source upgrades stale DCGIS Council official URL", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.agencies",
      candidateId: "candidate.dcgis.agencies.council",
      sourceItemKey: "dcgis-council-row",
      proposedEntityId: "dc.council_of_the_district_of_columbia",
      name: "Council of the District of Columbia",
      kind: "council",
      officialUrl: "https://dccouncil.us/",
      observedName: "Council of the District of Columbia",
      confidence: 0.95,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    await getConnector("council.members").run(createConnectorContext({
      fetcher: async (url: string) => ({
        status: 200,
        text: async () => {
          switch (url) {
            case "https://dccouncil.gov/councilmembers/":
              return councilMembersFixture;
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        },
        json: async <T>() => {
          throw new Error(`No json fixture for ${url}`) as T;
        },
      }),
    })),
    dataDir,
  );

  const council = workbench.db.prepare(
    `select official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.council_of_the_district_of_columbia'`,
  ).get() as { officialUrl: string | null; mergedCandidateIds: string };
  workbench.close();

  assertEquals(council.officialUrl, "https://dccouncil.gov/");
  assertEquals(JSON.parse(council.mergedCandidateIds), [
    "candidate.dcgis.agencies.council",
    "candidate.council.members.council_of_the_district_of_columbia",
  ]);
});

Deno.test("Council members connector ignores limit for the single-page roster", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/councilmembers/":
          return councilMembersFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("council.members").run(createConnectorContext({
    fetcher,
    limit: 1,
  }));
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Ward 7 Councilmember Wendell Felder"
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("Ward 8")
    ),
  );
});

Deno.test("Council ward parsing skips order inference when a ward label is absent", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/councilmembers/":
          return `
<html><body>
  <main>
    <h3>Ward Members</h3>
    <ul>
      <li><a href="https://dccouncil.gov/council/charles-allen/">Councilmember Charles Allen</a></li>
    </ul>
  </main>
</body></html>
`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("council.members").run(createConnectorContext({ fetcher }));
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assert(
    parsed.entityCandidates?.some((candidate) => candidate.name === "Councilmember Charles Allen"),
  );
  assert(
    !parsed.entityCandidates?.some((candidate) => candidate.name === "Ward 1 Council Seat"),
  );
  assert(
    !parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("Ward 1")
    ),
  );
});

Deno.test("Council committee member parsing captures chair and member relationships", async () => {
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
  const chairs =
    parsed.relationshipCandidates?.filter((candidate) => candidate.relationshipType === "chairs") ??
      [];
  const members =
    parsed.relationshipCandidates?.filter((candidate) =>
      candidate.relationshipType === "member_of"
    ) ?? [];
  assertEquals(chairs.length, 1);
  assert(
    chairs.some((candidate) =>
      candidate.fromEntityRef === buildEntityId("At-Large Councilmember Christina Henderson") &&
      candidate.toEntityRef === buildEntityId("Committee on Health")
    ),
  );
  assert(
    members.some((candidate) =>
      candidate.fromEntityRef === buildEntityId("Ward 6 Councilmember Charles Allen") &&
      candidate.toEntityRef === buildEntityId("Committee on Health")
    ),
  );
  assert(
    members.some((candidate) =>
      candidate.fromEntityRef === buildEntityId("At-Large Councilmember Christina Henderson")
    ),
  );
});

Deno.test("OANC ANC profiles connector captures wards, SMDs, and commissioners without contact data", async () => {
  const progressMessages: string[] = [];
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://oanc.dc.gov/anc-profile-listing":
          return ancListingFixture;
        case "https://oanc.dc.gov/anc-profile/anc-34g":
          return ancProfile34gFixture;
        case "https://oanc.dc.gov/anc-profile/anc-6c":
          return ancProfile6cFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("oanc.anc_profiles").run(
    createConnectorContext({
      fetcher,
      limit: 2,
      onProgress: (event) => progressMessages.push(event.message),
    }),
  );
  const parsed = result.endpointResults[0].parsed;
  assert(parsed);
  assertEquals(parsed.items?.length, 3);
  assertEquals(parsed.legalRefs?.length, 2);
  const anc34gItem = parsed.items?.find((item) => item.itemKey === "anc-34g");
  const anc6cItem = parsed.items?.find((item) => item.itemKey === "anc-6c");
  const anc34gBody = anc34gItem?.body as {
    wardNumbers?: number[];
    commissioners?: Array<{ smd: string; name: string; role?: string }>;
  };
  const anc6cBody = anc6cItem?.body as {
    wardNumbers?: number[];
    commissioners?: Array<{ smd: string; name: string; role?: string }>;
  };
  assertEquals(anc34gBody.wardNumbers, [3, 4]);
  assertEquals(anc6cBody.wardNumbers, [6]);
  assertEquals(anc34gBody.commissioners?.[0].role, "Vice Chairperson");
  assertEquals(anc6cBody.commissioners?.[1].role, "Chairperson");
  assertEquals(anc6cBody.commissioners?.[3], {
    smd: "6C04",
    name: "Audra Grant",
    role: "Vice-Chairperson",
  });
  assertEquals(anc34gBody.commissioners?.[2], {
    smd: "3/4G03",
    name: "Brian A. Glover",
    role: "Sergeant-at-Arms",
  });
  assertEquals(anc34gBody.commissioners?.[3], {
    smd: "3/4G04",
    name: "Carole L. Feld",
    role: "Chairperson/Secretary",
  });
  assert(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name === "Advisory Neighborhood Commissions"
    ),
  );
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "ANC 3/4G"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Ward 3"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Ward 4"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "SMD 6C01"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Audra Grant"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Brian A. Glover"));
  assert(parsed.entityCandidates?.some((candidate) => candidate.name === "Carole L. Feld"));
  assertEquals(
    parsed.entityCandidates?.some((candidate) =>
      candidate.name.includes("Vice-Chairperson") ||
      candidate.name.includes("Sergeant-at-Arms") ||
      candidate.name.includes("Chairperson/Secretary")
    ),
    false,
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "part_of" && candidate.toEntityRef === buildEntityId("Ward 3")
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "part_of" && candidate.toEntityRef === buildEntityId("Ward 4")
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "represents" &&
      candidate.toEntityRef === buildEntityId("SMD 6C01")
    ),
  );
  assert(
    parsed.relationshipCandidates?.some((candidate) =>
      candidate.relationshipType === "member_of" &&
      candidate.toEntityRef === buildEntityId("ANC 6C")
    ),
  );
  assertEquals(progressMessages, [
    "Fetching OANC ANC listing page",
    "Fetching OANC ANC profile 1/2: ANC 3/4G",
    "Fetching OANC ANC profile 2/2: ANC 6C",
  ]);
});

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
  const compareOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "compare",
      "public-bodies",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(compareOutput.code, 0);
  const compareJson = JSON.parse(new TextDecoder().decode(compareOutput.stdout)) as {
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

  const jsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "compare",
      "public-bodies",
      "--db",
      dbPath,
      "--json",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(jsonOutput.code, 0);
  const compareJson = JSON.parse(new TextDecoder().decode(jsonOutput.stdout)) as {
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

  const humanOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "compare",
      "public-bodies",
      "--db",
      dbPath,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(humanOutput.code, 0);
  const humanText = new TextDecoder().decode(humanOutput.stdout);
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
        "insert into entity_candidates(candidate_id, source_item_id, proposed_entity_id, name, normalized_name, kind, raw_kind, review_status) values(?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        `candidate.${source.sourceId}.${index + 1}`,
        sourceItemId,
        buildEntityId(candidate.name),
        candidate.name,
        candidate.name,
        candidate.kind,
        candidate.kind,
        "pending",
      );
    }
  }

  const report = workbench.comparePublicBodies();
  workbench.close();

  assertEquals(report.sharedNameCount, 0);
  assertEquals(report.conservativeVariantMatchCount, 1);
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

  const compareOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "source",
      "compare",
      "public-bodies",
      "--db",
      dbPath,
      "--json",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(compareOutput.code, 0);
  const compareJson = JSON.parse(new TextDecoder().decode(compareOutput.stdout)) as {
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

Deno.test("Open DC legal authority stays attached to the entity without a non-exported relationship", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
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
  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({ fetcher, limit: 1 })),
    dataDir,
  );
  const relationshipLegalAttachmentRows = workbench.db.prepare(
    "select relationship_id as relationshipId, legal_ref_id as legalRefId from relationship_legal_refs order by relationship_id",
  ).all().map((row) => row as { relationshipId: string; legalRefId: string });
  const entityLegalAttachmentRows = workbench.db.prepare(
    "select entity_id as entityId, legal_ref_id as legalRefId from entity_legal_refs order by entity_id",
  ).all().map((row) => row as { entityId: string; legalRefId: string });
  const authorityRelationshipCount = workbench.db.prepare(
    "select count(*) as count from relationship_candidates where relationship_type = 'authorized_by'",
  ).get() as { count: number };
  workbench.close();
  assertEquals(relationshipLegalAttachmentRows, []);
  assertEquals(entityLegalAttachmentRows, [{
    entityId: "dc.commission_on_example_services",
    legalRefId: "legal.open_dc.public_bodies.commission_on_example_services_authority",
  }]);
  assertEquals(authorityRelationshipCount.count, 0);
});

Deno.test("relationship acceptance rejects blocked endpoints instead of creating placeholders", async () => {
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
  await assertRejects(
    () =>
      workbench.appendResolutionEvent(
        {
          eventType: "accept_relationship_candidate",
          subjectId: "relationship.council.committees.committee_of_the_whole_part_of",
          payload: {},
        },
        resolutionsDir,
      ),
    Error,
    "Cannot accept blocked relationship candidate",
  );
  const placeholderCount = workbench.db.prepare(
    "select count(*) as count from canonical_entities where is_placeholder = 1",
  ).get() as { count: number };
  workbench.close();
  assertEquals(placeholderCount.count, 0);
});

Deno.test("blocked relationship reconciliation stores endpoint status for audit", async () => {
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
  const reconciliationItem = workbench.db.prepare(
    `select details_json as detailsJson
     from reconciliation_items
     where subject_id = 'relationship.council.committees.committee_of_the_whole_part_of'`,
  ).get() as { detailsJson: string } | undefined;
  workbench.close();
  assert(reconciliationItem);
  assertStringIncludes(
    reconciliationItem.detailsJson,
    '"fromEndpoint":{"entityId":"dc.committee_of_the_whole","state":"accepted"',
  );
  assertStringIncludes(
    reconciliationItem.detailsJson,
    '"toEndpoint":{"entityId":"dc.council_of_the_district_of_columbia","state":"missing"',
  );
});

Deno.test("dc review relationships can edit endpoints before accepting", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name, kind] of [
      ["dc.source_board", "Source Board", "board"],
      ["dc.council_of_the_district_of_columbia", "Council of the District of Columbia", "council"],
    ]
  ) {
    workbench.db.prepare(
      "insert or ignore into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name, kind);
  }
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_cli.relationships",
      relationshipCandidateId: "relationship.test.review_cli.editable",
      sourceItemKey: "review-cli-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.council_of_the_district_of_columbia",
      relationshipType: "governed_by",
      rawValue: "Council of the District of Columbia",
      needsReview: true,
    }),
    dataDir,
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
      "relationship.test.review_cli.editable",
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
    new TextEncoder().encode("\ne\npart_of\n\ndc.council_of_the_district_of_columbia\n"),
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
    "dc.source_board:part_of:dc.council_of_the_district_of_columbia",
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
  assertEquals(
    oversightCandidates.some((candidate) =>
      candidate.rawValue ===
        "All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health"
    ),
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
      item.subjectId === "relationship.council.committees.committee_on_health_oversight_2" &&
      item.reason === "Review Council committee oversight relationship"
    ),
  );
});

Deno.test("Council oversight targets default to accept except exclusion targets", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture.replace(
            "</ul>",
            "<li>Council of the District of Columbia</li></ul>",
          );
        case "https://dccouncil.gov/committees/committee-on-health/":
          return `<html><body>
            <h1>Committee on Health</h1>
            <h2>Agencies Under This Committee</h2>
            <ul>
              <li>Department of Health</li>
              <li>Cedar Hill Hospital</li>
              <li>Committee on Facilities and Procurement</li>
              <li>Department of Buildings (including construction codes)</li>
              <li>Office of the Attorney General (jointly, only for oversight purposes, with the Committee on the Judiciary and Public Safety)</li>
              <li>Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)</li>
              <li>All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health</li>
            </ul>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  const result = await getConnector("council.committees").run(createConnectorContext({ fetcher }));
  const items = result.endpointResults[0].parsed?.reviewItems ?? [];
  const healthItem = items.find((item) =>
    item.details.rawValue === "Department of Health" &&
    item.subjectId.includes("committee_on_health_oversight")
  );
  const cedarHillItem = items.find((item) => item.details.rawValue === "Cedar Hill Hospital");
  const facilitiesItem = items.find((item) =>
    item.details.rawValue === "Committee on Facilities and Procurement"
  );
  const includingItem = items.find((item) =>
    item.details.rawValue === "Department of Buildings (including construction codes)"
  );
  const jointlyItem = items.find((item) =>
    item.details.rawValue ===
      "Office of the Attorney General (jointly, only for oversight purposes, with the Committee on the Judiciary and Public Safety)"
  );
  const excludingItem = items.find((item) =>
    item.details.rawValue ===
      "Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)"
  );
  const groupedItem = items.find((item) =>
    item.details.rawValue ===
      "All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health"
  );
  const councilItem = items.find((item) =>
    item.details.rawValue === "Council of the District of Columbia"
  );

  assertEquals(healthItem?.defaultAction, "accept");
  assertEquals(cedarHillItem?.defaultAction, "accept");
  assertEquals(facilitiesItem?.defaultAction, "accept");
  assertEquals(includingItem?.defaultAction, "accept");
  assertEquals(jointlyItem?.defaultAction, "accept");
  assertEquals(excludingItem?.defaultAction, "defer");
  assertEquals(
    excludingItem?.details.whyDeferred,
    "Oversight text uses exclusion wording, so the compact edge needs a human decision.",
  );
  assertEquals(councilItem?.defaultAction, "accept");
  assertEquals(groupedItem, undefined);
});

Deno.test("entity show review context explains deferred relationship candidates", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name, kind] of [
      ["dc.council_of_the_district_of_columbia", "Council of the District of Columbia", "council"],
      ["dc.committee_of_the_whole", "Committee of the Whole", "committee"],
      [
        "dc.office_of_the_chief_financial_officer",
        "Office of the Chief Financial Officer",
        "agency",
      ],
    ]
  ) {
    workbench.db.prepare(
      "insert or ignore into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name, kind);
  }
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture.replace(
            "</ul>",
            "<li>Council of the District of Columbia</li><li>Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)</li></ul>",
          );
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

  const councilView = workbench.entityView("dc.council_of_the_district_of_columbia");
  const circularReview = councilView.reviewItems.find((item) =>
    item.subjectId === "relationship.council.committees.committee_of_the_whole_oversight_3"
  );
  const acceptedCircularRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.council_of_the_district_of_columbia:overseen_by:dc.committee_of_the_whole'`,
  ).get() as { relationshipId: string } | undefined;
  const ocfoView = workbench.entityView("dc.office_of_the_chief_financial_officer");
  const exclusionReview = ocfoView.reviewItems.find((item) =>
    item.subjectId === "relationship.council.committees.committee_of_the_whole_oversight_4"
  );
  workbench.close();

  assertEquals(circularReview, undefined);
  assertEquals(
    acceptedCircularRelationship?.relationshipId,
    "dc.council_of_the_district_of_columbia:overseen_by:dc.committee_of_the_whole",
  );
  assertEquals(exclusionReview?.defaultAction, "defer");
  assertEquals(
    exclusionReview?.subject?.rawValue,
    "Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)",
  );
  assertEquals(
    exclusionReview?.details.whyDeferred,
    "Oversight text uses exclusion wording, so the compact edge needs a human decision.",
  );

  const entityShowOutput = await new Deno.Command(Deno.execPath(), {
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
      "dc.office_of_the_chief_financial_officer",
      "--db",
      dbPath,
    ],
  }).output();
  const entityShowText = new TextDecoder().decode(entityShowOutput.stdout);
  assertEquals(entityShowOutput.code, 0);
  assertStringIncludes(entityShowText, "open_review:");
  assertStringIncludes(
    entityShowText,
    "source: council.committees / Committee of the Whole oversight detail",
  );
  assertStringIncludes(
    entityShowText,
    "relationship: dc.office_of_the_chief_financial_officer --overseen_by--> dc.committee_of_the_whole",
  );
  assertStringIncludes(
    entityShowText,
    "raw value: Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)",
  );
  assertStringIncludes(
    entityShowText,
    "why: Oversight text uses exclusion wording, so the compact edge needs a human decision.",
  );
  assertStringIncludes(
    entityShowText,
    "review: deno task dc -- review --source council.committees --subject-prefix relationship.council.committees.committee_of_the_whole_oversight_4",
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
    "mayors_order",
  );
  assertEquals(
    parseLegalReference("Mayor's Orders", "https://mayor.dc.gov/page/mayors-orders").refType,
    "mayors_order",
  );
  assertEquals(
    parseLegalReference("DC Municipal Regulations and DC Register", "https://www.dcregs.dc.gov/")
      .normalizedCitation,
    "DCMR and D.C. Register",
  );
  assertEquals(parseLegalReference("§ 25–202").normalizedCitation, "D.C. Code 25-202");
  assertEquals(parseLegalReference("4-1303.01a").normalizedCitation, "D.C. Code 4-1303.01a");
  assertEquals(parseLegalReference("1993-148"), {
    refType: "unknown",
    citationText: "1993-148",
    normalizedCitation: undefined,
    needsReview: true,
  });
  assertEquals(
    parseLegalReference("D.C. Official Code § 47-2853.06(b)(1)").normalizedCitation,
    "D.C. Code 47-2853.06(b)(1)",
  );
  assertEquals(parseLegalReference("D.C. Law 22-155").refType, "dc_law");
  assertEquals(parseLegalReference("D.C. Law 22-155").normalizedCitation, "D.C. Law 22-155");
  assertEquals(parseLegalReference("MO 2016-083").normalizedCitation, "Mayor's Order 2016-083");
  assertEquals(parseLegalReference("33 U.S. Code § 1267").refType, "us_code");
  assertEquals(parseLegalReference("33 U.S. Code § 1267").normalizedCitation, "33 U.S.C. § 1267");
  assertEquals(
    parseLegalReference(
      "1993-148; amended by 2001-79 and 2012-154",
      "https://www.open-dc.gov/Mayors_Order_2012-154",
    ).normalizedCitation,
    "Mayor's Order 1993-148; amended by 2001-79 and 2012-154",
  );
  assertEquals(
    parseLegalReference("D.C. Law 22-228. Boxing and Wrestling Commission Amendment Act of 2018")
      .normalizedCitation,
    "D.C. Law 22-228",
  );
  assertEquals(parseLegalReference("REACH Act (D.C. Act 23-521)").refType, "dc_act");
  assertEquals(
    parseLegalReference("REACH Act (D.C. Act 23-521)").normalizedCitation,
    "D.C. Act 23-521",
  );
  assertEquals(parseLegalReference("Public Law 89-774").refType, "public_law");
  assertEquals(parseLegalReference("Public Law 89-774").normalizedCitation, "Public Law 89-774");
  assertEquals(parseLegalReference("B21-0697").refType, "dc_bill");
  assertEquals(parseLegalReference("B21-0697").normalizedCitation, "D.C. Bill B21-0697");
  assertEquals(parseLegalReference("Act B20-0366").refType, "dc_bill");
  assertEquals(parseLegalReference("Act B20-0366").normalizedCitation, "D.C. Bill B20-0366");
  assertEquals(
    parseLegalReference("DC ST D.I, T. 1, Ch.15, Subch. XIV, Pt. A, 1996 Plan 4")
      .normalizedCitation,
    "Reorganization Plan No. 4 of 1996",
  );
  assertEquals(
    parseLegalReference(
      "DC. ST. D.I., T.1, Ch 15, Subch. III, Pt. 1, 1979 Plan 2 (IV. B. (2)); 5-1402 et seq.",
    )
      .refType,
    "unknown",
  );
});

Deno.test("known relationship endpoint aliases resolve to accepted-style entity ids", () => {
  assertEquals(
    buildKnownEntityRef("Alcoholic Beverages and Cannabis Administration (ABCA)"),
    "dc.alcoholic_beverage_and_cannabis_administration",
  );
  assertEquals(buildKnownEntityRef("Mayor"), "dc.mayor");
  assertEquals(
    buildKnownEntityRef("Mayor's Office of Veterans Affairs (MOVA)"),
    "dc.office_of_veterans_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office of Veteran's Affairs"),
    "dc.office_of_veterans_affairs",
  );
  assertEquals(
    buildKnownEntityRef("DC Department of Licensing and Consumer Protection"),
    "dc.department_of_licensing_and_consumer_protection",
  );
  assertEquals(
    buildKnownEntityRef("Department of Health (DOH)"),
    "dc.dc_health",
  );
  assertEquals(
    buildKnownEntityRef("Department of Housing and Community Development (DHCD)"),
    "dc.department_of_housing_and_community_development",
  );
  assertEquals(buildKnownEntityRef("City Administrator"), "dc.office_of_the_city_administrator");
  assertEquals(
    buildKnownEntityRef("Deputy Mayor for Public Safety and Justice/Operations (DMPSJ/O)"),
    "dc.office_of_the_deputy_mayor_for_public_safety_and_justice",
  );
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
  assertEquals(buildKnownEntityRef("Water and Sewer Authority (WASA)"), "dc.dc_water");
  assertEquals(
    buildKnownEntityRef("Fire and Emergency Medical Services Department"),
    "dc.fire_and_emergency_medical_services",
  );
  assertEquals(
    buildKnownEntityRef("Department of Energy and the Environment (DOEE)"),
    "dc.department_of_energy_and_environment",
  );
  assertEquals(buildKnownEntityRef("DOEE"), "dc.department_of_energy_and_environment");
  assertEquals(
    buildKnownEntityRef("DC Taxicab Commission (DCTC)"),
    "dc.district_of_columbia_taxicab_commission",
  );
  assertEquals(
    buildKnownEntityRef("Department of Forensic Sciences/DFS"),
    "dc.department_of_forensic_sciences",
  );
  assertEquals(
    buildKnownEntityRef("Office of the Attorney General for the District of Columbia"),
    "dc.office_of_the_attorney_general",
  );
  assertEquals(buildKnownEntityRef("EOM"), "dc.executive_office_of_the_mayor");
  assertEquals(
    buildKnownEntityRef("Executive Office of the Senior Advisor"),
    "dc.office_of_the_senior_advisor",
  );
  assertEquals(
    buildKnownEntityRef("Office of the Secretary of the District of Columbia"),
    "dc.office_of_the_secretary",
  );
  assertEquals(
    buildKnownEntityRef("Office of Victim Services and Justice Grants/OVSJG"),
    "dc.office_of_victim_services_and_justice_grants",
  );
  assertEquals(buildKnownEntityRef("DC Court of Appeals"), "dc.court_of_appeals");
  assertEquals(buildKnownEntityRef("DC Superior Court"), "dc.superior_court");
  assertEquals(
    buildKnownEntityRef("Office of the People’s Counsel"),
    "dc.office_of_the_people_s_counsel_for_the_district_of_columbia",
  );
  assertEquals(
    buildKnownEntityRef(
      "Mayor's Office of Lesbian, Gay, Bisexual, Transgender and Questioning Affairs (LGBTQ) Affairs",
    ),
    "dc.mayor_s_office_of_lesbian_gay_bisexual_transgender_and_questioning_affairs",
  );
  assertEquals(
    buildKnownEntityRef(
      "Mayor's Office of Lesbian, Gay, Bisexual, Transgender and Questioning Affairs Affairs",
    ),
    "dc.mayor_s_office_of_lesbian_gay_bisexual_transgender_and_questioning_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Office of Neighbor Safety and Engagement (ONSE)"),
    "dc.office_of_neighborhood_safety_and_engagement",
  );
  assertEquals(
    buildKnownEntityRef("Office of Neighbor Safety and Engagement"),
    "dc.office_of_neighborhood_safety_and_engagement",
  );
  assertEquals(
    buildKnownEntityRef("Office of the Ombudsmen for Children (OFC)"),
    "dc.office_of_the_ombudsperson_for_children",
  );
  assertEquals(
    buildKnownEntityRef("Office of the Ombudsmen for Children"),
    "dc.office_of_the_ombudsperson_for_children",
  );
  assertEquals(
    buildKnownEntityRef("DC Department of Human Resources (DCHR)"),
    "dc.department_of_human_resources",
  );
  assertEquals(
    buildKnownEntityRef("DC Department of Human Resources"),
    "dc.department_of_human_resources",
  );
  assertEquals(
    buildKnownEntityRef("Department of Youth Rehabilitative Services"),
    "dc.department_of_youth_rehabilitation_services",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Committee on Child Abuse and Neglect"),
    "dc.mayor_s_advisory_committee_on_child_abuse_and_neglect",
  );
  assertEquals(
    buildKnownEntityRef("Chief Medical Examiner (CME)"),
    "dc.office_of_the_chief_medical_examiner",
  );
  assertEquals(
    buildKnownEntityRef("Chief Medical Examiner"),
    "dc.office_of_the_chief_medical_examiner",
  );
  assertEquals(
    buildKnownEntityRef("Chief Technology Officer"),
    "dc.office_of_the_chief_technology_officer",
  );
  assertEquals(
    buildKnownEntityRef("Bicycle Advisory Council"),
    "dc.bicycle_advisory_council",
  );
  assertEquals(
    buildKnownEntityRef("Board of Barber and Cosmetology"),
    "dc.board_of_barber_and_cosmetology",
  );
  assertEquals(
    buildKnownEntityRef("Commission on Aging"),
    "dc.commission_on_aging",
  );
  assertEquals(
    buildKnownEntityRef("Health Information Exchange Policy Board"),
    "dc.health_information_exchange_policy_board_hie",
  );
  assertEquals(
    buildKnownEntityRef("Board of Review of Anti-Deficiency Violations"),
    "dc.board_of_review_for_anti_deficiency_violations",
  );
  assertEquals(
    buildKnownEntityRef("Citizen Review Panel on Child Abuse and Neglect"),
    "dc.citizen_review_panel_for_child_abuse_and_neglect",
  );
  assertEquals(
    buildKnownEntityRef("Sentencing Commission"),
    "dc.district_of_columbia_sentencing_commission",
  );
  assertEquals(
    buildKnownEntityRef("Commission on Nightlife and Culture"),
    "dc.commission_on_nightlife_and_culture",
  );
  assertEquals(
    buildKnownEntityRef("Commission on Women"),
    "dc.commission_for_women",
  );
  assertEquals(
    buildKnownEntityRef("District of Columbia Sentencing Commission"),
    "dc.district_of_columbia_sentencing_commission",
  );
  assertEquals(
    buildKnownEntityRef("Destination DC"),
    "dc.washington_d_c_convention_and_tourism_corporation",
  );
  assertEquals(
    buildKnownEntityRef("Department of Consumer and Regulatory Affairs"),
    "dc.department_of_licensing_and_consumer_protection",
  );
  assertEquals(
    buildKnownEntityRef("Deputy Mayor for Planning and Economic Development (DMPED)"),
    "dc.office_of_the_deputy_mayor_for_planning_and_economic_development",
  );
  assertEquals(
    buildKnownEntityRef("Deputy Mayor for Public Safety and Justice/Operations (DMPSJ/O)"),
    "dc.office_of_the_deputy_mayor_for_public_safety_and_justice",
  );
  assertEquals(
    buildKnownEntityRef("Inspector General"),
    "dc.office_of_the_inspector_general",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office on Asian and Pacific Islander Affairs"),
    "dc.mayor_s_office_on_asian_and_pacific_island_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office of Asian and Pacific Islander Affairs (MOAPIA)"),
    "dc.mayor_s_office_on_asian_and_pacific_island_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office of African Affairs"),
    "dc.mayor_s_office_on_african_affairs",
  );
  assertEquals(
    buildKnownEntityRef(
      "Mayor's Office of Lesbian, Gay, Bisexual and Questioning Affairs (LGBTQA)",
    ),
    "dc.mayor_s_office_of_lesbian_gay_bisexual_transgender_and_questioning_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office of Women's Policy Initiatives (MOWPI)"),
    "dc.mayor_s_office_on_women_s_policy_and_initiatives",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office on Returning Citizen's Affairs (MORCA)"),
    "dc.mayor_s_office_on_returning_citizen_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Mayor's Office on Religious Affairs (MORA)"),
    "dc.mayor_s_office_of_religious_affairs",
  );
  assertEquals(
    buildKnownEntityRef("MODDHH"),
    "dc.office_for_the_deaf_deafblind_and_hard_of_hearing",
  );
  assertEquals(buildKnownEntityRef("MOPI"), "dc.mayor_s_office_of_policy_and_innovation");
  assertEquals(
    buildKnownEntityRef("MPD"),
    "dc.metropolitan_police_department",
  );
  assertEquals(
    buildKnownEntityRef("Office on Returning Citizen Affairs"),
    "dc.mayor_s_office_on_returning_citizen_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Office of City Administrator"),
    "dc.office_of_the_city_administrator",
  );
  assertEquals(
    buildKnownEntityRef("Office of Religious Affairs"),
    "dc.mayor_s_office_of_religious_affairs",
  );
  assertEquals(
    buildKnownEntityRef("Public Charter School Board (PCSB)"),
    "dc.public_charter_school_board_pcsb",
  );
  assertEquals(
    buildKnownEntityRef("DC Public Charter School Board"),
    "dc.public_charter_school_board_pcsb",
  );
  assertEquals(
    buildKnownEntityRef("Rental Housing Commission"),
    "dc.rental_housing_commission",
  );
  assertEquals(
    buildKnownEntityRef("Secretary of State of the District of Columbia"),
    "dc.office_of_the_secretary",
  );
  assertEquals(
    buildKnownEntityRef("Office on Caribbean Community Affairs"),
    "dc.office_on_caribbean_affairs",
  );
  assertEquals(buildKnownEntityRef("CCRC"), "dc.criminal_code_reform_commission");
  assertEquals(buildKnownEntityRef("SBOE"), "dc.dc_state_board_of_education");
  assertEquals(
    buildKnownEntityRef("State Superintendent of Education"),
    "dc.office_of_the_state_superintendent_of_education",
  );
});

Deno.test("known relationship endpoint aliases keep role and subunit labels as candidates", () => {
  for (
    const name of [
      "UDC Community College",
      "Chief Information Security Officer (CISO) Designee",
      "Department on Disability Services (DDS) Vocational Rehabilitation Counselor Designee",
      "Hospital in the District Designee",
      "Vocational, Community, or Business Organization Representative designee",
      "Director of the Office of Budget and Performance Management (OBPM) Designee",
      "Office of the Chief of Staff (COS) Designee",
      "DC ReEngagement Center Designee",
      "Senior Advisor to the Mayor designee",
    ]
  ) {
    assertEquals(buildKnownEntityRef(name), buildEntityId(name));
  }
});

Deno.test("public-body seat relationship inverses stay user-facing", () => {
  assertEquals(inverseRelationshipType("has_seat"), "seat_on");
  assertEquals(inverseRelationshipType("has_status"), "status_of");
  assertEquals(inverseRelationshipType("designated_by"), "designates");
});

Deno.test("recognized legal entrypoints auto-accept and update release status truth", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
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

  const items = workbench.listReviewItems({ mode: "legal" });
  assertEquals(items.length, 0);

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
  const legalRefs = workbench.db.prepare(
    "select citation_text as citationText from legal_refs order by citation_text",
  ).all() as Array<{ citationText: string }>;
  workbench.close();
  assertEquals(statuses.get("accepted"), 3);
  assertEquals(types.get("dc_code"), 1);
  assertEquals(types.get("dc_register"), 1);
  assertEquals(types.get("mayors_order"), 1);
  assert(!legalRefs.some((row) => row.citationText === "Laws, Regulations and Courts"));
  assert(!legalRefs.some((row) => row.citationText === "Mayor"));
});

Deno.test("batch accept-safe skips remaining ambiguous legal refs after safe import auto-accept", async () => {
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
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.unknown_review",
      "Mystery legal authority",
      "https://example.com/mystery-legal-authority",
    ),
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
      "legal",
      "--subject-prefix",
      "legal.test.signature.legal_refs",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted 0 safe review item(s).");
  assertStringIncludes(batchText, "Skipped 1 item(s) that were not safe to auto-accept.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const statuses = reopened.db.prepare(
    "select review_status as reviewStatus, count(*) as count from legal_refs group by review_status",
  ).all() as Array<{ reviewStatus: string; count: number }>;
  const statusCounts = new Map(statuses.map((row) => [row.reviewStatus, row.count]));
  const pendingItem = reopened.listReviewItems({ mode: "legal" })[0];
  reopened.close();
  assertEquals(statusCounts.get("accepted"), 3);
  assertEquals(statusCounts.get("pending"), 1);
  assertEquals(pendingItem.details.refType, "unknown");
});

Deno.test("batch defer-default marks scoped legal refs deferred without changing legal ref status", async () => {
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
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.unknown_defer",
      "Mystery legal authority",
      "https://example.com/mystery-legal-authority",
    ),
    dataDir,
  );
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
      "legal.test.signature.legal_refs",
      "--ref-type",
      "unknown",
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
  assertEquals(listed.items[0].details.refType, "unknown");

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
      "defer-default",
      "--mode",
      "legal",
      "--subject-prefix",
      "legal.test.signature.legal_refs",
      "--ref-type",
      "unknown",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(deferOutput.stdout),
    "Deferred 1 default-defer review item(s).",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const deferred = reopened.listReviewItems({
    mode: "legal",
    status: "deferred",
    subjectPrefix: "legal.test.signature.legal_refs",
    refType: "unknown",
  });
  const legalRef = reopened.db.prepare(
    "select review_status as reviewStatus from legal_refs where legal_ref_id = 'legal.test.signature.legal_refs.unknown_defer'",
  ).get() as { reviewStatus: string };
  reopened.close();
  assertEquals(deferred.length, 1);
  assertEquals(legalRef.reviewStatus, "pending");
});

Deno.test("blocked relationships stay out of the live review order while entity review remains stable", async () => {
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
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_queue.entities",
      candidateId: "candidate.test.review_queue.entities.example",
      sourceItemKey: "review-queue-entity-row",
      proposedEntityId: "dc.review_queue_entity",
      name: "Review Queue Entity",
      kind: "board",
      observedName: "Review Queue Entity",
    }),
    dataDir,
  );
  const items = workbench.listReviewItems();
  const blockedSubjectIds = new Set(
    workbench.db.prepare(
      "select subject_id as subjectId from reconciliation_items where subject_type = 'relationship_candidate' and state = 'blocked'",
    ).all().map((row) => (row as { subjectId: string }).subjectId),
  );
  const blockedRelationships = workbench.db.prepare(
    "select count(*) as count from reconciliation_items where subject_type = 'relationship_candidate' and state = 'blocked'",
  ).get() as { count: number };
  workbench.close();
  assert(blockedRelationships.count > 0);
  assert(items.every((item) => item.itemType !== "source_status"));
  assert(items.every((item) => !blockedSubjectIds.has(item.subjectId)));
  assert(items.some((item) => item.itemType === "entity_candidate"));
});

Deno.test("review list filters by mode, status, type, and subject prefix", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
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
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_list.entities",
      candidateId: "candidate.test.review_list.entities.example",
      sourceItemKey: "review-list-entity-row",
      proposedEntityId: "dc.review_list_entity",
      name: "Review List Entity",
      kind: "board",
      observedName: "Review List Entity",
    }),
    dataDir,
  );
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.corrections_information_council', 'Corrections Information Council', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.review_list_oversight",
      sourceItemKey: "review-list-oversight-row",
      fromEntityRef: "dc.corrections_information_council",
      toEntityRef: "dc.council_of_the_district_of_columbia",
      relationshipType: "overseen_by",
      rawValue: "Corrections Information Council (excluding archived records)",
      needsReview: true,
    }),
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
      "candidate.test.review_list",
      "--db",
      dbPath,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.code, 0);
  const text = new TextDecoder().decode(output.stdout);
  assertStringIncludes(text, "Browse rows:");
  assertStringIncludes(text, "[open browse] Review List Entity");
  assertStringIncludes(text, "entity candidate | board | default accept");
  assertStringIncludes(text, "source: test.review_list.entities / Custom entity row");
  assertStringIncludes(
    text,
    "ids: subject=candidate.test.review_list.entities.example",
  );
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
      "candidate.test.review_list",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const json = JSON.parse(new TextDecoder().decode(jsonOutput.stdout)) as {
    count: number;
    items: Array<{ itemType: string; subjectId: string; workKind: string; humanDecision: boolean }>;
  };
  assertEquals(jsonOutput.code, 0);
  assertEquals(json.count, json.items.length);
  assert(json.items.every((item) => item.itemType === "entity_candidate"));
  assert(json.items.every((item) => item.subjectId.startsWith("candidate.test.review_list")));
  assert(json.items.every((item) => item.workKind === "browse"));
  assert(json.items.every((item) => item.humanDecision === false));

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
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees.review_list_oversight",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const relationshipTypeJson = JSON.parse(
    new TextDecoder().decode(relationshipTypeJsonOutput.stdout),
  ) as {
    count: number;
    items: Array<{
      itemType: string;
      subjectId: string;
      workKind: string;
      humanDecision: boolean;
      details: { relationshipType: string };
    }>;
  };
  assertEquals(relationshipTypeJsonOutput.code, 0);
  assert(relationshipTypeJson.count > 0);
  assert(
    relationshipTypeJson.items.every((item) =>
      item.itemType === "relationship_candidate" &&
      item.subjectId.startsWith("relationship.council.committees.review_list_oversight") &&
      item.details.relationshipType === "overseen_by" &&
      item.workKind === "decision" &&
      item.humanDecision === true
    ),
  );

  const decisionsJsonOutput = await new Deno.Command(Deno.execPath(), {
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
      "open",
      "--subject-prefix",
      "review_list",
      "--decisions",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const decisionsJson = JSON.parse(new TextDecoder().decode(decisionsJsonOutput.stdout)) as {
    count: number;
    items: Array<{ subjectId: string; workKind: string; humanDecision: boolean }>;
  };
  assertEquals(decisionsJsonOutput.code, 0);
  assertEquals(decisionsJson.count, 1);
  assertEquals(
    decisionsJson.items[0]?.subjectId,
    "relationship.council.committees.review_list_oversight",
  );
  assertEquals(decisionsJson.items[0]?.workKind, "decision");
  assertEquals(decisionsJson.items[0]?.humanDecision, true);

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
      "relationship.council.committees.review_list_oversight",
      "--raw-value-contains",
      "Corrections",
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
  assertEquals(rawValueContainsJson.count, 1);
  assert(
    rawValueContainsJson.items.every((item) =>
      item.details.relationshipType === "overseen_by" &&
      item.details.rawValue.includes("Corrections")
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
      "entities",
      "--status",
      "open",
      "--type",
      "entity_candidate",
      "--subject-prefix",
      "candidate.test.review_list",
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

  const sourcePacketJsonOutput = await new Deno.Command(Deno.execPath(), {
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
      "packets",
      "--source",
      "council.committees",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const sourcePacketJson = JSON.parse(
    new TextDecoder().decode(sourcePacketJsonOutput.stdout),
  ) as { count: number; packets: Array<{ sourceId: string }> };
  assertEquals(sourcePacketJsonOutput.code, 0);
  assert(sourcePacketJson.count > 0);
  assert(sourcePacketJson.packets.every((packet) => packet.sourceId === "council.committees"));
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
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.deferred.entities.one",
      candidateId: "candidate.test.deferred.entities.one",
      sourceItemKey: "deferred-entity-row-one",
      proposedEntityId: "dc.deferred_entity_one",
      name: "Deferred Entity One",
      kind: "board",
      observedName: "Deferred Entity One",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.deferred.entities.two",
      candidateId: "candidate.test.deferred.entities.two",
      sourceItemKey: "deferred-entity-row-two",
      proposedEntityId: "dc.deferred_entity_two",
      name: "Deferred Entity Two",
      kind: "board",
      observedName: "Deferred Entity Two",
    }),
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
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.batch_accept_safe.entities",
      candidateId: "candidate.test.batch_accept_safe.entities.example",
      sourceItemKey: "batch-accept-safe-entity-row",
      proposedEntityId: "dc.batch_accept_safe_entity",
      name: "Batch Accept Safe Entity",
      kind: "board",
      observedName: "Batch Accept Safe Entity",
      confidence: 0.99,
    }),
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
  const blockedRelationships = reopened.db.prepare(
    "select count(*) as count from reconciliation_items where subject_type = 'relationship_candidate' and state = 'blocked'",
  ).get() as { count: number };
  reopened.close();
  assert(blockedRelationships.count > 0);
});

Deno.test("entity candidates that conflict with accepted kind default to defer", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.conflicted_body', 'Conflicted Body', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.conflicted_entity_kind",
      candidateId: "candidate.test.conflicted_entity_kind.board",
      sourceItemKey: "conflicted-entity-row",
      proposedEntityId: "dc.conflicted_body",
      name: "Conflicted Body",
      kind: "board",
      observedName: "Conflicted Body",
      confidence: 0.99,
    }),
    dataDir,
  );
  const reviewItem = workbench.listReviewItems({ type: "entity_candidate" })[0];
  assertEquals(reviewItem.defaultAction, "defer");
  assertEquals(
    reviewItem.reason,
    "Resolve entity candidate that conflicts with an accepted entity",
  );
  assertStringIncludes(
    JSON.stringify(reviewItem.details),
    "Candidate kind board conflicts with accepted agency for the same entity id.",
  );
  const entityView = workbench.entityView("dc.conflicted_body");
  assertEquals(entityView.reviewItems.length, 1);
  assertEquals(entityView.reviewItems[0]?.subjectId, "candidate.test.conflicted_entity_kind.board");
  assertEquals(entityView.reviewItems[0]?.defaultAction, "defer");
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
  assertStringIncludes(batchText, "Accepted 0 safe review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const candidate = reopened.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = 'candidate.test.conflicted_entity_kind.board'",
  ).get() as { reviewStatus: string };
  const canonical = reopened.db.prepare(
    "select kind, merged_candidate_ids as mergedCandidateIds from canonical_entities where entity_id = 'dc.conflicted_body'",
  ).get() as { kind: string; mergedCandidateIds: string };
  reopened.close();
  assertEquals(candidate.reviewStatus, "pending");
  assertEquals(canonical.kind, "agency");
  assertEquals(canonical.mergedCandidateIds, "[]");
});

Deno.test("entity conflict review context is loaded in bulk during import", async () => {
  const onePrepareCount = await countConflictContextLookupPrepares(1);
  const manyPrepareCount = await countConflictContextLookupPrepares(8);

  assertEquals(manyPrepareCount, onePrepareCount);
  assertEquals(manyPrepareCount, 1);
});

Deno.test("legal refs for unresolved same-entity kind conflicts stay unattached until candidate acceptance", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const outDir = join(dir, "release");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.conflicted_legal_body', 'Conflicted Legal Body', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  const parsedRef = parseLegalReference(
    "D.C. Official Code § 1-204.04",
    "https://code.dccouncil.us/us/dc/council/code/sections/1-204.04",
  );
  const candidateId = "candidate.test.conflicted_entity_kind.legal_board";
  const legalRefId = "legal.test.conflicted_entity_kind.legal_board_authority";
  const connectorResult: ConnectorResult = {
    source: {
      sourceId: "test.conflicted_entity_kind_legal_refs",
      title: "Test Conflicted Entity Kind Legal Refs",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/conflicted-entity-kind-legal-refs",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.conflicted_entity_kind_legal_refs.main",
        sourceId: "test.conflicted_entity_kind_legal_refs",
        title: "Conflicted entity legal ref rows",
        kind: "fixture",
        url: "https://example.com/conflicted-entity-kind-legal-refs",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/conflicted-entity-kind-legal-refs",
        contentText: JSON.stringify({ candidateId, legalRefId }),
      }],
      parsed: {
        items: [{
          itemKey: "conflicted-legal-row",
          itemType: "fixture_row",
          title: "Conflicted legal row",
          body: { name: "Conflicted Legal Body" },
        }],
        entityCandidates: [{
          candidateId,
          sourceItemKey: "conflicted-legal-row",
          proposedEntityId: "dc.conflicted_legal_body",
          name: "Conflicted Legal Body",
          kind: "board",
          confidence: 0.99,
          evidence: [{
            fieldPath: "name",
            observedValue: "Conflicted Legal Body",
          }],
        }],
        legalRefs: [{
          legalRefId,
          sourceItemKey: "conflicted-legal-row",
          refType: parsedRef.refType,
          citationText: "D.C. Official Code § 1-204.04",
          normalizedCitation: parsedRef.normalizedCitation,
          url: "https://code.dccouncil.us/us/dc/council/code/sections/1-204.04",
          needsReview: true,
          attachEntityRef: "dc.conflicted_legal_body",
          evidence: [{
            fieldPath: "authority",
            observedValue: "D.C. Official Code § 1-204.04",
          }],
        }],
        reviewItems: [{
          reviewItemId: buildReviewItemId(candidateId, "entity-review"),
          itemType: "entity_candidate",
          subjectId: candidateId,
          reason: "Review fixture entity candidate",
          defaultAction: "accept",
          details: {
            name: "Conflicted Legal Body",
            kind: "board",
          },
        }],
      },
    }],
  };

  await workbench.importConnectorResult(connectorResult, dataDir);

  const candidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = ?",
  ).get(candidateId) as { reviewStatus: string };
  const legalRef = workbench.db.prepare(
    "select review_status as reviewStatus from legal_refs where legal_ref_id = ?",
  ).get(legalRefId) as { reviewStatus: string };
  assertEquals(candidate.reviewStatus, "pending");
  assertEquals(legalRef.reviewStatus, "pending");
  assertEquals(workbench.entityLegalRefs(), []);
  assertEquals(workbench.entityView("dc.conflicted_legal_body").legalRefs, []);

  await buildV2Release(workbench, outDir);
  const releasedEntityLegalRefs = JSON.parse(
    await Deno.readTextFile(join(outDir, "entity_legal_refs.json")),
  );
  assertEquals(releasedEntityLegalRefs, []);

  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: candidateId,
      payload: {},
    },
    resolutionsDir,
  );

  assertEquals(workbench.entityLegalRefs(), [{
    entity_id: "dc.conflicted_legal_body",
    entity_name: "Conflicted Legal Body",
    legal_ref_id: legalRefId,
    ref_type: "dc_code",
    citation_text: "D.C. Official Code § 1-204.04",
    normalized_citation: "D.C. Code 1-204.04",
    url: "https://code.dccouncil.us/us/dc/council/code/sections/1-204.04",
    review_status: "pending",
  }]);
  workbench.close();
});

Deno.test("safe seeded Council oversight endpoints auto-promote and auto-accept the unblocked relationship", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.committee_on_the_judiciary_and_public_safety', 'Committee on the Judiciary and Public Safety', 'committee', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.batch_seeded_oversight",
      sourceItemKey: "batch-seeded-oversight-row",
      fromEntityRef: "dc.child_support_guideline_commission",
      toEntityRef: "dc.committee_on_the_judiciary_and_public_safety",
      relationshipType: "overseen_by",
      rawValue: "Child Support Guideline Commission",
    }),
    dataDir,
  );
  workbench.close();

  const reopenedAfterImport = new Workbench(dbPath);
  reopenedAfterImport.init();
  const seededAfterImport = reopenedAfterImport.db.prepare(
    `select entity_id as entityId, review_status as reviewStatus
     from canonical_entities
     where entity_id = 'dc.child_support_guideline_commission'`,
  ).get() as { entityId: string; reviewStatus: string } | undefined;
  const acceptedAfterImport = reopenedAfterImport.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.child_support_guideline_commission:overseen_by:dc.committee_on_the_judiciary_and_public_safety'`,
  ).get() as { relationshipId: string } | undefined;
  const remainingSeededEntityReview = reopenedAfterImport.listReviewItems({
    mode: "entities",
    subjectPrefix:
      "candidate.council.committees.relationship_council_committees_batch_seeded_oversight",
  });
  reopenedAfterImport.close();
  assertEquals(seededAfterImport?.entityId, "dc.child_support_guideline_commission");
  assertEquals(seededAfterImport?.reviewStatus, "accepted");
  assertEquals(
    acceptedAfterImport?.relationshipId,
    "dc.child_support_guideline_commission:overseen_by:dc.committee_on_the_judiciary_and_public_safety",
  );
  assertEquals(remainingSeededEntityReview.length, 0);

  const entityBatchOutput = await new Deno.Command(Deno.execPath(), {
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
      "candidate.council.committees.relationship_council_committees_batch_seeded_oversight",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(entityBatchOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(entityBatchOutput.stdout),
    "Accepted 0 safe review item(s).",
  );

  const reopenedAfterEntityBatch = new Workbench(dbPath);
  reopenedAfterEntityBatch.init();
  const seededEntity = reopenedAfterEntityBatch.db.prepare(
    `select entity_id as entityId, review_status as reviewStatus
     from canonical_entities
     where entity_id = 'dc.child_support_guideline_commission'`,
  ).get() as { entityId: string; reviewStatus: string } | undefined;
  const acceptedAfterEntityBatch = reopenedAfterEntityBatch.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.child_support_guideline_commission:overseen_by:dc.committee_on_the_judiciary_and_public_safety'`,
  ).get() as { relationshipId: string } | undefined;
  const reviewReadyOversight = reopenedAfterEntityBatch.listReviewItems({
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees.batch_seeded_oversight",
  });
  reopenedAfterEntityBatch.close();
  assertEquals(seededEntity?.entityId, "dc.child_support_guideline_commission");
  assertEquals(seededEntity?.reviewStatus, "accepted");
  assertEquals(
    acceptedAfterEntityBatch?.relationshipId,
    "dc.child_support_guideline_commission:overseen_by:dc.committee_on_the_judiciary_and_public_safety",
  );
  assertEquals(reviewReadyOversight.length, 0);

  const relationshipBatchOutput = await new Deno.Command(Deno.execPath(), {
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
      "relationship.council.committees.batch_seeded_oversight",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(relationshipBatchOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(relationshipBatchOutput.stdout),
    "Accepted 0 safe review item(s).",
  );

  const reopenedAfterRelationshipBatch = new Workbench(dbPath);
  reopenedAfterRelationshipBatch.init();
  const acceptedRelationship = reopenedAfterRelationshipBatch.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.child_support_guideline_commission:overseen_by:dc.committee_on_the_judiciary_and_public_safety'`,
  ).get() as { relationshipId: string } | undefined;
  const remainingOversight = reopenedAfterRelationshipBatch.listReviewItems({
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees.batch_seeded_oversight",
  });
  reopenedAfterRelationshipBatch.close();
  assertEquals(
    acceptedRelationship?.relationshipId,
    "dc.child_support_guideline_commission:overseen_by:dc.committee_on_the_judiciary_and_public_safety",
  );
  assertEquals(remainingOversight.length, 0);
});

Deno.test("Council oversight endpoint can seed Council and auto-accept the explicit edge", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.committee_of_the_whole', 'Committee of the Whole', 'committee', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.self_seeded_oversight",
      sourceItemKey: "self-seeded-oversight-row",
      fromEntityRef: "dc.council_of_the_district_of_columbia",
      toEntityRef: "dc.committee_of_the_whole",
      relationshipType: "overseen_by",
      rawValue: "Council of the District of Columbia",
    }),
    dataDir,
  );

  const seededEndpointCandidates = workbench.db.prepare(
    `select candidate_id as candidateId
     from entity_candidates
     where proposed_entity_id = 'dc.council_of_the_district_of_columbia'`,
  ).all() as Array<{ candidateId: string }>;
  const seededEntityReview = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix:
      "candidate.council.committees.relationship_council_committees_self_seeded_oversight",
  });
  const acceptedRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.council_of_the_district_of_columbia:overseen_by:dc.committee_of_the_whole'`,
  ).get() as { relationshipId: string } | undefined;
  workbench.close();

  assertEquals(seededEndpointCandidates, [{
    candidateId:
      "candidate.council.committees.relationship_council_committees_self_seeded_oversight_from_endpoint",
  }]);
  assertEquals(seededEntityReview.length, 0);
  assertEquals(
    acceptedRelationship?.relationshipId,
    "dc.council_of_the_district_of_columbia:overseen_by:dc.committee_of_the_whole",
  );
});

Deno.test("safe seeded Council member container endpoint auto-promotes and unblocks seat structure", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.ward_1_council_seat', 'Ward 1 Council Seat', 'council_role', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.members",
      relationshipCandidateId: "relationship.council.members.ward_1_council_seat_council_part_of",
      sourceItemKey: "council-members-page",
      fromEntityRef: "dc.ward_1_council_seat",
      toEntityRef: "dc.council_of_the_district_of_columbia",
      relationshipType: "part_of",
      rawValue: "Council of the District of Columbia",
      needsReview: false,
    }),
    dataDir,
  );

  const council = workbench.db.prepare(
    `select entity_id as entityId, review_status as reviewStatus
     from canonical_entities
     where entity_id = 'dc.council_of_the_district_of_columbia'`,
  ).get() as { entityId: string; reviewStatus: string } | undefined;
  const relationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.ward_1_council_seat:part_of:dc.council_of_the_district_of_columbia'`,
  ).get() as { relationshipId: string } | undefined;
  const reviewItems = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix:
      "candidate.council.members.relationship_council_members_ward_1_council_seat_council_part_of",
  });
  const blockers = workbench.db.prepare(
    "select count(*) as count from reconciliation_items where subject_id = 'relationship.council.members.ward_1_council_seat_council_part_of'",
  ).get() as { count: number };
  workbench.close();

  assertEquals(council?.entityId, "dc.council_of_the_district_of_columbia");
  assertEquals(council?.reviewStatus, "accepted");
  assertEquals(
    relationship?.relationshipId,
    "dc.ward_1_council_seat:part_of:dc.council_of_the_district_of_columbia",
  );
  assertEquals(reviewItems.length, 0);
  assertEquals(blockers.count, 0);
});

Deno.test("safe seeded DCGIS governing-agency endpoints auto-promote and auto-accept the unblocked relationship", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.commission_on_out_of_school_time_grants_and_youth_outcomes', 'Commission on Out of School Time Grants and Youth Outcomes', 'commission', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "dcgis.boards_commissions_councils",
      relationshipCandidateId:
        "relationship.dcgis.boards_commissions_councils.batch_seeded_governing_agency",
      sourceItemKey: "batch-seeded-governing-agency-row",
      fromEntityRef: "dc.commission_on_out_of_school_time_grants_and_youth_outcomes",
      toEntityRef: "dc.office_of_out_of_school_time_grants_and_youth_outcomes",
      relationshipType: "governed_by",
      rawValue: "Office of Out of School Time Grants and Youth Outcomes",
      needsReview: false,
    }),
    dataDir,
  );
  workbench.close();

  const reopenedAfterImport = new Workbench(dbPath);
  reopenedAfterImport.init();
  const seededAfterImport = reopenedAfterImport.db.prepare(
    `select entity_id as entityId, review_status as reviewStatus
     from canonical_entities
     where entity_id = 'dc.office_of_out_of_school_time_grants_and_youth_outcomes'`,
  ).get() as { entityId: string; reviewStatus: string } | undefined;
  const acceptedAfterImport = reopenedAfterImport.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.commission_on_out_of_school_time_grants_and_youth_outcomes:governed_by:dc.office_of_out_of_school_time_grants_and_youth_outcomes'`,
  ).get() as { relationshipId: string } | undefined;
  const remainingSeededEntityReview = reopenedAfterImport.listReviewItems({
    mode: "entities",
    subjectPrefix:
      "candidate.dcgis.boards_commissions_councils.relationship_dcgis_boards_commissions_councils_batch_seeded_governing_agency",
  });
  reopenedAfterImport.close();
  assertEquals(
    seededAfterImport?.entityId,
    "dc.office_of_out_of_school_time_grants_and_youth_outcomes",
  );
  assertEquals(seededAfterImport?.reviewStatus, "accepted");
  assertEquals(
    acceptedAfterImport?.relationshipId,
    "dc.commission_on_out_of_school_time_grants_and_youth_outcomes:governed_by:dc.office_of_out_of_school_time_grants_and_youth_outcomes",
  );
  assertEquals(remainingSeededEntityReview.length, 0);

  const entityBatchOutput = await new Deno.Command(Deno.execPath(), {
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
      "candidate.dcgis.boards_commissions_councils.relationship_dcgis_boards_commissions_councils_batch_seeded_governing_agency",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(entityBatchOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(entityBatchOutput.stdout),
    "Accepted 0 safe review item(s).",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const seededEntity = reopened.db.prepare(
    `select entity_id as entityId, review_status as reviewStatus
     from canonical_entities
     where entity_id = 'dc.office_of_out_of_school_time_grants_and_youth_outcomes'`,
  ).get() as { entityId: string; reviewStatus: string } | undefined;
  const acceptedRelationship = reopened.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.commission_on_out_of_school_time_grants_and_youth_outcomes:governed_by:dc.office_of_out_of_school_time_grants_and_youth_outcomes'`,
  ).get() as { relationshipId: string } | undefined;
  const remainingRelationshipReview = reopened.listReviewItems({
    mode: "relationships",
    relationshipType: "governed_by",
    subjectPrefix: "relationship.dcgis.boards_commissions_councils.batch_seeded_governing_agency",
  });
  reopened.close();
  assertEquals(
    seededEntity?.entityId,
    "dc.office_of_out_of_school_time_grants_and_youth_outcomes",
  );
  assertEquals(seededEntity?.reviewStatus, "accepted");
  assertEquals(
    acceptedRelationship?.relationshipId,
    "dc.commission_on_out_of_school_time_grants_and_youth_outcomes:governed_by:dc.office_of_out_of_school_time_grants_and_youth_outcomes",
  );
  assertEquals(remainingRelationshipReview.length, 0);
});

Deno.test("batch accept-safe skips non-committee seeded endpoint candidates", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.seeded.batch",
      relationshipCandidateId: "relationship.test.seeded.batch.direct_endpoint",
      sourceItemKey: "direct-endpoint-row",
      fromEntityRef: "dc.parent_entity",
      toEntityRef: "dc.batch_safe_unknown_board",
      relationshipType: "part_of",
      rawValue: "Batch Safe Unknown Board",
      needsReview: false,
    }),
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
      "candidate.test.seeded.batch.relationship_test_seeded_batch_direct_endpoint",
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
  assertStringIncludes(batchText, "Accepted 0 safe review item(s).");
  assertStringIncludes(batchText, "Skipped 1 item(s) that were not safe to auto-accept.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const candidateStatus = reopened.db.prepare(
    `select review_status as reviewStatus
     from entity_candidates
     where candidate_id = 'candidate.test.seeded.batch.relationship_test_seeded_batch_direct_endpoint_to_endpoint'`,
  ).get() as { reviewStatus: string } | undefined;
  const canonicalEntity = reopened.db.prepare(
    `select entity_id as entityId
     from canonical_entities
     where entity_id = 'dc.batch_safe_unknown_board'`,
  ).get() as { entityId: string } | undefined;
  reopened.close();
  assertEquals(candidateStatus?.reviewStatus, "pending");
  assertEquals(canonicalEntity, undefined);
});

Deno.test("accepted-endpoint filtered Council oversight relationships no longer wait for batch accept-safe", async () => {
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
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees.committee_on_health_oversight",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted 0 safe review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const acceptedOversight = reopened.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'overseen_by' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  const unresolvedOversight = reopened.listReviewItems({
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees.committee_on_health_oversight",
  });
  reopened.close();
  assertEquals(acceptedOversight.map((row) => row.relationshipId), [
    "dc.dc_health:overseen_by:dc.committee_on_health",
    "dc.department_of_behavioral_health:overseen_by:dc.committee_on_health",
    "dc.district_of_columbia_public_schools:overseen_by:dc.committee_of_the_whole",
    "dc.office_of_the_state_superintendent_of_education:overseen_by:dc.committee_of_the_whole",
  ]);
  assertEquals(unresolvedOversight.length, 0);
});

Deno.test("accepted-endpoint scoped Council oversight no longer waits for batch accept-safe", async () => {
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
  assertStringIncludes(batchText, "Accepted 0 safe review item(s).");

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
  const blockedOversight = reopened.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_type = 'relationship_candidate'
       and subject_id like 'relationship.council.committees.%'
       and details_json like '%"relationshipType":"overseen_by"%'`,
  ).get() as { count: number };
  reopened.close();
  assert(
    acceptedOversight.some((row) =>
      row.relationshipId ===
        "dc.department_of_behavioral_health:overseen_by:dc.committee_on_health"
    ),
  );
  assert(
    acceptedOversight.some((row) =>
      row.relationshipId ===
        "dc.district_of_columbia_public_schools:overseen_by:dc.committee_of_the_whole"
    ),
  );
  assert(
    acceptedOversight.some((row) =>
      row.relationshipId ===
        "dc.office_of_the_state_superintendent_of_education:overseen_by:dc.committee_of_the_whole"
    ),
  );
  assertEquals(remainingOversight.length, 0);
  assertEquals(blockedOversight.count, 0);
});

Deno.test("accepted-endpoint Quickbase seat structure, status, and authority no longer wait for batch accept-safe", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const appointmentsCsvWithAlias = `${quickbaseAppointmentsCsvFixture.trim()}
"Commission on Nightlife and Culture (CNC)","Alcoholic Beverages and Cannabis Administration (ABCA) Designee","Filled","Mayoral Appointee, DC Agency Representative","Active"
`;
  await workbench.importConnectorResult(
    await getConnector("mota.quickbase").run(
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
    ),
    dataDir,
  );
  for (
    const subjectId of [
      "candidate.mota.quickbase.commission_on_nightlife_and_culture_cnc",
      "candidate.mota.quickbase.commission_on_nightlife_and_culture_cnc_seat_alcoholic_beverage_and_cannabis_administration_designee",
      "candidate.mota.quickbase.appointment_status_filled",
    ]
  ) {
    await workbench.appendResolutionEvent(
      { eventType: "accept_entity_candidate", subjectId, payload: {} },
      resolutionsDir,
    );
  }
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
    "review",
    "batch",
    "accept-safe",
    "--mode",
    "relationships",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
  ];

  const hasSeatOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      ...commonArgs,
      "--subject-prefix",
      "relationship.mota.quickbase",
      "--relationship-type",
      "has_seat",
      "--raw-value",
      "Alcoholic Beverages and Cannabis Administration (ABCA) Designee",
    ],
  }).output();
  assertEquals(hasSeatOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(hasSeatOutput.stdout),
    "Accepted 0 safe review item(s).",
  );

  const hasStatusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      ...commonArgs,
      "--subject-prefix",
      "relationship.mota.quickbase.commission_on_nightlife_and_culture_cnc_alcoholic_beverage_and_cannabis_administration_designee",
      "--relationship-type",
      "has_status",
    ],
  }).output();
  assertEquals(hasStatusOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(hasStatusOutput.stdout),
    "Accepted 0 safe review item(s).",
  );

  const designatedByOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      ...commonArgs,
      "--subject-prefix",
      "relationship.mota.quickbase",
      "--relationship-type",
      "designated_by",
    ],
  }).output();
  assertEquals(designatedByOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(designatedByOutput.stdout),
    "Accepted 0 safe review item(s).",
  );

  const appointedByOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      ...commonArgs,
      "--subject-prefix",
      "relationship.mota.quickbase",
      "--relationship-type",
      "appointed_by",
    ],
  }).output();
  assertEquals(appointedByOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(appointedByOutput.stdout),
    "Accepted 0 safe review item(s).",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const acceptedRelationships = reopened.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  const remainingSeatRelationships = reopened.listReviewItems({
    mode: "relationships",
    relationshipType: "has_seat",
    subjectPrefix: "relationship.mota.quickbase",
  });
  reopened.close();
  const relationshipIds = acceptedRelationships.map((row) => row.relationshipId);
  assert(
    relationshipIds.includes(
      "dc.commission_on_nightlife_and_culture:has_seat:dc.commission_on_nightlife_and_culture_cnc_alcoholic_beverage_and_cannabis_administration_designee",
    ),
  );
  assert(
    relationshipIds.includes(
      "dc.commission_on_nightlife_and_culture_cnc_alcoholic_beverage_and_cannabis_administration_designee:appointed_by:dc.mayor",
    ),
  );
  assert(
    relationshipIds.includes(
      "dc.commission_on_nightlife_and_culture_cnc_alcoholic_beverage_and_cannabis_administration_designee:designated_by:dc.alcoholic_beverage_and_cannabis_administration",
    ),
  );
  assert(
    relationshipIds.includes(
      "dc.commission_on_nightlife_and_culture_cnc_alcoholic_beverage_and_cannabis_administration_designee:has_status:status.filled",
    ),
  );
  assertEquals(remainingSeatRelationships.length, 0);
});

Deno.test("accepted-endpoint Quickbase appointee observation relationships no longer wait for batch accept-safe", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    await getConnector("mota.quickbase").run(
      createConnectorContext({
        fetcher: async (url: string) => {
          const body = (() => {
            switch (url) {
              case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
                return quickbaseFixture;
              case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
                return quickbaseAppointmentsCsvFixture;
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
    ),
    dataDir,
  );
  for (
    const subjectId of [
      "candidate.mota.quickbase.council_of_the_district_of_columbia_seat_chairperson",
      "candidate.mota.quickbase.appointment_status_filled",
      "candidate.mota.quickbase.appointee_observation_council_of_the_district_of_columbia_row_3_john_smith",
    ]
  ) {
    await workbench.appendResolutionEvent(
      { eventType: "accept_entity_candidate", subjectId, payload: {} },
      resolutionsDir,
    );
  }
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
    "review",
    "batch",
    "accept-safe",
    "--mode",
    "relationships",
    "--subject-prefix",
    "relationship.mota.quickbase.observation_council_of_the_district_of_columbia_row_3_john_smith",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
  ];

  const holdsOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [...commonArgs, "--relationship-type", "holds"],
  }).output();
  assertEquals(holdsOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(holdsOutput.stdout),
    "Accepted 0 safe review item(s).",
  );

  const statusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [...commonArgs, "--relationship-type", "has_status"],
  }).output();
  assertEquals(statusOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(statusOutput.stdout),
    "Accepted 0 safe review item(s).",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const acceptedRelationships = reopened.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  reopened.close();
  const relationshipIds = acceptedRelationships.map((row) => row.relationshipId);
  assert(
    relationshipIds.includes(
      "observation.council_of_the_district_of_columbia_row_3_john_smith:has_status:status.filled",
    ),
  );
  assert(
    relationshipIds.includes(
      "observation.council_of_the_district_of_columbia_row_3_john_smith:holds:dc.council_of_the_district_of_columbia_chairperson",
    ),
  );
});

Deno.test("DC Courts structure entities auto-promote and structural relationships no longer wait for batch accept-safe", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const dcgisRowsFixture = {
    features: [{
      attributes: {
        AGENCY_ID: 1014,
        AGENCY_NAME: "DC Court of Appeals",
        TYPE: "Agency",
        BRANCH: "Judicial",
        MAYORAL_CLUSTER: "Governmental Direction and Support",
        WEB_URL: "https://www.dccourts.gov/court-of-appeals",
        LEGISLATION: "",
      },
    }, {
      attributes: {
        AGENCY_ID: 1026,
        AGENCY_NAME: "DC Superior Court",
        TYPE: "Agency",
        BRANCH: "Judicial",
        MAYORAL_CLUSTER: "Governmental Direction and Support",
        WEB_URL: "https://www.dccourts.gov/",
        LEGISLATION: "",
      },
    }],
  };
  const dcgisFetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(dcgisRowsFixture);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return dcgisMetadataFixture as T;
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return dcgisRowsFixture as T;
        default:
          throw new Error(`Unexpected url ${url}`) as T;
      }
    },
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher: dcgisFetcher })),
    dataDir,
  );
  const dcgisCourtKinds = workbench.db.prepare(
    "select entity_id as entityId, kind from canonical_entities where entity_id in ('dc.court_of_appeals', 'dc.superior_court') order by entity_id",
  ).all() as Array<{ entityId: string; kind: string }>;
  assertEquals(dcgisCourtKinds, [
    { entityId: "dc.court_of_appeals", kind: "agency" },
    { entityId: "dc.superior_court", kind: "agency" },
  ]);

  const courtsFetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.dccourts.gov/":
          return dcCourtsHomeFixture;
        case "https://www.dccourts.gov/court-of-appeals":
          return dcCourtOfAppealsFixture;
        case "https://www.dccourts.gov/superior-court":
          return dcSuperiorCourtFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("dccourts.structure").run(
      createConnectorContext({ fetcher: courtsFetcher }),
    ),
    dataDir,
  );
  workbench.close();

  const reopenedAfterImport = new Workbench(dbPath);
  reopenedAfterImport.init();
  const remainingEntityReview = reopenedAfterImport.listReviewItems({
    mode: "entities",
    subjectPrefix: "candidate.dccourts.structure",
  });
  const acceptedAfterImport = reopenedAfterImport.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'part_of' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  const courtRowsAfterImport = reopenedAfterImport.db.prepare(
    "select entity_id as entityId, name, kind, branch, cluster from canonical_entities where entity_id in ('dc.court_of_appeals', 'dc.superior_court') order by entity_id",
  ).all() as Array<
    { entityId: string; name: string; kind: string; branch: string | null; cluster: string | null }
  >;
  reopenedAfterImport.close();
  assertEquals(remainingEntityReview.length, 0);
  assertEquals(acceptedAfterImport.length, 11);
  assertEquals(courtRowsAfterImport, [
    {
      entityId: "dc.court_of_appeals",
      name: "Court of Appeals",
      kind: "court",
      branch: "Judicial",
      cluster: "Judicial",
    },
    {
      entityId: "dc.superior_court",
      name: "Superior Court",
      kind: "court",
      branch: "Judicial",
      cluster: "Judicial",
    },
  ]);

  const entityBatch = await new Deno.Command(Deno.execPath(), {
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
      "candidate.dccourts.structure",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(entityBatch.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(entityBatch.stdout),
    "Accepted 0 safe review item(s).",
  );

  const relationshipBatch = await new Deno.Command(Deno.execPath(), {
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
      "--subject-prefix",
      "relationship.dccourts.structure",
      "--relationship-type",
      "part_of",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(relationshipBatch.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(relationshipBatch.stdout),
    "Accepted 0 safe review item(s).",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const acceptedRelationships = reopened.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'part_of' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  reopened.close();
  assertEquals(acceptedRelationships.length, 11);
  assert(
    acceptedRelationships.some((row) =>
      row.relationshipId === "dc.court_of_appeals:part_of:dc.district_of_columbia_courts"
    ),
  );
});

Deno.test("BEGA structure upgrades earlier DCGIS taxonomy for the same entity", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const dcgisRowsFixture = {
    features: [{
      attributes: {
        AGENCY_ID: 1138,
        AGENCY_NAME: "Board of Ethics and Government Accountability",
        TYPE: "Agency",
        BRANCH: "Other",
        MAYORAL_CLUSTER: "Government Operations",
        WEB_URL: "https://bega.dc.gov/",
        LEGISLATION: "",
      },
    }],
  };
  const dcgisFetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return JSON.stringify(dcgisRowsFixture);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return dcgisMetadataFixture as T;
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
          return dcgisRowsFixture as T;
        default:
          throw new Error(`Unexpected url ${url}`) as T;
      }
    },
  });
  await workbench.importConnectorResult(
    await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher: dcgisFetcher })),
    dataDir,
  );
  const dcgisBega = workbench.db.prepare(
    "select kind, branch, cluster from canonical_entities where entity_id = 'dc.board_of_ethics_and_government_accountability'",
  ).get() as { kind: string; branch: string | null; cluster: string | null };
  assertEquals(dcgisBega, { kind: "board", branch: null, cluster: null });

  const begaFetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://bega.dc.gov/node/61616/":
          return begaAboutFixture;
        case "https://bega.dc.gov/page/office-government-ethics":
          return begaOgeFixture;
        case "https://www.open-dc.gov/office-open-government":
          return begaOogFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("bega.structure").run(createConnectorContext({ fetcher: begaFetcher })),
    dataDir,
  );

  const remainingBegaReview = workbench.listReviewItems({
    mode: "entities",
    sourceId: "bega.structure",
  });
  const upgradedBega = workbench.db.prepare(
    "select kind, branch, cluster, official_url as officialUrl from canonical_entities where entity_id = 'dc.board_of_ethics_and_government_accountability'",
  ).get() as { kind: string; branch: string | null; cluster: string | null; officialUrl: string };
  workbench.close();
  assertEquals(remainingBegaReview.length, 0);
  assertEquals(upgradedBega, {
    kind: "agency",
    branch: "Independent",
    cluster: "Ethics and Open Government",
    officialUrl: "https://bega.dc.gov/node/61616/",
  });
});

Deno.test("BEGA structure entities auto-promote and structural relationships no longer wait for batch accept-safe", async () => {
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
        case "https://bega.dc.gov/node/61616/":
          return begaAboutFixture;
        case "https://bega.dc.gov/page/office-government-ethics":
          return begaOgeFixture;
        case "https://www.open-dc.gov/office-open-government":
          return begaOogFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("bega.structure").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  workbench.close();

  const reopenedAfterImport = new Workbench(dbPath);
  reopenedAfterImport.init();
  const remainingEntityReview = reopenedAfterImport.listReviewItems({
    mode: "entities",
    subjectPrefix: "candidate.bega.structure",
  });
  const acceptedAfterImport = reopenedAfterImport.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'part_of' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  reopenedAfterImport.close();
  assertEquals(remainingEntityReview.length, 0);
  assertEquals(acceptedAfterImport.length, 2);

  const entityBatch = await new Deno.Command(Deno.execPath(), {
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
      "candidate.bega.structure",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(entityBatch.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(entityBatch.stdout),
    "Accepted 0 safe review item(s).",
  );

  const relationshipBatch = await new Deno.Command(Deno.execPath(), {
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
      "--subject-prefix",
      "relationship.bega.structure",
      "--relationship-type",
      "part_of",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(relationshipBatch.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(relationshipBatch.stdout),
    "Accepted 0 safe review item(s).",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const acceptedRelationships = reopened.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_type = 'part_of' order by relationship_id",
  ).all() as Array<{ relationshipId: string }>;
  reopened.close();
  assertEquals(acceptedRelationships.length, 2);
  assert(
    acceptedRelationships.some((row) =>
      row.relationshipId ===
        "dc.office_of_government_ethics:part_of:dc.board_of_ethics_and_government_accountability"
    ),
  );
  assert(
    acceptedRelationships.some((row) =>
      row.relationshipId ===
        "dc.office_of_open_government:part_of:dc.board_of_ethics_and_government_accountability"
    ),
  );
});

Deno.test("batch defer-default defers only scoped default-defer relationship items", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  const healthDetailWithDeferredRows = `<html><body>
    <h1>Committee on Health</h1>
    <h2>Agencies Under This Committee</h2>
    <ul>
      <li>Department of Health</li>
      <li>Cedar Hill Hospital</li>
      <li>Department of Buildings (excluding construction codes)</li>
    </ul>
  </body></html>`;
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture.replace(
            "</ul>",
            "<li>Council of the District of Columbia</li></ul>",
          );
        case "https://dccouncil.gov/committees/committee-on-health/":
          return healthDetailWithDeferredRows;
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
      "defer-default",
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
  assertStringIncludes(batchText, "Deferred 1 default-defer review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const openOversight = reopened.listReviewItems({
    mode: "relationships",
    status: "open",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees",
  });
  const deferredOversight = reopened.listReviewItems({
    mode: "relationships",
    status: "deferred",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees",
  });
  const blockedOversight = reopened.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_type = 'relationship_candidate'
       and details_json like '%"relationshipType":"overseen_by"%'`,
  ).get() as { count: number };
  reopened.close();
  assertEquals(openOversight.length, 0);
  assertEquals(deferredOversight.length, 1);
  assertEquals(blockedOversight.count, 0);
});

Deno.test("batch defer-default requires a scoped review slice", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
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
      "defer-default",
      "--mode",
      "relationships",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 1);
  assertStringIncludes(
    new TextDecoder().decode(batchOutput.stderr),
    "Batch defer-default requires --mode, --subject-prefix, and at least one narrowing filter.",
  );
});

Deno.test("dcgis agency taxonomy labels do not create branch review slices", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
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
          AGENCY_NAME: "Example Residual Agency",
          TYPE: "Agency",
          BRANCH: "Other",
          MAYORAL_CLUSTER: "",
          WEB_URL: "",
          LEGISLATION: "",
        },
      },
      {
        attributes: {
          AGENCY_ID: 3002,
          AGENCY_NAME: "Example Settlement Fund",
          TYPE: "Budgetary",
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
      case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1000&f=json":
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

  const candidateCount = workbench.db.prepare(
    "select count(*) as count from entity_candidates where candidate_id like 'candidate.dcgis.agencies.%'",
  ).get() as { count: number };
  const relationshipCount = workbench.db.prepare(
    "select count(*) as count from relationship_candidates where relationship_candidate_id like 'relationship.dcgis.agencies.%'",
  ).get() as { count: number };
  const remainingItems = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "part_of",
    subjectPrefix: "relationship.dcgis.agencies",
  });
  workbench.close();

  assertEquals(candidateCount.count, 5);
  assertEquals(relationshipCount.count, 0);
  assertEquals(remainingItems.length, 0);
});

Deno.test("batch defer-default marks a scoped relationship review slice deferred", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.example_body', 'Example Body', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.other_branch', 'Other Branch', 'branch', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "dcgis.boards_commissions_councils",
      relationshipCandidateId: "relationship.dcgis.boards_commissions_councils.example_other",
      sourceItemKey: "dcgis-bcc-other-row",
      fromEntityRef: "dc.example_body",
      toEntityRef: "dc.other_branch",
      relationshipType: "part_of",
      rawValue: "Other",
      needsReview: true,
    }),
    dataDir,
  );
  workbench.close();

  const entityBatchOutput = await new Deno.Command(Deno.execPath(), {
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
      "candidate.dcgis.boards_commissions_councils",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(entityBatchOutput.code, 0);

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
      "defer-default",
      "--mode",
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.dcgis.boards_commissions_councils",
      "--raw-value",
      "Other",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(deferOutput.stdout),
    "Deferred 1 default-defer review item(s).",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const openOther = reopened.listReviewItems({
    mode: "relationships",
    status: "open",
    relationshipType: "part_of",
    subjectPrefix: "relationship.dcgis.boards_commissions_councils",
    rawValue: "Other",
  });
  const deferredOther = reopened.listReviewItems({
    mode: "relationships",
    status: "deferred",
    relationshipType: "part_of",
    subjectPrefix: "relationship.dcgis.boards_commissions_councils",
    rawValue: "Other",
  });
  reopened.close();
  assertEquals(openOther.length, 0);
  assertEquals(deferredOther.length, 1);
});

Deno.test("batch defer-default leaves auto-materialized accept-default relationship slices alone", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name, kind] of [
      ["dc.accept_default_test_parent", "Accept Default Test Parent", "board"],
      ["dc.accept_default_test_committee", "Accept Default Test Committee", "committee"],
    ] as const
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name, kind);
  }
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId:
        "relationship.council.committees.defer_default.accept_relationship.health",
      sourceItemKey: "defer-default-accept-health-row",
      fromEntityRef: "dc.accept_default_test_parent",
      toEntityRef: "dc.accept_default_test_committee",
      relationshipType: "overseen_by",
      rawValue: "Health Example Oversight",
      needsReview: true,
    }),
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
      "defer-default",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees.defer_default.accept_relationship",
      "--raw-value-contains",
      "Health",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(deferOutput.stdout),
    "Deferred 0 default-defer review item(s).",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const deferredHealth = reopened.listReviewItems({
    mode: "relationships",
    status: "deferred",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees.defer_default.accept_relationship",
    rawValueContains: "Health",
  });
  const openOversight = reopened.listReviewItems({
    mode: "relationships",
    status: "open",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees.defer_default.accept_relationship",
  });
  const acceptedRelationship = reopened.db.prepare(
    `select count(*) as count
     from canonical_relationships
     where relationship_id = 'dc.accept_default_test_parent:overseen_by:dc.accept_default_test_committee'`,
  ).get() as { count: number };
  reopened.close();
  assertEquals(deferredHealth.length, 0);
  assertEquals(openOversight.length, 0);
  assertEquals(acceptedRelationship.count, 1);
});
Deno.test("plain batch defer is not available", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
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
      "--subject-prefix",
      "relationship.example",
      "--db",
      dbPath,
    ],
  }).output();

  assertEquals(deferOutput.code, 2);
  assertStringIncludes(
    new TextDecoder().decode(deferOutput.stderr),
    "Unknown command: review batch defer",
  );
});

Deno.test("resolution replay rebuilds accepted entities deterministically", async () => {
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
      eventType: "accept_entity_candidate",
      subjectId: "candidate.council.committees.committee_of_the_whole",
      payload: {},
    },
    resolutionsDir,
  );
  const entity = workbench.entityView("dc.committee_of_the_whole");
  await workbench.replayResolutionDirectory(resolutionsDir);
  const firstReplay = workbench.entityView("dc.committee_of_the_whole");
  await workbench.replayResolutionDirectory(resolutionsDir);
  const secondReplay = workbench.entityView("dc.committee_of_the_whole");
  workbench.close();
  assertEquals(entity.entityId, "dc.committee_of_the_whole");
  assertEquals(firstReplay.entityId, "dc.committee_of_the_whole");
  assertEquals(secondReplay.entityId, "dc.committee_of_the_whole");
  assertEquals(firstReplay.name, secondReplay.name);
  assertEquals(firstReplay.reviewStatus, "accepted");
  assertEquals(secondReplay.reviewStatus, "accepted");
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
  const eventCountBeforeFailure = workbench.db.prepare(
    "select count(*) as count from resolution_events",
  ).get() as { count: number };

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
  assertEquals(eventCount.count, eventCountBeforeFailure.count);
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

Deno.test("Enterprise Dataset Inventory connector captures rows and classifies Government Operations tables conservatively", async () => {
  const progressMessages: string[] = [];
  const result = await getConnector("admin.enterprise_dataset_inventory").run(
    createConnectorContext({
      onProgress: (event) => progressMessages.push(event.message),
      fetcher: async (url: string) => ({
        status: 200,
        text: async () => {
          switch (url) {
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer?f=json":
              return JSON.stringify(governmentOperationsCatalogFixture);
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5?f=json":
              return JSON.stringify(enterpriseDatasetInventoryMetadataFixture);
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=2&f=json":
              return JSON.stringify(enterpriseDatasetInventoryRowsPageOneFixture);
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=2&resultRecordCount=2&f=json":
              return JSON.stringify(enterpriseDatasetInventoryRowsPageTwoFixture);
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=4&resultRecordCount=2&f=json":
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=6&resultRecordCount=2&f=json":
              return JSON.stringify({ features: [] });
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        },
        json: async <T>() => {
          throw new Error(`No json fixture for ${url}`) as T;
        },
      }),
    }),
  );
  assertEquals(result.endpointResults.length, 3);
  assertEquals(progressMessages.includes("Fetching Enterprise Dataset Inventory row count"), false);
  assert(
    progressMessages.includes(
      "Fetching Enterprise Dataset Inventory row page batch starting at 1 (4 page(s) of up to 2)",
    ),
  );
  assert(
    progressMessages.includes(
      "Fetching Enterprise Dataset Inventory rows starting at 1 (page 1, up to 2)",
    ),
  );
  assert(
    progressMessages.includes(
      "Fetching Enterprise Dataset Inventory rows starting at 3 (page 2, up to 2)",
    ),
  );
  assert(
    progressMessages.includes(
      "Fetched 3 Enterprise Dataset Inventory row(s) across 2 page artifact(s)",
    ),
  );
  assert(result.endpointResults.every((endpoint) => endpoint.status === "success"));
  const catalogParsed = result.endpointResults[0].parsed;
  const metadataParsed = result.endpointResults[1].parsed;
  const rowsParsed = result.endpointResults[2].parsed;
  assert(catalogParsed);
  assert(metadataParsed);
  assert(rowsParsed);
  assertEquals(catalogParsed.items?.length, 8);
  assert(
    catalogParsed.items?.some((item) =>
      item.title === "Election infrastructure layers" &&
      item.body.classification === "inventory_only"
    ),
  );
  assert(
    catalogParsed.items?.some((item) =>
      item.title === "DC Government Employee Salary" &&
      item.body.classification === "out_of_scope_person_heavy"
    ),
  );
  assert(
    catalogParsed.items?.some((item) =>
      item.title === "PASS / STaR2 procurement tables" &&
      item.body.classification === "inventory_only"
    ),
  );
  assertEquals(metadataParsed.fields?.length, 9);
  assertEquals(result.endpointResults[1].artifacts.length, 1);
  assertEquals(result.endpointResults[2].artifacts.length, 2);
  assertEquals(rowsParsed.items?.length, 3);
  assertEquals(rowsParsed.datasets?.length, 3);
  assert(
    rowsParsed.datasets?.some((dataset) =>
      dataset.name === "311 City Service Requests" &&
      dataset.category === "public_services" &&
      dataset.ownerName === "Office of Unified Communications" &&
      dataset.officialUrl ===
        "https://opendata.dc.gov/datasets/DCGIS::311-city-service-requests/about"
    ),
  );
  assert(
    rowsParsed.items?.some((item) =>
      item.title === "Film Rebate Ledger" &&
      item.body.datasetName === "Film Rebate Ledger" &&
      item.body.rawDatasetName === " Film Rebate Ledger " &&
      item.body.systemUpdatedOn === "2026-03-04T14:08:53.000Z"
    ),
  );
  assertEquals(
    rowsParsed.datasets?.find((dataset) => dataset.datasetId.includes("ocfo_edi_009999"))?.name,
    "Film Rebate Ledger",
  );
});

Deno.test("Enterprise Dataset Inventory connector fetches row pages concurrently without a count request", async () => {
  const allFeatures = [
    ...enterpriseDatasetInventoryRowsPageOneFixture.features,
    ...enterpriseDatasetInventoryRowsPageTwoFixture.features,
  ];
  let activeRowRequests = 0;
  let maxActiveRowRequests = 0;
  const result = await getConnector("admin.enterprise_dataset_inventory").run(
    createConnectorContext({
      fetcher: async (url: string) => ({
        status: 200,
        text: async () => {
          switch (url) {
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer?f=json":
              return JSON.stringify(governmentOperationsCatalogFixture);
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5?f=json":
              return JSON.stringify({
                ...enterpriseDatasetInventoryMetadataFixture,
                maxRecordCount: 1,
              });
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1&f=json":
              return delayedRowPage({ features: [allFeatures[0]], exceededTransferLimit: true });
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=1&resultRecordCount=1&f=json":
              return delayedRowPage({ features: [allFeatures[1]], exceededTransferLimit: true });
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=2&resultRecordCount=1&f=json":
              return delayedRowPage({ features: [allFeatures[2]] });
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=3&resultRecordCount=1&f=json":
              return delayedRowPage({ features: [] });
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        },
        json: async <T>() => {
          throw new Error(`No json fixture for ${url}`) as T;
        },
      }),
    }),
  );

  assertEquals(maxActiveRowRequests, 4);
  assertEquals(result.endpointResults[2].parsed?.datasets?.length, 3);

  async function delayedRowPage(payload: Record<string, unknown>): Promise<string> {
    activeRowRequests += 1;
    maxActiveRowRequests = Math.max(maxActiveRowRequests, activeRowRequests);
    await new Promise((resolve) => setTimeout(resolve, 10));
    activeRowRequests -= 1;
    return JSON.stringify(payload);
  }
});

Deno.test("Enterprise Dataset Inventory connector fails loudly on row page error payloads", async () => {
  await assertRejects(
    () =>
      getConnector("admin.enterprise_dataset_inventory").run(
        createConnectorContext({
          fetcher: async (url: string) => ({
            status: 200,
            text: async () => {
              switch (url) {
                case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer?f=json":
                  return JSON.stringify(governmentOperationsCatalogFixture);
                case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5?f=json":
                  return JSON.stringify(enterpriseDatasetInventoryMetadataFixture);
                case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=2&f=json":
                  return JSON.stringify({
                    error: {
                      message: "Failed to execute query.",
                      details: ["Invalid field name"],
                    },
                  });
                default:
                  throw new Error(`Unexpected url ${url}`);
              }
            },
            json: async <T>() => {
              throw new Error(`No json fixture for ${url}`) as T;
            },
          }),
        }),
      ),
    Error,
    "admin.enterprise_dataset_inventory rows page 1 failed: Failed to execute query.: Invalid field name",
  );
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

Deno.test("inventory-only imports keep existing unresolved relationship state unchanged", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.source_board', 'Source Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.inventory_only.relationships",
      relationshipCandidateId: "relationship.test.inventory_only.pending_dependency",
      sourceItemKey: "inventory-only-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.pending_target",
      relationshipType: "governed_by",
      rawValue: "Pending Target",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.inventory_only.entities",
      candidateId: "candidate.test.inventory_only.pending_target",
      sourceItemKey: "inventory-only-entity-row",
      proposedEntityId: "dc.pending_target",
      name: "Pending Target",
      kind: "agency",
      observedName: "Pending Target",
    }),
    dataDir,
  );

  const beforeOpen = workbench.listReviewItems({ status: "open" }).length;
  const beforeBlocked = workbench.unresolvedWorkGraph().diagnostics.length;

  await workbench.importConnectorResult(inventoryOnlySourceResult(), dataDir);

  const afterOpen = workbench.listReviewItems({ status: "open" }).length;
  const afterBlocked = workbench.unresolvedWorkGraph().diagnostics.length;
  const inventory = workbench.sourceSummary("test.inventory_only.datasets");
  const dataset = workbench.datasets().find((row) =>
    row.id === "dataset.test.inventory_only.datasets.main"
  );
  workbench.close();

  assert(beforeOpen > 0);
  assertEquals(afterOpen, beforeOpen);
  assert(beforeBlocked > 0);
  assertEquals(afterBlocked, beforeBlocked);
  assertEquals(inventory.itemCount, 1);
  assertEquals(dataset?.name, "Inventory Only Dataset");
});

function inventoryOnlySourceResult(): ConnectorResult {
  return {
    source: {
      sourceId: "test.inventory_only.datasets",
      title: "Inventory Only Datasets",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/inventory-only",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.inventory_only.datasets.main",
        sourceId: "test.inventory_only.datasets",
        title: "Inventory only rows",
        kind: "fixture",
        url: "https://example.com/inventory-only",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/inventory-only",
        contentText: JSON.stringify({ datasetId: "dataset.test.inventory_only.datasets.main" }),
      }],
      parsed: {
        items: [{
          itemKey: "inventory-only-dataset-row",
          itemType: "fixture_dataset",
          title: "Inventory only dataset row",
          body: { name: "Inventory Only Dataset" },
        }],
        datasets: [{
          datasetId: "dataset.test.inventory_only.datasets.main",
          sourceItemKey: "inventory-only-dataset-row",
          name: "Inventory Only Dataset",
          category: "inventory",
          ownerName: "District of Columbia",
          accessMethod: "public_web",
          artifactDepth: "sample",
          officialUrl: "https://example.com/inventory-only/dataset",
          evidence: [{
            fieldPath: "name",
            observedValue: "Inventory Only Dataset",
          }],
        }],
      },
    }],
  };
}

async function countConflictContextLookupPrepares(candidateCount: number): Promise<number> {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.bulk_conflicted_body', 'Bulk Conflicted Body', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  let conflictContextPrepareCount = 0;
  const countedDb = new Proxy(workbench.db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (sql: string) => {
          if (
            sql.includes("canonical_entities.kind != entity_candidates.kind") &&
            sql.includes("entity_candidates.candidate_id")
          ) {
            conflictContextPrepareCount += 1;
          }
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Database;

  await importConnectorResultIntoStore(
    { db: countedDb } as Parameters<typeof importConnectorResultIntoStore>[0],
    conflictEntityBatchSourceResult(candidateCount),
    dataDir,
  );
  workbench.close();
  return conflictContextPrepareCount;
}

function conflictEntityBatchSourceResult(candidateCount: number): ConnectorResult {
  const itemKeys = Array.from(
    { length: candidateCount },
    (_, index) => `bulk-conflicted-entity-row-${index + 1}`,
  );
  const candidateIds = itemKeys.map((itemKey) => `candidate.test.bulk_conflicted.${itemKey}`);
  return {
    source: {
      sourceId: "test.bulk_conflicted_entity_kind",
      title: "Bulk Conflicted Entity Kind",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/bulk-conflicted-entity-kind",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.bulk_conflicted_entity_kind.main",
        sourceId: "test.bulk_conflicted_entity_kind",
        title: "Bulk conflicted entity rows",
        kind: "fixture",
        url: "https://example.com/bulk-conflicted-entity-kind",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/bulk-conflicted-entity-kind",
        contentText: JSON.stringify({ candidateCount }),
      }],
      parsed: {
        items: itemKeys.map((itemKey, index) => ({
          itemKey,
          itemType: "fixture_row",
          title: `Bulk conflicted entity row ${index + 1}`,
          body: { observedName: `Bulk Conflicted Body ${index + 1}` },
        })),
        entityCandidates: candidateIds.map((candidateId, index) => ({
          candidateId,
          sourceItemKey: itemKeys[index],
          proposedEntityId: "dc.bulk_conflicted_body",
          name: "Bulk Conflicted Body",
          kind: "board",
          confidence: 0.99,
          evidence: [{
            fieldPath: "name",
            observedValue: "Bulk Conflicted Body",
          }],
        })),
        reviewItems: candidateIds.map((candidateId) => ({
          reviewItemId: buildReviewItemId(candidateId, "entity-review"),
          itemType: "entity_candidate",
          subjectId: candidateId,
          reason: "Review fixture entity candidate",
          defaultAction: "accept",
          details: {
            name: "Bulk Conflicted Body",
            kind: "board",
          },
        })),
      },
    }],
  };
}
