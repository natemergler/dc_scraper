import { assertEquals } from "@std/assert";
import { cite } from "../../../src/core/types.ts";
import {
  buildLegalAuthorityArtifacts,
  buildOpenDcLegalAuthorityLocatorInputs,
} from "../../../src/jurisdictions/dc/interpreters/legal_authorities.ts";

Deno.test("legal authority artifacts emit entries and authorized_by relations for alpha in-scope locators", () => {
  const artifacts = buildLegalAuthorityArtifacts({
    source: "test.source",
    sourceRecordId: "record-1",
    subjectProvisionalId: "dc.board:test-board",
    locatorInputs: [
      { locator: "D.C. Official Code § 1-123(a)" },
      { locator: "D.C. Law 24-176" },
      { locator: "Mayor’s Order 2024-034" },
    ],
  });

  assertEquals(
    artifacts.entryFragments.map((fragment) => ({
      id: fragment.provisionalId,
      family: fragment.family,
      kind: fragment.kind,
      authorityType: fragment.attributes.authorityType,
      locator: fragment.attributes.locator,
    })),
    [
      {
        id: "dc.legal_authority:d-c-code-1-123-a",
        family: "authority",
        kind: "dc.legal_authority",
        authorityType: "dc_code",
        locator: "D.C. Code § 1-123(a)",
      },
      {
        id: "dc.legal_authority:d-c-law-24-176",
        family: "authority",
        kind: "dc.legal_authority",
        authorityType: "dc_law",
        locator: "D.C. Law 24-176",
      },
      {
        id: "dc.legal_authority:mayor-s-order-2024-034",
        family: "authority",
        kind: "dc.legal_authority",
        authorityType: "mayors_order",
        locator: "Mayor's Order 2024-034",
      },
    ],
  );
  assertEquals(
    artifacts.relationFragments.map((relation) => ({
      from: relation.from,
      relationKind: relation.relationKind,
      to: relation.to,
    })),
    [
      {
        from: "dc.board:test-board",
        relationKind: "dc.relation:authorized_by",
        to: "dc.legal_authority:d-c-code-1-123-a",
      },
      {
        from: "dc.board:test-board",
        relationKind: "dc.relation:authorized_by",
        to: "dc.legal_authority:d-c-law-24-176",
      },
      {
        from: "dc.board:test-board",
        relationKind: "dc.relation:authorized_by",
        to: "dc.legal_authority:mayor-s-order-2024-034",
      },
    ],
  );
});

Deno.test("legal authority artifacts keep out-of-scope locators as citations only", () => {
  const artifacts = buildLegalAuthorityArtifacts({
    source: "test.source",
    sourceRecordId: "record-2",
    subjectProvisionalId: "dc.board:test-board",
    locatorInputs: [
      { locator: "D.C. Act 25-100" },
      { locator: "D.C. Municipal Regulations § 1-101" },
      { locator: "42 U.S.C. § 1983" },
      { locator: "12 CFR 34.5" },
      { locator: "Home Rule Charter § 101" },
      { locator: "free-text enabling authority" },
    ],
  });

  assertEquals(artifacts.entryFragments, []);
  assertEquals(artifacts.relationFragments, []);
  assertEquals(artifacts.entryCitations, [
    cite("test.source", "record-2"),
    cite("test.source", "record-2", { locator: "D.C. Act 25-100" }),
    cite("test.source", "record-2", { locator: "D.C. Municipal Regulations § 1-101" }),
    cite("test.source", "record-2", { locator: "42 U.S.C. § 1983" }),
    cite("test.source", "record-2", { locator: "12 CFR 34.5" }),
    cite("test.source", "record-2", { locator: "Home Rule Charter § 101" }),
    cite("test.source", "record-2", { locator: "free-text enabling authority" }),
  ]);
});

Deno.test("open dc legal authority locator inputs ignore catalog URLs without explicit locators", () => {
  assertEquals(
    buildOpenDcLegalAuthorityLocatorInputs(
      [],
      "https://code.dccouncil.gov/us/dc/council/code",
    ),
    [],
  );
  assertEquals(
    buildOpenDcLegalAuthorityLocatorInputs(
      [],
      "https://code.dccouncil.gov/us/dc/council/laws",
    ),
    [],
  );
});
