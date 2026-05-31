import { assertEquals, assertStringIncludes } from "@std/assert";
import { findGap, listGaps, renderGap, renderGapList } from "../src/gaps.ts";
import { makeTempRepo, writeFixtureRecords } from "./helpers/temp_repo.ts";

Deno.test("lists and renders release-visible gaps", async () => {
  const repoPath = await makeTempRepo();
  await writeFixtureRecords(repoPath);

  const gaps = await listGaps(repoPath);
  const listText = renderGapList(gaps);

  assertEquals(gaps.map((gap) => gap.id), ["legal_authority_crosswalk"]);
  assertStringIncludes(listText, "legal_authority_crosswalk");
  assertStringIncludes(listText, "warning");
  assertStringIncludes(listText, "release");
});

Deno.test("shows one gap with source refs and description", async () => {
  const repoPath = await makeTempRepo();
  await writeFixtureRecords(repoPath);

  const gap = await findGap(repoPath, "legal_authority_crosswalk");
  const text = renderGap(gap);

  assertStringIncludes(text, "Gap: legal_authority_crosswalk");
  assertStringIncludes(text, "Thin fixture gap proving caveat generation.");
  assertStringIncludes(text, "Source refs:");
  assertStringIncludes(text, "open_data_dc");
});
