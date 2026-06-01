import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("prints CLI help for the public workbench commands", async () => {
  const output = await runDcCommand(["--help"]);

  assertEquals(output.code, 0);
  assertStringIncludes(output.stdout, "dc civic content workbench");
  assertStringIncludes(output.stdout, "dc release inspect [release-id]");
  assertStringIncludes(output.stdout, "dc sources audit");
  assertStringIncludes(output.stdout, "dc sources health");
  assertStringIncludes(output.stdout, "dc review next");
  assertStringIncludes(output.stdout, "dc review list [--mode <mode>]");
  assertStringIncludes(output.stdout, "dc review batch accept-safe");
  assertStringIncludes(output.stdout, "dc gaps list");
  assertStringIncludes(output.stdout, "dc gaps show <gap-id>");
});

Deno.test("unknown CLI command exits with help", async () => {
  const output = await runDcCommand(["what-is-this"]);

  assertEquals(output.code, 2);
  assertStringIncludes(output.stderr, "Unknown command: what-is-this");
  assertStringIncludes(output.stdout, "dc civic content workbench");
});

async function runDcCommand(args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-net",
      "scripts/dc.ts",
      ...args,
    ],
    cwd: Deno.cwd(),
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}
