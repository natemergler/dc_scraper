import { assertEquals } from "@std/assert";
import { join } from "@std/path";

import {
  cite,
  type Entry,
  type Finding,
  type LedgerState,
  type Revision,
} from "../../src/core/types.ts";
import {
  generateReviewItems,
  type ReviewCategory,
  reviewCategoryDescriptions,
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

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

function preserveDistinctRevision(
  id: string,
  targetId: string,
  relatedEntryId: string,
  rationale: string,
): Revision {
  return {
    id,
    source: "audited_revision",
    targetKind: "entry",
    targetId,
    rationale,
    evidence: [],
    patch: {
      review: {
        decision: "preserve_distinct",
        relatedEntryIds: [relatedEntryId],
      },
    },
  };
}

Deno.test("review category descriptions cover every review category", () => {
  const categories: ReviewCategory[] = [
    "alias_candidate",
    "identity_conflict",
    "incomplete_entry",
    "kind_conflict",
    "legal_authority_ambiguous",
    "out_of_scope_candidate",
    "preserve_distinct_candidate",
    "relation_endpoint_missing",
    "same_source_duplicate",
    "source_shadow",
    "source_stale_or_failed",
  ];

  assertEquals(Object.keys(reviewCategoryDescriptions).sort(), categories.sort());
  assertEquals(
    reviewCategoryDescriptions.source_stale_or_failed.includes("ingestion bug"),
    true,
  );
  assertEquals(
    reviewCategoryDescriptions.out_of_scope_candidate.includes("outside current release scope"),
    true,
  );
});

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
  assertEquals(candidate?.blocks.stateGeneration, false);
  assertEquals(candidate?.blocks.releaseReadiness, false);
  assertEquals(reviewItemBlocksCurrentOutput(candidate!), false);
});

Deno.test("generateReviewItems annotates preserve-distinct decisions superseded by suppression", () => {
  const preserveRevision = preserveDistinctRevision(
    "eom-preserve-distinct",
    "dc.office:executive-office-of-the-mayor",
    "dc.agency:1052",
    "Preserve office and agency facets.",
  );
  const suppressRevision: Revision = {
    id: "eom-agency-source-shadow",
    source: "audited_revision",
    targetKind: "entry",
    targetId: "dc.agency:1052",
    rationale: "Later audit found the agency row is a source shadow of the office row.",
    evidence: [],
    patch: {
      suppress: true,
      review: {
        decision: "source_shadow",
        canonicalEntryId: "dc.office:executive-office-of-the-mayor",
      },
    },
  };

  const items = generateReviewItems(
    state([
      entry({
        id: "dc.office:executive-office-of-the-mayor",
        kind: "dc.office",
        name: "Executive Office of the Mayor",
      }),
    ]),
    [],
    { trackedRevisions: [preserveRevision, suppressRevision] },
  );

  const preserveItem = items.find((item) => item.id === "tracked_revision:eom-preserve-distinct");

  assertEquals(preserveItem?.status, "applied");
  assertEquals(preserveItem?.category, "preserve_distinct_candidate");
  assertEquals(preserveItem?.summary.includes("Superseded by later suppression"), true);
  assertEquals(
    preserveItem?.rationale.includes("retained as audit history rather than current publication"),
    true,
  );
  assertEquals(preserveItem?.trackedRevisionIds, [
    "eom-agency-source-shadow",
    "eom-preserve-distinct",
  ]);
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

Deno.test("review item store serializes concurrent saves", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "civic-ledger-review-store-concurrent-" });
  try {
    const firstBatch = generateReviewItems(
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
    const secondBatch = generateReviewItems(
      state([
        entry({
          id: "dc.board:abc-board",
          kind: "dc.board",
          name: "ABC Board",
          citations: [cite("dcgis.boards", "abc")],
        }),
        entry({
          id: "dc.commission:abc-board",
          kind: "dc.commission",
          name: "ABC Board",
          citations: [cite("open_dc.public_bodies", "abc")],
        }),
      ]),
    );

    await Promise.all([
      saveReviewItems(workspace, firstBatch),
      saveReviewItems(workspace, secondBatch),
    ]);
    const loaded = await loadReviewItems(workspace);

    const loadedIds = loaded.map((item) => item.id).sort();
    const firstIds = firstBatch.map((item) => item.id).sort();
    const secondIds = secondBatch.map((item) => item.id).sort();
    assertEquals(
      JSON.stringify(loadedIds) === JSON.stringify(firstIds) ||
        JSON.stringify(loadedIds) === JSON.stringify(secondIds),
      true,
    );
    assertEquals(await exists(join(workspace, "review-items", ".review-items.lock")), false);
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
        code: "dc.promotion.opendc_public_body_review_required",
        message:
          "Open DC public body dc.agency:adult-career-pathways-task-force was not promoted because dc.agency is not a safe Open DC promotion kind",
        citation: cite("open_dc.public_bodies", "board-accountancy"),
      },
      {
        kind: "warn",
        code: "dc.promotion.opendc_public_body_review_required",
        message:
          "Open DC public body dc.agency:adult-career-pathways-task-force was not promoted because dc.agency is not a safe Open DC promotion kind",
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

Deno.test("successful Open DC public-body promotion findings stay out of the review queue", () => {
  const findings: Finding[] = [
    {
      kind: "warn",
      code: "dc.promotion.opendc_specific_public_body_promoted",
      message:
        "Open DC public body dc.board:29 promoted as dc.board; review may still be needed for identity reconciliation",
      citation: cite("open_dc.public_bodies", "board-accountancy"),
    },
  ];

  assertEquals(generateReviewItems(state([]), findings), []);
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
  assertEquals(items[0].blocks.releaseReadiness, false);
  assertEquals(reviewQueueForItem(items[0]), "deferred");
  assertEquals(reviewItemHasPublicOutputImpact(items[0]), false);
  assertEquals(reviewItemBlocksCurrentOutput(items[0]), false);
});

Deno.test("Open DC stale duplicate findings stay out of the review queue", () => {
  const findings: Finding[] = [
    {
      kind: "info",
      code: "dc.interpreter.opendc_stale_or_failed_duplicate",
      message:
        "Open DC public body stale-old appears to be a stale or failed duplicate of current-new; entry fragment suppressed",
      citation: cite("open_dc.public_bodies", "stale-old"),
    },
  ];

  const items = generateReviewItems(state([]), findings);

  assertEquals(items, []);
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

Deno.test("Open DC weak duplicate slugs are classified separately from generic same-source duplicates", () => {
  const items = generateReviewItems(
    state([
      entry({
        id: "dc.board:alcoholic-beverage-and-cannabis-board-abc-board",
        kind: "dc.board",
        name: "Alcoholic Beverage and Cannabis Board (ABC Board)",
        attributes: {
          enablingStatute: "DC Code § 25-201",
          sourceOpenDcSlug: "alcoholic-beverage-and-cannabis-board-abc-board",
          sourceOpenDcUrl:
            "https://www.open-dc.gov/public-bodies/alcoholic-beverage-and-cannabis-board-abc-board",
        },
        citations: [
          cite("open_dc.public_bodies", "alcoholic-beverage-and-cannabis-board-abc-board"),
        ],
        relations: {
          "dc.relation:authorized_by": [{
            kind: "dc.relation:authorized_by",
            to: "dc.legal_authority:d-c-code-25-201",
            citations: [
              cite("open_dc.public_bodies", "alcoholic-beverage-and-cannabis-board-abc-board", {
                locator: "D.C. Code § 25-201",
              }),
            ],
          }],
        },
      }),
      entry({
        id: "dc.board:alcoholic-beverage-control-board-abc-board",
        kind: "dc.board",
        name: "Alcoholic Beverage and Cannabis Board (ABC Board)",
        attributes: {
          sourceOpenDcSlug: "alcoholic-beverage-control-board-abc-board",
          sourceOpenDcUrl:
            "https://www.open-dc.gov/public-bodies/alcoholic-beverage-control-board-abc-board",
        },
        citations: [cite("open_dc.public_bodies", "alcoholic-beverage-control-board-abc-board")],
      }),
    ]),
  );

  const item = items.find((candidate) =>
    candidate.id === "same_normalized_name:alcoholic-beverage-and-cannabis-board-abc-board"
  );

  assertEquals(item?.category, "source_stale_or_failed");
  assertEquals(item?.classification, "source_ingestion_bug");
  assertEquals(item?.severity, "low");
  assertEquals(item?.sourceFamilies, ["open_dc"]);
  assertEquals(item?.suggestedResolutions, ["suppress", "source-shadow"]);
  assertEquals(item?.blocks.releaseReadiness, false);
  assertEquals(reviewQueueForItem(item!), "deferred");
  assertEquals(reviewItemBlocksCurrentOutput(item!), false);
});

Deno.test("agency and Open DC public-body source facets stay applied preserve-distinct QA items", () => {
  const entries = [
    entry({
      id: "dc.agency:board-of-elections",
      kind: "dc.agency",
      name: "Board of Elections",
      citations: [cite("dcgis.agencies", "BOE")],
      attributes: { officialUrl: "https://www.dcboe.org/" },
    }),
    entry({
      id: "dc.board:board-elections",
      kind: "dc.board",
      name: "Board of Elections",
      citations: [cite("open_dc.public_bodies", "board-elections")],
      relations: {
        "dc.relation:authorized_by": [{
          kind: "dc.relation:authorized_by",
          to: "dc.legal_authority:d-c-code-1-1001-03",
          citations: [
            cite("open_dc.public_bodies", "board-elections", {
              locator: "D.C. Code § 1-1001.03",
            }),
          ],
        }],
      },
    }),
    entry({
      id: "dc.agency:commission-on-the-arts-and-humanities",
      kind: "dc.agency",
      name: "Commission on the Arts and Humanities",
      citations: [cite("dcgis.agencies", "CAH")],
      attributes: { officialUrl: "https://dcarts.dc.gov/" },
    }),
    entry({
      id: "dc.commission:commission-arts-and-humanities",
      kind: "dc.commission",
      name: "Commission on the Arts and Humanities",
      citations: [cite("open_dc.public_bodies", "commission-arts-and-humanities")],
      relations: {
        "dc.relation:authorized_by": [{
          kind: "dc.relation:authorized_by",
          to: "dc.legal_authority:d-c-code-39-201",
          citations: [
            cite("open_dc.public_bodies", "commission-arts-and-humanities", {
              locator: "D.C. Code § 39-201",
            }),
          ],
        }],
      },
    }),
    entry({
      id: "dc.agency:criminal-justice-coordinating-council",
      kind: "dc.agency",
      name: "Criminal Justice Coordinating Council",
      citations: [cite("dcgis.agencies", "CJCC")],
      attributes: { officialUrl: "https://cjcc.dc.gov/" },
    }),
    entry({
      id: "dc.council:21",
      kind: "dc.council",
      name: "Criminal Justice Coordinating Council",
      citations: [cite("open_dc.public_bodies", "criminal-justice-coordinating-council-cjcc")],
      relations: {
        "dc.relation:authorized_by": [{
          kind: "dc.relation:authorized_by",
          to: "dc.legal_authority:d-c-code-22-4232",
          citations: [
            cite("open_dc.public_bodies", "criminal-justice-coordinating-council-cjcc", {
              locator: "D.C. Code § 22-4232",
            }),
          ],
        }],
      },
    }),
  ];

  const revisions = [
    preserveDistinctRevision(
      "boe-source-facet-preserve-distinct",
      "dc.board:board-elections",
      "dc.agency:board-of-elections",
      "Preserve Board of Elections agency and public-body facets.",
    ),
    preserveDistinctRevision(
      "cah-source-facet-preserve-distinct",
      "dc.commission:commission-arts-and-humanities",
      "dc.agency:commission-on-the-arts-and-humanities",
      "Preserve CAH agency and public-body facets.",
    ),
    preserveDistinctRevision(
      "cjcc-source-facet-preserve-distinct",
      "dc.council:21",
      "dc.agency:criminal-justice-coordinating-council",
      "Preserve CJCC agency and public-body facets.",
    ),
  ];

  const items = generateReviewItems(state(entries), [], { trackedRevisions: revisions });

  for (
    const [itemId, revisionId, expectedLocator] of [
      [
        "same_normalized_name:board-of-elections",
        "boe-source-facet-preserve-distinct",
        "D.C. Code § 1-1001.03",
      ],
      [
        "same_normalized_name:commission-on-the-arts-and-humanities",
        "cah-source-facet-preserve-distinct",
        "D.C. Code § 39-201",
      ],
      [
        "same_normalized_name:criminal-justice-coordinating-council",
        "cjcc-source-facet-preserve-distinct",
        "D.C. Code § 22-4232",
      ],
    ] as const
  ) {
    const item = items.find((candidate) => candidate.id === itemId)!;

    assertEquals(item.category, "kind_conflict");
    assertEquals(item.classification, "curation_conflict");
    assertEquals(item.status, "applied");
    assertEquals(item.trackedRevisionIds, [revisionId]);
    assertEquals(item.sourceFamilies, ["dcgis", "open_dc"]);
    assertEquals(item.legalLocators, [expectedLocator]);
    assertEquals(item.suggestedResolutions.includes("preserve-distinct"), true);
    assertEquals(reviewQueueForItem(item), "applied");
    assertEquals(reviewItemBlocksCurrentOutput(item), false);
  }
});

Deno.test("broad shared agency directory URL is deferred, not treated as fully applied", () => {
  const item = {
    id: "shared_url:https-dc-gov-page-agency-list",
    category: "source_shadow",
    classification: "curation_conflict",
    severity: "high",
    confidence: "low",
    status: "open",
    title: "source shadow: https://dc.gov/page/agency-list",
    summary: "shared_url matched many agency entries",
    sourceFamilies: ["dcgis", "mayor"],
    affected: {
      fragmentIds: [],
      baselineIds: [],
      stateIds: Array.from({ length: 12 }, (_, index) => `dc.agency:agency-${index + 1}`),
      relationEndpoints: [],
    },
    candidateEntries: [],
    sourceRefs: [],
    citations: [],
    urls: ["https://dc.gov/page/agency-list"],
    legalLocators: [],
    attributesThatAgree: {},
    attributesThatConflict: {},
    suggestedResolutions: ["source-shadow"],
    blocks: {
      stateGeneration: false,
      releaseReadiness: false,
    },
    draftRevisionIds: [],
    trackedRevisionIds: ["agency-1-row-level-review"],
    rationale: "fixture",
    generatedAt: "2026-06-16T00:00:00.000Z",
    source: {
      type: "reconciliation_candidate",
      id: "shared_url:https-dc-gov-page-agency-list",
      reason: "shared_url",
    },
  } satisfies ReturnType<typeof generateReviewItems>[number];

  assertEquals(reviewQueueForItem(item), "deferred");
  assertEquals(reviewItemBlocksCurrentOutput(item), false);
});
