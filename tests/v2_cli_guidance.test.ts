import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

Deno.test("CLI command errors print a concise message", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const output = await runDcCli(["source", "fetch", "not.a.source", "--db", dbPath]);
  const stderr = output.stderr;
  assertEquals(output.code, 1);
  assertStringIncludes(stderr, "Unknown v2 source: not.a.source");
  assert(!stderr.includes(" at "));
});

Deno.test("top-level CLI aliases make the workbench easy to enter", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "data", "workbench.sqlite");
  const initOutput = await runDcCli(["init", "--db", dbPath]);
  assertEquals(initOutput.code, 0);
  assertStringIncludes(initOutput.stdout, "Initialized v2 workbench");

  const statusOutput = await runDcCli(["status", "--db", dbPath]);
  assertEquals(statusOutput.code, 0);
  const statusText = statusOutput.stdout;
  assertStringIncludes(statusText, "Schema version: 18");
  assertStringIncludes(statusText, "Sources: 0/");
  assertStringIncludes(statusText, "Decisions: 0 open, 0 deferred");
  assertStringIncludes(statusText, "Reconciliation: 0 blocked");
  assertStringIncludes(statusText, `Next: deno task dc -- source list --db ${dbPath}`);

  const jsonStatusOutput = await runDcCli(["status", "--db", dbPath, "--json"]);
  assertEquals(jsonStatusOutput.code, 0);
  const jsonStatus = JSON.parse(jsonStatusOutput.stdout) as {
    schemaVersion: number;
    sources: { fetched: number; total: number };
    review: { open: number; deferred: number };
    reconciliation: { blocked: number };
    nextCommand: string;
  };
  assertEquals(jsonStatus.schemaVersion, 18);
  assertEquals(jsonStatus.sources.fetched, 0);
  assertEquals(jsonStatus.review.open, 0);
  assertEquals(jsonStatus.reconciliation.blocked, 0);
  assertEquals(jsonStatus.nextCommand, `deno task dc -- source list --db ${dbPath}`);

  const sourceListOutput = await runDcCli(["source", "list", "--db", dbPath]);
  assertEquals(sourceListOutput.code, 0);
  const sourceListText = sourceListOutput.stdout;
  assertStringIncludes(sourceListText, "dcgis.agencies unfetched");
  assertStringIncludes(sourceListText, "mota.quickbase unfetched");

  const sourceListJsonOutput = await runDcCli(["source", "list", "--db", dbPath, "--json"]);
  assertEquals(sourceListJsonOutput.code, 0);
  const sourceListJson = JSON.parse(
    sourceListJsonOutput.stdout,
  ) as Array<{ sourceId: string; title: string; status: string }>;
  assert(
    sourceListJson.some((row) =>
      row.sourceId === "dcgis.agencies" &&
      row.title === "District Government Agencies" &&
      row.status === "unfetched"
    ),
  );

  const unfetchedInspectOutput = await runDcCli([
    "source",
    "inspect",
    "dcgis.agencies",
    "--db",
    dbPath,
  ]);
  const unfetchedInspectText = unfetchedInspectOutput.stdout;
  assertEquals(unfetchedInspectOutput.code, 0);
  assertStringIncludes(unfetchedInspectText, "dcgis.agencies - District Government Agencies");
  assertStringIncludes(unfetchedInspectText, "Latest status: unfetched");
  assertStringIncludes(
    unfetchedInspectText,
    `Fetch: deno task dc -- source fetch dcgis.agencies --db ${dbPath}`,
  );

  const unfetchedInspectJsonOutput = await runDcCli([
    "source",
    "inspect",
    "dcgis.agencies",
    "--db",
    dbPath,
    "--json",
  ]);
  const unfetchedInspectJson = JSON.parse(
    unfetchedInspectJsonOutput.stdout,
  ) as { sourceId: string; latestStatus: string; itemCount: number; fetchCommand: string };
  assertEquals(unfetchedInspectJsonOutput.code, 0);
  assertEquals(unfetchedInspectJson.sourceId, "dcgis.agencies");
  assertEquals(unfetchedInspectJson.latestStatus, "unfetched");
  assertEquals(unfetchedInspectJson.itemCount, 0);
  assertEquals(
    unfetchedInspectJson.fetchCommand,
    `deno task dc -- source fetch dcgis.agencies --db ${dbPath}`,
  );
});

Deno.test("focused CLI help exits zero and does not run commands", async () => {
  const topLevelHelp = await runDcCli(["--help"]);
  const topLevelText = topLevelHelp.stdout;
  assertEquals(topLevelHelp.code, 0);
  assertStringIncludes(topLevelText, "Workflow:");
  assertStringIncludes(topLevelText, "deno task dc -- source fetch --all");
  assertStringIncludes(
    topLevelText,
    "deno task dc -- source fetch <source-id> [--db <path>] [--data-dir <path>] [--limit <n>] [--json]",
  );
  assertStringIncludes(
    topLevelText,
    "deno task dc -- source fetch --all [--db <path>] [--data-dir <path>] [--limit <n>] [--json]",
  );
  assertStringIncludes(topLevelText, "deno task dc -- audit");
  assertStringIncludes(topLevelText, "deno task dc -- release verify");
  assertStringIncludes(topLevelText, "deno task dc -- release build");
  assertStringIncludes(
    topLevelText,
    "deno task dc -- release build [--db <path>] [--out|--output <dir>] [--source-profile <structure|tier0|inventory|custom>] [--json]",
  );
  assertStringIncludes(topLevelText, "deno task dc -- release inspect");
  assertStringIncludes(topLevelText, "Browse:");
  assertStringIncludes(
    topLevelText,
    "deno task dc -- entity search accountancy | deno task dc -- review list --status all",
  );
  assertStringIncludes(
    topLevelText,
    "deno task dc -- review | deno task dc -- review packets --mode relationships",
  );

  const auditHelp = await runDcCli(["audit", "--help"]);
  const auditText = auditHelp.stdout;
  assertEquals(auditHelp.code, 0);
  assertStringIncludes(auditText, "Usage:");
  assertStringIncludes(auditText, "deno task dc -- audit [--db <path>] [--json]");
  assertStringIncludes(
    auditText,
    "inspect release blockers, failed sources, and reconciliation details",
  );
  assert(!auditText.includes("audit status"));
  assert(!auditText.includes("doctor"));
  assert(!auditText.includes("DB: "));

  const statusHelp = await runDcCli(["status", "--help"]);
  const statusHelpText = statusHelp.stdout;
  assertEquals(statusHelp.code, 0);
  assertStringIncludes(
    statusHelpText,
    "deno task dc -- status [--db <path>] [--json]",
  );
  assert(!statusHelpText.includes("audit status"));
  assert(!statusHelpText.includes("DB: "));

  const auditStatusHelp = await runDcCli(["audit", "status", "--help"]);
  const auditStatusHelpError = auditStatusHelp.stderr;
  assertEquals(auditStatusHelp.code, 2);
  assertStringIncludes(auditStatusHelpError, "Unknown command: audit status --help");

  const sourceHelp = await runDcCli(["source", "--help"]);
  const sourceText = sourceHelp.stdout;
  assertEquals(sourceHelp.code, 0);
  assertStringIncludes(sourceText, "Workflow:");
  assertStringIncludes(sourceText, "deno task dc -- source list");
  assertStringIncludes(sourceText, "deno task dc -- source fetch <source-id>");
  assertStringIncludes(sourceText, "deno task dc -- source fetch --all");
  assertStringIncludes(sourceText, "deno task dc -- source inspect <source-id>");

  const workbenchHelp = await runDcCli(["workbench", "--help"]);
  const workbenchHelpText = workbenchHelp.stdout;
  assertEquals(workbenchHelp.code, 0);
  assertStringIncludes(workbenchHelpText, "deno task dc -- workbench");
  assertStringIncludes(workbenchHelpText, "deno task dc -- init [--db <path>]");
  assertStringIncludes(workbenchHelpText, "deno task dc -- status [--db <path>] [--json]");

  const initHelpDb = join(await Deno.makeTempDir(), "workbench.sqlite");
  const initHelp = await runDcCli(["init", "--help", "--db", initHelpDb]);
  const initHelpText = initHelp.stdout;
  assertEquals(initHelp.code, 0);
  assertStringIncludes(initHelpText, "deno task dc -- workbench");
  assert(!initHelpText.includes("Initialized v2 workbench"));

  const reviewHelp = await runDcCli(["review", "--help"]);
  const reviewText = reviewHelp.stdout;
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

  const reviewModeHelp = await runDcCli(["review", "relationships", "--help"]);
  const reviewModeText = reviewModeHelp.stdout;
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

  const reviewBatchHelp = await runDcCli(["review", "batch", "--help"]);
  const reviewBatchText = reviewBatchHelp.stdout;
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

  const entityHelp = await runDcCli(["entity", "--help"]);
  const entityText = entityHelp.stdout;
  assertEquals(entityHelp.code, 0);
  assertStringIncludes(entityText, "Workflow:");
  assertStringIncludes(entityText, "deno task dc -- entity search <query>");
  assertStringIncludes(entityText, "deno task dc -- entity show <entity-id>");

  const entityBare = await runDcCli(["entity"]);
  const entityBareText = entityBare.stdout;
  assertEquals(entityBare.code, 0);
  assertStringIncludes(entityBareText, "deno task dc -- entity");
  assertStringIncludes(entityBareText, "deno task dc -- entity search <query>");

  const entitySearchHelp = await runDcCli(["entity", "search", "--help"]);
  const entitySearchHelpText = entitySearchHelp.stdout;
  assertEquals(entitySearchHelp.code, 0);
  assertStringIncludes(entitySearchHelpText, "deno task dc -- entity search <query>");
  assert(!entitySearchHelpText.includes("[]"));

  const entityShowHelp = await runDcCli(["entity", "show", "--help"]);
  const entityShowHelpText = entityShowHelp.stdout;
  assertEquals(entityShowHelp.code, 0);
  assertStringIncludes(entityShowHelpText, "deno task dc -- entity show <entity-id>");

  const releaseHelp = await runDcCli(["release", "--help"]);
  const releaseText = releaseHelp.stdout;
  const releaseError = releaseHelp.stderr;
  assertEquals(releaseHelp.code, 0);
  assertStringIncludes(releaseText, "Workflow:");
  assertStringIncludes(releaseText, "Usage:");
  assertStringIncludes(releaseText, "deno task dc -- release build");
  assertStringIncludes(
    releaseText,
    "deno task dc -- release build [--db <path>] [--out|--output <dir>] [--source-profile <structure|tier0|inventory|custom>] [--json]",
  );
  assertStringIncludes(releaseText, "deno task dc -- release inspect");
  assertEquals(releaseError, "");

  const releaseBare = await runDcCli(["release"]);
  const releaseBareText = releaseBare.stdout;
  assertEquals(releaseBare.code, 0);
  assertStringIncludes(releaseBareText, "deno task dc -- release");
  assertStringIncludes(releaseBareText, "deno task dc -- release build");

  const releaseBuildHelp = await runDcCli(["release", "build", "--help"]);
  const releaseBuildHelpText = releaseBuildHelp.stdout;
  assertEquals(releaseBuildHelp.code, 0);
  assertStringIncludes(releaseBuildHelpText, "deno task dc -- release build");
  assertStringIncludes(
    releaseBuildHelpText,
    "deno task dc -- release build [--db <path>] [--out|--output <dir>] [--source-profile <structure|tier0|inventory|custom>] [--json]",
  );
  assertStringIncludes(releaseBuildHelpText, "deno task dc -- release inspect");
  assertStringIncludes(releaseBuildHelpText, "Verify package readiness and provenance");
  assert(!releaseBuildHelpText.includes("current workbench readiness"));
  assert(!releaseBuildHelpText.includes("Built release"));

  const releaseInspectHelp = await runDcCli(["release", "inspect", "--help"]);
  const releaseInspectHelpText = releaseInspectHelp.stdout;
  assertEquals(releaseInspectHelp.code, 0);
  assertStringIncludes(releaseInspectHelpText, "deno task dc -- release inspect");
  assert(!releaseInspectHelpText.includes("Release: "));
});

Deno.test("source prefix commands guide the operator toward the next fetch action", async () => {
  const sourceOutput = await runDcCli(["source"]);
  const sourceText = sourceOutput.stdout;
  assertEquals(sourceOutput.code, 0);
  assertStringIncludes(sourceText, "deno task dc -- source");
  assertStringIncludes(sourceText, "Available sources:");
  assertStringIncludes(sourceText, "dcgis.agencies");
  assertStringIncludes(sourceText, "Tip: run `deno task dc -- source list`");
  assertStringIncludes(sourceText, "to fetch every configured source into this workbench");
  assert(!sourceText.includes("full smoke"));

  const compareOutput = await runDcCli(["source", "compare"]);
  const compareText = compareOutput.stdout;
  assertEquals(compareOutput.code, 0);
  assertStringIncludes(compareText, "deno task dc -- source compare public-bodies");
  assertStringIncludes(
    compareText,
    "Tip: run `deno task dc -- source compare public-bodies`",
  );

  const fetchOutput = await runDcCli(["source", "fetch"]);
  const fetchText = fetchOutput.stdout;
  assertEquals(fetchOutput.code, 0);
  assertStringIncludes(fetchText, "deno task dc -- source fetch <source-id>");
  assertStringIncludes(fetchText, "deno task dc -- source fetch --all");
  assertStringIncludes(fetchText, "Tip: run `deno task dc -- source fetch --all`");
  assertStringIncludes(fetchText, "to fetch every configured source into this workbench");
  assert(!fetchText.includes("full smoke"));
  assertStringIncludes(fetchText, "deno task dc -- source list");

  const listHelpOutput = await runDcCli(["source", "list", "--help"]);
  const listHelpText = listHelpOutput.stdout;
  assertEquals(listHelpOutput.code, 0);
  assertStringIncludes(listHelpText, "deno task dc -- source list");
  assert(!listHelpText.includes("unfetched"));
});

Deno.test("review prefix commands guide the operator toward the next safe review action", async () => {
  const batchOutput = await runDcCli(["review", "batch"]);
  const batchText = batchOutput.stdout;
  assertEquals(batchOutput.code, 0);
  assertStringIncludes(batchText, "deno task dc -- review batch");
  assertStringIncludes(batchText, "deno task dc -- review packets");
  assertStringIncludes(batchText, "deno task dc -- review list");
  assertStringIncludes(
    batchText,
    "deno task dc -- review batch accept-safe --mode entities",
  );

  const batchFlagOutput = await runDcCli([
    "review",
    "batch",
    "--db",
    join(Deno.cwd(), "data", "workbench.sqlite"),
  ]);
  const batchFlagText = batchFlagOutput.stdout;
  assertEquals(batchFlagOutput.code, 0);
  assertStringIncludes(batchFlagText, "deno task dc -- review batch");
  assertStringIncludes(batchFlagText, "deno task dc -- review packets");

  const acceptSafeOutput = await runDcCli(["review", "batch", "accept-safe"]);
  const acceptSafeText = acceptSafeOutput.stdout;
  assertEquals(acceptSafeOutput.code, 0);
  assertStringIncludes(acceptSafeText, "deno task dc -- review batch accept-safe");
  assertStringIncludes(acceptSafeText, "--mode entities");
  assertStringIncludes(acceptSafeText, "Tip: choose a narrow slice");
});

Deno.test("entity prefix commands guide the operator toward the next lookup action", async () => {
  const entityOutput = await runDcCli(["entity"]);
  const entityText = entityOutput.stdout;
  assertEquals(entityOutput.code, 0);
  assertStringIncludes(entityText, "deno task dc -- entity");
  assertStringIncludes(entityText, "deno task dc -- entity search");
  assertStringIncludes(entityText, "deno task dc -- entity show");
  assertStringIncludes(entityText, "Use the printed `Show:` command");

  const searchOutput = await runDcCli(["entity", "search"]);
  const searchText = searchOutput.stdout;
  assertEquals(searchOutput.code, 0);
  assertStringIncludes(searchText, "deno task dc -- entity search <query>");
  assertStringIncludes(searchText, "Tip: run `deno task dc -- entity search District`");
  assertStringIncludes(searchText, "Use the printed `Show:` command");
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
      "--allow-run",
      "--allow-net",
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
