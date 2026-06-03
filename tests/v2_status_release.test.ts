import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { buildV2Release } from "../src/v2/release.ts";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildReviewItemId } from "../src/v2/domain.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
} from "./helpers/v2_fixtures.ts";
import {
  syntheticCustomEntitySourceResult,
  syntheticCustomRelationshipSourceResult,
  syntheticEntitySourceResult,
  syntheticLegalRefSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

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
      byType: Array<{ itemType: string; openCount: number; deferredCount: number }>;
      bySource: Array<{ sourceId: string; openCount: number; deferredCount: number }>;
    };
  };
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
  assertStringIncludes(jsonStatus.unresolvedStateNote, "deferred review=1");
});

Deno.test("status recommends the next scoped batch command as review debt narrows", async () => {
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
    "deno task dc -- review batch defer-default --mode relationships --subject-prefix relationship.dcgis.agencies --relationship-type part_of",
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
    "deno task dc -- review batch defer-default --mode legal --subject-prefix legal.dcgis.agencies --ref-type unknown",
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
    "deno task dc -- review batch accept-safe --mode entities --subject-prefix candidate.test.high_confidence.entities",
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

Deno.test("release summary surfaces unresolved review debt and placeholder risk neutrally", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values('dc.council_of_the_district_of_columbia', 'Council of the District of Columbia', 'council', 'accepted', '[]', 0, null, datetime('now'), datetime('now'))",
  ).run();
  workbench.db.prepare(
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values('dc.placeholder_example', 'Placeholder Example', 'placeholder', 'placeholder', '[]', 1, 'fixture placeholder', datetime('now'), datetime('now'))",
  ).run();

  const fetcher = async (url: string) => ({
    status: 200,
    text: async () => {
      switch (url) {
        case "https://dccouncil.gov/committees/":
          return councilCommitteesFixture;
        case "https://dccouncil.gov/committees/committee-of-the-whole/":
          return councilCommitteeWholeDetailFixture;
        case "https://dccouncil.gov/committees/committee-on-health/":
          return councilCommitteeHealthDetailFixture;
        default:
          throw new Error(`Unexpected url ${url}`);
      }
    },
    json: async <T>() => {
      throw new Error(`No json fixture for ${url}`) as T;
    },
  });
  await workbench.importConnectorResult(
    await getConnector("council.committees").run(createConnectorContext({ fetcher })),
    dataDir,
  );

  const outDir = join(dir, "release");
  await buildV2Release(workbench, outDir);
  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    release_summary: {
      open_review_item_count: number;
      deferred_review_item_count: number;
      blocked_reconciliation_count: number;
      placeholder_entity_count: number;
      blocked_reconciliation_by_source: Array<{ source_id: string; count: number }>;
      review_status_note: string;
    };
  };
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  workbench.close();

  assert(manifest.release_summary.blocked_reconciliation_count > 0);
  assertEquals(manifest.release_summary.placeholder_entity_count, 1);
  assert(
    manifest.release_summary.blocked_reconciliation_by_source.some((row) =>
      row.source_id === "council.committees" && row.count > 0
    ),
  );
  assertStringIncludes(
    manifest.release_summary.review_status_note,
    "Unresolved workbench state:",
  );
  assertStringIncludes(
    manifest.release_summary.review_status_note,
    "Release rows keep review_status visible; unresolved rows are not silently treated as complete.",
  );
  assertStringIncludes(readme, "review status note:");
  assertStringIncludes(readme, "blocked by source: council.committees=");

  const inspectOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
    ],
  }).output();
  const inspectText = new TextDecoder().decode(inspectOutput.stdout);
  assertEquals(inspectOutput.code, 0);
  assertStringIncludes(inspectText, "Release readiness: not-ready");
  assertStringIncludes(inspectText, "Review status: open=");
  assertStringIncludes(inspectText, "Blocked by source: council.committees=");

  const inspectJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
      "--json",
    ],
  }).output();
  const inspectJson = JSON.parse(new TextDecoder().decode(inspectJsonOutput.stdout)) as {
    readiness: string;
    releaseSummary: {
      blocked_reconciliation_count: number;
      placeholder_entity_count: number;
      blocked_reconciliation_by_source: Array<{ source_id: string; count: number }>;
    };
  };
  assertEquals(inspectJsonOutput.code, 0);
  assertEquals(inspectJson.readiness, "not-ready");
  assert(inspectJson.releaseSummary.blocked_reconciliation_count > 0);
  assertEquals(inspectJson.releaseSummary.placeholder_entity_count, 1);
  assert(
    inspectJson.releaseSummary.blocked_reconciliation_by_source.some((row) =>
      row.source_id === "council.committees" && row.count > 0
    ),
  );
});

Deno.test("release summary surfaces stale review debt neutrally", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const outDir = join(dir, "release");
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

  await buildV2Release(workbench, outDir);
  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    release_summary: {
      stale_review_item_count: number;
      stale_review_by_prior_decision_state: Array<{ prior_decision_state: string; count: number }>;
      review_status_note: string;
    };
  };
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  workbench.close();

  assertEquals(manifest.release_summary.stale_review_item_count, 1);
  assert(
    manifest.release_summary.stale_review_by_prior_decision_state.some((row) =>
      row.prior_decision_state === "accepted" && row.count === 1
    ),
  );
  assertStringIncludes(manifest.release_summary.review_status_note, "stale review=1");
  assertStringIncludes(readme, "stale review: 1");

  const inspectOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
    ],
  }).output();
  const inspectText = new TextDecoder().decode(inspectOutput.stdout);
  assertEquals(inspectOutput.code, 0);
  assertStringIncludes(inspectText, "stale=1");

  const inspectJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
      "--json",
    ],
  }).output();
  const inspectJson = JSON.parse(new TextDecoder().decode(inspectJsonOutput.stdout)) as {
    releaseSummary: {
      stale_review_item_count: number;
      stale_review_by_prior_decision_state: Array<{ prior_decision_state: string; count: number }>;
    };
  };
  assertEquals(inspectJsonOutput.code, 0);
  assertEquals(inspectJson.releaseSummary.stale_review_item_count, 1);
  assert(
    inspectJson.releaseSummary.stale_review_by_prior_decision_state.some((row) =>
      row.prior_decision_state === "accepted" && row.count === 1
    ),
  );
});

Deno.test("release summary surfaces unresolved review debt by source and type", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const resolutionsDir = join(dir, "resolutions");
  const outDir = join(dir, "release");
  const workbench = new Workbench(dbPath);
  workbench.init();

  await workbench.importConnectorResult(
    syntheticEntitySourceResult(
      "candidate.test.signature.entities.release_review_debt_v1",
      "Example Body",
    ),
    dataDir,
  );
  await workbench.importConnectorResult(
    syntheticLegalRefSourceResult(
      "legal.test.signature.legal_refs.release_review_debt_v1",
      "D.C. Official Code § 1-204.22",
      "https://code.dccouncil.us/us/dc/council/code/sections/1-204.22",
    ),
    dataDir,
  );
  await workbench.appendResolutionEvent(
    {
      eventType: "defer_review_item",
      subjectId: buildReviewItemId(
        "legal.test.signature.legal_refs.release_review_debt_v1",
        "legal-ref",
      ),
      payload: {},
    },
    resolutionsDir,
  );

  await buildV2Release(workbench, outDir);
  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    release_summary: {
      review_debt_by_type: Array<{
        item_type: string;
        open_count: number;
        deferred_count: number;
      }>;
      review_debt_by_source: Array<{
        source_id: string;
        open_count: number;
        deferred_count: number;
      }>;
    };
  };
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  workbench.close();

  assert(
    manifest.release_summary.review_debt_by_type.some((row) =>
      row.item_type === "entity_candidate" && row.open_count === 1 && row.deferred_count === 0
    ),
  );
  assert(
    manifest.release_summary.review_debt_by_type.some((row) =>
      row.item_type === "legal_ref" && row.open_count === 0 && row.deferred_count === 1
    ),
  );
  assert(
    manifest.release_summary.review_debt_by_source.some((row) =>
      row.source_id === "test.signature.entities" && row.open_count === 1 &&
      row.deferred_count === 0
    ),
  );
  assert(
    manifest.release_summary.review_debt_by_source.some((row) =>
      row.source_id === "test.signature.legal_refs" && row.open_count === 0 &&
      row.deferred_count === 1
    ),
  );
  assertStringIncludes(readme, "review debt by type:");
  assertStringIncludes(readme, "entity_candidate(open=1,deferred=0)");
  assertStringIncludes(readme, "legal_ref(open=0,deferred=1)");
  assertStringIncludes(readme, "review debt by source:");
  assertStringIncludes(readme, "test.signature.entities(open=1,deferred=0)");
  assertStringIncludes(readme, "test.signature.legal_refs(open=0,deferred=1)");

  const inspectOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
    ],
  }).output();
  const inspectText = new TextDecoder().decode(inspectOutput.stdout);
  assertEquals(inspectOutput.code, 0);
  assertStringIncludes(inspectText, "Review debt by type:");
  assertStringIncludes(inspectText, "entity_candidate(open=1,deferred=0)");
  assertStringIncludes(inspectText, "legal_ref(open=0,deferred=1)");
  assertStringIncludes(inspectText, "Review debt by source:");
  assertStringIncludes(inspectText, "test.signature.entities(open=1,deferred=0)");
  assertStringIncludes(inspectText, "test.signature.legal_refs(open=0,deferred=1)");

  const inspectJsonOutput = await new Deno.Command(Deno.execPath(), {
    cwd: Deno.cwd(),
    args: [
      "run",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      "scripts/dc.ts",
      "release",
      "inspect",
      "--out",
      outDir,
      "--json",
    ],
  }).output();
  const inspectJson = JSON.parse(new TextDecoder().decode(inspectJsonOutput.stdout)) as {
    releaseSummary: {
      review_debt_by_type: Array<{
        item_type: string;
        open_count: number;
        deferred_count: number;
      }>;
      review_debt_by_source: Array<{
        source_id: string;
        open_count: number;
        deferred_count: number;
      }>;
    };
  };
  assertEquals(inspectJsonOutput.code, 0);
  assert(
    inspectJson.releaseSummary.review_debt_by_type.some((row) =>
      row.item_type === "entity_candidate" && row.open_count === 1 && row.deferred_count === 0
    ),
  );
  assert(
    inspectJson.releaseSummary.review_debt_by_type.some((row) =>
      row.item_type === "legal_ref" && row.open_count === 0 && row.deferred_count === 1
    ),
  );
  assert(
    inspectJson.releaseSummary.review_debt_by_source.some((row) =>
      row.source_id === "test.signature.entities" && row.open_count === 1 &&
      row.deferred_count === 0
    ),
  );
  assert(
    inspectJson.releaseSummary.review_debt_by_source.some((row) =>
      row.source_id === "test.signature.legal_refs" && row.open_count === 0 &&
      row.deferred_count === 1
    ),
  );
});
