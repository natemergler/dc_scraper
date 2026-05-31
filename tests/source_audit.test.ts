import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderSourceAudit, sourceAuditRows } from "../src/source_audit.ts";
import { makeSnapshotEnvelope, writeSnapshot } from "../src/snapshots.ts";
import { writeSourceBaseline } from "../src/source_health.ts";
import { makeTempRepo } from "./helpers/temp_repo.ts";

Deno.test("combines source coverage and health into an audit view", async () => {
  const repoPath = await makeTempRepo();
  const envelope = await makeSnapshotEnvelope(
    "dcgis.agencies",
    "https://example.test/agencies",
    {
      metadata: { fields: [{ name: "OBJECTID" }, { name: "AGENCY_NAME" }] },
      row_count: 2,
      rows: [{}, {}],
    },
  );
  envelope.fetched_at = "2026-05-31T12:00:00.000Z";
  await writeSnapshot(repoPath, envelope);
  await writeSourceBaseline(repoPath, "dcgis.agencies");

  const rows = await sourceAuditRows(repoPath, ["dcgis.agencies"]);
  const text = renderSourceAudit(rows);

  assertEquals(rows[0].sourceId, "dcgis.agencies");
  assertEquals(rows[0].coverageStatus, "success");
  assertEquals(rows[0].healthStatus, "unchanged");
  assertEquals(rows[0].evidenceDepth, "row-backed");
  assertEquals(rows[0].claimScope, "rows, fields, and row counts");
  assertEquals(rows[0].count, 2);
  assertEquals(rows[0].snapshotPath?.endsWith("snapshots/dcgis/agencies/latest.json"), true);
  assertStringIncludes(text, "dcgis.agencies");
  assertStringIncludes(text, "arcgis_table");
  assertStringIncludes(text, "row-backed");
  assertStringIncludes(text, "scope: rows, fields, and row counts");
  assertStringIncludes(text, "2026-05-31");
});
