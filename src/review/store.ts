import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { type ReviewItem, reviewItemFileName, validateReviewItem } from "./items.ts";

const REVIEW_ITEM_LOCK_FILE = ".review-items.lock";
const REVIEW_ITEM_LOCK_TIMEOUT_MS = 10_000;
const REVIEW_ITEM_STALE_LOCK_MS = 60_000;

export function reviewItemRoot(workspaceRoot: string): string {
  return join(workspaceRoot, "review-items");
}

export async function saveReviewItems(workspaceRoot: string, items: ReviewItem[]): Promise<void> {
  const root = reviewItemRoot(workspaceRoot);
  await withReviewItemLock(root, async () => {
    const expectedFiles = new Set(items.map((item) => reviewItemFileName(item.id)));
    for (const item of [...items].sort((left, right) => left.id.localeCompare(right.id))) {
      const path = join(root, reviewItemFileName(item.id));
      const tempPath = `${path}.${crypto.randomUUID()}.tmp`;
      await Deno.writeTextFile(tempPath, `${JSON.stringify(item, null, 2)}\n`);
      await Deno.rename(tempPath, path);
    }
    for await (const entry of Deno.readDir(root)) {
      if (entry.isFile && entry.name.endsWith(".json") && !expectedFiles.has(entry.name)) {
        try {
          await Deno.remove(join(root, entry.name));
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) {
            throw error;
          }
        }
      }
    }
  });
}

export async function loadReviewItems(workspaceRoot: string): Promise<ReviewItem[]> {
  const root = reviewItemRoot(workspaceRoot);
  await waitForReviewItemLock(root);
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(root)) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        files.push(entry.name);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }

  const items: ReviewItem[] = [];
  for (const file of files.sort()) {
    const path = join(root, file);
    const raw = await Deno.readTextFile(path);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(`invalid JSON in review item file ${path}`);
    }
    items.push(validateReviewItem(payload, path));
  }
  return items.sort(compareReviewItems);
}

async function withReviewItemLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  await ensureDir(root);
  const lockPath = join(root, REVIEW_ITEM_LOCK_FILE);
  const lock = await acquireReviewItemLock(lockPath);
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await fn() };
  } catch (error) {
    outcome = { ok: false, error };
  }

  const releaseError = await releaseReviewItemLock(lock, lockPath);
  if (releaseError !== undefined && outcome.ok) {
    throw releaseError;
  }
  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.value;
}

async function acquireReviewItemLock(lockPath: string): Promise<Deno.FsFile> {
  const startedAt = Date.now();
  while (true) {
    try {
      const lock = await Deno.open(lockPath, { createNew: true, write: true });
      try {
        await lock.write(new TextEncoder().encode(`${Deno.pid}\n${new Date().toISOString()}\n`));
      } catch (error) {
        await releaseReviewItemLock(lock, lockPath);
        throw error;
      }
      return lock;
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
      await removeStaleReviewItemLock(lockPath);
      if (Date.now() - startedAt > REVIEW_ITEM_LOCK_TIMEOUT_MS) {
        throw new Error(`timed out waiting for review item lock: ${lockPath}`);
      }
      await delay(25);
    }
  }
}

async function waitForReviewItemLock(root: string): Promise<void> {
  const lockPath = join(root, REVIEW_ITEM_LOCK_FILE);
  const startedAt = Date.now();
  while (true) {
    try {
      await Deno.stat(lockPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return;
      }
      throw error;
    }
    await removeStaleReviewItemLock(lockPath);
    if (Date.now() - startedAt > REVIEW_ITEM_LOCK_TIMEOUT_MS) {
      throw new Error(`timed out waiting for review item lock: ${lockPath}`);
    }
    await delay(25);
  }
}

async function removeStaleReviewItemLock(lockPath: string): Promise<void> {
  try {
    const stat = await Deno.stat(lockPath);
    const mtime = stat.mtime?.getTime() ?? Date.now();
    if (Date.now() - mtime > REVIEW_ITEM_STALE_LOCK_MS) {
      await Deno.remove(lockPath);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function releaseReviewItemLock(
  lock: Deno.FsFile,
  lockPath: string,
): Promise<unknown | undefined> {
  let releaseError: unknown;
  try {
    lock.close();
  } catch (error) {
    releaseError = error;
  }
  try {
    await Deno.remove(lockPath);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound) && releaseError === undefined) {
      releaseError = error;
    }
  }
  return releaseError;
}

export async function loadReviewItem(workspaceRoot: string, id: string): Promise<ReviewItem> {
  const items = await loadReviewItems(workspaceRoot);
  const item = items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`review item not found: ${id}`);
  }
  return item;
}

function compareReviewItems(left: ReviewItem, right: ReviewItem): number {
  if (left.severity === right.severity) {
    if (left.status === right.status) return left.id.localeCompare(right.id);
    return statusRank(left.status) - statusRank(right.status);
  }
  return severityRank(left.severity) - severityRank(right.severity);
}

function severityRank(severity: ReviewItem["severity"]): number {
  if (severity === "high") return 0;
  if (severity === "medium") return 1;
  return 2;
}

function statusRank(status: ReviewItem["status"]): number {
  if (status === "open") return 0;
  if (status === "drafted") return 1;
  return 2;
}
