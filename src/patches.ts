import { ensureDir, walk } from "@std/fs";
import { dirname, join } from "@std/path";
import { parse } from "@std/yaml";
import { Candidate, candidatePath, findCandidate, writePatchedCandidate } from "./candidates.ts";
import { writeYamlFile } from "./io.ts";

export interface PatchOperation {
  op: "set" | "append_unique" | "add_caveat";
  path: string;
  value: unknown;
  expected_before?: unknown;
}

export interface PatchDocument {
  id: string;
  record_type: "patch";
  status: "draft" | "active";
  candidate_id: string;
  operations: PatchOperation[];
}

export interface PatchResult {
  status: "applied" | "conflict";
  value: Record<string, unknown>;
  conflicts: string[];
}

export interface ApplyActivePatchesResult {
  applied: number;
  conflicts: string[];
  writtenPaths: string[];
}

export async function writePatch(
  repoPath: string,
  patch: PatchDocument,
  options: { overwrite?: boolean } = {},
): Promise<string> {
  const path = patchPath(repoPath, patch);
  if (!options.overwrite) {
    try {
      await Deno.stat(path);
      throw new Error(`Patch already exists: ${path}`);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // New patch path is safe to write.
      } else {
        throw error;
      }
    }
  }
  await ensureDir(dirname(path));
  await writeYamlFile(path, patch);
  return path;
}

export async function findPatch(
  repoPath: string,
  patchId: string,
): Promise<{ patch: PatchDocument; path: string } | null> {
  try {
    for await (
      const entry of walk(join(repoPath, "patches"), {
        exts: [".yml", ".yaml"],
        includeDirs: false,
      })
    ) {
      const patch = parse(await Deno.readTextFile(entry.path));
      if (isPatchDocument(patch) && patch.id === patchId) return { patch, path: entry.path };
    }
  } catch {
    return null;
  }
  return null;
}

export async function activatePatch(repoPath: string, patchId: string): Promise<string> {
  const found = await findPatch(repoPath, patchId);
  if (!found) throw new Error(`Patch not found: ${patchId}`);
  const patch: PatchDocument = { ...found.patch, status: "active" };
  await writeYamlFile(found.path, patch);
  return found.path;
}

export function patchPath(repoPath: string, patch: PatchDocument): string {
  const family = patch.candidate_id.split(".")[1] ?? "manual";
  return join(repoPath, "patches", family, `${patch.id}.yml`);
}

export async function listPatches(repoPath: string): Promise<PatchDocument[]> {
  const patches: PatchDocument[] = [];
  try {
    for await (
      const entry of walk(join(repoPath, "patches"), {
        exts: [".yml", ".yaml"],
        includeDirs: false,
      })
    ) {
      const patch = parse(await Deno.readTextFile(entry.path));
      if (isPatchDocument(patch)) patches.push(patch);
    }
  } catch {
    return [];
  }
  return patches.sort((a, b) => a.id.localeCompare(b.id));
}

export async function applyActivePatches(repoPath: string): Promise<ApplyActivePatchesResult> {
  const activePatches = (await listPatches(repoPath)).filter((patch) => patch.status === "active");
  const byCandidate = Map.groupBy(activePatches, (patch) => patch.candidate_id);
  const conflicts: string[] = [];
  const writtenPaths: string[] = [];
  let applied = 0;

  for (const [candidateId, patches] of byCandidate) {
    const original = await findOriginalCandidate(repoPath, candidateId);
    if (!original) {
      conflicts.push(`${candidateId}: candidate not found`);
      continue;
    }
    let record = structuredClone(original.record);
    const candidateConflicts: string[] = [];
    for (const patch of patches) {
      const result = applyPatch(record, patch);
      if (result.status === "conflict") {
        candidateConflicts.push(...result.conflicts.map((conflict) => `${patch.id}: ${conflict}`));
      } else {
        record = result.value;
      }
    }
    if (candidateConflicts.length === 0) {
      const patched: Candidate = {
        ...original,
        record,
        patch_ids: patches.map((patch) => patch.id),
      } as Candidate;
      writtenPaths.push(await writePatchedCandidate(repoPath, patched));
      applied++;
    } else {
      conflicts.push(...candidateConflicts);
    }
  }

  return { applied, conflicts, writtenPaths };
}

async function findOriginalCandidate(
  repoPath: string,
  candidateId: string,
): Promise<Candidate | null> {
  try {
    return parse(
      await Deno.readTextFile(candidatePath(repoPath, candidateId, "candidates")),
    ) as Candidate;
  } catch {
    return findCandidate(repoPath, candidateId);
  }
}

export function applyPatch(
  input: Record<string, unknown>,
  patch: PatchDocument,
): PatchResult {
  const value = structuredClone(input);
  const conflicts: string[] = [];

  for (const operation of patch.operations) {
    const current = readPath(value, operation.path);
    if (
      "expected_before" in operation &&
      JSON.stringify(current) !== JSON.stringify(operation.expected_before)
    ) {
      conflicts.push(
        `${operation.path} expected ${JSON.stringify(operation.expected_before)} but found ${
          JSON.stringify(current)
        }`,
      );
      continue;
    }

    if (operation.op === "set") {
      writePath(value, operation.path, operation.value);
    } else if (operation.op === "append_unique") {
      const array = current === undefined ? [] : current;
      if (!Array.isArray(array)) {
        conflicts.push(`${operation.path} is not an array.`);
      } else if (!array.some((item) => JSON.stringify(item) === JSON.stringify(operation.value))) {
        writePath(value, operation.path, [...array, operation.value]);
      }
    } else if (operation.op === "add_caveat") {
      const array = value.caveats === undefined ? [] : value.caveats;
      if (!Array.isArray(array)) {
        conflicts.push("/caveats is not an array.");
      } else if (!array.includes(operation.value)) {
        value.caveats = [...array, operation.value];
      }
    }
  }

  return { status: conflicts.length ? "conflict" : "applied", value, conflicts };
}

function readPath(root: Record<string, unknown>, pointer: string): unknown {
  const keys = pointerKeys(pointer);
  let current: unknown = root;
  for (const key of keys) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function writePath(root: Record<string, unknown>, pointer: string, value: unknown): void {
  const keys = pointerKeys(pointer);
  let current: Record<string, unknown> = root;
  for (const key of keys.slice(0, -1)) {
    const next = current[key];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys.at(-1) ?? ""] = value;
}

function pointerKeys(pointer: string): string[] {
  return pointer.replace(/^\//, "").split("/").filter(Boolean).map((part) =>
    part.replaceAll("~1", "/").replaceAll("~0", "~")
  );
}

function isPatchDocument(value: unknown): value is PatchDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (value as Record<string, unknown>).record_type === "patch";
}
