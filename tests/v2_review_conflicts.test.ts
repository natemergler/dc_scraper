import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Database } from "@db/sqlite";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildV2Release } from "../src/v2/release.ts";
import { buildReviewItemId, type ConnectorResult, parseLegalReference } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { importConnectorResult as importConnectorResultIntoStore } from "../src/v2/workbench/import.ts";
import { renderReviewItem } from "../src/v2/workbench/review_cli.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
  syntheticLegalRefSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("default interactive review excludes source diagnostics", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(sourceDiagnosticFixture(), dataDir);
  workbench.close();

  const output = await new Deno.Command(Deno.execPath(), {
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
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  await output.stdin.close();
  const result = await output.output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);

  assertEquals(result.code, 0, stderr);
  assertEquals(stdout.includes("this source issue should stay deferred"), false);
  assertEquals(stdout.includes("source_status"), false);
});

Deno.test("Open DC unresolved unknown agency label becomes an unresolved_symbol conflict", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    await getConnector("open_dc.public_bodies").run(createConnectorContext({
      fetcher: openDcAgencyFetcher("Mayor's Office of Mystery Counsel"),
    })),
    dataDir,
  );

  const items = workbench.listReviewItems({ status: "open" });
  const conflict = items.find((item) =>
    item.conflictKind === "unresolved_symbol" &&
    item.details.rawLabel === "Mayor's Office of Mystery Counsel"
  );
  workbench.close();

  assert(conflict);
  assertEquals(conflict.subjectKind, "relationship");
  assertEquals(conflict.itemType, "relationship_candidate");
  assertEquals(conflict.details.rawLabel, "Mayor's Office of Mystery Counsel");
  assertEquals(conflict.proposedActions.map((action) => action.action), [
    "map_symbol",
    "create_alias_rule",
    "create_placeholder",
    "defer",
    "open_source_issue",
  ]);
});

Deno.test("Council finance buckets are diagnostics with mark_non_graphable work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    sourceDiagnosticFixture({
      rawValue: "Pay-As-You-Go Capital",
      reason: "Council oversight finance bucket",
      whyDeferred:
        "Oversight text names a fund or financing bucket rather than a clearly modeled civic body, so the compact edge stays in review.",
    }),
    dataDir,
  );

  const diagnostics = workbench.listReviewItems({ mode: "sources", status: "open" });
  const defaultItems = workbench.listReviewItems({ status: "open" });
  workbench.close();

  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].conflictKind, "compiler_diagnostic");
  assertEquals(diagnostics[0].subjectKind, "source_item");
  assertEquals(
    diagnostics[0].proposedActions.some((action) => action.action === "mark_non_graphable"),
    true,
  );
  assertEquals(defaultItems.some((item) => item.itemType === "source_status"), false);
});

Deno.test("entity candidates that conflict with accepted kind default to defer", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.conflicted_body', 'Conflicted Body', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.conflicted_entity_kind",
      candidateId: "candidate.test.conflicted_entity_kind.board",
      sourceItemKey: "conflicted-entity-row",
      proposedEntityId: "dc.conflicted_body",
      name: "Conflicted Body",
      kind: "board",
      observedName: "Conflicted Body",
      confidence: 0.99,
    }),
    dataDir,
  );
  const reviewItem = workbench.listReviewItems({ type: "entity_candidate" })[0];
  assertEquals(reviewItem.defaultAction, "defer");
  assertEquals(
    reviewItem.reason,
    "Resolve entity candidate that conflicts with an accepted entity",
  );
  assertStringIncludes(
    JSON.stringify(reviewItem.details),
    "Candidate kind board conflicts with accepted agency for the same entity id.",
  );
  const entityView = workbench.entityView("dc.conflicted_body");
  assertEquals(entityView.reviewItems.length, 1);
  assertEquals(entityView.reviewItems[0]?.subjectId, "candidate.test.conflicted_entity_kind.board");
  assertEquals(entityView.reviewItems[0]?.defaultAction, "defer");
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
  assertStringIncludes(batchText, "Accepted 0 safe review item(s).");

  const reopened = new Workbench(dbPath);
  reopened.init();
  const candidate = reopened.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = 'candidate.test.conflicted_entity_kind.board'",
  ).get() as { reviewStatus: string };
  const canonical = reopened.db.prepare(
    "select kind, merged_candidate_ids as mergedCandidateIds from canonical_entities where entity_id = 'dc.conflicted_body'",
  ).get() as { kind: string; mergedCandidateIds: string };
  reopened.close();
  assertEquals(candidate.reviewStatus, "pending");
  assertEquals(canonical.kind, "agency");
  assertEquals(canonical.mergedCandidateIds, "[]");
});

Deno.test("entity conflict review context is loaded in bulk during import", async () => {
  const onePrepareCount = await countConflictContextLookupPrepares(1);
  const manyPrepareCount = await countConflictContextLookupPrepares(8);

  assertEquals(manyPrepareCount, onePrepareCount);
  assertEquals(manyPrepareCount, 1);
});

Deno.test("legal refs for unresolved same-entity kind conflicts stay unattached until candidate acceptance", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const outDir = join(dir, "release");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.conflicted_legal_body', 'Conflicted Legal Body', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  const parsedRef = parseLegalReference(
    "D.C. Official Code § 1-204.04",
    "https://code.dccouncil.us/us/dc/council/code/sections/1-204.04",
  );
  const candidateId = "candidate.test.conflicted_entity_kind.legal_board";
  const legalRefId = "legal.test.conflicted_entity_kind.legal_board_authority";
  const connectorResult: ConnectorResult = {
    source: {
      sourceId: "test.conflicted_entity_kind_legal_refs",
      title: "Test Conflicted Entity Kind Legal Refs",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/conflicted-entity-kind-legal-refs",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.conflicted_entity_kind_legal_refs.main",
        sourceId: "test.conflicted_entity_kind_legal_refs",
        title: "Conflicted entity legal ref rows",
        kind: "fixture",
        url: "https://example.com/conflicted-entity-kind-legal-refs",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/conflicted-entity-kind-legal-refs",
        contentText: JSON.stringify({ candidateId, legalRefId }),
      }],
      parsed: {
        items: [{
          itemKey: "conflicted-legal-row",
          itemType: "fixture_row",
          title: "Conflicted legal row",
          body: { name: "Conflicted Legal Body" },
        }],
        entityCandidates: [{
          candidateId,
          sourceItemKey: "conflicted-legal-row",
          proposedEntityId: "dc.conflicted_legal_body",
          name: "Conflicted Legal Body",
          kind: "board",
          confidence: 0.99,
          evidence: [{
            fieldPath: "name",
            observedValue: "Conflicted Legal Body",
          }],
        }],
        legalRefs: [{
          legalRefId,
          sourceItemKey: "conflicted-legal-row",
          refType: parsedRef.refType,
          citationText: "D.C. Official Code § 1-204.04",
          normalizedCitation: parsedRef.normalizedCitation,
          url: "https://code.dccouncil.us/us/dc/council/code/sections/1-204.04",
          needsReview: true,
          attachEntityRef: "dc.conflicted_legal_body",
          evidence: [{
            fieldPath: "authority",
            observedValue: "D.C. Official Code § 1-204.04",
          }],
        }],
        reviewItems: [{
          reviewItemId: buildReviewItemId(candidateId, "entity-review"),
          itemType: "entity_candidate",
          subjectId: candidateId,
          reason: "Review fixture entity candidate",
          defaultAction: "accept",
          details: {
            name: "Conflicted Legal Body",
            kind: "board",
          },
        }],
      },
    }],
  };

  await workbench.importConnectorResult(connectorResult, dataDir);

  const candidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = ?",
  ).get(candidateId) as { reviewStatus: string };
  const legalRef = workbench.db.prepare(
    "select review_status as reviewStatus from legal_refs where legal_ref_id = ?",
  ).get(legalRefId) as { reviewStatus: string };
  assertEquals(candidate.reviewStatus, "pending");
  assertEquals(legalRef.reviewStatus, "pending");
  assertEquals(workbench.entityLegalRefs(), []);
  assertEquals(workbench.entityView("dc.conflicted_legal_body").legalRefs, []);

  await buildV2Release(workbench, outDir);
  const releasedEntityLegalAuthorities = await Deno.readTextFile(
    join(outDir, "references", "entity_legal_authorities.csv"),
  );
  assertEquals(
    releasedEntityLegalAuthorities.trim(),
    "entity_id,entity_name,legal_authority_id,authority_type,citation_text,normalized_citation,public_url,review_status",
  );

  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: candidateId,
      payload: {},
    },
    resolutionsDir,
  );

  assertEquals(workbench.entityLegalRefs(), [{
    entity_id: "dc.conflicted_legal_body",
    entity_name: "Conflicted Legal Body",
    legal_ref_id: legalRefId,
    ref_type: "dc_code",
    citation_text: "D.C. Official Code § 1-204.04",
    normalized_citation: "D.C. Code 1-204.04",
    url: "https://code.dccouncil.us/us/dc/council/code/sections/1-204.04",
    review_status: "pending",
  }]);
  workbench.close();
});

Deno.test("legal citation normalization accepts aliases before writing", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const legalRefId = "legal.test.review_conflicts.alias_dclaw";
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      legalRefId,
      "Law 22-155",
      "https://example.com/law-22-155",
    ),
    dataDir,
  );
  workbench.close();

  const run = new Deno.Command(Deno.execPath(), {
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
      "legal",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = run.stdin.getWriter();
  await writer.write(new TextEncoder().encode("n\ndclaw\nD.C. Law 22-155\nq\n"));
  await writer.close();
  const output = await run.output();
  const stderr = new TextDecoder().decode(output.stderr);
  assertEquals(output.code, 0, stderr);

  const reopened = new Workbench(dbPath);
  reopened.init();
  const row = reopened.db.prepare(
    "select ref_type as refType, normalized_citation as normalizedCitation, review_status as reviewStatus from legal_refs where legal_ref_id = ?",
  ).get(legalRefId) as { refType: string; normalizedCitation: string; reviewStatus: string };
  reopened.close();

  assertEquals(row.refType, "dc_law");
  assertEquals(row.normalizedCitation, "D.C. Law 22-155");
  assertEquals(row.reviewStatus, "accepted");
});

Deno.test("invalid legal citation type prints choices and does not write", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const legalRefId = "legal.test.review_conflicts.invalid_type";
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      legalRefId,
      "Law 22-155",
      "https://example.com/law-22-155",
    ),
    dataDir,
  );
  workbench.close();

  const run = new Deno.Command(Deno.execPath(), {
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
      "legal",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = run.stdin.getWriter();
  await writer.write(new TextEncoder().encode("n\nbanana\nq\n"));
  await writer.close();
  const output = await run.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  assertEquals(output.code, 0, stderr);
  assertStringIncludes(stdout, "Valid legal ref types:");
  assertStringIncludes(stdout, "dc law / dclaw / law -> dc_law");
  assertEquals(stdout.includes("CHECK constraint failed"), false);

  const reopened = new Workbench(dbPath);
  reopened.init();
  const row = reopened.db.prepare(
    "select ref_type as refType, review_status as reviewStatus from legal_refs where legal_ref_id = ?",
  ).get(legalRefId) as { refType: string; reviewStatus: string };
  const resolutionCount = reopened.db.prepare("select count(*) as count from resolution_events")
    .get() as { count: number };
  reopened.close();

  assertEquals(row.refType, "unknown");
  assertEquals(row.reviewStatus, "pending");
  assertEquals(resolutionCount.count, 0);
});

Deno.test("relationship conflicts render a source-backed conflict group", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  seedAcceptedEntity(workbench, "dc.target_agency", "Target Agency", "agency");
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_conflicts.a",
      relationshipCandidateId: "relationship.test.review_conflicts.a",
      sourceItemKey: "same-fact-a",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "governed_by",
      rawValue: "Target Agency",
      needsReview: true,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_conflicts.b",
      relationshipCandidateId: "relationship.test.review_conflicts.b",
      sourceItemKey: "same-fact-b",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "governed_by",
      rawValue: "Target Agency",
      needsReview: true,
    }),
    dataDir,
  );

  const item = workbench.listReviewItems({
    mode: "relationships",
    subjectPrefix: "relationship.test.review_conflicts.a",
  })[0];
  const text = renderReviewItem(workbench, item);
  workbench.close();

  assertStringIncludes(text, "Conflict group:");
  assertStringIncludes(text, "test.review_conflicts.a");
  assertStringIncludes(text, "test.review_conflicts.b");
  assertStringIncludes(text, "Target Agency");
});

function sourceDiagnosticFixture(
  input: {
    rawValue?: string;
    reason?: string;
    whyDeferred?: string;
  } = {},
): ConnectorResult {
  const rawValue = input.rawValue ?? "this source issue should stay deferred";
  return {
    source: {
      sourceId: "test.review_conflicts.diagnostics",
      title: "Test Diagnostics",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/diagnostics",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.review_conflicts.diagnostics.main",
        sourceId: "test.review_conflicts.diagnostics",
        title: "Diagnostic rows",
        kind: "fixture",
        url: "https://example.com/diagnostics",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/diagnostics",
        contentText: JSON.stringify({ rawValue }),
      }],
      parsed: {
        items: [{
          itemKey: "diagnostic-row",
          itemType: "fixture_row",
          title: "Diagnostic row",
          body: { rawValue },
        }],
        reviewItems: [{
          reviewItemId: buildReviewItemId("test.review_conflicts.diagnostics", rawValue),
          itemType: "source_status",
          subjectId: "test.review_conflicts.diagnostics",
          reason: input.reason ?? "Review source diagnostic",
          defaultAction: "defer",
          details: {
            rawValue,
            needsReview: true,
            whyDeferred: input.whyDeferred ?? "this source issue should stay deferred",
          },
        }],
      },
    }],
  };
}

async function countConflictContextLookupPrepares(candidateCount: number): Promise<number> {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.bulk_conflicted_body', 'Bulk Conflicted Body', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  let conflictContextPrepareCount = 0;
  const countedDb = new Proxy(workbench.db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (sql: string) => {
          if (
            sql.includes("canonical_entities.kind != entity_candidates.kind") &&
            sql.includes("entity_candidates.candidate_id")
          ) {
            conflictContextPrepareCount += 1;
          }
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Database;

  await importConnectorResultIntoStore(
    { db: countedDb } as Parameters<typeof importConnectorResultIntoStore>[0],
    conflictEntityBatchSourceResult(candidateCount),
    dataDir,
  );
  workbench.close();
  return conflictContextPrepareCount;
}

function conflictEntityBatchSourceResult(candidateCount: number): ConnectorResult {
  const itemKeys = Array.from(
    { length: candidateCount },
    (_, index) => `bulk-conflicted-entity-row-${index + 1}`,
  );
  const candidateIds = itemKeys.map((itemKey) => `candidate.test.bulk_conflicted.${itemKey}`);
  return {
    source: {
      sourceId: "test.bulk_conflicted_entity_kind",
      title: "Bulk Conflicted Entity Kind",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/bulk-conflicted-entity-kind",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.bulk_conflicted_entity_kind.main",
        sourceId: "test.bulk_conflicted_entity_kind",
        title: "Bulk conflicted entity rows",
        kind: "fixture",
        url: "https://example.com/bulk-conflicted-entity-kind",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/bulk-conflicted-entity-kind",
        contentText: JSON.stringify({ candidateCount }),
      }],
      parsed: {
        items: itemKeys.map((itemKey, index) => ({
          itemKey,
          itemType: "fixture_row",
          title: `Bulk conflicted entity row ${index + 1}`,
          body: { observedName: `Bulk Conflicted Body ${index + 1}` },
        })),
        entityCandidates: candidateIds.map((candidateId, index) => ({
          candidateId,
          sourceItemKey: itemKeys[index],
          proposedEntityId: "dc.bulk_conflicted_body",
          name: "Bulk Conflicted Body",
          kind: "board",
          confidence: 0.99,
          evidence: [{
            fieldPath: "name",
            observedValue: "Bulk Conflicted Body",
          }],
        })),
        reviewItems: candidateIds.map((candidateId) => ({
          reviewItemId: buildReviewItemId(candidateId, "entity-review"),
          itemType: "entity_candidate",
          subjectId: candidateId,
          reason: "Review fixture entity candidate",
          defaultAction: "accept",
          details: {
            name: "Bulk Conflicted Body",
            kind: "board",
          },
        })),
      },
    }],
  };
}

function openDcAgencyFetcher(agencyLabel: string) {
  return async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://www.open-dc.gov/public-bodies":
          return `<html><body><a href="/public-bodies/common-lottery-board">Common Lottery Board</a></body></html>`;
        case "https://www.open-dc.gov/public-bodies/common-lottery-board":
          return `<html><body>
            <h1 class="page-title">Common Lottery Board</h1>
            <div class="field field-name-field-governing-agency-acronym field-type-taxonomy-term-reference field-label-inline clearfix">
              <div class="field-label">Governing Agency / Agency Acronym:&nbsp;</div>
              <div class="field-items"><div class="field-item even">${agencyLabel}</div></div>
            </div>
          </body></html>`;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
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
