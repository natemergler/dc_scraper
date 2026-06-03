import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { Workbench } from "../src/v2/workbench.ts";
import { syntheticCustomRelationshipSourceResult } from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("review packets groups related relationship work conservatively", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  seedAcceptedEntity(workbench, "dc.target_agency", "Target Agency", "agency");
  seedAcceptedEntity(workbench, "dc.alt_agency", "Alt Agency", "agency");
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_packets.relationships",
      relationshipCandidateId: "relationship.test.review_packets.one",
      sourceItemKey: "review-packet-row-one",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Health",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_packets.relationships",
      relationshipCandidateId: "relationship.test.review_packets.two",
      sourceItemKey: "review-packet-row-two",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.alt_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Education",
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
      "packets",
      "--mode",
      "relationships",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();

  assertEquals(output.code, 0);
  const body = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    count: number;
    packets: Array<{
      sourceId: string;
      relationshipType?: string;
      count: number;
      openCount: number;
    }>;
  };
  assertEquals(body.count, 1);
  assertEquals(body.packets[0].sourceId, "test.review_packets.relationships");
  assertEquals(body.packets[0].relationshipType, "overseen_by");
  assertEquals(body.packets[0].count, 2);
  assertEquals(body.packets[0].openCount, 2);
});

Deno.test("interactive review shows packet context before the current item", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  seedAcceptedEntity(workbench, "dc.target_agency", "Target Agency", "agency");
  seedAcceptedEntity(workbench, "dc.alt_agency", "Alt Agency", "agency");
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_packets.relationships",
      relationshipCandidateId: "relationship.test.review_packets.three",
      sourceItemKey: "review-packet-row-three",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Health",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_packets.relationships",
      relationshipCandidateId: "relationship.test.review_packets.four",
      sourceItemKey: "review-packet-row-four",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.alt_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Education",
    }),
    dataDir,
  );
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
      "--mode",
      "relationships",
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
  await writer.write(new TextEncoder().encode("q\n"));
  await writer.close();
  const output = await child.output();

  assertEquals(output.code, 0);
  const stdout = new TextDecoder().decode(output.stdout);
  assertStringIncludes(
    stdout,
    "Packet: test.review_packets.relationships overseen_by (2 item(s); open=2, deferred=0)",
  );
  assertStringIncludes(stdout, "Review stopped. 2 item(s) remain.");
});

function seedAcceptedEntity(
  workbench: Workbench,
  entityId: string,
  name: string,
  kind: string,
): void {
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run([entityId, name, kind]);
}
