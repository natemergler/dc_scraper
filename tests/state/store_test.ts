import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";

import { cite, type Entry, type LedgerState } from "../../src/core/types.ts";
import { defineEntryKind, defineRelationKind, KindRegistry } from "../../src/core/kinds.ts";
import { loadCommittedState, writeCommittedState } from "../../src/state/store.ts";

const makeAgencyKind = () =>
  defineEntryKind({
    kind: "dc.agency",
    family: "organization",
    attributes: {
      shortName: { required: true, type: "string" },
    },
  });

const buildAgency = (
  id: string,
  shortName: string,
  cites: Array<{ source: string; sourceRecordId: string }> = [],
): Entry => ({
  id,
  family: "organization",
  kind: "dc.agency",
  name: id,
  attributes: { shortName },
  citations: cites.map((citation) => cite(citation.source, citation.sourceRecordId)),
  relations: {},
});

Deno.test("loadCommittedState rejects entry files with unregistered kind", async () => {
  const registry = new KindRegistry();
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-state-bad-kind-" });
  const badEntryFile = `${stateRoot}/entries/dc.agency:alpha.json`;

  await Deno.mkdir(`${stateRoot}/entries`, { recursive: true });
  await Deno.writeTextFile(
    badEntryFile,
    JSON.stringify(
      {
        id: "dc.agency:alpha",
        family: "organization",
        kind: "dc.agency",
        name: "Alpha",
        attributes: { shortName: "Alpha" },
        citations: [cite("dcgis.agencies", "1")],
        relations: {},
      },
      null,
      2,
    ),
  );

  try {
    await assertRejects(
      async () => {
        await loadCommittedState(stateRoot, registry);
      },
      Error,
      "state validation failed",
    );
  } finally {
    await Deno.remove(stateRoot, { recursive: true });
  }
});

Deno.test("state writes are stable and deterministic", async () => {
  const registry = new KindRegistry();
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-state-stable-" });
  try {
    registry.register(makeAgencyKind());
    const entries = new Map<string, Entry>();
    entries.set(
      "dc.agency:b",
      buildAgency("dc.agency:b", "B", [{ source: "dcgis.agencies", sourceRecordId: "2" }]),
    );
    entries.set(
      "dc.agency:a",
      buildAgency("dc.agency:a", "A", [{ source: "dcgis.agencies", sourceRecordId: "1" }]),
    );

    const state: LedgerState = {
      jurisdiction: "dc",
      generatedAt: "",
      entries,
      findings: [],
    };
    await writeCommittedState(state, stateRoot);

    const fileText = await Deno.readTextFile(`${stateRoot}/entries/dc.agency:a.json`);
    const expected = `{
  "id": "dc.agency:a",
  "family": "organization",
  "kind": "dc.agency",
  "name": "dc.agency:a",
  "attributes": {
    "shortName": "A"
  },
  "citations": [
    {
      "source": "dcgis.agencies",
      "sourceRecordId": "1"
    }
  ],
  "relations": {}
}
`;
    assertEquals(fileText, expected);

    const fileText2 = await Deno.readTextFile(`${stateRoot}/entries/dc.agency:b.json`);
    assertStringIncludes(fileText2, '"id": "dc.agency:b"');
  } finally {
    await Deno.remove(stateRoot, { recursive: true });
  }
});

Deno.test("backlinks are generated from outgoing relations and not stored in files", async () => {
  const managesRelation = defineRelationKind({ kind: "dc.relation:manages" });
  const registry = new KindRegistry();
  registry.register(makeAgencyKind());
  registry.registerRelation(managesRelation);
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-state-backlinks-" });

  const state: LedgerState = {
    jurisdiction: "dc",
    generatedAt: "",
    entries: new Map<string, Entry>([
      ["dc.agency:a", {
        id: "dc.agency:a",
        family: "organization",
        kind: "dc.agency",
        name: "A",
        attributes: { shortName: "A" },
        citations: [cite("dcgis.agencies", "1")],
        relations: {
          "dc.relation:manages": [{
            kind: "dc.relation:manages",
            to: "dc.agency:b",
            citations: [cite("dcgis.agencies", "1")],
          }],
        },
      } as Entry],
      ["dc.agency:b", {
        id: "dc.agency:b",
        family: "organization",
        kind: "dc.agency",
        name: "B",
        attributes: { shortName: "B" },
        citations: [cite("dcgis.agencies", "2")],
        relations: {},
      } as Entry],
    ]),
    findings: [],
  };

  try {
    await writeCommittedState(state, stateRoot);
    const rawA = await Deno.readTextFile(`${stateRoot}/entries/dc.agency:a.json`);
  assertEquals(rawA.includes('"backlinks"'), false);

  const loaded = await loadCommittedState(stateRoot, registry);
  const backlinksForB = loaded.backlinks.get("dc.agency:b");
  assertEquals((backlinksForB ?? []).length, 1);
  assertEquals(backlinksForB?.[0].kind, "dc.relation:manages");
  assertEquals(backlinksForB?.[0].to, "dc.agency:a");
  } finally {
    await Deno.remove(stateRoot, { recursive: true });
  }
});

Deno.test("writeCommittedState removes stale committed entry files", async () => {
  const registry = new KindRegistry();
  registry.register(makeAgencyKind());
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-state-stale-" });

  try {
    await Deno.mkdir(`${stateRoot}/entries`, { recursive: true });
    await Deno.writeTextFile(
      `${stateRoot}/entries/dc.agency:orphan.json`,
      JSON.stringify(
        {
          id: "dc.agency:orphan",
          family: "organization",
          kind: "dc.agency",
          name: "Orphan",
          attributes: { shortName: "Orphan" },
          citations: [cite("dcgis.agencies", "1")],
          relations: {},
        },
        null,
        2,
      ),
    );

    const state: LedgerState = {
      jurisdiction: "dc",
      generatedAt: "",
      entries: new Map([
        ["dc.agency:active", {
          id: "dc.agency:active",
          family: "organization",
          kind: "dc.agency",
          name: "Active",
          attributes: { shortName: "Active" },
          citations: [cite("dcgis.agencies", "2")],
          relations: {},
        } as Entry],
      ]),
      findings: [],
    };

    await writeCommittedState(state, stateRoot);
    await assertRejects(
      async () => {
        await Deno.stat(`${stateRoot}/entries/dc.agency:orphan.json`);
      },
      Deno.errors.NotFound,
    );
    assertEquals(await loadCommittedState(stateRoot, registry).then((loaded) =>
      loaded.state.entries.has("dc.agency:active")
    ), true);
  } finally {
    await Deno.remove(stateRoot, { recursive: true });
  }
});

Deno.test("loadCommittedState rejects entries with unknown relation kinds", async () => {
  const registry = new KindRegistry();
  const managesRelation = defineRelationKind({ kind: "dc.relation:manages" });
  registry.register(makeAgencyKind());
  registry.registerRelation(managesRelation);
  const stateRoot = await Deno.makeTempDir({ prefix: "civic-ledger-state-unknown-relation-" });

  const badEntry = {
    id: "dc.agency:a-1",
    family: "organization",
    kind: "dc.agency",
    name: "A",
    attributes: { shortName: "A" },
    citations: [cite("dcgis.agencies", "row-1")],
    relations: {
      "dc.relation:manages": [{
        kind: "dc.relation:manages",
        to: "dc.agency:a-2",
        citations: [cite("dcgis.agencies", "row-1")],
      }],
    },
  };

  const goodEntry = {
    id: "dc.agency:a-2",
    family: "organization",
    kind: "dc.agency",
    name: "B",
    attributes: { shortName: "B" },
    citations: [cite("dcgis.agencies", "row-2")],
    relations: {
      "dc.relation:unknown": [{
        kind: "dc.relation:unknown",
        to: "dc.agency:a-1",
        citations: [cite("dcgis.agencies", "row-2")],
      }],
    },
  };

  try {
    await Deno.mkdir(`${stateRoot}/entries`, { recursive: true });
    await Deno.writeTextFile(
      `${stateRoot}/entries/dc.agency:a-1.json`,
      JSON.stringify(badEntry, null, 2),
    );
    await Deno.writeTextFile(
      `${stateRoot}/entries/dc.agency:a-2.json`,
      JSON.stringify(goodEntry, null, 2),
    );

    await assertRejects(
      async () => {
        await loadCommittedState(stateRoot, registry);
      },
      Error,
      "state validation failed",
    );
  } finally {
    await Deno.remove(stateRoot, { recursive: true });
  }
});
