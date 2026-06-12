import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";

import { cite, type Entry, type LedgerState } from "../../src/core/types.ts";
import {
  createDraftRevision,
  loadDraftRevisions,
  writeDraftRevision,
} from "../../src/revisions/drafts.ts";
import { generateReviewItems } from "../../src/review/items.ts";

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "kind" | "name">): Entry {
  return {
    id: overrides.id,
    family: overrides.family ?? "organization",
    kind: overrides.kind,
    name: overrides.name,
    attributes: overrides.attributes ?? {},
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

Deno.test("createDraftRevision builds preserve-distinct review revisions", () => {
  const [item] = generateReviewItems(
    state([
      entry({
        id: "dc.agency:1052",
        kind: "dc.agency",
        name: "Executive Office of the Mayor",
        citations: [cite("dcgis.agencies", "45")],
      }),
      entry({
        id: "dc.office:executive-office-of-the-mayor",
        kind: "dc.office",
        name: "Executive Office of the Mayor",
        citations: [cite("mayor.executive_structure", "executive-office-of-the-mayor")],
      }),
    ]),
  );

  const draft = createDraftRevision(item, {
    decisionType: "preserve-distinct",
    targetId: "dc.office:executive-office-of-the-mayor",
  });

  assertEquals(draft.status, "draft");
  assertEquals(draft.sourceReviewItemId, item.id);
  assertEquals(draft.targetId, "dc.office:executive-office-of-the-mayor");
  assertEquals(draft.patch.review, {
    decision: "preserve_distinct",
    relatedEntryIds: ["dc.agency:1052"],
  });
});

Deno.test("createDraftRevision builds source-shadow suppression revisions", () => {
  const [item] = generateReviewItems(
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
  );

  const draft = createDraftRevision(item, {
    decisionType: "source-shadow",
    targetId: "dc.council:19",
  });

  assertEquals(draft.targetId, "dc.council:food-policy-council");
  assertEquals(draft.relatedIds, ["dc.council:19"]);
  assertEquals(draft.patch.suppress, true);
  assertEquals(draft.patch.review, {
    decision: "source_shadow",
    canonicalEntryId: "dc.council:19",
  });
});

Deno.test("draft revision store validates draft shape", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-draft-store-" });
  try {
    const [item] = generateReviewItems(
      state([
        entry({
          id: "dc.agency:a",
          kind: "dc.agency",
          name: "Agency A",
          citations: [cite("dcgis.agencies", "a")],
        }),
        entry({
          id: "dc.board:a",
          kind: "dc.board",
          name: "Agency A",
          citations: [cite("dcgis.boards", "a")],
        }),
      ]),
    );
    const draft = createDraftRevision(item, { decisionType: "suppress" });

    await writeDraftRevision(workspace, draft);
    const loaded = await loadDraftRevisions(workspace);

    assertEquals(loaded.length, 1);
    assertEquals(loaded[0].id, draft.id);
    assertEquals(loaded[0].sourceReviewItemId, item.id);

    await Deno.writeTextFile(
      join(workspace, "draft-revisions", "bad.json"),
      JSON.stringify({
        id: "bad",
        source: "review_cli",
        targetKind: "entry",
        targetId: "dc.agency:a",
        status: "pending",
        sourceReviewItemId: item.id,
        decisionType: "suppress",
        generatedBy: "review CLI",
        relatedIds: [],
        targetSelector: { sourceRefs: [] },
        rationale: "bad status",
        patch: { suppress: true },
      }),
    );

    await assertRejects(
      () => loadDraftRevisions(workspace),
      Error,
      "status must be draft",
    );
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
});
