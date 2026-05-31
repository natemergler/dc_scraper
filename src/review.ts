import { generateChecks } from "./checks.ts";
import { listCandidates } from "./candidates.ts";
import { loadRecords } from "./io.ts";

export interface ReviewItem {
  kind: string;
  severity: "error" | "warning" | "info";
  title: string;
  detail: string;
  reason?: string;
  suggested_command?: string;
}

export async function nextReviewItem(repoPath: string): Promise<ReviewItem | null> {
  const checks = await generateChecks(repoPath);
  const blocking = checks.find((check) => check.severity === "error" && !check.suppressed);
  if (blocking) {
    return {
      kind: "unsuppressed_error_check",
      severity: "error",
      title: blocking.id,
      detail: blocking.message,
      reason: "An unsuppressed error still blocks the release or workbench flow.",
      suggested_command: "deno task dc -- checks generate",
    };
  }

  const patchConflict = checks.find((check) =>
    check.kind === "patch_expected_before_failed" && !check.suppressed
  );
  if (patchConflict) {
    return {
      kind: "patch_conflict",
      severity: "warning",
      title: patchConflict.id,
      detail: patchConflict.message,
      reason: "An active patch conflict should be resolved before trusting later records.",
      suggested_command: "deno task dc -- patch apply",
    };
  }

  const sourceHealth = checks.find((check) =>
    [
      "arcgis_schema_changed",
      "publication_manifest_changed",
      "source_endpoint_manifest_changed",
      "source_snapshot_missing",
      "stale_source_snapshot",
      "fetch_failed",
    ].includes(check.kind) && !check.suppressed
  );
  if (sourceHealth) {
    return {
      kind: "source_health",
      severity: "warning",
      title: sourceHealth.id,
      detail: sourceHealth.message,
      reason: "Source drift or a stale fetch is more urgent than new curation work.",
      suggested_command: sourceHealth.kind === "stale_source_snapshot" && sourceHealth.record_id
        ? `deno task dc -- fetch source ${sourceHealth.record_id}`
        : "deno task dc -- sources health",
    };
  }

  const records = await loadRecords(repoPath);
  const recordIds = new Set(records.map((entry) => entry.record.id));
  const candidate = (await listCandidates(repoPath)).find((item) =>
    !recordIds.has(item.proposed_record_id)
  );
  if (candidate) {
    return {
      kind: "new_candidate_without_record",
      severity: "warning",
      title: candidate.id,
      detail:
        `Candidate proposes new ${candidate.proposed_record_type} record ${candidate.proposed_record_id}.`,
      reason:
        "The repo has generated a new candidate that has not yet been promoted into curated truth.",
      suggested_command: `deno task dc -- promote ${candidate.id} --dry-run`,
    };
  }

  const highPriorityGap = records.find((entry) =>
    entry.record.record_type === "gap" && entry.record.status !== "closed"
  );
  if (highPriorityGap) {
    return {
      kind: "high_priority_gap",
      severity: "info",
      title: highPriorityGap.record.id,
      detail: String(
        highPriorityGap.record.description ?? highPriorityGap.record.name ?? "Open gap.",
      ),
      reason: "No blocking error or patch work is left, so the highest-priority open gap is next.",
      suggested_command: `deno task dc -- gaps show ${highPriorityGap.record.id}`,
    };
  }

  const warning = checks.find((check) => check.severity === "warning" && !check.suppressed);
  if (warning) {
    return {
      kind: "warning_check",
      severity: "warning",
      title: warning.id,
      detail: warning.message,
      reason:
        "A remaining warning is the next useful thing to inspect after higher-priority items.",
      suggested_command: "deno task dc -- checks generate",
    };
  }

  return null;
}

export function renderReviewItem(item: ReviewItem | null): string {
  if (!item) return "No review items found.\n";
  return [
    `Review item: ${item.kind}`,
    `Severity: ${item.severity}`,
    `Title: ${item.title}`,
    "",
    item.reason ? `Why this is next: ${item.reason}` : "",
    item.detail,
    item.suggested_command ? `\nSuggested command: ${item.suggested_command}` : "",
    "",
  ].join("\n");
}
