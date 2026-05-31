import { recordPath, writeYamlFile } from "./io.ts";
import { Candidate, findCandidate, listCandidates } from "./candidates.ts";

export interface PromotionResult {
  status: "created" | "exists" | "dry_run";
  recordId: string;
  path: string;
}

export async function promoteCandidate(
  repoPath: string,
  candidateId: string,
  options: { dryRun?: boolean } = {},
): Promise<PromotionResult> {
  const candidate = await findCandidate(repoPath, candidateId);
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
  return promoteLoadedCandidate(repoPath, candidate, options);
}

export async function promoteLoadedCandidate(
  repoPath: string,
  candidate: Candidate,
  options: { dryRun?: boolean } = {},
): Promise<PromotionResult> {
  if (
    typeof candidate.record.id !== "string" ||
    candidate.record.record_type !== "civic_unit"
  ) {
    throw new Error(`Candidate ${candidate.id} does not contain a promotable civic_unit record.`);
  }
  const baseRecord = candidate.record as {
    id: string;
    record_type: "civic_unit";
    [key: string]: unknown;
  };
  const record: { id: string; record_type: "civic_unit"; [key: string]: unknown } = {
    ...baseRecord,
    record_origin: "generated_curated",
    derived_from: {
      candidate_id: candidate.id,
      source_row_key: candidate.source_row_key,
    },
  };
  const path = recordPath(repoPath, record);

  try {
    await Deno.stat(path);
    return { status: "exists", recordId: record.id, path };
  } catch {
    // Missing path is the happy create path.
  }

  if (options.dryRun) return { status: "dry_run", recordId: record.id, path };
  await writeYamlFile(path, record);
  return { status: "created", recordId: record.id, path };
}

export async function promoteAllNew(
  repoPath: string,
  options: { sourcePrefix?: string; dryRun?: boolean } = {},
): Promise<PromotionResult[]> {
  const candidates = await listCandidates(repoPath);
  const filtered = options.sourcePrefix
    ? candidates.filter((candidate) => candidate.id.startsWith(`candidate.${options.sourcePrefix}`))
    : candidates;
  const results: PromotionResult[] = [];
  for (const candidate of filtered) {
    results.push(await promoteLoadedCandidate(repoPath, candidate, options));
  }
  return results;
}
