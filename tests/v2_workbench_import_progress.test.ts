import { assertEquals } from "@std/assert";
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
    "parsed-row-insert",
    "entity-replay",
    "legal-ref-replay",
    "legal-auto-accept",
    "entity-auto-promote",
    "relationship-reconciliation",
    "relationship-replay",
    "relationship-auto-accept",
  ]);
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

Deno.test("workbench import bulk inserts parsed source items and candidates", async () => {
  const dir = await Deno.makeTempDir();
  const workbench = new Workbench(join(dir, "workbench.sqlite"));
  workbench.init();
  const sqlRunCounts = countPreparedRuns(workbench.db, [
    "insert or replace into source_items",
    "insert or replace into entity_candidates",
    "insert or replace into relationship_candidates",
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
  assertEquals(sqlRunCounts.get("insert or replace into entity_candidates"), 3);
  assertEquals(sqlRunCounts.get("insert or replace into relationship_candidates"), 3);
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

  await workbench.importConnectorResult(bulkParsedRowsFixtureResult(2), join(dir, "artifacts"));
  const entityRows = workbench.db.prepare(
    "select candidate_id as candidateId, review_status as reviewStatus from entity_candidates where candidate_id like 'candidate.test.bulk_rows.%' order by candidate_id",
  ).all() as Array<{ candidateId: string; reviewStatus: string }>;
  const relationshipRows = workbench.db.prepare(
    "select relationship_candidate_id as relationshipCandidateId, review_status as reviewStatus from relationship_candidates where relationship_candidate_id like 'relationship.test.bulk_rows.%' order by relationship_candidate_id",
  ).all() as Array<{ relationshipCandidateId: string; reviewStatus: string }>;
  workbench.close();

  assertEquals(entityRows, [
    { candidateId: "candidate.test.bulk_rows.0", reviewStatus: "accepted" },
    { candidateId: "candidate.test.bulk_rows.1", reviewStatus: "pending" },
  ]);
  assertEquals(relationshipRows, [
    { relationshipCandidateId: "relationship.test.bulk_rows.0", reviewStatus: "rejected" },
    { relationshipCandidateId: "relationship.test.bulk_rows.1", reviewStatus: "pending" },
  ]);
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
      },
    }],
  };
}

function bulkParsedRowsFixtureResult(rowCount: number): ConnectorResult {
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
          title: `Bulk row ${index}`,
          body: { name: `Bulk row ${index}` },
        })),
        entityCandidates: Array.from({ length: rowCount }, (_, index) => ({
          candidateId: `candidate.test.bulk_rows.${index}`,
          sourceItemKey: `row-${index}`,
          proposedEntityId: `dc.bulk_rows_${index}`,
          name: `Bulk row ${index}`,
          kind: "board",
          evidence: [{
            fieldPath: "name",
            observedValue: `Bulk row ${index}`,
          }],
        })),
        relationshipCandidates: Array.from({ length: rowCount }, (_, index) => ({
          relationshipCandidateId: `relationship.test.bulk_rows.${index}`,
          sourceItemKey: `row-${index}`,
          fromEntityRef: `dc.bulk_rows_${index}`,
          toEntityRef: "dc.bulk_rows_parent",
          relationshipType: "governed_by",
          rawValue: `Bulk row ${index}`,
          needsReview: false,
          evidence: [{
            fieldPath: "parent",
            observedValue: `Bulk row ${index}`,
          }],
        })),
      },
    }],
  };
}

function bulkEvidenceFixtureResult(evidenceCount: number): ConnectorResult {
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
            observedValue: `entity-value-${index}`,
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
            observedValue: `relationship-value-${index}`,
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
