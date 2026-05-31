import { assertEquals } from "@std/assert";
import { sourceCoverageRows } from "../src/source_coverage.ts";
import { makeSnapshotEnvelope, writeFailure, writeSnapshot } from "../src/snapshots.ts";
import { makeTempRepo } from "./helpers/temp_repo.ts";

Deno.test("reports source coverage from snapshots and failure manifests", async () => {
  const repoPath = await makeTempRepo();
  await writeSnapshot(
    repoPath,
    await makeSnapshotEnvelope("dcgis.agencies", "https://example.test/agencies", {
      row_count: 2,
      rows: [{}, {}],
    }),
  );
  await writeFailure(repoPath, {
    source_id: "dcregs",
    source_url: "https://example.test/dcregs",
    fetched_at: "2026-05-31T00:00:00Z",
    status: "failed",
    failure_mode: "http_403",
    error_summary: "Forbidden",
    recommended_follow_up: "Try again later.",
  });

  const rows = await sourceCoverageRows(repoPath, ["dcgis.agencies", "dcregs"]);

  assertEquals(rows[0].sourceId, "dcgis.agencies");
  assertEquals(rows[0].status, "success");
  assertEquals(rows[0].evidenceDepth, "row-backed");
  assertEquals(rows[0].claimScope, "rows, fields, and row counts");
  assertEquals(rows[0].count, 2);
  assertEquals(rows[1].sourceId, "dcregs");
  assertEquals(rows[1].status, "failed");
});
