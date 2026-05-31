import { loadRecords } from "./io.ts";
import { AnyRecord } from "./types.ts";

export interface GapRecord extends AnyRecord {
  record_type: "gap";
  severity?: string;
  description?: string;
  release_relevant?: boolean;
  source_refs?: string[];
}

export async function listGaps(repoPath: string): Promise<GapRecord[]> {
  return (await loadRecords(repoPath))
    .map((entry) => entry.record)
    .filter(isGapRecord)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function findGap(repoPath: string, gapId: string): Promise<GapRecord | null> {
  return (await listGaps(repoPath)).find((gap) => gap.id === gapId) ?? null;
}

export function renderGapList(gaps: GapRecord[]): string {
  const lines = ["Gaps", "", "Severity  Release  Status   ID", "--------  -------  ------   --"];
  for (const gap of gaps) {
    lines.push(
      `${String(gap.severity ?? "unknown").padEnd(8)}  ${
        gap.release_relevant ? "release" : "local"
      }  ${String(gap.status ?? "open").padEnd(6)}   ${gap.id}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderGap(gap: GapRecord | null): string {
  if (!gap) return "Gap not found.\n";
  const lines = [
    `Gap: ${gap.id}`,
    `Name: ${gap.name ?? gap.id}`,
    `Severity: ${gap.severity ?? "unknown"}`,
    `Status: ${gap.status ?? "open"}`,
    `Release relevant: ${gap.release_relevant ? "yes" : "no"}`,
    "",
    String(gap.description ?? "No description recorded."),
  ];
  if (gap.source_refs?.length) {
    lines.push("", "Source refs:", ...gap.source_refs.map((sourceRef) => `  - ${sourceRef}`));
  }
  return `${lines.join("\n")}\n`;
}

function isGapRecord(record: AnyRecord): record is GapRecord {
  return record.record_type === "gap";
}
