import { assertEquals } from "@std/assert";
import { cite } from "../../../src/core/types.ts";
import {
  dcgisSmdsBinding,
  dcgisSmdsSource,
} from "../../../src/jurisdictions/dc/sources/dcgis_smds.ts";
import { interpretDcgisSmds } from "../../../src/jurisdictions/dc/interpreters/dcgis_smds.ts";

Deno.test("dcgis.smds records become SMD entries and contains relations", () => {
  const output = interpretDcgisSmds([
    {
      source: dcgisSmdsSource.id,
      snapshotKey: "page-0",
      key: "row-1",
      payload: {
        SMD_ID: "1A01",
        ANC_ID: "1A",
        NAME: "SMD 1A01",
        REP_NAME: "Jane Doe",
        FIRST_NAME: "Jane",
        LAST_NAME: "Doe",
        WEB_URL: "https://example/smd/1A01",
        EMAIL: "jane@example.com",
        OBJECTID: 21,
      },
    },
    {
      source: dcgisSmdsSource.id,
      snapshotKey: "page-0",
      key: "row-2",
      payload: {
        SMD_ID: "3/4G01",
        ANC_ID: "3/4G",
        NAME: "SMD 3/4G01",
        REP_NAME: "John Smith",
        FIRST_NAME: "John",
        LAST_NAME: "Smith",
        WEB_URL: "https://example/smd/3-4G01",
        EMAIL: "john@example.com",
        OBJECTID: 22,
      },
    },
  ]);

  assertEquals(output.entryFragments.length, 2);
  assertEquals(output.relationFragments.length, 2);
  assertEquals(output.findings, []);

  const [normalEntry, slashEntry] = output.entryFragments;
  const [normalRelation, slashRelation] = output.relationFragments;

  assertEquals(normalEntry.fragmentType, "entry");
  assertEquals(normalEntry.source, dcgisSmdsSource.id);
  assertEquals(normalEntry.sourceRecordId, "row-1");
  assertEquals(normalEntry.provisionalId, "dc.smd:1A01");
  assertEquals(normalEntry.kind, "dc.smd");
  assertEquals(normalEntry.family, "area");
  assertEquals(normalEntry.name, "SMD 1A01");
  assertEquals(normalEntry.attributes.sourceSmdId, "1A01");
  assertEquals(normalEntry.attributes.sourceAncId, "1A");
  assertEquals(normalEntry.attributes.webUrl, "https://example/smd/1A01");
  assertEquals(normalEntry.citations, [cite(dcgisSmdsSource.id, "row-1")]);
  assertEquals(Object.hasOwn(normalEntry.attributes, "repName"), false);
  assertEquals(Object.hasOwn(normalEntry.attributes, "firstName"), false);
  assertEquals(Object.hasOwn(normalEntry.attributes, "lastName"), false);
  assertEquals(Object.hasOwn(normalEntry.attributes, "email"), false);

  assertEquals(slashEntry.fragmentType, "entry");
  assertEquals(slashEntry.source, dcgisSmdsSource.id);
  assertEquals(slashEntry.sourceRecordId, "row-2");
  assertEquals(slashEntry.provisionalId, "dc.smd:3~2F4G01");
  assertEquals(slashEntry.kind, "dc.smd");
  assertEquals(slashEntry.family, "area");
  assertEquals(slashEntry.name, "SMD 3/4G01");
  assertEquals(slashEntry.attributes.sourceSmdId, "3/4G01");
  assertEquals(slashEntry.attributes.sourceAncId, "3/4G");
  assertEquals(slashEntry.attributes.webUrl, "https://example/smd/3-4G01");
  assertEquals(slashEntry.citations, [cite(dcgisSmdsSource.id, "row-2")]);
  assertEquals(Object.hasOwn(slashEntry.attributes, "repName"), false);
  assertEquals(Object.hasOwn(slashEntry.attributes, "firstName"), false);
  assertEquals(Object.hasOwn(slashEntry.attributes, "lastName"), false);
  assertEquals(Object.hasOwn(slashEntry.attributes, "email"), false);

  assertEquals(normalRelation.fragmentType, "relation");
  assertEquals(normalRelation.from, "dc.anc:1A");
  assertEquals(normalRelation.to, "dc.smd:1A01");
  assertEquals(normalRelation.relationKind, "dc.relation:contains");
  assertEquals(normalRelation.citations, [cite(dcgisSmdsSource.id, "row-1")]);

  assertEquals(slashRelation.fragmentType, "relation");
  assertEquals(slashRelation.from, "dc.anc:3~2F4G");
  assertEquals(slashRelation.to, "dc.smd:3~2F4G01");
  assertEquals(slashRelation.relationKind, "dc.relation:contains");
  assertEquals(slashRelation.citations, [cite(dcgisSmdsSource.id, "row-2")]);
});

Deno.test("dcgis.smds emits entry when ANC id is missing", () => {
  const output = interpretDcgisSmds([
    {
      source: dcgisSmdsSource.id,
      snapshotKey: "page-0",
      key: "row-3",
      payload: {
        SMD_ID: "1A99",
        NAME: "SMD 1A99",
      },
    },
  ]);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.smd_anc_id_missing");
  assertEquals(output.entryFragments[0].provisionalId, "dc.smd:1A99");
  assertEquals(output.entryFragments[0].attributes.sourceSmdId, "1A99");
  assertEquals(Object.hasOwn(output.entryFragments[0].attributes, "sourceAncId"), false);
});

Deno.test("dcgis.smds reports warning when SMD id is missing", () => {
  const output = interpretDcgisSmds([
    {
      source: dcgisSmdsSource.id,
      snapshotKey: "page-0",
      key: "row-4",
      payload: {
        ANC_ID: "1A",
        NAME: "SMD Missing",
      },
    },
  ]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.smd_id_missing");
  assertEquals(output.findings[0].citation, cite(dcgisSmdsSource.id, "row-4"));
});

Deno.test("dcgis.smds source binding links interpreter", () => {
  assertEquals(dcgisSmdsBinding.source.id, dcgisSmdsSource.id);
  assertEquals(dcgisSmdsBinding.interpret, interpretDcgisSmds);
});
