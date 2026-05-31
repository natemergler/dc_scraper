import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { validateRepo } from "../src/validation.ts";
import { makeTempRepo, writeFixtureRecords, writeYaml } from "./helpers/temp_repo.ts";

Deno.test("validates a good curated record set", async () => {
  const repoPath = await makeTempRepo();
  await writeFixtureRecords(repoPath);

  const checks = await validateRepo(repoPath);

  assertEquals(checks.filter((check) => check.severity === "error"), []);
});

Deno.test("emits an error check for a path id mismatch", async () => {
  const repoPath = await makeTempRepo();
  await writeFixtureRecords(repoPath);
  await writeYaml(join(repoPath, "records/units/wrong.yml"), {
    id: "dc.right",
    record_type: "civic_unit",
    name: "Right path expected",
    unit_kind: "agency",
    operating_layers: ["municipal"],
    source_refs: ["open_data_dc"],
  });

  const checks = await validateRepo(repoPath);

  assertEquals(
    checks.some((check) => check.kind === "path_id_mismatch" && check.severity === "error"),
    true,
  );
});

Deno.test("emits an error check for a dangling relationship endpoint", async () => {
  const repoPath = await makeTempRepo();
  await writeFixtureRecords(repoPath);
  await writeYaml(join(repoPath, "records/relationships/broken.yml"), {
    id: "broken",
    record_type: "relationship",
    name: "Broken relationship",
    relationship_type_id: "appoints",
    source_actor: { kind: "civic_unit", id: "dc.missing" },
    target_actor: { kind: "external", name: "External actor" },
    source_refs: ["open_data_dc"],
  });

  const checks = await validateRepo(repoPath);

  assertEquals(
    checks.some((check) =>
      check.kind === "broken_internal_ref" && check.message.includes("dc.missing")
    ),
    true,
  );
});
