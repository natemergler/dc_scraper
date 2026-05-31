import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { candidateDiff, generateCandidates, renderCandidate } from "../src/candidates.ts";
import { makeSnapshotEnvelope, writeSnapshot } from "../src/snapshots.ts";
import { makeTempRepo, writeYaml } from "./helpers/temp_repo.ts";

Deno.test("generates a stable agency candidate from an agency row", async () => {
  const repoPath = await makeTempRepo();
  await writeSnapshot(
    repoPath,
    await makeSnapshotEnvelope("dcgis.agencies", "https://example.test/table", {
      rows: [{ OBJECTID: 20, NAME: "Office of the Chief Financial Officer" }],
    }),
  );

  const candidates = await generateCandidates(repoPath, "dcgis.agencies");

  assertEquals(candidates.length, 1);
  assertEquals(candidates[0].id, "candidate.dcgis.agencies.20");
  assertEquals(candidates[0].proposed_record_id, "dc.office.of.the.chief.financial.officer");
  assertEquals(candidates[0].record.unit_kind, "agency");
});

Deno.test("generates a board commission or council kind from the source type", async () => {
  const repoPath = await makeTempRepo();
  await writeSnapshot(
    repoPath,
    await makeSnapshotEnvelope("dcgis.boards_commissions_councils", "https://example.test/table", {
      rows: [{ ENTITY_ID: 42, NAME: "Open Government Advisory Group", TYPE: "Commission" }],
    }),
  );

  const candidates = await generateCandidates(repoPath, "dcgis.boards_commissions_councils");

  assertEquals(candidates[0].id, "candidate.dcgis.boards_commissions_councils.42");
  assertEquals(candidates[0].record.unit_kind, "commission");
});

Deno.test("shows and diffs a candidate against its curated record", async () => {
  const repoPath = await makeTempRepo();
  await writeSnapshot(
    repoPath,
    await makeSnapshotEnvelope("dcgis.agencies", "https://example.test/table", {
      rows: [{ AGENCY_ID: 20, AGENCY_NAME: "DC Water", ACRONYM: "WASA" }],
    }),
  );
  const [candidate] = await generateCandidates(repoPath, "dcgis.agencies");
  await writeYaml(join(repoPath, "records/units/dc.dc.water.yml"), {
    id: "dc.dc.water",
    record_type: "civic_unit",
    name: "DC Water",
    aliases: ["WASA"],
    unit_kind: "public_authority",
    operating_layers: ["municipal", "regional"],
    source_refs: ["dcgis.agencies"],
  });

  const shown = renderCandidate(candidate);
  const diff = await candidateDiff(repoPath, candidate.id);

  assertEquals(shown.includes("Candidate: candidate.dcgis.agencies.20"), true);
  assertEquals(diff.some((item) => item.path === "/unit_kind"), true);
  assertEquals(diff.some((item) => item.path === "/operating_layers"), true);
});
