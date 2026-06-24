import { assertEquals } from "@std/assert";
import { cite } from "../../../src/core/types.ts";
import {
  dccouncilCommitteesBinding,
  dccouncilCommitteesSource,
} from "../../../src/jurisdictions/dc/sources/dccouncil_committees.ts";
import { interpretDccouncilCommittees } from "../../../src/jurisdictions/dc/interpreters/dccouncil_committees.ts";
import { interpretDccouncilMembers } from "../../../src/jurisdictions/dc/interpreters/dccouncil_members.ts";
import { type DcInterpreterContext } from "../../../src/jurisdictions/dc/interpreters/context.ts";

Deno.test("dccouncil.committees records become committee, councilmember, and membership fragments", () => {
  const output = interpretDccouncilCommittees([
    {
      source: dccouncilCommitteesSource.id,
      snapshotKey: "page-0",
      key: "committee-of-the-whole",
      payload: {
        committeeName: "Committee of the Whole",
        committeeSlug: "committee-of-the-whole",
        committeeType: "committee",
        committeeUrl: "https://dccouncil.gov/committees/committee-of-the-whole/",
        chairpersonName: "Chairman Phil Mendelson",
        chairpersonUrl: "https://dccouncil.gov/council/phil-mendelson/",
        councilmembers: [
          {
            name: "At-Large Councilmember Anita Bonds",
            url: "https://dccouncil.gov/council/anita-bonds/",
          },
        ],
      },
    },
  ]);

  assertEquals(output.entryFragments.length, 3);
  assertEquals(output.relationFragments.length, 3);
  assertEquals(output.findings, []);

  const [committeeEntry, chairEntry, memberEntry] = output.entryFragments;
  const [chairsRelation, chairMembershipRelation, memberRelation] = output.relationFragments;

  assertEquals(committeeEntry.provisionalId, "dc.committee:committee-of-the-whole");
  assertEquals(committeeEntry.kind, "dc.committee");
  assertEquals(committeeEntry.family, "organization");
  assertEquals(committeeEntry.attributes.sourceCommitteeSlug, "committee-of-the-whole");
  assertEquals(committeeEntry.attributes.committeeType, "committee");
  assertEquals(committeeEntry.citations, [
    cite(dccouncilCommitteesSource.id, "committee-of-the-whole"),
  ]);

  assertEquals(chairEntry.provisionalId, "dc.councilmember:phil-mendelson");
  assertEquals(chairEntry.kind, "dc.councilmember");
  assertEquals(chairEntry.family, "person");
  assertEquals(chairEntry.name, "Phil Mendelson");
  assertEquals(chairEntry.attributes.sourceProfileSlug, "phil-mendelson");
  assertEquals(
    chairEntry.attributes.sourceProfileUrl,
    "https://dccouncil.gov/council/phil-mendelson/",
  );
  assertEquals(chairEntry.attributes.officeLabel, "Chairman");

  assertEquals(memberEntry.provisionalId, "dc.councilmember:anita-bonds");
  assertEquals(memberEntry.kind, "dc.councilmember");
  assertEquals(memberEntry.name, "Anita Bonds");
  assertEquals(memberEntry.attributes.officeLabel, "At-Large Councilmember");

  assertEquals(chairsRelation.from, "dc.councilmember:phil-mendelson");
  assertEquals(chairsRelation.relationKind, "dc.relation:chairs");
  assertEquals(chairsRelation.to, "dc.committee:committee-of-the-whole");

  assertEquals(chairMembershipRelation.from, "dc.councilmember:phil-mendelson");
  assertEquals(chairMembershipRelation.relationKind, "dc.relation:member_of");
  assertEquals(chairMembershipRelation.to, "dc.committee:committee-of-the-whole");

  assertEquals(memberRelation.from, "dc.councilmember:anita-bonds");
  assertEquals(memberRelation.relationKind, "dc.relation:member_of");
  assertEquals(memberRelation.to, "dc.committee:committee-of-the-whole");
});

Deno.test("dccouncil.committees reports warning when chairperson is missing", () => {
  const output = interpretDccouncilCommittees([
    {
      source: dccouncilCommitteesSource.id,
      snapshotKey: "page-0",
      key: "committee-on-health",
      payload: {
        committeeName: "Committee on Health",
        committeeSlug: "committee-on-health",
        committeeType: "committee",
        committeeUrl: "https://dccouncil.gov/committees/committee-on-health/",
        councilmembers: [],
      },
    },
  ]);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].code, "dc.interpreter.council_committee_chair_missing");
});

Deno.test("dccouncil.committees source binding links interpreter", () => {
  assertEquals(dccouncilCommitteesBinding.source.id, dccouncilCommitteesSource.id);
  assertEquals(dccouncilCommitteesBinding.interpret, interpretDccouncilCommittees);
});

Deno.test("dccouncil.committees supplements Committee of the Whole membership from the roster source", () => {
  const context: DcInterpreterContext = {};

  interpretDccouncilMembers([
    {
      source: "dccouncil.members",
      snapshotKey: "page-0",
      key: "ward-8-councilmember-trayon-white-sr",
      payload: {
        memberName: "Ward 8 Councilmember Trayon White, Sr.",
        profileSlug: "councilmember-trayon-white-sr",
        profileUrl: "https://dccouncil.gov/council/councilmember-trayon-white-sr/",
      },
    },
  ], context);

  const output = interpretDccouncilCommittees([
    {
      source: dccouncilCommitteesSource.id,
      snapshotKey: "page-0",
      key: "committee-of-the-whole",
      payload: {
        committeeName: "Committee of the Whole",
        committeeSlug: "committee-of-the-whole",
        committeeType: "committee",
        committeeUrl: "https://dccouncil.gov/committees/committee-of-the-whole/",
        chairpersonName: "Chairman Phil Mendelson",
        chairpersonUrl: "https://dccouncil.gov/council/phil-mendelson/",
        councilmembers: [],
      },
    },
  ], context);

  assertEquals(
    output.relationFragments.some((relation) =>
      relation.relationKind === "dc.relation:member_of" &&
      relation.from === "dc.councilmember:councilmember-trayon-white-sr" &&
      relation.to === "dc.committee:committee-of-the-whole"
    ),
    true,
  );
  const ward8Relation = output.relationFragments.find((relation) =>
    relation.relationKind === "dc.relation:member_of" &&
    relation.from === "dc.councilmember:councilmember-trayon-white-sr"
  );
  assertEquals(ward8Relation?.citations, [
    cite("dccouncil.committees", "committee-of-the-whole"),
    cite("dccouncil.members", "ward-8-councilmember-trayon-white-sr"),
  ]);
});
