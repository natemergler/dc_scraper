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
