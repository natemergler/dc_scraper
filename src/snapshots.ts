import { join } from "@std/path";
import { writeJsonFile } from "./io.ts";

export interface SnapshotEnvelope {
  source_id: string;
  source_url: string;
  fetched_at: string;
  status: "success";
  content_hash: string;
  payload: Record<string, unknown>;
}

export interface FailureManifest {
  source_id: string;
  source_url: string;
  fetched_at: string;
  status: "failed";
  failure_mode: string;
  error_summary: string;
  recommended_follow_up: string;
}

export function snapshotPath(repoPath: string, sourceId: string): string {
  return join(repoPath, "snapshots", ...sourceId.split("."), "latest.json");
}

export function failurePath(repoPath: string, sourceId: string): string {
  return join(repoPath, "snapshots", ...sourceId.split("."), "failure.latest.json");
}

export async function makeSnapshotEnvelope(
  sourceId: string,
  sourceUrl: string,
  payload: Record<string, unknown>,
): Promise<SnapshotEnvelope> {
  return {
    source_id: sourceId,
    source_url: sourceUrl,
    fetched_at: new Date().toISOString(),
    status: "success",
    content_hash: await hashJson(payload),
    payload,
  };
}

export async function writeSnapshot(repoPath: string, envelope: SnapshotEnvelope): Promise<string> {
  const path = snapshotPath(repoPath, envelope.source_id);
  await writeJsonFile(path, envelope);
  return path;
}

export async function writeFailure(repoPath: string, manifest: FailureManifest): Promise<string> {
  const path = failurePath(repoPath, manifest.source_id);
  await writeJsonFile(path, manifest);
  return path;
}

async function hashJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${
    [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  }`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${
      entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")
    }}`;
  }
  return JSON.stringify(value);
}
