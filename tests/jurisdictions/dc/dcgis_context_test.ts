import { assertEquals } from "@std/assert";
import { normalizeAgencyLookupKey } from "../../../src/jurisdictions/dc/interpreters/context.ts";

Deno.test("normalizeAgencyLookupKey normalizes punctuation and common abbreviations", () => {
  assertEquals(
    normalizeAgencyLookupKey("Dept. of Public Works"),
    "department of public works",
  );

  assertEquals(
    normalizeAgencyLookupKey("Office of the Mayor & Cabinet"),
    "office of the mayor and cabinet",
  );

  assertEquals(normalizeAgencyLookupKey("  Public\tWorks Department "), "public works department");
});
