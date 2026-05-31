import { relative } from "@std/path";
import { sourceDefinitions } from "./source_definitions.ts";
import { sourceCoverageRows } from "./source_coverage.ts";
import { compareAllSourcesToBaselines } from "./source_health.ts";

export interface SourceAuditRow {
  sourceId: string;
  title: string;
  kind: string;
  evidenceDepth: string;
  claimScope: string;
  coverageStatus: "success" | "failed" | "missing";
  healthStatus: "unchanged" | "changed" | "missing_baseline" | "missing_snapshot";
  count: number | null;
  fetchedAt: string | null;
  snapshotPath: string | null;
  baselinePath: string | null;
  note: string | null;
}

export async function sourceAuditRows(
  repoPath: string,
  sourceIds = Object.keys(sourceDefinitions),
): Promise<SourceAuditRow[]> {
  const coverageRows = await sourceCoverageRows(repoPath, sourceIds);
  const healthRows = await compareAllSourcesToBaselines(repoPath, sourceIds);
  const healthBySource = new Map(healthRows.map((row) => [row.sourceId, row]));

  return coverageRows.map((coverage) => {
    const health = healthBySource.get(coverage.sourceId);
    return {
      sourceId: coverage.sourceId,
      title: coverage.title,
      kind: coverage.kind,
      evidenceDepth: coverage.evidenceDepth,
      claimScope: coverage.claimScope,
      coverageStatus: coverage.status,
      healthStatus: health?.status ?? "missing_baseline",
      count: coverage.count,
      fetchedAt: coverage.fetchedAt,
      snapshotPath: coverage.path ? relative(repoPath, coverage.path) : null,
      baselinePath: health?.baselinePath ? relative(repoPath, health.baselinePath) : null,
      note: coverage.note,
    };
  });
}

export function renderSourceAudit(rows: SourceAuditRow[]): string {
  const lines = [
    "Source audit",
    "",
    "Coverage  Health            Evidence          Count  Fetched      Source",
    "--------  ------            --------          -----  -------      ------",
  ];
  for (const row of rows) {
    const count = row.count === null ? "-" : String(row.count);
    const fetched = row.fetchedAt ? row.fetchedAt.slice(0, 10) : "-";
    lines.push(
      `${row.coverageStatus.padEnd(8)}  ${row.healthStatus.padEnd(16)}  ${
        row.evidenceDepth.padEnd(16)
      }  ${count.padStart(5)}  ${fetched.padEnd(11)}  ${row.sourceId} (${row.kind})`,
    );
    lines.push(`  scope: ${row.claimScope}`);
    if (row.snapshotPath) lines.push(`  snapshot: ${row.snapshotPath}`);
    if (row.baselinePath) lines.push(`  baseline: ${row.baselinePath}`);
    if (row.note) lines.push(`  note: ${row.note}`);
  }
  return `${lines.join("\n")}\n`;
}
