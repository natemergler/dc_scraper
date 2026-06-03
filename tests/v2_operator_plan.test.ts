import { assertEquals, assertStringIncludes } from "@std/assert";
import { unresolvedStateNote } from "../src/v2/operator_plan.ts";

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
