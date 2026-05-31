import { assertEquals } from "@std/assert";
import { compareSourceToBaseline, writeSourceBaseline } from "../src/source_health.ts";
import { makeSnapshotEnvelope, writeSnapshot } from "../src/snapshots.ts";
import { makeTempRepo } from "./helpers/temp_repo.ts";

Deno.test("detects added and removed publication manifest links", async () => {
  const repoPath = await makeTempRepo();
  await writeSnapshot(
    repoPath,
    await makeSnapshotEnvelope("ocfo_budget", "https://example.test/budget", {
      links: [
        { url: "https://example.test/fy2026.pdf", text: "FY 2026" },
        { url: "https://example.test/fy2025.pdf", text: "FY 2025" },
      ],
    }),
  );
  await writeSourceBaseline(repoPath, "ocfo_budget", {
    source_id: "ocfo_budget",
    source_url: "https://example.test/budget",
    captured_at: "2026-05-30T00:00:00Z",
    kind: "page_manifest",
    link_urls: [
      "https://example.test/fy2025.pdf",
      "https://example.test/old.pdf",
    ],
  });

  const result = await compareSourceToBaseline(repoPath, "ocfo_budget");

  assertEquals(result.status, "changed");
  assertEquals(result.addedLinks, ["https://example.test/fy2026.pdf"]);
  assertEquals(result.removedLinks, ["https://example.test/old.pdf"]);
});

Deno.test("detects added and removed publication manifest assets", async () => {
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
    captured_at: "2026-05-30T00:00:00Z",
    kind: "page_manifest",
    link_urls: [],
    asset_urls: [
      "https://example.test/old.js",
      "https://example.test/current.css",
    ],
  });

  const result = await compareSourceToBaseline(repoPath, "scout");

  assertEquals(result.status, "changed");
  assertEquals(result.addedAssets, ["https://example.test/main.js"]);
  assertEquals(result.removedAssets, ["https://example.test/old.js"]);
});

Deno.test("detects ArcGIS schema field changes", async () => {
  const repoPath = await makeTempRepo();
  await writeSnapshot(
    repoPath,
    await makeSnapshotEnvelope("dcgis.agencies", "https://example.test/agencies", {
      metadata: {
        fields: [
          { name: "OBJECTID", type: "esriFieldTypeOID" },
          { name: "AGENCY_NAME", type: "esriFieldTypeString" },
          { name: "NEW_FIELD", type: "esriFieldTypeString" },
        ],
      },
      rows: [],
      row_count: 0,
    }),
  );
  await writeSourceBaseline(repoPath, "dcgis.agencies", {
    source_id: "dcgis.agencies",
    source_url: "https://example.test/agencies",
    captured_at: "2026-05-30T00:00:00Z",
    kind: "arcgis_table",
    field_names: ["OBJECTID", "AGENCY_NAME", "OLD_FIELD"],
  });

  const result = await compareSourceToBaseline(repoPath, "dcgis.agencies");

  assertEquals(result.status, "changed");
  assertEquals(result.addedFields, ["NEW_FIELD"]);
  assertEquals(result.removedFields, ["OLD_FIELD"]);
});

Deno.test("detects JSON API endpoint manifest changes", async () => {
  const repoPath = await makeTempRepo();
  await writeSnapshot(
    repoPath,
    await makeSnapshotEnvelope("council_lims", "https://example.test/lims", {
      endpoints: [
        { id: "search_master", url: "https://example.test/api/Search/GetSearchMaster" },
        { id: "whats_new", url: "https://example.test/api/Search/GetWhatsNew" },
      ],
    }),
  );
  await writeSourceBaseline(repoPath, "council_lims", {
    source_id: "council_lims",
    source_url: "https://example.test/lims",
    captured_at: "2026-05-30T00:00:00Z",
    kind: "json_api_manifest",
    endpoint_ids: ["search_master", "old_endpoint"],
  });

  const result = await compareSourceToBaseline(repoPath, "council_lims");

  assertEquals(result.status, "changed");
  assertEquals(result.addedEndpoints, ["whats_new"]);
  assertEquals(result.removedEndpoints, ["old_endpoint"]);
});

Deno.test("detects source manifest kind changes", async () => {
  const repoPath = await makeTempRepo();
  await writeSnapshot(
    repoPath,
    await makeSnapshotEnvelope("council_hms", "https://example.test/hearings", {
      endpoints: [
        { id: "upcoming_hearings", url: "https://example.test/api/GetUpcomingHearings" },
      ],
    }),
  );
  await writeSourceBaseline(repoPath, "council_hms", {
    source_id: "council_hms",
    source_url: "https://example.test/hearings",
    captured_at: "2026-05-30T00:00:00Z",
    kind: "page_manifest",
    link_urls: [],
  });

  const result = await compareSourceToBaseline(repoPath, "council_hms");

  assertEquals(result.status, "changed");
  assertEquals(result.baselineKind, "page_manifest");
  assertEquals(result.currentKind, "json_api_manifest");
  assertEquals(result.addedEndpoints, ["upcoming_hearings"]);
});

Deno.test("writes a source baseline from the current snapshot", async () => {
  const repoPath = await makeTempRepo();
  await writeSnapshot(
    repoPath,
    await makeSnapshotEnvelope("boe_maps", "https://example.test/maps", {
      links: [{ url: "https://example.test/ward-map.pdf", text: "Ward map" }],
    }),
  );

  const baseline = await writeSourceBaseline(repoPath, "boe_maps");

  assertEquals(baseline.kind, "page_manifest");
  assertEquals(baseline.link_urls, ["https://example.test/ward-map.pdf"]);
});
