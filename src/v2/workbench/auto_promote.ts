import { normalizeName, nowIso } from "../domain.ts";
import { refreshCanonicalEntityFieldsFromAcceptedCandidates } from "./canonical_entity_fields.ts";
import { queryAll, queryOne, run, withTransaction } from "./db.ts";
import { classifySameEntityKindMerge } from "./entity_kind_policy.ts";
import { refreshLegalRefAttachments } from "./legal_ref_attachments.ts";
import type { WorkbenchStore } from "./store.ts";

const AUTO_PROMOTE_SOURCE_ALLOWLIST = new Set([
  "bega.structure",
  "dcgis.agencies",
  "dcgis.boards_commissions_councils",
  "dccourts.structure",
  "open_dc.public_bodies",
  "council.members",
  "mayor.office",
  "council.committees",
  "oanc.anc_profiles",
  "mota.quickbase",
]);

const AUTO_PROMOTE_KIND_BLOCKLIST = new Set([
  "public_official",
]);

const AUTO_PROMOTE_PUBLIC_OFFICIAL_SOURCE_ALLOWLIST = new Set([
  "council.members",
  "mayor.office",
  "oanc.anc_profiles",
]);

const AUTO_PROMOTE_MIN_CONFIDENCE = 0.9;

interface AutoPromoteCandidateRow {
  candidateId: string;
  proposedEntityId: string;
  name: string;
  normalizedName: string;
  kind: string;
  branch?: string | null;
  cluster?: string | null;
  officialUrl?: string | null;
  confidence?: number | null;
  sourceId: string;
  reviewItemStatus?: string | null;
  safeToAutoAccept?: number | null;
  stalePriorDecision?: number | null;
  replayConflict?: number | null;
}

interface CanonicalEntityRow {
  name: string;
  kind: string;
  mergedCandidateIds: string;
  isPlaceholder: number;
}

export function autoPromoteSafeEntityCandidates(store: WorkbenchStore): number {
  const candidates = queryAll<AutoPromoteCandidateRow>(
    store.db,
    `select entity_candidates.candidate_id as candidateId,
            entity_candidates.proposed_entity_id as proposedEntityId,
            entity_candidates.name,
            entity_candidates.normalized_name as normalizedName,
            entity_candidates.kind,
            entity_candidates.branch,
            entity_candidates.cluster,
            entity_candidates.official_url as officialUrl,
            entity_candidates.confidence,
            source_items.source_id as sourceId,
            review_items.status as reviewItemStatus,
            json_extract(review_items.details_json, '$.safeToAutoAccept') as safeToAutoAccept,
            json_extract(review_items.details_json, '$.stalePriorDecision') as stalePriorDecision,
            json_extract(review_items.details_json, '$.replayConflict') as replayConflict
     from entity_candidates
     join source_items on source_items.source_item_id = entity_candidates.source_item_id
     join entity_candidate_evidence
       on entity_candidate_evidence.candidate_id = entity_candidates.candidate_id
     left join review_items
       on review_items.subject_id = entity_candidates.candidate_id
      and review_items.item_type = 'entity_candidate'
     where entity_candidates.review_status = 'pending'
     group by entity_candidates.candidate_id`,
  );

  const grouped = new Map<string, AutoPromoteCandidateRow[]>();
  for (const candidate of candidates) {
    if (!AUTO_PROMOTE_SOURCE_ALLOWLIST.has(candidate.sourceId)) continue;
    const group = grouped.get(candidate.proposedEntityId) ?? [];
    group.push(candidate);
    grouped.set(candidate.proposedEntityId, group);
  }

  let acceptedCount = 0;
  withTransaction(store.db, () => {
    for (const [entityId, group] of grouped.entries()) {
      if (!groupIsSafeToAutoPromote(store, entityId, group)) continue;
      for (const candidate of group) {
        acceptEntityCandidateDirect(store, candidate);
        acceptedCount += 1;
      }
    }
  });
  if (acceptedCount > 0) {
    refreshLegalRefAttachments(store);
  }

  return acceptedCount;
}

function groupIsSafeToAutoPromote(
  store: WorkbenchStore,
  entityId: string,
  group: AutoPromoteCandidateRow[],
): boolean {
  if (group.length === 0) return false;
  const primaryCandidates = group.filter((candidate) =>
    !isSeededRelationshipEndpointCandidate(candidate.candidateId)
  );
  const promotableCandidates = primaryCandidates.length > 0
    ? primaryCandidates
    : group.every((candidate) => candidate.safeToAutoAccept === 1)
    ? group
    : [];
  const seededOnlySafeGroup = primaryCandidates.length === 0 && promotableCandidates.length > 0;
  if (promotableCandidates.length === 0) return false;
  if (
    promotableCandidates.some((candidate) =>
      AUTO_PROMOTE_KIND_BLOCKLIST.has(candidate.kind) &&
      !AUTO_PROMOTE_PUBLIC_OFFICIAL_SOURCE_ALLOWLIST.has(candidate.sourceId)
    )
  ) {
    return false;
  }
  if (
    !seededOnlySafeGroup &&
    promotableCandidates.some((candidate) =>
      typeof candidate.confidence !== "number" || candidate.confidence < AUTO_PROMOTE_MIN_CONFIDENCE
    )
  ) {
    return false;
  }
  if (
    group.some((candidate) =>
      candidate.reviewItemStatus === "deferred" ||
      candidate.stalePriorDecision === 1 ||
      candidate.replayConflict === 1
    )
  ) {
    return false;
  }

  const [first] = promotableCandidates;
  if (!first) return false;
  if (
    promotableCandidates.some((candidate) =>
      candidate.normalizedName !== first.normalizedName || candidate.kind !== first.kind
    )
  ) {
    return false;
  }

  const canonical = queryOne<CanonicalEntityRow>(
    store.db,
    `select name,
            kind,
            merged_candidate_ids as mergedCandidateIds,
            is_placeholder as isPlaceholder
     from canonical_entities
     where entity_id = ?`,
    [entityId],
  );
  if (!canonical) return true;
  if (canonical.isPlaceholder === 1) return false;
  if (canonical.kind !== first.kind) {
    const decision = classifySameEntityKindMerge(store, canonical, first).decision;
    return decision === "compatible" || decision === "refinement";
  }
  if (normalizeName(canonical.name).toLowerCase() === first.normalizedName) return true;
  return entityId === first.proposedEntityId;
}

function isSeededRelationshipEndpointCandidate(candidateId: string): boolean {
  return candidateId.includes("_from_endpoint") || candidateId.includes("_to_endpoint");
}

function acceptEntityCandidateDirect(
  store: WorkbenchStore,
  candidate: AutoPromoteCandidateRow,
): void {
  const existing = queryOne<CanonicalEntityRow>(
    store.db,
    `select name,
            kind,
            merged_candidate_ids as mergedCandidateIds,
            is_placeholder as isPlaceholder
     from canonical_entities
     where entity_id = ?`,
    [candidate.proposedEntityId],
  );
  if (!existing) {
    run(
      store.db,
      "insert into canonical_entities(entity_id, name, kind, branch, cluster, official_url, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values(?, ?, ?, ?, ?, ?, 'accepted', ?, 0, null, ?, ?)",
      [
        candidate.proposedEntityId,
        candidate.name,
        candidate.kind,
        candidate.branch ?? null,
        candidate.cluster ?? null,
        candidate.officialUrl ?? null,
        JSON.stringify([candidate.candidateId]),
        nowIso(),
        nowIso(),
      ],
    );
  } else {
    const mergedCandidateIds = JSON.parse(existing.mergedCandidateIds) as string[];
    if (!mergedCandidateIds.includes(candidate.candidateId)) {
      mergedCandidateIds.push(candidate.candidateId);
      run(
        store.db,
        "update canonical_entities set merged_candidate_ids = ?, updated_at = ? where entity_id = ?",
        [JSON.stringify(mergedCandidateIds), nowIso(), candidate.proposedEntityId],
      );
    }
  }

  run(
    store.db,
    "update entity_candidates set review_status = 'accepted' where candidate_id = ?",
    [candidate.candidateId],
  );
  if (existing) {
    refreshCanonicalEntityFieldsFromAcceptedCandidates(store, candidate.proposedEntityId);
  }
  run(
    store.db,
    "update review_items set status = 'resolved', updated_at = ? where subject_id = ? and item_type = 'entity_candidate'",
    [nowIso(), candidate.candidateId],
  );
}
