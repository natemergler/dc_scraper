import { ensureDir, walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import { parse, stringify } from "@std/yaml";
import { AnyRecord, isRecordType, LoadedRecord, recordFolders, RecordType } from "./types.ts";

export async function readYamlFile(path: string): Promise<unknown> {
  return parse(await Deno.readTextFile(path));
}

export async function writeYamlFile(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, stringify(value));
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextFile(path: string, value: string): Promise<void> {
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, value);
}

export function expectedRecordRelativePath(record: Pick<AnyRecord, "id" | "record_type">): string {
  return join("records", recordFolders[record.record_type], `${record.id}.yml`);
}

export function recordPath(
  repoPath: string,
  record: Pick<AnyRecord, "id" | "record_type">,
): string {
  return join(repoPath, expectedRecordRelativePath(record));
}

export async function loadRecords(repoPath: string): Promise<LoadedRecord[]> {
  const recordsRoot = join(repoPath, "records");
  const loaded: LoadedRecord[] = [];

  try {
    await Deno.stat(recordsRoot);
  } catch {
    return loaded;
  }

  for await (const entry of walk(recordsRoot, { exts: [".yml", ".yaml"], includeDirs: false })) {
    const parsed = await readYamlFile(entry.path);
    if (!isRecordObject(parsed)) {
      continue;
    }
    const record = parsed as AnyRecord;
    const expectedRelativePath = isRecordType(record.record_type) && typeof record.id === "string"
      ? expectedRecordRelativePath(record)
      : relative(repoPath, entry.path);
    loaded.push({
      path: entry.path,
      relativePath: relative(repoPath, entry.path),
      expectedRelativePath,
      record,
    });
  }

  loaded.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return loaded;
}

export async function loadRecordsByType(
  repoPath: string,
  recordType: RecordType,
): Promise<LoadedRecord[]> {
  return (await loadRecords(repoPath)).filter((entry) => entry.record.record_type === recordType);
}

export function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
