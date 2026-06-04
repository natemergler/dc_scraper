import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { ReviewItemRecord } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  reviewEvidence,
  reviewSubject,
  reviewSubjectSourceId,
} from "../src/v2/workbench/review_subject.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
  syntheticLegalRefSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("review subject lookup centralizes source and evidence for review items", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedAcceptedEntity(workbench, "dc.source_board", "Source Board", "board");
  seedAcceptedEntity(workbench, "dc.target_agency", "Target Agency", "agency");

  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_subject.entities",
      candidateId: "candidate.test.review_subject.entity",
      sourceItemKey: "review-subject-entity-row",
      proposedEntityId: "dc.review_subject_board",
      name: "Review Subject Board",
      kind: "board",
      observedName: "Review Subject Board",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "test.review_subject.relationships",
      relationshipCandidateId: "relationship.test.review_subject.edge",
      sourceItemKey: "review-subject-relationship-row",
      fromEntityRef: "dc.source_board",
      toEntityRef: "dc.target_agency",
      relationshipType: "overseen_by",
      rawValue: "Target Agency",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.review_subject.code",
      "D.C. Code 1-101",
      "https://code.dccouncil.gov/us/dc/council/code/sections/1-101",
    ),
    dataDir,
  );

  const items = workbench.listReviewItems({ status: "all" });
  const entityItem = findReviewItem(items, "candidate.test.review_subject.entity");
  const relationshipItem = findReviewItem(items, "relationship.test.review_subject.edge");
  const legalItem = findReviewItem(items, "legal.test.review_subject.code");

  const entitySubject = reviewSubject(workbench, entityItem);
  assert(entitySubject?.itemType === "entity_candidate");
  assertEquals(entitySubject.name, "Review Subject Board");
  assertEquals(entitySubject.entityKind, "board");
  assertEquals(entitySubject.source.sourceId, "test.review_subject.entities");
  assertEquals(reviewSubjectSourceId(workbench, entityItem), "test.review_subject.entities");
  assertEquals(reviewEvidence(workbench, entityItem)[0].fieldPath, "name");

  const relationshipSubject = reviewSubject(workbench, relationshipItem);
  assert(relationshipSubject?.itemType === "relationship_candidate");
  assertEquals(relationshipSubject.relationshipType, "overseen_by");
  assertEquals(relationshipSubject.fromEntityRef, "dc.source_board");
  assertEquals(relationshipSubject.toEntityRef, "dc.target_agency");
  assertEquals(relationshipSubject.rawValue, "Target Agency");
  assertEquals(relationshipSubject.source.sourceId, "test.review_subject.relationships");
  assertEquals(
    reviewSubjectSourceId(workbench, relationshipItem),
    "test.review_subject.relationships",
  );
  assertEquals(reviewEvidence(workbench, relationshipItem)[0].fieldPath, "governingAgency");

  const legalSubject = reviewSubject(workbench, legalItem);
  assert(legalSubject?.itemType === "legal_ref");
  assertEquals(legalSubject.refType, "dc_code");
  assertEquals(legalSubject.source.sourceId, "test.signature.legal_refs");
  assertEquals(reviewSubjectSourceId(workbench, legalItem), "test.signature.legal_refs");
  assertEquals(reviewEvidence(workbench, legalItem)[0].fieldPath, "citation");

  assertEquals(
    reviewSubjectSourceId(workbench, {
      itemType: "source_status",
      subjectId: "dcgis.agencies",
    }),
    "dcgis.agencies",
  );
  assertEquals(
    reviewSubjectSourceId(workbench, {
      itemType: "placeholder_entity",
      subjectId: "dc.placeholder",
    }),
    "workbench",
  );
  workbench.close();
});

Deno.test("review list json includes source and label context", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.review_list.entities",
      candidateId: "candidate.test.review_list.entity",
      sourceItemKey: "review-list-entity-row",
      proposedEntityId: "dc.review_list_board",
      name: "Review List Board",
      kind: "board",
      observedName: "Review List Board",
    }),
    dataDir,
  );
  workbench.close();

  const output = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "review",
      "list",
      "--mode",
      "entities",
      "--db",
      dbPath,
      "--limit",
      "1",
      "--json",
    ],
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  assertEquals(output.code, 0, stderr);
  const parsed = JSON.parse(stdout) as {
    count: number;
    items: Array<{ sourceId?: string; label?: string; subjectId: string }>;
  };
  assertEquals(parsed.count, 1);
  assertEquals(parsed.items[0].sourceId, "test.review_list.entities");
  assertEquals(parsed.items[0].label, "Review List Board");
  assertStringIncludes(parsed.items[0].subjectId, "candidate.test.review_list.entity");
});

function findReviewItem(
  items: ReviewItemRecord[],
  subjectId: string,
): ReviewItemRecord {
  const item = items.find((candidate) => candidate.subjectId === subjectId);
  assert(item);
  return item;
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
