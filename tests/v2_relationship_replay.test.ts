import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildReviewItemId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { canBatchAcceptReviewItem } from "../src/v2/workbench/review_batch.ts";
import {
  syntheticCustomRelationshipSourceResult,
  syntheticLegalRefSourceResult,
  syntheticRelationshipSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("accepted relationship decisions are reused across refetch when relationship candidate ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_v1",
      "Target Agency",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId:
        "relationship.test.signature.relationships.source_board_governed_by_target_agency_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_v2",
      "Target Agency",
    ),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = 'relationship.test.signature.relationships.source_board_governed_by_target_agency_v1'",
  ).get() as { payloadJson: string };
  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from relationship_candidates where relationship_candidate_id = 'relationship.test.signature.relationships.source_board_governed_by_target_agency_v2'",
  ).get() as { reviewStatus: string };
  const relationshipCount = workbench.db.prepare(
    "select count(*) as count from canonical_relationships where relationship_id = 'dc.source_board:governed_by:dc.target_agency'",
  ).get() as { count: number };
  const openItems = workbench.listReviewItems({ mode: "relationships", status: "open" });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(
    payload.fact_signature ?? "",
    "relationship_candidate:test.signature.relationships",
  );
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(secondCandidate.reviewStatus, "accepted");
  assertEquals(relationshipCount.count, 1);
  assertEquals(openItems.length, 0);
});

Deno.test("accepted legal-authority relationship decisions are reused across refetch when candidate ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.source_board', 'Source Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.authority",
      "D.C. Code § 3-1202.03",
      "https://code.dccouncil.us/us/dc/council/code/sections/3-1202.03",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_legal_ref",
      subjectId: "legal.test.signature.legal_refs.authority",
      payload: {},
    },
    resolutionsDir,
  );

  const firstCandidateId =
    "relationship.test.signature.relationships.source_board_authorized_by_legal_ref_v1";
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.signature.relationships",
      relationshipCandidateId: firstCandidateId,
      sourceItemKey: "authorized-by-legal-ref-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "legal.d_c_code_3_1202_03",
      relationshipType: "authorized_by",
      rawValue: "D.C. Code § 3-1202.03",
      needsReview: false,
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: firstCandidateId,
      payload: {},
    },
    resolutionsDir,
  );

  const secondCandidateId =
    "relationship.test.signature.relationships.source_board_authorized_by_legal_ref_v2";
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.signature.relationships",
      relationshipCandidateId: secondCandidateId,
      sourceItemKey: "authorized-by-legal-ref-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "legal.d_c_code_3_1202_03",
      relationshipType: "authorized_by",
      rawValue: "D.C. Code § 3-1202.03",
      needsReview: false,
    }),
    dataDir,
  );

  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from relationship_candidates where relationship_candidate_id = ?",
  ).get(secondCandidateId) as { reviewStatus: string };
  const relationshipCount = workbench.db.prepare(
    "select count(*) as count from canonical_relationships where relationship_type = 'authorized_by'",
  ).get() as { count: number };
  const openItems = workbench.listReviewItems({ mode: "relationships", status: "open" });
  workbench.close();

  assertEquals(secondCandidate.reviewStatus, "accepted");
  assertEquals(relationshipCount.count, 0);
  assertEquals(openItems.length, 0);
});

Deno.test("rejected relationship decisions are reused across refetch when relationship candidate ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v1",
      "Target Agency",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "reject_relationship_candidate",
      subjectId:
        "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v2",
      "Target Agency",
    ),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = 'relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v1'",
  ).get() as { payloadJson: string };
  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from relationship_candidates where relationship_candidate_id = 'relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v2'",
  ).get() as { reviewStatus: string };
  const relationshipCount = workbench.db.prepare(
    "select count(*) as count from canonical_relationships where relationship_id = 'dc.source_board:governed_by:dc.target_agency'",
  ).get() as { count: number };
  const openItems = workbench.listReviewItems({ mode: "relationships", status: "open" });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(
    payload.fact_signature ?? "",
    "relationship_candidate:test.signature.relationships",
  );
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(secondCandidate.reviewStatus, "rejected");
  assertEquals(relationshipCount.count, 0);
  assertEquals(openItems.length, 0);
});

Deno.test("changed relationship evidence after a prior accept becomes stale review work instead of silent reuse", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_v1",
      "Target Agency",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId:
        "relationship.test.signature.relationships.source_board_governed_by_target_agency_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_v2",
      "Target Agency (Updated Source Text)",
    ),
    dataDir,
  );

  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from relationship_candidates where relationship_candidate_id = 'relationship.test.signature.relationships.source_board_governed_by_target_agency_v2'",
  ).get() as { reviewStatus: string };
  const staleItem = workbench.listReviewItems({
    mode: "relationships",
    status: "open",
  }).find((item) =>
    item.subjectId ===
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_v2"
  );
  const staleItemCanBatchAccept = staleItem
    ? canBatchAcceptReviewItem(workbench, staleItem, {
      mode: "relationships",
      relationshipType: "governed_by",
      subjectPrefix: "relationship.test.signature.relationships",
    })
    : undefined;
  workbench.close();

  assertEquals(secondCandidate.reviewStatus, "pending");
  assert(staleItem);
  assertEquals(staleItem.details.priorDecisionState, "accepted");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertEquals(staleItemCanBatchAccept, false);
  assertStringIncludes(staleItem.reason, "changed since a prior accepted decision");
});

Deno.test("batch accept-safe skips generic relationship candidates marked needs-review", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_committee",
      "Target Committee",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  const relationshipCandidateId = "relationship.test.batch_relationships.manual_fallback_oversight";
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.batch_relationships",
      relationshipCandidateId,
      sourceItemKey: "manual-fallback-oversight-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_committee",
      relationshipType: "overseen_by",
      rawValue: "Source Board",
      needsReview: true,
    }),
    dataDir,
  );

  const item = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.test.batch_relationships.manual_fallback",
  })[0];
  assert(item);
  const canAccept = canBatchAcceptReviewItem(workbench, item, {
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.test.batch_relationships.manual_fallback",
  });
  workbench.close();

  assertEquals(item.subjectId, relationshipCandidateId);
  assertEquals(item.defaultAction, "defer");
  assertEquals(canAccept, false);
});

Deno.test("edited relationship accept decisions are reused across refetch when relationship candidate ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ], [
      "dc.alt_agency",
      "Alt Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  const firstCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_edit_v1";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(firstCandidateId, "Target Agency"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: firstCandidateId,
      payload: {
        relationshipType: "authorized_by",
        toEntityId: "dc.alt_agency",
      },
    },
    resolutionsDir,
  );

  const secondCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_edit_v2";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(secondCandidateId, "Target Agency"),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = ?",
  ).get(firstCandidateId) as { payloadJson: string };
  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from relationship_candidates where relationship_candidate_id = ?",
  ).get(secondCandidateId) as { reviewStatus: string };
  const relationshipCount = workbench.db.prepare(
    "select count(*) as count from canonical_relationships where relationship_id = 'dc.source_board:authorized_by:dc.alt_agency'",
  ).get() as { count: number };
  const openItems = workbench.listReviewItems({ mode: "relationships", status: "open" });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
    resolved_relationship_type?: string;
    resolved_to_entity_id?: string;
  };
  assertStringIncludes(
    payload.fact_signature ?? "",
    "relationship_candidate:test.signature.relationships",
  );
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(payload.resolved_relationship_type, "authorized_by");
  assertEquals(payload.resolved_to_entity_id, "dc.alt_agency");
  assertEquals(secondCandidate.reviewStatus, "accepted");
  assertEquals(relationshipCount.count, 1);
  assertEquals(openItems.length, 0);
});

Deno.test("changed relationship evidence after a prior edited accept preserves prior resolved details", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ], [
      "dc.alt_agency",
      "Alt Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  const firstCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_edit_v1";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(firstCandidateId, "Target Agency"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: firstCandidateId,
      payload: {
        relationshipType: "authorized_by",
        toEntityId: "dc.alt_agency",
      },
    },
    resolutionsDir,
  );

  const secondCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_edit_v2";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(secondCandidateId, "Target Agency (Updated Source Text)"),
    dataDir,
  );

  const staleItem = workbench.listReviewItems({
    mode: "relationships",
    status: "open",
  }).find((item) => item.subjectId === secondCandidateId);
  workbench.close();

  assert(staleItem);
  assertEquals(staleItem.details.priorDecisionState, "accepted");
  assertEquals(staleItem.details.priorResolvedRelationshipType, "authorized_by");
  assertEquals(staleItem.details.priorResolvedFromEntityId, "dc.source_board");
  assertEquals(staleItem.details.priorResolvedToEntityId, "dc.alt_agency");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior accepted decision");
});

Deno.test("missing resolved relationship endpoint returns unchanged relationship refetch to review instead of silently resolving it", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  const firstCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_conflict_v1";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(firstCandidateId, "Target Agency"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: firstCandidateId,
      payload: {},
    },
    resolutionsDir,
  );
  workbench.db.prepare(
    "delete from canonical_relationships where relationship_id = 'dc.source_board:governed_by:dc.target_agency'",
  ).run();
  workbench.db.prepare("delete from canonical_entities where entity_id = 'dc.target_agency'").run();

  const secondCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_conflict_v2";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(secondCandidateId, "Target Agency"),
    dataDir,
  );

  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from relationship_candidates where relationship_candidate_id = ?",
  ).get(secondCandidateId) as { reviewStatus: string };
  const conflictItem = workbench.listReviewItems({
    mode: "relationships",
    status: "open",
  }).find((item) => item.subjectId === secondCandidateId);
  workbench.close();

  assertEquals(secondCandidate.reviewStatus, "pending");
  assert(conflictItem);
  assertEquals(conflictItem.details.priorDecisionState, "accepted");
  assertEquals(conflictItem.details.priorResolvedFromEntityId, "dc.source_board");
  assertEquals(conflictItem.details.priorResolvedToEntityId, "dc.target_agency");
  assertEquals(conflictItem.details.replayConflict, true);
  assertStringIncludes(
    conflictItem.reason,
    "prior accepted decision could not be replayed because resolved endpoint dc.target_agency is missing",
  );
});

Deno.test("changed relationship evidence after a prior reject becomes stale review work instead of silent reuse", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v1",
      "Target Agency",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "reject_relationship_candidate",
      subjectId:
        "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v2",
      "Target Agency (Updated Source Text)",
    ),
    dataDir,
  );

  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from relationship_candidates where relationship_candidate_id = 'relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v2'",
  ).get() as { reviewStatus: string };
  const staleItem = workbench.listReviewItems({
    mode: "relationships",
    status: "open",
  }).find((item) =>
    item.subjectId ===
      "relationship.test.signature.relationships.source_board_governed_by_target_agency_reject_v2"
  );
  workbench.close();

  assertEquals(secondCandidate.reviewStatus, "pending");
  assert(staleItem);
  assertEquals(staleItem.defaultAction, "reject");
  assertEquals(staleItem.details.priorDecisionState, "rejected");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior rejected decision");
});

Deno.test("deferred relationship review decisions are reused across refetch when candidate ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  const firstCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_defer_v1";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(firstCandidateId, "Target Agency"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(firstCandidateId, "governed_by"),
      payload: {},
    },
    resolutionsDir,
  );

  const secondCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_defer_v2";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(secondCandidateId, "Target Agency"),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = ?",
  ).get(buildReviewItemId(firstCandidateId, "governed_by")) as { payloadJson: string };
  const deferredItems = workbench.listReviewItems({
    mode: "relationships",
    status: "deferred",
  });
  const openItems = workbench.listReviewItems({
    mode: "relationships",
    status: "open",
  });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(
    payload.fact_signature ?? "",
    "relationship_candidate:test.signature.relationships",
  );
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(
    deferredItems.some((item) => item.subjectId === secondCandidateId),
    true,
  );
  assertEquals(deferredItems.length, 1);
  assertEquals(openItems.length, 0);
});

Deno.test("changed relationship evidence after a prior defer becomes stale open review work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name] of [["dc.source_board", "Source Board"], [
      "dc.target_agency",
      "Target Agency",
    ]]
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name);
  }

  const firstCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_defer_v1";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(firstCandidateId, "Target Agency"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(firstCandidateId, "governed_by"),
      payload: {},
    },
    resolutionsDir,
  );

  const secondCandidateId =
    "relationship.test.signature.relationships.source_board_governed_by_target_agency_defer_v2";
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(secondCandidateId, "Target Agency (Updated Source Text)"),
    dataDir,
  );

  const staleItem = workbench.listReviewItems({
    mode: "relationships",
    status: "open",
  }).find((item) => item.subjectId === secondCandidateId);
  const deferredItems = workbench.listReviewItems({
    mode: "relationships",
    status: "deferred",
  });
  workbench.close();

  assert(staleItem);
  assertEquals(staleItem.status, "open");
  assertEquals(staleItem.details.priorDecisionState, "deferred");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior deferred decision");
  assertEquals(deferredItems.length, 0);
});
