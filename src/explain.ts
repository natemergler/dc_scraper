import { generateChecks } from "./checks.ts";
import { loadRecords } from "./io.ts";

export async function explainRecord(repoPath: string, recordId: string): Promise<string> {
  const loaded = (await loadRecords(repoPath)).find((entry) => entry.record.id === recordId);
  if (!loaded) throw new Error(`Record not found: ${recordId}`);
  const record = loaded.record;
  const checks = (await generateChecks(repoPath)).filter((check) => check.record_id === recordId);
  const derivedFrom = record.derived_from as Record<string, unknown> | undefined;
  const lines = [
    `Record: ${record.id}`,
    `Path: ${loaded.relativePath}`,
    `Type: ${record.record_type}`,
    `Origin: ${record.record_origin ?? "curated"}`,
    "",
  ];

  if (derivedFrom?.candidate_id) {
    lines.push("Derived from:");
    lines.push(`  ${derivedFrom.candidate_id}`);
    if (derivedFrom.snapshot_path) lines.push(`  ${derivedFrom.snapshot_path}`);
    lines.push("");
  }

  lines.push("Source refs:");
  for (const sourceRef of record.source_refs ?? []) lines.push(`  ${sourceRef}`);
  if (!record.source_refs?.length) lines.push("  none");
  lines.push("");

  lines.push("Open checks:");
  const openChecks = checks.filter((check) => !check.suppressed);
  if (openChecks.length === 0) {
    lines.push("  none");
  } else {
    for (const check of openChecks) lines.push(`  ${check.severity} ${check.id}: ${check.message}`);
  }
  lines.push("");

  lines.push("Release caveats:");
  const caveats = [
    ...(record.caveats ?? []),
    ...(record.release_relevant_caveats ?? []),
  ].filter((item): item is string => typeof item === "string");
  if (caveats.length === 0) lines.push("  none");
  for (const caveat of caveats) lines.push(`  ${caveat}`);

  return `${lines.join("\n")}\n`;
}
