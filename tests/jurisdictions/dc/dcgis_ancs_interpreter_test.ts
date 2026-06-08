import { assertEquals } from "@std/assert";
import { cite } from "../../../src/core/types.ts";
import {
  dcgisAncsBinding,
  dcgisAncsSource,
} from "../../../src/jurisdictions/dc/sources/dcgis_ancs.ts";
import { interpretDcgisAncs } from "../../../src/jurisdictions/dc/interpreters/dcgis_ancs.ts";

Deno.test("dcgis.ancs records become ANC entries", () => {
  const output = interpretDcgisAncs([
    {
      source: dcgisAncsSource.id,
      snapshotKey: "page-0",
      key: "row-1",
      payload: {
        ANC_ID: "1A",
        NAME: "ANC 1A",
        WEB_URL: "https://example/anc/1A",
        GIS_ID: "gis-1A",
        OBJECTID: 11,
      },
    },
    {
      source: dcgisAncsSource.id,
      snapshotKey: "page-0",
      key: "row-2",
      payload: {
        ANC_ID: "3/4G",
        NAME: "ANC 3/4G",
        WEB_URL: "https://example/anc/3-4G",
        GIS_ID: "gis-3-4G",
        OBJECTID: 12,
      },
    },
  ]);

  assertEquals(output.entryFragments.length, 2);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings, []);

  const [normalEntry, slashEntry] = output.entryFragments;

  assertEquals(normalEntry.fragmentType, "entry");
  assertEquals(normalEntry.source, dcgisAncsSource.id);
  assertEquals(normalEntry.sourceRecordId, "row-1");
  assertEquals(normalEntry.provisionalId, "dc.anc:1A");
  assertEquals(normalEntry.kind, "dc.anc");
  assertEquals(normalEntry.family, "organization");
  assertEquals(normalEntry.name, "ANC 1A");
  assertEquals(normalEntry.attributes.sourceAncId, "1A");
  assertEquals(normalEntry.attributes.webUrl, "https://example/anc/1A");
  assertEquals(normalEntry.attributes.gisId, "gis-1A");
  assertEquals(normalEntry.citations, [cite(dcgisAncsSource.id, "row-1")]);

  assertEquals(slashEntry.fragmentType, "entry");
  assertEquals(slashEntry.source, dcgisAncsSource.id);
  assertEquals(slashEntry.sourceRecordId, "row-2");
  assertEquals(slashEntry.provisionalId, "dc.anc:3~2F4G");
  assertEquals(slashEntry.kind, "dc.anc");
  assertEquals(slashEntry.family, "organization");
  assertEquals(slashEntry.name, "ANC 3/4G");
  assertEquals(slashEntry.attributes.sourceAncId, "3/4G");
  assertEquals(slashEntry.attributes.webUrl, "https://example/anc/3-4G");
  assertEquals(slashEntry.attributes.gisId, "gis-3-4G");
  assertEquals(slashEntry.citations, [cite(dcgisAncsSource.id, "row-2")]);
});

Deno.test("dcgis.ancs reports warning when ANC id is missing", () => {
  const output = interpretDcgisAncs([
    {
      source: dcgisAncsSource.id,
      snapshotKey: "page-0",
      key: "row-3",
      payload: {
        NAME: "ANC Missing",
      },
    },
  ]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.anc_id_missing");
  assertEquals(output.findings[0].citation, cite(dcgisAncsSource.id, "row-3"));
});

Deno.test("dcgis.ancs source binding links interpreter", () => {
  assertEquals(dcgisAncsBinding.source.id, dcgisAncsSource.id);
  assertEquals(dcgisAncsBinding.interpret, interpretDcgisAncs);
});
