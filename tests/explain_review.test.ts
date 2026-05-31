import { assertEquals } from "@std/assert";
import { explainRecord } from "../src/explain.ts";
import { nextReviewItem } from "../src/review.ts";
import { makeSnapshotEnvelope, writeSnapshot } from "../src/snapshots.ts";
import { makeTempRepo, writeFixtureRecords } from "./helpers/temp_repo.ts";

Deno.test("explains a record using source refs checks and caveats", async () => {
  const repoPath = await makeTempRepo();
  await writeFixtureRecords(repoPath);

  const text = await explainRecord(repoPath, "dc.mayor");

  assertEquals(text.includes("Record: dc.mayor"), true);
  assertEquals(text.includes("Source refs:"), true);
  assertEquals(text.includes("open_data_dc"), true);
});

Deno.test("surfaces the highest-priority review item", async () => {
  const repoPath = await makeTempRepo();
  await writeFixtureRecords(repoPath);

  const item = await nextReviewItem(repoPath);

  assertEquals(item?.kind, "high_priority_gap");
  assertEquals(
    item?.reason,
    "No blocking error or patch work is left, so the highest-priority open gap is next.",
  );
  assertEquals(item?.suggested_command, "deno task dc -- gaps show legal_authority_crosswalk");
});

Deno.test("surfaces stale source snapshots before open gaps", async () => {
  const repoPath = await makeTempRepo();
  await writeFixtureRecords(repoPath);
  const envelope = await makeSnapshotEnvelope(
    "dcgis.agencies",
    "https://example.test/agencies",
    { rows: [] },
  );
  envelope.fetched_at = "2000-01-01T00:00:00.000Z";
  await writeSnapshot(repoPath, envelope);

  const item = await nextReviewItem(repoPath);

  assertEquals(item?.kind, "source_health");
  assertEquals(item?.title, "check.stale_source_snapshot.dcgis.agencies");
  assertEquals(
    item?.reason,
    "Source drift or a stale fetch is more urgent than new curation work.",
  );
  assertEquals(item?.suggested_command, "deno task dc -- fetch source dcgis.agencies");
});
