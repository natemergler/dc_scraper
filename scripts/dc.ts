import {
  candidateDiff,
  findCandidate,
  generateCandidates,
  renderCandidate,
} from "../src/candidates.ts";
import { generateChecks, writeChecks } from "../src/checks.ts";
import { explainRecord } from "../src/explain.ts";
import { fetchSource } from "../src/fetchers.ts";
import { findGap, listGaps, renderGap, renderGapList } from "../src/gaps.ts";
import { draftPatchForRecord } from "../src/patch_drafting.ts";
import { activatePatch, applyActivePatches, writePatch } from "../src/patches.ts";
import { promoteAllNew, promoteCandidate } from "../src/promotion.ts";
import { buildRelease, inspectRelease } from "../src/releases.ts";
import { nextReviewItem, renderReviewItem } from "../src/review.ts";
import { seedBaselineRecords } from "../src/seed.ts";
import { renderSourceAudit, sourceAuditRows } from "../src/source_audit.ts";
import { tier1SourceIds } from "../src/source_definitions.ts";
import { renderSourceCoverage, sourceCoverageRows } from "../src/source_coverage.ts";
import {
  compareAllSourcesToBaselines,
  renderSourceHealth,
  writeSourceBaseline,
} from "../src/source_health.ts";
import { validateRepo } from "../src/validation.ts";

async function main(args: string[]): Promise<void> {
  if (args[0] === "--") args = args.slice(1);
  const repoPath = Deno.cwd();
  const [command, subcommand, value] = args;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "validate") {
    const checks = await validateRepo(repoPath);
    const errors = checks.filter((check) => check.severity === "error");
    for (const check of checks) {
      console.log(`${check.severity.toUpperCase()} ${check.id}: ${check.message}`);
    }
    if (errors.length > 0) Deno.exit(1);
    console.log("Validation passed.");
    return;
  }

  if (command === "checks" && (!subcommand || subcommand === "generate")) {
    const checks = await generateChecks(repoPath);
    await writeChecks(repoPath, checks);
    console.log(`Wrote checks/latest.json and checks/latest.md (${checks.length} checks).`);
    return;
  }

  if (command === "release" && (!subcommand || subcommand === "build")) {
    const releaseId = args.includes("--release-id")
      ? args[args.indexOf("--release-id") + 1]
      : undefined;
    const result = await buildRelease(repoPath, { releaseId });
    console.log(`Built release ${result.releaseId}`);
    console.log(result.releasePath);
    return;
  }

  if (command === "release" && subcommand === "inspect") {
    console.log(await inspectRelease(repoPath, value ?? "latest"));
    return;
  }

  if (command === "records" && subcommand === "explain" && value) {
    console.log(await explainRecord(repoPath, value));
    return;
  }

  if (command === "review" && subcommand === "next") {
    console.log(renderReviewItem(await nextReviewItem(repoPath)));
    return;
  }

  if (command === "gaps" && (!subcommand || subcommand === "list")) {
    console.log(renderGapList(await listGaps(repoPath)));
    return;
  }

  if (command === "gaps" && subcommand === "show" && value) {
    console.log(renderGap(await findGap(repoPath, value)));
    return;
  }

  if (command === "fetch" && subcommand === "source" && value) {
    const result = await fetchSource(repoPath, value);
    console.log(`${result.status.toUpperCase()} ${result.sourceId}`);
    console.log(result.path);
    if (result.rowCount !== undefined) console.log(`Rows: ${result.rowCount}`);
    if (result.itemCount !== undefined) console.log(`Items: ${result.itemCount}`);
    return;
  }

  if (command === "fetch" && subcommand === "tier1") {
    for (const sourceId of tier1SourceIds) {
      const result = await fetchSource(repoPath, sourceId);
      const count = result.rowCount ?? result.itemCount;
      console.log(
        `${result.status.toUpperCase()} ${sourceId}${count === undefined ? "" : ` (${count})`}`,
      );
      console.log(`  ${result.path}`);
    }
    return;
  }

  if (command === "sources" && subcommand === "coverage") {
    console.log(renderSourceCoverage(await sourceCoverageRows(repoPath)));
    return;
  }

  if (command === "sources" && subcommand === "audit") {
    console.log(renderSourceAudit(await sourceAuditRows(repoPath, tier1SourceIds)));
    return;
  }

  if (command === "sources" && subcommand === "health") {
    console.log(renderSourceHealth(await compareAllSourcesToBaselines(repoPath, tier1SourceIds)));
    return;
  }

  if (command === "sources" && subcommand === "baseline") {
    const sourceIds = value ? [value] : tier1SourceIds;
    for (const sourceId of sourceIds) {
      const baseline = await writeSourceBaseline(repoPath, sourceId);
      console.log(`Wrote baseline for ${sourceId} (${baseline.kind})`);
    }
    return;
  }

  if (command === "candidates" && (!subcommand || subcommand === "generate")) {
    const sourceId = args.includes("--source") ? args[args.indexOf("--source") + 1] : undefined;
    const candidates = await generateCandidates(repoPath, sourceId);
    console.log(`Generated ${candidates.length} candidate(s).`);
    return;
  }

  if (command === "candidates" && subcommand === "show" && value) {
    const candidate = await findCandidate(repoPath, value);
    if (!candidate) throw new Error(`Candidate not found: ${value}`);
    console.log(renderCandidate(candidate));
    return;
  }

  if (command === "candidates" && subcommand === "diff" && value) {
    const diff = await candidateDiff(repoPath, value);
    if (diff.length === 0) {
      console.log("No candidate/record differences found.");
      return;
    }
    for (const item of diff) {
      console.log(item.path);
      console.log(`  candidate: ${JSON.stringify(item.candidateValue)}`);
      console.log(`  record:    ${JSON.stringify(item.recordValue)}`);
    }
    return;
  }

  if (command === "promote" && subcommand) {
    if (subcommand === "--all-new") {
      const sourcePrefix = args.includes("--source")
        ? args[args.indexOf("--source") + 1]
        : undefined;
      const results = await promoteAllNew(repoPath, {
        sourcePrefix,
        dryRun: args.includes("--dry-run"),
      });
      const created = results.filter((result) => result.status === "created").length;
      const existing = results.filter((result) => result.status === "exists").length;
      const dryRun = results.filter((result) => result.status === "dry_run").length;
      console.log(
        `Promoted all new candidates: created=${created} existing=${existing} dry_run=${dryRun}`,
      );
      return;
    }
    const result = await promoteCandidate(repoPath, subcommand, {
      dryRun: args.includes("--dry-run"),
    });
    console.log(`${result.status.toUpperCase()} ${result.recordId}`);
    console.log(result.path);
    return;
  }

  if (command === "seed" && (!subcommand || subcommand === "baseline")) {
    const result = await seedBaselineRecords(repoPath);
    console.log(`Seed baseline records: created=${result.created} existing=${result.existing}`);
    return;
  }

  if (command === "patch" && subcommand === "draft" && value) {
    const patch = await draftPatchForRecord(repoPath, value);
    if (args.includes("--print")) {
      console.log(JSON.stringify(patch, null, 2));
      return;
    }
    const path = await writePatch(repoPath, patch);
    console.log(`Wrote draft patch ${patch.id}`);
    console.log(path);
    return;
  }

  if (command === "patch" && subcommand === "activate" && value) {
    const path = await activatePatch(repoPath, value);
    console.log(`Activated patch ${value}`);
    console.log(path);
    return;
  }

  if (command === "patch" && subcommand === "apply") {
    const result = await applyActivePatches(repoPath);
    console.log(`Applied patches for ${result.applied} candidate(s).`);
    for (const path of result.writtenPaths) console.log(path);
    if (result.conflicts.length > 0) {
      for (const conflict of result.conflicts) console.error(`CONFLICT ${conflict}`);
      Deno.exit(1);
    }
    return;
  }

  console.error(`Unknown command: ${args.join(" ")}`);
  printHelp();
  Deno.exit(2);
}

function printHelp(): void {
  console.log(`dc civic content workbench

Usage:
  dc validate
  dc checks generate
  dc release build [--release-id <id>]
  dc release inspect [release-id]
  dc records explain <record-id>
  dc review next
  dc gaps list
  dc gaps show <gap-id>
  dc fetch source <source-id>
  dc fetch tier1
  dc sources coverage
  dc sources audit
  dc sources health
  dc sources baseline [source-id]
  dc candidates generate [--source <source-id>]
  dc candidates show <candidate-id>
  dc candidates diff <candidate-id>
  dc promote <candidate-id> [--dry-run]
  dc promote --all-new [--source <prefix>] [--dry-run]
  dc patch draft <record-id> [--print]
  dc patch activate <patch-id>
  dc patch apply
  dc seed baseline
`);
}

if (import.meta.main) {
  await main(Deno.args);
}
