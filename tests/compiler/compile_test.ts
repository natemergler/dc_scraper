import { assertEquals } from "@std/assert";
import { cite } from "../../src/core/types.ts";
import { dcAgencyKind } from "../../src/jurisdictions/dc/kinds/agency.ts";
import { defineRelationKind, KindRegistry } from "../../src/core/kinds.ts";
import { compileFragments } from "../../src/compiler/compile.ts";
import { promoteAllFragmentsPolicy, type PromotionPolicy } from "../../src/compiler/promotion.ts";

const legacyDcRelationPolicy: PromotionPolicy = {
  ...promoteAllFragmentsPolicy,
  canonicalizeRelationKind(kind) {
    if (kind !== "dc.relation:affiliated_with") {
      return { kind };
    }
    return {
      kind: "dc.relation:governs",
      finding: {
        kind: "warn",
        code: "test.relation_kind_deprecated",
        message: "legacy relation migrated by test policy",
      },
    };
  },
};

Deno.test("compile merges duplicate fragments into one baseline entry", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    promotionPolicy: promoteAllFragmentsPolicy,
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
    promotionPolicy: promoteAllFragmentsPolicy,
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
    promotionPolicy: promoteAllFragmentsPolicy,
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

Deno.test("compile resolves revision targets through identity aliases", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    promotionPolicy: promoteAllFragmentsPolicy,
    identityAliases: [{
      id: "dcgis-agency-1052",
      canonicalId: "dc.agency:executive-office-of-the-mayor",
      previousIds: ["dc.agency:1052"],
      sourceRefs: [cite("dcgis.agencies", "45")],
      kind: "dc.agency",
      name: "Executive Office of the Mayor",
      rationale: "migrated",
      evidence: [],
    }],
    fragments: [{
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "45",
      provisionalId: "dc.agency:executive-office-of-the-mayor",
      family: "organization",
      kind: "dc.agency",
      name: "Executive Office of the Mayor",
      attributes: { shortName: "EOM", sourceAgencyId: "1052" },
      citations: [cite("dcgis.agencies", "45")],
    }],
    revisions: [{
      id: "r1",
      source: "test",
      targetKind: "entry",
      targetId: "dc.agency:1052",
      target: {
        canonicalId: "dc.agency:executive-office-of-the-mayor",
        previousIds: ["dc.agency:1052"],
        sourceRefs: [cite("dcgis.agencies", "45")],
        kind: "dc.agency",
      },
      patch: { attributes: { reviewed: true } },
    }],
  });

  assertEquals(result.ok, true);
  assertEquals(
    result.state?.entries.get("dc.agency:executive-office-of-the-mayor")?.attributes.reviewed,
    true,
  );
});

Deno.test("compile resolves relation patch endpoints through identity aliases", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);
  registry.registerRelation(defineRelationKind({ kind: "dc.relation:governs" }));

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    promotionPolicy: promoteAllFragmentsPolicy,
    identityAliases: [{
      id: "dcgis-agency-1138",
      canonicalId: "dc.agency:board-of-ethics-and-government-accountability",
      previousIds: ["dc.agency:1138"],
      sourceRefs: [cite("dcgis.agencies", "118")],
      rationale: "migrated",
      evidence: [],
    }],
    fragments: [{
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "118",
      provisionalId: "dc.agency:board-of-ethics-and-government-accountability",
      family: "organization",
      kind: "dc.agency",
      name: "Board of Ethics and Government Accountability",
      attributes: { shortName: "BEGA", sourceAgencyId: "1138" },
      citations: [cite("dcgis.agencies", "118")],
    }, {
      fragmentType: "entry",
      source: "bega.structure",
      sourceRecordId: "office-of-government-ethics",
      provisionalId: "dc.agency:office-of-government-ethics",
      family: "organization",
      kind: "dc.agency",
      name: "Office of Government Ethics",
      attributes: { shortName: "OGE" },
      citations: [cite("bega.structure", "office-of-government-ethics")],
    }],
    revisions: [{
      id: "r1",
      source: "test",
      targetKind: "entry",
      targetId: "dc.agency:office-of-government-ethics",
      patch: {
        relations: {
          "dc.relation:governs": [{
            kind: "dc.relation:governs",
            to: "dc.agency:1138",
            citations: [cite("bega.structure", "office-of-government-ethics")],
          }],
        },
      },
    }],
  });

  assertEquals(result.ok, true);
  assertEquals(
    result.state?.entries.get("dc.agency:office-of-government-ethics")?.relations[
      "dc.relation:governs"
    ]?.[0].to,
    "dc.agency:board-of-ethics-and-government-accountability",
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
    promotionPolicy: promoteAllFragmentsPolicy,
    fragments: fragmentsA,
  });

  const second = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    promotionPolicy: promoteAllFragmentsPolicy,
    fragments: fragmentsB,
  });

  assertEquals(first.ok, true);
  assertEquals(second.ok, true);
  assertEquals(
    JSON.stringify(first.state?.entries),
    JSON.stringify(second.state?.entries),
  );
});

Deno.test("compile keeps review-required entry fragments out of baseline and state", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);
  registry.registerRelation(defineRelationKind({ kind: "dc.relation:governs" }));

  const promotionPolicy: PromotionPolicy = {
    decideEntryFragment(fragment) {
      if (fragment.source === "open_dc.public_bodies") {
        return {
          action: "review_required",
          code: "test.review_required",
          message: "Open DC fragment needs review",
          citation: fragment.citations[0],
        };
      }
      return { action: "promote" };
    },
  };

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    promotionPolicy,
    fragments: [{
      fragmentType: "entry",
      source: "dcgis.agencies",
      sourceRecordId: "row-1",
      provisionalId: "dc.agency:dpw",
      family: "organization",
      kind: "dc.agency",
      name: "Department of Public Works",
      attributes: { shortName: "DPW", sourceAgencyId: "dpw" },
      citations: [cite("dcgis.agencies", "row-1")],
    }, {
      fragmentType: "entry",
      source: "open_dc.public_bodies",
      sourceRecordId: "alice-deal-middle-school-lsat",
      provisionalId: "dc.agency:alice-deal-middle-school-lsat",
      family: "organization",
      kind: "dc.agency",
      name: "Alice Deal Middle School LSAT",
      attributes: { shortName: "Alice Deal Middle School LSAT" },
      citations: [cite("open_dc.public_bodies", "alice-deal-middle-school-lsat")],
    }, {
      fragmentType: "relation",
      source: "open_dc.public_bodies",
      sourceRecordId: "alice-deal-middle-school-lsat",
      from: "dc.agency:alice-deal-middle-school-lsat",
      relationKind: "dc.relation:governs",
      to: "dc.agency:dpw",
      citations: [cite("open_dc.public_bodies", "alice-deal-middle-school-lsat")],
    }],
  });

  assertEquals(result.ok, true);
  assertEquals(result.baseline.entries.has("dc.agency:dpw"), true);
  assertEquals(result.baseline.entries.has("dc.agency:alice-deal-middle-school-lsat"), false);
  assertEquals(result.state?.entries.has("dc.agency:alice-deal-middle-school-lsat"), false);
  assertEquals(
    result.findings.some((finding) => finding.code === "test.review_required"),
    true,
  );
  assertEquals(
    result.findings.some((finding) => finding.code === "compiler.relation_source_not_promoted"),
    true,
  );
});

Deno.test("compile blocks state when promotion policy returns conflict", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    promotionPolicy: {
      decideEntryFragment(fragment) {
        return {
          action: "conflict",
          code: "test.promotion_conflict",
          message: `cannot promote ${fragment.provisionalId}`,
        };
      },
    },
    fragments: [{
      fragmentType: "entry",
      source: "source",
      sourceRecordId: "row-1",
      provisionalId: "dc.agency:a-1",
      family: "organization",
      kind: "dc.agency",
      name: "Agency One",
      attributes: { shortName: "A1" },
      citations: [cite("source", "row-1")],
    }],
  });

  assertEquals(result.ok, false);
  assertEquals(result.state, null);
  assertEquals(
    result.conflicts.some((finding) => finding.code === "test.promotion_conflict"),
    true,
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
    promotionPolicy: promoteAllFragmentsPolicy,
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

Deno.test("compile does not migrate legacy DC relation kinds without policy", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);
  registry.registerRelation(defineRelationKind({ kind: "dc.relation:governs" }));

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    promotionPolicy: promoteAllFragmentsPolicy,
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
    promotionPolicy: legacyDcRelationPolicy,
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
    promotionPolicy: legacyDcRelationPolicy,
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

Deno.test("compile merges duplicate relation endpoints with combined citations", () => {
  const registry = new KindRegistry();
  registry.register(dcAgencyKind);
  registry.registerRelation(defineRelationKind({ kind: "dc.relation:governs" }));

  const result = compileFragments({
    jurisdiction: "dc",
    generatedAt: "2026-06-07T00:00:00.000Z",
    kindRegistry: registry,
    promotionPolicy: promoteAllFragmentsPolicy,
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
      source: "dcgis.boards",
      sourceRecordId: "board-1",
      from: "dc.agency:a-1",
      relationKind: "dc.relation:governs",
      to: "dc.agency:a-2",
      citations: [cite("dcgis.boards", "board-1")],
    }, {
      fragmentType: "relation",
      source: "open_dc.public_bodies",
      sourceRecordId: "board-one",
      from: "dc.agency:a-1",
      relationKind: "dc.relation:governs",
      to: "dc.agency:a-2",
      citations: [cite("open_dc.public_bodies", "board-one")],
    }],
  });

  assertEquals(result.ok, true);
  assertEquals(result.state?.entries.get("dc.agency:a-1")?.relations, {
    "dc.relation:governs": [{
      kind: "dc.relation:governs",
      to: "dc.agency:a-2",
      citations: [
        cite("dcgis.boards", "board-1"),
        cite("open_dc.public_bodies", "board-one"),
      ],
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
    promotionPolicy: promoteAllFragmentsPolicy,
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
    promotionPolicy: promoteAllFragmentsPolicy,
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
    promotionPolicy: promoteAllFragmentsPolicy,
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
    promotionPolicy: legacyDcRelationPolicy,
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
    promotionPolicy: promoteAllFragmentsPolicy,
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
