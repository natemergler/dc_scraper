import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildReviewItemId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { reconcileRelationshipCandidates } from "../src/v2/workbench/reconciliation.ts";
import {
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
  dcgisMetadataFixture,
  quickbaseAppointmentsCsvFixture,
  quickbaseFixture,
} from "./helpers/v2_fixtures.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("quickbase auto-promotes board entities but keeps unresolved-endpoint relationships blocked after import", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0":
          return quickbaseFixture;
        case "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs":
          return quickbaseAppointmentsCsvFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("mota.quickbase").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const relationshipCandidates = workbench.db.prepare(
    "select count(*) as count from relationship_candidates where review_status = 'pending'",
  ).get() as { count: number };
  const relationshipReviewItems = workbench.listReviewItems({ mode: "relationships" });
  const entityReviewItems = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix: "candidate.mota.quickbase",
  });
  const blockedItems = workbench.db.prepare(
    `select subject_id as subjectId,
            state,
            reason,
            details_json as detailsJson
     from reconciliation_items
     where subject_type = 'relationship_candidate'
     order by subject_id`,
  ).all() as Array<{ subjectId: string; state: string; reason: string; detailsJson: string }>;
  workbench.close();

  assertEquals(relationshipCandidates.count > 0, true);
  assertEquals(relationshipReviewItems.length > 0, true);
  assertEquals(entityReviewItems.length, 0);
  assert(blockedItems.length > 0);
  assertEquals(
    blockedItems.some((item) =>
      item.state === "blocked" &&
      item.reason === "unresolved_endpoints"
    ),
    true,
  );
});

Deno.test("accepting a prerequisite entity reprocesses blocked relationships into review-ready work", async () => {
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
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.reprocess.accept.relationships",
      relationshipCandidateId: "relationship.test.reprocess.accept",
      sourceItemKey: "accept-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.accept_target",
      relationshipType: "governed_by",
      rawValue: "Accept Target",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reprocess.accept.entities",
      candidateId: "candidate.test.reprocess.accept",
      sourceItemKey: "accept-entity-row",
      proposedEntityId: "dc.accept_target",
      name: "Accept Target",
      kind: "agency",
      observedName: "Accept Target",
    }),
    dataDir,
  );

  const before = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reprocess",
  });
  const blockedBefore = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reprocess.accept'
       and state = 'blocked'`,
  ).get() as { count: number };

  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.reprocess.accept",
      payload: {},
    },
    resolutionsDir,
  );

  const after = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reprocess",
  });
  const blockedAfter = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reprocess.accept'
       and state = 'blocked'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(before.length, 0);
  assertEquals(blockedBefore.count, 1);
  assert(
    after.some((item) => item.subjectId === "relationship.test.reprocess.accept"),
  );
  assertEquals(blockedAfter.count, 0);
});

Deno.test("relationship reconciliation resolves endpoint status in bulk", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.shared_source_board', 'Shared Source Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.shared_target_agency', 'Shared Target Agency', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  for (let index = 0; index < 8; index += 1) {
    await workbench.importConnectorResult(
      syntheticCustomRelationshipSourceResult({
        sourceId: "test.reconcile.bulk.relationships",
        relationshipCandidateId: `relationship.test.reconcile.bulk.${index}`,
        sourceItemKey: `bulk-relationship-row-${index}`,
        fromEntityRef: "dc.shared_source_board",
        toEntityRef: "dc.shared_target_agency",
        relationshipType: "governed_by",
        rawValue: `Shared Target Agency ${index}`,
      }),
      dataDir,
    );
  }

  const queryCounts = countReconciliationPrepares(workbench);
  workbench.close();

  assert(queryCounts.prepareCount < 40);
  assertEquals(queryCounts.endpointCandidateStatusQueries, 1);
  assertEquals(queryCounts.endpointCanonicalQueries, 1);
});

Deno.test("relationship imports seed reviewable endpoint candidates for missing direct endpoint text", async () => {
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
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.seeded.endpoint.relationships",
      relationshipCandidateId: "relationship.test.seeded.endpoint",
      sourceItemKey: "seeded-endpoint-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.office_of_missing_things",
      relationshipType: "governed_by",
      rawValue: "Office of Missing Things",
    }),
    dataDir,
  );

  const seededCandidate = workbench.db.prepare(
    `select candidate_id as candidateId,
            name,
            kind,
            review_status as reviewStatus
     from entity_candidates
     where proposed_entity_id = 'dc.office_of_missing_things'`,
  ).get() as {
    candidateId: string;
    name: string;
    kind: string;
    reviewStatus: string;
  } | undefined;
  const blockedBefore = workbench.db.prepare(
    `select details_json as detailsJson
     from reconciliation_items
     where subject_id = 'relationship.test.seeded.endpoint'
       and state = 'blocked'`,
  ).get() as { detailsJson: string } | undefined;
  const entityItemsBefore = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix: "candidate.test.seeded.endpoint.relationships",
  });

  assert(seededCandidate);
  assertEquals(seededCandidate.name, "Office of Missing Things");
  assertEquals(seededCandidate.kind, "office");
  assertEquals(seededCandidate.reviewStatus, "pending");
  assert(blockedBefore);
  assertStringIncludes(blockedBefore.detailsJson, '"state":"pending_candidate"');
  assertEquals(
    entityItemsBefore.some((item) => item.subjectId === seededCandidate.candidateId),
    true,
  );

  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: seededCandidate.candidateId,
      payload: {},
    },
    resolutionsDir,
  );

  const relationshipItemsAfter = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.seeded.endpoint",
  });
  const blockedAfter = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.seeded.endpoint'
       and state = 'blocked'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(
    relationshipItemsAfter.some((item) => item.subjectId === "relationship.test.seeded.endpoint"),
    true,
  );
  assertEquals(blockedAfter.count, 0);
});

function countReconciliationPrepares(workbench: Workbench): {
  prepareCount: number;
  endpointCandidateStatusQueries: number;
  endpointCanonicalQueries: number;
} {
  let prepareCount = 0;
  let endpointCandidateStatusQueries = 0;
  let endpointCanonicalQueries = 0;
  const store = {
    db: {
      prepare(sql: string) {
        prepareCount += 1;
        if (sql.includes("entity_candidates.proposed_entity_id in")) {
          endpointCandidateStatusQueries += 1;
        }
        if (sql.includes("canonical_entities") && sql.includes("entity_id in")) {
          endpointCanonicalQueries += 1;
        }
        return workbench.db.prepare(sql);
      },
    },
  };
  reconcileRelationshipCandidates(
    store as unknown as Parameters<typeof reconcileRelationshipCandidates>[0],
  );
  return { prepareCount, endpointCandidateStatusQueries, endpointCanonicalQueries };
}

Deno.test("relationship imports do not seed generic missing endpoints", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.source_board', 'Source Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.seeded.generic.relationships",
      relationshipCandidateId: "relationship.test.seeded.generic",
      sourceItemKey: "generic-endpoint-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.other",
      relationshipType: "governed_by",
      rawValue: "Other",
    }),
    dataDir,
  );

  const seededCount = workbench.db.prepare(
    "select count(*) as count from entity_candidates where proposed_entity_id = 'dc.other'",
  ).get() as { count: number };
  const blocked = workbench.db.prepare(
    `select details_json as detailsJson
     from reconciliation_items
     where subject_id = 'relationship.test.seeded.generic'
       and state = 'blocked'`,
  ).get() as { detailsJson: string } | undefined;
  workbench.close();

  assertEquals(seededCount.count, 0);
  assert(blocked);
  assertStringIncludes(blocked.detailsJson, '"state":"missing"');
});

Deno.test("relationship imports do not seed endpoint candidates when the endpoint is already known", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.source_board', 'Source Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.office_of_planning', 'Office of Planning', 'office', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.seeded.known.relationships",
      relationshipCandidateId: "relationship.test.seeded.known",
      sourceItemKey: "known-endpoint-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.office_of_planning",
      relationshipType: "governed_by",
      rawValue: "Office of Planning",
    }),
    dataDir,
  );

  const seededCount = workbench.db.prepare(
    "select count(*) as count from entity_candidates where candidate_id like 'candidate.test.seeded.known.relationships.relationship_%'",
  ).get() as { count: number };
  const blockedCount = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.seeded.known'
       and state = 'blocked'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(seededCount.count, 0);
  assertEquals(blockedCount.count, 0);
});

Deno.test("council oversight imports auto-promote safe direct source bodies and accept the relationship", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.committee_on_the_judiciary_and_public_safety', 'Committee on the Judiciary and Public Safety', 'committee', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.seeded_oversight_direct",
      sourceItemKey: "seeded-oversight-direct-row",
      fromEntityRef: "dc.child_support_guideline_commission",
      toEntityRef: "dc.committee_on_the_judiciary_and_public_safety",
      relationshipType: "overseen_by",
      rawValue: "Child Support Guideline Commission",
    }),
    dataDir,
  );

  const seededCandidate = workbench.db.prepare(
    `select candidate_id as candidateId,
            proposed_entity_id as proposedEntityId,
            review_status as reviewStatus
     from entity_candidates
     where candidate_id = 'candidate.council.committees.relationship_council_committees_seeded_oversight_direct_from_endpoint'`,
  ).get() as {
    candidateId: string;
    proposedEntityId: string;
    reviewStatus: string;
  } | undefined;
  const canonicalEntity = workbench.db.prepare(
    `select entity_id as entityId, review_status as reviewStatus
     from canonical_entities
     where entity_id = 'dc.child_support_guideline_commission'`,
  ).get() as { entityId: string; reviewStatus: string } | undefined;
  const acceptedRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.child_support_guideline_commission:overseen_by:dc.committee_on_the_judiciary_and_public_safety'`,
  ).get() as { relationshipId: string } | undefined;
  const blockedCount = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.council.committees.seeded_oversight_direct'
       and state = 'blocked'`,
  ).get() as { count: number };
  const entityReviewItems = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix:
      "candidate.council.committees.relationship_council_committees_seeded_oversight_direct",
  });
  workbench.close();

  assert(seededCandidate);
  assertEquals(seededCandidate.proposedEntityId, "dc.child_support_guideline_commission");
  assertEquals(seededCandidate.reviewStatus, "accepted");
  assertEquals(canonicalEntity?.entityId, "dc.child_support_guideline_commission");
  assertEquals(canonicalEntity?.reviewStatus, "accepted");
  assertEquals(
    acceptedRelationship?.relationshipId,
    "dc.child_support_guideline_commission:overseen_by:dc.committee_on_the_judiciary_and_public_safety",
  );
  assertEquals(blockedCount.count, 0);
  assertEquals(entityReviewItems.length, 0);
});

Deno.test("council oversight imports do not seed broad grouped source bodies as entity candidates", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.committee_of_the_whole', 'Committee of the Whole', 'committee', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.seeded_oversight_grouped",
      sourceItemKey: "seeded-oversight-grouped-row",
      fromEntityRef:
        "dc.all_of_the_advisory_committees_and_professional_boards_serving_the_department_of_health_or_department_of_behavioral_health",
      toEntityRef: "dc.committee_of_the_whole",
      relationshipType: "overseen_by",
      rawValue:
        "All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health",
    }),
    dataDir,
  );

  const seededCount = workbench.db.prepare(
    "select count(*) as count from entity_candidates where candidate_id like 'candidate.council.committees.relationship_council_committees_seeded_oversight_grouped_%'",
  ).get() as { count: number };
  const blocked = workbench.db.prepare(
    `select details_json as detailsJson
     from reconciliation_items
     where subject_id = 'relationship.council.committees.seeded_oversight_grouped'
       and state = 'blocked'`,
  ).get() as { detailsJson: string } | undefined;
  workbench.close();

  assertEquals(seededCount.count, 0);
  assert(blocked);
  assertStringIncludes(blocked.detailsJson, '"state":"missing"');
});

Deno.test("council oversight imports auto-promote scoped grouped base entities and reopen deferred relationship review", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.committee_of_the_whole', 'Committee of the Whole', 'committee', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.seeded_oversight_scoped_grouped",
      sourceItemKey: "seeded-oversight-scoped-grouped-row",
      fromEntityRef: "dc.office_of_the_chief_financial_officer",
      toEntityRef: "dc.committee_of_the_whole",
      relationshipType: "overseen_by",
      rawValue:
        "Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)",
    }),
    dataDir,
  );

  const seededCandidate = workbench.db.prepare(
    `select candidate_id as candidateId,
            proposed_entity_id as proposedEntityId,
            name,
            review_status as reviewStatus
     from entity_candidates
     where candidate_id = 'candidate.council.committees.relationship_council_committees_seeded_oversight_scoped_grouped_from_endpoint'`,
  ).get() as {
    candidateId: string;
    proposedEntityId: string;
    name: string;
    reviewStatus: string;
  } | undefined;
  const canonicalEntity = workbench.db.prepare(
    `select entity_id as entityId, review_status as reviewStatus
     from canonical_entities
     where entity_id = 'dc.office_of_the_chief_financial_officer'`,
  ).get() as { entityId: string; reviewStatus: string } | undefined;
  const blockedCount = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.council.committees.seeded_oversight_scoped_grouped'
       and state = 'blocked'`,
  ).get() as { count: number };
  const entityReviewItems = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix:
      "candidate.council.committees.relationship_council_committees_seeded_oversight_scoped_grouped",
  });
  const relationshipReviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.council.committees.seeded_oversight_scoped_grouped",
  });
  workbench.close();

  assert(seededCandidate);
  assertEquals(seededCandidate.proposedEntityId, "dc.office_of_the_chief_financial_officer");
  assertEquals(seededCandidate.name, "Office of the Chief Financial Officer");
  assertEquals(seededCandidate.reviewStatus, "accepted");
  assertEquals(canonicalEntity?.entityId, "dc.office_of_the_chief_financial_officer");
  assertEquals(canonicalEntity?.reviewStatus, "accepted");
  assertEquals(blockedCount.count, 0);
  assertEquals(entityReviewItems.length, 0);
  assertEquals(relationshipReviewItems.length, 1);
  assertEquals(relationshipReviewItems[0]?.defaultAction, "defer");
  assertEquals(
    relationshipReviewItems[0]?.details.rawValue,
    "Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)",
  );
});

Deno.test("council oversight scoped grouped bodies reopen as deferred review when the base entity is accepted", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name, kind] of [
      ["dc.committee_of_the_whole", "Committee of the Whole", "committee"],
      ["dc.office_of_planning", "Office of Planning", "office"],
    ] as const
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name, kind);
  }

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.seeded_oversight_scoped_accepted",
      sourceItemKey: "seeded-oversight-scoped-accepted-row",
      fromEntityRef: "dc.office_of_planning",
      toEntityRef: "dc.committee_of_the_whole",
      relationshipType: "overseen_by",
      rawValue: "Office of Planning (including commemorative works)",
    }),
    dataDir,
  );

  const reviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.council.committees.seeded_oversight_scoped_accepted",
  });
  const blockedCount = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.council.committees.seeded_oversight_scoped_accepted'
       and state = 'blocked'`,
  ).get() as { count: number };
  workbench.close();

  assertEquals(reviewItems.length, 1);
  assertEquals(reviewItems[0]?.defaultAction, "defer");
  assertEquals(reviewItems[0]?.details.fromEntityRef, "dc.office_of_planning");
  assertEquals(
    reviewItems[0]?.details.rawValue,
    "Office of Planning (including commemorative works)",
  );
  assertEquals(
    reviewItems[0]?.details.whyDeferred,
    "Scoped oversight text uses including/excluding/jointly wording, so the exact oversight edge still needs a human decision.",
  );
  assertEquals(blockedCount.count, 0);
});

Deno.test("seeded committee endpoint candidates do not block stronger source auto-promotion", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.committee_on_executive_administration_and_labor', 'Committee on Executive Administration and Labor', 'committee', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.seeded_oversight_overlap",
      sourceItemKey: "seeded-oversight-overlap-row",
      fromEntityRef: "dc.adult_career_pathways_task_force",
      toEntityRef: "dc.committee_on_executive_administration_and_labor",
      relationshipType: "overseen_by",
      rawValue: "Adult Career Pathways Task Force",
    }),
    dataDir,
  );

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "open_dc.public_bodies",
      candidateId: "candidate.open_dc.public_bodies.adult_career_pathways_task_force",
      sourceItemKey: "adult-career-pathways-task-force",
      proposedEntityId: "dc.adult_career_pathways_task_force",
      name: "Adult Career Pathways Task Force",
      kind: "task_force",
      observedName: "Adult Career Pathways Task Force",
      confidence: 0.92,
    }),
    dataDir,
  );

  const canonical = workbench.db.prepare(
    `select entity_id as entityId, review_status as reviewStatus
     from canonical_entities
     where entity_id = 'dc.adult_career_pathways_task_force'`,
  ).get() as { entityId: string; reviewStatus: string } | undefined;
  const blockedCount = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.council.committees.seeded_oversight_overlap'
       and state = 'blocked'`,
  ).get() as { count: number };
  const acceptedRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.adult_career_pathways_task_force:overseen_by:dc.committee_on_executive_administration_and_labor'`,
  ).get() as { relationshipId: string } | undefined;
  workbench.close();

  assertEquals(canonical?.entityId, "dc.adult_career_pathways_task_force");
  assertEquals(canonical?.reviewStatus, "accepted");
  assertEquals(blockedCount.count, 0);
  assertEquals(
    acceptedRelationship?.relationshipId,
    "dc.adult_career_pathways_task_force:overseen_by:dc.committee_on_executive_administration_and_labor",
  );
});

Deno.test("council oversight exact-name aliases resolve accepted canonical endpoints into accepted relationships", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.board_of_review_for_anti_deficiency_violations', 'Board of Review for Anti-Deficiency Violations', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return `
            <html><body>
              <a href="https://dccouncil.gov/committees/committee-on-housing/">Committee on Housing</a>
            </body></html>
          `;
        case "https://dccouncil.gov/committees/committee-on-housing/":
          return `
            <html><body>
              <h1>Committee on Housing</h1>
              <h2>Oversight</h2>
              <ul>
                <li>Board of Review of Anti-Deficiency Violations</li>
              </ul>
            </body></html>
          `;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const blockedCount = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.council.committees.committee_on_housing_oversight_1'
       and state = 'blocked'`,
  ).get() as { count: number };
  const acceptedRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.board_of_review_for_anti_deficiency_violations:overseen_by:dc.committee_on_housing'`,
  ).get() as { relationshipId: string } | undefined;
  workbench.close();

  assertEquals(blockedCount.count, 0);
  assertEquals(
    acceptedRelationship?.relationshipId,
    "dc.board_of_review_for_anti_deficiency_violations:overseen_by:dc.committee_on_housing",
  );
});

Deno.test("council oversight legacy exact-name aliases can auto-promote direct bodies and accept the relationship", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return `
            <html><body>
              <a href="https://dccouncil.gov/committees/committee-on-transportation-and-the-environment/">Committee on Transportation and the Environment</a>
            </body></html>
          `;
        case "https://dccouncil.gov/committees/committee-on-transportation-and-the-environment/":
          return `
            <html><body>
              <h1>Committee on Transportation and the Environment</h1>
              <h2>Oversight</h2>
              <ul>
                <li>Bicycle Advisory Council</li>
              </ul>
            </body></html>
          `;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const seededCandidate = workbench.db.prepare(
    `select candidate_id as candidateId,
            proposed_entity_id as proposedEntityId,
            review_status as reviewStatus
     from entity_candidates
     where candidate_id = 'candidate.council.committees.relationship_council_committees_committee_on_transportation_and_the_environment_oversight_1_from_endpoint'`,
  ).get() as {
    candidateId: string;
    proposedEntityId: string;
    reviewStatus: string;
  } | undefined;
  const canonicalEntity = workbench.db.prepare(
    `select entity_id as entityId, review_status as reviewStatus
     from canonical_entities
     where entity_id = 'dc.bicycle_advisory_council'`,
  ).get() as { entityId: string; reviewStatus: string } | undefined;
  const acceptedRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.bicycle_advisory_council:overseen_by:dc.committee_on_transportation_and_the_environment'`,
  ).get() as { relationshipId: string } | undefined;
  const blockedCount = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.council.committees.committee_on_transportation_and_the_environment_oversight_1'
       and state = 'blocked'`,
  ).get() as { count: number };
  workbench.close();

  assert(seededCandidate);
  assertEquals(seededCandidate.proposedEntityId, "dc.bicycle_advisory_council");
  assertEquals(seededCandidate.reviewStatus, "accepted");
  assertEquals(canonicalEntity?.entityId, "dc.bicycle_advisory_council");
  assertEquals(canonicalEntity?.reviewStatus, "accepted");
  assertEquals(
    acceptedRelationship?.relationshipId,
    "dc.bicycle_advisory_council:overseen_by:dc.committee_on_transportation_and_the_environment",
  );
  assertEquals(blockedCount.count, 0);
});

Deno.test("council oversight alias-backed agency names can auto-promote direct bodies and accept the relationship", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return `
            <html><body>
              <a href="https://dccouncil.gov/committees/committee-on-health/">Committee on Health</a>
            </body></html>
          `;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return `
            <html><body>
              <h1>Committee on Health</h1>
              <h2>Oversight</h2>
              <ul>
                <li>Department of Health</li>
              </ul>
            </body></html>
          `;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const seededCandidate = workbench.db.prepare(
    `select candidate_id as candidateId,
            proposed_entity_id as proposedEntityId,
            review_status as reviewStatus
     from entity_candidates
     where candidate_id = 'candidate.council.committees.relationship_council_committees_committee_on_health_oversight_1_from_endpoint'`,
  ).get() as {
    candidateId: string;
    proposedEntityId: string;
    reviewStatus: string;
  } | undefined;
  const canonicalEntity = workbench.db.prepare(
    `select entity_id as entityId, review_status as reviewStatus
     from canonical_entities
     where entity_id = 'dc.dc_health'`,
  ).get() as { entityId: string; reviewStatus: string } | undefined;
  const acceptedRelationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.dc_health:overseen_by:dc.committee_on_health'`,
  ).get() as { relationshipId: string } | undefined;
  const blockedCount = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.council.committees.committee_on_health_oversight_1'
       and state = 'blocked'`,
  ).get() as { count: number };
  workbench.close();

  assert(seededCandidate);
  assertEquals(seededCandidate.proposedEntityId, "dc.dc_health");
  assertEquals(seededCandidate.reviewStatus, "accepted");
  assertEquals(canonicalEntity?.entityId, "dc.dc_health");
  assertEquals(canonicalEntity?.reviewStatus, "accepted");
  assertEquals(
    acceptedRelationship?.relationshipId,
    "dc.dc_health:overseen_by:dc.committee_on_health",
  );
  assertEquals(blockedCount.count, 0);
});

Deno.test("trusted committee candidates auto-promote during import and unblock relationship review", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const committee = workbench.db.prepare(
    `select review_status as reviewStatus
     from canonical_entities
     where entity_id = 'dc.committee_of_the_whole'`,
  ).get() as { reviewStatus: string } | undefined;
  const blocked = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.council.committees.committee_of_the_whole_part_of'
       and state = 'blocked'`,
  ).get() as { count: number };
  const relationship = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.committee_of_the_whole:part_of:dc.council_of_the_district_of_columbia'`,
  ).get() as { relationshipId: string } | undefined;
  const relationshipItems = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "part_of",
    subjectPrefix: "relationship.council.committees",
  });
  const entityItems = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix: "candidate.council.committees",
  });
  workbench.close();

  assertEquals(committee?.reviewStatus, "accepted");
  assertEquals(blocked.count, 0);
  assertEquals(
    relationship?.relationshipId,
    "dc.committee_of_the_whole:part_of:dc.council_of_the_district_of_columbia",
  );
  assertEquals(
    relationshipItems.some((item) =>
      item.subjectId === "relationship.council.committees.committee_of_the_whole_part_of"
    ),
    false,
  );
  assertEquals(
    entityItems.some((item) =>
      item.subjectId === "candidate.council.committees.committee_of_the_whole"
    ),
    false,
  );
});

Deno.test("merging a prerequisite entity candidate reprocesses blocked relationships into review-ready work", async () => {
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
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.reprocess.merge.relationships",
      relationshipCandidateId: "relationship.test.reprocess.merge",
      sourceItemKey: "merge-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.merged_target",
      relationshipType: "governed_by",
      rawValue: "Merged Target",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reprocess.merge.entities",
      candidateId: "candidate.test.reprocess.merge",
      sourceItemKey: "merge-entity-row",
      proposedEntityId: "dc.unmerged_target",
      name: "Merged Target",
      kind: "agency",
      observedName: "Merged Target",
    }),
    dataDir,
  );

  const before = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reprocess",
  });
  const blockedBefore = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reprocess.merge'
       and state = 'blocked'`,
  ).get() as { count: number };

  await workbench.appendResolutionEvent(
    {
      eventType: "merge_entity_candidates",
      subjectId: "candidate.test.reprocess.merge",
      payload: {
        entityId: "dc.merged_target",
        candidateIds: ["candidate.test.reprocess.merge"],
      },
    },
    resolutionsDir,
  );

  const after = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reprocess",
  });
  const blockedAfter = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reprocess.merge'
       and state = 'blocked'`,
  ).get() as { count: number };
  const mergedTarget = workbench.db.prepare(
    "select review_status as reviewStatus from canonical_entities where entity_id = 'dc.merged_target'",
  ).get() as { reviewStatus: string };
  workbench.close();

  assertEquals(before.length, 0);
  assertEquals(blockedBefore.count, 1);
  assertEquals(mergedTarget.reviewStatus, "accepted");
  assert(
    after.some((item) => item.subjectId === "relationship.test.reprocess.merge"),
  );
  assertEquals(blockedAfter.count, 0);
});

Deno.test("relationship review items are rebuilt from workbench state without connector templates", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name, kind] of [
      ["dc.office_of_planning", "Office of Planning", "office"],
      ["dc.committee_of_the_whole", "Committee of the Whole", "committee"],
    ] as const
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name, kind);
  }

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return `
            <html><body>
              <a href="https://dccouncil.gov/committees/committee-of-the-whole/">Committee of the Whole</a>
            </body></html>
          `;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return `
            <html><body>
              <h1>Committee of the Whole</h1>
              <h2>Oversight</h2>
              <ul>
                <li>Office of Planning (including commemorative works)</li>
              </ul>
            </body></html>
          `;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  const result = await getConnector("council.committees").run(createConnectorContext({ fetcher }));
  for (const endpointResult of result.endpointResults) {
    if (!endpointResult.parsed?.reviewItems) continue;
    endpointResult.parsed.reviewItems = endpointResult.parsed.reviewItems.filter((item) =>
      item.itemType !== "relationship_candidate"
    );
  }

  await workbench.importConnectorResult(result, dataDir);
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.council.committees.committee_of_the_whole",
      payload: {},
    },
    resolutionsDir,
  );

  const item = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees",
  }).find((reviewItem) =>
    reviewItem.subjectId === "relationship.council.committees.committee_of_the_whole_oversight_1"
  );
  workbench.close();

  assert(item);
  assertEquals(item.reason, "Review Council committee oversight relationship");
  assertEquals(item.defaultAction, "defer");
  assertEquals(item.details.relationshipType, "overseen_by");
  assertEquals(item.details.fromEntityRef, "dc.office_of_planning");
  assertEquals(item.details.toEntityRef, "dc.committee_of_the_whole");
});

Deno.test("blocked relationship acceptance fails instead of creating placeholder entities", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  await assertRejects(
    () =>
      workbench.appendResolutionEvent(
        {
          eventType: "accept_relationship_candidate",
          subjectId: "relationship.council.committees.committee_of_the_whole_part_of",
          payload: {},
        },
        resolutionsDir,
      ),
    Error,
    "Cannot accept blocked relationship candidate",
  );

  const placeholder = workbench.db.prepare(
    "select count(*) as count from canonical_entities where is_placeholder = 1",
  ).get() as { count: number };
  workbench.close();

  assertEquals(placeholder.count, 0);
});

Deno.test("placeholder endpoints keep relationship candidates blocked until the placeholder is resolved", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'placeholder', 'placeholder', '[]', 1, 'fixture placeholder', datetime('now'), datetime('now'))",
  ).run();

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.council.committees.committee_of_the_whole",
      payload: {},
    },
    resolutionsDir,
  );

  const blockedBefore = workbench.db.prepare(
    `select details_json as detailsJson
     from reconciliation_items
     where subject_id = 'relationship.council.committees.committee_of_the_whole_part_of'
       and state = 'blocked'`,
  ).get() as { detailsJson: string } | undefined;
  const reviewBefore = workbench.listReviewItems({
    mode: "relationships",
    relationshipType: "part_of",
    subjectPrefix: "relationship.council.committees",
  });

  workbench.db.prepare(
    "update canonical_entities set name = 'Council of the District of Columbia', kind = 'council', review_status = 'accepted', is_placeholder = 0, placeholder_reason = null, updated_at = datetime('now') where entity_id = 'dc.council_of_the_district_of_columbia'",
  ).run();
  workbench.init();

  const blockedAfter = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.council.committees.committee_of_the_whole_part_of'
       and state = 'blocked'`,
  ).get() as { count: number };
  const relationshipAfter = workbench.db.prepare(
    `select relationship_id as relationshipId
     from canonical_relationships
     where relationship_id = 'dc.committee_of_the_whole:part_of:dc.council_of_the_district_of_columbia'`,
  ).get() as { relationshipId: string } | undefined;
  workbench.close();

  assert(blockedBefore);
  assertStringIncludes(blockedBefore.detailsJson, '"state":"placeholder"');
  assertEquals(reviewBefore.length, 0);
  assertEquals(blockedAfter.count, 0);
  assertEquals(
    relationshipAfter?.relationshipId,
    "dc.committee_of_the_whole:part_of:dc.council_of_the_district_of_columbia",
  );
});

Deno.test("dcgis agency taxonomy labels stay source evidence instead of canonical fields", async () => {
  const rowsFixture = {
    features: [{
      attributes: {
        AGENCY_ID: 1032,
        AGENCY_NAME: "Department of Employment Services",
        TYPE: "Agency",
        BRANCH: "Executive",
        MAYORAL_CLUSTER: "Education",
        WEB_URL: "https://does.dc.gov/",
        LEGISLATION: "",
      },
    }, {
      attributes: {
        AGENCY_ID: 1083,
        AGENCY_NAME: "Office of the Attorney General",
        TYPE: "Agency",
        BRANCH: "Judicial",
        MAYORAL_CLUSTER: "Governmental Direction and Support",
        WEB_URL: "https://oag.dc.gov/",
        LEGISLATION: "",
      },
    }],
  };

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
          return JSON.stringify(rowsFixture);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return dcgisMetadataFixture as T;
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
          return rowsFixture as T;
        default:
          throw new Error(`Unexpected url ${url}`) as T;
      }
    },
  });

  const result = await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher }));
  const parsed = result.endpointResults[0]?.parsed;
  if (!parsed) throw new Error("Expected parsed DCGIS output");
  const doesCandidate = parsed.entityCandidates?.find((item) =>
    item.candidateId === "candidate.dcgis.agencies.1032"
  );
  const oagCandidate = parsed.entityCandidates?.find((item) =>
    item.candidateId === "candidate.dcgis.agencies.1083"
  );

  assert(doesCandidate);
  assertEquals(doesCandidate.branch, undefined);
  assertEquals(doesCandidate.cluster, undefined);
  assertEquals(
    doesCandidate.evidence.find((item) => item.fieldPath === "MAYORAL_CLUSTER")?.observedValue,
    "Education",
  );
  assert(oagCandidate);
  assertEquals(oagCandidate.branch, undefined);
  assertEquals(oagCandidate.cluster, undefined);
  assertEquals(
    oagCandidate.evidence.find((item) => item.fieldPath === "BRANCH")?.observedValue,
    "Judicial",
  );
  assertEquals(parsed.relationshipCandidates?.length ?? 0, 0);
});

Deno.test("dcgis agency aliases propose shared canonical entity ids", async () => {
  const rowsFixture = {
    features: [{
      attributes: {
        AGENCY_ID: 1014,
        AGENCY_NAME: "DC Court of Appeals",
        TYPE: "Agency",
        BRANCH: "Judicial",
        MAYORAL_CLUSTER: "Governmental Direction and Support",
        WEB_URL: "https://www.dccourts.gov/court-of-appeals",
        LEGISLATION: "D.C. Code § 11-102",
      },
    }, {
      attributes: {
        AGENCY_ID: 1142,
        AGENCY_NAME: "DC Public Charter School Board ",
        TYPE: "Board",
        BRANCH: "Executive",
        MAYORAL_CLUSTER: "Education",
        WEB_URL: "https://www.dcpcsb.org/",
        LEGISLATION: "",
      },
    }],
  };
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
          return JSON.stringify(rowsFixture);
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return dcgisMetadataFixture as T;
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
          return rowsFixture as T;
        default:
          throw new Error(`Unexpected url ${url}`) as T;
      }
    },
  });

  const result = await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher }));
  const candidate = result.endpointResults[0]?.parsed?.entityCandidates?.find((item) =>
    item.candidateId === "candidate.dcgis.agencies.1014"
  );
  const branchRelationship = result.endpointResults[0]?.parsed?.relationshipCandidates?.find((
    item,
  ) => item.relationshipCandidateId === "relationship.dcgis.agencies.1014_branch");
  const legalRef = result.endpointResults[0]?.parsed?.legalRefs?.[0];
  const pcsbCandidate = result.endpointResults[0]?.parsed?.entityCandidates?.find((item) =>
    item.candidateId === "candidate.dcgis.agencies.1142"
  );

  assert(candidate);
  assertEquals(candidate.name, "DC Court of Appeals");
  assertEquals(candidate.proposedEntityId, "dc.court_of_appeals");
  assertEquals(candidate.branch, undefined);
  assertEquals(branchRelationship, undefined);
  assert(legalRef);
  assertEquals(legalRef.attachEntityRef, "dc.court_of_appeals");
  assert(pcsbCandidate);
  assertEquals(pcsbCandidate.name, "DC Public Charter School Board");
  assertEquals(pcsbCandidate.proposedEntityId, "dc.public_charter_school_board_pcsb");
});

Deno.test("dcgis agency branch labels do not emit structural relationships", async () => {
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json":
          return JSON.stringify(dcgisMetadataFixture);
        case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=*&orderByFields=OBJECTID&returnGeometry=false&f=json":
          return JSON.stringify({
            features: [
              {
                attributes: {
                  AGENCY_ID: 3001,
                  AGENCY_NAME: "Example Residual Agency",
                  TYPE: "Agency",
                  BRANCH: "Other",
                  MAYORAL_CLUSTER: "",
                  WEB_URL: "",
                  LEGISLATION: "",
                },
              },
              {
                attributes: {
                  AGENCY_ID: 3002,
                  AGENCY_NAME: "Example Settlement Fund",
                  TYPE: "Budgetary",
                  BRANCH: "Other",
                  MAYORAL_CLUSTER: "",
                  WEB_URL: "",
                  LEGISLATION: "",
                },
              },
              {
                attributes: {
                  AGENCY_ID: 3003,
                  AGENCY_NAME: "Example Transit Authority",
                  TYPE: "Non-DC Government",
                  BRANCH: "Other",
                  MAYORAL_CLUSTER: "",
                  WEB_URL: "",
                  LEGISLATION: "",
                },
              },
            ],
          });
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });

  const result = await getConnector("dcgis.agencies").run(createConnectorContext({ fetcher }));
  const parsed = result.endpointResults[0]?.parsed;
  if (!parsed) throw new Error("Expected parsed DCGIS output");
  const otherBranchRelationships = (parsed.relationshipCandidates ?? []).filter((candidate) =>
    candidate.relationshipType === "part_of"
  );

  assertEquals(otherBranchRelationships.length, 0);
});

Deno.test("accepted prerequisite refetch clears stale blocker and reprocesses dependent relationship", async () => {
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
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.refetch.entities",
      candidateId: "candidate.test.reconciliation.refetch.target_v1",
      sourceItemKey: "refetch-target-row",
      proposedEntityId: "dc.refetch_target",
      name: "Refetch Target",
      kind: "agency",
      observedName: "Refetch Target",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.reconciliation.refetch.target_v1",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.refetch.entities",
      candidateId: "candidate.test.reconciliation.refetch.target_v2",
      sourceItemKey: "refetch-target-row",
      proposedEntityId: "dc.refetch_target",
      name: "Refetch Target",
      kind: "agency",
      observedName: "Refetch Target Updated",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.reconciliation.refetch.relationships",
      relationshipCandidateId: "relationship.test.reconciliation.refetch",
      sourceItemKey: "refetch-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.refetch_target",
      relationshipType: "governed_by",
      rawValue: "Refetch Target Updated",
    }),
    dataDir,
  );

  const blockedBefore = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reconciliation.refetch'
       and state = 'blocked'`,
  ).get() as { count: number };
  const reviewBefore = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reconciliation.refetch",
  });

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.refetch.entities",
      candidateId: "candidate.test.reconciliation.refetch.target_v3",
      sourceItemKey: "refetch-target-row",
      proposedEntityId: "dc.refetch_target",
      name: "Refetch Target",
      kind: "agency",
      observedName: "Refetch Target",
    }),
    dataDir,
  );

  const blockedAfter = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reconciliation.refetch'
       and state = 'blocked'`,
  ).get() as { count: number };
  const reviewAfter = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reconciliation.refetch",
  });
  workbench.close();

  assertEquals(blockedBefore.count, 1);
  assertEquals(reviewBefore.length, 0);
  assertEquals(blockedAfter.count, 0);
  assert(
    reviewAfter.some((item) => item.subjectId === "relationship.test.reconciliation.refetch"),
  );
});

Deno.test("accepting a replay-conflict prerequisite reprocesses blocked relationships into review-ready work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.source_board', 'Source Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.existing_board', 'Existing Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.conflict.resolve.entities",
      candidateId: "candidate.test.reconciliation.conflict.resolve.target_v1",
      sourceItemKey: "conflict-resolve-target-row",
      proposedEntityId: "dc.conflict_resolve_target",
      name: "Conflict Resolve Target",
      kind: "agency",
      observedName: "Conflict Resolve Target",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "merge_entity_candidates",
      subjectId: "candidate.test.reconciliation.conflict.resolve.target_v1",
      payload: {
        entityId: "dc.existing_board",
        candidateIds: ["candidate.test.reconciliation.conflict.resolve.target_v1"],
      },
    },
    resolutionsDir,
  );
  workbench.db.prepare("delete from canonical_entities where entity_id = 'dc.existing_board'")
    .run();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.conflict.resolve.entities",
      candidateId: "candidate.test.reconciliation.conflict.resolve.target_v2",
      sourceItemKey: "conflict-resolve-target-row",
      proposedEntityId: "dc.conflict_resolve_target",
      name: "Conflict Resolve Target",
      kind: "agency",
      observedName: "Conflict Resolve Target",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.reconciliation.conflict.resolve.relationships",
      relationshipCandidateId: "relationship.test.reconciliation.conflict.resolve",
      sourceItemKey: "conflict-resolve-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.conflict_resolve_target",
      relationshipType: "governed_by",
      rawValue: "Conflict Resolve Target",
    }),
    dataDir,
  );

  const blockedBefore = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reconciliation.conflict.resolve'
       and state = 'blocked'`,
  ).get() as { count: number };

  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.reconciliation.conflict.resolve.target_v2",
      payload: {},
    },
    resolutionsDir,
  );

  const blockedAfter = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reconciliation.conflict.resolve'
       and state = 'blocked'`,
  ).get() as { count: number };
  const reviewAfter = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reconciliation.conflict.resolve",
  });
  workbench.close();

  assertEquals(blockedBefore.count, 1);
  assertEquals(blockedAfter.count, 0);
  assert(
    reviewAfter.some((item) =>
      item.subjectId === "relationship.test.reconciliation.conflict.resolve"
    ),
  );
});

Deno.test("accepting a deferred prerequisite reprocesses blocked relationships into review-ready work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.source_board', 'Source Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  const candidateId = "candidate.test.reconciliation.deferred.resolve.target_v1";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.deferred.resolve.entities",
      candidateId,
      sourceItemKey: "deferred-resolve-target-row",
      proposedEntityId: "dc.deferred_resolve_target",
      name: "Deferred Resolve Target",
      kind: "agency",
      observedName: "Deferred Resolve Target",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(candidateId, "entity-review"),
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.reconciliation.deferred.resolve.relationships",
      relationshipCandidateId: "relationship.test.reconciliation.deferred.resolve",
      sourceItemKey: "deferred-resolve-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.deferred_resolve_target",
      relationshipType: "governed_by",
      rawValue: "Deferred Resolve Target",
    }),
    dataDir,
  );

  const blockedBefore = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reconciliation.deferred.resolve'
       and state = 'blocked'`,
  ).get() as { count: number };

  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: candidateId,
      payload: {},
    },
    resolutionsDir,
  );

  const blockedAfter = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reconciliation.deferred.resolve'
       and state = 'blocked'`,
  ).get() as { count: number };
  const reviewAfter = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reconciliation.deferred.resolve",
  });
  workbench.close();

  assertEquals(blockedBefore.count, 1);
  assertEquals(blockedAfter.count, 0);
  assert(
    reviewAfter.some((item) =>
      item.subjectId === "relationship.test.reconciliation.deferred.resolve"
    ),
  );
});

Deno.test("accepting a corrected stale prerequisite after rejection reprocesses blocked relationships into review-ready work", async () => {
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
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.rejected.resolve.entities",
      candidateId: "candidate.test.reconciliation.rejected.resolve.target_v1",
      sourceItemKey: "rejected-resolve-target-row",
      proposedEntityId: "dc.rejected_resolve_target",
      name: "Rejected Resolve Target",
      kind: "agency",
      observedName: "Rejected Resolve Target",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "reject_entity_candidate",
      subjectId: "candidate.test.reconciliation.rejected.resolve.target_v1",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.rejected.resolve.entities",
      candidateId: "candidate.test.reconciliation.rejected.resolve.target_v2",
      sourceItemKey: "rejected-resolve-target-row",
      proposedEntityId: "dc.rejected_resolve_target",
      name: "Rejected Resolve Target",
      kind: "agency",
      observedName: "Rejected Resolve Target Updated",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.reconciliation.rejected.resolve.relationships",
      relationshipCandidateId: "relationship.test.reconciliation.rejected.resolve",
      sourceItemKey: "rejected-resolve-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.rejected_resolve_target",
      relationshipType: "governed_by",
      rawValue: "Rejected Resolve Target Updated",
    }),
    dataDir,
  );

  const blockedBefore = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reconciliation.rejected.resolve'
       and state = 'blocked'`,
  ).get() as { count: number };

  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.reconciliation.rejected.resolve.target_v2",
      payload: {},
    },
    resolutionsDir,
  );

  const blockedAfter = workbench.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_id = 'relationship.test.reconciliation.rejected.resolve'
       and state = 'blocked'`,
  ).get() as { count: number };
  const reviewAfter = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reconciliation.rejected.resolve",
  });
  workbench.close();

  assertEquals(blockedBefore.count, 1);
  assertEquals(blockedAfter.count, 0);
  assert(
    reviewAfter.some((item) =>
      item.subjectId === "relationship.test.reconciliation.rejected.resolve"
    ),
  );
});
