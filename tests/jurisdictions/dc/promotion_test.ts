import { assertEquals } from "@std/assert";

import { compileFragments } from "../../../src/compiler/compile.ts";
import { cite, type EntryFragment } from "../../../src/core/types.ts";
import { dcRuntime } from "../../../src/jurisdictions/dc/index.ts";
import { interpretOpenDCPublicBodies } from "../../../src/jurisdictions/dc/interpreters/open_dc_public_bodies.ts";
import { openDCPublicBodiesSourceId } from "../../../src/jurisdictions/dc/sources/open_dc_public_bodies.ts";

Deno.test("DC promotion policy promotes valid DCGIS agencies", () => {
  const result = compileFragments({
    jurisdiction: dcRuntime.jurisdiction,
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: dcRuntime.kinds,
    promotionPolicy: dcRuntime.promotionPolicy,
    fragments: [entryFragment({
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      provisionalId: "dc.agency:a-1",
      kind: "dc.agency",
      name: "Agency One",
      attributes: { shortName: "A1", sourceAgencyId: "a-1" },
    })],
  });

  assertEquals(result.ok, true);
  assertEquals(result.state?.entries.has("dc.agency:a-1"), true);
});

Deno.test("DC promotion policy promotes valid DCGIS public-body kinds", () => {
  const result = compileFragments({
    jurisdiction: dcRuntime.jurisdiction,
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: dcRuntime.kinds,
    promotionPolicy: dcRuntime.promotionPolicy,
    fragments: [
      entryFragment({
        source: "dcgis.boards",
        sourceRecordId: "board-1",
        provisionalId: "dc.board:b-1",
        kind: "dc.board",
        name: "Board One",
        attributes: { shortName: "B1", sourceBoardId: "b-1" },
      }),
      entryFragment({
        source: "dcgis.commissions",
        sourceRecordId: "commission-1",
        provisionalId: "dc.commission:c-1",
        kind: "dc.commission",
        name: "Commission One",
        attributes: { shortName: "C1", sourceCommissionId: "c-1" },
      }),
      entryFragment({
        source: "dcgis.authorities",
        sourceRecordId: "authority-1",
        provisionalId: "dc.authority:au-1",
        family: "authority",
        kind: "dc.authority",
        name: "Authority One",
        attributes: { shortName: "AU1", sourceAuthorityId: "au-1" },
      }),
      entryFragment({
        source: "dcgis.councils",
        sourceRecordId: "council-1",
        provisionalId: "dc.council:co-1",
        kind: "dc.council",
        name: "Council One",
        attributes: { shortName: "CO1", sourceCouncilId: "co-1" },
      }),
    ],
  });

  assertEquals(result.ok, true);
  assertEquals(result.state?.entries.has("dc.board:b-1"), true);
  assertEquals(result.state?.entries.has("dc.commission:c-1"), true);
  assertEquals(result.state?.entries.has("dc.authority:au-1"), true);
  assertEquals(result.state?.entries.has("dc.council:co-1"), true);
});

Deno.test("DC promotion policy keeps bad Open DC examples out of canonical state", () => {
  for (
    const [name, slug] of [
      ["Alice Deal Middle School LSAT", "alice-deal-middle-school-lsat"],
      [
        "Department of Consumer and Regulatory Affairs",
        "department-consumer-and-regulatory-affairs",
      ],
      ["Advisory Committee on Acupuncture", "advisory-committee-acupuncture"],
      ["Climate Task Force", "climate-task-force"],
      ["Some Office", "some-office"],
      ["Mystery Entity on Housing", "mystery-body"],
    ] as const
  ) {
    const interpreted = interpretOpenDCPublicBodies([{
      source: openDCPublicBodiesSourceId,
      snapshotKey: "page-0",
      key: slug,
      payload: {
        name,
        slug,
        detailUrl: `https://www.open-dc.gov/public-bodies/${slug}/`,
      },
    }]);

    const result = compileFragments({
      jurisdiction: dcRuntime.jurisdiction,
      generatedAt: "2026-06-07T00:00:00.000Z",
      kindRegistry: dcRuntime.kinds,
      promotionPolicy: dcRuntime.promotionPolicy,
      fragments: interpreted.entryFragments,
      findings: interpreted.findings,
    });

    assertEquals(result.ok, true);
    assertEquals(result.state?.entries.has(`dc.agency:${slug}`), false);
    assertEquals(
      result.findings.some((finding) =>
        finding.code === "dc.promotion.opendc_public_body_review_required"
      ),
      true,
    );
  }
});

Deno.test("DC promotion policy still applies revisions after baseline generation", () => {
  const result = compileFragments({
    jurisdiction: dcRuntime.jurisdiction,
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: dcRuntime.kinds,
    promotionPolicy: dcRuntime.promotionPolicy,
    fragments: [entryFragment({
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      provisionalId: "dc.agency:a-1",
      kind: "dc.agency",
      name: "Agency One",
      attributes: { shortName: "A1", sourceAgencyId: "a-1" },
    })],
    revisions: [{
      id: "rename-agency",
      source: "operator",
      targetKind: "entry",
      targetId: "dc.agency:a-1",
      patch: { name: "Agency One Canonical" },
    }],
  });

  assertEquals(result.ok, true);
  assertEquals(result.baseline.entries.get("dc.agency:a-1")?.name, "Agency One");
  assertEquals(result.state?.entries.get("dc.agency:a-1")?.name, "Agency One Canonical");
});

function entryFragment(
  input: {
    source: string;
    sourceRecordId: string;
    provisionalId: string;
    family?: EntryFragment["family"];
    kind: string;
    name: string;
    attributes: Record<string, unknown>;
  },
): EntryFragment {
  return {
    fragmentType: "entry",
    source: input.source,
    sourceRecordId: input.sourceRecordId,
    provisionalId: input.provisionalId,
    family: input.family ?? "organization",
    kind: input.kind,
    name: input.name,
    attributes: input.attributes,
    citations: [cite(input.source, input.sourceRecordId)],
  };
}
