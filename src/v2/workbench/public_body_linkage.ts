import { buildRelationshipCandidateId, normalizeName } from "../domain.ts";
import { comparePublicBodies, type PublicBodyVariantMatchName } from "./catalog.ts";
import { queryAll, run, withTransaction } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";

const LINKAGE_SOURCE_ID = "public_body_linkage";
const LINKAGE_PREFIX = `relationship.${LINKAGE_SOURCE_ID}.`;
const LINKAGE_REASON =
  "The source names a related board, but suffix similarity does not prove governance or that the link should be materialized.";

interface CandidateSourceRow {
  candidateId: string;
  sourceItemId: string;
  sourceId: string;
  artifactPath: string;
}

interface DerivedPublicBodyLinkageCandidate {
  relationshipCandidateId: string;
  sourceItemId: string;
  sourceId: string;
  fromEntityRef: string;
  toEntityRef: string;
  rawValue: string;
  artifactPath: string;
}

export function refreshPublicBodyLinkageCandidates(store: WorkbenchStore): number {
  const derived = publicBodyLinkageCandidates(store);
  withTransaction(store.db, () => {
    for (const candidate of derived) {
      upsertPublicBodyLinkageCandidate(store, candidate);
    }
  });
  return derived.length;
}

export function isPublicBodyLinkageRelationshipCandidateId(candidateId: string): boolean {
  return candidateId.startsWith(LINKAGE_PREFIX);
}

export function publicBodyLinkageWhyDeferred(): string {
  return LINKAGE_REASON;
}

function publicBodyLinkageCandidates(store: WorkbenchStore): DerivedPublicBodyLinkageCandidate[] {
  const comparison = comparePublicBodies(store);
  const sourceRows = candidateSourceRowsById(store);
  const candidates: DerivedPublicBodyLinkageCandidate[] = [];
  const seen = new Set<string>();

  for (const match of comparison.conservativeVariantMatches) {
    if (!match.matchKinds.includes("governance_suffix")) continue;
    const baseRows = match.names.filter((name) => isVariantBaseName(name, match.variantName));
    const relatedRows = match.names.filter((name) =>
      !isVariantBaseName(name, match.variantName) &&
      isGoverningBoardSuffixName(name.displayName, match.variantName)
    );
    for (const base of uniqueNamesByEntity(baseRows)) {
      for (const related of uniqueNamesByEntity(relatedRows)) {
        if (base.proposedEntityId === related.proposedEntityId) continue;
        const sourceRow = sourceRows.get(related.candidateId);
        if (!sourceRow) continue;
        const relationshipCandidateId = buildRelationshipCandidateId(
          LINKAGE_SOURCE_ID,
          `${base.proposedEntityId} governed_by ${related.proposedEntityId}`,
        );
        if (seen.has(relationshipCandidateId)) continue;
        seen.add(relationshipCandidateId);
        candidates.push({
          relationshipCandidateId,
          sourceItemId: sourceRow.sourceItemId,
          sourceId: sourceRow.sourceId,
          fromEntityRef: base.proposedEntityId,
          toEntityRef: related.proposedEntityId,
          rawValue: `${base.displayName} -> ${related.displayName}`,
          artifactPath: sourceRow.artifactPath,
        });
      }
    }
  }

  return candidates.sort((left, right) =>
    left.relationshipCandidateId.localeCompare(right.relationshipCandidateId)
  );
}

function uniqueNamesByEntity(
  names: PublicBodyVariantMatchName[],
): PublicBodyVariantMatchName[] {
  const byEntity = new Map<string, PublicBodyVariantMatchName>();
  for (const name of names) {
    if (!byEntity.has(name.proposedEntityId)) byEntity.set(name.proposedEntityId, name);
  }
  return [...byEntity.values()];
}

function isVariantBaseName(name: PublicBodyVariantMatchName, variantName: string): boolean {
  return normalizedKey(name.displayName) === normalizedKey(variantName);
}

function isGoverningBoardSuffixName(displayName: string, variantName: string): boolean {
  const normalized = normalizeName(displayName.replace(/\s+\([^)]*\)\s*$/, ""));
  const variant = normalizeName(variantName);
  return new RegExp(
    `^${escapeRegExp(variant)}\\s+board(?:\\s+of\\s+directors)?$`,
    "i",
  ).test(normalized);
}

function normalizedKey(value: string): string {
  return normalizeName(value).toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function candidateSourceRowsById(store: WorkbenchStore): Map<string, CandidateSourceRow> {
  const rows = queryAll<CandidateSourceRow>(
    store.db,
    `select entity_candidates.candidate_id as candidateId,
            source_items.source_item_id as sourceItemId,
            source_items.source_id as sourceId,
            coalesce(min(entity_candidate_evidence.artifact_path), '') as artifactPath
     from entity_candidates
     join source_items on source_items.source_item_id = entity_candidates.source_item_id
     left join entity_candidate_evidence
       on entity_candidate_evidence.candidate_id = entity_candidates.candidate_id
     group by entity_candidates.candidate_id,
              source_items.source_item_id,
              source_items.source_id`,
  );
  return new Map(rows.map((row) => [row.candidateId, row]));
}

function upsertPublicBodyLinkageCandidate(
  store: WorkbenchStore,
  candidate: DerivedPublicBodyLinkageCandidate,
): void {
  run(
    store.db,
    `insert into relationship_candidates(
       relationship_candidate_id, source_item_id, from_entity_ref, to_entity_ref,
       relationship_type, raw_value, needs_review, review_status
     ) values(?, ?, ?, ?, 'governed_by', ?, 1, coalesce(
       (select review_status from relationship_candidates where relationship_candidate_id = ?),
       'pending'
     ))
     on conflict(relationship_candidate_id) do update set
       source_item_id = excluded.source_item_id,
       from_entity_ref = excluded.from_entity_ref,
       to_entity_ref = excluded.to_entity_ref,
       relationship_type = excluded.relationship_type,
       raw_value = excluded.raw_value,
       needs_review = excluded.needs_review,
       review_status = excluded.review_status`,
    [
      candidate.relationshipCandidateId,
      candidate.sourceItemId,
      candidate.fromEntityRef,
      candidate.toEntityRef,
      candidate.rawValue,
      candidate.relationshipCandidateId,
    ],
  );
  run(
    store.db,
    `insert into relationship_candidate_evidence(
       evidence_id, relationship_candidate_id, source_id, source_item_id,
       field_path, observed_value, artifact_path
     ) values(?, ?, ?, ?, 'public_body_linkage.governance_suffix', ?, ?)
     on conflict(evidence_id) do update set
       relationship_candidate_id = excluded.relationship_candidate_id,
       source_id = excluded.source_id,
       source_item_id = excluded.source_item_id,
       field_path = excluded.field_path,
       observed_value = excluded.observed_value,
       artifact_path = excluded.artifact_path`,
    [
      `${candidate.relationshipCandidateId}:governance_suffix`,
      candidate.relationshipCandidateId,
      candidate.sourceId,
      candidate.sourceItemId,
      candidate.rawValue,
      candidate.artifactPath,
    ],
  );
}
