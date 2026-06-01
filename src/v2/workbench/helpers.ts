import { ensureDir } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import { compactDatePart, sha256Hex } from "../domain.ts";

export function makeId(prefix: string): string {
  return `${prefix}.${crypto.randomUUID()}`;
}

export async function writeArtifact(
  dataDir: string,
  sourceId: string,
  endpointId: string,
  extension: string,
  content: string,
): Promise<string> {
  const directory = join(dataDir, sourceId, endpointId, compactDatePart());
  await ensureDir(directory);
  const filePath = join(directory, `${makeId("artifact")}.${extension}`);
  await ensureDir(dirname(filePath));
  await Deno.writeTextFile(filePath, content);
  return relative(Deno.cwd(), filePath);
}

export function requireItem<T>(
  itemIndex: Map<string, T>,
  itemKey: string,
): T {
  const item = itemIndex.get(itemKey);
  if (!item) throw new Error(`Missing source item for key ${itemKey}`);
  return item;
}

export async function contentHash(content: string): Promise<string> {
  return `sha256:${await sha256Hex(content)}`;
}
