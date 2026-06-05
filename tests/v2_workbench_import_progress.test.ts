import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { ConnectorResult } from "../src/v2/domain.ts";
import type { ImportProgressEvent } from "../src/v2/workbench/import.ts";
import { Workbench } from "../src/v2/workbench.ts";

Deno.test("workbench import reports humane parsed and derived-state substeps", async () => {
  const dir = await Deno.makeTempDir();
  const workbench = new Workbench(join(dir, "workbench.sqlite"));
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.progress_source', 'Progress Source', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.progress_target', 'Progress Target', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  const events: ImportProgressEvent[] = [];
  await workbench.importConnectorResult(progressFixtureResult(), join(dir, "artifacts"), {
    onProgress: (event) => events.push(event),
  });
  workbench.close();

  assertEquals(events.map((event) => event.phase), [
    "parsed-source-items",
    "parsed-entity-candidates",
    "parsed-relationship-candidates",
    "parsed-legal-refs",
    "parsed-datasets",
    "parsed-review-items",
    "parsed-row-insert",
    "entity-replay",
    "legal-ref-replay",
    "legal-auto-accept",
    "entity-auto-promote",
    "relationship-reconciliation",
    "relationship-replay",
    "relationship-auto-accept",
  ]);
  assertEquals(events.slice(0, 6).map((event) => event.message), [
    "Prepared source items items=1 fields=0",
    "Prepared entity candidates candidates=1 evidence=1",
    "Prepared relationship candidates candidates=1 evidence=1",
    "Prepared legal refs refs=1 evidence=1",
    "Prepared datasets datasets=1 evidence=1",
    "Prepared review items items=1",
  ]);
});

Deno.test("workbench import keeps rollback progress preparatory", async () => {
  const dir = await Deno.makeTempDir();
  const workbench = new Workbench(join(dir, "workbench.sqlite"));
  workbench.init();

  const events: ImportProgressEvent[] = [];
  await assertRejects(
    () =>
      workbench.importConnectorResult(
        importFailureFixtureResult(),
        join(dir, "artifacts"),
        {
          onProgress: (event) => events.push(event),
        },
      ),
    Error,
    "Missing source item for key missing-row",
  );
  workbench.close();

  assertEquals(events.map((event) => event.phase), [
    "parsed-source-items",
    "parsed-entity-candidates",
  ]);
  assertEquals(events.map((event) => event.message), [
    "Prepared source items items=1 fields=0",
    "Prepared entity candidates candidates=1 evidence=1",
  ]);
});

Deno.test("failed parsed imports keep artifacts but roll back partial typed rows", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await assertRejects(
    () =>
      workbench.importConnectorResult(
        {
          source: {
            sourceId: "test.bad_parse",
            title: "Bad Parse Fixture",
            kind: "fixture",
            accessMethod: "fixture",
            baseUrl: "https://example.test",
          },
          endpointResults: [{
            endpoint: {
              endpointId: "test.bad_parse.main",
              sourceId: "test.bad_parse",
              title: "Main",
              kind: "fixture",
              url: "https://example.test/source",
              method: "GET",
              captureMode: "fixture",
            },
            status: "success",
            artifacts: [{
              kind: "json",
              extension: "json",
              contentText: JSON.stringify({ ok: false }),
              fetchedUrl: "https://example.test/source",
            }],
            parsed: {
              items: [{
                itemKey: "known",
                itemType: "fixture",
                title: "Known Item",
                body: { name: "Known Item" },
              }],
              entityCandidates: [{
                candidateId: "candidate.test.bad_parse.missing",
                sourceItemKey: "missing",
                proposedEntityId: "dc.missing",
                name: "Missing",
                kind: "fixture",
                evidence: [],
              }],
            },
          }],
        },
        dataDir,
      ),
    Error,
    "Missing source item for key missing",
  );

  const runStatus = workbench.db.prepare(
    "select status, error_text as errorText from source_runs where source_id = ?",
  ).get("test.bad_parse") as { status: string; errorText: string };
  const summary = workbench.sourceSummary("test.bad_parse");
  const listRow = workbench.listSources().find((row) => row.sourceId === "test.bad_parse");
  const counts = workbench.db.prepare(
    `select
       (select count(*) from source_artifacts) as artifacts,
       (select count(*) from source_items) as items,
       (select count(*) from entity_candidates) as entityCandidates`,
  ).get() as { artifacts: number; items: number; entityCandidates: number };
  workbench.close();

  assertEquals(runStatus.status, "failed");
  assertStringIncludes(runStatus.errorText, "Missing source item for key missing");
  assertEquals(summary.latestStatus, "failed");
  assertStringIncludes(summary.latestErrorText ?? "", "Missing source item for key missing");
  assertEquals(listRow?.latestStatus, "failed");
  assertStringIncludes(listRow?.latestErrorText ?? "", "Missing source item for key missing");
  assertEquals(counts, { artifacts: 1, items: 0, entityCandidates: 0 });
});

Deno.test("workbench import preserves evidence across bulk insert chunks", async () => {
  const dir = await Deno.makeTempDir();
  const workbench = new Workbench(join(dir, "workbench.sqlite"));
  workbench.init();

  await workbench.importConnectorResult(bulkEvidenceFixtureResult(1200), join(dir, "artifacts"));
  const entityCount = workbench.db.prepare(
    "select count(*) as count from entity_candidate_evidence where candidate_id = 'candidate.test.bulk_evidence'",
  ).get() as { count: number };
  const entityLast = workbench.db.prepare(
    "select observed_value as observedValue from entity_candidate_evidence where evidence_id = 'candidate.test.bulk_evidence:1199'",
  ).get() as { observedValue: string } | undefined;
  const relationshipCount = workbench.db.prepare(
    "select count(*) as count from relationship_candidate_evidence where relationship_candidate_id = 'relationship.test.bulk_evidence'",
  ).get() as { count: number };
  const relationshipLast = workbench.db.prepare(
    "select observed_value as observedValue from relationship_candidate_evidence where evidence_id = 'relationship.test.bulk_evidence:1199'",
  ).get() as { observedValue: string } | undefined;
  workbench.close();

  assertEquals(entityCount.count, 1200);
  assertEquals(entityLast?.observedValue, "entity-value-1199");
  assertEquals(relationshipCount.count, 1200);
  assertEquals(relationshipLast?.observedValue, "relationship-value-1199");
});

Deno.test("workbench relationship evidence refetch removes stale rows", async () => {
  const dir = await Deno.makeTempDir();
  const workbench = new Workbench(join(dir, "workbench.sqlite"));
  workbench.init();

  await workbench.importConnectorResult(bulkEvidenceFixtureResult(3), join(dir, "artifacts"));
  await workbench.importConnectorResult(
    bulkEvidenceFixtureResult(1, { relationshipValuePrefix: "refetched-relationship-value" }),
    join(dir, "artifacts"),
  );

  const relationshipEvidence = workbench.db.prepare(
    "select evidence_id as evidenceId, observed_value as observedValue from relationship_candidate_evidence where relationship_candidate_id = 'relationship.test.bulk_evidence' order by evidence_id",
  ).all() as Array<{ evidenceId: string; observedValue: string }>;
  workbench.close();

  assertEquals(relationshipEvidence, [{
    evidenceId: "relationship.test.bulk_evidence:0",
    observedValue: "refetched-relationship-value-0",
  }]);
});

Deno.test("workbench entity evidence refetch removes stale rows", async () => {
  const dir = await Deno.makeTempDir();
  const workbench = new Workbench(join(dir, "workbench.sqlite"));
  workbench.init();

  await workbench.importConnectorResult(bulkEvidenceFixtureResult(3), join(dir, "artifacts"));
  await workbench.importConnectorResult(
    bulkEvidenceFixtureResult(1, { entityValuePrefix: "refetched-entity-value" }),
    join(dir, "artifacts"),
  );

  const entityEvidence = workbench.db.prepare(
    "select evidence_id as evidenceId, observed_value as observedValue from entity_candidate_evidence where candidate_id = 'candidate.test.bulk_evidence' order by evidence_id",
  ).all() as Array<{ evidenceId: string; observedValue: string }>;
  workbench.close();

  assertEquals(entityEvidence, [{
    evidenceId: "candidate.test.bulk_evidence:0",
    observedValue: "refetched-entity-value-0",
  }]);
});

Deno.test("workbench import bulk inserts parsed source items and candidates", async () => {
  const dir = await Deno.makeTempDir();
  const workbench = new Workbench(join(dir, "workbench.sqlite"));
  workbench.init();
  const sqlRunCounts = countPreparedRuns(workbench.db, [
    "insert or replace into source_items",
    "insert into entity_candidates",
    "insert into relationship_candidates",
  ]);

  await workbench.importConnectorResult(bulkParsedRowsFixtureResult(1200), join(dir, "artifacts"));
  const sourceItemCount = workbench.db.prepare(
    "select count(*) as count from source_items where source_id = 'test.import.bulk_rows'",
  ).get() as { count: number };
  const entityCandidateCount = workbench.db.prepare(
    "select count(*) as count from entity_candidates where candidate_id like 'candidate.test.bulk_rows.%'",
  ).get() as { count: number };
  const relationshipCandidateCount = workbench.db.prepare(
    "select count(*) as count from relationship_candidates where relationship_candidate_id like 'relationship.test.bulk_rows.%'",
  ).get() as { count: number };
  const lastRelationship = workbench.db.prepare(
    "select raw_value as rawValue from relationship_candidates where relationship_candidate_id = 'relationship.test.bulk_rows.1199'",
  ).get() as { rawValue: string } | undefined;
  workbench.close();

  assertEquals(sourceItemCount.count, 1200);
  assertEquals(entityCandidateCount.count, 1200);
  assertEquals(relationshipCandidateCount.count, 1200);
  assertEquals(lastRelationship?.rawValue, "Bulk row 1199");
  assertEquals(sqlRunCounts.get("insert or replace into source_items"), 3);
  assertEquals(sqlRunCounts.get("insert into entity_candidates"), 3);
  assertEquals(sqlRunCounts.get("insert into relationship_candidates"), 3);
});

Deno.test("workbench bulk candidate inserts preserve existing review status", async () => {
  const dir = await Deno.makeTempDir();
  const workbench = new Workbench(join(dir, "workbench.sqlite"));
  workbench.init();

  await workbench.importConnectorResult(bulkParsedRowsFixtureResult(2), join(dir, "artifacts"));
  workbench.db.prepare(
    "update entity_candidates set review_status = 'accepted' where candidate_id = 'candidate.test.bulk_rows.0'",
  ).run();
  workbench.db.prepare(
    "update relationship_candidates set review_status = 'rejected' where relationship_candidate_id = 'relationship.test.bulk_rows.0'",
  ).run();

  await workbench.importConnectorResult(
    bulkParsedRowsFixtureResult(2, { rowLabelPrefix: "Refetched row" }),
    join(dir, "artifacts"),
  );
  const entityRows = workbench.db.prepare(
    "select candidate_id as candidateId, name, review_status as reviewStatus from entity_candidates where candidate_id like 'candidate.test.bulk_rows.%' order by candidate_id",
  ).all() as Array<{ candidateId: string; name: string; reviewStatus: string }>;
  const relationshipRows = workbench.db.prepare(
    "select relationship_candidate_id as relationshipCandidateId, raw_value as rawValue, review_status as reviewStatus from relationship_candidates where relationship_candidate_id like 'relationship.test.bulk_rows.%' order by relationship_candidate_id",
  ).all() as Array<{ relationshipCandidateId: string; rawValue: string; reviewStatus: string }>;
  workbench.close();

  assertEquals(entityRows, [
    {
      candidateId: "candidate.test.bulk_rows.0",
      name: "Refetched row 0",
      reviewStatus: "accepted",
    },
    {
      candidateId: "candidate.test.bulk_rows.1",
      name: "Refetched row 1",
      reviewStatus: "pending",
    },
  ]);
  assertEquals(relationshipRows, [
    {
      relationshipCandidateId: "relationship.test.bulk_rows.0",
      rawValue: "Refetched row 0",
      reviewStatus: "rejected",
    },
    {
      relationshipCandidateId: "relationship.test.bulk_rows.1",
      rawValue: "Refetched row 1",
      reviewStatus: "pending",
    },
  ]);
});

Deno.test("workbench bulk candidate refetch preloads existing review statuses", async () => {
  const dir = await Deno.makeTempDir();
  const workbench = new Workbench(join(dir, "workbench.sqlite"));
  workbench.init();

  await workbench.importConnectorResult(bulkParsedRowsFixtureResult(1200), join(dir, "artifacts"));
  workbench.db.prepare(
    "update entity_candidates set review_status = 'accepted' where candidate_id = 'candidate.test.bulk_rows.0'",
  ).run();
  workbench.db.prepare(
    "update relationship_candidates set review_status = 'rejected' where relationship_candidate_id = 'relationship.test.bulk_rows.0'",
  ).run();

  const preparedSql = collectPreparedSql(workbench.db);
  await workbench.importConnectorResult(bulkParsedRowsFixtureResult(1200), join(dir, "artifacts"));

  const entityStatusQueries = preparedSql.filter((sql) =>
    sql.includes("candidate_id as id") && sql.includes("from entity_candidates")
  );
  const relationshipStatusQueries = preparedSql.filter((sql) =>
    sql.startsWith("select relationship_candidate_id as id")
  );
  const scalarStatusSubqueryInserts = preparedSql.filter((sql) =>
    (sql.startsWith("insert into entity_candidates") ||
      sql.startsWith("insert into relationship_candidates")) &&
    sql.includes("select review_status")
  );
  const entityStatus = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = 'candidate.test.bulk_rows.0'",
  ).get() as { reviewStatus: string };
  const relationshipStatus = workbench.db.prepare(
    "select review_status as reviewStatus from relationship_candidates where relationship_candidate_id = 'relationship.test.bulk_rows.0'",
  ).get() as { reviewStatus: string };
  workbench.close();

  assertEquals(entityStatusQueries.length, 3);
  assertEquals(relationshipStatusQueries.length, 3);
  assertEquals(scalarStatusSubqueryInserts, []);
  assertEquals(entityStatus.reviewStatus, "accepted");
  assertEquals(relationshipStatus.reviewStatus, "rejected");
});

function progressFixtureResult(): ConnectorResult {
  return {
    source: {
      sourceId: "test.import.progress",
      title: "Import Progress Fixture",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/import-progress",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.import.progress.main",
        sourceId: "test.import.progress",
        title: "Import progress rows",
        kind: "fixture",
        url: "https://example.com/import-progress",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/import-progress",
        contentText: JSON.stringify({ fixture: true }),
      }],
      parsed: {
        items: [{
          itemKey: "row-1",
          itemType: "fixture_row",
          title: "Progress row",
          body: { name: "Progress Target" },
        }],
        legalRefs: [{
          legalRefId: "legal.test.import.progress",
          sourceItemKey: "row-1",
          refType: "dc_code",
          citationText: "D.C. Code 1-1001.01",
          normalizedCitation: "D.C. Code 1-1001.01",
          evidence: [{
            fieldPath: "citation",
            observedValue: "D.C. Code 1-1001.01",
          }],
        }],
        datasets: [{
          datasetId: "dataset.test.import.progress",
          sourceItemKey: "row-1",
          name: "Progress Dataset",
          category: "directory",
          ownerName: "Progress Office",
          accessMethod: "download",
          artifactDepth: "rows",
          officialUrl: "https://example.com/datasets/progress",
          evidence: [{
            fieldPath: "dataset",
            observedValue: "Progress Dataset",
          }],
        }],
        entityCandidates: [{
          candidateId: "candidate.test.import.progress",
          sourceItemKey: "row-1",
          proposedEntityId: "dc.progress_candidate",
          name: "Progress Candidate",
          kind: "board",
          evidence: [{
            fieldPath: "name",
            observedValue: "Progress Candidate",
          }],
        }],
        relationshipCandidates: [{
          relationshipCandidateId: "relationship.test.import.progress",
          sourceItemKey: "row-1",
          fromEntityRef: "dc.progress_source",
          toEntityRef: "dc.progress_target",
          relationshipType: "governed_by",
          rawValue: "Progress Target",
          needsReview: false,
          evidence: [{
            fieldPath: "target",
            observedValue: "Progress Target",
          }],
        }],
        reviewItems: [{
          reviewItemId: "review.test.import.progress.dataset",
          itemType: "dataset",
          subjectId: "dataset.test.import.progress",
          reason: "Confirm dataset metadata",
          defaultAction: "accept",
          details: {
            source: "fixture",
          },
        }],
      },
    }],
  };
}

function importFailureFixtureResult(): ConnectorResult {
  return {
    source: {
      sourceId: "test.import.progress.failure",
      title: "Import Progress Failure Fixture",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/import-progress-failure",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.import.progress.failure.main",
        sourceId: "test.import.progress.failure",
        title: "Import progress failure rows",
        kind: "fixture",
        url: "https://example.com/import-progress-failure",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/import-progress-failure",
        contentText: JSON.stringify({ fixture: true }),
      }],
      parsed: {
        items: [{
          itemKey: "row-1",
          itemType: "fixture_row",
          title: "Failure row",
          body: { name: "Failure Target" },
        }],
        entityCandidates: [{
          candidateId: "candidate.test.import.progress.failure",
          sourceItemKey: "row-1",
          proposedEntityId: "dc.progress_failure_candidate",
          name: "Failure Candidate",
          kind: "board",
          evidence: [{
            fieldPath: "name",
            observedValue: "Failure Candidate",
          }],
        }],
        datasets: [{
          datasetId: "dataset.test.import.progress.failure",
          sourceItemKey: "missing-row",
          name: "Broken Dataset",
          category: "directory",
          accessMethod: "download",
          artifactDepth: "rows",
          evidence: [{
            fieldPath: "dataset",
            observedValue: "Broken Dataset",
          }],
        }],
      },
    }],
  };
}

function bulkParsedRowsFixtureResult(
  rowCount: number,
  options: { rowLabelPrefix?: string } = {},
): ConnectorResult {
  const rowLabelPrefix = options.rowLabelPrefix ?? "Bulk row";
  return {
    source: {
      sourceId: "test.import.bulk_rows",
      title: "Import Bulk Rows Fixture",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/import-bulk-rows",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.import.bulk_rows.main",
        sourceId: "test.import.bulk_rows",
        title: "Import bulk parsed rows",
        kind: "fixture",
        url: "https://example.com/import-bulk-rows",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/import-bulk-rows",
        contentText: JSON.stringify({ fixture: true }),
      }],
      parsed: {
        items: Array.from({ length: rowCount }, (_, index) => ({
          itemKey: `row-${index}`,
          itemType: "fixture_row",
          title: `${rowLabelPrefix} ${index}`,
          body: { name: `${rowLabelPrefix} ${index}` },
        })),
        entityCandidates: Array.from({ length: rowCount }, (_, index) => ({
          candidateId: `candidate.test.bulk_rows.${index}`,
          sourceItemKey: `row-${index}`,
          proposedEntityId: `dc.bulk_rows_${index}`,
          name: `${rowLabelPrefix} ${index}`,
          kind: "board",
          evidence: [{
            fieldPath: "name",
            observedValue: `${rowLabelPrefix} ${index}`,
          }],
        })),
        relationshipCandidates: Array.from({ length: rowCount }, (_, index) => ({
          relationshipCandidateId: `relationship.test.bulk_rows.${index}`,
          sourceItemKey: `row-${index}`,
          fromEntityRef: `dc.bulk_rows_${index}`,
          toEntityRef: "dc.bulk_rows_parent",
          relationshipType: "governed_by",
          rawValue: `${rowLabelPrefix} ${index}`,
          needsReview: false,
          evidence: [{
            fieldPath: "parent",
            observedValue: `${rowLabelPrefix} ${index}`,
          }],
        })),
      },
    }],
  };
}

function bulkEvidenceFixtureResult(
  evidenceCount: number,
  options: { entityValuePrefix?: string; relationshipValuePrefix?: string } = {},
): ConnectorResult {
  const entityValuePrefix = options.entityValuePrefix ?? "entity-value";
  const relationshipValuePrefix = options.relationshipValuePrefix ?? "relationship-value";
  return {
    source: {
      sourceId: "test.import.bulk_evidence",
      title: "Import Bulk Evidence Fixture",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/import-bulk-evidence",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.import.bulk_evidence.main",
        sourceId: "test.import.bulk_evidence",
        title: "Import bulk evidence rows",
        kind: "fixture",
        url: "https://example.com/import-bulk-evidence",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/import-bulk-evidence",
        contentText: JSON.stringify({ fixture: true }),
      }],
      parsed: {
        items: [{
          itemKey: "row-1",
          itemType: "fixture_row",
          title: "Bulk evidence row",
          body: { name: "Bulk Evidence Target" },
        }],
        entityCandidates: [{
          candidateId: "candidate.test.bulk_evidence",
          sourceItemKey: "row-1",
          proposedEntityId: "dc.bulk_candidate",
          name: "Bulk Evidence Candidate",
          kind: "board",
          evidence: Array.from({ length: evidenceCount }, (_, index) => ({
            fieldPath: `entity-field-${index}`,
            observedValue: `${entityValuePrefix}-${index}`,
          })),
        }],
        relationshipCandidates: [{
          relationshipCandidateId: "relationship.test.bulk_evidence",
          sourceItemKey: "row-1",
          fromEntityRef: "dc.bulk_source",
          toEntityRef: "dc.bulk_target",
          relationshipType: "governed_by",
          rawValue: "Bulk Evidence Target",
          needsReview: false,
          evidence: Array.from({ length: evidenceCount }, (_, index) => ({
            fieldPath: `relationship-field-${index}`,
            observedValue: `${relationshipValuePrefix}-${index}`,
          })),
        }],
      },
    }],
  };
}

function countPreparedRuns(
  db: Workbench["db"],
  sqlPrefixes: string[],
): Map<string, number> {
  const counts = new Map(sqlPrefixes.map((prefix) => [prefix, 0]));
  const originalPrepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const statement = originalPrepare(sql);
    const matchingPrefix = sqlPrefixes.find((prefix) => sql.startsWith(prefix));
    if (!matchingPrefix) return statement;
    const originalRun = statement.run.bind(statement);
    statement.run = ((...params: never[]) => {
      counts.set(matchingPrefix, (counts.get(matchingPrefix) ?? 0) + 1);
      return originalRun(...params);
    }) as typeof statement.run;
    return statement;
  }) as typeof db.prepare;
  return counts;
}

function collectPreparedSql(db: Workbench["db"]): string[] {
  const sqls: string[] = [];
  const originalPrepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    sqls.push(sql.trimStart());
    return originalPrepare(sql);
  }) as typeof db.prepare;
  return sqls;
}
