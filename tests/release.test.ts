import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildRelease, inspectRelease } from "../src/releases.ts";
import { makeSnapshotEnvelope, writeSnapshot } from "../src/snapshots.ts";
import { makeTempRepo, writeFixtureRecords } from "./helpers/temp_repo.ts";

Deno.test("builds a release package from curated records", async () => {
  const repoPath = await makeTempRepo();
  await writeFixtureRecords(repoPath);
  await writeSnapshot(
    repoPath,
    await makeSnapshotEnvelope("dcgis.agencies", "https://example.test/agencies", {
      row_count: 1,
      rows: [{}],
    }),
  );

  const result = await buildRelease(repoPath, { releaseId: "test-v0" });

  assertEquals(result.releaseId, "test-v0");
  assertEquals(result.recordCounts, {
    public_sources: 1,
    legal_materials: 1,
    civic_units: 1,
    relationship_types: 1,
    relationships: 1,
    update_pipelines: 1,
    gaps: 1,
  });

  for (
    const file of [
      "manifest.json",
      "public_sources.json",
      "public_sources.csv",
      "legal_materials.json",
      "legal_materials.csv",
      "civic_units.json",
      "civic_units.csv",
      "relationship_types.json",
      "relationship_types.csv",
      "relationships.json",
      "relationships.csv",
      "update_pipelines.json",
      "update_pipelines.csv",
      "gaps.json",
      "gaps.csv",
      "checks_summary.json",
      "README.md",
      "caveats.md",
    ]
  ) {
    await Deno.stat(join(repoPath, "releases/test-v0", file));
  }

  const manifest = JSON.parse(
    await Deno.readTextFile(join(repoPath, "releases/test-v0/manifest.json")),
  );
  assertEquals(manifest.record_counts.civic_units, 1);
  assertEquals(manifest.files.includes("civic_units.csv"), true);
  assertEquals(manifest.source_snapshot_refs, ["snapshots/dcgis/agencies/latest.json"]);
  assertEquals(manifest.source_evidence_summary, { "row-backed": 1 });
  assertEquals(manifest.record_status_summary, {
    active: 3,
    needs_review: 1,
    open: 1,
    partial: 1,
    planned: 1,
  });

  const units = JSON.parse(
    await Deno.readTextFile(join(repoPath, "releases/test-v0/civic_units.json")),
  );
  assertEquals(units[0].id, "dc.mayor");

  const inspection = await inspectRelease(repoPath, "test-v0");
  assertStringIncludes(inspection, "Git commit: unknown");
  assertStringIncludes(inspection, "Record status:");
  assertStringIncludes(inspection, "needs_review: 1");
  assertStringIncludes(inspection, "Source evidence:");
  assertStringIncludes(inspection, "row-backed: 1");
  assertStringIncludes(inspection, "Source snapshots: 1");
  assertStringIncludes(inspection, "Caveats:");
  assertStringIncludes(inspection, "Thin fixture gap proving caveat generation.");

  const readme = await Deno.readTextFile(join(repoPath, "releases/test-v0/README.md"));
  assertStringIncludes(readme, "generated validation/source-drift findings");
  assertStringIncludes(readme, "snapshot references used as evidence");
  assertStringIncludes(readme, "### Evidence Depth");
  assertStringIncludes(readme, "### Record Review Status");
  assertStringIncludes(readme, "- release caveats:");

  const caveats = await Deno.readTextFile(join(repoPath, "releases/test-v0/caveats.md"));
  assertEquals(caveats.split("\n").every((line) => line.length <= 100), true);
});
