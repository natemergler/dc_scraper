import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildOperatorPlan,
  type OperatorPlanWorkbench,
  unresolvedStateNote,
} from "../src/v2/operator_plan.ts";
import { connectors } from "../src/v2/connectors.ts";
import type { ReviewItemRecord } from "../src/v2/domain.ts";
import type { ReviewItemFilters } from "../src/v2/workbench/review.ts";

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
    canBatchAcceptReviewItem: batchAcceptsSafeDetails,
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
    workbench: fakeWorkbench([
      safeEntityReviewItem("candidate.dcgis.agencies.one"),
      safeEntityReviewItem("candidate.council.committees.one"),
      safeEntityReviewItem("candidate.council.committees.two"),
    ]),
    canBatchAcceptReviewItem: batchAcceptsSafeDetails,
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
    workbench: fakeWorkbench([
      safeRelationshipReviewItem("relationship.dcgis.agencies.one", "administered_by"),
      safeRelationshipReviewItem("relationship.dcgis.agencies.two", "administered_by"),
      safeRelationshipReviewItem("relationship.council.committees.one", "overseen_by"),
      deferRelationshipReviewItem("relationship.council.committees.two", "overseen_by"),
    ]),
    canBatchAcceptReviewItem: acceptsDefaultAcceptRelationship,
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
    workbench: fakeWorkbench([
      deferRelationshipReviewItem("relationship.council.committees.one", "overseen_by"),
      deferRelationshipReviewItem("relationship.council.committees.two", "overseen_by"),
    ]),
    canBatchAcceptReviewItem: () => false,
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
    workbench: fakeWorkbench([
      deferLegalReviewItem("legal.open_dc.public_bodies.one", "statute"),
      deferLegalReviewItem("legal.open_dc.public_bodies.two", "statute"),
    ]),
    canBatchAcceptReviewItem: () => false,
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
    workbench: fakeWorkbench([
      deferLegalReviewItem("legal.open_dc.public_bodies.one", "Mayor's Order"),
      deferLegalReviewItem("legal.open_dc.public_bodies.two", "Mayor's Order"),
    ]),
    canBatchAcceptReviewItem: () => false,
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
      workbench: fakeWorkbench([genericReviewItem("source_status.open")]),
      canBatchAcceptReviewItem: () => false,
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
      workbench: fakeWorkbench([]),
      canBatchAcceptReviewItem: () => false,
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
      workbench: fakeWorkbench([]),
      canBatchAcceptReviewItem: () => false,
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
      workbench: fakeWorkbench([]),
      canBatchAcceptReviewItem: () => false,
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

function fakeWorkbench(items: ReviewItemRecord[]): OperatorPlanWorkbench {
  return {
    reviewDebtSummary() {
      const counts = new Map<string, number>();
      for (const item of items) {
        const sourceId = sourceIdForSubject(item.subjectId);
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
    listReviewItems(filters?: ReviewItemFilters) {
      return items.filter((item) => matchesFilters(item, filters));
    },
  };
}

function matchesFilters(item: ReviewItemRecord, filters?: ReviewItemFilters): boolean {
  if (!filters) return true;
  if (filters.status && filters.status !== item.status) return false;
  if (filters.subjectPrefix && !item.subjectId.startsWith(filters.subjectPrefix)) return false;
  if (filters.mode === "entities" && item.itemType !== "entity_candidate") return false;
  if (filters.mode === "relationships" && item.itemType !== "relationship_candidate") return false;
  if (filters.mode === "legal" && item.itemType !== "legal_ref") return false;
  if (filters.relationshipType && item.details.relationshipType !== filters.relationshipType) {
    return false;
  }
  if (filters.refType && item.details.refType !== filters.refType) return false;
  return true;
}

function sourceIdForSubject(subjectId: string): string {
  if (subjectId.startsWith("candidate.council.committees.")) return "council.committees";
  if (subjectId.startsWith("candidate.dcgis.agencies.")) return "dcgis.agencies";
  if (subjectId.startsWith("relationship.council.committees.")) return "council.committees";
  if (subjectId.startsWith("relationship.dcgis.agencies.")) return "dcgis.agencies";
  if (subjectId.startsWith("legal.open_dc.public_bodies.")) return "open_dc.public_bodies";
  return "unknown";
}

function batchAcceptsSafeDetails(item: ReviewItemRecord): boolean {
  return item.details.safeToAutoAccept === true;
}

function acceptsDefaultAcceptRelationship(item: ReviewItemRecord): boolean {
  return item.itemType === "relationship_candidate" && item.defaultAction === "accept";
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

function safeRelationshipReviewItem(
  subjectId: string,
  relationshipType: string,
): ReviewItemRecord {
  return {
    reviewItemId: `${subjectId}.review`,
    itemType: "relationship_candidate",
    subjectId,
    reason: "Review safe relationship candidate",
    defaultAction: "accept",
    status: "open",
    details: {
      relationshipType,
    },
  };
}

function deferRelationshipReviewItem(
  subjectId: string,
  relationshipType: string,
): ReviewItemRecord {
  return {
    reviewItemId: `${subjectId}.review`,
    itemType: "relationship_candidate",
    subjectId,
    reason: "Review broad relationship candidate",
    defaultAction: "defer",
    status: "open",
    details: {
      relationshipType,
    },
  };
}

function deferLegalReviewItem(subjectId: string, refType: string): ReviewItemRecord {
  return {
    reviewItemId: `${subjectId}.review`,
    itemType: "legal_ref",
    subjectId,
    reason: "Review legal reference",
    defaultAction: "defer",
    status: "open",
    details: {
      refType,
    },
  };
}

function genericReviewItem(subjectId: string): ReviewItemRecord {
  return {
    reviewItemId: `${subjectId}.review`,
    itemType: "source_status",
    subjectId,
    reason: "Review source status",
    defaultAction: "defer",
    status: "open",
    details: {},
  };
}
