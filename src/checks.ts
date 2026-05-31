import { walk } from "@std/fs";
import { join } from "@std/path";
import { parse } from "@std/yaml";
import { listCandidates } from "./candidates.ts";
import { loadRecords } from "./io.ts";
import { writeJsonFile, writeTextFile } from "./io.ts";
import { applyPatch, listPatches } from "./patches.ts";
import { tier1SourceIds } from "./source_definitions.ts";
import { compareAllSourcesToBaselines } from "./source_health.ts";
import { Check, ChecksSummary } from "./types.ts";
import { validateRepo } from "./validation.ts";

export async function generateChecks(repoPath: string): Promise<Check[]> {
  const checks = [
    ...(await validateRepo(repoPath)),
    ...(await generateArtifactChecks(repoPath)),
  ];
  return applySuppressions(checks, await loadSuppressions(repoPath));
}

export async function writeChecks(repoPath: string, checks?: Check[]): Promise<void> {
  checks ??= await generateChecks(repoPath);
  await writeJsonFile(join(repoPath, "checks/latest.json"), {
    generated_at: new Date().toISOString(),
    summary: summarizeChecks(checks),
    checks,
  });
  await writeTextFile(join(repoPath, "checks/latest.md"), renderChecksMarkdown(checks));
}

export function summarizeChecks(checks: Check[]): ChecksSummary {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  let suppressed = 0;
  let unsuppressed_errors = 0;

  for (const check of checks) {
    if (check.severity === "error") errors++;
    if (check.severity === "warning") warnings++;
    if (check.severity === "info") info++;
    if (check.suppressed) suppressed++;
    if (check.severity === "error" && !check.suppressed) unsuppressed_errors++;
  }

  return { errors, warnings, info, suppressed, unsuppressed_errors };
}

export function renderChecksMarkdown(checks: Check[]): string {
  const summary = summarizeChecks(checks);
  const lines = [
    "# Checks",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    `- Errors: ${summary.errors}`,
    `- Warnings: ${summary.warnings}`,
    `- Info: ${summary.info}`,
    `- Suppressed: ${summary.suppressed}`,
    "",
  ];

  if (checks.length === 0) {
    lines.push("No checks.");
    lines.push("");
    lines.push(
      "Generated checks report source drift and validation issues. Curated release caveats live in gap",
    );
    lines.push(
      "records and release caveats.",
    );
  } else {
    for (const check of checks) {
      const marker = check.suppressed ? "suppressed" : "open";
      lines.push(`- ${check.severity.toUpperCase()} ${check.id} (${marker})`);
      lines.push(`  ${check.message}`);
      if (check.path) lines.push(`  Path: ${check.path}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function loadSuppressions(
  repoPath: string,
): Promise<Record<string, Record<string, unknown>>> {
  try {
    const value = parse(await Deno.readTextFile(join(repoPath, "checks/suppressions.yml")));
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const root = value as Record<string, unknown>;
      const suppressions = root.suppressions ?? root;
      if (
        typeof suppressions === "object" && suppressions !== null && !Array.isArray(suppressions)
      ) {
        return suppressions as Record<string, Record<string, unknown>>;
      }
    }
  } catch {
    // No suppressions file yet is a normal v0 state.
  }
  return {};
}

function applySuppressions(
  checks: Check[],
  suppressions: Record<string, Record<string, unknown>>,
): Check[] {
  return checks.map((check) => {
    const suppression = suppressions[check.id];
    if (!suppression) return check;
    return {
      ...check,
      suppressed: true,
      suppression_reason: typeof suppression.reason === "string" ? suppression.reason : undefined,
      release_relevant: Boolean(suppression.release_relevant ?? check.release_relevant),
    };
  });
}

async function generateArtifactChecks(repoPath: string): Promise<Check[]> {
  const checks: Check[] = [];
  const records = await loadRecords(repoPath);
  const recordIds = new Set(records.map((entry) => entry.record.id));
  const sourceIds = new Set(
    records.filter((entry) => entry.record.record_type === "source").map((entry) =>
      entry.record.id
    ),
  );

  for (const sourceId of requiredSourceIds) {
    if (!sourceIds.has(sourceId)) {
      checks.push({
        id: `check.missing_required_source_family.${sourceId}`,
        kind: "missing_required_source_family",
        severity: "warning",
        message: `Required source family ${sourceId} is not represented by a source record.`,
        record_id: sourceId,
        release_relevant: true,
      });
    }
  }

  for (const sourceId of requiredSnapshotSourceIds) {
    if (!(await hasSnapshotOrFailure(repoPath, sourceId))) {
      checks.push({
        id: `check.missing_source_snapshot.${sourceId}`,
        kind: "missing_source_snapshot",
        severity: "warning",
        message: `Required source ${sourceId} has no latest snapshot or failure manifest.`,
        record_id: sourceId,
        release_relevant: true,
      });
    }
  }

  const candidates = await listCandidates(repoPath);
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const byProposedId = new Map<string, string[]>();
  for (const candidate of candidates) {
    byProposedId.set(candidate.proposed_record_id, [
      ...(byProposedId.get(candidate.proposed_record_id) ?? []),
      candidate.id,
    ]);
    if (!recordIds.has(candidate.proposed_record_id)) {
      checks.push({
        id: `check.new_candidate_without_record.${candidate.id}`,
        kind: "new_candidate_without_record",
        severity: "warning",
        message:
          `Candidate ${candidate.id} proposes missing record ${candidate.proposed_record_id}.`,
        record_id: candidate.proposed_record_id,
        release_relevant: false,
      });
    }
  }

  for (const patch of (await listPatches(repoPath)).filter((patch) => patch.status === "active")) {
    const candidate = candidatesById.get(patch.candidate_id);
    if (!candidate) {
      checks.push({
        id: `check.patch_target_missing.${patch.id}`,
        kind: "patch_target_missing",
        severity: "warning",
        message: `Active patch ${patch.id} targets missing candidate ${patch.candidate_id}.`,
        record_id: patch.candidate_id,
        release_relevant: true,
      });
      continue;
    }
    const result = applyPatch(candidate.record, patch);
    if (result.status === "conflict") {
      checks.push({
        id: `check.patch_expected_before_failed.${patch.id}`,
        kind: "patch_expected_before_failed",
        severity: "warning",
        message: `Active patch ${patch.id} has conflict(s): ${result.conflicts.join("; ")}.`,
        record_id: patch.candidate_id,
        release_relevant: true,
      });
    }
  }

  for (const [proposedId, candidateIds] of byProposedId) {
    if (
      candidateIds.length > 1 && !isResolvedCandidateCollision(records, proposedId, candidateIds)
    ) {
      checks.push({
        id: `check.candidate_proposed_record_collision.${proposedId}`,
        kind: "candidate_proposed_record_collision",
        severity: "warning",
        message: `Multiple candidates propose ${proposedId}: ${candidateIds.join(", ")}.`,
        record_id: proposedId,
        release_relevant: true,
      });
    }
  }

  try {
    for await (
      const entry of walk(join(repoPath, "snapshots"), {
        match: [/failure\.latest\.json$/],
        includeDirs: false,
      })
    ) {
      const failure = JSON.parse(await Deno.readTextFile(entry.path)) as Record<string, unknown>;
      const sourceId = typeof failure.source_id === "string" ? failure.source_id : entry.path;
      checks.push({
        id: `check.fetch_failed.${sourceId}`,
        kind: "fetch_failed",
        severity: "warning",
        message: `Latest fetch failed for ${sourceId}: ${
          failure.error_summary ?? "unknown error"
        }.`,
        record_id: sourceId,
        path: entry.path,
        release_relevant: true,
      });
    }
  } catch {
    // No snapshots yet.
  }

  for (const check of await generateSnapshotPolicyChecks(repoPath)) {
    checks.push(check);
  }

  for (const diff of await compareAllSourcesToBaselines(repoPath, requiredSnapshotSourceIds)) {
    if (diff.status === "missing_baseline") continue;
    if (diff.status === "missing_snapshot") {
      checks.push({
        id: `check.source_snapshot_missing.${diff.sourceId}`,
        kind: "source_snapshot_missing",
        severity: "warning",
        message: `Source ${diff.sourceId} has a baseline but no latest snapshot.`,
        record_id: diff.sourceId,
        release_relevant: true,
      });
    }
    if (diff.addedFields.length || diff.removedFields.length) {
      checks.push({
        id: `check.arcgis_schema_changed.${diff.sourceId}`,
        kind: "arcgis_schema_changed",
        severity: "warning",
        message: `Source ${diff.sourceId} schema changed. Added fields: ${
          diff.addedFields.join(", ") || "none"
        }. Removed fields: ${diff.removedFields.join(", ") || "none"}.`,
        record_id: diff.sourceId,
        release_relevant: true,
      });
    }
    if (
      diff.addedLinks.length || diff.removedLinks.length ||
      diff.addedAssets.length || diff.removedAssets.length
    ) {
      checks.push({
        id: `check.publication_manifest_changed.${diff.sourceId}`,
        kind: "publication_manifest_changed",
        severity: "warning",
        message:
          `Source ${diff.sourceId} publication manifest changed. Added links: ${diff.addedLinks.length}. Removed links: ${diff.removedLinks.length}. Added assets: ${diff.addedAssets.length}. Removed assets: ${diff.removedAssets.length}.`,
        record_id: diff.sourceId,
        release_relevant: true,
      });
    }
    if (
      diff.addedEndpoints.length || diff.removedEndpoints.length ||
      diff.baselineKind !== diff.currentKind
    ) {
      const kindChange =
        diff.baselineKind && diff.currentKind && diff.baselineKind !== diff.currentKind
          ? ` Kind changed: ${diff.baselineKind} -> ${diff.currentKind}.`
          : "";
      checks.push({
        id: `check.source_endpoint_manifest_changed.${diff.sourceId}`,
        kind: "source_endpoint_manifest_changed",
        severity: "warning",
        message:
          `Source ${diff.sourceId} endpoint manifest changed.${kindChange} Added endpoints: ${
            diff.addedEndpoints.join(", ") || "none"
          }. Removed endpoints: ${diff.removedEndpoints.join(", ") || "none"}.`,
        record_id: diff.sourceId,
        release_relevant: true,
      });
    }
  }

  return checks;
}

async function generateSnapshotPolicyChecks(repoPath: string): Promise<Check[]> {
  const checks: Check[] = [];
  try {
    for await (
      const entry of walk(join(repoPath, "snapshots"), {
        match: [/latest\.json$/],
        skip: [/failure\.latest\.json$/, /baseline\.json$/],
        includeDirs: false,
      })
    ) {
      const sizeLimit = snapshotSizeLimitBytes();
      const size = (await Deno.stat(entry.path)).size;
      const snapshot = await readSnapshotSummary(entry.path);
      const sourceId = snapshot.sourceId ??
        entry.path
          .replace(`${join(repoPath, "snapshots")}/`, "")
          .replace(/\/latest\.json$/, "")
          .split("/")
          .join(".");

      if (snapshot.fetchedAt) {
        const fetchedAt = Date.parse(snapshot.fetchedAt);
        const ageMs = Date.now() - fetchedAt;
        const staleAfterMs = sourceStaleAfterDays() * 24 * 60 * 60 * 1000;
        if (!Number.isFinite(fetchedAt) || ageMs > staleAfterMs) {
          checks.push({
            id: `check.stale_source_snapshot.${sourceId}`,
            kind: "stale_source_snapshot",
            severity: "warning",
            message:
              `Source ${sourceId} latest snapshot was fetched at ${snapshot.fetchedAt}, older than the ${sourceStaleAfterDays()} day source verification policy.`,
            record_id: sourceId,
            path: entry.path,
            release_relevant: true,
          });
        }
      }

      const limit = sizeLimit;
      if (size <= limit) continue;
      checks.push({
        id: `check.large_snapshot_file.${sourceId}`,
        kind: "large_snapshot_file",
        severity: "warning",
        message: `Snapshot ${sourceId} is ${
          formatBytes(size)
        }, above the local raw snapshot policy of ${
          formatBytes(limit)
        }. Keep bulky raw data out of git unless it is deliberately promoted as a fixture or release artifact.`,
        record_id: sourceId,
        path: entry.path,
        release_relevant: false,
      });
    }
  } catch {
    // No snapshot directory yet.
  }
  return checks;
}

async function readSnapshotSummary(path: string): Promise<{
  sourceId?: string;
  fetchedAt?: string;
}> {
  try {
    const snapshot = JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>;
    return {
      sourceId: typeof snapshot.source_id === "string" ? snapshot.source_id : undefined,
      fetchedAt: typeof snapshot.fetched_at === "string" ? snapshot.fetched_at : undefined,
    };
  } catch {
    return {};
  }
}

function snapshotSizeLimitBytes(): number {
  const configured = Number(readOptionalEnv("DC_SNAPSHOT_SIZE_LIMIT_BYTES"));
  return Number.isFinite(configured) && configured > 0 ? configured : 5 * 1024 * 1024;
}

function sourceStaleAfterDays(): number {
  const configured = Number(readOptionalEnv("DC_SOURCE_STALE_DAYS"));
  return Number.isFinite(configured) && configured > 0 ? configured : 30;
}

function readOptionalEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function hasSnapshotOrFailure(repoPath: string, sourceId: string): Promise<boolean> {
  const parts = sourceId.split(".");
  for (
    const path of [
      join(repoPath, "snapshots", ...parts, "latest.json"),
      join(repoPath, "snapshots", ...parts, "failure.latest.json"),
    ]
  ) {
    try {
      await Deno.stat(path);
      return true;
    } catch {
      // Try the next expected artifact path.
    }
  }
  return false;
}

function isResolvedCandidateCollision(
  records: Awaited<ReturnType<typeof loadRecords>>,
  proposedId: string,
  candidateIds: string[],
): boolean {
  const record = records.find((entry) => entry.record.id === proposedId)?.record;
  if (!record || !Array.isArray(record.candidate_collisions)) return false;
  const resolved = record.candidate_collisions.filter((item): item is string =>
    typeof item === "string"
  );
  return candidateIds.every((candidateId) => resolved.includes(candidateId));
}

const requiredSourceIds = ["open_data_dc", "pass", ...tier1SourceIds];
const requiredSnapshotSourceIds = tier1SourceIds;
