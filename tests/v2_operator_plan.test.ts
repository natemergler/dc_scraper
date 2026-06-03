import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildOperatorPlan, unresolvedStateNote } from "../src/v2/operator_plan.ts";
import type { ReviewItemRecord } from "../src/v2/domain.ts";
import type { Workbench } from "../src/v2/workbench.ts";

Deno.test("unresolved state note is explicit when the workbench is ready", () => {
  assertEquals(
    unresolvedStateNote({
      openReviewItemCount: 0,
      deferredReviewItemCount: 0,
      staleReviewItemCount: 0,
      blockedReconciliationCount: 0,
      placeholderEntityCount: 0,
    }),
    "No open review items, deferred review items, stale review items, blocked reconciliation items, or placeholder entities were present.",
  );
});

Deno.test("unresolved state note reports every operator workload count", () => {
  const note = unresolvedStateNote({
    openReviewItemCount: 2,
    deferredReviewItemCount: 3,
    staleReviewItemCount: 4,
    blockedReconciliationCount: 5,
    placeholderEntityCount: 6,
  });

  assertStringIncludes(note, "open review=2");
  assertStringIncludes(note, "deferred review=3");
  assertStringIncludes(note, "stale review=4");
  assertStringIncludes(note, "blocked reconciliation=5");
  assertStringIncludes(note, "placeholder entities=6");
});

Deno.test("operator plan sends source failures to source inspection before review work", () => {
  const plan = buildOperatorPlan({
    workbench: fakeWorkbench([safeEntityReviewItem("candidate.council.committees.safe")]),
    fetchedSources: 15,
    failedSourceId: "council.committees",
    openReviewItemCount: 1,
    deferredReviewItemCount: 0,
    staleReviewItemCount: 0,
    blockedReconciliationCount: 1,
    placeholderEntityCount: 0,
  });

  assertEquals(plan.nextCommand, "deno task dc -- source inspect council.committees");
});

Deno.test("operator plan suggests the largest explicit safe entity batch before generic review", () => {
  const plan = buildOperatorPlan({
    workbench: fakeWorkbench([
      safeEntityReviewItem("candidate.dcgis.agencies.one"),
      safeEntityReviewItem("candidate.council.committees.one"),
      safeEntityReviewItem("candidate.council.committees.two"),
    ]),
    fetchedSources: 16,
    openReviewItemCount: 3,
    deferredReviewItemCount: 0,
    staleReviewItemCount: 0,
    blockedReconciliationCount: 0,
    placeholderEntityCount: 0,
  });

  assertEquals(
    plan.nextCommand,
    "deno task dc -- review batch accept-safe --mode entities --subject-prefix candidate.council.committees",
  );
});

function fakeWorkbench(items: ReviewItemRecord[]): Workbench {
  return {
    reviewDebtSummary() {
      const counts = new Map<string, number>();
      for (const item of items) {
        const sourceId = item.subjectId.startsWith("candidate.council.committees.")
          ? "council.committees"
          : item.subjectId.startsWith("candidate.dcgis.agencies.")
          ? "dcgis.agencies"
          : "unknown";
        counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1);
      }
      return {
        byType: [],
        bySource: Array.from(counts, ([sourceId, openCount]) => ({
          sourceId,
          openCount,
          deferredCount: 0,
        })),
      };
    },
    listReviewItems(filters?: { subjectPrefix?: string }) {
      if (!filters?.subjectPrefix) return items;
      return items.filter((item) => item.subjectId.startsWith(filters.subjectPrefix!));
    },
  } as unknown as Workbench;
}

function safeEntityReviewItem(subjectId: string): ReviewItemRecord {
  return {
    reviewItemId: `${subjectId}.review`,
    itemType: "entity_candidate",
    subjectId,
    reason: "Review safe entity candidate",
    defaultAction: "accept",
    status: "open",
    details: {
      safeToAutoAccept: true,
    },
  };
}
