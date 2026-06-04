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
