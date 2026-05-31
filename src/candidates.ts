import { ensureDir, walk } from "@std/fs";
import { dirname, join } from "@std/path";
import { parse } from "@std/yaml";
import { loadRecords, writeYamlFile } from "./io.ts";
import { sourceDefinitions } from "./source_definitions.ts";
import { snapshotPath } from "./snapshots.ts";

export interface Candidate {
  id: string;
  record_type: "candidate";
  proposed_record_type: "civic_unit";
  proposed_record_id: string;
  source_family: string;
  source_table: string;
  source_row_key: string;
  generated_at: string;
  record: Record<string, unknown>;
}

export interface CandidateDiffItem {
  path: string;
  candidateValue: unknown;
  recordValue: unknown;
}

export async function generateCandidates(
  repoPath: string,
  sourceId?: string,
): Promise<Candidate[]> {
  const sourceIds = sourceId ? [sourceId] : Object.keys(sourceDefinitions);
  const candidates: Candidate[] = [];
  for (const id of sourceIds) {
    const definition = sourceDefinitions[id];
    if (!definition) throw new Error(`Unknown source id ${id}`);
    if (definition.kind !== "arcgis_table") continue;
    const snapshot = JSON.parse(await Deno.readTextFile(snapshotPath(repoPath, id)));
    const rows = (((snapshot.payload ?? {}) as Record<string, unknown>).rows ?? []) as Record<
      string,
      unknown
    >[];
    for (const row of rows) {
      const candidate = rowToCivicUnitCandidate(id, definition.table_name, row);
      candidates.push(candidate);
      await writeCandidate(repoPath, candidate);
    }
  }
  return candidates;
}

export async function writeCandidate(repoPath: string, candidate: Candidate): Promise<string> {
  const path = candidatePath(repoPath, candidate.id);
  await ensureDir(dirname(path));
  await writeYamlFile(path, candidate);
  return path;
}

export async function writePatchedCandidate(
  repoPath: string,
  candidate: Candidate,
): Promise<string> {
  const path = candidatePath(repoPath, candidate.id, "candidates_patched");
  await ensureDir(dirname(path));
  await writeYamlFile(path, candidate);
  return path;
}

export function candidatePath(
  repoPath: string,
  candidateId: string,
  root = "candidates",
): string {
  const parts = candidateId.split(".");
  if (parts.length >= 4 && parts[0] === "candidate") {
    return join(repoPath, root, parts[1], parts[2], `${candidateId}.yml`);
  }
  return join(repoPath, root, `${candidateId}.yml`);
}

export async function findCandidate(
  repoPath: string,
  candidateId: string,
): Promise<Candidate | null> {
  for (const root of ["candidates_patched", "candidates"]) {
    const direct = candidatePath(repoPath, candidateId, root);
    try {
      return parse(await Deno.readTextFile(direct)) as Candidate;
    } catch {
      // Fall through to a walk in case an older path strategy wrote the file.
    }
  }
  for (const root of ["candidates_patched", "candidates"]) {
    try {
      for await (
        const entry of walk(join(repoPath, root), {
          exts: [".yml", ".yaml"],
          includeDirs: false,
        })
      ) {
        const candidate = parse(await Deno.readTextFile(entry.path)) as Candidate;
        if (candidate.id === candidateId) return candidate;
      }
    } catch {
      // Try the next root.
    }
  }
  return null;
}

export async function listCandidates(repoPath: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  try {
    for await (
      const entry of walk(join(repoPath, "candidates"), {
        exts: [".yml", ".yaml"],
        includeDirs: false,
      })
    ) {
      const value = parse(await Deno.readTextFile(entry.path));
      if (isCandidate(value)) candidates.push(value);
    }
  } catch {
    return [];
  }
  return candidates.sort((a, b) => a.id.localeCompare(b.id));
}

export function renderCandidate(candidate: Candidate): string {
  const lines = [
    `Candidate: ${candidate.id}`,
    `Proposes: ${candidate.proposed_record_type} ${candidate.proposed_record_id}`,
    `Source: ${candidate.source_table} row ${candidate.source_row_key}`,
    "",
    `Name: ${String(candidate.record.name ?? "(unnamed)")}`,
    `Kind: ${String(candidate.record.unit_kind ?? "(unknown)")}`,
  ];
  return `${lines.join("\n")}\n`;
}

export async function candidateDiff(
  repoPath: string,
  candidateId: string,
): Promise<CandidateDiffItem[]> {
  const candidate = await findCandidate(repoPath, candidateId);
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
  const record = (await loadRecords(repoPath)).find((entry) =>
    entry.record.id === candidate.proposed_record_id
  )?.record;
  if (!record) return [];

  const keys = new Set([...Object.keys(candidate.record), ...Object.keys(record)]);
  const ignored = new Set([
    "source_context",
    "record_origin",
    "derived_from",
    "candidate_collisions",
  ]);
  const diff: CandidateDiffItem[] = [];
  for (const key of [...keys].sort()) {
    if (ignored.has(key)) continue;
    const candidateValue = candidate.record[key];
    const recordValue = record[key];
    if (JSON.stringify(candidateValue) !== JSON.stringify(recordValue)) {
      diff.push({ path: `/${key}`, candidateValue, recordValue });
    }
  }
  return diff;
}

function rowToCivicUnitCandidate(
  sourceId: string,
  tableName: string,
  row: Record<string, unknown>,
): Candidate {
  const key =
    stringField(row, ["AGENCY_ID", "ENTITY_ID", "BOARD_ID", "OBJECTID", "objectid", "ID", "id"]) ??
      hashish(JSON.stringify(row));
  const name = stringField(row, [
    "NAME",
    "name",
    "AGENCY",
    "AGENCY_NAME",
    "AGENCY_NAM",
    "BOARD_NAME",
    "TITLE",
  ]) ?? `Unnamed ${key}`;
  const sourceFamily = sourceId.split(".")[0];
  const sourceShortName = sourceId.split(".").slice(1).join(".");
  const acronym = stringField(row, ["ACRONYM"]);
  const officialUrl = stringField(row, ["WEB_URL", "URL", "WEBSITE"]);
  const legalAuthority = stringField(row, ["LEGISLATION", "AUTHORIZING_ORDER_LAW"]);
  const proposedRecordId = `dc.${slug(name)}`;
  const record: Record<string, unknown> = {
    id: proposedRecordId,
    record_type: "civic_unit",
    name,
    aliases: acronym ? [acronym] : [],
    legal_authority_notes: legalAuthority ? [legalAuthority] : [],
    unit_kind: inferUnitKind(sourceShortName, row),
    operating_layers: ["municipal"],
    status: "needs_review",
    source_refs: [sourceId],
    source_context: row,
  };
  if (officialUrl) record.official_url = officialUrl;

  return {
    id: `candidate.${sourceId}.${key}`,
    record_type: "candidate",
    proposed_record_type: "civic_unit",
    proposed_record_id: proposedRecordId,
    source_family: sourceFamily,
    source_table: tableName,
    source_row_key: key,
    generated_at: new Date().toISOString(),
    record,
  };
}

function inferUnitKind(sourceShortName: string, row: Record<string, unknown>): string {
  if (!sourceShortName.includes("boards")) return "agency";
  const type = stringField(row, ["TYPE"])?.toLowerCase() ?? "";
  if (type.includes("commission")) return "commission";
  if (type.includes("council")) return "council";
  if (type.includes("committee")) return "committee";
  return "board";
}

function stringField(row: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const value = row[name];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, ".").replace(
    /^\.+|\.+$/g,
    "",
  )
    .replace(/\.{2,}/g, ".");
}

function hashish(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return String(hash);
}

function isCandidate(value: unknown): value is Candidate {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (value as Record<string, unknown>).record_type === "candidate";
}
