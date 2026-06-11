import { assertEquals } from "@std/assert";
import { cite } from "../../src/core/types.ts";
import { dcAgencyKind } from "../../src/jurisdictions/dc/kinds/agency.ts";
import { defineRelationKind, KindRegistry } from "../../src/core/kinds.ts";
import { compileFragments } from "../../src/compiler/compile.ts";

Deno.test("compile merges duplicate fragments into one baseline entry", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    fragments: [{
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      provisionalId: "dc.agency:a-1",
      family: "organization",
      kind: "dc.agency",
      name: "Transit",
      attributes: { shortName: "TR", sourceAgencyId: "a-1" },
      citations: [cite("dcgis.agencies", "row-1")],
    }, {
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-2",
      provisionalId: "dc.agency:a-1",
      family: "organization",
      kind: "dc.agency",
      name: "Transit Department",
      attributes: { sourceAgencyId: "a-1" },
      citations: [cite("dcgis.agencies", "row-2")],
    }],
  });

  assertEquals(result.ok, true);
  assertEquals(result.state?.entries.size, 1);
  const entry = result.state?.entries.get("dc.agency:a-1");
  assertEquals(entry?.name, "Transit Department");
  assertEquals(entry?.attributes.shortName, "TR");
  assertEquals(entry?.citations, [
    cite("dcgis.agencies", "row-1"),
    cite("dcgis.agencies", "row-2"),
  ]);
});

Deno.test("compile preserves locator citations from the same source record", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    fragments: [{
      fragmentType: "entry",
      source: "open_dc.public_bodies",
      sourceRecordId: "advisory-committee-acupuncture",
      provisionalId: "dc.agency:advisory-committee-acupuncture",
      family: "organization",
      kind: "dc.agency",
      name: "Advisory Committee on Acupuncture",
      attributes: { shortName: "Advisory Committee on Acupuncture" },
      citations: [
        cite("open_dc.public_bodies", "advisory-committee-acupuncture"),
        cite("open_dc.public_bodies", "advisory-committee-acupuncture", {
          locator: "DC Code § 3-1202.03",
        }),
        cite("open_dc.public_bodies", "advisory-committee-acupuncture", {
          locator: "DC Code § 3-1202.03",
        }),
      ],
    }],
  });

  assertEquals(result.ok, true);
  const entry = result.state?.entries.get("dc.agency:advisory-committee-acupuncture");
  assertEquals(entry?.citations, [
    cite("open_dc.public_bodies", "advisory-committee-acupuncture"),
    cite("open_dc.public_bodies", "advisory-committee-acupuncture", {
      locator: "DC Code § 3-1202.03",
    }),
  ]);
});

Deno.test("compile marks conflicts when revision makes state invalid", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    fragments: [{
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      provisionalId: "dc.agency:a-1",
      family: "organization",
      kind: "dc.agency",
      name: "Transit",
      attributes: { shortName: "TR", sourceAgencyId: "a-1" },
      citations: [cite("dcgis.agencies", "row-1")],
    }],
    revisions: [{
      id: "r1",
      source: "test",
      targetKind: "entry",
      targetId: "dc.agency:a-1",
      patch: { kind: "dc.unknown" },
    }],
  });

  assertEquals(result.ok, false);
  assertEquals(result.state, null);
  assertEquals(
    result.conflicts.map((finding) => finding.code).includes(
      "compiler.conflict.revision_invalid_state",
    ),
    true,
  );
});

Deno.test("compiler output is deterministic regardless of fragment order", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);

  const fragmentsA = [{
    fragmentType: "entry" as const,
    source: "dcgis.agencies",
    sourceRecordId: "row-2",
    provisionalId: "dc.agency:beta",
    family: "organization",
    kind: "dc.agency",
    name: "Beta",
    attributes: { shortName: "B", sourceAgencyId: "beta" },
    citations: [cite("dcgis.agencies", "row-2")],
  }, {
    fragmentType: "entry" as const,
    source: "dcgis.agencies",
    sourceRecordId: "row-1",
    provisionalId: "dc.agency:alpha",
    family: "organization",
    kind: "dc.agency",
    name: "Alpha",
    attributes: { shortName: "A", sourceAgencyId: "alpha" },
    citations: [cite("dcgis.agencies", "row-1")],
  }];

  const fragmentsB = [...fragmentsA].reverse();

  const first = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    fragments: fragmentsA,
  });

  const second = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    fragments: fragmentsB,
  });

  assertEquals(first.ok, true);
  assertEquals(second.ok, true);
  assertEquals(
    JSON.stringify(first.state?.entries),
    JSON.stringify(second.state?.entries),
  );
});

Deno.test("compile rejects unknown relation kinds", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);
  registry.registerRelation(defineRelationKind({ kind: "dc.relation:reports_to" }));

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    fragments: [{
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      provisionalId: "dc.agency:a-1",
      family: "organization",
      kind: "dc.agency",
      name: "Agency One",
      attributes: { shortName: "A1", sourceAgencyId: "a-1" },
      citations: [cite("dcgis.agencies", "row-1")],
    }, {
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-2",
      provisionalId: "dc.agency:a-2",
      family: "organization",
      kind: "dc.agency",
      name: "Agency Two",
      attributes: { shortName: "A2", sourceAgencyId: "a-2" },
      citations: [cite("dcgis.agencies", "row-2")],
    }, {
      fragmentType: "relation",
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      from: "dc.agency:a-1",
      relationKind: "dc.relation:influences",
      to: "dc.agency:a-2",
      citations: [cite("dcgis.agencies", "row-1")],
    }],
  });

  assertEquals(result.ok, false);
  assertEquals(result.state, null);
  assertEquals(
    result.conflicts.some((finding) => finding.code === "entry.relation_kind_unknown"),
    true,
  );
});

Deno.test("compile migrates legacy affiliated relation kinds", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);
  registry.registerRelation(defineRelationKind({ kind: "dc.relation:governs" }));

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    fragments: [{
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      provisionalId: "dc.agency:a-1",
      family: "organization",
      kind: "dc.agency",
      name: "Agency One",
      attributes: { shortName: "A1", sourceAgencyId: "a-1" },
      citations: [cite("dcgis.agencies", "row-1")],
    }, {
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-2",
      provisionalId: "dc.agency:a-2",
      family: "organization",
      kind: "dc.agency",
      name: "Agency Two",
      attributes: { shortName: "A2", sourceAgencyId: "a-2" },
      citations: [cite("dcgis.agencies", "row-2")],
    }, {
      fragmentType: "relation",
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      from: "dc.agency:a-1",
      relationKind: "dc.relation:affiliated_with",
      to: "dc.agency:a-2",
      citations: [cite("dcgis.agencies", "row-1")],
    }],
  });

  assertEquals(result.ok, true);
  assertEquals(result.state?.entries.get("dc.agency:a-1")?.relations, {
    "dc.relation:governs": [{
      kind: "dc.relation:governs",
      to: "dc.agency:a-2",
      citations: [cite("dcgis.agencies", "row-1")],
    }],
  });
});

Deno.test("compile applies relation revisions to override outgoing relations", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);
  registry.registerRelation(defineRelationKind({ kind: "dc.relation:reports_to" }));
  registry.registerRelation(defineRelationKind({ kind: "dc.relation:governs" }));

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    fragments: [{
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      provisionalId: "dc.agency:a-1",
      family: "organization",
      kind: "dc.agency",
      name: "Agency One",
      attributes: { shortName: "A1", sourceAgencyId: "a-1" },
      citations: [cite("dcgis.agencies", "row-1")],
    }, {
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-2",
      provisionalId: "dc.agency:a-2",
      family: "organization",
      kind: "dc.agency",
      name: "Agency Two",
      attributes: { shortName: "A2", sourceAgencyId: "a-2" },
      citations: [cite("dcgis.agencies", "row-2")],
    }],
    revisions: [{
      id: "r2",
      source: "test",
      targetKind: "relation",
      targetId: "dc.agency:a-2",
      patch: {
        relations: {
          "dc.relation:affiliated_with": [{
            kind: "dc.relation:affiliated_with",
            to: "dc.agency:a-1",
          }],
        },
      },
    }],
  });

  assertEquals(result.ok, true);
  assertEquals(result.state?.entries.get("dc.agency:a-2")?.relations, {
    "dc.relation:governs": [{
      kind: "dc.relation:governs",
      to: "dc.agency:a-1",
      citations: [],
    }],
  });
});

Deno.test("compile applies suppress revisions and removes inbound relations", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);
  registry.registerRelation(defineRelationKind({ kind: "dc.relation:reports_to" }));

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    fragments: [{
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      provisionalId: "dc.agency:a-1",
      family: "organization",
      kind: "dc.agency",
      name: "Agency One",
      attributes: { shortName: "A1", sourceAgencyId: "a-1" },
      citations: [cite("dcgis.agencies", "row-1")],
    }, {
      fragmentType: "entry",
      source: "open_dc.public_bodies",
      sourceRecordId: "shadow",
      provisionalId: "dc.agency:shadow",
      family: "organization",
      kind: "dc.agency",
      name: "Agency One",
      attributes: { shortName: "Agency One" },
      citations: [cite("open_dc.public_bodies", "shadow")],
    }, {
      fragmentType: "relation",
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      from: "dc.agency:a-1",
      relationKind: "dc.relation:reports_to",
      to: "dc.agency:shadow",
      citations: [cite("dcgis.agencies", "row-1")],
    }],
    revisions: [{
      id: "suppress-shadow",
      source: "operator",
      targetKind: "entry",
      targetId: "dc.agency:shadow",
      rationale: "Reviewed duplicate source shadow.",
      evidence: [cite("open_dc.public_bodies", "shadow")],
      patch: { suppress: true },
    }],
  });

  assertEquals(result.ok, true);
  assertEquals(result.state?.entries.has("dc.agency:shadow"), false);
  assertEquals(result.state?.entries.get("dc.agency:a-1")?.relations, {});
  assertEquals(
    result.findings.some((finding) => finding.code === "compiler.revision.entry_suppressed"),
    true,
  );
});

Deno.test("compile records audited review decisions without merging entries", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    fragments: [{
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      provisionalId: "dc.agency:a-1",
      family: "organization",
      kind: "dc.agency",
      name: "Agency One",
      attributes: { shortName: "A1", sourceAgencyId: "a-1" },
      citations: [cite("dcgis.agencies", "row-1")],
    }, {
      fragmentType: "entry",
      source: "open_dc.public_bodies",
      sourceRecordId: "shadow",
      provisionalId: "dc.agency:shadow",
      family: "organization",
      kind: "dc.agency",
      name: "Agency One",
      attributes: { shortName: "Agency One" },
      citations: [cite("open_dc.public_bodies", "shadow")],
    }],
    revisions: [{
      id: "preserve-distinct",
      source: "operator",
      targetKind: "entry",
      targetId: "dc.agency:a-1",
      rationale: "Reviewed official sources and preserved both entries as distinct.",
      evidence: [cite("dcgis.agencies", "row-1")],
      patch: {
        review: {
          decision: "preserve_distinct",
          relatedEntryIds: ["dc.agency:shadow"],
        },
      },
    }],
  });

  assertEquals(result.ok, true);
  assertEquals(result.state?.entries.has("dc.agency:a-1"), true);
  assertEquals(result.state?.entries.has("dc.agency:shadow"), true);
  assertEquals(result.state?.entries.get("dc.agency:a-1")?.attributes.revisionReviews, [{
    decision: "preserve_distinct",
    evidence: [cite("dcgis.agencies", "row-1")],
    rationale: "Reviewed official sources and preserved both entries as distinct.",
    relatedEntryIds: ["dc.agency:shadow"],
    revisionId: "preserve-distinct",
    source: "operator",
  }]);
  assertEquals(
    result.findings.some((finding) => finding.code === "compiler.revision.review_recorded"),
    true,
  );
});

Deno.test("compile rejects review revisions without rationale", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    fragments: [{
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      provisionalId: "dc.agency:a-1",
      family: "organization",
      kind: "dc.agency",
      name: "Agency One",
      attributes: { shortName: "A1", sourceAgencyId: "a-1" },
      citations: [cite("dcgis.agencies", "row-1")],
    }],
    revisions: [{
      id: "review-without-rationale",
      source: "operator",
      targetKind: "entry",
      targetId: "dc.agency:a-1",
      patch: {
        review: {
          decision: "alias",
          aliasNames: ["Agency One Alias"],
        },
      },
    }],
  });

  assertEquals(result.ok, false);
  assertEquals(result.conflicts[0]?.code, "compiler.conflict.revision_invalid_state");
  assertEquals(
    result.conflicts[0]?.message.includes("review revisions require rationale"),
    true,
  );
});

Deno.test("compile dedupes legacy and canonical relation facets", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);
  registry.registerRelation(defineRelationKind({ kind: "dc.relation:governs" }));

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    fragments: [{
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-2",
      provisionalId: "dc.agency:a-2",
      family: "organization",
      kind: "dc.agency",
      name: "Agency Two",
      attributes: { shortName: "A2", sourceAgencyId: "a-2" },
      citations: [cite("dcgis.agencies", "row-2")],
    }],
    revisions: [{
      id: "r3",
      source: "test",
      targetKind: "relation",
      targetId: "dc.agency:a-2",
      patch: {
        relations: {
          "dc.relation:affiliated_with": [
            {
              kind: "dc.relation:affiliated_with",
              to: "dc.agency:a-1",
            },
            {
              kind: "dc.relation:governs",
              to: "dc.agency:a-2",
            },
          ],
        },
      },
    }],
  });

  assertEquals(result.ok, true);
  assertEquals(result.state?.entries.get("dc.agency:a-2")?.relations, {
    "dc.relation:governs": [
      { kind: "dc.relation:governs", to: "dc.agency:a-1", citations: [] },
      { kind: "dc.relation:governs", to: "dc.agency:a-2", citations: [] },
    ],
  });
});

Deno.test("compile rejects invalid relation revision patches", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);
  registry.registerRelation(defineRelationKind({ kind: "dc.relation:reports_to" }));

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    fragments: [{
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      provisionalId: "dc.agency:a-1",
      family: "organization",
      kind: "dc.agency",
      name: "Agency One",
      attributes: { shortName: "A1", sourceAgencyId: "a-1" },
      citations: [cite("dcgis.agencies", "row-1")],
    }],
    revisions: [{
      id: "r3",
      source: "test",
      targetKind: "relation",
      targetId: "dc.agency:a-1",
      patch: {
        bad: "not relations",
      },
    }],
  });

  assertEquals(result.ok, false);
  assertEquals(result.state, null);
  assertEquals(
    result.conflicts.some((finding) => finding.code === "compiler.conflict.revision_invalid_state"),
    true,
  );
});
