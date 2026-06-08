import { assertEquals } from "@std/assert";
import {
  DCCouncilmembersReader,
  type DCCouncilmembersSource,
} from "../../src/readers/dccouncil_councilmembers.ts";

Deno.test("DCCouncilmembersReader collects unique councilmember profile links", async () => {
  const source: DCCouncilmembersSource = {
    id: "dccouncil.members",
    jurisdiction: "dc",
    type: "dccouncil.members",
    rosterUrl: "https://dccouncil.gov/councilmembers/",
  };

  const html = `
    <a href="https://dccouncil.gov/council/phil-mendelson/">Chairman Phil Mendelson</a>
    <a href="https://dccouncil.gov/council/anita-bonds/">At-Large Councilmember Anita Bonds</a>
    <a href="https://dccouncil.gov/council/anita-bonds/">At-Large Councilmember Anita Bonds</a>
    <a href="https://dccouncil.gov/council/councilmember-trayon-white-sr/">Ward 8 Councilmember Trayon White, Sr.</a>
  `;

  const reader = new DCCouncilmembersReader({
    fetcher: async () => new Response(html, { status: 200 }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
  });

  assertEquals(result.snapshots.length, 1);
  assertEquals(result.records.length, 3);
  assertEquals(result.records[0].key, "phil-mendelson");
  assertEquals(result.records[1].key, "anita-bonds");
  assertEquals(result.records[2].key, "councilmember-trayon-white-sr");
});
