import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { writeCandidate } from "../src/candidates.ts";
import { promoteCandidate } from "../src/promotion.ts";
import { makeTempRepo } from "./helpers/temp_repo.ts";

Deno.test("promotes a candidate into a curated record without overwriting", async () => {
  const repoPath = await makeTempRepo();
  await writeCandidate(repoPath, {
    id: "candidate.dcgis.agencies.20",
    record_type: "candidate",
    proposed_record_type: "civic_unit",
    proposed_record_id: "dc.ocfo",
    source_family: "dcgis",
    source_table: "government_operations.agencies",
    source_row_key: "20",
    generated_at: "2026-05-31T00:00:00Z",
    record: {
      id: "dc.ocfo",
      record_type: "civic_unit",
      name: "Office of the Chief Financial Officer",
      unit_kind: "agency",
      operating_layers: ["municipal"],
      source_refs: ["dcgis.agencies"],
    },
  });

  const first = await promoteCandidate(repoPath, "candidate.dcgis.agencies.20");
  const second = await promoteCandidate(repoPath, "candidate.dcgis.agencies.20");

  assertEquals(first.status, "created");
  assertEquals(second.status, "exists");

  const recordText = await Deno.readTextFile(join(repoPath, "records/units/dc.ocfo.yml"));
  assertEquals(recordText.includes("candidate.dcgis.agencies.20"), true);
});
