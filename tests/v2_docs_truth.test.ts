import { assertStringIncludes } from "@std/assert";

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
