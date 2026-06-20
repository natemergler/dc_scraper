import { assertEquals } from "@std/assert";
import { cite, type Finding } from "../../../src/core/types.ts";
import {
  oancProfilesBinding,
  oancProfilesSource,
} from "../../../src/jurisdictions/dc/sources/oanc_profiles.ts";
import { interpretOancProfiles } from "../../../src/jurisdictions/dc/interpreters/oanc_profiles.ts";

Deno.test("oanc.profiles records enrich existing ANC entries", () => {
  const output = interpretOancProfiles([
    {
      source: oancProfilesSource.id,
      snapshotKey: "profile-0",
      key: "4E",
      payload: {
        ancId: "4E",
        name: "ANC 4E",
        profileUrl: "https://oanc.dc.gov/anc-profile/anc-4e",
        officialUrl: "https://anc4e.example/",
        representedNeighborhoods: "the Crestwood and 16th Street Heights neighborhoods",
        wardNumbers: ["4"],
        pageLastModified: "2026-06-16T21:58:02.000Z",
        commissioners: [{
          smdId: "4E01",
          name: 'Aretha "Nikki" Jones',
          officerRole: "Treasurer",
        }],
      },
    },
  ]);

  assertEquals(output.findings, []);
  assertEquals(output.entryFragments.length, 3);
  assertEquals(output.relationFragments.length, 1);
  assertEquals(output.entryFragments[0].provisionalId, "dc.anc:4E");
  assertEquals(output.entryFragments[0].kind, "dc.anc");
  assertEquals(output.entryFragments[0].attributes.sourceAncId, "4E");
  assertEquals(
    output.entryFragments[0].attributes.sourceOancProfileUrl,
    "https://oanc.dc.gov/anc-profile/anc-4e",
  );
  assertEquals(
    output.entryFragments[0].attributes.representedNeighborhoods,
    "the Crestwood and 16th Street Heights neighborhoods",
  );
  assertEquals(output.entryFragments[0].attributes.officialUrl, "https://anc4e.example/");
  assertEquals(
    output.entryFragments[0].attributes.sourcePageLastModified,
    "2026-06-16T21:58:02.000Z",
  );
  assertEquals(output.entryFragments[0].attributes.sourceWardNumbers, ["4"]);
  assertEquals(output.entryFragments[0].citations, [
    cite(oancProfilesSource.id, "4E", { url: "https://oanc.dc.gov/anc-profile/anc-4e" }),
  ]);
  assertEquals(output.entryFragments[1].provisionalId, "dc.anc_commissioner_seat:4E01");
  assertEquals(output.entryFragments[1].kind, "dc.anc_commissioner_seat");
  assertEquals(output.entryFragments[1].attributes.currentHolderName, 'Aretha "Nikki" Jones');
  assertEquals(output.entryFragments[1].attributes.officerRole, "Treasurer");
  assertEquals(
    output.entryFragments[1].attributes.sourceOancProfileUrl,
    "https://oanc.dc.gov/anc-profile/anc-4e",
  );
  assertEquals(output.entryFragments[2].provisionalId, "dc.ward:4");
  assertEquals(output.entryFragments[2].kind, "dc.ward");
  assertEquals(output.relationFragments[0], {
    fragmentType: "relation",
    source: oancProfilesSource.id,
    sourceRecordId: "4E",
    from: "dc.ward:4",
    relationKind: "dc.relation:contains",
    to: "dc.anc:4E",
    citations: [cite(oancProfilesSource.id, "4E")],
  });
});

Deno.test("oanc.profiles supports ANCs listed under multiple wards", () => {
  const output = interpretOancProfiles([
    {
      source: oancProfilesSource.id,
      snapshotKey: "profile-0",
      key: "6/8F",
      payload: {
        ancId: "6/8F",
        name: "ANC 6/8F",
        profileUrl: "https://oanc.dc.gov/anc-profile/anc-68f",
        wardNumbers: ["6", "8"],
        officialUrl: "http://anc8f.org/",
        commissioners: [{
          smdId: "6/8F01",
          name: "Nic Wilson",
        }],
      },
    },
  ]);

  assertEquals(output.findings.map((finding) => finding.code), [
    "dc.interpreter.oanc_commissioner_slash_smd_deferred",
  ]);
  assertEquals(output.entryFragments.map((entry) => entry.provisionalId), [
    "dc.anc:6~2F8F",
    "dc.ward:6",
    "dc.ward:8",
  ]);
  assertEquals(output.relationFragments.map((relation) => relation.to), [
    "dc.anc:6~2F8F",
    "dc.anc:6~2F8F",
  ]);
});

Deno.test("oanc.profiles reports warning when required fields are missing", () => {
  const output = interpretOancProfiles([{
    source: oancProfilesSource.id,
    snapshotKey: "profile-0",
    key: "bad-record",
    payload: {
      ancId: "4E",
    },
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.oanc_profile_missing_fields");
  assertEquals(output.findings[0].citation, cite(oancProfilesSource.id, "bad-record"));
});

Deno.test("oanc.profiles reports warning for invalid payload", () => {
  const output = interpretOancProfiles([{
    source: oancProfilesSource.id,
    snapshotKey: "profile-0",
    key: "bad-payload",
    payload: "not-object" as unknown as Record<string, unknown>,
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.findings.map((finding: Finding) => finding.code), [
    "dc.interpreter.invalid_payload",
  ]);
});

Deno.test("oanc.profiles source binding links interpreter", () => {
  assertEquals(oancProfilesBinding.source.id, oancProfilesSource.id);
  assertEquals(oancProfilesBinding.interpret, interpretOancProfiles);
});
