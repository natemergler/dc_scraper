import { assertEquals, assertStringIncludes } from "@std/assert";
import { Database } from "@db/sqlite";
import { join } from "@std/path";
import { Workbench } from "../src/v2/workbench.ts";
import { syntheticCustomEntitySourceResult } from "./helpers/v2_reconciliation_helpers.ts";

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
    const statusOutput = await runDcCli(["status", "--db", dbPath]);
    assertEquals(statusOutput.code, 0);
    const statusText = statusOutput.stdout;
    assertStringIncludes(statusText, "Decisions: 0 open, 0 deferred");
    assertStringIncludes(statusText, "Browse: 1 source-backed row");

    const reviewListOutput = await runDcCli([
      "review",
      "list",
      "--mode",
      "entities",
      "--db",
      dbPath,
      "--limit",
      "1",
    ]);
    assertEquals(reviewListOutput.code, 0);
    const reviewListText = reviewListOutput.stdout;
    assertStringIncludes(reviewListText, "Browse rows: 1");

    const entitySearchOutput = await runDcCli([
      "entity",
      "search",
      "District",
      "--db",
      dbPath,
    ]);
    assertEquals(entitySearchOutput.code, 0);
    const entitySearchText = entitySearchOutput.stdout;
    assertStringIncludes(entitySearchText, "District Test Board");
  } finally {
    lockingDb.exec("rollback");
    lockingDb.close();
  }
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
