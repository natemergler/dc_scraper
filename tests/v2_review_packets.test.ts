import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { Workbench } from "../src/v2/workbench.ts";
import {
  syntheticCustomRelationshipSourceResult,
  syntheticRelationshipSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

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
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.review_packet_one",
      sourceItemKey: "review-packet-row-one",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Health's Work",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.review_packet_two",
      sourceItemKey: "review-packet-row-two",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.alt_agency",
      relationshipType: "overseen_by",
      rawValue: "Committee on Education",
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
      nextCommand?: string;
    }>;
  };
  assertEquals(body.count, 1);
  assertEquals(body.packets[0].sourceId, "council.committees");
  assertEquals(body.packets[0].relationshipType, "overseen_by");
  assertEquals(body.packets[0].count, 2);
  assertEquals(body.packets[0].openCount, 2);
  assertEquals(body.packets[0].subjectPrefix, "relationship.council.committees");
  assertEquals(
    body.packets[0].nextCommand,
    `deno task dc -- review batch accept-safe --mode relationships --subject-prefix relationship.council.committees --relationship-type overseen_by --db ${
      quoteShellPath(dbPath)
    } --resolutions-dir ${quoteShellPath(resolutionsDir)}`,
  );

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
  assertStringIncludes(textBody, "Review packets: 1");
  assertStringIncludes(textBody, "[2] council.committees relationship_candidate");
  assertStringIncludes(
    textBody,
    `next: deno task dc -- review batch accept-safe --mode relationships --subject-prefix relationship.council.committees --relationship-type overseen_by --db ${
      quoteShellPath(dbPath)
    } --resolutions-dir ${quoteShellPath(resolutionsDir)}`,
  );

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
      nextCommand?: string;
    }>;
  };
  assertEquals(narrowedBody.count, 1);
  assertEquals(narrowedBody.packets[0].count, 1);
  assertEquals(
    narrowedBody.packets[0].subjectPrefix,
    "relationship.council.committees.review_packet_one",
  );
  assertEquals(
    narrowedBody.packets[0].nextCommand,
    `deno task dc -- review batch accept-safe --mode relationships --subject-prefix relationship.council.committees.review_packet_one --relationship-type overseen_by --raw-value-contains 'Committee on Health'\\''s Work' --db ${
      quoteShellPath(dbPath)
    } --resolutions-dir ${quoteShellPath(resolutionsDir)}`,
  );

  const broadPrefixOutput = await runDc([
    "review",
    "packets",
    "--mode",
    "relationships",
    "--subject-prefix",
    "relationship.council",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
    "--json",
  ]);

  assertEquals(broadPrefixOutput.code, 0);
  const broadPrefixBody = JSON.parse(new TextDecoder().decode(broadPrefixOutput.stdout)) as {
    packets: Array<{ subjectPrefix?: string; nextCommand?: string }>;
  };
  assertEquals(broadPrefixBody.packets[0].subjectPrefix, "relationship.council.committees");
  assertEquals(
    broadPrefixBody.packets[0].nextCommand,
    `deno task dc -- review batch accept-safe --mode relationships --subject-prefix relationship.council.committees --relationship-type overseen_by --db ${
      quoteShellPath(dbPath)
    } --resolutions-dir ${quoteShellPath(resolutionsDir)}`,
  );

  const narrowPrefixOutput = await runDc([
    "review",
    "packets",
    "--mode",
    "relationships",
    "--subject-prefix",
    "relationship.council.committees.review_packet",
    "--db",
    dbPath,
    "--resolutions-dir",
    resolutionsDir,
    "--json",
  ]);

  assertEquals(narrowPrefixOutput.code, 0);
  const narrowPrefixBody = JSON.parse(new TextDecoder().decode(narrowPrefixOutput.stdout)) as {
    packets: Array<{ subjectPrefix?: string; nextCommand?: string }>;
  };
  assertEquals(narrowPrefixBody.packets[0].subjectPrefix, "relationship.council.committees");
  assertEquals(
    narrowPrefixBody.packets[0].nextCommand,
    `deno task dc -- review batch accept-safe --mode relationships --subject-prefix relationship.council.committees.review_packet --relationship-type overseen_by --db ${
      quoteShellPath(dbPath)
    } --resolutions-dir ${quoteShellPath(resolutionsDir)}`,
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
  assertEquals(segmentPrefixBody.packets[0].subjectPrefix, "relationship.council.committees");
  assertEquals(
    segmentPrefixBody.packets[0].nextCommand,
    `deno task dc -- review list --mode relationships --type relationship_candidate --subject-prefix review_packet --relationship-type overseen_by --limit 10 --db ${
      quoteShellPath(dbPath)
    }`,
  );
  assertEquals(segmentPrefixBody.packets[0].nextCommand?.includes("batch accept-safe"), false);
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
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.limit_group_a.one",
      sourceItemKey: "review-packet-limit-row-one",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "overseen_by",
      rawValue: "Alpha Committee",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.council.committees.limit_group_a.two",
      sourceItemKey: "review-packet-limit-row-two",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.alt_agency",
      relationshipType: "overseen_by",
      rawValue: "Beta Committee",
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
      nextCommand?: string;
    }>;
  };
  assertEquals(body.count, 2);
  assertEquals(body.packets.length, 2);
  assertEquals(body.packets[0].sourceId, "council.committees");
  assertEquals(body.packets[0].count, 2);
  assertEquals(body.packets[1].sourceId, "test.review_packets.group_b");
  assertEquals(body.packets[1].count, 1);
  assertStringIncludes(body.packets[0].nextCommand ?? "", "review batch accept-safe");
  assertStringIncludes(
    body.packets[0].nextCommand ?? "",
    "--subject-prefix relationship.council.committees.limit_group_a",
  );
  assertStringIncludes(body.packets[1].nextCommand ?? "", "review list");
  assertStringIncludes(
    body.packets[1].nextCommand ?? "",
    "--subject-prefix relationship.test.review_packets.group_b",
  );
});

Deno.test("review packet next list command preserves resolved status filters", async () => {
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
    packets: Array<{ nextCommand?: string }>;
  };
  assertEquals(body.packets.length, 1);
  assertEquals(
    body.packets[0].nextCommand,
    `deno task dc -- review list --mode relationships --status resolved --type relationship_candidate --subject-prefix relationship.council.committees.resolved_packet --relationship-type overseen_by --limit 10 --db ${
      quoteShellPath(dbPath)
    }`,
  );
  assertEquals(body.packets[0].nextCommand?.includes("batch accept-safe"), false);
});

Deno.test("review packet next command keeps stale prior-decision work in list review", async () => {
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
    packets: Array<{ nextCommand?: string }>;
  };
  assertEquals(body.packets.length, 1);
  assertEquals(
    body.packets[0].nextCommand,
    `deno task dc -- review list --mode relationships --type relationship_candidate --subject-prefix relationship.test.signature.relationships.stale_packet_v2 --relationship-type governed_by --limit 10 --db ${
      quoteShellPath(dbPath)
    }`,
  );
  assertEquals(body.packets[0].nextCommand?.includes("batch accept-safe"), false);
});

Deno.test("interactive review shows packet context before the current item", async () => {
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
      toEntityRef: "dc.target_agency",
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
  await writer.write(new TextEncoder().encode("q\n"));
  await writer.close();
  const output = await child.output();

  assertEquals(output.code, 0);
  const stdout = new TextDecoder().decode(output.stdout);
  assertStringIncludes(
    stdout,
    "Packet: test.review_packets.relationships overseen_by (2 item(s); open=2, deferred=0)",
  );
  assertStringIncludes(stdout, "Review stopped. 2 item(s) remain.");
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

function quoteShellPath(value: string): string {
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
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
