import { assertEquals } from "@std/assert";
import { cite, type Finding } from "../../../src/core/types.ts";
import {
  dcgisCommissionsBinding,
  dcgisCommissionsSource,
} from "../../../src/jurisdictions/dc/sources/dcgis_commissions.ts";
import { interpretDcgisCommissions } from "../../../src/jurisdictions/dc/interpreters/dcgis_commissions.ts";

Deno.test("dcgis.commissions records become commission entries and relation", () => {
  const output = interpretDcgisCommissions([{
    source: dcgisCommissionsSource.id,
    snapshotKey: "page-0",
    key: "row-1",
    payload: {
      COMMISSION_ID: "c-1",
      COMMISSION_NAME: "Advisory Commission",
      SHORT_NAME: "AC",
      AGENCY_ID: "a-1",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 1);
  assertEquals(output.findings, []);

  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.fragmentType, "entry");
  assertEquals(entryFragment.source, dcgisCommissionsSource.id);
  assertEquals(entryFragment.sourceRecordId, "row-1");
  assertEquals(entryFragment.provisionalId, "dc.commission:c-1");
  assertEquals(entryFragment.kind, "dc.commission");
  assertEquals(entryFragment.name, "Advisory Commission");
  assertEquals(entryFragment.citations, [cite(dcgisCommissionsSource.id, "row-1")]);
  assertEquals(entryFragment.attributes.shortName, "AC");
  assertEquals(entryFragment.attributes.sourceCommissionId, "c-1");

  const [relationFragment] = output.relationFragments;
  assertEquals(relationFragment.fragmentType, "relation");
  assertEquals(relationFragment.from, "dc.commission:c-1");
  assertEquals(relationFragment.to, "dc.agency:a-1");
  assertEquals(relationFragment.relationKind, "dc.relation:governs");
  assertEquals(relationFragment.citations, [cite(dcgisCommissionsSource.id, "row-1")]);
});

Deno.test("dcgis.commissions reports warning when name is missing", () => {
  const output = interpretDcgisCommissions([{
    source: dcgisCommissionsSource.id,
    snapshotKey: "page-0",
    key: "row-2",
    payload: {
      COMMISSION_ID: "c-2",
    },
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.commission_name_missing");
  assertEquals(output.findings[0].citation, cite(dcgisCommissionsSource.id, "row-2"));
});

Deno.test("dcgis.commissions reports warning for invalid record payload", () => {
  const output = interpretDcgisCommissions([{
    source: dcgisCommissionsSource.id,
    snapshotKey: "page-0",
    key: "row-3",
    payload: "not-object" as unknown as Record<string, unknown>,
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.findings.map((finding: Finding) => finding.code), [
    "dc.interpreter.invalid_payload",
  ]);
});

Deno.test("dcgis.commissions resolves governing agency from known agency lookup", () => {
  const context = {
    agencyLookup: new Map([
      ["office of the mayor", "a-1"],
      ["om", "a-99"],
    ]),
  };

  const output = interpretDcgisCommissions([{
    source: dcgisCommissionsSource.id,
    snapshotKey: "page-0",
    key: "row-4",
    payload: {
      ENTITY_ID: "c-1",
      NAME: "Housing Commission",
      GOVERNING_AGENCY: "Office Of The Mayor",
      SHORT_NAME: "HC",
    },
  }], context);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 1);
  const [relationFragment] = output.relationFragments;
  assertEquals(relationFragment.to, "dc.agency:a-1");
});

Deno.test("dcgis.commissions resolves governing agency label with punctuation variants", () => {
  const context = {
    agencyLookup: new Map([
      ["department of health", "a-55"],
    ]),
  };

  const output = interpretDcgisCommissions([{
    source: dcgisCommissionsSource.id,
    snapshotKey: "page-0",
    key: "row-5",
    payload: {
      ENTITY_ID: "c-2",
      NAME: "Housing Commission",
      GOVERNING_AGENCY: "Dept of Health",
      SHORT_NAME: "HC",
    },
  }], context);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 1);
  const [relationFragment] = output.relationFragments;
  assertEquals(relationFragment.to, "dc.agency:a-55");
});

Deno.test("dcgis.commissions source binding links interpreter", () => {
  assertEquals(dcgisCommissionsBinding.source.id, dcgisCommissionsSource.id);
  assertEquals(dcgisCommissionsBinding.interpret, interpretDcgisCommissions);
});
