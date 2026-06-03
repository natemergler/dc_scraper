import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildReviewItemId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import { syntheticLegalRefSourceResult } from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("accepted legal ref decisions are reused across refetch when legal ref ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.code_v1",
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_legal_ref",
      subjectId: "legal.test.signature.legal_refs.code_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.code_v2",
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = 'legal.test.signature.legal_refs.code_v1'",
  ).get() as { payloadJson: string };
  const secondLegalRef = workbench.db.prepare(
    "select review_status as reviewStatus from legal_refs where legal_ref_id = 'legal.test.signature.legal_refs.code_v2'",
  ).get() as { reviewStatus: string };
  const openItems = workbench.listReviewItems({ mode: "legal", status: "open" });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(payload.fact_signature ?? "", "legal_ref:test.signature.legal_refs");
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(secondLegalRef.reviewStatus, "accepted");
  assertEquals(openItems.length, 0);
});

Deno.test("changed legal ref evidence after a prior accept becomes stale review work instead of silent reuse", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.code_v1",
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_legal_ref",
      subjectId: "legal.test.signature.legal_refs.code_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.code_v2",
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22?changed=1",
    ),
    dataDir,
  );

  const secondLegalRef = workbench.db.prepare(
    "select review_status as reviewStatus from legal_refs where legal_ref_id = 'legal.test.signature.legal_refs.code_v2'",
  ).get() as { reviewStatus: string };
  const staleItem = workbench.listReviewItems({
    mode: "legal",
    status: "open",
  }).find((item) => item.subjectId === "legal.test.signature.legal_refs.code_v2");
  workbench.close();

  assertEquals(secondLegalRef.reviewStatus, "pending");
  assert(staleItem);
  assertEquals(staleItem.details.priorDecisionState, "accepted");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior accepted decision");
});

Deno.test("edited legal ref accept decisions are reused across refetch when legal ref ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstLegalRefId = "legal.test.signature.legal_refs.code_edit_v1";
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      firstLegalRefId,
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_legal_ref",
      subjectId: firstLegalRefId,
      payload: {
        normalizedCitation: "D.C. Code 1-204.22 (reviewed)",
      },
    },
    resolutionsDir,
  );

  const secondLegalRefId = "legal.test.signature.legal_refs.code_edit_v2";
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      secondLegalRefId,
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = ?",
  ).get(firstLegalRefId) as { payloadJson: string };
  const secondLegalRef = workbench.db.prepare(
    "select review_status as reviewStatus, normalized_citation as normalizedCitation from legal_refs where legal_ref_id = ?",
  ).get(secondLegalRefId) as { reviewStatus: string; normalizedCitation: string };
  const openItems = workbench.listReviewItems({ mode: "legal", status: "open" });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
    resolved_normalized_citation?: string;
  };
  assertStringIncludes(payload.fact_signature ?? "", "legal_ref:test.signature.legal_refs");
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(payload.resolved_normalized_citation, "D.C. Code 1-204.22 (reviewed)");
  assertEquals(secondLegalRef.reviewStatus, "accepted");
  assertEquals(secondLegalRef.normalizedCitation, "D.C. Code 1-204.22 (reviewed)");
  assertEquals(openItems.length, 0);
});

Deno.test("changed legal ref evidence after a prior edited accept preserves prior resolved details", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstLegalRefId = "legal.test.signature.legal_refs.code_edit_v1";
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      firstLegalRefId,
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_legal_ref",
      subjectId: firstLegalRefId,
      payload: {
        normalizedCitation: "D.C. Code 1-204.22 (reviewed)",
      },
    },
    resolutionsDir,
  );

  const secondLegalRefId = "legal.test.signature.legal_refs.code_edit_v2";
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      secondLegalRefId,
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22?changed=1",
    ),
    dataDir,
  );

  const staleItem = workbench.listReviewItems({
    mode: "legal",
    status: "open",
  }).find((item) => item.subjectId === secondLegalRefId);
  workbench.close();

  assert(staleItem);
  assertEquals(staleItem.details.priorDecisionState, "accepted");
  assertEquals(
    staleItem.details.priorResolvedNormalizedCitation,
    "D.C. Code 1-204.22 (reviewed)",
  );
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior accepted decision");
});

Deno.test("deferred legal ref review decisions are reused across refetch when legal ref ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstLegalRefId = "legal.test.signature.legal_refs.code_defer_v1";
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      firstLegalRefId,
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(firstLegalRefId, "legal-ref"),
      payload: {},
    },
    resolutionsDir,
  );

  const secondLegalRefId = "legal.test.signature.legal_refs.code_defer_v2";
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      secondLegalRefId,
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = ?",
  ).get(buildReviewItemId(firstLegalRefId, "legal-ref")) as { payloadJson: string };
  const deferredItems = workbench.listReviewItems({
    mode: "legal",
    status: "deferred",
  });
  const openItems = workbench.listReviewItems({
    mode: "legal",
    status: "open",
  });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(payload.fact_signature ?? "", "legal_ref:test.signature.legal_refs");
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(
    deferredItems.some((item) => item.subjectId === secondLegalRefId),
    true,
  );
  assertEquals(deferredItems.length, 1);
  assertEquals(openItems.length, 0);
});

Deno.test("changed legal ref evidence after a prior defer becomes stale open review work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstLegalRefId = "legal.test.signature.legal_refs.code_defer_v1";
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      firstLegalRefId,
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(firstLegalRefId, "legal-ref"),
      payload: {},
    },
    resolutionsDir,
  );

  const secondLegalRefId = "legal.test.signature.legal_refs.code_defer_v2";
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      secondLegalRefId,
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22?changed=1",
    ),
    dataDir,
  );

  const staleItem = workbench.listReviewItems({
    mode: "legal",
    status: "open",
  }).find((item) => item.subjectId === secondLegalRefId);
  const deferredItems = workbench.listReviewItems({
    mode: "legal",
    status: "deferred",
  });
  workbench.close();

  assert(staleItem);
  assertEquals(staleItem.status, "open");
  assertEquals(staleItem.details.priorDecisionState, "deferred");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior deferred decision");
  assertEquals(deferredItems.length, 0);
});
