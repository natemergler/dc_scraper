import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { connectors } from "../src/v2/connectors.ts";
import { buildReviewItemId } from "../src/v2/domain.ts";
import { buildWorkbenchStatus } from "../src/v2/status.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
  syntheticEntitySourceResult,
  syntheticLegalRefSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

function seedConfiguredSourceRuns(
  workbench: Workbench,
  statuses: Record<string, "success" | "failed"> = {},
): void {
  for (const [index, connector] of connectors.entries()) {
    const source = connector.source;
    workbench.upsertSource(
      source.sourceId,
      source.title,
      source.kind,
      source.accessMethod,
      source.baseUrl,
      source.notes,
    );
    const endpointId = `${source.sourceId}.status_test`;
    workbench.upsertEndpoint({
      endpointId,
      sourceId: source.sourceId,
      title: "Status test endpoint",
      kind: "fixture",
      url: source.baseUrl,
      method: "GET",
      captureMode: "rows",
    });
    workbench.db.prepare(
      "insert into source_runs(run_id, source_id, endpoint_id, started_at, finished_at, status) values(?, ?, ?, datetime('now'), datetime('now'), ?)",
    ).run(
      `run.status_test.${index}`,
      source.sourceId,
      endpointId,
      statuses[source.sourceId] ?? "success",
    );
  }
}

Deno.test("status readiness note is explicit when the workbench is ready", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedConfiguredSourceRuns(workbench);

  const status = buildWorkbenchStatus(workbench);
  workbench.close();

  assertEquals(status.nextCommand, "deno task dc -- release build");
  assertEquals(
    status.unresolvedStateNote,
    "No open review items, deferred review items, stale review items, blocked reconciliation items, or placeholder entities were present.",
  );
});

Deno.test("status sends source failures to source inspection before review work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedConfiguredSourceRuns(workbench, { "council.committees": "failed" });
  workbench.db.prepare(
    "insert into review_items(review_item_id, item_type, subject_id, reason, default_action, status, details_json, created_at, updated_at) values('review.test.failed_source_priority', 'entity_candidate', 'candidate.test.failed_source_priority', 'Fixture human review item', 'reject', 'open', '{}', datetime('now'), datetime('now'))",
  ).run();

  const status = buildWorkbenchStatus(workbench);
  workbench.close();

  assertEquals(status.sources.failed, 1);
  assertEquals(status.sources.firstFailedSourceId, "council.committees");
  assertEquals(status.review.open, 1);
  assertEquals(status.review.humanDecisionOpen, 1);
  assertEquals(status.nextCommand, "deno task dc -- source inspect council.committees");
});

Deno.test("status surfaces placeholder risk with readable reason", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values('dc.placeholder_example', 'Placeholder Example', 'placeholder', 'placeholder', '[]', 1, 'fixture placeholder', datetime('now'), datetime('now'))",
  ).run();
  workbench.close();

  const statusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
    ],
  }).output();
  assertEquals(statusOutput.code, 0);
  const statusText = new TextDecoder().decode(statusOutput.stdout);
  assertStringIncludes(statusText, "Placeholders: 1");
  assertStringIncludes(statusText, "Placeholder Example");
  assertStringIncludes(statusText, "fixture placeholder");

  const jsonStatusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(jsonStatusOutput.code, 0);
  const jsonStatus = JSON.parse(new TextDecoder().decode(jsonStatusOutput.stdout)) as {
    placeholders: {
      count: number;
      byReason: Array<{ reason: string; count: number }>;
      firstPlaceholder?: {
        entityId: string;
        name: string;
        placeholderReason?: string | null;
      };
    };
  };
  assertEquals(jsonStatus.placeholders.count, 1);
  assertEquals(jsonStatus.placeholders.firstPlaceholder?.entityId, "dc.placeholder_example");
  assertEquals(jsonStatus.placeholders.firstPlaceholder?.name, "Placeholder Example");
  assertEquals(jsonStatus.placeholders.firstPlaceholder?.placeholderReason, "fixture placeholder");
  assert(
    jsonStatus.placeholders.byReason.some((row) =>
      row.reason === "fixture placeholder" && row.count === 1
    ),
  );
});

Deno.test("status surfaces stale review debt from prior decisions", async () => {
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
  workbench.close();

  const statusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
    ],
  }).output();
  assertEquals(statusOutput.code, 0);
  const statusText = new TextDecoder().decode(statusOutput.stdout);
  assertStringIncludes(statusText, "Stale review: 1");
  assertStringIncludes(statusText, "accepted");

  const jsonStatusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(jsonStatusOutput.code, 0);
  const jsonStatus = JSON.parse(new TextDecoder().decode(jsonStatusOutput.stdout)) as {
    staleReview: {
      count: number;
      byPriorDecisionState: Array<{ priorDecisionState: string; count: number }>;
      firstStale?: {
        subjectId: string;
        priorDecisionState?: string;
        reason: string;
      };
    };
  };
  assertEquals(jsonStatus.staleReview.count, 1);
  assert(
    jsonStatus.staleReview.byPriorDecisionState.some((row) =>
      row.priorDecisionState === "accepted" && row.count === 1
    ),
  );
  assertEquals(
    jsonStatus.staleReview.firstStale?.subjectId,
    "candidate.test.signature.entities.example_v2",
  );
  assertEquals(jsonStatus.staleReview.firstStale?.priorDecisionState, "accepted");
  assertStringIncludes(
    jsonStatus.staleReview.firstStale?.reason ?? "",
    "changed since a prior accepted decision",
  );
});

Deno.test("status surfaces unresolved review debt by source and type", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticEntitySourceResult("candidate.test.signature.entities.review_debt_v1", "Example Body"),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.review_debt_v1",
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId("legal.test.signature.legal_refs.review_debt_v1", "legal-ref"),
      payload: {},
    },
    resolutionsDir,
  );
  workbench.close();

  const statusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
    ],
  }).output();
  assertEquals(statusOutput.code, 0);
  const statusText = new TextDecoder().decode(statusOutput.stdout);
  assertStringIncludes(statusText, "Review debt by type:");
  assertStringIncludes(statusText, "entity_candidate(open=1,deferred=0)");
  assertStringIncludes(statusText, "legal_ref(open=0,deferred=1)");
  assertStringIncludes(statusText, "Review debt by source:");
  assertStringIncludes(statusText, "test.signature.entities(open=1,deferred=0)");
  assertStringIncludes(statusText, "test.signature.legal_refs(open=0,deferred=1)");

  const jsonStatusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(jsonStatusOutput.code, 0);
  const jsonStatus = JSON.parse(new TextDecoder().decode(jsonStatusOutput.stdout)) as {
    unresolvedStateNote: string;
    review: {
      open: number;
      humanDecisionOpen: number;
      browseOnlyOpen: number;
      deferred: number;
      byType: Array<{ itemType: string; openCount: number; deferredCount: number }>;
      bySource: Array<{ sourceId: string; openCount: number; deferredCount: number }>;
    };
  };
  assertEquals(jsonStatus.review.open, 1);
  assertEquals(jsonStatus.review.humanDecisionOpen, 0);
  assertEquals(jsonStatus.review.browseOnlyOpen, 1);
  assertEquals(jsonStatus.review.deferred, 1);
  assert(
    jsonStatus.review.byType.some((row) =>
      row.itemType === "entity_candidate" && row.openCount === 1 && row.deferredCount === 0
    ),
  );
  assert(
    jsonStatus.review.byType.some((row) =>
      row.itemType === "legal_ref" && row.openCount === 0 && row.deferredCount === 1
    ),
  );
  assert(
    jsonStatus.review.bySource.some((row) =>
      row.sourceId === "test.signature.entities" && row.openCount === 1 &&
      row.deferredCount === 0
    ),
  );
  assert(
    jsonStatus.review.bySource.some((row) =>
      row.sourceId === "test.signature.legal_refs" && row.openCount === 0 &&
      row.deferredCount === 1
    ),
  );
  assertStringIncludes(jsonStatus.unresolvedStateNote, "Unresolved workbench state:");
  assertStringIncludes(jsonStatus.unresolvedStateNote, "open review=1");
  assertStringIncludes(jsonStatus.unresolvedStateNote, "human decisions=0");
  assertStringIncludes(jsonStatus.unresolvedStateNote, "browse-only=1");
  assertStringIncludes(jsonStatus.unresolvedStateNote, "deferred review=1");
});

Deno.test("status routes human decisions to review but browse-only additions to later workflow steps", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.example_agency', 'Example Agency', 'agency', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.other_branch', 'Other', 'branch', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();

  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "dcgis.agencies",
      relationshipCandidateId: "relationship.dcgis.agencies.example_other_branch",
      sourceItemKey: "agency-other-branch-row",
      fromEntityRef: "dc.example_agency",
      toEntityRef: "dc.other_branch",
      relationshipType: "part_of",
      rawValue: "Other",
      needsReview: false,
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    {
      source: {
        sourceId: "dcgis.agencies",
        title: "Test DCGIS Agencies Legal Refs",
        kind: "fixture",
        accessMethod: "fixture",
        baseUrl: "https://example.com/dcgis.agencies",
      },
      endpointResults: [{
        endpoint: {
          endpointId: "dcgis.agencies.legal",
          sourceId: "dcgis.agencies",
          title: "Agency legal refs",
          kind: "fixture",
          url: "https://example.com/dcgis.agencies",
          method: "GET",
          captureMode: "rows",
        },
        status: "success",
        artifacts: [{
          kind: "rows",
          extension: "json",
          fetchedUrl: "https://example.com/dcgis.agencies",
          contentText: JSON.stringify({
            legalRefId: "legal.dcgis.agencies.unknown_v1",
            citationText: "DC. ST. D.I., T.1, Ch. 15, Subch. III, Part A, 1979 Plan 2",
          }),
        }],
        parsed: {
          items: [{
            itemKey: "agency-legal-row",
            itemType: "fixture_row",
            title: "Agency legal row",
            body: { citationText: "DC. ST. D.I., T.1, Ch. 15, Subch. III, Part A, 1979 Plan 2" },
          }],
          legalRefs: [{
            legalRefId: "legal.dcgis.agencies.unknown_v1",
            sourceItemKey: "agency-legal-row",
            refType: "unknown",
            citationText: "DC. ST. D.I., T.1, Ch. 15, Subch. III, Part A, 1979 Plan 2",
            url: "https://example.com/unknown",
            needsReview: true,
            evidence: [{
              fieldPath: "citation",
              observedValue: "DC. ST. D.I., T.1, Ch. 15, Subch. III, Part A, 1979 Plan 2",
            }],
          }],
        },
      }],
    },
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.high_confidence.entities",
      candidateId: "candidate.test.high_confidence.entities.example_explicit_safe",
      sourceItemKey: "explicit-safe-board-row",
      proposedEntityId: "dc.example_explicit_safe_board",
      name: "Example Explicit Safe Board",
      kind: "board",
      observedName: "Example Explicit Safe Board",
    }),
    dataDir,
  );
  workbench.db.prepare(
    "update review_items set details_json = ? where subject_id = ?",
  ).run(
    JSON.stringify({
      name: "Example Explicit Safe Board",
      kind: "board",
      safeToAutoAccept: true,
    }),
    "candidate.test.high_confidence.entities.example_explicit_safe",
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "test.high_confidence.entities",
      candidateId: "candidate.test.high_confidence.entities.example_high_confidence",
      sourceItemKey: "high-confidence-board-row",
      proposedEntityId: "dc.example_high_confidence_board",
      name: "Example High Confidence Board",
      kind: "board",
      observedName: "Example High Confidence Board",
      confidence: 0.95,
    }),
    dataDir,
  );
  workbench.close();

  const statusOutputOne = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(statusOutputOne.code, 0);
  const statusOne = JSON.parse(new TextDecoder().decode(statusOutputOne.stdout)) as {
    nextCommand: string;
  };
  assertEquals(
    statusOne.nextCommand,
    "deno task dc -- review",
  );

  const acceptExplicitEntitiesOutput = await new Deno.Command(Deno.execPath(), {
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
      "candidate.test.high_confidence.entities.example_explicit_safe",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(acceptExplicitEntitiesOutput.code, 0);

  const statusOutputTwo = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(statusOutputTwo.code, 0);
  const statusTwo = JSON.parse(new TextDecoder().decode(statusOutputTwo.stdout)) as {
    nextCommand: string;
  };
  assertEquals(
    statusTwo.nextCommand,
    "deno task dc -- review",
  );

  const deferRelationshipsOutput = await new Deno.Command(Deno.execPath(), {
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
      "--subject-prefix",
      "relationship.dcgis.agencies",
      "--relationship-type",
      "part_of",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferRelationshipsOutput.code, 0);

  const statusOutputThree = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(statusOutputThree.code, 0);
  const statusThree = JSON.parse(new TextDecoder().decode(statusOutputThree.stdout)) as {
    nextCommand: string;
  };
  assertEquals(
    statusThree.nextCommand,
    "deno task dc -- review",
  );

  const deferLegalOutput = await new Deno.Command(Deno.execPath(), {
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
      "legal.dcgis.agencies",
      "--ref-type",
      "unknown",
      "--db",
      dbPath,
      "--resolutions-dir",
      resolutionsDir,
    ],
  }).output();
  assertEquals(deferLegalOutput.code, 0);

  const statusOutputFour = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(statusOutputFour.code, 0);
  const statusFour = JSON.parse(new TextDecoder().decode(statusOutputFour.stdout)) as {
    nextCommand: string;
    review: {
      open: number;
      humanDecisionOpen: number;
      browseOnlyOpen: number;
      deferred: number;
    };
  };
  assertEquals(statusFour.review.open, 1);
  assertEquals(statusFour.review.humanDecisionOpen, 0);
  assertEquals(statusFour.review.browseOnlyOpen, 1);
  assertEquals(statusFour.review.deferred, 2);
  assertEquals(
    statusFour.nextCommand,
    "deno task dc -- source list",
  );
});

Deno.test("status points to audit when blocked reconciliation is the only remaining work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.committee_on_health', 'Committee on Health', 'committee', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.blocked.only_remaining",
      sourceItemKey: "blocked-only-row",
      fromEntityRef:
        "dc.all_of_the_advisory_committees_and_professional_boards_serving_the_department_of_health_or_department_of_behavioral_health",
      toEntityRef: "dc.committee_on_health",
      relationshipType: "overseen_by",
      rawValue:
        "All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health",
    }),
    dataDir,
  );
  workbench.close();

  const statusOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "status",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(statusOutput.code, 0);
  const status = JSON.parse(new TextDecoder().decode(statusOutput.stdout)) as {
    nextCommand: string;
  };
  assertEquals(status.nextCommand, "deno task dc -- audit");
});

Deno.test("audit surfaces first blocked raw value and old doctor aliases are unavailable", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, created_at, updated_at) values('dc.committee_on_health', 'Committee on Health', 'committee', 'accepted', '[]', datetime('now'), datetime('now'))",
  ).run();
  await workbench.importConnectorResult(
    syntheticCustomRelationshipSourceResult({
      sourceId: "council.committees",
      relationshipCandidateId: "relationship.test.blocked.audit",
      sourceItemKey: "blocked-audit-row",
      fromEntityRef:
        "dc.all_of_the_advisory_committees_and_professional_boards_serving_the_department_of_health_or_department_of_behavioral_health",
      toEntityRef: "dc.committee_on_health",
      relationshipType: "overseen_by",
      rawValue:
        "All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health",
    }),
    dataDir,
  );
  workbench.close();

  const auditOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "audit",
      "--db",
      dbPath,
    ],
  }).output();
  assertEquals(auditOutput.code, 0);
  const auditText = new TextDecoder().decode(auditOutput.stdout);
  assertStringIncludes(
    auditText,
    "First blocked: All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health [overseen_by from council.committees]",
  );
  assertStringIncludes(auditText, "Blocked detail:");
  assertStringIncludes(
    auditText,
    "Value: All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health",
  );
  assertStringIncludes(
    auditText,
    "Waiting on: All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health (missing endpoint;",
  );
  assertStringIncludes(
    auditText,
    "Subject id: relationship.test.blocked.audit",
  );
  assertStringIncludes(
    auditText,
    "Inspect source: deno task dc -- source inspect council.committees",
  );

  const auditJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "audit",
      "--db",
      dbPath,
      "--json",
    ],
  }).output();
  assertEquals(auditJsonOutput.code, 0);
  const auditJson = JSON.parse(new TextDecoder().decode(auditJsonOutput.stdout)) as {
    reconciliation: {
      blocked: number;
      firstBlocked?: {
        sourceId: string;
        rawValue?: string | null;
      };
    };
    nextCommand: string;
  };
  assertEquals(auditJson.reconciliation.blocked, 1);
  assertEquals(auditJson.reconciliation.firstBlocked?.sourceId, "council.committees");
  assertEquals(
    auditJson.reconciliation.firstBlocked?.rawValue,
    "All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health",
  );
  assertEquals(auditJson.nextCommand, "deno task dc -- audit");

  const doctorOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "doctor",
      "--db",
      dbPath,
    ],
  }).output();
  assertEquals(doctorOutput.code, 2);
  assertStringIncludes(
    new TextDecoder().decode(doctorOutput.stderr),
    "Unknown command: doctor",
  );

  const auditDoctorOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "audit",
      "doctor",
      "--db",
      dbPath,
    ],
  }).output();
  assertEquals(auditDoctorOutput.code, 2);
  assertStringIncludes(
    new TextDecoder().decode(auditDoctorOutput.stderr),
    "Unknown command: audit doctor",
  );
});
