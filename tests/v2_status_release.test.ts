import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { connectors } from "../src/v2/connectors.ts";
import { buildReviewItemId } from "../src/v2/domain.ts";
import { buildWorkbenchStatus, renderWorkbenchStatus } from "../src/v2/status.ts";
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

  assertEquals(status.nextCommand, "deno task dc -- release verify");
  assertEquals(
    status.unresolvedStateNote,
    "No open decisions, browse rows, deferred review items, stale review items, blocked reconciliation items, or placeholder entities were present.",
  );
});

Deno.test("status sends source failures to source inspection before review work", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const workbench = new Workbench(dbPath);
  workbench.init();
  seedConfiguredSourceRuns(workbench, { "council.committees": "failed" });
  workbench.db.prepare(
    "update source_runs set error_text = ? where source_id = ?",
  ).run("Fixture source failed while fetching committee detail pages", "council.committees");
  workbench.db.prepare(
    "insert into review_items(review_item_id, item_type, subject_id, reason, default_action, status, details_json, created_at, updated_at) values('review.test.failed_source_priority', 'entity_candidate', 'candidate.test.failed_source_priority', 'Fixture human review item', 'reject', 'open', '{}', datetime('now'), datetime('now'))",
  ).run();

  const status = buildWorkbenchStatus(workbench);
  workbench.close();

  assertEquals(status.sources.failed, 1);
  assertEquals(status.sources.firstFailedSourceId, "council.committees");
  assertEquals(
    status.sources.firstFailedSourceErrorText,
    "Fixture source failed while fetching committee detail pages",
  );
  assertEquals(status.review.open, 1);
  assertEquals(status.review.humanDecisionOpen, 1);
  assertEquals(status.nextCommand, "deno task dc -- source inspect council.committees");
  const statusText = renderWorkbenchStatus(status);
  assertStringIncludes(statusText, "First failed source: council.committees");
  assertStringIncludes(
    statusText,
    "Failure detail: Fixture source failed while fetching committee detail pages",
  );

  const statusJsonOutput = await runDcCli(["status", "--db", dbPath, "--json"]);
  const statusJson = JSON.parse(statusJsonOutput.stdout) as {
    sources: {
      firstFailedSourceId?: string;
      firstFailedSourceErrorText?: string;
    };
  };
  assertEquals(statusJsonOutput.code, 0);
  assertEquals(statusJson.sources.firstFailedSourceId, "council.committees");
  assertEquals(
    statusJson.sources.firstFailedSourceErrorText,
    "Fixture source failed while fetching committee detail pages",
  );
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

  const statusOutput = await runDcCli(["status", "--db", dbPath]);
  assertEquals(statusOutput.code, 0);
  const statusText = statusOutput.stdout;
  assertStringIncludes(statusText, "Placeholders: 1");
  assertStringIncludes(statusText, "Placeholder Example");
  assertStringIncludes(statusText, "fixture placeholder");

  const auditOutput = await runDcCli(["audit", "--db", dbPath]);
  assertEquals(auditOutput.code, 0);
  const auditText = auditOutput.stdout;
  assertStringIncludes(auditText, "Placeholder detail:");
  assertStringIncludes(auditText, "Entity: Placeholder Example");
  assertStringIncludes(auditText, "Reason: fixture placeholder");
  assertStringIncludes(auditText, "Entity id: dc.placeholder_example");

  const jsonStatusOutput = await runDcCli(["status", "--db", dbPath, "--json"]);
  assertEquals(jsonStatusOutput.code, 0);
  const jsonStatus = JSON.parse(jsonStatusOutput.stdout) as {
    nextCommand: string;
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
  assertEquals(jsonStatus.nextCommand, `deno task dc -- audit --db ${dbPath}`);
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

  const statusOutput = await runDcCli(["status", "--db", dbPath]);
  assertEquals(statusOutput.code, 0);
  const statusText = statusOutput.stdout;
  assertStringIncludes(statusText, "Stale review: 1");
  assertStringIncludes(statusText, "accepted");
  assertStringIncludes(statusText, "First stale:");
  assertStringIncludes(statusText, "candidate.test.signature.entities.example_v2");
  assertStringIncludes(statusText, "changed since a prior accepted decision");

  const auditOutput = await runDcCli(["audit", "--db", dbPath]);
  assertEquals(auditOutput.code, 0);
  const auditText = auditOutput.stdout;
  assertStringIncludes(auditText, "Stale review detail:");
  assertStringIncludes(auditText, "Subject id: candidate.test.signature.entities.example_v2");
  assertStringIncludes(auditText, "Prior decision: accepted");
  assertStringIncludes(
    auditText,
    "Reason: Review fixture entity candidate (changed since a prior accepted decision)",
  );

  const jsonStatusOutput = await runDcCli(["status", "--db", dbPath, "--json"]);
  assertEquals(jsonStatusOutput.code, 0);
  const jsonStatus = JSON.parse(jsonStatusOutput.stdout) as {
    nextCommand: string;
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
  assertEquals(jsonStatus.nextCommand, `deno task dc -- review --db ${dbPath}`);
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

Deno.test("status reports browse-only and deferred work without review ledgers", async () => {
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

  const statusOutput = await runDcCli(["status", "--db", dbPath]);
  assertEquals(statusOutput.code, 0);
  const statusText = statusOutput.stdout;
  assert(!statusText.includes("Review ledger by type:"));
  assert(!statusText.includes("Review ledger by source:"));
  assertStringIncludes(
    statusText,
    `Browse rows: deno task dc -- review list --status all --db ${dbPath}`,
  );

  const jsonStatusOutput = await runDcCli(["status", "--db", dbPath, "--json"]);
  assertEquals(jsonStatusOutput.code, 0);
  const jsonStatus = JSON.parse(jsonStatusOutput.stdout) as {
    unresolvedStateNote: string;
    review: {
      open: number;
      humanDecisionOpen: number;
      humanDecisionOpenByItemType: Array<{ itemType: string; count: number }>;
      browseOnlyOpen: number;
      deferred: number;
      browseCommand?: string;
    };
  };
  assertEquals(jsonStatus.review.open, 1);
  assertEquals(jsonStatus.review.humanDecisionOpen, 0);
  assertEquals(jsonStatus.review.humanDecisionOpenByItemType, []);
  assertEquals(jsonStatus.review.browseOnlyOpen, 1);
  assertEquals(jsonStatus.review.deferred, 1);
  assertEquals(
    jsonStatus.review.browseCommand,
    `deno task dc -- review list --status all --db ${dbPath}`,
  );
  assertStringIncludes(jsonStatus.unresolvedStateNote, "Workbench state:");
  assertStringIncludes(jsonStatus.unresolvedStateNote, "open decisions=0");
  assertStringIncludes(jsonStatus.unresolvedStateNote, "browse rows=1");
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

  const statusOutputOne = await runDcCli(["status", "--db", dbPath, "--json"]);
  assertEquals(statusOutputOne.code, 0);
  const statusOne = JSON.parse(statusOutputOne.stdout) as {
    nextCommand: string;
  };
  assertEquals(
    statusOne.nextCommand,
    `deno task dc -- review --db ${dbPath}`,
  );

  const acceptExplicitEntitiesOutput = await runDcCli([
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
  ]);
  assertEquals(acceptExplicitEntitiesOutput.code, 0);

  const statusOutputTwo = await runDcCli(["status", "--db", dbPath, "--json"]);
  assertEquals(statusOutputTwo.code, 0);
  const statusTwo = JSON.parse(statusOutputTwo.stdout) as {
    nextCommand: string;
    review: {
      humanDecisionOpenByItemType: Array<{ itemType: string; count: number }>;
    };
  };
  assertEquals(
    statusTwo.nextCommand,
    `deno task dc -- review --db ${dbPath}`,
  );
  assertEquals(statusTwo.review.humanDecisionOpenByItemType, [
    { itemType: "legal_ref", count: 1 },
    { itemType: "relationship_candidate", count: 1 },
  ]);
  const statusTextOutput = await runDcCli(["status", "--db", dbPath]);
  assertEquals(statusTextOutput.code, 0);
  assertStringIncludes(statusTextOutput.stdout, "Decisions: 2 open, 0 deferred");
  assertStringIncludes(
    statusTextOutput.stdout,
    "Decision types: legal_ref=1, relationship_candidate=1",
  );

  const deferRelationshipsOutput = await runDcCli([
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
  ]);
  assertEquals(deferRelationshipsOutput.code, 0);

  const statusOutputThree = await runDcCli(["status", "--db", dbPath, "--json"]);
  assertEquals(statusOutputThree.code, 0);
  const statusThree = JSON.parse(statusOutputThree.stdout) as {
    nextCommand: string;
  };
  assertEquals(
    statusThree.nextCommand,
    `deno task dc -- review --db ${dbPath}`,
  );

  const deferLegalOutput = await runDcCli([
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
  ]);
  assertEquals(deferLegalOutput.code, 0);

  const statusOutputFour = await runDcCli(["status", "--db", dbPath, "--json"]);
  assertEquals(statusOutputFour.code, 0);
  const statusFour = JSON.parse(statusOutputFour.stdout) as {
    nextCommand: string;
    review: {
      open: number;
      humanDecisionOpen: number;
      humanDecisionOpenByItemType: Array<{ itemType: string; count: number }>;
      browseOnlyOpen: number;
      deferred: number;
    };
  };
  assertEquals(statusFour.review.open, 1);
  assertEquals(statusFour.review.humanDecisionOpen, 0);
  assertEquals(statusFour.review.humanDecisionOpenByItemType, []);
  assertEquals(statusFour.review.browseOnlyOpen, 1);
  assertEquals(statusFour.review.deferred, 2);
  assertEquals(
    statusFour.nextCommand,
    `deno task dc -- source list --db ${dbPath}`,
  );
});

Deno.test("status surfaces public-body governance suffix leads before they are review-ready", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "council.committees",
      candidateId: "candidate.council.committees.mwaa",
      sourceItemKey: "mwaa-council",
      proposedEntityId: "dc.metropolitan_washington_airports_authority",
      name: "Metropolitan Washington Airports Authority",
      kind: "public_body",
      observedName: "Metropolitan Washington Airports Authority",
    }),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticCustomEntitySourceResult({
      sourceId: "dcgis.boards_commissions_councils",
      candidateId: "candidate.dcgis.boards_commissions_councils.mwaa_board",
      sourceItemKey: "mwaa-board-dcgis",
      proposedEntityId: "dc.metropolitan_washington_airports_authority_board_of_directors",
      name: "Metropolitan Washington Airports Authority Board of Directors (MWAA)",
      kind: "board",
      observedName: "Metropolitan Washington Airports Authority Board of Directors (MWAA)",
    }),
    dataDir,
  );

  const status = buildWorkbenchStatus(workbench);
  workbench.close();

  assertEquals(status.publicBodies.governanceSuffixLeads, 1);
  assertEquals(
    status.publicBodies.firstGovernanceSuffixLead?.variantName,
    "Metropolitan Washington Airports Authority",
  );
  assertEquals(
    status.publicBodies.inspectCommand,
    "deno task dc -- source compare public-bodies",
  );
  assertEquals(status.review.humanDecisionOpen, 1);
  const statusText = renderWorkbenchStatus(status);
  assertStringIncludes(statusText, "Public-body linkage leads: 1 governance-suffix lead");
  assertStringIncludes(statusText, "Inspect leads: deno task dc -- source compare public-bodies");

  const cliStatusOutput = await runDcCli(["status", "--db", dbPath]);
  assertEquals(cliStatusOutput.code, 0);
  assertStringIncludes(
    cliStatusOutput.stdout,
    `Inspect leads: deno task dc -- source compare public-bodies --db ${dbPath}`,
  );

  const cliStatusJsonOutput = await runDcCli(["status", "--db", dbPath, "--json"]);
  assertEquals(cliStatusJsonOutput.code, 0);
  const cliStatus = JSON.parse(cliStatusJsonOutput.stdout) as {
    publicBodies: { inspectCommand?: string };
  };
  assertEquals(
    cliStatus.publicBodies.inspectCommand,
    `deno task dc -- source compare public-bodies --db ${dbPath}`,
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

  const statusOutput = await runDcCli(["status", "--db", dbPath, "--json"]);
  assertEquals(statusOutput.code, 0);
  const status = JSON.parse(statusOutput.stdout) as {
    nextCommand: string;
  };
  assertEquals(status.nextCommand, `deno task dc -- review --db ${dbPath}`);
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

  const auditOutput = await runDcCli(["audit", "--db", dbPath]);
  assertEquals(auditOutput.code, 0);
  const auditText = auditOutput.stdout;
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
    `Inspect source: deno task dc -- source inspect council.committees --db ${dbPath}`,
  );

  const auditJsonOutput = await runDcCli(["audit", "--db", dbPath, "--json"]);
  assertEquals(auditJsonOutput.code, 0);
  const auditJson = JSON.parse(auditJsonOutput.stdout) as {
    reconciliation: {
      blocked: number;
      firstBlocked?: {
        sourceId: string;
        rawValue?: string | null;
        inspectCommand: string;
      };
    };
    nextCommand: string;
  };
  assertEquals(auditJson.reconciliation.blocked, 1);
  assertEquals(auditJson.reconciliation.firstBlocked?.sourceId, "council.committees");
  assertEquals(
    auditJson.reconciliation.firstBlocked?.inspectCommand,
    `deno task dc -- source inspect council.committees --db ${dbPath}`,
  );
  assertEquals(
    auditJson.reconciliation.firstBlocked?.rawValue,
    "All of the advisory committees and professional boards serving the Department of Health or Department of Behavioral Health",
  );
  assertStringIncludes(auditJson.nextCommand, ` --db ${dbPath}`);

  const doctorOutput = await runDcCli(["doctor", "--db", dbPath]);
  assertEquals(doctorOutput.code, 2);
  assertStringIncludes(
    doctorOutput.stderr,
    "Unknown command: doctor",
  );

  const auditDoctorOutput = await runDcCli(["audit", "doctor", "--db", dbPath]);
  assertEquals(auditDoctorOutput.code, 2);
  assertStringIncludes(
    auditDoctorOutput.stderr,
    "Unknown command: audit doctor",
  );
});

async function runDcCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
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
      ...args,
    ],
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}
