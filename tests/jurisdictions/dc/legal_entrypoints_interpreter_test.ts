import { assertEquals } from "@std/assert";
import { cite, type Finding } from "../../../src/core/types.ts";
import {
  legalEntrypointsBinding,
  legalEntrypointsSource,
} from "../../../src/jurisdictions/dc/sources/legal_entrypoints.ts";
import { interpretLegalEntrypoints } from "../../../src/jurisdictions/dc/interpreters/legal_entrypoints.ts";

Deno.test("legal.entrypoints records become legal source entries only", () => {
  const output = interpretLegalEntrypoints([
    {
      source: legalEntrypointsSource.id,
      snapshotKey: "index",
      key: "district-of-columbia-official-code",
      payload: {
        name: "District of Columbia Official Code",
        key: "district-of-columbia-official-code",
        url: "https://code.dccouncil.gov/",
        fromSeed: true,
        indexUrl: "https://dc.gov/page/laws-regulations-and-courts",
      },
    },
    {
      source: legalEntrypointsSource.id,
      snapshotKey: "index",
      key: "dcmr-title-list",
      payload: {
        name: "DCMR Title List",
        key: "dcmr-title-list",
        url: "https://dcregs.dc.gov/Common/DCMR/ChapterList.aspx?subtitleId=1",
        fromSeed: false,
        indexUrl: "https://dc.gov/page/laws-regulations-and-courts",
      },
    },
  ]);

  assertEquals(output.findings, []);
  assertEquals(output.relationFragments, []);
  assertEquals(output.entryFragments.length, 2);

  const [code, dcmr] = output.entryFragments;
  assertEquals(code.provisionalId, "dc.legal_source:district-of-columbia-official-code");
  assertEquals(code.kind, "dc.legal_source");
  assertEquals(code.family, "authority");
  assertEquals(code.attributes.shortName, "District of Columbia Official Code");
  assertEquals(code.attributes.sourceLegalEntrypointKey, "district-of-columbia-official-code");
  assertEquals(code.attributes.sourceSeeded, true);
  assertEquals(code.citations, [
    cite(legalEntrypointsSource.id, "district-of-columbia-official-code", {
      url: "https://code.dccouncil.gov/",
    }),
  ]);

  assertEquals(dcmr.provisionalId, "dc.legal_source:dcmr-title-list");
  assertEquals(dcmr.attributes.sourceSeeded, false);
});

Deno.test("legal.entrypoints reports warning when required fields are missing", () => {
  const output = interpretLegalEntrypoints([{
    source: legalEntrypointsSource.id,
    snapshotKey: "index",
    key: "bad-record",
    payload: {
      key: "bad-record",
      url: "https://code.dccouncil.gov/",
    },
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.relationFragments, []);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.legal_entrypoint_missing_fields");
  assertEquals(output.findings[0].citation, cite(legalEntrypointsSource.id, "bad-record"));
});

Deno.test("legal.entrypoints reports warning for invalid record payload", () => {
  const output = interpretLegalEntrypoints([{
    source: legalEntrypointsSource.id,
    snapshotKey: "index",
    key: "bad-payload",
    payload: "not-object" as unknown as Record<string, unknown>,
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.findings.map((finding: Finding) => finding.code), [
    "dc.interpreter.invalid_payload",
  ]);
});

Deno.test("legal.entrypoints source binding links interpreter", () => {
  assertEquals(legalEntrypointsBinding.source.id, legalEntrypointsSource.id);
  assertEquals(legalEntrypointsBinding.interpret, interpretLegalEntrypoints);
});
