import { assertEquals } from "@std/assert";

import {
  DCCouncilCommitteePagesReader,
  type DCCouncilCommitteePagesSource,
} from "../../src/readers/dccouncil_committee_pages.ts";

Deno.test("DCCouncilCommitteePagesReader collects committee pages from the official index", async () => {
  const source: DCCouncilCommitteePagesSource = {
    id: "dccouncil.committees",
    jurisdiction: "dc",
    type: "dccouncil.committees",
    indexUrl: "https://dccouncil.gov/committees/",
  };

  const responses = new Map<string, string>([
    [
      source.indexUrl,
      `
      <h3>Committees</h3>
      <ul>
        <li><a href="https://dccouncil.gov/committees/committee-of-the-whole/">Committee of the Whole</a></li>
        <li><a href="https://dccouncil.gov/committees/sub-committee-on-local-business-development/">Sub-Committee on Local Business Development</a></li>
      </ul>
      `,
    ],
    [
      "https://dccouncil.gov/committees/committee-of-the-whole/",
      `
      <h1>Committee of the Whole</h1>
      <h2>Councilmembers</h2>
      <h4>Chairperson</h4>
      <p><a href="https://dccouncil.gov/council/phil-mendelson/">Chairman Phil Mendelson</a></p>
      <hr>
      <h4>Councilmembers</h4>
      <ul>
        <li><a href="https://dccouncil.gov/council/anita-bonds/">At-Large Councilmember Anita Bonds</a></li>
        <li><a href="https://dccouncil.gov/council/brianne-nadeau/">Ward 1 Councilmember Brianne K. Nadeau</a></li>
      </ul>
      <h2>Agencies Under This Committee</h2>
      `,
    ],
    [
      "https://dccouncil.gov/committees/sub-committee-on-local-business-development/",
      `
      <h1>Sub-Committee on Local Business Development</h1>
      <h2>Councilmembers</h2>
      <h4>Chairperson</h4>
      <p><a href="https://dccouncil.gov/council/ward-2-councilmember-brooke-pinto/">Ward 2 Councilmember Brooke Pinto</a></p>
      <hr>
      <h4>Councilmembers</h4>
      <ul>
        <li><a href="https://dccouncil.gov/council/at-large-councilmember-doni-crawford/">At-Large Councilmember Doni Crawford</a></li>
      </ul>
      <h2>Agencies Under This Committee</h2>
      `,
    ],
  ]);

  const reader = new DCCouncilCommitteePagesReader({
    fetcher: async (input) => new Response(responses.get(input) ?? "", { status: 200 }),
  });

  const result = await reader.collect({
    workspace: { root: "/tmp/workspace" },
    source,
  });

  assertEquals(result.snapshots.length, 3);
  assertEquals(result.records.length, 2);
  assertEquals(result.records[0].key, "committee-of-the-whole");
  assertEquals(result.records[0].payload.committeeType, "committee");
  assertEquals(result.records[0].payload.chairpersonName, "Chairman Phil Mendelson");
  assertEquals(result.records[0].payload.councilmembers, [
    {
      name: "At-Large Councilmember Anita Bonds",
      url: "https://dccouncil.gov/council/anita-bonds/",
    },
    {
      name: "Ward 1 Councilmember Brianne K. Nadeau",
      url: "https://dccouncil.gov/council/brianne-nadeau/",
    },
  ]);
  assertEquals(result.records[1].key, "sub-committee-on-local-business-development");
  assertEquals(result.records[1].payload.committeeType, "subcommittee");
});
