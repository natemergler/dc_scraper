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
        representedNeighborhoods: "the Crestwood and 16th Street Heights neighborhoods",
      },
    },
  ]);

  assertEquals(output.findings, []);
  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 0);
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
  assertEquals(output.entryFragments[0].citations, [
    cite(oancProfilesSource.id, "4E", { url: "https://oanc.dc.gov/anc-profile/anc-4e" }),
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
