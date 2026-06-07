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
