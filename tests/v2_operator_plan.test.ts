import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildOperatorPlan, unresolvedStateNote } from "../src/v2/operator_plan.ts";
import { connectors } from "../src/v2/connectors.ts";

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
    fetchedSources: connectors.length - 1,
    failedSourceId: "council.committees",
    openReviewItemCount: 1,
    deferredReviewItemCount: 0,
    staleReviewItemCount: 0,
    blockedReconciliationCount: 1,
    placeholderEntityCount: 0,
  });

  assertEquals(plan.nextCommand, "deno task dc -- source inspect council.committees");
});

Deno.test("operator plan falls back through review, audit, source list, and release build", () => {
  assertEquals(
    buildOperatorPlan({
      fetchedSources: connectors.length,
      openReviewItemCount: 1,
      deferredReviewItemCount: 0,
      staleReviewItemCount: 0,
      blockedReconciliationCount: 0,
      placeholderEntityCount: 0,
    }).nextCommand,
    "deno task dc -- review",
  );

  assertEquals(
    buildOperatorPlan({
      fetchedSources: connectors.length,
      openReviewItemCount: 0,
      deferredReviewItemCount: 0,
      staleReviewItemCount: 0,
      blockedReconciliationCount: 1,
      placeholderEntityCount: 0,
    }).nextCommand,
    "deno task dc -- audit",
  );

  assertEquals(
    buildOperatorPlan({
      fetchedSources: connectors.length - 1,
      openReviewItemCount: 2,
      humanDecisionOpenReviewItemCount: 0,
      browseOnlyOpenReviewItemCount: 2,
      deferredReviewItemCount: 0,
      staleReviewItemCount: 0,
      blockedReconciliationCount: 0,
      placeholderEntityCount: 0,
    }).nextCommand,
    "deno task dc -- source list",
  );

  assertEquals(
    buildOperatorPlan({
      fetchedSources: connectors.length - 1,
      openReviewItemCount: 0,
      deferredReviewItemCount: 0,
      staleReviewItemCount: 0,
      blockedReconciliationCount: 0,
      placeholderEntityCount: 0,
    }).nextCommand,
    "deno task dc -- source list",
  );

  assertEquals(
    buildOperatorPlan({
      fetchedSources: connectors.length,
      openReviewItemCount: 0,
      deferredReviewItemCount: 0,
      staleReviewItemCount: 0,
      blockedReconciliationCount: 0,
      placeholderEntityCount: 0,
    }).nextCommand,
    "deno task dc -- release build",
  );
});
