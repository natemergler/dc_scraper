import { assertEquals } from "@std/assert";
import { cite, type Finding } from "../../../src/core/types.ts";
import {
  mayorExecutiveStructureBinding,
  mayorExecutiveStructureSource,
} from "../../../src/jurisdictions/dc/sources/mayor_executive_structure.ts";
import { interpretMayorExecutiveStructure } from "../../../src/jurisdictions/dc/interpreters/mayor_executive_structure.ts";
import { normalizeAgencyLookupKey } from "../../../src/jurisdictions/dc/interpreters/context.ts";

const sourceUrl = mayorExecutiveStructureSource.pages[0].url;

Deno.test("mayor.executive_structure records become offices and source-backed hierarchy relations", () => {
  const agencyLookup = new Map<string, string>([
    [normalizeAgencyLookupKey("District Department of Transportation"), "1048"],
  ]);
  const output = interpretMayorExecutiveStructure(
    [
      record("executive-office-of-the-mayor", "Executive Office of the Mayor", "office"),
      record(
        "office-of-the-city-administrator",
        "Office of the City Administrator",
        "office",
        "executive-office-of-the-mayor",
        "part_of",
      ),
      record(
        "office-of-the-deputy-mayor-for-operations-and-infrastructure",
        "Office of the Deputy Mayor for Operations and Infrastructure",
        "office",
        "executive-office-of-the-mayor",
        "part_of",
      ),
      record(
        "district-department-of-transportation",
        "District Department of Transportation",
        "agency_ref",
        "office-of-the-deputy-mayor-for-operations-and-infrastructure",
        "reports_to",
      ),
    ],
    { agencyLookup },
  );

  assertEquals(output.findings, []);
  assertEquals(output.entryFragments.length, 3);
  assertEquals(output.relationFragments.length, 3);

  const [eom, oca, dmoi] = output.entryFragments;
  assertEquals(eom.provisionalId, "dc.office:executive-office-of-the-mayor");
  assertEquals(eom.kind, "dc.office");
  assertEquals(eom.attributes.shortName, "Executive Office of the Mayor");
  assertEquals(eom.attributes.sourceOfficeKey, "executive-office-of-the-mayor");
  assertEquals(eom.attributes.sourcePageUrl, sourceUrl);

  assertEquals(oca.provisionalId, "dc.office:office-of-the-city-administrator");
  assertEquals(
    dmoi.provisionalId,
    "dc.office:office-of-the-deputy-mayor-for-operations-and-infrastructure",
  );

  assertEquals(output.relationFragments, [
    {
      fragmentType: "relation",
      source: mayorExecutiveStructureSource.id,
      sourceRecordId: "office-of-the-city-administrator",
      from: "dc.office:office-of-the-city-administrator",
      relationKind: "dc.relation:part_of",
      to: "dc.office:executive-office-of-the-mayor",
      citations: [
        cite(mayorExecutiveStructureSource.id, "office-of-the-city-administrator", {
          url: sourceUrl,
        }),
      ],
    },
    {
      fragmentType: "relation",
      source: mayorExecutiveStructureSource.id,
      sourceRecordId: "office-of-the-deputy-mayor-for-operations-and-infrastructure",
      from: "dc.office:office-of-the-deputy-mayor-for-operations-and-infrastructure",
      relationKind: "dc.relation:part_of",
      to: "dc.office:executive-office-of-the-mayor",
      citations: [
        cite(
          mayorExecutiveStructureSource.id,
          "office-of-the-deputy-mayor-for-operations-and-infrastructure",
          { url: sourceUrl },
        ),
      ],
    },
    {
      fragmentType: "relation",
      source: mayorExecutiveStructureSource.id,
      sourceRecordId: "district-department-of-transportation",
      from: "dc.agency:1048",
      relationKind: "dc.relation:reports_to",
      to: "dc.office:office-of-the-deputy-mayor-for-operations-and-infrastructure",
      citations: [
        cite(mayorExecutiveStructureSource.id, "district-department-of-transportation", {
          url: sourceUrl,
        }),
      ],
    },
  ]);
});

Deno.test("mayor.executive_structure reports unresolved agency refs without creating duplicate agencies", () => {
  const output = interpretMayorExecutiveStructure([
    record("executive-office-of-the-mayor", "Executive Office of the Mayor", "office"),
    record(
      "department-of-example",
      "Department of Example",
      "agency_ref",
      "executive-office-of-the-mayor",
      "reports_to",
    ),
  ]);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.entryFragments.some((fragment) => fragment.kind === "dc.agency"), false);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].code, "dc.interpreter.mayor_executive_agency_unresolved");
});

Deno.test("mayor.executive_structure reports warning when required fields are missing", () => {
  const output = interpretMayorExecutiveStructure([{
    source: mayorExecutiveStructureSource.id,
    snapshotKey: "organizational-charts",
    key: "bad-record",
    payload: {
      key: "bad-record",
      entryKind: "office",
    },
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.mayor_executive_structure_missing_fields");
  assertEquals(output.findings[0].citation, cite(mayorExecutiveStructureSource.id, "bad-record"));
});

Deno.test("mayor.executive_structure reports warning for invalid payload", () => {
  const output = interpretMayorExecutiveStructure([{
    source: mayorExecutiveStructureSource.id,
    snapshotKey: "organizational-charts",
    key: "bad-payload",
    payload: "not-object" as unknown as Record<string, unknown>,
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.findings.map((finding: Finding) => finding.code), [
    "dc.interpreter.invalid_payload",
  ]);
});

Deno.test("mayor.executive_structure source binding links interpreter", () => {
  assertEquals(mayorExecutiveStructureBinding.source.id, mayorExecutiveStructureSource.id);
  assertEquals(mayorExecutiveStructureBinding.interpret, interpretMayorExecutiveStructure);
});

function record(
  key: string,
  name: string,
  entryKind: "office" | "agency_ref",
  parentKey?: string,
  relationKind?: "part_of" | "reports_to",
) {
  return {
    source: mayorExecutiveStructureSource.id,
    snapshotKey: "organizational-charts",
    key,
    payload: {
      key,
      name,
      sourceUrl,
      entryKind,
      parentKey,
      relationKind,
      pageTitle: "Organizational Charts | mayor",
      heading: "Organizational Charts for Agencies and Offices Under the Mayor's Authority",
    },
  };
}
