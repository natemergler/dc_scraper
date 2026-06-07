import { join } from "@std/path";

import { type Revision } from "../core/types.ts";

export async function loadRevisions(revisionRoot: string): Promise<Revision[]> {
  const revisions: Revision[] = [];

  let entries: Array<{ name: string; isFile: boolean }>;
  try {
    entries = [];
    for await (const entry of Deno.readDir(revisionRoot)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) {
        continue;
      }
      entries.push(entry);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw new Error(
      `failed to read revision root ${revisionRoot}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const path = join(revisionRoot, entry.name);
    const rawText = await Deno.readTextFile(path);
    let payload: unknown;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new Error(`invalid JSON in revision file ${path}`);
    }

    revisions.push(parseRevisionPayload(path, payload));
  }

  return revisions;
}

function parseRevisionPayload(path: string, payload: unknown): Revision {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`invalid revision payload in ${path}: revision must be an object`);
  }

  const candidate = payload as Record<string, unknown>;

  const id = candidate.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error(`invalid revision payload in ${path}: id must be a non-empty string`);
  }

  const source = candidate.source;
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error(`invalid revision payload in ${path}: source must be a non-empty string`);
  }

  const targetKind = candidate.targetKind;
  if (targetKind !== "entry" && targetKind !== "relation") {
    throw new Error(
      `invalid revision payload in ${path}: targetKind must be 'entry' or 'relation'`,
    );
  }

  const targetId = candidate.targetId;
  if (typeof targetId !== "string" || targetId.trim().length === 0) {
    throw new Error(`invalid revision payload in ${path}: targetId must be a non-empty string`);
  }

  const patch = candidate.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error(`invalid revision payload in ${path}: patch must be an object`);
  }

  return {
    id,
    source,
    targetKind,
    targetId,
    patch: patch as Record<string, unknown>,
  };
}
