import { assertEquals } from "@std/assert";
import { cite, type Finding } from "../../../src/core/types.ts";
import {
  dccourtsStructureBinding,
  dccourtsStructureSource,
} from "../../../src/jurisdictions/dc/sources/dccourts_structure.ts";
import { interpretDCCourtsStructure } from "../../../src/jurisdictions/dc/interpreters/dccourts_structure.ts";

Deno.test("dccourts.structure records become court entries and part_of fragments", () => {
  const output = interpretDCCourtsStructure([
    {
      source: dccourtsStructureSource.id,
      snapshotKey: "district-of-columbia-courts",
      key: "district-of-columbia-courts",
      payload: {
        name: "District of Columbia Courts",
        key: "district-of-columbia-courts",
        url: "https://www.dccourts.gov/",
        entryKind: "court_system",
        fromSeed: true,
      },
    },
    {
      source: dccourtsStructureSource.id,
      snapshotKey: "court-of-appeals",
      key: "court-of-appeals",
      payload: {
        name: "Court of Appeals",
        key: "court-of-appeals",
        url: "https://www.dccourts.gov/court-of-appeals",
        entryKind: "court",
        parentName: "District of Columbia Courts",
        summary:
          "The District of Columbia Court of Appeals is the highest court of the District of Columbia.",
        fromSeed: true,
      },
    },
    {
      source: dccourtsStructureSource.id,
      snapshotKey: "superior-court",
      key: "superior-court",
      payload: {
        name: "Superior Court",
        key: "superior-court",
        url: "https://www.dccourts.gov/superior-court",
        entryKind: "court",
        parentName: "District of Columbia Courts",
        summary:
          "The Superior Court is the court of general jurisdiction over nearly all local legal matters.",
      },
    },
    {
      source: dccourtsStructureSource.id,
      snapshotKey: "superior-court",
      key: "civil-division",
      payload: {
        name: "Civil Division",
        key: "civil-division",
        url: "https://www.dccourts.gov/superior-court/superior-court-divisions/civil-division",
        entryKind: "court_division",
        parentName: "Superior Court",
        discoveryPageUrl: "https://www.dccourts.gov/superior-court",
      },
    },
  ]);

  assertEquals(output.findings, []);
  assertEquals(output.entryFragments.length, 4);
  assertEquals(output.relationFragments.length, 3);

  const [root, appeals, superior, civil] = output.entryFragments;
  assertEquals(root.provisionalId, "dc.court_system:district-of-columbia-courts");
  assertEquals(root.kind, "dc.court_system");
  assertEquals(root.attributes.sourceCourtSystemKey, "district-of-columbia-courts");
  assertEquals(root.attributes.officialUrl, "https://www.dccourts.gov/");
  assertEquals(root.attributes.sourceFromSeed, true);

  assertEquals(appeals.provisionalId, "dc.court:court-of-appeals");
  assertEquals(appeals.kind, "dc.court");
  assertEquals(appeals.attributes.sourceCourtKey, "court-of-appeals");
  assertEquals(
    appeals.attributes.description,
    "The District of Columbia Court of Appeals is the highest court of the District of Columbia.",
  );
  assertEquals(appeals.attributes.sourceFromSeed, true);

  assertEquals(superior.provisionalId, "dc.court:superior-court");
  assertEquals(superior.kind, "dc.court");
  assertEquals(
    superior.attributes.description,
    "The Superior Court is the court of general jurisdiction over nearly all local legal matters.",
  );

  assertEquals(civil.provisionalId, "dc.court_division:civil-division");
  assertEquals(civil.kind, "dc.court_division");
  assertEquals(civil.attributes.sourceCourtDivisionKey, "civil-division");
  assertEquals(civil.attributes.sourceDiscoveryPageUrl, "https://www.dccourts.gov/superior-court");
  assertEquals(
    civil.citations,
    [
      cite(dccourtsStructureSource.id, "civil-division", {
        url: "https://www.dccourts.gov/superior-court/superior-court-divisions/civil-division",
      }),
    ],
  );

  assertEquals(output.relationFragments.map((relation) => relation.to), [
    "dc.court_system:district-of-columbia-courts",
    "dc.court_system:district-of-columbia-courts",
    "dc.court:superior-court",
  ]);
  assertEquals(
    output.relationFragments.every((relation) => relation.relationKind === "dc.relation:part_of"),
    true,
  );
});

Deno.test("dccourts.structure reports warning when required fields are missing", () => {
  const output = interpretDCCourtsStructure([{
    source: dccourtsStructureSource.id,
    snapshotKey: "page-0",
    key: "bad-record",
    payload: {
      key: "bad-record",
      url: "https://www.dccourts.gov/",
      entryKind: "court_system",
    },
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.dccourts_missing_fields");
  assertEquals(output.findings[0].citation, cite(dccourtsStructureSource.id, "bad-record"));
});

Deno.test("dccourts.structure reports warning for invalid record payload", () => {
  const output = interpretDCCourtsStructure([{
    source: dccourtsStructureSource.id,
    snapshotKey: "page-0",
    key: "bad-payload",
    payload: "not-object" as unknown as Record<string, unknown>,
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.findings.map((finding: Finding) => finding.code), [
    "dc.interpreter.invalid_payload",
  ]);
});

Deno.test("dccourts.structure source binding links interpreter", () => {
  assertEquals(dccourtsStructureBinding.source.id, dccourtsStructureSource.id);
  assertEquals(dccourtsStructureBinding.interpret, interpretDCCourtsStructure);
});
