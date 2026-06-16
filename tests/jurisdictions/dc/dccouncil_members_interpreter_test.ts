import { assertEquals } from "@std/assert";
import { cite } from "../../../src/core/types.ts";
import { interpretDccouncilMembers } from "../../../src/jurisdictions/dc/interpreters/dccouncil_members.ts";

Deno.test("dccouncil.members records emit ward and elected office structure", () => {
  const output = interpretDccouncilMembers([
    {
      source: "dccouncil.members",
      snapshotKey: "page-0",
      key: "ward-4-councilmember-janeese-lewis-george",
      payload: {
        memberName: "Ward 4 Councilmember Janeese Lewis George",
        profileSlug: "ward-4-councilmember-janeese-lewis-george",
        profileUrl: "https://dccouncil.gov/council/ward-4-councilmember-janeese-lewis-george/",
      },
    },
  ]);

  assertEquals(output.findings, []);
  assertEquals(output.entryFragments.length, 3);
  assertEquals(output.relationFragments.length, 3);

  const councilmember = output.entryFragments.find((entry) => entry.kind === "dc.councilmember");
  const office = output.entryFragments.find((entry) => entry.kind === "dc.elected_office");
  const ward = output.entryFragments.find((entry) => entry.kind === "dc.ward");

  assertEquals(councilmember?.name, "Janeese Lewis George");
  assertEquals(councilmember?.attributes.officeLabel, "Ward 4 Councilmember");
  assertEquals(councilmember?.attributes.wardNumber, "4");
  assertEquals(office?.provisionalId, "dc.elected_office:ward-4-councilmember");
  assertEquals(office?.name, "Ward 4 Councilmember");
  assertEquals(ward?.provisionalId, "dc.ward:4");
  assertEquals(ward?.name, "Ward 4");

  assertEquals(output.relationFragments, [
    {
      fragmentType: "relation",
      source: "dccouncil.members",
      sourceRecordId: "ward-4-councilmember-janeese-lewis-george",
      from: "dc.councilmember:ward-4-councilmember-janeese-lewis-george",
      relationKind: "dc.relation:holds",
      to: "dc.elected_office:ward-4-councilmember",
      citations: [cite("dccouncil.members", "ward-4-councilmember-janeese-lewis-george")],
    },
    {
      fragmentType: "relation",
      source: "dccouncil.members",
      sourceRecordId: "ward-4-councilmember-janeese-lewis-george",
      from: "dc.councilmember:ward-4-councilmember-janeese-lewis-george",
      relationKind: "dc.relation:represents",
      to: "dc.ward:4",
      citations: [cite("dccouncil.members", "ward-4-councilmember-janeese-lewis-george")],
    },
    {
      fragmentType: "relation",
      source: "dccouncil.members",
      sourceRecordId: "ward-4-councilmember-janeese-lewis-george",
      from: "dc.elected_office:ward-4-councilmember",
      relationKind: "dc.relation:represents",
      to: "dc.ward:4",
      citations: [cite("dccouncil.members", "ward-4-councilmember-janeese-lewis-george")],
    },
  ]);
});

Deno.test("dccouncil.members records normalize at-large office labels", () => {
  const output = interpretDccouncilMembers([
    {
      source: "dccouncil.members",
      snapshotKey: "page-0",
      key: "anita-bonds",
      payload: {
        memberName: "At-Large Councilmember Anita Bonds",
        profileSlug: "anita-bonds",
        profileUrl: "https://dccouncil.gov/council/anita-bonds/",
      },
    },
  ]);

  assertEquals(output.findings, []);
  assertEquals(output.entryFragments.length, 2);
  assertEquals(output.relationFragments.length, 1);
  assertEquals(output.entryFragments[0].name, "Anita Bonds");
  assertEquals(output.entryFragments[1].provisionalId, "dc.elected_office:at-large-councilmember");
  assertEquals(output.relationFragments[0].relationKind, "dc.relation:holds");
});
