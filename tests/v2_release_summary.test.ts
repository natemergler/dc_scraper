import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { buildReviewItemId } from "../src/v2/domain.ts";
import { buildV2Release } from "../src/v2/release.ts";
import { buildWorkbenchStatus } from "../src/v2/status.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
} from "./helpers/v2_fixtures.ts";
import {
  syntheticEntitySourceResult,
  syntheticLegalRefSourceResult,
} from "./helpers/v2_reconciliation_helpers.ts";

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
  const status = buildWorkbenchStatus(workbench);
  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    release_summary: {
      open_review_item_count: number;
      deferred_review_item_count: number;
      blocked_reconciliation_count: number;
      placeholder_entity_count: number;
      blocked_reconciliation_by_source: Array<{ source_id: string; count: number }>;
      failed_source_count: number;
      review_status_note: string;
    };
  };
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  workbench.close();

  assertEquals(manifest.release_summary.open_review_item_count, status.review.open);
  assertEquals(manifest.release_summary.deferred_review_item_count, status.review.deferred);
  assertEquals(
    manifest.release_summary.blocked_reconciliation_count,
    status.reconciliation.blocked,
  );
  assertEquals(manifest.release_summary.placeholder_entity_count, status.placeholders.count);
  assertEquals(manifest.release_summary.failed_source_count, status.sources.failed);
  assertEquals(
    manifest.release_summary.blocked_reconciliation_by_source,
    status.reconciliation.blockedBySource.map((row) => ({
      source_id: row.sourceId,
      count: row.count,
    })),
  );
  assertEquals(manifest.release_summary.review_status_note, releaseStatusNote(status));
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
  const status = buildWorkbenchStatus(workbench);
  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    release_summary: {
      stale_review_item_count: number;
      stale_review_by_prior_decision_state: Array<{ prior_decision_state: string; count: number }>;
      failed_source_count: number;
      review_status_note: string;
    };
  };
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  workbench.close();

  assertEquals(manifest.release_summary.stale_review_item_count, status.staleReview.count);
  assertEquals(
    manifest.release_summary.stale_review_by_prior_decision_state,
    status.staleReview.byPriorDecisionState.map((row) => ({
      prior_decision_state: row.priorDecisionState,
      count: row.count,
    })),
  );
  assertEquals(manifest.release_summary.failed_source_count, status.sources.failed);
  assertEquals(manifest.release_summary.review_status_note, releaseStatusNote(status));
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
  const status = buildWorkbenchStatus(workbench);
  const manifest = JSON.parse(await Deno.readTextFile(join(outDir, "manifest.json"))) as {
    release_summary: {
      open_review_item_count: number;
      deferred_review_item_count: number;
      failed_source_count: number;
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
      top_unresolved_review_items: Array<{
        item_type: string;
        source_id?: string;
        label: string;
        reason: string;
        default_action: string;
        status: string;
      }>;
    };
  };
  const readme = await Deno.readTextFile(join(outDir, "README.md"));
  workbench.close();

  assertEquals(manifest.release_summary.open_review_item_count, status.review.open);
  assertEquals(manifest.release_summary.deferred_review_item_count, status.review.deferred);
  assertEquals(manifest.release_summary.failed_source_count, status.sources.failed);
  assertEquals(
    manifest.release_summary.review_debt_by_type,
    status.review.byType.map((row) => ({
      item_type: row.itemType,
      open_count: row.openCount,
      deferred_count: row.deferredCount,
    })),
  );
  assertEquals(
    manifest.release_summary.review_debt_by_source,
    status.review.bySource.map((row) => ({
      source_id: row.sourceId,
      open_count: row.openCount,
      deferred_count: row.deferredCount,
    })),
  );
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
  assert(
    manifest.release_summary.top_unresolved_review_items.some((row) =>
      row.label === "Example Body" &&
      row.item_type === "entity_candidate" &&
      row.source_id === "test.signature.entities" &&
      row.default_action === "accept" &&
      row.status === "open"
    ),
  );
  assert(
    manifest.release_summary.top_unresolved_review_items.some((row) =>
      row.label === "D.C. Official Code § 1-204.22" &&
      row.item_type === "legal_ref" &&
      row.source_id === "test.signature.legal_refs" &&
      row.default_action === "accept" &&
      row.status === "deferred"
    ),
  );
  assert(!readme.includes("## Top unresolved review items"));
  assert(!readme.includes("Review fixture entity candidate"));

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
      top_unresolved_review_items: Array<{ label: string; source_id?: string }>;
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
  assert(
    inspectJson.releaseSummary.top_unresolved_review_items.some((row) =>
      row.label === "Example Body" && row.source_id === "test.signature.entities"
    ),
  );
});

function releaseStatusNote(status: ReturnType<typeof buildWorkbenchStatus>): string {
  return `${status.unresolvedStateNote} Release rows keep review_status visible; unresolved rows are not silently treated as complete.`;
}
