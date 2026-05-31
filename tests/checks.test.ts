import { assertEquals } from "@std/assert";
import { writeCandidate } from "../src/candidates.ts";
import { generateChecks } from "../src/checks.ts";
import { writePatch } from "../src/patches.ts";
import { makeSnapshotEnvelope, writeSnapshot } from "../src/snapshots.ts";
import { writeSourceBaseline } from "../src/source_health.ts";
import { makeTempRepo } from "./helpers/temp_repo.ts";

Deno.test("emits a patch conflict check when an active patch expectation fails", async () => {
  const repoPath = await makeTempRepo();
  await writeCandidate(repoPath, {
    id: "candidate.dcgis.agencies.20",
    record_type: "candidate",
    proposed_record_type: "civic_unit",
    proposed_record_id: "dc.water",
    source_family: "dcgis",
    source_table: "government_operations.agencies",
    source_row_key: "20",
    generated_at: "2026-05-31T00:00:00Z",
    record: {
      id: "dc.water",
      record_type: "civic_unit",
      unit_kind: "public_authority",
    },
  });
  await writePatch(repoPath, {
    id: "patch.dc_water.classification",
    record_type: "patch",
    status: "active",
    candidate_id: "candidate.dcgis.agencies.20",
    operations: [
      { op: "set", path: "/unit_kind", expected_before: "agency", value: "public_authority" },
    ],
  });

  const checks = await generateChecks(repoPath);

  assertEquals(checks.some((check) => check.kind === "patch_expected_before_failed"), true);
});

Deno.test("emits a large snapshot policy check when a raw snapshot exceeds the configured limit", async () => {
  const repoPath = await makeTempRepo();
  await writeSnapshot(
    repoPath,
    await makeSnapshotEnvelope("dcgis.agencies", "https://example.test/agencies", {
      rows: [{ description: "this fixture is intentionally larger than the test policy" }],
    }),
  );
  const previousLimit = Deno.env.get("DC_SNAPSHOT_SIZE_LIMIT_BYTES");
  Deno.env.set("DC_SNAPSHOT_SIZE_LIMIT_BYTES", "64");

  try {
    const checks = await generateChecks(repoPath);
    const largeSnapshotCheck = checks.find((check) => check.kind === "large_snapshot_file");

    assertEquals(largeSnapshotCheck?.id, "check.large_snapshot_file.dcgis.agencies");
    assertEquals(largeSnapshotCheck?.severity, "warning");
    assertEquals(largeSnapshotCheck?.release_relevant, false);
  } finally {
    if (previousLimit === undefined) {
      Deno.env.delete("DC_SNAPSHOT_SIZE_LIMIT_BYTES");
    } else {
      Deno.env.set("DC_SNAPSHOT_SIZE_LIMIT_BYTES", previousLimit);
    }
  }
});

Deno.test("emits a stale source snapshot check when required source verification is too old", async () => {
  const repoPath = await makeTempRepo();
  const envelope = await makeSnapshotEnvelope(
    "dcgis.agencies",
    "https://example.test/agencies",
    { rows: [] },
  );
  envelope.fetched_at = "2000-01-01T00:00:00.000Z";
  await writeSnapshot(repoPath, envelope);

  const checks = await generateChecks(repoPath);
  const staleCheck = checks.find((check) => check.kind === "stale_source_snapshot");

  assertEquals(staleCheck?.id, "check.stale_source_snapshot.dcgis.agencies");
  assertEquals(staleCheck?.severity, "warning");
  assertEquals(staleCheck?.release_relevant, true);
});

Deno.test("emits a publication manifest check when page assets change", async () => {
  const repoPath = await makeTempRepo();
  await writeSnapshot(
    repoPath,
    await makeSnapshotEnvelope("scout", "https://example.test/scout", {
      links: [],
      assets: [
        { kind: "script", url: "https://example.test/main.js" },
        { kind: "stylesheet", url: "https://example.test/current.css" },
      ],
    }),
  );
  await writeSourceBaseline(repoPath, "scout", {
    source_id: "scout",
    source_url: "https://example.test/scout",
    captured_at: "2026-05-31T00:00:00Z",
    kind: "page_manifest",
    link_urls: [],
    asset_urls: [
      "https://example.test/old.js",
      "https://example.test/current.css",
    ],
  });

  const checks = await generateChecks(repoPath);
  const manifestCheck = checks.find((check) =>
    check.id === "check.publication_manifest_changed.scout"
  );

  assertEquals(manifestCheck?.severity, "warning");
  assertEquals(manifestCheck?.release_relevant, true);
  assertEquals(manifestCheck?.message.includes("Added assets: 1"), true);
  assertEquals(manifestCheck?.message.includes("Removed assets: 1"), true);
});
