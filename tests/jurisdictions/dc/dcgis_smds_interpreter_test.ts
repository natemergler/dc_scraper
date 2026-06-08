import { assertEquals } from "@std/assert";
import { cite } from "../../../src/core/types.ts";
import {
  dcgisSmdsBinding,
  dcgisSmdsSource,
} from "../../../src/jurisdictions/dc/sources/dcgis_smds.ts";
import { interpretDcgisSmds } from "../../../src/jurisdictions/dc/interpreters/dcgis_smds.ts";

Deno.test("dcgis.smds records become SMD and commissioner seat entries", () => {
  const output = interpretDcgisSmds([
    {
      source: dcgisSmdsSource.id,
      snapshotKey: "page-0",
      key: "1A01",
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
      key: "3/4G01",
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

  assertEquals(output.entryFragments.length, 4);
  assertEquals(output.relationFragments.length, 4);
  assertEquals(output.findings, []);
  assertEquals(output.entryFragments.some((fragment) => fragment.kind === "dc.person"), false);

  const [normalSmdEntry, normalSeatEntry, slashSmdEntry, slashSeatEntry] = output.entryFragments;
  const [
    normalContainsRelation,
    normalRepresentsRelation,
    slashContainsRelation,
    slashRepresentsRelation,
  ] = output.relationFragments;

  assertEquals(normalSmdEntry.fragmentType, "entry");
  assertEquals(normalSmdEntry.source, dcgisSmdsSource.id);
  assertEquals(normalSmdEntry.sourceRecordId, "1A01");
  assertEquals(normalSmdEntry.provisionalId, "dc.smd:1A01");
  assertEquals(normalSmdEntry.kind, "dc.smd");
  assertEquals(normalSmdEntry.family, "area");
  assertEquals(normalSmdEntry.name, "SMD 1A01");
  assertEquals(normalSmdEntry.attributes.sourceSmdId, "1A01");
  assertEquals(normalSmdEntry.attributes.sourceAncId, "1A");
  assertEquals(normalSmdEntry.attributes.webUrl, "https://example/smd/1A01");
  assertEquals(normalSmdEntry.citations, [cite(dcgisSmdsSource.id, "1A01")]);
  assertEquals(Object.hasOwn(normalSmdEntry.attributes, "repName"), false);
  assertEquals(Object.hasOwn(normalSmdEntry.attributes, "firstName"), false);
  assertEquals(Object.hasOwn(normalSmdEntry.attributes, "lastName"), false);
  assertEquals(Object.hasOwn(normalSmdEntry.attributes, "email"), false);
  assertEquals(Object.hasOwn(normalSmdEntry.attributes, "officeEmail"), false);

  assertEquals(normalSeatEntry.fragmentType, "entry");
  assertEquals(normalSeatEntry.source, dcgisSmdsSource.id);
  assertEquals(normalSeatEntry.sourceRecordId, "1A01");
  assertEquals(normalSeatEntry.provisionalId, "dc.anc_commissioner_seat:1A01");
  assertEquals(normalSeatEntry.kind, "dc.anc_commissioner_seat");
  assertEquals(normalSeatEntry.family, "position");
  assertEquals(normalSeatEntry.name, "Commissioner Seat for SMD 1A01");
  assertEquals(normalSeatEntry.attributes.sourceSmdId, "1A01");
  assertEquals(normalSeatEntry.attributes.sourceAncId, "1A");
  assertEquals(normalSeatEntry.attributes.officeEmail, "jane@example.com");
  assertEquals(normalSeatEntry.citations, [cite(dcgisSmdsSource.id, "1A01")]);
  assertEquals(Object.hasOwn(normalSeatEntry.attributes, "email"), false);
  assertEquals(Object.hasOwn(normalSeatEntry.attributes, "repName"), false);

  assertEquals(slashSmdEntry.fragmentType, "entry");
  assertEquals(slashSmdEntry.source, dcgisSmdsSource.id);
  assertEquals(slashSmdEntry.sourceRecordId, "3/4G01");
  assertEquals(slashSmdEntry.provisionalId, "dc.smd:3~2F4G01");
  assertEquals(slashSmdEntry.kind, "dc.smd");
  assertEquals(slashSmdEntry.family, "area");
  assertEquals(slashSmdEntry.name, "SMD 3/4G01");
  assertEquals(slashSmdEntry.attributes.sourceSmdId, "3/4G01");
  assertEquals(slashSmdEntry.attributes.sourceAncId, "3/4G");
  assertEquals(slashSmdEntry.attributes.webUrl, "https://example/smd/3-4G01");
  assertEquals(slashSmdEntry.citations, [cite(dcgisSmdsSource.id, "3/4G01")]);
  assertEquals(Object.hasOwn(slashSmdEntry.attributes, "repName"), false);
  assertEquals(Object.hasOwn(slashSmdEntry.attributes, "firstName"), false);
  assertEquals(Object.hasOwn(slashSmdEntry.attributes, "lastName"), false);
  assertEquals(Object.hasOwn(slashSmdEntry.attributes, "email"), false);
  assertEquals(Object.hasOwn(slashSmdEntry.attributes, "officeEmail"), false);

  assertEquals(slashSeatEntry.fragmentType, "entry");
  assertEquals(slashSeatEntry.source, dcgisSmdsSource.id);
  assertEquals(slashSeatEntry.sourceRecordId, "3/4G01");
  assertEquals(slashSeatEntry.provisionalId, "dc.anc_commissioner_seat:3~2F4G01");
  assertEquals(slashSeatEntry.kind, "dc.anc_commissioner_seat");
  assertEquals(slashSeatEntry.family, "position");
  assertEquals(slashSeatEntry.name, "Commissioner Seat for SMD 3/4G01");
  assertEquals(slashSeatEntry.attributes.sourceSmdId, "3/4G01");
  assertEquals(slashSeatEntry.attributes.sourceAncId, "3/4G");
  assertEquals(slashSeatEntry.attributes.officeEmail, "john@example.com");
  assertEquals(slashSeatEntry.citations, [cite(dcgisSmdsSource.id, "3/4G01")]);
  assertEquals(Object.hasOwn(slashSeatEntry.attributes, "email"), false);
  assertEquals(Object.hasOwn(slashSeatEntry.attributes, "repName"), false);

  assertEquals(normalContainsRelation.fragmentType, "relation");
  assertEquals(normalContainsRelation.source, dcgisSmdsSource.id);
  assertEquals(normalContainsRelation.sourceRecordId, "1A01");
  assertEquals(normalContainsRelation.from, "dc.anc:1A");
  assertEquals(normalContainsRelation.to, "dc.smd:1A01");
  assertEquals(normalContainsRelation.relationKind, "dc.relation:contains");
  assertEquals(normalContainsRelation.citations, [cite(dcgisSmdsSource.id, "1A01")]);

  assertEquals(normalRepresentsRelation.fragmentType, "relation");
  assertEquals(normalRepresentsRelation.source, dcgisSmdsSource.id);
  assertEquals(normalRepresentsRelation.sourceRecordId, "1A01");
  assertEquals(normalRepresentsRelation.from, "dc.anc_commissioner_seat:1A01");
  assertEquals(normalRepresentsRelation.to, "dc.smd:1A01");
  assertEquals(normalRepresentsRelation.relationKind, "dc.relation:represents");
  assertEquals(normalRepresentsRelation.citations, [cite(dcgisSmdsSource.id, "1A01")]);

  assertEquals(slashContainsRelation.fragmentType, "relation");
  assertEquals(slashContainsRelation.source, dcgisSmdsSource.id);
  assertEquals(slashContainsRelation.sourceRecordId, "3/4G01");
  assertEquals(slashContainsRelation.from, "dc.anc:3~2F4G");
  assertEquals(slashContainsRelation.to, "dc.smd:3~2F4G01");
  assertEquals(slashContainsRelation.relationKind, "dc.relation:contains");
  assertEquals(slashContainsRelation.citations, [cite(dcgisSmdsSource.id, "3/4G01")]);

  assertEquals(slashRepresentsRelation.fragmentType, "relation");
  assertEquals(slashRepresentsRelation.source, dcgisSmdsSource.id);
  assertEquals(slashRepresentsRelation.sourceRecordId, "3/4G01");
  assertEquals(slashRepresentsRelation.from, "dc.anc_commissioner_seat:3~2F4G01");
  assertEquals(slashRepresentsRelation.to, "dc.smd:3~2F4G01");
  assertEquals(slashRepresentsRelation.relationKind, "dc.relation:represents");
  assertEquals(slashRepresentsRelation.citations, [cite(dcgisSmdsSource.id, "3/4G01")]);
});

Deno.test("dcgis.smds emits SMD and seat entries when ANC id is missing", () => {
  const output = interpretDcgisSmds([
    {
      source: dcgisSmdsSource.id,
      snapshotKey: "page-0",
      key: "1A99",
      payload: {
        SMD_ID: "1A99",
        NAME: "SMD 1A99",
      },
    },
  ]);

  assertEquals(output.entryFragments.length, 2);
  assertEquals(output.relationFragments.length, 1);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.smd_anc_id_missing");
  assertEquals(output.entryFragments[0].provisionalId, "dc.smd:1A99");
  assertEquals(output.entryFragments[0].kind, "dc.smd");
  assertEquals(output.entryFragments[0].attributes.sourceSmdId, "1A99");
  assertEquals(Object.hasOwn(output.entryFragments[0].attributes, "sourceAncId"), false);
  assertEquals(output.entryFragments[1].provisionalId, "dc.anc_commissioner_seat:1A99");
  assertEquals(output.entryFragments[1].kind, "dc.anc_commissioner_seat");
  assertEquals(output.entryFragments[1].attributes.sourceSmdId, "1A99");
  assertEquals(Object.hasOwn(output.entryFragments[1].attributes, "sourceAncId"), false);
  assertEquals(Object.hasOwn(output.entryFragments[1].attributes, "officeEmail"), false);
  assertEquals(output.relationFragments[0].from, "dc.anc_commissioner_seat:1A99");
  assertEquals(output.relationFragments[0].to, "dc.smd:1A99");
  assertEquals(output.relationFragments[0].relationKind, "dc.relation:represents");
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
  assertEquals(output.entryFragments.some((fragment) => fragment.kind === "dc.smd"), false);
  assertEquals(
    output.entryFragments.some((fragment) => fragment.kind === "dc.anc_commissioner_seat"),
    false,
  );
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
