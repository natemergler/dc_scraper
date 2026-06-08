import { assertEquals } from "@std/assert";
import {
  fileSafeLedgerId,
  normalizeAgencyLookupKey,
} from "../../../src/jurisdictions/dc/interpreters/context.ts";

Deno.test("fileSafeLedgerId preserves distinct ids for slash and hyphen inputs", () => {
  assertEquals(fileSafeLedgerId("3/4G"), "3~2F4G");
  assertEquals(fileSafeLedgerId("3-4G"), "3-4G");
});

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
