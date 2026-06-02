import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Workbench } from "../src/v2/workbench.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("dcgis part_of relationships auto-accept when both endpoints are accepted", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.example_agency', 'Example Agency', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.executive_branch', 'Executive Branch', 'branch', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "dcgis.agencies",
      relationshipCandidateId: "relationship.test.auto_accept.dcgis.part_of",
      sourceItemKey: "auto-accept-dcgis-row",
      fromEntityRef: "dc.example_agency",
      toEntityRef: "dc.executive_branch",
      relationshipType: "part_of",
      rawValue: "Executive",
      needsReview: false,
    }),
    dataDir,
  );

  const relationship = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = 'dc.example_agency:part_of:dc.executive_branch'",
  ).get() as { relationshipId: string } | undefined;
  const candidate = workbench.db.prepare(
    "select review_status as reviewStatus from relationship_candidates where relationship_candidate_id = 'relationship.test.auto_accept.dcgis.part_of'",
  ).get() as { reviewStatus: string } | undefined;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.auto_accept.dcgis",
  });
  workbench.close();

  assertEquals(relationship?.relationshipId, "dc.example_agency:part_of:dc.executive_branch");
  assertEquals(candidate?.reviewStatus, "accepted");
  assertEquals(reviewItems.length, 0);
});

Deno.test("default-defer dcgis relationships stay in review instead of auto-accepting", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.example_agency', 'Example Agency', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.other_branch', 'Other Branch', 'branch', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "dcgis.agencies",
      relationshipCandidateId: "relationship.test.auto_accept.dcgis.other",
      sourceItemKey: "auto-accept-dcgis-other-row",
      fromEntityRef: "dc.example_agency",
      toEntityRef: "dc.other_branch",
      relationshipType: "part_of",
      rawValue: "Other",
      needsReview: false,
    }),
    dataDir,
  );

  const relationship = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = 'dc.example_agency:part_of:dc.other_branch'",
  ).get() as { relationshipId: string } | undefined;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.auto_accept.dcgis.other",
  });
  workbench.close();

  assertEquals(relationship, undefined);
  assertEquals(reviewItems.length, 1);
  assertEquals(reviewItems[0]?.defaultAction, "defer");
});

Deno.test("accepting a prerequisite entity can auto-accept a newly safe Open DC relationship", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.board_accountancy', 'Board of Accountancy', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "open_dc.public_bodies",
      relationshipCandidateId: "relationship.test.auto_accept.open_dc.governing_agency",
      sourceItemKey: "auto-accept-open-dc-row",
      fromEntityRef: "dc.board_accountancy",
      toEntityRef: "dc.target_agency",
      relationshipType: "governed_by",
      rawValue: "Target Agency",
      needsReview: false,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.auto_accept.manual_entity",
      candidateId: "candidate.test.auto_accept.manual_entity.target_agency",
      sourceItemKey: "auto-accept-target-agency",
      proposedEntityId: "dc.target_agency",
      name: "Target Agency",
      kind: "agency",
      observedName: "Target Agency",
      confidence: 0.4,
    }),
    dataDir,
  );

  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.auto_accept.manual_entity.target_agency",
      payload: {},
    },
    resolutionsDir,
  );

  const relationship = workbench.db.prepare(
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = 'dc.board_accountancy:governed_by:dc.target_agency'",
  ).get() as { relationshipId: string } | undefined;
  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.auto_accept.open_dc",
  });
  workbench.close();

  assertEquals(relationship?.relationshipId, "dc.board_accountancy:governed_by:dc.target_agency");
  assertEquals(reviewItems.length, 0);
});
