import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { type ReviewItem, reviewItemFileName, validateReviewItem } from "./items.ts";

export function reviewItemRoot(workspaceRoot: string): string {
  return join(workspaceRoot, "review-items");
}

export async function saveReviewItems(workspaceRoot: string, items: ReviewItem[]): Promise<void> {
  const root = reviewItemRoot(workspaceRoot);
  await ensureDir(root);
  const expectedFiles = new Set(items.map((item) => reviewItemFileName(item.id)));
  for (const item of [...items].sort((left, right) => left.id.localeCompare(right.id))) {
    const path = join(root, reviewItemFileName(item.id));
    await Deno.writeTextFile(path, `${JSON.stringify(item, null, 2)}\n`);
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
}

export async function loadReviewItems(workspaceRoot: string): Promise<ReviewItem[]> {
  const root = reviewItemRoot(workspaceRoot);
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
