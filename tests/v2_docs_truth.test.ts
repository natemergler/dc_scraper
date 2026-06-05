import { assertEquals, assertStringIncludes } from "@std/assert";
import { RELEASE_FILE_NAMES } from "../src/v2/release.ts";

Deno.test("README and CLI help stay aligned on the current operator entrypoints", async () => {
  const readme = await Deno.readTextFile("README.md");
  const operatorGuide = await Deno.readTextFile("docs/OPERATOR_GUIDE.md");
  const sourceCoverage = await Deno.readTextFile("docs/SOURCE_COVERAGE.md");
  const normalizedReadme = normalizeWhitespace(readme);
  const normalizedOperatorGuide = normalizeWhitespace(operatorGuide);
  const topLevelHelp = await runCli(["--help"]);
  const releaseHelp = await runCli(["release", "--help"]);
  const smokeHelp = await runCli(["smoke", "--help"]);

  for (
    const command of [
      "deno task dc -- smoke tier0",
      "deno task dc -- smoke structure",
      'deno task dc -- status --db "$WORKBENCH_DB"',
      'deno task dc -- audit --db "$WORKBENCH_DB"',
      "deno task dc -- release verify",
      "deno task dc -- release build --source-profile custom",
      "deno task dc -- release inspect",
      "release readiness reasons",
      "`status --json` includes `review.browseCommand` when source-backed browse rows are present",
      "`status --json` and `audit --json` include failed-source detail and blocked-source `inspectCommand`",
      "handoffs when a source or reconciliation lane needs inspection",
      "those handoff commands stay\nscoped to the active workbench when `--db` is used",
      "includes latest",
      "fetch status, failure text, and `fetchCommand`",
      "`source inspect --json` includes `fetchCommand`",
      "`browseCommand` when the\nsource has rows to inspect",
      "`source compare public-bodies` prints `Next:` for the first unresolved\nconservative variant lead",
      "deno task dc -- source compare public-bodies --json",
      "`source compare public-bodies --json` includes `reviewCommands`",
      "`releaseRiskVariantMatchCount`",
      "accepted duplicate-risk subset, and `nextCommand` for the first review handoff",
      "When `--db` is used, source\nlist/inspect/fetch/compare handoff commands stay scoped to that workbench",
      "`source fetch --json` includes `successCount` and `failureCount`",
      "`smoke --json` includes `successCount`, `failureCount`, `releaseOutDir`,\n`releaseVerifyCommand`, `releaseBuildCommand`, `releaseInspectCommand`, and top-level\n`nextCommand`",
      "`review packets` prints `Next:` for the first packet",
      "`review packets --json` includes\n`summary`, `reviewCommand`, `nextCommand`, `itemCount`, `openCount`, and `deferredCount`",
      "`review list --json`\nincludes `summary`, `sourceId`, `label`, `reviewCommand`, `nextCommand`, `decisionCount`, and\n`browseCount`",
      "When `--db` is used, review list/packets handoff commands stay scoped to that workbench",
      "deno task dc -- entity search accountancy --json",
      "`entity search --json` includes\n`showCommand`",
      "`entity search` prints a `Show:` handoff",
      "`entity show --json` includes `reviewCommand`",
      "`entity show --json` includes\n`reviewCommand` on review items with source context and `nextCommand` for the first attached review\nhandoff",
      "When\n`--db` is used, entity search/show handoff commands stay scoped to that workbench",
      "`release verify --json`",
      "includes\n`buildCommand`, `warningReasons`, `warningReviewCommand`, and `publicBodyCompareCommand` for non-blocking",
      "public-body duplicate-risk warnings",
      "when `--db` is used, those handoff commands stay scoped to the verified workbench",
      "plus failed-source\ndetail when failed sources block release readiness",
      "`release inspect --json`\nincludes `warningReasons` separately from blocking `readinessReasons`",
      "`release inspect --json`\nincludes `warningReviewCommand`, `publicBodyCompareCommand`, and `browseCommand`",
      "`release inspect --json`\nincludes `inspectCommand`",
      "`release inspect --json`\nincludes `nextCommand`",
      "`public_body_release_risk_variant_lead_count`",
      "`release build --json`\nincludes `inspectCommand` and `nextCommand`",
    ]
  ) {
    assertStringIncludes(normalizedReadme, normalizeWhitespace(command));
  }

  for (
    const command of [
      'deno task dc -- status --db "$WORKBENCH_DB"',
      'deno task dc -- audit --db "$WORKBENCH_DB"',
      'deno task dc -- release verify --db "$WORKBENCH_DB"',
      'deno task dc -- release inspect --out "$FRESH_RELEASE_DIR"',
      "release readiness reasons",
      "Failed smoke\nfetches print an `Inspect failed source:` command scoped to that temp workbench DB",
      "Smoke text also prints workspace-scoped `Release out:`, `Release verify:`, `Release build:`,\nand `Release\ninspect:` handoffs",
      "`smoke --json` exposes the same `releaseOutDir`, `releaseVerifyCommand`,\n`releaseBuildCommand`, and `releaseInspectCommand` values plus the temp-workspace\n`nextCommand`",
      "`status` prints a `Browse rows:` handoff when source-backed browse\nrows exist and `status --json` exposes the same browse command",
      "`review packets`\nprints `Next:` for the first packet",
      "`review packets --json` exposes packet summaries, review commands,\nand a next command for the first packet",
      "`review list --json` exposes item summaries, source IDs,\nlabels, review commands, next commands, and decision/browse counts",
      "`review list`\nprints `Next:` when the current slice contains a human decision",
      "`source compare public-bodies` prints `Next:` for the first unresolved conservative variant lead",
      "`source compare public-bodies --json` exposes review commands",
      "a next command for the first review handoff",
      "source list/inspect/fetch/compare handoff commands stay\nscoped to that workbench",
      "`source list` prints `Inspect:` and `Fetch:` handoffs",
      "`source inspect` prints a `Browse:` handoff",
      "`entity search` prints a `Show:` handoff",
      "`entity show` prints `Next:` when open\nreview work is attached",
      "`entity search --json` exposes show commands",
      "`entity show --json` exposes review commands and a next command",
      "When `--db` is used, review list/packets and\nentity search/show handoff commands stay scoped to that workbench",
      "`status --json` and `audit --json` expose blocked-source inspect commands",
      "those status/audit handoff commands stay\nscoped to the active workbench when `--db` is used",
      "`release verify --json` exposes warning reasons separately from hard blocker reasons",
      "`release verify --json` exposes the build command, warning review command, and public-body compare command",
      "those commands stay scoped to the verified workbench when\n`--db` is used",
      "`release verify` prints a review-warning handoff",
      "`dc release inspect --json` when you need structured package-integrity, blocking readiness\nreasons, warning reasons, warning-review handoff, browse handoff, source-inspect handoff, next\ncommand, and release-summary details",
      "Batch commands print `Next:` to send the operator back through\nstatus after writing decisions",
      "Open or deferred\nreview decisions are warning reasons, not hard blocker reasons",
      "when a lane fails, inspect the source named in the printed next command",
    ]
  ) {
    assertStringIncludes(normalizedOperatorGuide, normalizeWhitespace(command));
  }

  assertStringIncludes(topLevelHelp, "deno task dc -- smoke tier0");
  assertStringIncludes(topLevelHelp, "deno task dc -- audit");
  assertStringIncludes(topLevelHelp, "deno task dc -- status --json");
  assertStringIncludes(topLevelHelp, "deno task dc -- release verify");
  assertStringIncludes(topLevelHelp, "deno task dc -- review packets");
  assertStringIncludes(topLevelHelp, "--decisions");
  assertStringIncludes(releaseHelp, "deno task dc -- release verify");
  assertEquals(
    releaseHelp.indexOf("deno task dc -- release verify"),
    releaseHelp.lastIndexOf("deno task dc -- release verify"),
  );
  assertEquals(
    releaseHelp.indexOf("deno task dc -- release verify") <
      releaseHelp.indexOf("deno task dc -- release build"),
    true,
  );
  assertStringIncludes(releaseHelp, "--source-profile <structure|tier0|inventory|custom>");
  assertStringIncludes(smokeHelp, "deno task dc -- smoke inventory");
  assertStringIncludes(
    sourceCoverage,
    "latest fetch status, failure text, and per-source fetch commands",
  );
  assertEquals(readme.includes("notes/"), false);
  assertEquals(readme.includes("seam"), false);
  assertEquals(operatorGuide.includes("seam"), false);
});

Deno.test("release file lists stay aligned across README, release help, and release contract docs", async () => {
  const readme = await Deno.readTextFile("README.md");
  const releaseContract = await Deno.readTextFile("docs/RELEASE_CONTRACT.md");
  const releaseHelp = await runCli(["release", "--help"]);

  for (const fileName of RELEASE_FILE_NAMES) {
    assertStringIncludes(readme, fileName);
    assertStringIncludes(releaseContract, fileName);
    assertStringIncludes(releaseHelp, fileName);
  }
});

Deno.test("release contract explains compact model semantics without overclaiming", async () => {
  const readme = await Deno.readTextFile("README.md");
  const releaseContract = await Deno.readTextFile("docs/RELEASE_CONTRACT.md");
  const sourceCoverage = await Deno.readTextFile("docs/SOURCE_COVERAGE.md");

  for (
    const phrase of [
      "Public official observations are source-backed role or seat observations, not a personnel or",
      "`02_public_datasets.csv` and `03_legal_authorities.csv` are separate inventory/reference views.",
      "`part_of`: component -> containing entity.",
      "`has_seat` / `has_status`: body, seat, or observation -> seat/status marker.",
      "civic subject -> governing, oversight, appointment, designation, legal-authority, or publication",
      "observation or role entity -> seat, district,",
      "body, or committee role.",
      "Compact `relationships/all_relationships.csv` rows expose accepted directed facts, not row-level",
      "`release verify` checks source-artifact provenance, release blockers, and repeatable",
      "visible review decisions stay in status, audit, manifest, and",
      "inspect surfaces without automatically invalidating source-backed release rows",
      "It checks that accepted entity and",
      "rows, dataset rows, legal-ref rows, and legal-ref attachment rows",
      "workbench decisions or references",
      "`release inspect` checks the built release directory against `manifest.json`",
      "prints compact blocking\nreadiness reasons and warning reasons from `release_summary`",
      "blocking `readinessReasons`, `warningReasons`, `warningReviewCommand`,\n`publicBodyCompareCommand`, `browseCommand`, `inspectCommand`, `nextCommand`, and release-summary\ndetails",
      "`public_body_release_risk_variant_lead_count` isolates accepted duplicate-risk leads",
      "known\npackage-integrity problems are counted in readiness reasons",
      "DC city/county distinctions, legal coverage, personnel coverage, and dataset coverage are not",
      "Personal contact details and local filesystem paths are never allowed in release output.",
    ]
  ) {
    assertStringIncludes(releaseContract, phrase);
  }
  assertStringIncludes(readme, "Personal contact details are out of scope");
  assertStringIncludes(readme, "local paths should stay out of release exports");
  assertStringIncludes(
    sourceCoverage,
    "latest fetch status, failure text, and per-source fetch commands",
  );
});

async function runCli(args: string[]): Promise<string> {
  const output = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      ...args,
    ],
  }).output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  return new TextDecoder().decode(output.stdout);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}
