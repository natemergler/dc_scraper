import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildReviewItemId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { quickbaseAppointmentsCsvFixture, quickbaseFixture } from "./helpers/v2_fixtures.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("status json reports blocked reconciliation counts", async () => {
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
  workbench.close();

  const statusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const status = JSON.parse(new TextDecoder().decode(statusOutput.stdout)) as {
    reconciliation: {
      blocked: number;
      firstBlockedReason?: string;
      blockedByRelationshipType: Array<{ relationshipType: string; count: number }>;
      firstBlocked?: {
        subjectId: string;
        relationshipType: string;
        blockers: Array<{ blockerId: string; blockerState: string }>;
      };
    };
  };

  assertEquals(statusOutput.code, 0);
  assert(status.reconciliation.blocked > 0);
  assertEquals(status.reconciliation.firstBlockedReason, "unresolved_endpoints");
  assert(
    status.reconciliation.blockedByRelationshipType.some((row) =>
      row.relationshipType === "governed_by" && row.count > 0
    ),
  );
  assert(status.reconciliation.firstBlocked);
  assert(status.reconciliation.firstBlocked.blockers.length > 0);
});

Deno.test("status surfaces blocked work by source with readable blocker labels", async () => {
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
      sourceId: "test.reconciliation.status.relationships",
      relationshipCandidateId: "relationship.test.reconciliation.status.pending",
      sourceItemKey: "status-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.pending_target",
      relationshipType: "governed_by",
      rawValue: "Pending Target",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.status.entities",
      candidateId: "candidate.test.reconciliation.status.pending_target",
      sourceItemKey: "status-entity-row",
      proposedEntityId: "dc.pending_target",
      name: "Pending Target",
      kind: "agency",
      observedName: "Pending Target",
    }),
    dataDir,
  );
  workbench.close();

  const statusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const status = JSON.parse(new TextDecoder().decode(statusOutput.stdout)) as {
    reconciliation: {
      blockedBySource: Array<{ sourceId: string; count: number }>;
      firstBlocked?: {
        sourceId: string;
        blockers: Array<{ blockerId: string; blockerState: string; blockerLabel: string }>;
      };
    };
  };

  assertEquals(statusOutput.code, 0);
  assert(
    status.reconciliation.blockedBySource.some((row) =>
      row.sourceId === "test.reconciliation.status.relationships" && row.count > 0
    ),
  );
  assertEquals(
    status.reconciliation.firstBlocked?.sourceId,
    "test.reconciliation.status.relationships",
  );
  assert(
    status.reconciliation.firstBlocked?.blockers.some((blocker) =>
      blocker.blockerState === "pending_candidate" && blocker.blockerLabel === "Pending Target"
    ),
  );
});

Deno.test("rejecting a prerequisite keeps dependent relationships blocked with rejected blocker audit", async () => {
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
      sourceId: "test.reconciliation.reject.relationships",
      relationshipCandidateId: "relationship.test.reconciliation.reject",
      sourceItemKey: "reject-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.rejected_target",
      relationshipType: "governed_by",
      rawValue: "Rejected Target",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.reject.entities",
      candidateId: "candidate.test.reconciliation.reject.target",
      sourceItemKey: "reject-entity-row",
      proposedEntityId: "dc.rejected_target",
      name: "Rejected Target",
      kind: "agency",
      observedName: "Rejected Target",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "reject_entity_candidate",
      subjectId: "candidate.test.reconciliation.reject.target",
      payload: {},
    },
    resolutionsDir,
  );
  workbench.close();

  const statusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const status = JSON.parse(new TextDecoder().decode(statusOutput.stdout)) as {
    reconciliation: {
      blockedByBlockerState: Array<{ blockerState: string; count: number }>;
      firstBlocked?: {
        blockers: Array<{ blockerId: string; blockerState: string; blockerLabel: string }>;
      };
    };
  };

  assertEquals(statusOutput.code, 0);
  assert(
    status.reconciliation.blockedByBlockerState.some((row) =>
      row.blockerState === "rejected_candidate" && row.count > 0
    ),
  );
  assert(
    status.reconciliation.firstBlocked?.blockers.some((blocker) =>
      blocker.blockerState === "rejected_candidate" && blocker.blockerLabel === "Rejected Target"
    ),
  );
});

Deno.test("stale prerequisite candidates surface stale blocker audit for dependent relationships", async () => {
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
      sourceId: "test.reconciliation.stale.entities",
      candidateId: "candidate.test.reconciliation.stale.target_v1",
      sourceItemKey: "stale-target-row",
      proposedEntityId: "dc.stale_target",
      name: "Stale Target",
      kind: "agency",
      observedName: "Stale Target",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "reject_entity_candidate",
      subjectId: "candidate.test.reconciliation.stale.target_v1",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.stale.entities",
      candidateId: "candidate.test.reconciliation.stale.target_v2",
      sourceItemKey: "stale-target-row",
      proposedEntityId: "dc.stale_target",
      name: "Stale Target",
      kind: "agency",
      observedName: "Stale Target Updated",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.reconciliation.stale.relationships",
      relationshipCandidateId: "relationship.test.reconciliation.stale",
      sourceItemKey: "stale-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.stale_target",
      relationshipType: "governed_by",
      rawValue: "Stale Target Updated",
    }),
    dataDir,
  );

  const blocked = workbench.db.prepare(
    `select blocker_state as blockerState,
            details_json as detailsJson
     from reconciliation_blockers
     where subject_type = 'relationship_candidate'
       and subject_id = 'relationship.test.reconciliation.stale'`,
  ).get() as { blockerState: string; detailsJson: string } | undefined;
  const relationshipReviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reconciliation",
  });
  workbench.close();

  assert(blocked);
  assertEquals(blocked.blockerState, "stale_candidate");
  assertStringIncludes(blocked.detailsJson, '"state":"stale_candidate"');
  assertEquals(relationshipReviewItems.length, 0);

  const statusOutput = await new Deno.Command("deno", {
    args: ["run", "-A", "scripts/dc.ts", "status", "--db", dbPath, "--json"],
    cwd: Deno.cwd(),
  }).output();
  assertEquals(statusOutput.code, 0);
  const status = JSON.parse(new TextDecoder().decode(statusOutput.stdout)) as {
    reconciliation: {
      blockedByBlockerState: Array<{ blockerState: string; count: number }>;
      firstBlocked?: {
        subjectId: string;
        blockers: Array<{ blockerState: string; blockerLabel: string }>;
      };
    };
  };

  assert(
    status.reconciliation.blockedByBlockerState.some((row) =>
      row.blockerState === "stale_candidate" && row.count === 1
    ),
  );
  assertEquals(
    status.reconciliation.firstBlocked?.subjectId,
    "relationship.test.reconciliation.stale",
  );
  assert(
    status.reconciliation.firstBlocked?.blockers.some((blocker) =>
      blocker.blockerState === "stale_candidate" && blocker.blockerLabel === "Stale Target"
    ),
  );
});

Deno.test("replay-conflict prerequisite candidates surface conflict blocker audit for dependent relationships", async () => {
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
      sourceId: "test.reconciliation.conflict.entities",
      candidateId: "candidate.test.reconciliation.conflict.target_v1",
      sourceItemKey: "conflict-target-row",
      proposedEntityId: "dc.conflict_target",
      name: "Conflict Target",
      kind: "agency",
      observedName: "Conflict Target",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "merge_entity_candidates",
      subjectId: "candidate.test.reconciliation.conflict.target_v1",
      payload: {
        entityId: "dc.existing_board",
        candidateIds: ["candidate.test.reconciliation.conflict.target_v1"],
      },
    },
    resolutionsDir,
  );
  workbench.db.prepare("delete from canonical_entities where entity_id = 'dc.existing_board'")
    .run();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.conflict.entities",
      candidateId: "candidate.test.reconciliation.conflict.target_v2",
      sourceItemKey: "conflict-target-row",
      proposedEntityId: "dc.conflict_target",
      name: "Conflict Target",
      kind: "agency",
      observedName: "Conflict Target",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.reconciliation.conflict.relationships",
      relationshipCandidateId: "relationship.test.reconciliation.conflict",
      sourceItemKey: "conflict-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.conflict_target",
      relationshipType: "governed_by",
      rawValue: "Conflict Target",
    }),
    dataDir,
  );

  const blocked = workbench.db.prepare(
    `select blocker_state as blockerState,
            details_json as detailsJson
     from reconciliation_blockers
     where subject_type = 'relationship_candidate'
       and subject_id = 'relationship.test.reconciliation.conflict'`,
  ).get() as { blockerState: string; detailsJson: string } | undefined;
  const relationshipReviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reconciliation.conflict",
  });
  workbench.close();

  assert(blocked);
  assertEquals(blocked.blockerState, "replay_conflict");
  assertStringIncludes(blocked.detailsJson, '"state":"replay_conflict"');
  assertEquals(relationshipReviewItems.length, 0);

  const statusOutput = await new Deno.Command("deno", {
    args: ["run", "-A", "scripts/dc.ts", "status", "--db", dbPath, "--json"],
    cwd: Deno.cwd(),
  }).output();
  assertEquals(statusOutput.code, 0);
  const status = JSON.parse(new TextDecoder().decode(statusOutput.stdout)) as {
    reconciliation: {
      blockedByBlockerState: Array<{ blockerState: string; count: number }>;
      firstBlocked?: {
        subjectId: string;
        blockers: Array<{ blockerState: string; blockerLabel: string }>;
      };
    };
  };

  assert(
    status.reconciliation.blockedByBlockerState.some((row) =>
      row.blockerState === "replay_conflict" && row.count === 1
    ),
  );
  assertEquals(
    status.reconciliation.firstBlocked?.subjectId,
    "relationship.test.reconciliation.conflict",
  );
  assert(
    status.reconciliation.firstBlocked?.blockers.some((blocker) =>
      blocker.blockerState === "replay_conflict" && blocker.blockerLabel === "Conflict Target"
    ),
  );
});

Deno.test("deferred prerequisite candidates surface deferred blocker audit for dependent relationships", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.source_board', 'Source Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  const candidateId = "candidate.test.reconciliation.deferred.target_v1";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.reconciliation.deferred.entities",
      candidateId,
      sourceItemKey: "deferred-target-row",
      proposedEntityId: "dc.deferred_target",
      name: "Deferred Target",
      kind: "agency",
      observedName: "Deferred Target",
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
      sourceId: "test.reconciliation.deferred.relationships",
      relationshipCandidateId: "relationship.test.reconciliation.deferred",
      sourceItemKey: "deferred-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.deferred_target",
      relationshipType: "governed_by",
      rawValue: "Deferred Target",
    }),
    dataDir,
  );

  const blocked = workbench.db.prepare(
    `select blocker_state as blockerState,
            details_json as detailsJson
     from reconciliation_blockers
     where subject_type = 'relationship_candidate'
       and subject_id = 'relationship.test.reconciliation.deferred'`,
  ).get() as { blockerState: string; detailsJson: string } | undefined;
  const relationshipReviewItems = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.reconciliation.deferred",
  });
  workbench.close();

  assert(blocked);
  assertEquals(blocked.blockerState, "deferred_candidate");
  assertStringIncludes(blocked.detailsJson, '"state":"deferred_candidate"');
  assertEquals(relationshipReviewItems.length, 0);

  const statusOutput = await new Deno.Command("deno", {
    args: ["run", "-A", "scripts/dc.ts", "status", "--db", dbPath, "--json"],
    cwd: Deno.cwd(),
  }).output();
  assertEquals(statusOutput.code, 0);
  const status = JSON.parse(new TextDecoder().decode(statusOutput.stdout)) as {
    reconciliation: {
      blockedByBlockerState: Array<{ blockerState: string; count: number }>;
      firstBlocked?: {
        subjectId: string;
        blockers: Array<{ blockerState: string; blockerLabel: string }>;
      };
    };
  };

  assert(
    status.reconciliation.blockedByBlockerState.some((row) =>
      row.blockerState === "deferred_candidate" && row.count === 1
    ),
  );
  assertEquals(
    status.reconciliation.firstBlocked?.subjectId,
    "relationship.test.reconciliation.deferred",
  );
  assert(
    status.reconciliation.firstBlocked?.blockers.some((blocker) =>
      blocker.blockerState === "deferred_candidate" &&
      blocker.blockerLabel === "Deferred Target"
    ),
  );
});
