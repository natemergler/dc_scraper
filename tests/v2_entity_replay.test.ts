import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildReviewItemId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  buildEntityDecisionHint,
  reuseOrMarkStaleEntityDecisions,
} from "../src/v2/workbench/replay.ts";
import { canBatchAcceptReviewItem } from "../src/v2/workbench/review_batch.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticEntitySourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

Deno.test("accepted entity decisions are reused across refetch when candidate ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.signature.entities.example_v1", "Example Body"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.signature.entities.example_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.signature.entities.example_v2", "Example Body"),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = 'candidate.test.signature.entities.example_v1'",
  ).get() as { payloadJson: string };
  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = 'candidate.test.signature.entities.example_v2'",
  ).get() as { reviewStatus: string };
  const canonical = workbench.db.prepare(
    "select merged_candidate_ids as mergedCandidateIds from canonical_entities where entity_id = 'dc.example_body'",
  ).get() as { mergedCandidateIds: string };
  const openItems = workbench.listReviewItems({ mode: "entities", status: "open" });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(payload.fact_signature ?? "", "entity_candidate:test.signature.entities");
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(secondCandidate.reviewStatus, "accepted");
  assertEquals(openItems.length, 0);
  assertEquals(
    JSON.parse(canonical.mergedCandidateIds) as string[],
    [
      "candidate.test.signature.entities.example_v1",
      "candidate.test.signature.entities.example_v2",
    ],
  );
});

Deno.test("reused accepted entity decisions refresh canonical fields from refetched evidence", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstCandidateId = "candidate.test.signature.entities.example_blank_v1";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.signature.entities",
      candidateId: firstCandidateId,
      sourceItemKey: "example-blank-row",
      proposedEntityId: "dc.example_body",
      name: "Example Body",
      kind: "board",
      observedName: "Example Body",
      confidence: 0.95,
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: firstCandidateId,
      payload: {},
    },
    resolutionsDir,
  );

  const secondCandidateId = "candidate.test.signature.entities.example_blank_v2";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.signature.entities",
      candidateId: secondCandidateId,
      sourceItemKey: "example-blank-row",
      proposedEntityId: "dc.example_body",
      name: "Example Body",
      kind: "board",
      officialUrl: "https://example.com/official",
      observedName: "Example Body",
      confidence: 0.95,
    }),
    dataDir,
  );

  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = ?",
  ).get(secondCandidateId) as { reviewStatus: string };
  const canonical = workbench.db.prepare(
    `select official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.example_body'`,
  ).get() as {
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const openItems = workbench.listReviewItems({ mode: "entities", status: "open" });
  workbench.close();

  assertEquals(secondCandidate.reviewStatus, "accepted");
  assertEquals(canonical.officialUrl, "https://example.com/official");
  assertEquals(openItems.length, 0);
  assertEquals(
    JSON.parse(canonical.mergedCandidateIds) as string[],
    [firstCandidateId, secondCandidateId],
  );
});

Deno.test("accepting a stronger entity candidate refreshes canonical fields", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const weakCandidateId = "candidate.test.signature.entities.example_weak";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.signature.entities",
      candidateId: weakCandidateId,
      sourceItemKey: "example-row",
      proposedEntityId: "dc.example_body",
      name: "Example Body",
      kind: "board",
      branch: "Other",
      cluster: "Legacy Cluster",
      officialUrl: "https://example.com/legacy",
      observedName: "Example Body",
      confidence: 0.95,
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: weakCandidateId,
      payload: {},
    },
    resolutionsDir,
  );

  const strongCandidateId = "candidate.test.signature.entities.example_strong";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.signature.entities",
      candidateId: strongCandidateId,
      sourceItemKey: "example-row-strong",
      proposedEntityId: "dc.example_body",
      name: "Example Body",
      kind: "agency",
      branch: "Independent",
      cluster: "Official Cluster",
      officialUrl: "https://example.com/official",
      observedName: "Example Body",
      confidence: 0.99,
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: strongCandidateId,
      payload: {},
    },
    resolutionsDir,
  );

  const canonical = workbench.db.prepare(
    `select kind,
            branch,
            cluster,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.example_body'`,
  ).get() as {
    kind: string;
    branch: string;
    cluster: string;
    officialUrl: string;
    mergedCandidateIds: string;
  };
  workbench.close();

  assertEquals(canonical.kind, "agency");
  assertEquals(canonical.branch, "Independent");
  assertEquals(canonical.cluster, "Official Cluster");
  assertEquals(canonical.officialUrl, "https://example.com/official");
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [weakCandidateId, strongCandidateId]);
});

Deno.test("accepted alias-backed entity candidates attach provenance without replacing stronger fields", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const dcgisCandidateId = "candidate.dcgis.agencies.1142";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.agencies",
      candidateId: dcgisCandidateId,
      sourceItemKey: "dcgis-pcsb-row",
      proposedEntityId: "dc.public_charter_school_board_pcsb",
      name: "DC Public Charter School Board",
      kind: "board",
      officialUrl: "https://www.dcpcsb.org/",
      observedName: "DC Public Charter School Board",
      confidence: 0.95,
    }),
    dataDir,
  );

  const quickbaseCandidateId = "candidate.mota.quickbase.public_charter_school_board_pcsb";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "mota.quickbase",
      candidateId: quickbaseCandidateId,
      sourceItemKey: "quickbase-pcsb-row",
      proposedEntityId: "dc.public_charter_school_board_pcsb",
      name: "Public Charter School Board (PCSB)",
      kind: "board",
      officialUrl: "https://octo.quickbase.com/db/bjngwr9pe",
      observedName: "Public Charter School Board (PCSB)",
      confidence: 0.95,
    }),
    dataDir,
  );

  const quickbaseCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = ?",
  ).get(quickbaseCandidateId) as { reviewStatus: string } | undefined;
  const canonical = workbench.db.prepare(
    `select name,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.public_charter_school_board_pcsb'`,
  ).get() as {
    name: string;
    officialUrl: string;
    mergedCandidateIds: string;
  };
  const openReview = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix: quickbaseCandidateId,
  });
  workbench.close();

  assertEquals(quickbaseCandidate?.reviewStatus, "accepted");
  assertEquals(canonical.name, "DC Public Charter School Board");
  assertEquals(canonical.officialUrl, "https://www.dcpcsb.org/");
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [dcgisCandidateId, quickbaseCandidateId]);
  assertEquals(openReview.length, 0);
});

Deno.test("generic appointment public-body candidates attach provenance without replacing official kind", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const officialCandidateId = "candidate.bega.structure.board_of_ethics";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "bega.structure",
      candidateId: officialCandidateId,
      sourceItemKey: "bega-structure-row",
      proposedEntityId: "dc.board_of_ethics_and_government_accountability",
      name: "Board of Ethics and Government Accountability",
      kind: "agency",
      branch: "Independent",
      cluster: "Ethics and Open Government",
      officialUrl: "https://bega.dc.gov/",
      observedName: "Board of Ethics and Government Accountability",
      confidence: 0.99,
    }),
    dataDir,
  );

  const appointmentCandidateId =
    "candidate.mota.quickbase.board_of_ethics_and_government_accountability_bega";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "mota.quickbase",
      candidateId: appointmentCandidateId,
      sourceItemKey: "quickbase-bega-row",
      proposedEntityId: "dc.board_of_ethics_and_government_accountability",
      name: "Board of Ethics and Government Accountability (BEGA)",
      kind: "public_body",
      observedName: "Board of Ethics and Government Accountability (BEGA)",
      confidence: 0.95,
    }),
    dataDir,
  );

  const appointmentCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = ?",
  ).get(appointmentCandidateId) as { reviewStatus: string } | undefined;
  const canonical = workbench.db.prepare(
    `select kind,
            branch,
            cluster,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.board_of_ethics_and_government_accountability'`,
  ).get() as {
    kind: string;
    branch: string;
    cluster: string;
    officialUrl: string;
    mergedCandidateIds: string;
  };
  const openReview = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix: appointmentCandidateId,
  });
  workbench.close();

  assertEquals(appointmentCandidate?.reviewStatus, "accepted");
  assertEquals(canonical.kind, "agency");
  assertEquals(canonical.branch, "Independent");
  assertEquals(canonical.cluster, "Ethics and Open Government");
  assertEquals(canonical.officialUrl, "https://bega.dc.gov/");
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [
    officialCandidateId,
    appointmentCandidateId,
  ]);
  assertEquals(openReview.length, 0);
});

Deno.test("same-id public-body refinement fills canonical fields without opening entity review", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const weakCandidateId = "candidate.dcgis.agencies.example_public_body";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.agencies",
      candidateId: weakCandidateId,
      sourceItemKey: "dcgis-example-public-body-row",
      proposedEntityId: "dc.example_public_body",
      name: "Example Public Body",
      kind: "public_body",
      observedName: "Example Public Body",
      confidence: 0.95,
    }),
    dataDir,
  );

  const refinedCandidateId = "candidate.open_dc.public_bodies.example_public_body";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "open_dc.public_bodies",
      candidateId: refinedCandidateId,
      sourceItemKey: "open-dc-example-public-body-row",
      proposedEntityId: "dc.example_public_body",
      name: "Example Public Body",
      kind: "board",
      officialUrl: "https://open.dc.gov/public-bodies/example-public-body",
      observedName: "Example Public Body",
      confidence: 0.99,
    }),
    dataDir,
  );

  const refinedCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = ?",
  ).get(refinedCandidateId) as { reviewStatus: string } | undefined;
  const canonical = workbench.db.prepare(
    `select kind,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.example_public_body'`,
  ).get() as {
    kind: string;
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const openReview = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix: refinedCandidateId,
  });
  workbench.close();

  assertEquals(refinedCandidate?.reviewStatus, "accepted");
  assertEquals(canonical.kind, "board");
  assertEquals(canonical.officialUrl, "https://open.dc.gov/public-bodies/example-public-body");
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [weakCandidateId, refinedCandidateId]);
  assertEquals(openReview.length, 0);
});

Deno.test("safe accepted entity candidates fill blank canonical fields from later source evidence", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstCandidateId = "candidate.dcgis.agencies.blank_fields";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.agencies",
      candidateId: firstCandidateId,
      sourceItemKey: "dcgis-blank-fields-row",
      proposedEntityId: "dc.blank_fields_body",
      name: "Blank Fields Body",
      kind: "board",
      observedName: "Blank Fields Body",
      confidence: 0.95,
    }),
    dataDir,
  );

  const laterCandidateId = "candidate.open_dc.public_bodies.blank_fields";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "open_dc.public_bodies",
      candidateId: laterCandidateId,
      sourceItemKey: "open-dc-blank-fields-row",
      proposedEntityId: "dc.blank_fields_body",
      name: "Blank Fields Body",
      kind: "board",
      officialUrl: "https://open.dc.gov/public-bodies/blank-fields-body",
      observedName: "Blank Fields Body",
      confidence: 0.95,
    }),
    dataDir,
  );

  const canonical = workbench.db.prepare(
    `select official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.blank_fields_body'`,
  ).get() as {
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const laterCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = ?",
  ).get(laterCandidateId) as { reviewStatus: string } | undefined;
  const openReview = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix: laterCandidateId,
  });
  workbench.close();

  assertEquals(laterCandidate?.reviewStatus, "accepted");
  assertEquals(canonical.officialUrl, "https://open.dc.gov/public-bodies/blank-fields-body");
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [firstCandidateId, laterCandidateId]);
  assertEquals(openReview.length, 0);
});

Deno.test("authoritative source refinement can replace higher-confidence weaker canonical fields", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const weakCandidateId = "candidate.dcgis.agencies.example_body";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.agencies",
      candidateId: weakCandidateId,
      sourceItemKey: "dcgis-example-body-row",
      proposedEntityId: "dc.example_body",
      name: "Example Body",
      kind: "board",
      officialUrl: "https://dcgis.example/body",
      observedName: "Example Body",
      confidence: 0.99,
    }),
    dataDir,
  );

  const refinedCandidateId = "candidate.bega.structure.example_body";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "bega.structure",
      candidateId: refinedCandidateId,
      sourceItemKey: "bega-example-body-page",
      proposedEntityId: "dc.example_body",
      name: "Example Body",
      kind: "agency",
      branch: "Independent",
      cluster: "Official Cluster",
      officialUrl: "https://example.com/official",
      observedName: "Example Body",
      confidence: 0.91,
    }),
    dataDir,
  );

  const refinedCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = ?",
  ).get(refinedCandidateId) as { reviewStatus: string } | undefined;
  const canonical = workbench.db.prepare(
    `select kind,
            branch,
            cluster,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = 'dc.example_body'`,
  ).get() as {
    kind: string;
    branch: string | null;
    cluster: string | null;
    officialUrl: string | null;
    mergedCandidateIds: string;
  };
  const openReview = workbench.listReviewItems({
    mode: "entities",
    subjectPrefix: refinedCandidateId,
  });
  workbench.close();

  assertEquals(refinedCandidate?.reviewStatus, "accepted");
  assertEquals(canonical.kind, "agency");
  assertEquals(canonical.branch, "Independent");
  assertEquals(canonical.cluster, "Official Cluster");
  assertEquals(canonical.officialUrl, "https://example.com/official");
  assertEquals(JSON.parse(canonical.mergedCandidateIds), [weakCandidateId, refinedCandidateId]);
  assertEquals(openReview.length, 0);
});

Deno.test("changed entity evidence after a prior accept becomes stale review work instead of silent reuse", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.signature.entities.example_v1", "Example Body"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: "candidate.test.signature.entities.example_v1",
      payload: {},
    },
    resolutionsDir,
  );

  await workbench.importConnectorResult(
    syntheticEntitySourceResult(
      "candidate.test.signature.entities.example_v2",
      "Example Body (Updated Source Text)",
    ),
    dataDir,
  );

  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = 'candidate.test.signature.entities.example_v2'",
  ).get() as { reviewStatus: string };
  const staleItem = workbench.listReviewItems({
    mode: "entities",
    status: "open",
  }).find((item) => item.subjectId === "candidate.test.signature.entities.example_v2");
  workbench.close();

  assertEquals(secondCandidate.reviewStatus, "pending");
  assert(staleItem);
  assertEquals(staleItem.details.priorDecisionState, "accepted");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior accepted decision");
});

Deno.test("unchanged entity refetch keeps later entity field edits without reopening review", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstCandidateId = "candidate.test.signature.entities.example_edit_keep_v1";
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(firstCandidateId, "Example Body"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: firstCandidateId,
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "set_entity_fields",
      subjectId: "dc.example_body",
      payload: {
        entityId: "dc.example_body",
        fields: { branch: "reviewed-branch", cluster: "reviewed-cluster" },
      },
    },
    resolutionsDir,
  );

  const secondCandidateId = "candidate.test.signature.entities.example_edit_keep_v2";
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(secondCandidateId, "Example Body"),
    dataDir,
  );

  const canonical = workbench.db.prepare(
    "select branch, cluster, merged_candidate_ids as mergedCandidateIds from canonical_entities where entity_id = 'dc.example_body'",
  ).get() as { branch: string; cluster: string; mergedCandidateIds: string };
  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = ?",
  ).get(secondCandidateId) as { reviewStatus: string };
  const openItems = workbench.listReviewItems({
    mode: "entities",
    status: "open",
  });
  workbench.close();

  assertEquals(secondCandidate.reviewStatus, "accepted");
  assertEquals(canonical.branch, "reviewed-branch");
  assertEquals(canonical.cluster, "reviewed-cluster");
  assertEquals(
    JSON.parse(canonical.mergedCandidateIds) as string[],
    [
      firstCandidateId,
      secondCandidateId,
    ],
  );
  assertEquals(openItems.length, 0);
});

Deno.test("changed entity evidence after later entity field edits preserves prior resolved fields", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstCandidateId = "candidate.test.signature.entities.example_edit_v1";
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(firstCandidateId, "Example Body"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "accept_entity_candidate",
      subjectId: firstCandidateId,
      payload: {},
    },
    resolutionsDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "set_entity_fields",
      subjectId: "dc.example_body",
      payload: {
        entityId: "dc.example_body",
        fields: { branch: "reviewed-branch", cluster: "reviewed-cluster" },
      },
    },
    resolutionsDir,
  );

  const secondCandidateId = "candidate.test.signature.entities.example_edit_v2";
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(secondCandidateId, "Example Body (Updated Source Text)"),
    dataDir,
  );

  const staleItem = workbench.listReviewItems({
    mode: "entities",
    status: "open",
  }).find((item) => item.subjectId === secondCandidateId);
  workbench.close();

  assert(staleItem);
  const priorResolvedFields = staleItem.details.priorResolvedFields as {
    branch?: string;
    cluster?: string;
  };
  assertEquals(staleItem.details.priorDecisionState, "accepted");
  assertEquals(priorResolvedFields.branch, "reviewed-branch");
  assertEquals(priorResolvedFields.cluster, "reviewed-cluster");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior accepted decision");
});

Deno.test("deferred entity review decisions are reused across refetch when candidate ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstCandidateId = "candidate.test.signature.entities.example_defer_v1";
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(firstCandidateId, "Example Body"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(firstCandidateId, "entity-review"),
      payload: {},
    },
    resolutionsDir,
  );

  const secondCandidateId = "candidate.test.signature.entities.example_defer_v2";
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(secondCandidateId, "Example Body"),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where subject_id = ?",
  ).get(buildReviewItemId(firstCandidateId, "entity-review")) as { payloadJson: string };
  const deferredItems = workbench.listReviewItems({
    mode: "entities",
    status: "deferred",
  });
  const openItems = workbench.listReviewItems({
    mode: "entities",
    status: "open",
  });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    fact_signature?: string;
    evidence_hash?: string;
  };
  assertStringIncludes(payload.fact_signature ?? "", "entity_candidate:test.signature.entities");
  assertStringIncludes(payload.evidence_hash ?? "", "sha256:");
  assertEquals(
    deferredItems.some((item) => item.subjectId === secondCandidateId),
    true,
  );
  assertEquals(deferredItems.length, 1);
  assertEquals(openItems.length, 0);
});

Deno.test("changed entity evidence after a prior defer becomes stale open review work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const firstCandidateId = "candidate.test.signature.entities.example_defer_v1";
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(firstCandidateId, "Example Body"),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(firstCandidateId, "entity-review"),
      payload: {},
    },
    resolutionsDir,
  );

  const secondCandidateId = "candidate.test.signature.entities.example_defer_v2";
  await workbench.importConnectorResult(
    syntheticEntitySourceResult(secondCandidateId, "Example Body (Updated Source Text)"),
    dataDir,
  );

  const staleItem = workbench.listReviewItems({
    mode: "entities",
    status: "open",
  }).find((item) => item.subjectId === secondCandidateId);
  const deferredItems = workbench.listReviewItems({
    mode: "entities",
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

Deno.test("merged entity decisions are reused across refetch when candidate ids change", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.existing_board', 'Existing Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  const firstCandidateId = "candidate.test.signature.entities.example_merge_v1";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.signature.entities",
      candidateId: firstCandidateId,
      sourceItemKey: "example-row",
      proposedEntityId: "dc.example_body",
      name: "Example Body",
      kind: "board",
      observedName: "Example Body",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "merge_entity_candidates",
      subjectId: firstCandidateId,
      payload: {
        entityId: "dc.existing_board",
        candidateIds: [firstCandidateId],
      },
    },
    resolutionsDir,
  );

  const secondCandidateId = "candidate.test.signature.entities.example_merge_v2";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.signature.entities",
      candidateId: secondCandidateId,
      sourceItemKey: "example-row",
      proposedEntityId: "dc.example_body",
      name: "Example Body",
      kind: "board",
      observedName: "Example Body",
    }),
    dataDir,
  );

  const resolutionPayload = workbench.db.prepare(
    "select payload_json as payloadJson from resolution_events where event_type = 'merge_entity_candidates' and subject_id = ?",
  ).get(firstCandidateId) as { payloadJson: string };
  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = ?",
  ).get(secondCandidateId) as { reviewStatus: string };
  const canonical = workbench.db.prepare(
    "select merged_candidate_ids as mergedCandidateIds from canonical_entities where entity_id = 'dc.existing_board'",
  ).get() as { mergedCandidateIds: string };
  const openItems = workbench.listReviewItems({ mode: "entities", status: "open" });
  workbench.close();

  const payload = JSON.parse(resolutionPayload.payloadJson) as {
    candidate_replays?: Array<{ fact_signature?: string; evidence_hash?: string }>;
  };
  assertStringIncludes(
    payload.candidate_replays?.[0]?.fact_signature ?? "",
    "entity_candidate:test.signature.entities",
  );
  assertStringIncludes(payload.candidate_replays?.[0]?.evidence_hash ?? "", "sha256:");
  assertEquals(secondCandidate.reviewStatus, "accepted");
  assertEquals(openItems.length, 0);
  assertEquals(
    JSON.parse(canonical.mergedCandidateIds) as string[],
    [
      firstCandidateId,
      secondCandidateId,
    ],
  );
});

Deno.test("changed entity evidence after a prior merge becomes stale review work instead of silent reuse", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.existing_board', 'Existing Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  const firstCandidateId = "candidate.test.signature.entities.example_merge_v1";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.signature.entities",
      candidateId: firstCandidateId,
      sourceItemKey: "example-row",
      proposedEntityId: "dc.example_body",
      name: "Example Body",
      kind: "board",
      observedName: "Example Body",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "merge_entity_candidates",
      subjectId: firstCandidateId,
      payload: {
        entityId: "dc.existing_board",
        candidateIds: [firstCandidateId],
      },
    },
    resolutionsDir,
  );

  const secondCandidateId = "candidate.test.signature.entities.example_merge_v2";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.signature.entities",
      candidateId: secondCandidateId,
      sourceItemKey: "example-row",
      proposedEntityId: "dc.example_body",
      name: "Example Body",
      kind: "board",
      observedName: "Example Body (Updated Source Text)",
    }),
    dataDir,
  );

  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = ?",
  ).get(secondCandidateId) as { reviewStatus: string };
  const staleItem = workbench.listReviewItems({
    mode: "entities",
    status: "open",
  }).find((item) => item.subjectId === secondCandidateId);
  workbench.close();

  assertEquals(secondCandidate.reviewStatus, "pending");
  assert(staleItem);
  assertEquals(staleItem.details.priorDecisionState, "merged");
  assertEquals(staleItem.details.priorResolvedEntityId, "dc.existing_board");
  assertEquals(staleItem.details.stalePriorDecision, true);
  assertStringIncludes(staleItem.reason, "changed since a prior merged decision");
});

Deno.test("missing resolved merge target returns unchanged entity refetch to review instead of silently resolving it", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.existing_board', 'Existing Board', 'board', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  const firstCandidateId = "candidate.test.signature.entities.example_merge_conflict_v1";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.signature.entities",
      candidateId: firstCandidateId,
      sourceItemKey: "example-row",
      proposedEntityId: "dc.example_body",
      name: "Example Body",
      kind: "board",
      observedName: "Example Body",
    }),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "merge_entity_candidates",
      subjectId: firstCandidateId,
      payload: {
        entityId: "dc.existing_board",
        candidateIds: [firstCandidateId],
      },
    },
    resolutionsDir,
  );
  workbench.db.prepare("delete from canonical_entities where entity_id = 'dc.existing_board'")
    .run();

  const secondCandidateId = "candidate.test.signature.entities.example_merge_conflict_v2";
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.signature.entities",
      candidateId: secondCandidateId,
      sourceItemKey: "example-row",
      proposedEntityId: "dc.example_body",
      name: "Example Body",
      kind: "board",
      observedName: "Example Body",
      confidence: 0.99,
    }),
    dataDir,
  );

  const secondCandidate = workbench.db.prepare(
    "select review_status as reviewStatus from entity_candidates where candidate_id = ?",
  ).get(secondCandidateId) as { reviewStatus: string };
  const conflictItem = workbench.listReviewItems({
    mode: "entities",
    status: "open",
  }).find((item) => item.subjectId === secondCandidateId);
  const conflictItemCanBatchAccept = conflictItem
    ? canBatchAcceptReviewItem(workbench, conflictItem, {
      mode: "entities",
      subjectPrefix: "candidate.test.signature.entities",
    })
    : undefined;
  workbench.close();

  assertEquals(secondCandidate.reviewStatus, "pending");
  assert(conflictItem);
  assertEquals(conflictItem.details.priorDecisionState, "merged");
  assertEquals(conflictItem.details.priorResolvedEntityId, "dc.existing_board");
  assertEquals(conflictItem.details.replayConflict, true);
  assertEquals(conflictItemCanBatchAccept, false);
  assertStringIncludes(
    conflictItem.reason,
    "prior merged decision could not be replayed because resolved entity dc.existing_board is missing",
  );
});

Deno.test("entity replay batches prior-decision lookups across refetched candidates", async () => {
  const one = await countEntityReplayPrepares(1);
  const many = await countEntityReplayPrepares(8);

  assertEquals(one.acceptRejectDecisionQueries, 1);
  assertEquals(one.mergeDecisionQueries, 0);
  assertEquals(one.deferReviewDecisionQueries, 0);
  assertEquals(one.candidateStatusQueries, 1);
  assertEquals(one.reviewItemQueries, 0);

  assertEquals(many.acceptRejectDecisionQueries, 1);
  assertEquals(many.mergeDecisionQueries, 0);
  assertEquals(many.deferReviewDecisionQueries, 0);
  assertEquals(many.candidateStatusQueries, 1);
  assertEquals(many.reviewItemQueries, 0);
});

async function countEntityReplayPrepares(candidateCount: number): Promise<{
  acceptRejectDecisionQueries: number;
  mergeDecisionQueries: number;
  deferReviewDecisionQueries: number;
  candidateStatusQueries: number;
  reviewItemQueries: number;
}> {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  const hints = [];
  for (let index = 0; index < candidateCount; index += 1) {
    const sourceItemKey = `bulk-entity-row-${index}`;
    const firstCandidateId = `candidate.test.signature.entities.bulk_${index}_v1`;
    await workbench.importConnectorResult(
      syntheticCustomEntitySourceResult({
        sourceId: "test.signature.entities",
        candidateId: firstCandidateId,
        sourceItemKey,
        proposedEntityId: `dc.bulk_entity_${index}`,
        name: `Bulk Entity ${index}`,
        kind: "board",
        observedName: `Bulk Entity ${index}`,
        confidence: 0.95,
      }),
      dataDir,
    );
    await workbench.appendResolutionEvent(
      {
        eventType: "accept_entity_candidate",
        subjectId: firstCandidateId,
        payload: {},
      },
      resolutionsDir,
    );

    const secondCandidateId = `candidate.test.signature.entities.bulk_${index}_v2`;
    const secondResult = syntheticCustomEntitySourceResult({
      sourceId: "test.signature.entities",
      candidateId: secondCandidateId,
      sourceItemKey,
      proposedEntityId: `dc.bulk_entity_${index}`,
      name: `Bulk Entity ${index}`,
      kind: "board",
      observedName: `Bulk Entity ${index}`,
      confidence: 0.95,
    });
    await workbench.importConnectorResult(secondResult, dataDir);
    const endpointResult = secondResult.endpointResults[0];
    assert(endpointResult);
    const parsed = endpointResult.parsed;
    assert(parsed);
    const entityCandidate = parsed.entityCandidates?.[0];
    assert(entityCandidate);
    hints.push(
      await buildEntityDecisionHint(
        secondResult.source.sourceId,
        entityCandidate,
      ),
    );
  }

  let acceptRejectDecisionQueries = 0;
  let mergeDecisionQueries = 0;
  let deferReviewDecisionQueries = 0;
  let candidateStatusQueries = 0;
  let reviewItemQueries = 0;
  const store = {
    db: {
      exec(sql: string) {
        return workbench.db.exec(sql);
      },
      prepare(sql: string) {
        if (sql.includes("accept_entity_candidate', 'reject_entity_candidate")) {
          acceptRejectDecisionQueries += 1;
        }
        if (
          sql.includes("merge_entity_candidates") &&
          sql.includes("candidate_replays")
        ) {
          mergeDecisionQueries += 1;
        }
        if (sql.includes("defer_review_item', 'reopen_review_item")) {
          deferReviewDecisionQueries += 1;
        }
        if (
          sql.includes("from entity_candidates") &&
          sql.includes("review_status as reviewStatus")
        ) {
          candidateStatusQueries += 1;
        }
        if (
          sql.includes("from review_items") &&
          sql.includes("item_type = 'entity_candidate'") &&
          sql.includes("subject_id in")
        ) {
          reviewItemQueries += 1;
        }
        return workbench.db.prepare(sql);
      },
    },
  };

  await reuseOrMarkStaleEntityDecisions(
    store as unknown as Parameters<typeof reuseOrMarkStaleEntityDecisions>[0],
    hints,
  );
  workbench.close();
  return {
    acceptRejectDecisionQueries,
    mergeDecisionQueries,
    deferReviewDecisionQueries,
    candidateStatusQueries,
    reviewItemQueries,
  };
}
