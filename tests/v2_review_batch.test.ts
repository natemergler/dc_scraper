import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
  legalEntrypointsFixture,
} from "./helpers/v2_fixtures.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
  syntheticLegalRefSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("batch accept-safe skips remaining ambiguous legal refs after safe import auto-accept", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        if (url === "https://dc.gov/page/laws-regulations-and-courts") {
          return legalEntrypointsFixture;
        }
        throw new Error(`Unexpected url ${url}`);
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(result, dataDir);
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.unknown_review",
      "Mystery legal authority",
      "https://example.com/mystery-legal-authority",
    ),
    dataDir,
  );
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
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
      "batch",
      "accept-safe",
      "--mode",
      "legal",
      "--subject-prefix",
      "legal.test.signature.legal_refs",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted 0 safe review item(s).");
  assertStringIncludes(batchText, "Skipped 1 item(s) that were not safe to auto-accept.");
  assertStringIncludes(batchText, "Next: deno task dc -- status");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const statuses = reopened.db.prepare(
    "select review_status as reviewStatus, count(*) as count from legal_refs group by review_status",
  ).all() as Array<{ reviewStatus: string; count: number }>;
  const statusCounts = new Map(statuses.map((row) => [row.reviewStatus, row.count]));
  const pendingItem = reopened.listReviewItems({ mode: "legal" })[0];
  reopened.close();
  assertEquals(statusCounts.get("accepted"), 3);
  assertEquals(statusCounts.get("pending"), 1);
  assertEquals(pendingItem.details.refType, "unknown");
});

Deno.test("batch defer-default marks scoped legal refs deferred without changing legal ref status", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const result = await getConnector("legal.entrypoints").run(createConnectorContext({
    fetcher: async (url: string) => ({
      status: 200,
      text: async () => {
        if (url === "https://dc.gov/page/laws-regulations-and-courts") {
          return legalEntrypointsFixture;
        }
        throw new Error(`Unexpected url ${url}`);
      },
      json: async <T>() => {
        throw new Error(`No json fixture for ${url}`) as T;
      },
    }),
  }));
  await workbench.importConnectorResult(result, dataDir);
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.unknown_defer",
      "Mystery legal authority",
      "https://example.com/mystery-legal-authority",
    ),
    dataDir,
  );
  workbench.close();

  const listOutput = await new Deno.Command(Deno.execPath(), {
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
      "list",
      "--mode",
      "legal",
      "--subject-prefix",
      "legal.test.signature.legal_refs",
      "--ref-type",
      "unknown",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  const listed = JSON.parse(new TextDecoder().decode(listOutput.stdout)) as {
    count: number;
    items: Array<{ details: { refType: string } }>;
  };
  assertEquals(listOutput.code, 0);
  assertEquals(listed.count, 1);
  assertEquals(listed.items[0].details.refType, "unknown");

  const deferOutput = await new Deno.Command(Deno.execPath(), {
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
      "batch",
      "defer-default",
      "--mode",
      "legal",
      "--subject-prefix",
      "legal.test.signature.legal_refs",
      "--ref-type",
      "unknown",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferOutput.code, 0);
  const deferText = new TextDecoder().decode(deferOutput.stdout);
  assertStringIncludes(deferText, "Deferred 1 default-defer review item(s).");
  assertStringIncludes(deferText, "Next: deno task dc -- status");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const deferred = reopened.listReviewItems({
    mode: "legal",
    status: "deferred",
    subjectPrefix: "legal.test.signature.legal_refs",
    refType: "unknown",
  });
  const legalRef = reopened.db.prepare(
    "select review_status as reviewStatus from legal_refs where legal_ref_id = 'legal.test.signature.legal_refs.unknown_defer'",
  ).get() as { reviewStatus: string };
  reopened.close();
  assertEquals(deferred.length, 1);
  assertEquals(legalRef.reviewStatus, "pending");
});

Deno.test("batch accept-safe writes JSONL resolution events and leaves risky review items alone", async () => {
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
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.batch_accept_safe.entities",
      candidateId: "candidate.test.batch_accept_safe.entities.example",
      sourceItemKey: "batch-accept-safe-entity-row",
      proposedEntityId: "dc.batch_accept_safe_entity",
      name: "Batch Accept Safe Entity",
      kind: "board",
      observedName: "Batch Accept Safe Entity",
      confidence: 0.99,
    }),
    dataDir,
  );
  workbench.close();
  const batchOutput = await new Deno.Command(Deno.execPath(), {
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
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted ");
  let resolutionFile = "";
  for await (const entry of Deno.readDir(resolutionsDir)) {
    if (!entry.isDirectory) continue;
    for await (const child of Deno.readDir(join(resolutionsDir, entry.name))) {
      if (child.isFile && child.name.endsWith(".jsonl")) {
        resolutionFile = join(resolutionsDir, entry.name, child.name);
      }
    }
  }
  assert(resolutionFile);
  const lines = (await Deno.readTextFile(resolutionFile)).trim().split("\n").filter(Boolean);
  assert(lines.length > 0);
  assert(lines.every((line) => JSON.parse(line).event_type === "accept_entity_candidate"));
  const reopened = new Workbench(dbPath);
  reopened.init();
  const blockedRelationships = reopened.db.prepare(
    "select count(*) as count from reconciliation_items where subject_type = 'relationship_candidate' and state = 'blocked'",
  ).get() as { count: number };
  reopened.close();
  assert(blockedRelationships.count > 0);
});

Deno.test("batch accept-safe skips non-committee seeded endpoint candidates", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.seeded.batch",
      relationshipCandidateId: "relationship.test.seeded.batch.direct_endpoint",
      sourceItemKey: "direct-endpoint-row",
      fromEntityRef: "dc.parent_entity",
      toEntityRef: "dc.batch_safe_unknown_board",
      relationshipType: "part_of",
      rawValue: "Batch Safe Unknown Board",
      needsReview: false,
    }),
    dataDir,
  );
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
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
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--subject-prefix",
      "candidate.test.seeded.batch.relationship_test_seeded_batch_direct_endpoint",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Accepted 0 safe review item(s).");
  assertStringIncludes(batchText, "Skipped 1 item(s) that were not safe to auto-accept.");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const candidateStatus = reopened.db.prepare(
    `select review_status as reviewStatus
     from entity_candidates
     where candidate_id = 'candidate.test.seeded.batch.relationship_test_seeded_batch_direct_endpoint_to_endpoint'`,
  ).get() as { reviewStatus: string } | undefined;
  const canonicalEntity = reopened.db.prepare(
    `select entity_id as entityId
     from canonical_entities
     where entity_id = 'dc.batch_safe_unknown_board'`,
  ).get() as { entityId: string } | undefined;
  reopened.close();
  assertEquals(candidateStatus?.reviewStatus, "pending");
  assertEquals(canonicalEntity, undefined);
});

Deno.test("batch defer-default defers only scoped default-defer relationship items", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'council', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  const healthDetailWithDeferredRows = `<html><body>
    <h1>Committee on Health</h1>
    <h2>Agencies Under This Committee</h2>
    <ul>
      <li>Department of Health</li>
      <li>Cedar Hill Hospital</li>
      <li>Department of Buildings (excluding construction codes)</li>
    </ul>
  </body></html>`;
  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture.replace(
            "</ul>",
            "<li>Council of the District of Columbia</li></ul>",
          );
        case "https://dccouncil.gov/committees/committee-on-health/":
          return healthDetailWithDeferredRows;
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
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
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
      "batch",
      "defer-default",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 0);
  const batchText = new TextDecoder().decode(batchOutput.stdout);
  assertStringIncludes(batchText, "Deferred 1 default-defer review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const openOversight = reopened.listReviewItems({
    mode: "relationships",
    status: "open",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees",
  });
  const deferredOversight = reopened.listReviewItems({
    mode: "relationships",
    status: "deferred",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees",
  });
  const blockedOversight = reopened.db.prepare(
    `select count(*) as count
     from reconciliation_items
     where subject_type = 'relationship_candidate'
       and details_json like '%"relationshipType":"overseen_by"%'`,
  ).get() as { count: number };
  reopened.close();
  assertEquals(openOversight.length, 0);
  assertEquals(deferredOversight.length, 1);
  assertEquals(blockedOversight.count, 0);
});

Deno.test("batch defer-default requires a scoped review slice", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.close();

  const batchOutput = await new Deno.Command(Deno.execPath(), {
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
      "batch",
      "defer-default",
      "--mode",
      "relationships",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(batchOutput.code, 1);
  assertStringIncludes(
    new TextDecoder().decode(batchOutput.stderr),
    "Batch defer-default requires --mode, --subject-prefix, and at least one narrowing filter.",
  );
});

Deno.test("batch defer-default marks a scoped relationship review slice deferred", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.example_body', 'Example Body', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.other_branch', 'Other Branch', 'branch', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "dcgis.boards_commissions_councils",
      relationshipCandidateId: "relationship.dcgis.boards_commissions_councils.example_other",
      sourceItemKey: "dcgis-bcc-other-row",
      fromEntityRef: "dc.example_body",
      toEntityRef: "dc.other_branch",
      relationshipType: "part_of",
      rawValue: "Other",
      needsReview: true,
    }),
    dataDir,
  );
  workbench.close();

  const entityBatchOutput = await new Deno.Command(Deno.execPath(), {
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
      "batch",
      "accept-safe",
      "--mode",
      "entities",
      "--subject-prefix",
      "candidate.dcgis.boards_commissions_councils",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(entityBatchOutput.code, 0);

  const deferOutput = await new Deno.Command(Deno.execPath(), {
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
      "batch",
      "defer-default",
      "--mode",
      "relationships",
      "--relationship-type",
      "part_of",
      "--subject-prefix",
      "relationship.dcgis.boards_commissions_councils",
      "--raw-value",
      "Other",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(deferOutput.stdout),
    "Deferred 1 default-defer review item(s).",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const openOther = reopened.listReviewItems({
    mode: "relationships",
    status: "open",
    relationshipType: "part_of",
    subjectPrefix: "relationship.dcgis.boards_commissions_councils",
    rawValue: "Other",
  });
  const deferredOther = reopened.listReviewItems({
    mode: "relationships",
    status: "deferred",
    relationshipType: "part_of",
    subjectPrefix: "relationship.dcgis.boards_commissions_councils",
    rawValue: "Other",
  });
  reopened.close();
  assertEquals(openOther.length, 0);
  assertEquals(deferredOther.length, 1);
});

Deno.test("batch defer-default leaves auto-materialized accept-default relationship slices alone", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  for (
    const [entityId, name, kind] of [
      ["dc.accept_default_test_parent", "Accept Default Test Parent", "board"],
      ["dc.accept_default_test_committee", "Accept Default Test Committee", "committee"],
    ] as const
  ) {
    workbench.db.prepare(
      "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
    ).run(entityId, name, kind);
  }
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId:
        "relationship.council.committees.defer_default.accept_relationship.health",
      sourceItemKey: "defer-default-accept-health-row",
      fromEntityRef: "dc.accept_default_test_parent",
      toEntityRef: "dc.accept_default_test_committee",
      relationshipType: "overseen_by",
      rawValue: "Health Example Oversight",
      needsReview: true,
    }),
    dataDir,
  );
  workbench.close();

  const deferOutput = await new Deno.Command(Deno.execPath(), {
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
      "batch",
      "defer-default",
      "--mode",
      "relationships",
      "--relationship-type",
      "overseen_by",
      "--subject-prefix",
      "relationship.council.committees.defer_default.accept_relationship",
      "--raw-value-contains",
      "Health",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferOutput.code, 0);
  assertStringIncludes(
    new TextDecoder().decode(deferOutput.stdout),
    "Deferred 0 default-defer review item(s).",
  );

  const reopened = new Workbench(dbPath);
  reopened.init();
  const deferredHealth = reopened.listReviewItems({
    mode: "relationships",
    status: "deferred",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees.defer_default.accept_relationship",
    rawValueContains: "Health",
  });
  const openOversight = reopened.listReviewItems({
    mode: "relationships",
    status: "open",
    relationshipType: "overseen_by",
    subjectPrefix: "relationship.council.committees.defer_default.accept_relationship",
  });
  const acceptedRelationship = reopened.db.prepare(
    `select count(*) as count
     from canonical_relationships
     where relationship_id = 'dc.accept_default_test_parent:overseen_by:dc.accept_default_test_committee'`,
  ).get() as { count: number };
  reopened.close();
  assertEquals(deferredHealth.length, 0);
  assertEquals(openOversight.length, 0);
  assertEquals(acceptedRelationship.count, 1);
});

Deno.test("plain batch defer is not available", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.close();

  const deferOutput = await new Deno.Command(Deno.execPath(), {
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
      "batch",
      "defer",
      "--mode",
      "relationships",
      "--subject-prefix",
      "relationship.example",
      "--db",
      dbPath,
    ],
  }).output();

  assertEquals(deferOutput.code, 2);
  assertStringIncludes(
    new TextDecoder().decode(deferOutput.stderr),
    "Unknown command: review batch defer",
  );
});
