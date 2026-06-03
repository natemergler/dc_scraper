import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { endpointStatus } from "../src/v2/workbench/endpoint_status.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { syntheticCustomEntitySourceResult } from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("endpoint status classifies only the latest observation for a source item", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.endpoint_status.entities",
      candidateId: "candidate.test.endpoint_status.old",
      sourceItemKey: "endpoint-row",
      proposedEntityId: "dc.endpoint_status_target",
      name: "Endpoint Status Target",
      kind: "agency",
      observedName: "Endpoint Status Target",
    }),
    dataDir,
  );
  workbench.db.prepare(
    "update entity_candidates set review_status = 'rejected' where candidate_id = ?",
  ).run("candidate.test.endpoint_status.old");

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.endpoint_status.entities",
      candidateId: "candidate.test.endpoint_status.current",
      sourceItemKey: "endpoint-row",
      proposedEntityId: "dc.endpoint_status_target",
      name: "Endpoint Status Target",
      kind: "agency",
      observedName: "Endpoint Status Target",
    }),
    dataDir,
  );

  const status = endpointStatus(workbench, "dc.endpoint_status_target");
  workbench.close();

  assertEquals(status.state, "pending_candidate");
});

Deno.test("endpoint status keeps placeholders distinct from accepted endpoints", () => {
  const dir = Deno.makeTempDirSync();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    `insert into canonical_entities(
       entity_id, name, kind, review_status, is_placeholder, placeholder_reason, merged_candidate_ids, created_at, updated_at
     ) values('dc.placeholder_endpoint', 'Placeholder Endpoint', 'agency', 'accepted', 1, 'missing endpoint', '[]', datetime('now'), datetime('now'))`,
  ).run();

  const status = endpointStatus(workbench, "dc.placeholder_endpoint");
  workbench.close();

  assertEquals(status, {
    entityId: "dc.placeholder_endpoint",
    state: "placeholder",
    name: "Placeholder Endpoint",
  });
});
