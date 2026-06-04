import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { type ConnectorResult } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { syntheticCustomRelationshipSourceResult } from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("relationship legal refs attach after the relationship materializes", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  seedAcceptedEntity(workbench, "dc.target_agency", "Target Agency", "agency");

  await workbench.importConnectorResult(
    legalAttachmentSourceResult({
      legalRefId: "legal.test.attachments.relationship_authority",
      attachEntityRef: "dc.source_board",
      attachRelationshipRef: "dc.source_board:governed_by:dc.target_agency",
    }),
    dataDir,
  );

  assertEquals(rawRelationshipLegalRefCount(workbench), 0);
  assertEquals(workbench.relationshipLegalRefs(), []);
  assertEquals(workbench.entityLegalRefs().map((row) => row.legal_ref_id), [
    "legal.test.attachments.relationship_authority",
  ]);

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "open_dc.public_bodies",
      relationshipCandidateId: "relationship.test.legal_ref_attachments.source_board_governed_by",
      sourceItemKey: "governed-by-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "governed_by",
      rawValue: "Target Agency",
      needsReview: false,
    }),
    dataDir,
  );

  assertEquals(workbench.relationshipLegalRefs(), [{
    relationship_id: "dc.source_board:governed_by:dc.target_agency",
    from_entity_id: "dc.source_board",
    from_entity_name: "Source Board",
    relationship_type: "governed_by",
    to_entity_id: "dc.target_agency",
    to_entity_name: "Target Agency",
    legal_ref_id: "legal.test.attachments.relationship_authority",
    ref_type: "dc_code",
    citation_text: "D.C. Code § 1-204.04",
    normalized_citation: "D.C. Code 1-204.04",
    url: "https://code.dccouncil.gov/us/dc/council/code/sections/1-204.04",
    review_status: "accepted",
  }]);
  workbench.close();
});

Deno.test("relationship legal refs stay unattached while the relationship is blocked", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");

  await workbench.importConnectorResult(
    legalAttachmentSourceResult({
      legalRefId: "legal.test.attachments.blocked_relationship_authority",
      attachRelationshipRef: "dc.source_board:governed_by:dc.missing_agency",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "open_dc.public_bodies",
      relationshipCandidateId: "relationship.test.legal_ref_attachments.blocked_governed_by",
      sourceItemKey: "blocked-governed-by-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.missing_agency",
      relationshipType: "governed_by",
      rawValue: "Missing Agency",
      needsReview: false,
    }),
    dataDir,
  );

  assertEquals(rawRelationshipLegalRefCount(workbench), 0);
  assertEquals(workbench.relationshipLegalRefs(), []);
  workbench.close();
});

function seedAcceptedEntity(
  workbench: Workbench,
  entityId: string,
  name: string,
  kind: string,
): void {
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values(?, ?, ?, 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run(entityId, name, kind);
}

function rawRelationshipLegalRefCount(workbench: Workbench): number {
  return (workbench.db.prepare(
    "select count(*) as count from relationship_legal_refs",
  ).get() as { count: number }).count;
}

function legalAttachmentSourceResult(input: {
  legalRefId: string;
  attachEntityRef?: string;
  attachRelationshipRef?: string;
}): ConnectorResult {
  return {
    source: {
      sourceId: "test.legal_ref_attachments",
      title: "Test Legal Ref Attachments",
      kind: "fixture",
      accessMethod: "fixture",
      baseUrl: "https://example.com/legal-ref-attachments",
    },
    endpointResults: [{
      endpoint: {
        endpointId: "test.legal_ref_attachments.main",
        sourceId: "test.legal_ref_attachments",
        title: "Legal ref attachment rows",
        kind: "fixture",
        url: "https://example.com/legal-ref-attachments",
        method: "GET",
        captureMode: "rows",
      },
      status: "success",
      artifacts: [{
        kind: "rows",
        extension: "json",
        fetchedUrl: "https://example.com/legal-ref-attachments",
        contentText: JSON.stringify(input),
      }],
      parsed: {
        items: [{
          itemKey: input.legalRefId,
          itemType: "fixture_legal_ref",
          title: "Legal ref attachment row",
          body: input,
        }],
        legalRefs: [{
          legalRefId: input.legalRefId,
          sourceItemKey: input.legalRefId,
          refType: "dc_code",
          citationText: "D.C. Code § 1-204.04",
          normalizedCitation: "D.C. Code 1-204.04",
          url: "https://code.dccouncil.gov/us/dc/council/code/sections/1-204.04",
          needsReview: false,
          attachEntityRef: input.attachEntityRef,
          attachRelationshipRef: input.attachRelationshipRef,
          evidence: [{
            fieldPath: "citation",
            observedValue: "D.C. Code § 1-204.04",
          }],
        }],
      },
    }],
  };
}
