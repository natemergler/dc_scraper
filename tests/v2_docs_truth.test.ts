import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("README and CLI help stay aligned on the current operator entrypoints", async () => {
  const readme = await Deno.readTextFile("README.md");
  const topLevelHelp = await runCli(["--help"]);
  const releaseHelp = await runCli(["release", "--help"]);
  const smokeHelp = await runCli(["smoke", "--help"]);

  for (
    const command of [
      "deno task dc -- smoke tier0",
      "deno task dc -- smoke structure",
      "deno task dc -- release verify",
      "deno task dc -- release build --source-profile custom",
      "deno task dc -- release inspect",
    ]
  ) {
    assertStringIncludes(readme, command);
  }

  assertStringIncludes(topLevelHelp, "deno task dc -- smoke tier0");
  assertStringIncludes(topLevelHelp, "deno task dc -- release verify");
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
});

Deno.test("release file lists stay aligned across README, release help, and release contract docs", async () => {
  const readme = await Deno.readTextFile("README.md");
  const releaseContract = await Deno.readTextFile("docs/RELEASE_CONTRACT.md");
  const releaseHelp = await runCli(["release", "--help"]);

  for (
    const fileName of [
      "README.md",
      "manifest.json",
      "dcgov.sqlite",
      "entities.csv/json",
      "relationships.csv/json",
      "sources.csv/json",
      "datasets.csv/json",
      "legal_refs.csv/json",
      "entity_legal_refs.csv/json",
      "relationship_legal_refs.csv/json",
    ]
  ) {
    assertStringIncludes(readme, fileName);
    assertStringIncludes(releaseContract, fileName);
  }

  assertStringIncludes(releaseHelp, "relationship_legal_refs.*");
  assertStringIncludes(releaseHelp, "entity_legal_refs.*");
});

Deno.test("release contract explains compact model semantics without overclaiming", async () => {
  const releaseContract = await Deno.readTextFile("docs/RELEASE_CONTRACT.md");

  for (
    const phrase of [
      "Public official observations are source-backed role or seat observations, not a personnel or",
      "`datasets.*` and `legal_refs.*` are separate inventory/reference tables.",
      "`part_of`: component -> containing entity.",
      "`has_seat` / `has_status`: body, seat, or observation -> seat/status marker.",
      "civic subject -> governing, oversight, appointment, designation, legal-authority, or publication",
      "observation or role entity -> seat, district,",
      "body, or committee role.",
      "Compact `relationships.*` rows expose accepted directed facts, not row-level evidence payloads.",
      "`release verify` checks source-artifact provenance, release blockers, and repeatable",
      "visible review decisions stay in status, audit, manifest, and",
      "inspect surfaces without automatically invalidating source-backed release rows",
      "It checks that accepted entity and",
      "rows, dataset rows, legal-ref rows, and legal-ref attachment rows",
      "workbench decisions or references",
      "`release inspect` checks the built release directory against `manifest.json`",
      "DC city/county distinctions, legal coverage, personnel coverage, and dataset coverage are not",
    ]
  ) {
    assertStringIncludes(releaseContract, phrase);
  }
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
  return new TextDecoder().decode(output.stdout);
}
