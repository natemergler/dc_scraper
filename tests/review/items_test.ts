import { assertEquals } from "@std/assert";

import {
  cite,
  type Entry,
  type Finding,
  type LedgerState,
  type Revision,
} from "../../src/core/types.ts";
import {
  generateReviewItems,
  reviewItemBlocksCurrentOutput,
  reviewItemHasPublicOutputImpact,
  reviewQueueForItem,
} from "../../src/review/items.ts";
import { loadReviewItems, saveReviewItems } from "../../src/review/store.ts";

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

Deno.test("generateReviewItems turns reconciliation candidates into classified review items", () => {
  const items = generateReviewItems(
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

  assertEquals(items.length, 1);
  assertEquals(items[0].id, "same_normalized_name:executive-office-of-the-mayor");
  assertEquals(items[0].category, "kind_conflict");
  assertEquals(items[0].classification, "curation_conflict");
  assertEquals(items[0].suggestedResolutions.includes("preserve-distinct"), true);
  assertEquals(items[0].affected.stateIds, [
    "dc.agency:1052",
    "dc.office:executive-office-of-the-mayor",
  ]);
});

Deno.test("generateReviewItems marks items with matching tracked revisions as applied", () => {
  const revision: Revision = {
    id: "eom-preserve-distinct",
    source: "audited_revision",
    targetKind: "entry",
    targetId: "dc.office:executive-office-of-the-mayor",
    rationale: "Preserve office and agency facets.",
    evidence: [cite("mayor.executive_structure", "executive-office-of-the-mayor")],
    patch: {
      review: {
        decision: "preserve_distinct",
        relatedEntryIds: ["dc.agency:1052"],
      },
    },
  };

  const items = generateReviewItems(
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
    [],
    { trackedRevisions: [revision] },
  );

  const candidate = items.find((item) =>
    item.id === "same_normalized_name:executive-office-of-the-mayor"
  );
  assertEquals(candidate?.status, "applied");
  assertEquals(candidate?.trackedRevisionIds, ["eom-preserve-distinct"]);
});

Deno.test("generateReviewItems surfaces OANC slash profile versus DCGIS ANC suffix", () => {
  const items = generateReviewItems(
    state([
      entry({
        id: "dc.anc:6~2F8F",
        kind: "dc.anc",
        name: "ANC 6/8F",
        attributes: {
          sourceAncId: "6/8F",
          sourceOancProfileUrl: "https://oanc.dc.gov/anc-profile/anc-68f",
        },
        citations: [
          cite("oanc.profiles", "6/8F", {
            url: "https://oanc.dc.gov/anc-profile/anc-68f",
          }),
        ],
      }),
      entry({
        id: "dc.anc:8F",
        kind: "dc.anc",
        name: "ANC 8F",
        attributes: {
          sourceAncId: "8F",
        },
        citations: [cite("dcgis.ancs", "8F")],
      }),
    ]),
  );

  const item = items.find((candidate) => candidate.id === "anc_profile_boundary:6-8f:8f");
  assertEquals(item?.category, "identity_conflict");
  assertEquals(item?.classification, "curation_conflict");
  assertEquals(item?.suggestedResolutions.includes("alias"), true);
  assertEquals(item?.affected.stateIds, ["dc.anc:6~2F8F", "dc.anc:8F"]);
});

Deno.test("review item store round-trips workspace files", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-review-store-" });
  try {
    const items = generateReviewItems(
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

    await saveReviewItems(workspace, items);
    const loaded = await loadReviewItems(workspace);

    assertEquals(loaded.length, 1);
    assertEquals(loaded[0].id, "same_normalized_name:food-policy-council");
    assertEquals(loaded[0].category, "source_shadow");
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
});

Deno.test("finding review items preserve distinct source evidence", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-review-finding-store-" });
  try {
    const findings: Finding[] = [
      {
        kind: "warn",
        code: "dc.promotion.opendc_specific_public_body_promoted",
        message:
          "Open DC public body dc.board:29 promoted as dc.board; review may still be needed for identity reconciliation",
        citation: cite("open_dc.public_bodies", "board-accountancy"),
      },
      {
        kind: "warn",
        code: "dc.promotion.opendc_specific_public_body_promoted",
        message:
          "Open DC public body dc.board:29 promoted as dc.board; review may still be needed for identity reconciliation",
        citation: cite("open_dc.public_bodies", "board-accountancy-0"),
      },
    ];

    const items = generateReviewItems(state([]), findings);
    await saveReviewItems(workspace, items);
    const loaded = await loadReviewItems(workspace);

    assertEquals(loaded.length, 2);
    assertEquals(new Set(loaded.map((item) => item.id)).size, 2);
    assertEquals(
      loaded.map((item) =>
        "sourceRecordId" in item.citations[0] ? item.citations[0].sourceRecordId : ""
      ).sort(),
      ["board-accountancy", "board-accountancy-0"],
    );
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
});

Deno.test("relation not promoted findings stay classified as out of scope", () => {
  const findings: Finding[] = [
    {
      kind: "warn",
      code: "compiler.relation_source_not_promoted",
      message:
        "relation source entry was not promoted into baseline: dc.agency:adult-career-pathways-task-force; relation skipped",
      citation: cite("open_dc.public_bodies", "adult-career-pathways-task-force"),
    },
  ];

  const items = generateReviewItems(state([]), findings);

  assertEquals(items.length, 1);
  assertEquals(items[0].category, "out_of_scope_candidate");
  assertEquals(items[0].classification, "out_of_scope");
  assertEquals(items[0].suggestedResolutions, ["suppress"]);
  assertEquals(reviewQueueForItem(items[0]), "deferred");
  assertEquals(reviewItemHasPublicOutputImpact(items[0]), false);
  assertEquals(reviewItemBlocksCurrentOutput(items[0]), false);
});

Deno.test("review queues separate blocking, actionable, and deferred work", () => {
  const items = generateReviewItems(
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
      entry({
        id: "dc.board:abc-new",
        kind: "dc.board",
        name: "Alcoholic Beverage and Cannabis Board",
        citations: [cite("open_dc.public_bodies", "abc-new")],
      }),
      entry({
        id: "dc.board:abc-old",
        kind: "dc.board",
        name: "Alcoholic Beverage and Cannabis Board",
        citations: [cite("open_dc.public_bodies", "abc-old")],
      }),
    ]),
  );

  const kindConflict = items.find((item) =>
    item.id === "same_normalized_name:executive-office-of-the-mayor"
  );
  const sameSourceDuplicate = items.find((item) =>
    item.id === "same_normalized_name:alcoholic-beverage-and-cannabis-board"
  );

  assertEquals(kindConflict?.category, "kind_conflict");
  assertEquals(reviewQueueForItem(kindConflict!), "blocking");
  assertEquals(reviewItemHasPublicOutputImpact(kindConflict!), true);
  assertEquals(reviewItemBlocksCurrentOutput(kindConflict!), true);

  assertEquals(sameSourceDuplicate?.category, "same_source_duplicate");
  assertEquals(reviewQueueForItem(sameSourceDuplicate!), "actionable");
  assertEquals(reviewItemHasPublicOutputImpact(sameSourceDuplicate!), true);
  assertEquals(reviewItemBlocksCurrentOutput(sameSourceDuplicate!), false);
});
