import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildOperatorPlan,
  type ReviewPacketCommandSuggester,
  unresolvedStateNote,
} from "../src/v2/operator_plan.ts";
import { connectors } from "../src/v2/connectors.ts";
import type { ReviewItemRecord } from "../src/v2/domain.ts";

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
    suggestReviewPacketCommand: noPacketCommand,
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

Deno.test("operator plan suggests the largest explicit safe entity batch before generic review", () => {
  const plan = buildOperatorPlan({
    suggestReviewPacketCommand: packetCommand({
      "entities:accept-safe:explicit-safe":
        "deno task dc -- review batch accept-safe --mode entities --subject-prefix candidate.council.committees",
      "relationships:accept-safe":
        "deno task dc -- review batch accept-safe --mode relationships --subject-prefix relationship.dcgis.agencies --relationship-type administered_by",
    }),
    fetchedSources: connectors.length,
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

Deno.test("operator plan suggests the largest safe relationship batch before defer work", () => {
  const plan = buildOperatorPlan({
    suggestReviewPacketCommand: packetCommand({
      "relationships:accept-safe":
        "deno task dc -- review batch accept-safe --mode relationships --subject-prefix relationship.dcgis.agencies --relationship-type administered_by",
    }),
    fetchedSources: connectors.length,
    openReviewItemCount: 4,
    deferredReviewItemCount: 0,
    staleReviewItemCount: 0,
    blockedReconciliationCount: 0,
    placeholderEntityCount: 0,
  });

  assertEquals(
    plan.nextCommand,
    "deno task dc -- review batch accept-safe --mode relationships --subject-prefix relationship.dcgis.agencies --relationship-type administered_by",
  );
});

Deno.test("operator plan suggests scoped default-defer relationship batches before generic review", () => {
  const plan = buildOperatorPlan({
    suggestReviewPacketCommand: packetCommand({
      "relationships:defer-default":
        "deno task dc -- review batch defer-default --mode relationships --subject-prefix relationship.council.committees --relationship-type overseen_by",
    }),
    fetchedSources: connectors.length,
    openReviewItemCount: 2,
    deferredReviewItemCount: 0,
    staleReviewItemCount: 0,
    blockedReconciliationCount: 0,
    placeholderEntityCount: 0,
  });

  assertEquals(
    plan.nextCommand,
    "deno task dc -- review batch defer-default --mode relationships --subject-prefix relationship.council.committees --relationship-type overseen_by",
  );
});

Deno.test("operator plan suggests scoped default-defer legal refs before generic review", () => {
  const plan = buildOperatorPlan({
    suggestReviewPacketCommand: packetCommand({
      "legal:defer-default":
        "deno task dc -- review batch defer-default --mode legal --subject-prefix legal.open_dc.public_bodies --ref-type statute",
    }),
    fetchedSources: connectors.length,
    openReviewItemCount: 2,
    deferredReviewItemCount: 0,
    staleReviewItemCount: 0,
    blockedReconciliationCount: 0,
    placeholderEntityCount: 0,
  });

  assertEquals(
    plan.nextCommand,
    "deno task dc -- review batch defer-default --mode legal --subject-prefix legal.open_dc.public_bodies --ref-type statute",
  );
});

Deno.test("operator plan quotes shell-sensitive review batch filter values", () => {
  const plan = buildOperatorPlan({
    suggestReviewPacketCommand: packetCommand({
      "legal:defer-default":
        "deno task dc -- review batch defer-default --mode legal --subject-prefix legal.open_dc.public_bodies --ref-type 'Mayor'\\''s Order'",
    }),
    fetchedSources: connectors.length,
    openReviewItemCount: 2,
    deferredReviewItemCount: 0,
    staleReviewItemCount: 0,
    blockedReconciliationCount: 0,
    placeholderEntityCount: 0,
  });

  assertEquals(
    plan.nextCommand,
    "deno task dc -- review batch defer-default --mode legal --subject-prefix legal.open_dc.public_bodies --ref-type 'Mayor'\\''s Order'",
  );
});

Deno.test("operator plan falls back through review, audit, source list, and release build", () => {
  assertEquals(
    buildOperatorPlan({
      suggestReviewPacketCommand: noPacketCommand,
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
      suggestReviewPacketCommand: noPacketCommand,
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
      suggestReviewPacketCommand: noPacketCommand,
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
      suggestReviewPacketCommand: noPacketCommand,
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

const noPacketCommand: ReviewPacketCommandSuggester = () => undefined;

function packetCommand(commands: Record<string, string>): ReviewPacketCommandSuggester {
  return (filters, action, options) => {
    const itemKind = filters.mode === "entities" && options?.itemFilter
      ? options.itemFilter(explicitSafeEntityItem) ? "explicit-safe" : "non-explicit-safe"
      : undefined;
    return commands[[filters.mode, action, itemKind].filter(Boolean).join(":")] ??
      commands[`${filters.mode}:${action}`];
  };
}

const explicitSafeEntityItem: ReviewItemRecord = {
  reviewItemId: "review.candidate.test.explicit_safe",
  itemType: "entity_candidate",
  subjectId: "candidate.test.explicit_safe",
  reason: "Review entity candidate",
  defaultAction: "accept",
  status: "open",
  details: { safeToAutoAccept: true },
};
