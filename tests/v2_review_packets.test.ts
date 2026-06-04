import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { Workbench } from "../src/v2/workbench.ts";
import { listReviewPackets } from "../src/v2/workbench/review_packets.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
  syntheticRelationshipSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("review packets group explicit-safe and high-confidence entity work without planning batches", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.packet.mixed_entities",
      candidateId: "candidate.test.packet.mixed_entities.explicit",
      sourceItemKey: "mixed-explicit-entity-row",
      proposedEntityId: "dc.packet_mixed_explicit_entity",
      name: "Packet Mixed Explicit Entity",
      kind: "board",
      observedName: "Packet Mixed Explicit Entity",
    }),
    dataDir,
  );
  workbench.db.prepare(
    "update review_items set details_json = ? where subject_id = ?",
  ).run(
    JSON.stringify({
      name: "Packet Mixed Explicit Entity",
      kind: "board",
      safeToAutoAccept: true,
    }),
    "candidate.test.packet.mixed_entities.explicit",
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.packet.mixed_entities",
      candidateId: "candidate.test.packet.mixed_entities.high_confidence",
      sourceItemKey: "mixed-high-confidence-entity-row",
      proposedEntityId: "dc.packet_mixed_high_confidence_entity",
      name: "Packet Mixed High Confidence Entity",
      kind: "board",
      observedName: "Packet Mixed High Confidence Entity",
      confidence: 0.95,
    }),
    dataDir,
  );
  workbench.close();

  const output = await runDc([
    "review",
    "packets",
    "--mode",
    "entities",
    "--db",
    dbPath,
    "--json",
  ]);
  const body = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    packets: Array<{
      itemType: string;
      sourceId: string;
      count: number;
      subjectPrefix?: string;
      nextCommand?: string;
    }>;
  };

  assertEquals(output.code, 0);
  assertEquals(body.packets.length, 0);

  const rawOutput = await runDc([
    "review",
    "packets",
    "--mode",
    "entities",
    "--status",
    "all",
    "--db",
    dbPath,
    "--json",
  ]);
  const rawBody = JSON.parse(new TextDecoder().decode(rawOutput.stdout)) as {
    includeReviewItemIds: boolean;
    packets: Array<{
      itemType: string;
      sourceId: string;
      count: number;
      subjectPrefix?: string;
      reviewItemIds?: string[];
      nextCommand?: string;
    }>;
  };

  assertEquals(rawOutput.code, 0);
  assertEquals(rawBody.includeReviewItemIds, false);
  assertEquals(rawBody.packets.length, 1);
  assertEquals(rawBody.packets[0].itemType, "entity_candidate");
  assertEquals(rawBody.packets[0].sourceId, "test.packet.mixed_entities");
  assertEquals(rawBody.packets[0].count, 2);
  assertEquals(rawBody.packets[0].subjectPrefix, "candidate.test.packet.mixed_entities");
  assertEquals(rawBody.packets[0].reviewItemIds, undefined);
  assertEquals(rawBody.packets[0].nextCommand, undefined);

  const rawIdsOutput = await runDc([
    "review",
    "packets",
    "--mode",
    "entities",
    "--status",
    "all",
    "--db",
    dbPath,
    "--json",
    "--include-review-item-ids",
  ]);
  const rawIdsBody = JSON.parse(new TextDecoder().decode(rawIdsOutput.stdout)) as {
    includeReviewItemIds: boolean;
    packets: Array<{
      reviewItemIds?: string[];
    }>;
  };

  assertEquals(rawIdsOutput.code, 0);
  assertEquals(rawIdsBody.includeReviewItemIds, true);
  assertEquals(rawIdsBody.packets[0].reviewItemIds?.sort(), [
    "review.candidate_test_packet_mixed_entities_explicit.entity_review",
    "review.candidate_test_packet_mixed_entities_high_confidence.entity_review",
  ]);
});

Deno.test("review packet source lookup does not scale queries per item", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.packet.query_scaling",
      candidateId: "candidate.test.packet.query_scaling.one",
      sourceItemKey: "query-scaling-row-one",
      proposedEntityId: "dc.packet_query_scaling_one",
      name: "Packet Query Scaling One",
      kind: "board",
      observedName: "Packet Query Scaling One",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.packet.query_scaling",
      candidateId: "candidate.test.packet.query_scaling.two",
      sourceItemKey: "query-scaling-row-two",
      proposedEntityId: "dc.packet_query_scaling_two",
      name: "Packet Query Scaling Two",
      kind: "board",
      observedName: "Packet Query Scaling Two",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.packet.query_scaling",
      candidateId: "candidate.test.packet.query_scaling.three",
      sourceItemKey: "query-scaling-row-three",
      proposedEntityId: "dc.packet_query_scaling_three",
      name: "Packet Query Scaling Three",
      kind: "board",
      observedName: "Packet Query Scaling Three",
    }),
    dataDir,
  );

  const oneItemPrepareCount = countPacketPrepares(workbench, {
    mode: "entities",
    subjectPrefix: "candidate.test.packet.query_scaling.one",
  });
  const allItemsPrepareCount = countPacketPrepares(workbench, {
    mode: "entities",
    subjectPrefix: "candidate.test.packet.query_scaling",
  });
  workbench.close();

  assertEquals(oneItemPrepareCount, 1);
  assertEquals(allItemsPrepareCount, oneItemPrepareCount);
});

Deno.test("review packets groups related relationship work conservatively", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  seedAcceptedEntity(workbench, "dc.target_agency", "Target Agency", "agency");
  seedAcceptedEntity(workbench, "dc.alt_agency", "Alt Agency", "agency");
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_packets.group_a",
      relationshipCandidateId: "relationship.test.review_packets.group_a.review_packet_one",
      sourceItemKey: "review-packet-row-one",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Health's Work",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_packets.group_a",
      relationshipCandidateId: "relationship.test.review_packets.group_a.review_packet_two",
      sourceItemKey: "review-packet-row-two",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Education",
      needsReview: true,
    }),
    dataDir,
  );
  workbench.close();

  const output = await runDc([
    "review",
    "packets",
    "--mode",
    "relationships",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
    "--limit",
    "1",
    "--json",
  ]);

  assertEquals(output.code, 0);
  const body = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    count: number;
    packets: Array<{
      sourceId: string;
      relationshipType?: string;
      count: number;
      openCount: number;
      subjectPrefix?: string;
    }>;
  };
  assertEquals(body.count, 1);
  assertEquals(body.packets[0].sourceId, "test.review_packets.group_a");
  assertEquals(body.packets[0].relationshipType, "overseen_by");
  assertEquals(body.packets[0].count, 2);
  assertEquals(body.packets[0].openCount, 2);
  assertEquals(body.packets[0].subjectPrefix, "relationship.test.review_packets.group_a");

  const textOutput = await runDc([
    "review",
    "packets",
    "--mode",
    "relationships",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
    "--limit",
    "1",
  ]);

  assertEquals(textOutput.code, 0);
  const textBody = new TextDecoder().decode(textOutput.stdout);
  assertStringIncludes(textBody, "Decision packets: 1");
  assertStringIncludes(textBody, "[2] test.review_packets.group_a relationship_candidate");
  assertStringIncludes(
    textBody,
    "review: deno task dc -- review relationships --source test.review_packets.group_a --subject-prefix relationship.test.review_packets.group_a --relationship-type overseen_by",
  );
  assertEquals(textBody.includes("packet_id:"), false);

  const narrowedOutput = await runDc([
    "review",
    "packets",
    "--mode",
    "relationships",
    "--raw-value-contains",
    "Committee on Health's Work",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
    "--json",
  ]);

  assertEquals(narrowedOutput.code, 0);
  const narrowedBody = JSON.parse(new TextDecoder().decode(narrowedOutput.stdout)) as {
    count: number;
    packets: Array<{
      count: number;
      subjectPrefix?: string;
    }>;
  };
  assertEquals(narrowedBody.count, 1);
  assertEquals(narrowedBody.packets[0].count, 1);
  assertEquals(
    narrowedBody.packets[0].subjectPrefix,
    "relationship.test.review_packets.group_a.review_packet_one",
  );

  const broadPrefixOutput = await runDc([
    "review",
    "packets",
    "--mode",
    "relationships",
    "--subject-prefix",
    "relationship.test.review_packets",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
    "--json",
  ]);

  assertEquals(broadPrefixOutput.code, 0);
  const broadPrefixBody = JSON.parse(new TextDecoder().decode(broadPrefixOutput.stdout)) as {
    packets: Array<{ subjectPrefix?: string }>;
  };
  assertEquals(
    broadPrefixBody.packets[0].subjectPrefix,
    "relationship.test.review_packets.group_a",
  );

  const narrowPrefixOutput = await runDc([
    "review",
    "packets",
    "--mode",
    "relationships",
    "--subject-prefix",
    "relationship.test.review_packets.group_a.review_packet",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
    "--json",
  ]);

  assertEquals(narrowPrefixOutput.code, 0);
  const narrowPrefixBody = JSON.parse(new TextDecoder().decode(narrowPrefixOutput.stdout)) as {
    packets: Array<{ subjectPrefix?: string }>;
  };
  assertEquals(
    narrowPrefixBody.packets[0].subjectPrefix,
    "relationship.test.review_packets.group_a",
  );

  const segmentPrefixOutput = await runDc([
    "review",
    "packets",
    "--mode",
    "relationships",
    "--subject-prefix",
    "review_packet",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
    "--json",
  ]);

  assertEquals(segmentPrefixOutput.code, 0);
  const segmentPrefixBody = JSON.parse(new TextDecoder().decode(segmentPrefixOutput.stdout)) as {
    packets: Array<{ subjectPrefix?: string; nextCommand?: string }>;
  };
  assertEquals(
    segmentPrefixBody.packets[0].subjectPrefix,
    "relationship.test.review_packets.group_a",
  );
  assertEquals(segmentPrefixBody.packets[0].nextCommand, undefined);
});

Deno.test("review packets split deferred relationship work by target and defer reason", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(
    workbench,
    "dc.behavioral_health_planning_council",
    "Behavioral Health Planning Council",
    "council",
  );
  seedAcceptedEntity(
    workbench,
    "dc.health_literacy_council",
    "Health Literacy Council",
    "council",
  );
  seedAcceptedEntity(workbench, "dc.department_of_buildings", "Department of Buildings", "agency");
  seedAcceptedEntity(
    workbench,
    "dc.law_revision_commission",
    "Law Revision Commission",
    "commission",
  );
  seedAcceptedEntity(workbench, "dc.committee_on_health", "Committee on Health", "committee");
  seedAcceptedEntity(workbench, "dc.committee_of_the_whole", "Committee of the Whole", "committee");
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.review_packets.council.health_named.one",
      sourceItemKey: "review-packet-council-health-named-one",
      fromEntityRef: "dc.behavioral_health_planning_council",
      toEntityRef: "dc.committee_on_health",
      relationshipType: "overseen_by",
      rawValue: "Behavioral Health Planning Council",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.review_packets.council.health_named.two",
      sourceItemKey: "review-packet-council-health-named-two",
      fromEntityRef: "dc.health_literacy_council",
      toEntityRef: "dc.committee_on_health",
      relationshipType: "overseen_by",
      rawValue: "Health Literacy Council",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.review_packets.council.health_scoped",
      sourceItemKey: "review-packet-council-health-scoped",
      fromEntityRef: "dc.department_of_buildings",
      toEntityRef: "dc.committee_on_health",
      relationshipType: "overseen_by",
      rawValue: "Department of Buildings (excluding construction codes)",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.review_packets.council.whole_named",
      sourceItemKey: "review-packet-council-whole-named",
      fromEntityRef: "dc.law_revision_commission",
      toEntityRef: "dc.committee_of_the_whole",
      relationshipType: "overseen_by",
      rawValue: "Law Revision Commission",
      needsReview: true,
    }),
    dataDir,
  );
  workbench.close();

  const output = await runDc([
    "review",
    "packets",
    "--mode",
    "relationships",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
    "--json",
  ]);

  assertEquals(output.code, 0);
  const body = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    count: number;
    packets: Array<{
      sourceId: string;
      relationshipType?: string;
      count: number;
      toEntityRef?: string;
      whyDeferred?: string;
    }>;
  };
  assertEquals(body.count, 1);
  assertEquals(body.packets[0]?.sourceId, "council.committees");
  assertEquals(body.packets[0]?.relationshipType, "overseen_by");
  assertEquals(body.packets[0]?.count, 1);
  assertEquals(body.packets[0]?.toEntityRef, "dc.committee_on_health");
  assertStringIncludes(body.packets[0]?.whyDeferred ?? "", "exclusion wording");
});

Deno.test("review packet limits apply after grouping related work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  seedAcceptedEntity(workbench, "dc.target_agency", "Target Agency", "agency");
  seedAcceptedEntity(workbench, "dc.alt_agency", "Alt Agency", "agency");
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_packets.group_a",
      relationshipCandidateId: "relationship.test.review_packets.group_a.limit_group_a.one",
      sourceItemKey: "review-packet-limit-row-one",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "overseen_by",
      rawValue: "Alpha Committee",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_packets.group_a",
      relationshipCandidateId: "relationship.test.review_packets.group_a.limit_group_a.two",
      sourceItemKey: "review-packet-limit-row-two",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "overseen_by",
      rawValue: "Beta Committee",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_packets.group_b",
      relationshipCandidateId: "relationship.test.review_packets.group_b.one",
      sourceItemKey: "review-packet-limit-row-three",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "overseen_by",
      rawValue: "Gamma Committee",
    }),
    dataDir,
  );
  workbench.close();

  const output = await runDc([
    "review",
    "packets",
    "--mode",
    "relationships",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
    "--limit",
    "2",
    "--json",
  ]);

  assertEquals(output.code, 0);
  const body = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    count: number;
    packets: Array<{
      sourceId: string;
      count: number;
    }>;
  };
  assertEquals(body.count, 2);
  assertEquals(body.packets.length, 2);
  assertEquals(body.packets[0].sourceId, "test.review_packets.group_a");
  assertEquals(body.packets[0].count, 2);
  assertEquals(body.packets[1].sourceId, "test.review_packets.group_b");
  assertEquals(body.packets[1].count, 1);

  const rawOutput = await runDc([
    "review",
    "packets",
    "--mode",
    "relationships",
    "--status",
    "all",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
    "--limit",
    "2",
    "--json",
  ]);

  assertEquals(rawOutput.code, 0);
  const rawBody = JSON.parse(new TextDecoder().decode(rawOutput.stdout)) as {
    count: number;
    packets: Array<{
      sourceId: string;
      count: number;
    }>;
  };
  assertEquals(rawBody.count, 2);
  assertEquals(rawBody.packets.length, 2);
  assertEquals(rawBody.packets[0].sourceId, "test.review_packets.group_a");
  assertEquals(rawBody.packets[0].count, 2);
  assertEquals(rawBody.packets[1].sourceId, "test.review_packets.group_b");
  assertEquals(rawBody.packets[1].count, 1);
});

Deno.test("default review packets and interactive inbox put smaller high-impact work first", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  for (const name of ["One", "Two"]) {
    await workbench.importConnectorResult(
      syntheticCustomEntitySourceResult({
        sourceId: "aaa.review_packets.low_impact",
        candidateId: `candidate.aaa.review_packets.low_impact.${name.toLowerCase()}`,
        sourceItemKey: `low-impact-${name.toLowerCase()}-row`,
        proposedEntityId: `dc.low_impact_${name.toLowerCase()}`,
        name: `Low Impact ${name}`,
        kind: "board",
        observedName: `Low Impact ${name}`,
        needsReview: true,
      }),
      dataDir,
    );
  }
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "zzz.review_packets.high_impact",
      candidateId: "candidate.zzz.review_packets.high_impact.target",
      sourceItemKey: "high-impact-target-row",
      proposedEntityId: "dc.high_impact_target",
      name: "High Impact Target",
      kind: "agency",
      observedName: "High Impact Target",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "zzz.review_packets.high_impact",
      relationshipCandidateId: "relationship.zzz.review_packets.high_impact.blocked",
      sourceItemKey: "high-impact-blocked-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.high_impact_target",
      relationshipType: "overseen_by",
      rawValue: "High Impact Target",
    }),
    dataDir,
  );
  workbench.close();

  const packetOutput = await runDc([
    "review",
    "packets",
    "--mode",
    "entities",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
    "--json",
  ]);
  assertEquals(packetOutput.code, 0);
  const packetBody = JSON.parse(new TextDecoder().decode(packetOutput.stdout)) as {
    packets: Array<{ sourceId: string; count: number }>;
  };
  assertEquals(packetBody.packets.map((packet) => [packet.sourceId, packet.count]), [
    ["zzz.review_packets.high_impact", 1],
    ["aaa.review_packets.low_impact", 2],
  ]);

  const reviewProcess = new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "--mode",
      "entities",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = reviewProcess.stdin.getWriter();
  await writer.write(new TextEncoder().encode("q\n"));
  await writer.close();
  const reviewOutput = await reviewProcess.output();
  const reviewText = new TextDecoder().decode(reviewOutput.stdout);

  assertEquals(reviewOutput.code, 0);
  assertStringIncludes(
    reviewText,
    "1. [recommended] High Impact Target - zzz.review_packets.high_impact entity candidate [default accept; packet 1 open; unblocks 1]",
  );
});

Deno.test("review packets preserve resolved status filters", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  seedAcceptedEntity(workbench, "dc.target_agency", "Target Agency", "agency");
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.resolved_packet",
      sourceItemKey: "review-packet-resolved-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Health",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: "relationship.council.committees.resolved_packet",
      payload: {},
    },
    resolutionsDir,
  );
  workbench.close();

  const output = await runDc([
    "review",
    "packets",
    "--mode",
    "relationships",
    "--status",
    "resolved",
    "--db",
    dbPath,
    "--json",
  ]);

  assertEquals(output.code, 0);
  const body = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    packets: Array<{ openCount: number; subjectPrefix?: string; nextCommand?: string }>;
  };
  assertEquals(body.packets.length, 1);
  assertEquals(body.packets[0].openCount, 0);
  assertEquals(body.packets[0].subjectPrefix, "relationship.council.committees.resolved_packet");
  assertEquals(body.packets[0].nextCommand, undefined);
});

Deno.test("review packets keep stale prior-decision work grouped for review", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  seedAcceptedEntity(workbench, "dc.target_agency", "Target Agency", "agency");
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.stale_packet_v1",
      "Target Agency",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_relationship_candidate",
      subjectId: "relationship.test.signature.relationships.stale_packet_v1",
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.importConnectorResult(
    syntheticRelationshipSourceResult(
      "relationship.test.signature.relationships.stale_packet_v2",
      "Target Agency (Updated Source Text)",
    ),
    dataDir,
  );
  workbench.close();

  const output = await runDc([
    "review",
    "packets",
    "--mode",
    "relationships",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
    "--json",
  ]);

  assertEquals(output.code, 0);
  const body = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    packets: Array<{ subjectPrefix?: string; nextCommand?: string }>;
  };
  assertEquals(body.packets.length, 1);
  assertEquals(
    body.packets[0].subjectPrefix,
    "relationship.test.signature.relationships.stale_packet_v2",
  );
  assertEquals(body.packets[0].nextCommand, undefined);
});

Deno.test("interactive review shows defer packet context in the inbox before the current item", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  seedAcceptedEntity(workbench, "dc.target_agency", "Target Agency", "agency");
  seedAcceptedEntity(workbench, "dc.alt_agency", "Alt Agency", "agency");
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_packets.relationships",
      relationshipCandidateId: "relationship.test.review_packets.three",
      sourceItemKey: "review-packet-row-three",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.alt_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Health",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_packets.relationships",
      relationshipCandidateId: "relationship.test.review_packets.four",
      sourceItemKey: "review-packet-row-four",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.alt_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Education",
    }),
    dataDir,
  );
  workbench.close();

  const child = new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "--mode",
      "relationships",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode("\nq\n"));
  await writer.close();
  const output = await child.output();

  assertEquals(output.code, 0);
  const stdout = new TextDecoder().decode(output.stdout);
  assertStringIncludes(
    stdout,
    "1. [recommended] Alt Agency - test.review_packets.relationships overseen_by [default defer; packet 2 open]",
  );
  assertStringIncludes(
    stdout,
    "Packet: test.review_packets.relationships overseen_by -> dc.alt_agency (2 item(s); open=2, deferred=0)",
  );
  assertStringIncludes(stdout, "Review: Committee on Education");
  assertStringIncludes(stdout, "Review stopped. 2 item(s) remain.");
});

function countPacketPrepares(
  workbench: Workbench,
  filters: Parameters<typeof listReviewPackets>[1],
): number {
  let prepareCount = 0;
  const store = {
    db: {
      prepare(sql: string) {
        prepareCount += 1;
        return workbench.db.prepare(sql);
      },
    },
    listReviewItems: workbench.listReviewItems.bind(workbench),
  };
  listReviewPackets(store as unknown as Parameters<typeof listReviewPackets>[0], filters);
  return prepareCount;
}

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

async function runDc(args: string[]): Promise<Deno.CommandOutput> {
  return await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-net",
      "--allow-ffi",
      "scripts/dc.ts",
      ...args,
    ],
  }).output();
}
