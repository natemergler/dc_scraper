import { handleV2Command, printHelp } from "../src/v2/cli.ts";

async function main(args: string[]): Promise<void> {
  if (args[0] === "--") args = args.slice(1);
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const routed = routeAliases(args);
  if (await handleV2Command(routed)) return;

  console.error(`Unknown command: ${args.join(" ")}`);
  printHelp();
  Deno.exit(2);
}

function routeAliases(args: string[]): string[] {
  if (args[0] === "init") return ["workbench", "init", ...args.slice(1)];
  if (args[0] === "status" || args[0] === "doctor") {
    return ["audit", args[0], ...args.slice(1)];
  }
  return args;
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
