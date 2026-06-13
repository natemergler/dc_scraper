import { assertEquals } from "@std/assert";
import { cite, type Finding } from "../../../src/core/types.ts";
import {
  dcgisAgenciesBinding,
  dcgisAgenciesSource,
} from "../../../src/jurisdictions/dc/sources/dcgis_agencies.ts";
import { interpretDcgisAgencies } from "../../../src/jurisdictions/dc/interpreters/dcgis_agencies.ts";

Deno.test("dcgis.agencies records become agency fragments and relation", () => {
  const output = interpretDcgisAgencies([{
    source: dcgisAgenciesSource.id,
    snapshotKey: "page-0",
    key: "row-1",
    payload: {
      AGENCY_ID: "a-1",
      AGENCY_NAME: "Agency One",
      SHORT_NAME: "A1",
      PARENT_AGENCY_ID: "a-root",
    },
  }, {
    source: dcgisAgenciesSource.id,
    snapshotKey: "page-0",
    key: "row-root",
    payload: {
      AGENCY_ID: "a-root",
      AGENCY_NAME: "Agency Root",
      SHORT_NAME: "ROOT",
    },
  }]);

  assertEquals(output.entryFragments.length, 2);
  assertEquals(output.relationFragments.length, 1);
  assertEquals(output.findings, []);

  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.fragmentType, "entry");
  assertEquals(entryFragment.source, dcgisAgenciesSource.id);
  assertEquals(entryFragment.sourceRecordId, "row-1");
  assertEquals(entryFragment.provisionalId, "dc.agency:agency-one");
  assertEquals(entryFragment.kind, "dc.agency");
  assertEquals(entryFragment.name, "Agency One");
  assertEquals(entryFragment.citations, [cite(dcgisAgenciesSource.id, "row-1")]);
  assertEquals(entryFragment.attributes.shortName, "A1");
  assertEquals(entryFragment.attributes.sourceAgencyId, "a-1");

  const [relationFragment] = output.relationFragments;
  assertEquals(relationFragment.fragmentType, "relation");
  assertEquals(relationFragment.from, "dc.agency:agency-one");
  assertEquals(relationFragment.to, "dc.agency:agency-root");
  assertEquals(relationFragment.relationKind, "dc.relation:reports_to");
  assertEquals(relationFragment.citations, [cite(dcgisAgenciesSource.id, "row-1")]);
});

Deno.test("dcgis.agencies records include parsed legal citation locators", () => {
  const output = interpretDcgisAgencies([{
    source: dcgisAgenciesSource.id,
    snapshotKey: "page-0",
    key: "row-3",
    payload: {
      AGENCY_ID: "a-3",
      AGENCY_NAME: "Agency Three",
      SHORT_NAME: "A3",
      LEGAL_BASIS: "Authority established under D.C. Code § 1-102.5.",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.citations, [
    cite(dcgisAgenciesSource.id, "row-3"),
    cite(dcgisAgenciesSource.id, "row-3", {
      locator: "D.C. Code § 1-102.5",
    }),
  ]);
});

Deno.test("dcgis.agencies reports canonical ID collisions", () => {
  const output = interpretDcgisAgencies([{
    source: dcgisAgenciesSource.id,
    snapshotKey: "page-0",
    key: "row-1",
    payload: {
      AGENCY_ID: "a-1",
      AGENCY_NAME: "Agency One",
    },
  }, {
    source: dcgisAgenciesSource.id,
    snapshotKey: "page-0",
    key: "row-2",
    payload: {
      AGENCY_ID: "a-2",
      AGENCY_NAME: "Agency-One",
    },
  }]);

  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "conflict");
  assertEquals(output.findings[0].code, "dc.identity.canonical_id_collision");
});

Deno.test("dcgis.agencies reports warning when name is missing", () => {
  const output = interpretDcgisAgencies([{
    source: dcgisAgenciesSource.id,
    snapshotKey: "page-0",
    key: "row-2",
    payload: {
      AGENCY_ID: "a-2",
    },
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.agency_name_missing");
  assertEquals(output.findings[0].citation, cite(dcgisAgenciesSource.id, "row-2"));
});

Deno.test("dcgis.agencies reports warning for invalid record payload", () => {
  const output = interpretDcgisAgencies([{
    source: dcgisAgenciesSource.id,
    snapshotKey: "page-0",
    key: "row-3",
    payload: "not-object" as unknown as Record<string, unknown>,
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.findings.map((finding: Finding) => finding.code), [
    "dc.interpreter.invalid_payload",
  ]);
});

Deno.test("dcgis.agencies source binding links interpreter", () => {
  assertEquals(dcgisAgenciesBinding.source.id, dcgisAgenciesSource.id);
  assertEquals(dcgisAgenciesBinding.interpret, interpretDcgisAgencies);
});
