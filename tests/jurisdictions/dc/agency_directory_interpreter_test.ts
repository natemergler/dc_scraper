import { assertEquals } from "@std/assert";

import { cite } from "../../../src/core/types.ts";
import {
  interpretAgencyDirectory,
} from "../../../src/jurisdictions/dc/interpreters/agency_directory.ts";
import {
  agencyDirectoryBinding,
  agencyDirectorySource,
} from "../../../src/jurisdictions/dc/sources/agency_directory.ts";

Deno.test("dc.agency_directory enriches canonical agencies with official URL", () => {
  const output = interpretAgencyDirectory([{
    source: agencyDirectorySource.id,
    snapshotKey: "index",
    key: "office-of-the-secretary-os:os-dc-gov",
    payload: {
      directoryName: "Office of the Secretary - OS",
      officialUrl: "https://os.dc.gov",
      sourcePageUrl: "https://dc.gov/page/agency-list",
      subdomain: "os.dc.gov",
    },
  }], {
    agencyLookup: new Map([
      ["office of the secretary", "dc.agency:office-of-the-secretary"],
    ]),
    agencyNameLookup: new Map([
      ["dc.agency:office-of-the-secretary", "Office of the Secretary"],
    ]),
  });

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings, []);
  assertEquals(output.entryFragments[0].provisionalId, "dc.agency:office-of-the-secretary");
  assertEquals(output.entryFragments[0].name, "Office of the Secretary");
  assertEquals(output.entryFragments[0].attributes.officialUrl, "https://os.dc.gov");
  assertEquals(
    output.entryFragments[0].attributes.sourcePageUrl,
    "https://dc.gov/page/agency-list",
  );
  assertEquals(output.entryFragments[0].citations, [
    cite(agencyDirectorySource.id, "office-of-the-secretary-os:os-dc-gov", {
      url: "https://dc.gov/page/agency-list",
    }),
  ]);
});

Deno.test("dc.agency_directory strips trailing acronym suffixes before lookup", () => {
  const output = interpretAgencyDirectory([{
    source: agencyDirectorySource.id,
    snapshotKey: "index",
    key: "department-of-health-care-finance-dhcf:dhcf-dc-gov",
    payload: {
      directoryName: "Department of Health Care Finance - DHCF",
      officialUrl: "https://dhcf.dc.gov",
      sourcePageUrl: "https://dc.gov/page/agency-list",
      subdomain: "dhcf.dc.gov",
    },
  }], {
    agencyLookup: new Map([
      ["department of health care finance", "dc.agency:department-of-health-care-finance"],
    ]),
    agencyNameLookup: new Map([
      ["dc.agency:department-of-health-care-finance", "Department of Health Care Finance"],
    ]),
  });

  assertEquals(output.entryFragments.length, 1);
  assertEquals(
    output.entryFragments[0].provisionalId,
    "dc.agency:department-of-health-care-finance",
  );
});

Deno.test("dc.agency_directory warns when a directory row does not resolve", () => {
  const output = interpretAgencyDirectory([{
    source: agencyDirectorySource.id,
    snapshotKey: "index",
    key: "district-snow-team:snow-dc-gov",
    payload: {
      directoryName: "District Snow Team",
      officialUrl: "https://snow.dc.gov",
      sourcePageUrl: "https://dc.gov/page/agency-list",
      subdomain: "snow.dc.gov",
    },
  }], {
    agencyLookup: new Map(),
    agencyNameLookup: new Map(),
  });

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].code, "dc.interpreter.agency_directory_unmatched");
});

Deno.test("dc.agency_directory source binding links interpreter", () => {
  assertEquals(agencyDirectoryBinding.source.id, agencyDirectorySource.id);
  assertEquals(agencyDirectoryBinding.interpret, interpretAgencyDirectory);
});
