import { assertEquals } from "@std/assert";
import { cite, type Entry, type LedgerState } from "../../src/core/types.ts";
import { findReconciliationCandidates } from "../../src/reconciliation/candidates.ts";

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "kind" | "name">): Entry {
  return {
    id: overrides.id,
    family: overrides.family ?? "organization",
    kind: overrides.kind,
    name: overrides.name,
    attributes: overrides.attributes ?? { shortName: overrides.name },
    citations: overrides.citations ?? [],
    relations: overrides.relations ?? {},
  };
}

function state(entries: Entry[]): LedgerState {
  return {
    jurisdiction: "dc",
    generatedAt: "2026-06-11T00:00:00.000Z",
    entries: new Map(entries.map((candidate) => [candidate.id, candidate])),
    findings: [],
  };
}

Deno.test("findReconciliationCandidates reports same-name source shadows with risks", () => {
  const report = findReconciliationCandidates(
    state([
      entry({
        id: "dc.council:19",
        kind: "dc.council",
        name: "Food Policy Council",
        citations: [cite("dcgis.councils", "19")],
      }),
      entry({
        id: "dc.council:food-policy-council",
        kind: "dc.council",
        name: "Food Policy Council",
        citations: [cite("open_dc.public_bodies", "food-policy-council")],
      }),
    ]),
    { generatedAt: "fixed" },
  );

  assertEquals(report.generatedAt, "fixed");
  assertEquals(report.candidateCount, 1);
  assertEquals(report.candidates[0].reason, "same_normalized_name");
  assertEquals(report.candidates[0].matchKey, "food policy council");
  assertEquals(report.candidates[0].severity, "medium");
  assertEquals(report.candidates[0].confidence, "high");
  assertEquals(report.candidates[0].reviewCategory, "source_shadow");
  assertEquals(report.candidates[0].risks, ["cross_source_shadow"]);
  assertEquals(report.candidates[0].sourceFamilies, ["dcgis", "open_dc"]);
  assertEquals(report.candidates[0].entries.map((candidate) => candidate.id), [
    "dc.council:19",
    "dc.council:food-policy-council",
  ]);
  assertEquals(report.candidates[0].entries[0].sources, ["dcgis.councils"]);
});

Deno.test("findReconciliationCandidates reports shared URLs and legal locators", () => {
  const report = findReconciliationCandidates(
    state([
      entry({
        id: "dc.agency:a",
        kind: "dc.agency",
        name: "Agency A",
        attributes: {
          shortName: "A",
          webUrl: "https://example.dc.gov/path/?utm=ignored",
        },
        citations: [cite("dcgis.agencies", "a", { locator: "D.C. Code § 1-123" })],
      }),
      entry({
        id: "dc.board:b",
        kind: "dc.board",
        name: "Board B",
        attributes: {
          shortName: "B",
          sourceOpenDcUrl: "https://example.dc.gov/path/#section",
        },
        citations: [cite("open_dc.public_bodies", "b", { locator: "D.C. Code § 1-123" })],
      }),
    ]),
    { generatedAt: "fixed" },
  );

  assertEquals(report.candidateCount, 2);
  assertEquals(report.candidates.map((candidate) => candidate.reason).sort(), [
    "shared_legal_locator",
    "shared_url",
  ]);
  assertEquals(
    report.candidates.every((candidate) => candidate.risks.includes("kind_conflict")),
    true,
  );
});

Deno.test("findReconciliationCandidates does not treat shared legal authority relations as locator duplicates", () => {
  const report = findReconciliationCandidates(
    state([
      entry({
        id: "dc.board:b",
        kind: "dc.board",
        name: "Board B",
        citations: [cite("dcgis.boards", "b")],
        relations: {
          "dc.relation:authorized_by": [{
            kind: "dc.relation:authorized_by",
            to: "dc.legal_authority:d-c-code-1-123",
            citations: [cite("dcgis.boards", "b", { locator: "D.C. Code § 1-123" })],
          }],
        },
      }),
      entry({
        id: "dc.commission:c",
        kind: "dc.commission",
        name: "Commission C",
        citations: [cite("open_dc.public_bodies", "c")],
        relations: {
          "dc.relation:authorized_by": [{
            kind: "dc.relation:authorized_by",
            to: "dc.legal_authority:d-c-code-1-123",
            citations: [cite("open_dc.public_bodies", "c", { locator: "D.C. Code § 1-123" })],
          }],
        },
      }),
      entry({
        id: "dc.legal_authority:d-c-code-1-123",
        family: "authority",
        kind: "dc.legal_authority",
        name: "D.C. Code § 1-123",
        attributes: {
          authorityType: "dc_code",
          locator: "D.C. Code § 1-123",
        },
        citations: [cite("dcgis.boards", "b", { locator: "D.C. Code § 1-123" })],
      }),
    ]),
    { generatedAt: "fixed" },
  );

  assertEquals(
    report.candidates.some((candidate) => candidate.reason === "shared_legal_locator"),
    false,
  );
});

Deno.test("findReconciliationCandidates ignores expected body-to-legal-authority URL overlap", () => {
  const report = findReconciliationCandidates(
    state([
      entry({
        id: "dc.board:b",
        kind: "dc.board",
        name: "Board B",
        attributes: {
          shortName: "Board B",
          enablingStatuteUrl: "https://code.dccouncil.gov/us/dc/council/code/sections/1-123",
        },
        citations: [cite("open_dc.public_bodies", "b")],
        relations: {
          "dc.relation:authorized_by": [{
            kind: "dc.relation:authorized_by",
            to: "dc.legal_authority:d-c-code-1-123",
            citations: [cite("open_dc.public_bodies", "b", { locator: "D.C. Code § 1-123" })],
          }],
        },
      }),
      entry({
        id: "dc.legal_authority:d-c-code-1-123",
        family: "authority",
        kind: "dc.legal_authority",
        name: "D.C. Code § 1-123",
        attributes: {
          authorityType: "dc_code",
          locator: "D.C. Code § 1-123",
          canonicalUrl: "https://code.dccouncil.gov/us/dc/council/code/sections/1-123",
        },
        citations: [cite("open_dc.public_bodies", "b", {
          locator: "D.C. Code § 1-123",
          url: "https://code.dccouncil.gov/us/dc/council/code/sections/1-123",
        })],
      }),
    ]),
    { generatedAt: "fixed" },
  );

  assertEquals(
    report.candidates.some((candidate) => candidate.reason === "shared_url"),
    false,
  );
});

Deno.test("findReconciliationCandidates ignores court division discovery-page overlap with parent court", () => {
  const report = findReconciliationCandidates(
    state([
      entry({
        id: "dc.court:superior-court",
        kind: "dc.court",
        name: "Superior Court",
        attributes: {
          shortName: "Superior Court",
          officialUrl: "https://www.dccourts.gov/superior-court",
          sourcePageUrl: "https://www.dccourts.gov/superior-court",
        },
        citations: [cite("dccourts.structure", "superior-court", {
          url: "https://www.dccourts.gov/superior-court",
        })],
      }),
      entry({
        id: "dc.court_division:civil-division",
        kind: "dc.court_division",
        name: "Civil Division",
        attributes: {
          shortName: "Civil Division",
          officialUrl:
            "https://www.dccourts.gov/superior-court/superior-court-divisions/civil-division",
          sourceDiscoveryPageUrl: "https://www.dccourts.gov/superior-court",
          sourcePageUrl:
            "https://www.dccourts.gov/superior-court/superior-court-divisions/civil-division",
        },
        citations: [cite("dccourts.structure", "civil-division", {
          url: "https://www.dccourts.gov/superior-court/superior-court-divisions/civil-division",
        })],
        relations: {
          "dc.relation:part_of": [{
            kind: "dc.relation:part_of",
            to: "dc.court:superior-court",
            citations: [cite("dccourts.structure", "civil-division", {
              url:
                "https://www.dccourts.gov/superior-court/superior-court-divisions/civil-division",
            })],
          }],
        },
      }),
      entry({
        id: "dc.court_division:tax-division",
        kind: "dc.court_division",
        name: "Tax Division",
        attributes: {
          shortName: "Tax Division",
          officialUrl:
            "https://www.dccourts.gov/superior-court/superior-court-divisions/tax-division",
          sourceDiscoveryPageUrl: "https://www.dccourts.gov/superior-court",
          sourcePageUrl:
            "https://www.dccourts.gov/superior-court/superior-court-divisions/tax-division",
        },
        citations: [cite("dccourts.structure", "tax-division", {
          url: "https://www.dccourts.gov/superior-court/superior-court-divisions/tax-division",
        })],
        relations: {
          "dc.relation:part_of": [{
            kind: "dc.relation:part_of",
            to: "dc.court:superior-court",
            citations: [cite("dccourts.structure", "tax-division", {
              url: "https://www.dccourts.gov/superior-court/superior-court-divisions/tax-division",
            })],
          }],
        },
      }),
    ]),
    { generatedAt: "fixed" },
  );

  assertEquals(
    report.candidates.some((candidate) => candidate.reason === "shared_url"),
    false,
  );
});

Deno.test("findReconciliationCandidates reports total count separately from limited packets", () => {
  const report = findReconciliationCandidates(
    state([
      entry({ id: "dc.agency:a", kind: "dc.agency", name: "Alpha" }),
      entry({ id: "dc.board:a", kind: "dc.board", name: "Alpha" }),
      entry({ id: "dc.agency:b", kind: "dc.agency", name: "Beta" }),
      entry({ id: "dc.board:b", kind: "dc.board", name: "Beta" }),
    ]),
    { generatedAt: "fixed", limit: 1 },
  );

  assertEquals(report.candidateCount, 2);
  assertEquals(report.candidates.length, 1);
});

Deno.test("findReconciliationCandidates labels same-source duplicate risk", () => {
  const report = findReconciliationCandidates(
    state([
      entry({
        id: "dc.board:board-accountancy",
        kind: "dc.board",
        name: "Board of Accountancy",
        citations: [cite("open_dc.public_bodies", "board-accountancy")],
      }),
      entry({
        id: "dc.board:board-accountancy-0",
        kind: "dc.board",
        name: "Board of Accountancy",
        citations: [cite("open_dc.public_bodies", "board-accountancy-0")],
      }),
    ]),
    { generatedAt: "fixed" },
  );

  assertEquals(report.candidates[0].risks, ["same_source_duplicate"]);
  assertEquals(report.candidates[0].severity, "low");
  assertEquals(report.candidates[0].confidence, "high");
  assertEquals(report.candidates[0].reviewCategory, "same_source_duplicate");
});

Deno.test("findReconciliationCandidates filters shared area URL noise", () => {
  const report = findReconciliationCandidates(
    state([
      entry({
        id: "dc.smd:8E01",
        family: "area",
        kind: "dc.smd",
        name: "SMD 8E01",
        attributes: { webUrl: "https://example-anc.dc.gov" },
        citations: [cite("dcgis.smds", "8E01")],
      }),
      entry({
        id: "dc.smd:8E02",
        family: "area",
        kind: "dc.smd",
        name: "SMD 8E02",
        attributes: { webUrl: "https://example-anc.dc.gov/" },
        citations: [cite("dcgis.smds", "8E02")],
      }),
    ]),
    { generatedAt: "fixed" },
  );

  assertEquals(report.candidateCount, 0);
  assertEquals(report.candidates, []);
});

Deno.test("findReconciliationCandidates filters common source-page URL noise", () => {
  const report = findReconciliationCandidates(
    state([
      entry({
        id: "dc.office:a",
        kind: "dc.office",
        name: "Office A",
        attributes: { sourcePageUrl: "https://mayor.dc.gov/org-chart" },
        citations: [cite("mayor.executive_structure", "a")],
      }),
      entry({
        id: "dc.office:b",
        kind: "dc.office",
        name: "Office B",
        attributes: { sourcePageUrl: "https://mayor.dc.gov/org-chart" },
        citations: [cite("mayor.executive_structure", "b")],
      }),
      entry({
        id: "dc.office:c",
        kind: "dc.office",
        name: "Office C",
        attributes: { sourcePageUrl: "https://mayor.dc.gov/org-chart" },
        citations: [cite("mayor.executive_structure", "c")],
      }),
    ]),
    { generatedAt: "fixed" },
  );

  assertEquals(report.candidateCount, 0);
  assertEquals(report.candidates, []);
});

Deno.test("findReconciliationCandidates ignores OANC ANC profile overlap with commissioner seats", () => {
  const report = findReconciliationCandidates(
    state([
      entry({
        id: "dc.anc:4E",
        kind: "dc.anc",
        name: "ANC 4E",
        attributes: {
          sourceAncId: "4E",
          sourceOancProfileUrl: "https://oanc.dc.gov/anc-profile/anc-4e",
          officialUrl: "https://anc4e.example/",
        },
        citations: [cite("oanc.profiles", "4E", {
          url: "https://oanc.dc.gov/anc-profile/anc-4e",
        })],
      }),
      entry({
        id: "dc.anc_commissioner_seat:4E01",
        family: "position",
        kind: "dc.anc_commissioner_seat",
        name: "Commissioner Seat for SMD 4E01",
        attributes: {
          sourceAncId: "4E",
          sourceSmdId: "4E01",
          sourceOancProfileUrl: "https://oanc.dc.gov/anc-profile/anc-4e",
          currentHolderName: 'Aretha "Nikki" Jones',
        },
        citations: [cite("oanc.profiles", "4E", {
          url: "https://oanc.dc.gov/anc-profile/anc-4e",
        })],
      }),
    ]),
    { generatedAt: "fixed" },
  );

  assertEquals(report.candidateCount, 0);
  assertEquals(report.candidates, []);
});

Deno.test("findReconciliationCandidates ignores ANC website overlap with member SMDs", () => {
  const report = findReconciliationCandidates(
    state([
      entry({
        id: "dc.anc:4B",
        kind: "dc.anc",
        name: "ANC 4B",
        attributes: {
          sourceAncId: "4B",
          officialUrl: "https://anc4b.org/",
          webUrl: "https://anc.dc.gov/page/advisory-neighborhood-commission-4b",
        },
        citations: [cite("dcgis.ancs", "4B")],
        relations: {
          "dc.relation:contains": [{
            kind: "dc.relation:contains",
            to: "dc.smd:4B01",
            citations: [cite("dcgis.smds", "4B01")],
          }],
        },
      }),
      entry({
        id: "dc.smd:4B01",
        family: "area",
        kind: "dc.smd",
        name: "SMD 4B01",
        attributes: {
          sourceAncId: "4B",
          sourceSmdId: "4B01",
          webUrl: "https://anc4b.org",
        },
        citations: [cite("dcgis.smds", "4B01")],
      }),
      entry({
        id: "dc.smd:4B02",
        family: "area",
        kind: "dc.smd",
        name: "SMD 4B02",
        attributes: {
          sourceAncId: "4B",
          sourceSmdId: "4B02",
          webUrl: "https://anc4b.org/",
        },
        citations: [cite("dcgis.smds", "4B02")],
      }),
    ]),
    { generatedAt: "fixed" },
  );

  assertEquals(report.candidateCount, 0);
  assertEquals(report.candidates, []);
});
