import { assertEquals } from "@std/assert";
import { cite, type Finding, isCitationValue } from "../../../src/core/types.ts";
import {
  openDCPublicBodiesBinding,
  openDCPublicBodiesSource,
  openDCPublicBodiesSourceId,
} from "../../../src/jurisdictions/dc/sources/open_dc_public_bodies.ts";
import { interpretOpenDCPublicBodies } from "../../../src/jurisdictions/dc/interpreters/open_dc_public_bodies.ts";
import type { DcInterpreterContext } from "../../../src/jurisdictions/dc/interpreters/context.ts";

const agencyLookup = new Map<string, string>([
  ["department of public works", "dc.agency:DPW"],
  ["office of planning", "dc.agency:OP"],
]);

const contextWithAgencyLookup: DcInterpreterContext = { agencyLookup };

Deno.test("open_dc.public_bodies source ID is exactly open_dc.public_bodies", () => {
  assertEquals(openDCPublicBodiesSourceId, "open_dc.public_bodies");
  assertEquals(openDCPublicBodiesSource.id, "open_dc.public_bodies");
});

Deno.test("open_dc.public_bodies interprets board entry with resolved governing agency", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "advisory-board",
    payload: {
      name: "Advisory Board",
      slug: "advisory-board",
      detailUrl: "https://www.open-dc.gov/public-bodies/advisory-board/",
      enablingStatute: "D.C. Law 10-50",
      enablingStatuteUrl: "https://code.dccouncil.gov/us/dc/council/code/sections/1-123",
      governingAgency: "Department of Public Works",
      governingAgencyAcronym: "DPW",
      administeringAgency: "Office of the Mayor",
      fromSupplementalIndex: false,
    },
  }], contextWithAgencyLookup);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 1);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].code, "dc.interpreter.opendc_enabling_statute_unparsed");

  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.fragmentType, "entry");
  assertEquals(entryFragment.source, openDCPublicBodiesSource.id);
  assertEquals(entryFragment.sourceRecordId, "advisory-board");
  assertEquals(entryFragment.provisionalId, "dc.board:advisory-board");
  assertEquals(entryFragment.kind, "dc.board");
  assertEquals(entryFragment.name, "Advisory Board");
  assertEquals(entryFragment.attributes.shortName, "Advisory Board");
  assertEquals(entryFragment.attributes.sourceOpenDcSlug, "advisory-board");

  const relations = output.relationFragments;
  const governingRelation = relations.find(
    (r) => r.to === "dc.agency:DPW",
  );
  assertEquals(governingRelation?.from, "dc.board:advisory-board");
  assertEquals(governingRelation?.relationKind, "dc.relation:governs");

  assertEquals(relations.length, 1);
});

Deno.test("open_dc.public_bodies does not create relation without agency lookup", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "advisory-board",
    payload: {
      name: "Advisory Board",
      slug: "advisory-board",
      detailUrl: "https://www.open-dc.gov/public-bodies/advisory-board/",
      governingAgency: "Department of Public Works",
      governingAgencyAcronym: "DPW",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 0);
  const hasUnresolvedFinding = output.findings.some(
    (f) => f.code === "dc.interpreter.opendc_governing_agency_unresolved",
  );
  assertEquals(hasUnresolvedFinding, true);
});

Deno.test("open_dc.public_bodies interprets commission entry", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-1",
    key: "planning-commission",
    payload: {
      name: "Planning Commission",
      slug: "planning-commission",
      detailUrl: "https://www.open-dc.gov/public-bodies/planning-commission/",
      enablingStatute: "D.C. Code § 1-200",
      governingAgency: "Office of Planning",
      governingAgencyAcronym: "OP",
    },
  }], contextWithAgencyLookup);

  assertEquals(output.entryFragments.length, 1);
  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.provisionalId, "dc.commission:planning-commission");
  assertEquals(entryFragment.kind, "dc.commission");

  assertEquals(output.relationFragments.length, 1);
  const governingRelation = output.relationFragments.find(
    (r) => r.to === "dc.agency:OP",
  );
  assertEquals(governingRelation?.from, "dc.commission:planning-commission");
});

Deno.test("open_dc.public_bodies interprets authority entry with non-relationship labels", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-2",
    key: "water-authority",
    payload: {
      name: "Water Authority",
      slug: "water-authority",
      detailUrl: "https://www.open-dc.gov/public-bodies/water-authority/",
      governingAgency: "N/A",
      administeringAgency: "Executive Office of the Mayor",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.provisionalId, "dc.authority:water-authority");
  assertEquals(entryFragment.kind, "dc.authority");
  assertEquals(output.relationFragments.length, 0);
});

Deno.test("open_dc.public_bodies interprets committee as dc.agency with finding", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "advisory-committee",
    payload: {
      name: "Advisory Committee",
      slug: "advisory-committee",
      detailUrl: "https://www.open-dc.gov/public-bodies/advisory-committee/",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.provisionalId, "dc.agency:advisory-committee");
  assertEquals(entryFragment.kind, "dc.agency");
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].code, "dc.interpreter.opendc_unclassified_body");
});

Deno.test("open_dc.public_bodies interprets task-force variants as dc.agency with finding", () => {
  for (
    const [name, slug] of [
      ["Climate Task-Force", "climate-task-force"],
      ["Climate Taskforce", "climate-taskforce"],
    ] as const
  ) {
    const output = interpretOpenDCPublicBodies([{
      source: openDCPublicBodiesSource.id,
      snapshotKey: "page-0",
      key: slug,
      payload: {
        name,
        slug,
        detailUrl: `https://www.open-dc.gov/public-bodies/${slug}/`,
      },
    }]);

    assertEquals(output.entryFragments.length, 1);
    const [entryFragment] = output.entryFragments;
    assertEquals(entryFragment.provisionalId, `dc.agency:${slug}`);
    assertEquals(entryFragment.kind, "dc.agency");
    assertEquals(output.findings.length, 1);
    assertEquals(output.findings[0].code, "dc.interpreter.opendc_unclassified_body");
    assertEquals(output.findings[0].message.includes('"task_force"'), true);
  }
});

Deno.test("open_dc.public_bodies interprets council as dc.agency with finding", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "arts-council",
    payload: {
      name: "Arts Council",
      slug: "arts-council",
      detailUrl: "https://www.open-dc.gov/public-bodies/arts-council/",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.provisionalId, "dc.agency:arts-council");
  assertEquals(entryFragment.kind, "dc.agency");
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].code, "dc.interpreter.opendc_unclassified_body");
});

Deno.test("open_dc.public_bodies interprets office as dc.agency with finding", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "some-office",
    payload: {
      name: "Some Office",
      slug: "some-office",
      detailUrl: "https://www.open-dc.gov/public-bodies/some-office/",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.provisionalId, "dc.agency:some-office");
  assertEquals(entryFragment.kind, "dc.agency");
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].code, "dc.interpreter.opendc_unclassified_body");
});

Deno.test("open_dc.public_bodies interprets agency-like entry as dc.agency with finding", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-3",
    key: "some-agency",
    payload: {
      name: "Some Agency",
      slug: "some-agency",
      detailUrl: "https://www.open-dc.gov/public-bodies/some-agency/",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.provisionalId, "dc.agency:some-agency");
  assertEquals(entryFragment.kind, "dc.agency");
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].code, "dc.interpreter.opendc_unclassified_body");
});

Deno.test("open_dc.public_bodies reports finding for unclassified body name", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "mystery-body",
    payload: {
      name: "Mystery Entity on Housing",
      slug: "mystery-body",
      detailUrl: "https://www.open-dc.gov/public-bodies/mystery-body/",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.entryFragments[0].kind, "dc.agency");
  const hasFindings = output.findings.some(
    (f) => f.code === "dc.interpreter.opendc_unclassified_body",
  );
  assertEquals(hasFindings, true);
});

Deno.test("open_dc.public_bodies reports warning when name is missing", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "missing-fields",
    payload: {
      slug: "missing-fields",
    },
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.relationFragments.length, 0);
  assertEquals(output.findings.length, 1);
  assertEquals(output.findings[0].kind, "warn");
  assertEquals(output.findings[0].code, "dc.interpreter.opendc_missing_fields");
  assertEquals(output.findings[0].citation, cite(openDCPublicBodiesSource.id, "missing-fields"));
});

Deno.test("open_dc.public_bodies reports warning for invalid payload", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "row-1",
    payload: "not-object" as unknown as Record<string, unknown>,
  }]);

  assertEquals(output.entryFragments.length, 0);
  assertEquals(output.findings.map((finding: Finding) => finding.code), [
    "dc.interpreter.invalid_payload",
  ]);
});

Deno.test("open_dc.public_bodies skips non-relationship agency labels", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "test-board",
    payload: {
      name: "Test Board",
      slug: "test-board",
      detailUrl: "https://www.open-dc.gov/public-bodies/test-board/",
      governingAgency: "N/A",
      administeringAgency: "None",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 0);
});

Deno.test("open_dc.public_bodies creates finding for ambiguous agency label", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "test-board",
    payload: {
      name: "Test Board",
      slug: "test-board",
      detailUrl: "https://www.open-dc.gov/public-bodies/test-board/",
      governingAgency: "Independent Agency",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 0);
  const independentLabel = output.findings.find(
    (f) => f.code === "dc.interpreter.opendc_governing_agency_unresolved",
  );
  assertEquals(independentLabel, undefined);
});

Deno.test("open_dc.public_bodies creates finding for unresolvable agency label", () => {
  const context: DcInterpreterContext = { agencyLookup: new Map() };
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "test-board",
    payload: {
      name: "Test Board",
      slug: "test-board",
      detailUrl: "https://www.open-dc.gov/public-bodies/test-board/",
      governingAgency: "Department of Administrative Services",
    },
  }], context);

  assertEquals(output.entryFragments.length, 1);
  assertEquals(output.relationFragments.length, 0);
  const unresolvedFinding = output.findings.find(
    (f) => f.code === "dc.interpreter.opendc_governing_agency_unresolved",
  );
  assertEquals(unresolvedFinding !== undefined, true);
  assertEquals(
    unresolvedFinding!.message,
    'Public body "Test Board" has governing agency "Department of Administrative Services" that does not resolve to a known agency in lookup',
  );
});

Deno.test("open_dc.public_bodies reports likely duplicate bodies when normalized names collide across slugs", () => {
  const output = interpretOpenDCPublicBodies([
    {
      source: openDCPublicBodiesSource.id,
      snapshotKey: "page-0",
      key: "adult-career-pathways-task-force",
      payload: {
        name: "Adult Career Pathways Task Force",
        slug: "adult-career-pathways-task-force",
        detailUrl: "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force/",
      },
    },
    {
      source: openDCPublicBodiesSource.id,
      snapshotKey: "page-1",
      key: "adult-career-pathways-task-force-2",
      payload: {
        name: "Adult Career Pathways Task Force",
        slug: "adult-career-pathways-task-force-2",
        detailUrl: "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force-2/",
      },
    },
  ]);

  assertEquals(output.entryFragments.length, 2);
  const duplicateFindings = output.findings.filter(
    (finding) => finding.code === "dc.interpreter.opendc_likely_duplicate_public_body",
  );
  assertEquals(duplicateFindings.length, 2);
  assertEquals(
    duplicateFindings.every((finding) =>
      finding.message.includes("adult-career-pathways-task-force") &&
      finding.message.includes("adult-career-pathways-task-force-2")
    ),
    true,
  );
});

Deno.test("open_dc.public_bodies parses legal citations from enabling statute", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "legal-board",
    payload: {
      name: "Legal Board",
      slug: "legal-board",
      detailUrl: "https://www.open-dc.gov/public-bodies/legal-board/",
      enablingStatute: "D.C. Code § 1-200.01",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.citations.length, 2);
  assertEquals(entryFragment.citations[0], cite(openDCPublicBodiesSource.id, "legal-board"));
  assertEquals(
    entryFragment.citations[1],
    cite(openDCPublicBodiesSource.id, "legal-board", { locator: "D.C. Code § 1-200.01" }),
  );
});

Deno.test("open_dc.public_bodies preserves non-legal authority text as evidence and finding", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "board-with-order",
    payload: {
      name: "Board With Order",
      slug: "board-with-order",
      detailUrl: "https://www.open-dc.gov/public-bodies/board-with-order/",
      enablingStatute: "Mayor's Order 2020-123 (some description)",
      enablingStatuteUrl: "https://www.open-dc.gov/mayors-order-2020-123",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  const [entryFragment] = output.entryFragments;
  assertEquals(
    entryFragment.attributes.enablingStatute,
    "Mayor's Order 2020-123 (some description)",
  );
  assertEquals(
    entryFragment.attributes.enablingStatuteUrl,
    "https://www.open-dc.gov/mayors-order-2020-123",
  );

  const unparsedFinding = output.findings.find(
    (f) => f.code === "dc.interpreter.opendc_enabling_statute_unparsed",
  );
  assertEquals(unparsedFinding !== undefined, true);
  assertEquals(
    unparsedFinding!.citation,
    cite(openDCPublicBodiesSource.id, "board-with-order", { locator: "enablingStatute" }),
  );
});

Deno.test("open_dc.public_bodies source binding links interpreter", () => {
  assertEquals(openDCPublicBodiesBinding.source.id, openDCPublicBodiesSource.id);
  assertEquals(openDCPublicBodiesBinding.interpret, interpretOpenDCPublicBodies);
});

Deno.test("open_dc.public_bodies deduplicates citations with legal refs", () => {
  const output = interpretOpenDCPublicBodies([{
    source: openDCPublicBodiesSource.id,
    snapshotKey: "page-0",
    key: "statute-board",
    payload: {
      name: "Statute Board",
      slug: "statute-board",
      detailUrl: "https://www.open-dc.gov/public-bodies/statute-board/",
      enablingStatute: "D.C. Law 10-50",
      enablingStatuteUrl: "https://code.dccouncil.gov/us/dc/council/code/sections/1-123",
    },
  }]);

  assertEquals(output.entryFragments.length, 1);
  const [entryFragment] = output.entryFragments;
  assertEquals(entryFragment.citations.length, 1);
});
