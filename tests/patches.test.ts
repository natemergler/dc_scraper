import { assertEquals } from "@std/assert";
import { assertRejects } from "@std/assert";
import { join } from "@std/path";
import { writeCandidate } from "../src/candidates.ts";
import { applyActivePatches, applyPatch, PatchDocument, writePatch } from "../src/patches.ts";
import { makeTempRepo } from "./helpers/temp_repo.ts";

Deno.test("applies set append_unique and add_caveat patch operations", () => {
  const patch: PatchDocument = {
    id: "patch.dc.water",
    record_type: "patch",
    status: "active",
    candidate_id: "candidate.dcgis.agencies.20",
    operations: [
      { op: "set", path: "/unit_kind", expected_before: "agency", value: "public_authority" },
      { op: "append_unique", path: "/operating_layers", value: "regional" },
      { op: "add_caveat", path: "/caveats", value: "Regional authority edge case." },
    ],
  };

  const result = applyPatch({
    id: "dc.water",
    record_type: "civic_unit",
    unit_kind: "agency",
    operating_layers: ["municipal"],
  }, patch);

  assertEquals(result.status, "applied");
  assertEquals(result.value.unit_kind, "public_authority");
  assertEquals(result.value.operating_layers, ["municipal", "regional"]);
  assertEquals(result.value.caveats, ["Regional authority edge case."]);
});

Deno.test("emits a patch conflict when expected before fails", () => {
  const patch: PatchDocument = {
    id: "patch.dc.water",
    record_type: "patch",
    status: "active",
    candidate_id: "candidate.dcgis.agencies.20",
    operations: [
      { op: "set", path: "/unit_kind", expected_before: "agency", value: "public_authority" },
    ],
  };

  const result = applyPatch({ unit_kind: "independent_authority" }, patch);

  assertEquals(result.status, "conflict");
  assertEquals(result.conflicts.length, 1);
});

Deno.test("writes and applies active patches to patched candidates", async () => {
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
      name: "DC Water",
      unit_kind: "agency",
      operating_layers: ["municipal"],
    },
  });
  await writePatch(repoPath, {
    id: "patch.dc_water.classification",
    record_type: "patch",
    status: "active",
    candidate_id: "candidate.dcgis.agencies.20",
    operations: [
      { op: "set", path: "/unit_kind", expected_before: "agency", value: "public_authority" },
      { op: "append_unique", path: "/operating_layers", value: "regional" },
    ],
  });

  const result = await applyActivePatches(repoPath);

  assertEquals(result.applied, 1);
  assertEquals(result.conflicts, []);

  const patched = await Deno.readTextFile(
    join(repoPath, "candidates_patched/dcgis/agencies/candidate.dcgis.agencies.20.yml"),
  );
  assertEquals(patched.includes("public_authority"), true);
  assertEquals(patched.includes("regional"), true);
});

Deno.test("refuses to overwrite an existing patch by default", async () => {
  const repoPath = await makeTempRepo();
  const patch: PatchDocument = {
    id: "patch.dc_water.classification",
    record_type: "patch",
    status: "draft",
    candidate_id: "candidate.dcgis.agencies.20",
    operations: [
      { op: "set", path: "/unit_kind", value: "public_authority" },
    ],
  };

  await writePatch(repoPath, patch);

  await assertRejects(
    () => writePatch(repoPath, patch),
    Error,
    "Patch already exists",
  );
});
