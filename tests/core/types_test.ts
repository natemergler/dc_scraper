import { assert, assertEquals } from "@std/assert";

import { cite, type Entry, isCitationValue, uncited } from "../../src/core/types.ts";
import {
  defineEntryKind,
  defineRelationKind,
  EntryFromKind,
  KindRegistry,
} from "../../src/core/kinds.ts";
import { validateStateEntries } from "../../src/state/validation.ts";

Deno.test("registered kind validates entry", () => {
  const registry = new KindRegistry();
  const kind = defineEntryKind({
    kind: "dc.agency",
    family: "organization",
    attributes: {
      shortName: { required: true, type: "string" },
    },
  });

  registry.register(kind);

  const entry: EntryFromKind<typeof kind> = {
    id: "dc.agency:dept-of-energy",
    family: "organization",
    kind: "dc.agency",
    name: "Department of Energy",
    attributes: {
      shortName: "DOE",
    },
    citations: [cite("dcgis.agencies", "row-1")],
    relations: {},
  };

  const result = registry.validateEntry(entry);
  assert(result.ok);
  assertEquals(result.issues.length, 0);
});

Deno.test("unknown kind fails", () => {
  const registry = new KindRegistry();
  const entry = {
    id: "x:1",
    family: "organization",
    kind: "missing.kind",
    name: "Missing",
    attributes: {},
    citations: [cite("dcgis.agencies", "row-1")],
    relations: {},
  };

  const result = registry.validateEntry(entry);
  assert(!result.ok);
  assertEquals(result.issues.some((issue) => issue.code === "entry.kind_unknown"), true);
});

Deno.test("required attribute fails", () => {
  const registry = new KindRegistry();
  const kind = defineEntryKind({
    kind: "dc.agency",
    family: "organization",
    attributes: {
      shortName: { required: true, type: "string" },
    },
  });

  registry.register(kind);

  const entry = {
    id: "dc.agency:dept-of-energy",
    family: "organization",
    kind: "dc.agency",
    name: "Department of Energy",
    attributes: {},
    citations: [cite("dcgis.agencies", "row-1")],
    relations: {},
  };

  const result = registry.validateEntry(entry);
  assert(!result.ok);
  assertEquals(result.issues.some((issue) => issue.code === "entry.attribute_missing"), true);
});

Deno.test("non-object attributes report clean issue", () => {
  const registry = new KindRegistry();
  const kind = defineEntryKind({
    kind: "dc.agency",
    family: "organization",
    attributes: {
      shortName: { required: true, type: "string" },
    },
  });

  registry.register(kind);

  const entry = {
    id: "dc.agency:dept-of-energy",
    family: "organization",
    kind: "dc.agency",
    name: "Department of Energy",
    attributes: null as unknown as Record<string, unknown>,
    citations: [cite("dcgis.agencies", "row-1")],
    relations: {},
  } as unknown as Entry;

  const result = registry.validateEntry(entry);
  assert(!result.ok);
  assertEquals(result.issues.some((issue) => issue.code === "entry.attributes_missing"), true);
});

Deno.test("relation to missing entry fails in state validation", () => {
  const registry = new KindRegistry();
  const kind = defineEntryKind({
    kind: "dc.agency",
    family: "organization",
    attributes: {
      shortName: { required: true, type: "string" },
    },
  });

  registry.register(kind);

  const state = new Map<string, Entry>(
    [
      ["dc.agency:a", {
        id: "dc.agency:a",
        family: "organization",
        kind: "dc.agency",
        name: "Agency A",
        attributes: { shortName: "A" },
        citations: [cite("dcgis.agencies", "row-a")],
        relations: {
          governance: [{
            kind: "dc.rel:supervises",
            to: "dc.agency:missing",
            citations: [cite("dcgis.agencies", "row-a")],
          }],
        },
      }],
      ["dc.agency:b", {
        id: "dc.agency:b",
        family: "organization",
        kind: "dc.agency",
        name: "Agency B",
        attributes: { shortName: "B" },
        citations: [cite("dcgis.agencies", "row-b")],
        relations: {},
      }],
    ],
  );

  const result = validateStateEntries(state, registry);
  assert(!result.ok);
  assertEquals(result.issues.some((issue) => issue.code === "relation.target_missing"), true);
});

Deno.test("relation kind unknown fails when relation kinds are defined", () => {
  const registry = new KindRegistry();
  const kind = defineEntryKind({
    kind: "dc.agency",
    family: "organization",
    attributes: {
      shortName: { required: true, type: "string" },
    },
  });
  registry.register(kind);
  registry.registerRelation(defineRelationKind({ kind: "dc.relation:affiliated_with" }));

  const entry: Entry = {
    id: "dc.agency:a",
    family: "organization",
    kind: "dc.agency",
    name: "Agency A",
    attributes: { shortName: "A" },
    citations: [cite("dcgis.agencies", "row-a")],
    relations: {
      "dc.relation:unknown": [{
        kind: "dc.relation:unknown",
        to: "dc.agency:a",
        citations: [cite("dcgis.agencies", "row-a")],
      }],
    },
  };

  const result = registry.validateEntry(entry);
  assert(!result.ok);
  assertEquals(result.issues.some((issue) => issue.code === "entry.relation_kind_unknown"), true);
});

Deno.test("relation facet must match relation kind", () => {
  const registry = new KindRegistry();
  const kind = defineEntryKind({
    kind: "dc.agency",
    family: "organization",
    attributes: {
      shortName: { required: true, type: "string" },
    },
  });
  registry.register(kind);
  registry.registerRelation(defineRelationKind({ kind: "dc.relation:affiliated_with" }));

  const entry: Entry = {
    id: "dc.agency:a",
    family: "organization",
    kind: "dc.agency",
    name: "Agency A",
    attributes: { shortName: "A" },
    citations: [cite("dcgis.agencies", "row-a")],
    relations: {
      "dc.relation:wrong": [{
        kind: "dc.relation:affiliated_with",
        to: "dc.agency:a",
        citations: [cite("dcgis.agencies", "row-a")],
      }],
    },
  };

  const result = registry.validateEntry(entry);
  assert(!result.ok);
  assertEquals(result.issues.some((issue) => issue.code === "entry.relation_facet_mismatch"), true);
});

Deno.test("cite(...) shape validates", () => {
  assert(isCitationValue(cite("dcgis.agencies", "row-1", {
    locator: "row/1",
    url: "https://example.com",
  })));
});

Deno.test("uncited(...) marker validates", () => {
  assert(isCitationValue(uncited("Not sourced yet")));
});
