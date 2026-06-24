import { assertEquals } from "@std/assert";
import { cite, type Finding } from "../../../src/core/types.ts";
import {
  mayorExecutiveStructureBinding,
  mayorExecutiveStructureSource,
} from "../../../src/jurisdictions/dc/sources/mayor_executive_structure.ts";
import { interpretMayorExecutiveStructure } from "../../../src/jurisdictions/dc/interpreters/mayor_executive_structure.ts";
import { normalizeAgencyLookupKey } from "../../../src/jurisdictions/dc/interpreters/context.ts";

const sourceUrl = mayorExecutiveStructureSource.pages[0].url;
const executiveBranchUrl = mayorExecutiveStructureSource.pages[1].url;

Deno.test("mayor.executive_structure records become offices and source-backed hierarchy relations", () => {
  const agencyLookup = new Map<string, string>([
    [normalizeAgencyLookupKey("District Department of Transportation"), "1048"],
  ]);
  const output = interpretMayorExecutiveStructure(
    [
      record("executive-office-of-the-mayor", "Executive Office of the Mayor", "office", {
        officialUrl: "https://mayor.dc.gov/",
        sourcePageUrls: [sourceUrl, executiveBranchUrl],
      }),
      record(
        "office-of-the-city-administrator",
        "Office of the City Administrator",
        "office",
        {
          parentKey: "executive-office-of-the-mayor",
          relationKind: "part_of",
          description:
            "Responsible for the day-to-day management of the District government, setting operational goals, and implementing the legislative actions and policy decisions of the Mayor and DC Council.",
          officialUrl: "https://oca.dc.gov/",
          sourcePageUrls: [sourceUrl, executiveBranchUrl],
        },
      ),
      record(
        "office-of-the-deputy-mayor-for-operations-and-infrastructure",
        "Office of the Deputy Mayor for Operations and Infrastructure",
        "office",
        {
          parentKey: "executive-office-of-the-mayor",
          relationKind: "part_of",
        },
      ),
      record(
        "district-department-of-transportation",
        "District Department of Transportation",
        "agency_ref",
        {
          parentKey: "office-of-the-deputy-mayor-for-operations-and-infrastructure",
          relationKind: "reports_to",
        },
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
  assertEquals(eom.attributes.officialUrl, "https://mayor.dc.gov/");
  assertEquals(eom.attributes.sourcePageUrls, [sourceUrl, executiveBranchUrl]);
  assertEquals(eom.citations, [
    cite(mayorExecutiveStructureSource.id, "executive-office-of-the-mayor", {
      url: sourceUrl,
    }),
    cite(mayorExecutiveStructureSource.id, "executive-office-of-the-mayor", {
      url: executiveBranchUrl,
    }),
  ]);

  assertEquals(oca.provisionalId, "dc.office:office-of-the-city-administrator");
  assertEquals(
    oca.attributes.description,
    "Responsible for the day-to-day management of the District government, setting operational goals, and implementing the legislative actions and policy decisions of the Mayor and DC Council.",
  );
  assertEquals(oca.attributes.officialUrl, "https://oca.dc.gov/");
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
      {
        parentKey: "executive-office-of-the-mayor",
        relationKind: "reports_to",
      },
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
  options?: {
    parentKey?: string;
    relationKind?: "part_of" | "reports_to";
    sourcePageUrls?: string[];
    description?: string;
    officialUrl?: string;
  },
) {
  return {
    source: mayorExecutiveStructureSource.id,
    snapshotKey: "organizational-charts",
    key,
    payload: {
      key,
      name,
      sourceUrl,
      sourcePageUrls: options?.sourcePageUrls,
      entryKind,
      parentKey: options?.parentKey,
      relationKind: options?.relationKind,
      pageTitle: "Organizational Charts | mayor",
      heading: "Organizational Charts for Agencies and Offices Under the Mayor's Authority",
      description: options?.description,
      officialUrl: options?.officialUrl,
    },
  };
}
