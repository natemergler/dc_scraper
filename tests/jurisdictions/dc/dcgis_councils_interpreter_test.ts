import { assertEquals } from "@std/assert";
import { cite, type Finding } from "../../../src/core/types.ts";
import {
  dcgisCouncilsBinding,
  dcgisCouncilsSource,
} from "../../../src/jurisdictions/dc/sources/dcgis_councils.ts";
import { interpretDcgisCouncils } from "../../../src/jurisdictions/dc/interpreters/dcgis_councils.ts";

Deno.test("dcgis.councils records become council entries and relation", () => {
  const output = interpretDcgisCouncils([{
    source: dcgisCouncilsSource.id,
    snapshotKey: "page-0",
    key: "row-1",
    payload: {
      ENTITY_ID: "11",
      NAME: "Food Policy Council",
      SHORT_NAME: "FPC",
      AGENCY_ID: "a-1",
      AUTHORIZING_ORDER_LAW: "D.C. Code § 48-312",
    },
  }]);

  assertEquals(output.entryFragments.length, 2);
  assertEquals(output.relationFragments.length, 2);
  assertEquals(output.findings, []);

  const entryFragment = output.entryFragments.find((fragment) => fragment.kind === "dc.council")!;
  const authorityFragment = output.entryFragments.find((fragment) =>
    fragment.kind === "dc.legal_authority"
  );
  assertEquals(entryFragment.fragmentType, "entry");
  assertEquals(entryFragment.source, dcgisCouncilsSource.id);
  assertEquals(entryFragment.sourceRecordId, "row-1");
  assertEquals(entryFragment.provisionalId, "dc.council:11");
  assertEquals(entryFragment.kind, "dc.council");
  assertEquals(entryFragment.family, "organization");
  assertEquals(entryFragment.name, "Food Policy Council");
  assertEquals(entryFragment.citations, [cite(dcgisCouncilsSource.id, "row-1")]);
  assertEquals(entryFragment.attributes.shortName, "FPC");
  assertEquals(entryFragment.attributes.sourceCouncilId, "11");
  assertEquals(authorityFragment?.attributes.locator, "D.C. Code § 48-312");

  const governsRelation = output.relationFragments.find((relation) =>
    relation.relationKind === "dc.relation:governs"
  );
  assertEquals(governsRelation?.fragmentType, "relation");
  assertEquals(governsRelation?.from, "dc.council:11");
  assertEquals(governsRelation?.to, "dc.agency:a-1");
  assertEquals(governsRelation?.citations, [cite(dcgisCouncilsSource.id, "row-1")]);
  const authorityRelation = output.relationFragments.find((relation) =>
    relation.relationKind === "dc.relation:authorized_by"
  );
  assertEquals(authorityRelation?.to, "dc.legal_authority:d-c-code-48-312");
});

Deno.test("dcgis.councils reports warning when name is missing", () => {
  const output = interpretDcgisCouncils([{
    source: dcgisCouncilsSource.id,
    snapshotKey: "page-0",
    key: "row-2",
    payload: {
      ENTITY_ID: "22",
    },
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.council_name_missing");
  assertEquals(output.findings[0].citation, cite(dcgisCouncilsSource.id, "row-2"));
});

Deno.test("dcgis.councils reports warning for invalid record payload", () => {
  const output = interpretDcgisCouncils([{
    source: dcgisCouncilsSource.id,
    snapshotKey: "page-0",
    key: "row-3",
    payload: "not-object" as unknown as Record<string, unknown>,
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.findings.map((finding: Finding) => finding.code), [
    "dc.interpreter.invalid_payload",
  ]);
});

Deno.test("dcgis.councils resolves governing agency from known agency lookup", () => {
  const context = {
    agencyLookup: new Map([
      ["office of planning", "a-1"],
    ]),
  };

  const output = interpretDcgisCouncils([{
    source: dcgisCouncilsSource.id,
    snapshotKey: "page-0",
    key: "row-4",
    payload: {
      ENTITY_ID: "au-1",
      NAME: "Food Policy Council",
      GOVERNING_AGENCY: "Office Of Planning",
      SHORT_NAME: "FPC",
    },
  }], context);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 1);
  const [relationFragment] = output.relationFragments;
  assertEquals(relationFragment.to, "dc.agency:a-1");
});

Deno.test("dcgis.councils source binding links interpreter", () => {
  assertEquals(dcgisCouncilsBinding.source.id, dcgisCouncilsSource.id);
  assertEquals(dcgisCouncilsBinding.interpret, interpretDcgisCouncils);
});
