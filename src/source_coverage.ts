import { join } from "@std/path";
import { sourceClaimScope, sourceDefinitions, sourceEvidenceDepth } from "./source_definitions.ts";

export interface SourceCoverageRow {
  sourceId: string;
  title: string;
  kind: string;
  evidenceDepth: string;
  claimScope: string;
  status: "success" | "failed" | "missing";
  count: number | null;
  fetchedAt: string | null;
  path: string | null;
  note: string | null;
}

export async function sourceCoverageRows(
  repoPath: string,
  sourceIds = Object.keys(sourceDefinitions),
): Promise<SourceCoverageRow[]> {
  const rows: SourceCoverageRow[] = [];
  for (const sourceId of sourceIds) {
    const definition = sourceDefinitions[sourceId];
    const title = definition?.title ?? sourceId;
    const kind = definition?.kind ?? "unknown";
    const evidenceDepth = sourceEvidenceDepth(definition);
    const claimScope = sourceClaimScope(definition);
    const successPath = join(repoPath, "snapshots", ...sourceId.split("."), "latest.json");
    const failurePath = join(repoPath, "snapshots", ...sourceId.split("."), "failure.latest.json");

    const success = await readJson(successPath);
    if (success) {
      const payload = (success.payload ?? {}) as Record<string, unknown>;
      rows.push({
        sourceId,
        title,
        kind,
        evidenceDepth,
        claimScope,
        status: "success",
        count: countPayload(payload),
        fetchedAt: typeof success.fetched_at === "string" ? success.fetched_at : null,
        path: successPath,
        note: null,
      });
      continue;
    }

    const failure = await readJson(failurePath);
    if (failure) {
      rows.push({
        sourceId,
        title,
        kind,
        evidenceDepth,
        claimScope,
        status: "failed",
        count: null,
        fetchedAt: typeof failure.fetched_at === "string" ? failure.fetched_at : null,
        path: failurePath,
        note: typeof failure.error_summary === "string" ? failure.error_summary : null,
      });
      continue;
    }

    rows.push({
      sourceId,
      title,
      kind,
      evidenceDepth,
      claimScope,
      status: "missing",
      count: null,
      fetchedAt: null,
      path: null,
      note: "No latest snapshot or failure manifest.",
    });
  }
  return rows;
}

export function renderSourceCoverage(rows: SourceCoverageRow[]): string {
  const lines = [
    "Source coverage",
    "",
    "Status   Evidence          Count  Source",
    "------   --------          -----  ------",
  ];
  for (const row of rows) {
    const count = row.count === null ? "-" : String(row.count);
    lines.push(
      `${row.status.padEnd(7)}  ${row.evidenceDepth.padEnd(16)}  ${
        count.padStart(5)
      }  ${row.sourceId} (${row.kind})`,
    );
    lines.push(`         scope: ${row.claimScope}`);
    if (row.note && row.status !== "missing") lines.push(`         ${row.note}`);
  }
  return `${lines.join("\n")}\n`;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function countPayload(payload: Record<string, unknown>): number | null {
  if (typeof payload.row_count === "number") return payload.row_count;
  if (typeof payload.manifest_item_count === "number") return payload.manifest_item_count;
  if (typeof payload.link_count === "number") return payload.link_count;
  if (typeof payload.total_item_count === "number") return payload.total_item_count;
  if (typeof payload.endpoint_count === "number") return payload.endpoint_count;
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (Array.isArray(payload.links)) return payload.links.length;
  if (Array.isArray(payload.endpoints)) return payload.endpoints.length;
  return null;
}
