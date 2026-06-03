import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { buildReviewItemId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
  syntheticLegalRefSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("unresolved work graph links actionable prerequisites to blocked relationship diagnostics", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.unresolved_work.relationships",
      relationshipCandidateId: "relationship.test.unresolved_work.pending_dependency",
      sourceItemKey: "unresolved-work-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.pending_target",
      relationshipType: "governed_by",
      rawValue: "Pending Target",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.unresolved_work.entities",
      candidateId: "candidate.test.unresolved_work.pending_target",
      sourceItemKey: "unresolved-work-entity-row",
      proposedEntityId: "dc.pending_target",
      name: "Pending Target",
      kind: "agency",
      observedName: "Pending Target",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.unresolved_work.unrelated_entities",
      candidateId: "candidate.test.unresolved_work.unrelated",
      sourceItemKey: "unrelated-entity-row",
      proposedEntityId: "dc.unrelated",
      name: "Unrelated",
      kind: "agency",
      observedName: "Unrelated",
    }),
    dataDir,
  );

  const blockedGraph = workbench.unresolvedWorkGraph();
  const prerequisiteDecision = blockedGraph.decisions.find((decision) =>
    decision.subjectId === "candidate.test.unresolved_work.pending_target"
  );
  const unrelatedDecision = blockedGraph.decisions.find((decision) =>
    decision.subjectId === "candidate.test.unresolved_work.unrelated"
  );
  const blockedDiagnostic = blockedGraph.diagnostics.find((diagnostic) =>
    diagnostic.subjectId === "relationship.test.unresolved_work.pending_dependency"
  );

  assert(prerequisiteDecision);
  assert(unrelatedDecision);
  assertEquals(prerequisiteDecision.itemType, "entity_candidate");
  assertEquals(prerequisiteDecision.downstreamBlockedCount, 1);
  assertEquals(unrelatedDecision.downstreamBlockedCount, 0);
  assertEquals(
    prerequisiteDecision.blockedSubjectIds,
    ["relationship.test.unresolved_work.pending_dependency"],
  );
  assert(blockedDiagnostic);
  assertEquals(blockedDiagnostic.reason, "unresolved_endpoints");
  assertEquals(blockedDiagnostic.blockers[0].blockerId, "dc.pending_target");
  assertEquals(blockedDiagnostic.blockers[0].blockerState, "pending_candidate");
  assertEquals(blockedDiagnostic.blockers[0].hasActionablePrerequisite, true);
  assert(
    blockedDiagnostic.blockers[0].actionableDecisionIds.includes(prerequisiteDecision.nodeId),
  );
  assert(
    blockedGraph.edges.some((edge) =>
      edge.fromNodeId === prerequisiteDecision.nodeId &&
      edge.toNodeId === blockedDiagnostic.nodeId &&
      edge.kind === "unblocks"
    ),
  );
  assertEquals(
    blockedGraph.decisions.findIndex((decision) =>
      decision.nodeId === prerequisiteDecision.nodeId
    ) <
      blockedGraph.decisions.findIndex((decision) => decision.nodeId === unrelatedDecision.nodeId),
    true,
  );

  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.unresolved_work.pending_target",
      payload: {},
    },
    resolutionsDir,
  );

  const unblockedGraph = workbench.unresolvedWorkGraph();
  assertEquals(
    unblockedGraph.diagnostics.some((diagnostic) =>
      diagnostic.subjectId === "relationship.test.unresolved_work.pending_dependency"
    ),
    false,
  );
  assert(
    unblockedGraph.decisions.some((decision) =>
      decision.subjectId === "relationship.test.unresolved_work.pending_dependency"
    ),
  );
  workbench.close();
});

Deno.test("unresolved work graph keeps deferred blockers as diagnostics without fake actions", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.unresolved_work.deferred_relationships",
      relationshipCandidateId: "relationship.test.unresolved_work.deferred_dependency",
      sourceItemKey: "deferred-unresolved-work-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.other",
      relationshipType: "governed_by",
      rawValue: "Other",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.unresolved_work.deferred_entities",
      candidateId: "candidate.test.unresolved_work.deferred_target",
      sourceItemKey: "deferred-unresolved-work-entity-row",
      proposedEntityId: "dc.other",
      name: "Other",
      kind: "agency",
      observedName: "Other",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(
        "candidate.test.unresolved_work.deferred_target",
        "entity-review",
      ),
      payload: {},
    },
    resolutionsDir,
  );

  const graph = workbench.unresolvedWorkGraph();
  const diagnostic = graph.diagnostics.find((node) =>
    node.subjectId === "relationship.test.unresolved_work.deferred_dependency"
  );

  assert(diagnostic);
  assertEquals(diagnostic.blockers[0].blockerId, "dc.other");
  assertEquals(diagnostic.blockers[0].blockerState, "deferred_candidate");
  assertEquals(diagnostic.blockers[0].hasActionablePrerequisite, false);
  assertEquals(diagnostic.blockers[0].actionableDecisionIds, []);
  assertEquals(
    graph.edges.some((edge) => edge.toNodeId === diagnostic.nodeId),
    false,
  );
  workbench.close();
});

Deno.test("unresolved work graph links legal ref decisions to legal endpoint blockers", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "open_dc.public_bodies",
      relationshipCandidateId: "relationship.test.unresolved_work.legal_dependency",
      sourceItemKey: "legal-unresolved-work-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "legal.d_c_code_3_1202_03",
      relationshipType: "authorized_by",
      rawValue: "D.C. Code § 3-1202.03",
      needsReview: false,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.unresolved_work.authority",
      "D.C. Code § 3-1202.03",
      "https://code.dccouncil.us/us/dc/council/code/sections/3-1202.03",
    ),
    dataDir,
  );

  const graph = workbench.unresolvedWorkGraph();
  const legalDecision = graph.decisions.find((decision) =>
    decision.subjectId === "legal.test.unresolved_work.authority"
  );
  const diagnostic = graph.diagnostics.find((node) =>
    node.subjectId === "relationship.test.unresolved_work.legal_dependency"
  );

  assert(legalDecision);
  assert(diagnostic);
  assertEquals(diagnostic.blockers[0].blockerId, "legal.d_c_code_3_1202_03");
  assertEquals(diagnostic.blockers[0].blockerState, "pending_candidate");
  assertEquals(diagnostic.blockers[0].hasActionablePrerequisite, true);
  assertEquals(diagnostic.blockers[0].actionableDecisionIds, [legalDecision.nodeId]);
  assert(
    graph.edges.some((edge) =>
      edge.fromNodeId === legalDecision.nodeId &&
      edge.toNodeId === diagnostic.nodeId &&
      edge.blockerId === "legal.d_c_code_3_1202_03"
    ),
  );
  workbench.close();
});

Deno.test("unresolved work graph links placeholder review items to placeholder blockers", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values('dc.placeholder_target', 'Placeholder Target', 'placeholder', 'placeholder', '[]', 1, 'fixture placeholder', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into review_items(review_item_id, item_type, subject_id, reason, default_action, status, details_json, created_at, updated_at) values('review.placeholder.target', 'placeholder_entity', 'dc.placeholder_target', 'Resolve placeholder endpoint', 'defer', 'open', '{}', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.unresolved_work.placeholder_relationships",
      relationshipCandidateId: "relationship.test.unresolved_work.placeholder_dependency",
      sourceItemKey: "placeholder-unresolved-work-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.placeholder_target",
      relationshipType: "governed_by",
      rawValue: "Other",
    }),
    dataDir,
  );

  const graph = workbench.unresolvedWorkGraph();
  const placeholderDecision = graph.decisions.find((decision) =>
    decision.subjectId === "dc.placeholder_target"
  );
  const diagnostic = graph.diagnostics.find((node) =>
    node.subjectId === "relationship.test.unresolved_work.placeholder_dependency"
  );

  assert(placeholderDecision);
  assert(diagnostic);
  assertEquals(diagnostic.blockers[0].blockerId, "dc.placeholder_target");
  assertEquals(diagnostic.blockers[0].blockerState, "placeholder");
  assertEquals(diagnostic.blockers[0].hasActionablePrerequisite, true);
  assertEquals(diagnostic.blockers[0].actionableDecisionIds, [placeholderDecision.nodeId]);
  workbench.close();
});

function seedAcceptedEntity(
  workbench: Workbench,
  entityId: string,
  name: string,
  kind: string,
): void {
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run([entityId, name, kind]);
}
