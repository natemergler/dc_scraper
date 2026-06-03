import { buildWorkbenchStatus } from "./status.ts";
import type { Workbench } from "./workbench.ts";

export interface ReleaseArtifactProblem {
  sourceId: string;
  endpointId: string;
  artifactKind: string;
  message: string;
}

export interface ReleaseVerificationResult {
  ready: boolean;
  readiness: "usable" | "usable-with-warnings" | "not-ready";
  reasons: string[];
  sourceArtifactProblems: ReleaseArtifactProblem[];
  nextCommand: string;
  unresolvedStateNote: string;
}

export function verifyWorkbenchRelease(workbench: Workbench): ReleaseVerificationResult {
  const status = buildWorkbenchStatus(workbench);
  const sourceArtifactProblems = validateSourceArtifacts(workbench.sourceArtifacts());
  const reasons: string[] = [];
  if (status.sources.failed > 0) reasons.push(`failed sources: ${status.sources.failed}`);
  if (status.review.open > 0) reasons.push(`open review items: ${status.review.open}`);
  if (status.review.deferred > 0) reasons.push(`deferred review items: ${status.review.deferred}`);
  if (status.staleReview.count > 0) reasons.push(`stale review items: ${status.staleReview.count}`);
  if (status.reconciliation.blocked > 0) {
    reasons.push(`blocked reconciliation items: ${status.reconciliation.blocked}`);
  }
  if (status.placeholders.count > 0) {
    reasons.push(`placeholder entities: ${status.placeholders.count}`);
  }
  if (sourceArtifactProblems.length > 0) {
    reasons.push(
      `source artifact provenance: ${sourceArtifactProblems.length} problem${
        sourceArtifactProblems.length === 1 ? "" : "s"
      }`,
    );
  }
  return {
    ready: reasons.length === 0,
    readiness: sourceArtifactProblems.length > 0 ||
        status.sources.failed > 0 ||
        status.staleReview.count > 0 ||
        status.reconciliation.blocked > 0 ||
        status.placeholders.count > 0
      ? "not-ready"
      : status.review.open > 0 || status.review.deferred > 0
      ? "usable-with-warnings"
      : "usable",
    reasons,
    sourceArtifactProblems,
    nextCommand: status.nextCommand,
    unresolvedStateNote: status.unresolvedStateNote,
  };
}

export function renderReleaseVerification(result: ReleaseVerificationResult): string {
  const lines = [
    `Release verify: ${result.ready ? "ready" : "not ready"}`,
    `Readiness: ${result.readiness}`,
  ];
  if (result.reasons.length === 0) {
    lines.push("No blocking release issues found.");
  } else {
    lines.push("Reasons:");
    for (const reason of result.reasons) {
      lines.push(`- ${reason}`);
    }
  }
  if (result.sourceArtifactProblems.length > 0) {
    lines.push("Source artifact problems:");
    for (const problem of result.sourceArtifactProblems.slice(0, 5)) {
      lines.push(
        `- ${problem.sourceId} ${problem.endpointId} ${problem.artifactKind}: ${problem.message}`,
      );
    }
  }
  lines.push(`Readiness note: ${result.unresolvedStateNote}`);
  lines.push(`Next: ${result.nextCommand}`);
  return lines.join("\n");
}

function validateSourceArtifacts(
  artifacts: Array<{
    source_id: string;
    endpoint_id: string;
    artifact_kind: string;
    fetched_url: string;
    content_hash: string;
    size_bytes: number;
    observed_at: string;
  }>,
): ReleaseArtifactProblem[] {
  const problems: ReleaseArtifactProblem[] = [];
  for (const artifact of artifacts) {
    if (!artifact.source_id) {
      problems.push(problemForArtifact(artifact, "missing source_id"));
    }
    if (!artifact.endpoint_id) {
      problems.push(problemForArtifact(artifact, "missing endpoint_id"));
    }
    if (!artifact.artifact_kind) {
      problems.push(problemForArtifact(artifact, "missing artifact_kind"));
    }
    if (!artifact.content_hash) {
      problems.push(problemForArtifact(artifact, "missing content_hash"));
    }
    if (!artifact.observed_at) {
      problems.push(problemForArtifact(artifact, "missing observed_at"));
    }
    if (!Number.isFinite(artifact.size_bytes) || artifact.size_bytes < 0) {
      problems.push(problemForArtifact(artifact, "size_bytes must be a non-negative integer"));
    }
    if (!isPublicHttpUrl(artifact.fetched_url)) {
      problems.push(problemForArtifact(artifact, "fetched_url is not a public http/https URL"));
    }
  }
  return problems;
}

function problemForArtifact(
  artifact: { source_id: string; endpoint_id: string; artifact_kind: string },
  message: string,
): ReleaseArtifactProblem {
  return {
    sourceId: artifact.source_id || "unknown",
    endpointId: artifact.endpoint_id || "unknown",
    artifactKind: artifact.artifact_kind || "unknown",
    message,
  };
}

function isPublicHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = repeatedlyDecodeURIComponent(value).replaceAll("\\", "/");
  if (/^[a-z]:\//i.test(normalized) || normalized.startsWith("/") || /\bfile:/i.test(normalized)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function repeatedlyDecodeURIComponent(value: string): string {
  let decoded = value;
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}
