import { nowIso } from "../domain.ts";
import { resolveKnownEntityOfficialUrl } from "../connectors/shared.ts";
import { queryAll, queryOne, run } from "./db.ts";
import {
  compareAuthoritativeEntitySourcePrecedence,
  compareEntityKindSpecificity,
} from "./entity_kind_policy.ts";
import type { WorkbenchStore } from "./store.ts";

interface CanonicalEntityFieldsRow {
  name: string;
  kind: string;
  branch?: string | null;
  cluster?: string | null;
  officialUrl?: string | null;
  mergedCandidateIds: string;
}

interface AcceptedEntityCandidateRow {
  candidateId: string;
  sourceId: string;
  name: string;
  kind: string;
  branch?: string | null;
  cluster?: string | null;
  officialUrl?: string | null;
  confidence?: number | null;
}

const PUBLIC_BODY_URL_SPECIFICITY_KINDS = new Set([
  "public_body",
  "board",
  "commission",
  "committee",
  "council",
  "task_force",
]);

export function refreshCanonicalEntityFieldsFromAcceptedCandidates(
  store: WorkbenchStore,
  entityId: string,
): void {
  if (hasManualFieldResolution(store, entityId)) return;
  const current = queryOne<CanonicalEntityFieldsRow>(
    store.db,
    `select name,
            kind,
            branch,
            cluster,
            official_url as officialUrl,
            merged_candidate_ids as mergedCandidateIds
     from canonical_entities
     where entity_id = ?`,
    [entityId],
  );
  if (!current) return;
  const mergedCandidateIds = JSON.parse(current.mergedCandidateIds) as string[];
  if (mergedCandidateIds.length === 0) return;
  const placeholders = mergedCandidateIds.map(() => "?").join(", ");
  const candidates = queryAll<AcceptedEntityCandidateRow>(
    store.db,
    `select candidate_id as candidateId,
            source_items.source_id as sourceId,
            name,
            kind,
            branch,
            cluster,
            official_url as officialUrl,
            confidence
     from entity_candidates
     join source_items
       on source_items.source_item_id = entity_candidates.source_item_id
     where review_status = 'accepted'
       and candidate_id in (${placeholders})`,
    mergedCandidateIds,
  );
  if (candidates.length === 0) return;
  const order = new Map(mergedCandidateIds.map((candidateId, index) => [candidateId, index]));
  const nameCandidate = strongestCandidateForField(candidates, order, "name");
  const kindCandidate = strongestCandidateForField(candidates, order, "kind");
  const branchCandidate = strongestCandidateForField(candidates, order, "branch");
  const clusterCandidate = strongestCandidateForField(candidates, order, "cluster");
  const officialUrlCandidate = strongestCandidateForField(candidates, order, "officialUrl");
  const resolvedKnownOfficialUrl = resolveKnownEntityOfficialUrl(
    nameCandidate?.name ?? current.name,
  );
  run(
    store.db,
    `update canonical_entities
     set name = ?,
         kind = ?,
         branch = ?,
         cluster = ?,
         official_url = ?,
         updated_at = ?
     where entity_id = ?`,
    [
      nameCandidate?.name ?? current.name,
      kindCandidate?.kind ?? current.kind,
      branchCandidate?.branch ?? current.branch ?? null,
      clusterCandidate?.cluster ?? current.cluster ?? null,
      officialUrlCandidate?.officialUrl ?? resolvedKnownOfficialUrl ?? current.officialUrl ?? null,
      nowIso(),
      entityId,
    ],
  );
}

type CanonicalEntityField = "name" | "kind" | "branch" | "cluster" | "officialUrl";

function strongestCandidateForField(
  candidates: AcceptedEntityCandidateRow[],
  order: Map<string, number>,
  field: CanonicalEntityField,
): AcceptedEntityCandidateRow | undefined {
  const candidatesWithField = field === "name" || field === "kind"
    ? candidates
    : candidates.filter((candidate) => hasText(candidate[field]));
  return candidatesWithField.toSorted((a, b) =>
    compareCandidateStrengthForField(a, b, order, field)
  )[0];
}

function compareCandidateStrengthForField(
  candidate: AcceptedEntityCandidateRow,
  other: AcceptedEntityCandidateRow,
  order: Map<string, number>,
  field: CanonicalEntityField,
): number {
  if (field === "officialUrl") {
    const officialUrlSpecificity = compareOfficialUrlSpecificity(candidate, other);
    if (officialUrlSpecificity !== 0) return -officialUrlSpecificity;
  }
  return compareCandidateStrength(candidate, other, order);
}

function compareCandidateStrength(
  candidate: AcceptedEntityCandidateRow,
  other: AcceptedEntityCandidateRow,
  order: Map<string, number>,
): number {
  const sourcePrecedence = compareAuthoritativeEntitySourcePrecedence(
    candidate.sourceId,
    other.sourceId,
  );
  if (sourcePrecedence !== 0) return -sourcePrecedence;

  const kindSpecificity = compareEntityKindSpecificity(candidate.kind, other.kind);
  if (kindSpecificity !== 0) return -kindSpecificity;

  const confidenceDelta = (other.confidence ?? 0) - (candidate.confidence ?? 0);
  if (confidenceDelta !== 0) return confidenceDelta;
  return (order.get(candidate.candidateId) ?? 0) - (order.get(other.candidateId) ?? 0);
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compareOfficialUrlSpecificity(
  candidate: AcceptedEntityCandidateRow,
  other: AcceptedEntityCandidateRow,
): number {
  return officialUrlSpecificityScore(candidate) - officialUrlSpecificityScore(other);
}

function officialUrlSpecificityScore(candidate: AcceptedEntityCandidateRow): number {
  if (!hasText(candidate.officialUrl)) return 0;
  if (!PUBLIC_BODY_URL_SPECIFICITY_KINDS.has(candidate.kind)) return 0;
  try {
    const url = new URL(candidate.officialUrl);
    return /\/service\//i.test(url.pathname) ? -1 : 0;
  } catch {
    return 0;
  }
}

function hasManualFieldResolution(store: WorkbenchStore, entityId: string): boolean {
  const row = queryOne<{ count: number }>(
    store.db,
    `select count(*) as count
     from resolution_events
     where event_type = 'set_entity_fields'
       and (subject_id = ? or json_extract(payload_json, '$.entityId') = ?)`,
    [entityId, entityId],
  );
  return (row?.count ?? 0) > 0;
}
