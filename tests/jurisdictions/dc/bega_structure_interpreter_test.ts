import { assertEquals } from "@std/assert";
import { cite, type Finding } from "../../../src/core/types.ts";
import {
  begaStructureBinding,
  begaStructureSource,
} from "../../../src/jurisdictions/dc/sources/bega_structure.ts";
import { interpretBegaStructure } from "../../../src/jurisdictions/dc/interpreters/bega_structure.ts";

Deno.test("bega.structure records become agency, office, and part_of fragments", () => {
  const output = interpretBegaStructure([
    {
      source: begaStructureSource.id,
      snapshotKey: "board-of-ethics-and-government-accountability",
      key: "board-of-ethics-and-government-accountability",
      payload: {
        name: "Board of Ethics and Government Accountability",
        key: "board-of-ethics-and-government-accountability",
        url: "https://bega.dc.gov/node/61616/",
        entryKind: "agency",
        heading: "About BEGA",
        summary:
          "The Board of Ethics and Government Accountability (BEGA) is an independent agency.",
      },
    },
    {
      source: begaStructureSource.id,
      snapshotKey: "office-of-government-ethics",
      key: "office-of-government-ethics",
      payload: {
        name: "Office of Government Ethics",
        key: "office-of-government-ethics",
        url: "https://bega.dc.gov/page/office-government-ethics",
        entryKind: "office",
        parentName: "Board of Ethics and Government Accountability",
      },
    },
    {
      source: begaStructureSource.id,
      snapshotKey: "office-of-open-government",
      key: "office-of-open-government",
      payload: {
        name: "Office of Open Government",
        key: "office-of-open-government",
        url: "https://www.open-dc.gov/office-open-government",
        entryKind: "office",
        parentName: "Board of Ethics and Government Accountability",
      },
    },
  ]);

  assertEquals(output.findings, []);
  assertEquals(output.entryFragments.length, 3);
  assertEquals(output.relationFragments.length, 2);

  const [bega, oge, oog] = output.entryFragments;
  assertEquals(bega.provisionalId, "dc.agency:board-of-ethics-and-government-accountability");
  assertEquals(bega.kind, "dc.agency");
  assertEquals(bega.family, "organization");
  assertEquals(bega.attributes.shortName, "Board of Ethics and Government Accountability");
  assertEquals(
    bega.attributes.sourceBegaStructureKey,
    "board-of-ethics-and-government-accountability",
  );
  assertEquals(
    bega.citations,
    [
      cite(begaStructureSource.id, "board-of-ethics-and-government-accountability", {
        url: "https://bega.dc.gov/node/61616/",
      }),
    ],
  );

  assertEquals(oge.provisionalId, "dc.office:office-of-government-ethics");
  assertEquals(oge.kind, "dc.office");
  assertEquals(oge.attributes.sourceOfficeKey, "office-of-government-ethics");
  assertEquals(oog.provisionalId, "dc.office:office-of-open-government");
  assertEquals(oog.kind, "dc.office");

  assertEquals(output.relationFragments, [
    {
      fragmentType: "relation",
      source: begaStructureSource.id,
      sourceRecordId: "office-of-government-ethics",
      from: "dc.office:office-of-government-ethics",
      relationKind: "dc.relation:part_of",
      to: "dc.agency:board-of-ethics-and-government-accountability",
      citations: [
        cite(begaStructureSource.id, "office-of-government-ethics", {
          url: "https://bega.dc.gov/page/office-government-ethics",
        }),
      ],
    },
    {
      fragmentType: "relation",
      source: begaStructureSource.id,
      sourceRecordId: "office-of-open-government",
      from: "dc.office:office-of-open-government",
      relationKind: "dc.relation:part_of",
      to: "dc.agency:board-of-ethics-and-government-accountability",
      citations: [
        cite(begaStructureSource.id, "office-of-open-government", {
          url: "https://www.open-dc.gov/office-open-government",
        }),
      ],
    },
  ]);
});

Deno.test("bega.structure reports warning when required fields are missing", () => {
  const output = interpretBegaStructure([{
    source: begaStructureSource.id,
    snapshotKey: "page-0",
    key: "bad-record",
    payload: {
      key: "bad-record",
      url: "https://bega.dc.gov/node/61616/",
      entryKind: "agency",
    },
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.bega_missing_fields");
  assertEquals(output.findings[0].citation, cite(begaStructureSource.id, "bad-record"));
});

Deno.test("bega.structure reports warning for invalid record payload", () => {
  const output = interpretBegaStructure([{
    source: begaStructureSource.id,
    snapshotKey: "page-0",
    key: "bad-payload",
    payload: "not-object" as unknown as Record<string, unknown>,
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.findings.map((finding: Finding) => finding.code), [
    "dc.interpreter.invalid_payload",
  ]);
});

Deno.test("bega.structure source binding links interpreter", () => {
  assertEquals(begaStructureBinding.source.id, begaStructureSource.id);
  assertEquals(begaStructureBinding.interpret, interpretBegaStructure);
});
