import { assertEquals } from "@std/assert";
import { cite } from "../../../src/core/types.ts";
import {
  collectRecordCitations,
  parseLegalCitationLocators,
  parseLegalCitationLocatorsFromUrl,
} from "../../../src/jurisdictions/dc/interpreters/citations.ts";

Deno.test("dc legal citation parser extracts and deduplicates locators", () => {
  const payload = {
    LEGAL_BASIS: "D.C. Code § 1-102.5 and 12 CFR 34.5; also D.C. Code § 1-102.5",
    LAW: "No citation here",
    ENACTMENT: "D.C. Municipal Regulations §§ 11-101, 11-102(a), 11-103",
    STATUTE: "42 U.S.C. § 1983",
    LEGAL_REFERENCE: "D.C. Code §§ 2-601, 2-602, 2-603(a)",
    OTHER: "D.C. Code § 9-9 should be ignored in this field",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "12 CFR 34.5",
      "42 U.S.C. § 1983",
      "D.C. Code § 1-102.5",
      "D.C. Code § 2-601",
      "D.C. Code § 2-602",
      "D.C. Code § 2-603(a)",
      "D.C. Municipal Regulations § 11-101",
      "D.C. Municipal Regulations § 11-102(a)",
      "D.C. Municipal Regulations § 11-103",
    ],
  );
});

Deno.test("collectRecordCitations prepends source citation before parsed locators", () => {
  const citations = collectRecordCitations("dcgis.agencies", "row-9", {
    legal_basis: "D.C. Code § 2-501(a)",
    note: "extra",
  });

  assertEquals(citations, [
    cite("dcgis.agencies", "row-9"),
    cite("dcgis.agencies", "row-9", { locator: "D.C. Code § 2-501(a)" }),
  ]);
});

Deno.test("dc legal citation parser expands section lists and simple ranges", () => {
  const payload = {
    ENACTMENT:
      "D.C. Code §§ 2-601 - 2-602 and 3-101 to 3-103; D.C. Municipal Regulations §§ 8-101, 8-102, and 8-103; D.C. Code §§ 2-1601 to 1608",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "D.C. Code § 2-1601",
      "D.C. Code § 2-1608",
      "D.C. Code § 2-601",
      "D.C. Code § 2-602",
      "D.C. Code § 3-101",
      "D.C. Code § 3-103",
      "D.C. Municipal Regulations § 8-101",
      "D.C. Municipal Regulations § 8-102",
      "D.C. Municipal Regulations § 8-103",
    ],
  );
});

Deno.test("dc legal citation parser expands U.S.C. section lists", () => {
  const payload = {
    STATUTE: "42 U.S.C. §§ 1983, 1984 to 1986; 5 U.S.C. §§ 101(a), 101(b)",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "42 U.S.C. § 1983",
      "42 U.S.C. § 1984",
      "42 U.S.C. § 1986",
      "5 U.S.C. § 101(a)",
      "5 U.S.C. § 101(b)",
    ],
  );
});

Deno.test("dc legal citation parser expands CFR section lists", () => {
  const payload = {
    LEGAL_REFERENCE: "12 CFR §§ 34.5, 34.6; 5 CFR §§ 1000 to 1002; 40 CFR §§ 100a-1, 100a-2",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "12 CFR 34.5",
      "12 CFR 34.6",
      "40 CFR 100a-1",
      "40 CFR 100a-2",
      "5 CFR 1000",
      "5 CFR 1002",
    ],
  );
});

Deno.test("dc legal citation parser supports subsection shorthand in section lists", () => {
  const payload = {
    LEGAL_BASIS: "D.C. Code §§ 2-101(a), (b), 2-102",
    STATUTE: "42 U.S.C. §§ 1983(a), (b), 1984",
    LEGAL_REFERENCE: "12 CFR §§ 34.5(a), (b), 34.6",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "12 CFR 34.5(a)",
      "12 CFR 34.5(b)",
      "12 CFR 34.6",
      "42 U.S.C. § 1983(a)",
      "42 U.S.C. § 1983(b)",
      "42 U.S.C. § 1984",
      "D.C. Code § 2-101(a)",
      "D.C. Code § 2-101(b)",
      "D.C. Code § 2-102",
    ],
  );
});

Deno.test("dc legal citation parser preserves nested subsections and shorthand", () => {
  const payload = {
    LEGAL_REFERENCE: "D.C. Code §§ 2-101(a)(1), (2), and 2-102(a)(i), (ii)",
    STATUTE: "42 U.S.C. § 1983(a)(1)",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "42 U.S.C. § 1983(a)(1)",
      "D.C. Code § 2-101(a)(1)",
      "D.C. Code § 2-101(a)(2)",
      "D.C. Code § 2-102(a)(i)",
      "D.C. Code § 2-102(a)(ii)",
    ],
  );
});

Deno.test("dc legal citation parser supports no-section-sign forms", () => {
  const payload = {
    STATUTE: "42 U.S.C. 1983 and 42 U.S.C. 1984; 33 U.S. Code § 1267; 16 CFR 1002 and 5 CFR §1000",
    LEGAL_BASIS: "D.C. Code 7-200.1; DC Code Section 7-671.02",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "16 CFR 1002",
      "33 U.S.C. § 1267",
      "42 U.S.C. § 1983",
      "42 U.S.C. § 1984",
      "5 CFR §1000",
      "D.C. Code § 7-200.1",
      "DC Code § 7-671.02",
    ],
  );
});

Deno.test("dc legal citation parser preserves en-dash section numbers", () => {
  const payload = {
    LEGAL_REFERENCE: "DC Code § 1–621.5",
  };

  assertEquals(parseLegalCitationLocators(payload), ["DC Code § 1-621.5"]);
});

Deno.test("dc legal citation parser extracts explicit Mayor's Order locators", () => {
  const payload = {
    LEGAL_REFERENCE:
      "Mayor’s Order 2024-034: Establishment; Mayor's Order 2009-225; amended by 2013-154; MO 2016-083",
  };

  assertEquals(parseLegalCitationLocators(payload), [
    "Mayor's Order 2009-225",
    "Mayor's Order 2024-034",
  ]);
});

Deno.test("dc legal citation parser extracts D.C. Law and D.C. Act locators", () => {
  const payload = {
    LEGAL_REFERENCE:
      "D.C. Law 21-74. Higher Education Licensure Commission Amendment Act of 2015; 2015-260; D.C. Act 21-386",
  };

  assertEquals(parseLegalCitationLocators(payload), [
    "D.C. Act 21-386",
    "D.C. Law 21-74",
  ]);
});

Deno.test("dc legal citation parser extracts official Code and Law locators from URLs", () => {
  assertEquals(
    parseLegalCitationLocatorsFromUrl(
      "https://code.dccouncil.us/dc/council/code/sections/50-1831.html",
    ),
    ["D.C. Code § 50-1831"],
  );
  assertEquals(
    parseLegalCitationLocatorsFromUrl("https://code.dccouncil.gov/us/dc/council/laws/24-176"),
    ["D.C. Law 24-176"],
  );
  assertEquals(parseLegalCitationLocatorsFromUrl("https://dcps.dc.gov/publication/foo"), []);
});

Deno.test("dc legal citation parser expands no-section-sign ranges", () => {
  const payload = {
    STATUTE: "42 U.S.C. 1983 to 1985 and 5 U.S.C. 1983-1984",
    LEGAL_REFERENCE: "16 CFR 1002 through 1004 and 12 CFR 34.5-34.6",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "12 CFR 34.5",
      "12 CFR 34.6",
      "16 CFR 1002",
      "16 CFR 1004",
      "42 U.S.C. § 1983",
      "42 U.S.C. § 1985",
      "5 U.S.C. § 1983",
      "5 U.S.C. § 1984",
    ],
  );
});

Deno.test("dc legal citation parser expands D.C. no-section-sign to/through ranges", () => {
  const payload = {
    LEGAL_BASIS:
      "D.C. Code 7-300.1 to 7-300.3 and D.C. Code 2-1601 to 1608 and D.C. Official Code 12-100 through 12-101",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "D.C. Code § 2-1601",
      "D.C. Code § 2-1608",
      "D.C. Code § 7-300.1",
      "D.C. Code § 7-300.3",
      "D.C. Official Code § 12-100",
      "D.C. Official Code § 12-101",
    ],
  );
});

Deno.test("dc legal citation parser expands D.C. no-section-sign municipal regulation ranges", () => {
  const payload = {
    LEGAL_BASIS:
      "D.C. Municipal Regulations 3-101 through 3-102 and D.C. Municipal Regulations 4-201-4-205",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "D.C. Municipal Regulations § 3-101",
      "D.C. Municipal Regulations § 3-102",
      "D.C. Municipal Regulations § 4-201",
      "D.C. Municipal Regulations § 4-205",
    ],
  );
});

Deno.test("dc legal citation parser expands D.C. no-section-sign ranges", () => {
  const payload = {
    LEGAL_BASIS: "D.C. Code 7-200.1 and D.C. Code 8-100-8-102",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "D.C. Code § 7-200.1",
      "D.C. Code § 8-100",
      "D.C. Code § 8-102",
    ],
  );
});

Deno.test("dc legal citation parser expands D.C. no-section-sign lists", () => {
  const payload = {
    LEGAL_BASIS: "D.C. Code 1-201, 1-202, and 1-203",
    ENACTMENT: "D.C. Official Code 2-100, 2-101(a), and (b)",
    STATUTE: "D.C. Municipal Regulations 3-101(a), (b), and 3-102",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "D.C. Code § 1-201",
      "D.C. Code § 1-202",
      "D.C. Code § 1-203",
      "D.C. Municipal Regulations § 3-101(a)",
      "D.C. Municipal Regulations § 3-101(b)",
      "D.C. Municipal Regulations § 3-102",
      "D.C. Official Code § 2-100",
      "D.C. Official Code § 2-101(a)",
      "D.C. Official Code § 2-101(b)",
    ],
  );
});

Deno.test("dc legal citation parser expands D.C. no-section-sign semicolon lists", () => {
  const payload = {
    STATUTE:
      "D.C. Municipal Regulations 4-101; 4-102; and 4-103; D.C. Code 5-201 and 5-202 and 5-203",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "D.C. Code § 5-201",
      "D.C. Code § 5-202",
      "D.C. Code § 5-203",
      "D.C. Municipal Regulations § 4-101",
      "D.C. Municipal Regulations § 4-102",
      "D.C. Municipal Regulations § 4-103",
    ],
  );
});

Deno.test("dc legal citation parser ignores trailing prose after no-section-sign lists", () => {
  const payload = {
    LEGAL_BASIS: "D.C. Code 8-202, 8-203, and 8-204, as amended by D.C. Official Code revisions",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "D.C. Code § 8-202",
      "D.C. Code § 8-203",
      "D.C. Code § 8-204",
    ],
  );
});

Deno.test("dc legal citation parser expands U.S.C. no-section-sign lists", () => {
  const payload = {
    STATUTE: "42 U.S.C. 1983, 1984, and 1985; 5 U.S.C. 1001(a), (b), and 1002",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "42 U.S.C. § 1983",
      "42 U.S.C. § 1984",
      "42 U.S.C. § 1985",
      "5 U.S.C. § 1001(a)",
      "5 U.S.C. § 1001(b)",
      "5 U.S.C. § 1002",
    ],
  );
});

Deno.test("dc legal citation parser expands CFR no-section-sign lists", () => {
  const payload = {
    LEGAL_REFERENCE: "12 CFR 34.5; 34.6; and 34.7, and 40 CFR 100a-1(a), (b), and 100a-2",
  };

  assertEquals(
    parseLegalCitationLocators(payload),
    [
      "12 CFR 34.5",
      "12 CFR 34.6",
      "12 CFR 34.7",
      "40 CFR 100a-1(a)",
      "40 CFR 100a-1(b)",
      "40 CFR 100a-2",
    ],
  );
});
