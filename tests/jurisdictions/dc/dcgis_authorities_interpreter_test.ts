import { assertEquals } from "@std/assert";
import { cite, type Finding } from "../../../src/core/types.ts";
import {
  dcgisAuthoritiesBinding,
  dcgisAuthoritiesSource,
} from "../../../src/jurisdictions/dc/sources/dcgis_authorities.ts";
import { interpretDcgisAuthorities } from "../../../src/jurisdictions/dc/interpreters/dcgis_authorities.ts";

Deno.test("dcgis.authorities records become authority entries and relation", () => {
  const output = interpretDcgisAuthorities([{
    source: dcgisAuthoritiesSource.id,
    snapshotKey: "page-0",
    key: "row-1",
    payload: {
      AUTHORITY_ID: "au-1",
      AUTHORITY_NAME: "City Authority",
      SHORT_NAME: "CA",
      AGENCY_ID: "a-1",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 1);
  assertEquals(output.findings, []);

  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.fragmentType, "entry");
  assertEquals(entryFragment.source, dcgisAuthoritiesSource.id);
  assertEquals(entryFragment.sourceRecordId, "row-1");
  assertEquals(entryFragment.provisionalId, "dc.authority:au-1");
  assertEquals(entryFragment.kind, "dc.authority");
  assertEquals(entryFragment.family, "authority");
  assertEquals(entryFragment.name, "City Authority");
  assertEquals(entryFragment.citations, [cite(dcgisAuthoritiesSource.id, "row-1")]);
  assertEquals(entryFragment.attributes.shortName, "CA");
  assertEquals(entryFragment.attributes.sourceAuthorityId, "au-1");

  const [relationFragment] = output.relationFragments;
  assertEquals(relationFragment.fragmentType, "relation");
  assertEquals(relationFragment.from, "dc.authority:au-1");
  assertEquals(relationFragment.to, "dc.agency:a-1");
  assertEquals(relationFragment.relationKind, "dc.relation:governs");
  assertEquals(relationFragment.citations, [cite(dcgisAuthoritiesSource.id, "row-1")]);
});

Deno.test("dcgis.authorities reports warning when name is missing", () => {
  const output = interpretDcgisAuthorities([{
    source: dcgisAuthoritiesSource.id,
    snapshotKey: "page-0",
    key: "row-2",
    payload: {
      AUTHORITY_ID: "au-2",
    },
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.authority_name_missing");
  assertEquals(output.findings[0].citation, cite(dcgisAuthoritiesSource.id, "row-2"));
});

Deno.test("dcgis.authorities reports warning for invalid record payload", () => {
  const output = interpretDcgisAuthorities([{
    source: dcgisAuthoritiesSource.id,
    snapshotKey: "page-0",
    key: "row-3",
    payload: "not-object" as unknown as Record<string, unknown>,
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.findings.map((finding: Finding) => finding.code), [
    "dc.interpreter.invalid_payload",
  ]);
});

Deno.test("dcgis.authorities resolves governing agency from known agency lookup", () => {
  const context = {
    agencyLookup: new Map([
      ["office of the mayor", "a-1"],
      ["om", "a-99"],
    ]),
  };

  const output = interpretDcgisAuthorities([{
    source: dcgisAuthoritiesSource.id,
    snapshotKey: "page-0",
    key: "row-4",
    payload: {
      ENTITY_ID: "au-1",
      NAME: "Ethics Board",
      GOVERNING_AGENCY: "Office Of The Mayor",
      SHORT_NAME: "EB",
    },
  }], context);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 1);
  const [relationFragment] = output.relationFragments;
  assertEquals(relationFragment.to, "dc.agency:a-1");
});

Deno.test("dcgis.authorities resolves governing agency punctuation variants", () => {
  const context = {
    agencyLookup: new Map([
      ["department of justice", "a-77"],
    ]),
  };

  const output = interpretDcgisAuthorities([{
    source: dcgisAuthoritiesSource.id,
    snapshotKey: "page-0",
    key: "row-5",
    payload: {
      ENTITY_ID: "au-1",
      NAME: "Ethics Authority",
      GOVERNING_AGENCY: "Department-Of-Justice",
      SHORT_NAME: "EJ",
    },
  }], context);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 1);
  const [relationFragment] = output.relationFragments;
  assertEquals(relationFragment.to, "dc.agency:a-77");
});

Deno.test("dcgis.authorities source binding links interpreter", () => {
  assertEquals(dcgisAuthoritiesBinding.source.id, dcgisAuthoritiesSource.id);
  assertEquals(dcgisAuthoritiesBinding.interpret, interpretDcgisAuthorities);
});
