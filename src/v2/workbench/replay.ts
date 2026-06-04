import {
  type EntityCandidateInput,
  type LegalRefInput,
  normalizeName,
  nowIso,
  type RelationshipCandidateInput,
  sha256Hex,
  slugify,
} from "../domain.ts";
import { refreshCanonicalEntityFieldsFromAcceptedCandidates } from "./canonical_entity_fields.ts";
import { queryAll, queryOne, run } from "./db.ts";
import { endpointStatus } from "./endpoint_status.ts";
import { reconcileRelationshipCandidates } from "./reconciliation.ts";
import { buildRelationshipReviewDraft } from "./relationship_review.ts";
import { isLegalAuthorityRelationship } from "./relationship_kinds.ts";
import type { WorkbenchStore } from "./store.ts";

export interface EntityDecisionHint {
  candidateId: string;
  proposedEntityId: string;
  factSignature: string;
  evidenceHash: string;
}

export interface LegalRefDecisionHint {
  legalRefId: string;
  factSignature: string;
  evidenceHash: string;
}

export interface RelationshipDecisionHint {
  relationshipCandidateId: string;
  factSignature: string;
  evidenceHash: string;
}

interface RelationshipReplayDecisionRow {
  factSignature: string;
  eventType: string;
  eventId: string;
  evidenceHash?: string | null;
  resolvedRelationshipType?: string | null;
  resolvedFromEntityId?: string | null;
  resolvedToEntityId?: string | null;
}

interface EntityReplayDecisionRow {
  factSignature: string;
  eventType: string;
  evidenceHash?: string | null;
  resolvedEntityId?: string | null;
}

interface RelationshipReplayReviewDecisionRow {
  factSignature: string;
  eventType: string;
  reviewItemId: string;
  evidenceHash?: string | null;
}

interface EntityReplayReviewDecisionRow {
  factSignature: string;
  eventType: string;
  reviewItemId: string;
  evidenceHash?: string | null;
}

interface RelationshipReplayCandidateRow {
  relationshipCandidateId: string;
  reviewStatus: string;
}

interface EntityReplayCandidateRow {
  candidateId: string;
  reviewStatus: string;
}

interface RelationshipReplayReviewItemRow {
  relationshipCandidateId: string;
  reviewItemId: string;
  reason: string;
  detailsJson: string;
  status: string;
}

interface EntityReplayReviewItemRow {
  candidateId: string;
  reviewItemId: string;
  reason: string;
  defaultAction: string;
  detailsJson: string;
  status: string;
}

export async function buildEntityDecisionHint(
  sourceId: string,
  candidate: EntityCandidateInput,
): Promise<EntityDecisionHint> {
  return {
    candidateId: candidate.candidateId,
    proposedEntityId: candidate.proposedEntityId,
    factSignature: entityFactSignature(sourceId, candidate),
    evidenceHash: await entityEvidenceHash(candidate),
  };
}

export async function buildLegalRefDecisionHint(
  sourceId: string,
  legalRef: LegalRefInput,
): Promise<LegalRefDecisionHint> {
  return {
    legalRefId: legalRef.legalRefId,
    factSignature: legalRefFactSignature(sourceId, legalRef),
    evidenceHash: await legalRefEvidenceHash(legalRef),
  };
}

export async function buildRelationshipDecisionHint(
  sourceId: string,
  candidate: RelationshipCandidateInput,
): Promise<RelationshipDecisionHint> {
  return {
    relationshipCandidateId: candidate.relationshipCandidateId,
    factSignature: relationshipFactSignature(sourceId, candidate),
    evidenceHash: await relationshipEvidenceHash(candidate),
  };
}

export async function reuseOrMarkStaleEntityDecisions(
  store: WorkbenchStore,
  hints: EntityDecisionHint[],
): Promise<void> {
  const priorDecisionsByFactSignature = latestEntityReplayDecisionsByFactSignature(
    store,
    hints.map((hint) => hint.factSignature),
  );
  const factSignaturesMissingAcceptReject = hints
    .filter((hint) => !priorDecisionsByFactSignature.get(hint.factSignature)?.evidenceHash)
    .map((hint) => hint.factSignature);
  const priorMergeDecisionsByFactSignature = latestEntityMergeReplayDecisionsByFactSignature(
    store,
    factSignaturesMissingAcceptReject,
  );
  const decisionByFactSignature = new Map<string, EntityReplayDecisionRow>();
  for (const [factSignature, decision] of priorMergeDecisionsByFactSignature.entries()) {
    decisionByFactSignature.set(factSignature, decision);
  }
  for (const [factSignature, decision] of priorDecisionsByFactSignature.entries()) {
    if (decision.evidenceHash) decisionByFactSignature.set(factSignature, decision);
  }
  const exactReplayHints = hints.filter((hint) =>
    decisionByFactSignature.get(hint.factSignature)?.evidenceHash === hint.evidenceHash
  );
  const staleOrDeferredHints = hints.filter((hint) =>
    decisionByFactSignature.get(hint.factSignature)?.evidenceHash !== hint.evidenceHash
  );
  const priorReviewDecisionsByFactSignature = latestEntityReplayReviewDecisionsByFactSignature(
    store,
    staleOrDeferredHints
      .filter((hint) => !decisionByFactSignature.get(hint.factSignature)?.evidenceHash)
      .map((hint) => hint.factSignature),
  );
  const candidatesById = entityReplayCandidatesById(
    store,
    exactReplayHints.map((hint) => hint.candidateId),
  );
  const reviewItemsByCandidateId = entityReplayReviewItemsByCandidateId(
    store,
    staleOrDeferredHints.map((hint) => hint.candidateId),
  );
  let changed = false;
  for (const hint of hints) {
    const decision = decisionByFactSignature.get(hint.factSignature);
    if (!decision?.evidenceHash) {
      reuseOrMarkStaleDeferredEntityReview(
        store,
        hint,
        priorReviewDecisionsByFactSignature.get(hint.factSignature),
        reviewItemsByCandidateId.get(hint.candidateId),
      );
      continue;
    }

    if (decision.evidenceHash === hint.evidenceHash) {
      const candidate = candidatesById.get(hint.candidateId);
      if (!candidate) continue;
      if (
        decision.eventType === "accept_entity_candidate" ||
        decision.eventType === "merge_entity_candidates"
      ) {
        if (candidate.reviewStatus !== "accepted") {
          const reused = mergeAcceptedEntityCandidate(
            store,
            hint.candidateId,
            decision.resolvedEntityId ?? hint.proposedEntityId,
          );
          if (!reused) {
            markEntityReplayConflict(
              store,
              hint,
              decision.eventType === "merge_entity_candidates" ? "merged" : "accepted",
              decision.resolvedEntityId ?? hint.proposedEntityId,
              `prior ${
                decision.eventType === "merge_entity_candidates" ? "merged" : "accepted"
              } decision could not be replayed because resolved entity ${
                decision.resolvedEntityId ?? hint.proposedEntityId
              } is missing`,
            );
            continue;
          }
        }
      } else if (candidate.reviewStatus !== "rejected") {
        run(
          store.db,
          "update entity_candidates set review_status = 'rejected' where candidate_id = ?",
          [hint.candidateId],
        );
      }
      run(
        store.db,
        "update review_items set status = 'resolved', updated_at = ? where subject_id = ? and item_type = 'entity_candidate'",
        [nowIso(), hint.candidateId],
      );
      changed = true;
      continue;
    }

    const reviewItem = reviewItemsByCandidateId.get(hint.candidateId);
    if (!reviewItem) continue;
    const details = JSON.parse(reviewItem.detailsJson) as Record<string, unknown>;
    const priorDecisionState = decision.eventType === "accept_entity_candidate"
      ? "accepted"
      : decision.eventType === "merge_entity_candidates"
      ? "merged"
      : "rejected";
    details.priorDecisionState = priorDecisionState;
    details.stalePriorDecision = true;
    details.factSignature = hint.factSignature;
    details.evidenceHash = hint.evidenceHash;
    if (priorDecisionState === "merged" && decision.resolvedEntityId) {
      details.priorResolvedEntityId = decision.resolvedEntityId;
    }
    if (
      (priorDecisionState === "accepted" || priorDecisionState === "merged") &&
      decision.resolvedEntityId
    ) {
      const priorResolvedFields = latestResolvedEntityFields(store, decision.resolvedEntityId);
      if (priorResolvedFields) {
        details.priorResolvedFields = priorResolvedFields;
      }
    }
    const staleSuffix = `changed since a prior ${priorDecisionState} decision`;
    const staleReason = reviewItem.reason.includes(staleSuffix)
      ? reviewItem.reason
      : `${reviewItem.reason} (${staleSuffix})`;
    const staleDefaultAction = priorDecisionState === "accepted"
      ? "accept"
      : priorDecisionState === "rejected"
      ? "reject"
      : reviewItem.defaultAction;
    run(
      store.db,
      "update review_items set reason = ?, default_action = ?, details_json = ?, status = 'open', updated_at = ? where subject_id = ? and item_type = 'entity_candidate'",
      [
        staleReason,
        staleDefaultAction,
        JSON.stringify(details),
        nowIso(),
        hint.candidateId,
      ],
    );
  }
  if (changed) {
    reconcileRelationshipCandidates(store);
  }
}

export async function reuseOrMarkStaleLegalRefDecisions(
  store: WorkbenchStore,
  hints: LegalRefDecisionHint[],
): Promise<void> {
  for (const hint of hints) {
    const priorDecision = queryOne<{
      eventType: string;
      evidenceHash?: string | null;
      resolvedRefType?: string | null;
      resolvedNormalizedCitation?: string | null;
      resolvedUrl?: string | null;
    }>(
      store.db,
      `select event_type as eventType,
              json_extract(payload_json, '$.evidence_hash') as evidenceHash,
              json_extract(payload_json, '$.resolved_ref_type') as resolvedRefType,
              json_extract(payload_json, '$.resolved_normalized_citation') as resolvedNormalizedCitation,
              json_extract(payload_json, '$.resolved_url') as resolvedUrl
       from resolution_events
       where event_type in ('accept_legal_ref', 'reject_legal_ref')
         and json_extract(payload_json, '$.fact_signature') = ?
       order by created_at desc, event_id desc
      limit 1`,
      [hint.factSignature],
    );
    if (!priorDecision?.evidenceHash) {
      reuseOrMarkStaleDeferredLegalReview(store, hint);
      continue;
    }

    if (priorDecision.evidenceHash === hint.evidenceHash) {
      const legalRef = queryOne<{ reviewStatus: string }>(
        store.db,
        "select review_status as reviewStatus from legal_refs where legal_ref_id = ?",
        [hint.legalRefId],
      );
      if (!legalRef) continue;
      if (priorDecision.eventType === "accept_legal_ref") {
        if (legalRef.reviewStatus !== "accepted") {
          reuseAcceptedLegalRefDecision(store, hint.legalRefId, priorDecision);
        }
      } else if (legalRef.reviewStatus !== "rejected") {
        run(
          store.db,
          "update legal_refs set review_status = 'rejected' where legal_ref_id = ?",
          [hint.legalRefId],
        );
      }
      run(
        store.db,
        "update review_items set status = 'resolved', updated_at = ? where subject_id = ? and item_type = 'legal_ref'",
        [nowIso(), hint.legalRefId],
      );
      continue;
    }

    const reviewItem = queryOne<{ reason: string; detailsJson: string }>(
      store.db,
      "select reason, details_json as detailsJson from review_items where subject_id = ? and item_type = 'legal_ref'",
      [hint.legalRefId],
    );
    if (!reviewItem) continue;
    const details = JSON.parse(reviewItem.detailsJson) as Record<string, unknown>;
    const priorDecisionState = priorDecision.eventType === "accept_legal_ref"
      ? "accepted"
      : "rejected";
    details.priorDecisionState = priorDecisionState;
    details.stalePriorDecision = true;
    details.factSignature = hint.factSignature;
    details.evidenceHash = hint.evidenceHash;
    if (priorDecisionState === "accepted") {
      if (priorDecision.resolvedRefType) {
        details.priorResolvedRefType = priorDecision.resolvedRefType;
      }
      if (priorDecision.resolvedNormalizedCitation !== undefined) {
        details.priorResolvedNormalizedCitation = priorDecision.resolvedNormalizedCitation;
      }
      if (priorDecision.resolvedUrl !== undefined) {
        details.priorResolvedUrl = priorDecision.resolvedUrl;
      }
    }
    const staleSuffix = `changed since a prior ${priorDecisionState} decision`;
    const staleReason = reviewItem.reason.includes(staleSuffix)
      ? reviewItem.reason
      : `${reviewItem.reason} (${staleSuffix})`;
    run(
      store.db,
      "update review_items set reason = ?, default_action = ?, details_json = ?, status = 'open', updated_at = ? where subject_id = ? and item_type = 'legal_ref'",
      [
        staleReason,
        priorDecisionState === "accepted" ? "accept" : "reject",
        JSON.stringify(details),
        nowIso(),
        hint.legalRefId,
      ],
    );
  }
}

export async function reuseOrMarkStaleRelationshipDecisions(
  store: WorkbenchStore,
  hints: RelationshipDecisionHint[],
): Promise<void> {
  const priorDecisionsByFactSignature = latestRelationshipReplayDecisionsByFactSignature(
    store,
    hints.map((hint) => hint.factSignature),
  );
  const priorReviewDecisionsByFactSignature =
    latestRelationshipReplayReviewDecisionsByFactSignature(
      store,
      hints.map((hint) => hint.factSignature),
    );
  const candidatesById = relationshipReplayCandidatesById(
    store,
    hints.map((hint) => hint.relationshipCandidateId),
  );
  const reviewItemsByCandidateId = relationshipReplayReviewItemsByCandidateId(
    store,
    hints.map((hint) => hint.relationshipCandidateId),
  );
  let changed = false;
  for (const hint of hints) {
    const priorDecision = priorDecisionsByFactSignature.get(hint.factSignature);
    if (!priorDecision?.evidenceHash) {
      reuseOrMarkStaleDeferredRelationshipReview(
        store,
        hint,
        priorReviewDecisionsByFactSignature.get(hint.factSignature),
        reviewItemsByCandidateId.get(hint.relationshipCandidateId),
      );
      continue;
    }

    if (priorDecision.evidenceHash === hint.evidenceHash) {
      const candidate = candidatesById.get(hint.relationshipCandidateId);
      if (!candidate) continue;
      if (priorDecision.eventType === "accept_relationship_candidate") {
        if (candidate.reviewStatus !== "accepted") {
          const reused = reuseAcceptedRelationshipDecision(
            store,
            hint.relationshipCandidateId,
            priorDecision,
          );
          if (!reused.reused) {
            markRelationshipReplayConflict(
              store,
              hint,
              "accepted",
              priorDecision.resolvedRelationshipType ?? null,
              priorDecision.resolvedFromEntityId ?? null,
              priorDecision.resolvedToEntityId ?? null,
              `prior accepted decision could not be replayed because resolved endpoint ${
                reused.missingEndpointId ?? "is missing"
              } is missing`,
            );
            continue;
          }
        }
      } else if (candidate.reviewStatus !== "rejected") {
        run(
          store.db,
          "update relationship_candidates set review_status = 'rejected' where relationship_candidate_id = ?",
          [hint.relationshipCandidateId],
        );
      }
      run(
        store.db,
        "update review_items set status = 'resolved', updated_at = ? where subject_id = ? and item_type = 'relationship_candidate'",
        [nowIso(), hint.relationshipCandidateId],
      );
      changed = true;
      continue;
    }

    const reviewItem = reviewItemsByCandidateId.get(hint.relationshipCandidateId);
    if (!reviewItem) continue;
    const details = JSON.parse(reviewItem.detailsJson) as Record<string, unknown>;
    const priorDecisionState = priorDecision.eventType === "accept_relationship_candidate"
      ? "accepted"
      : "rejected";
    details.priorDecisionState = priorDecisionState;
    details.stalePriorDecision = true;
    details.factSignature = hint.factSignature;
    details.evidenceHash = hint.evidenceHash;
    if (priorDecisionState === "accepted") {
      if (priorDecision.resolvedRelationshipType) {
        details.priorResolvedRelationshipType = priorDecision.resolvedRelationshipType;
      }
      if (priorDecision.resolvedFromEntityId) {
        details.priorResolvedFromEntityId = priorDecision.resolvedFromEntityId;
      }
      if (priorDecision.resolvedToEntityId) {
        details.priorResolvedToEntityId = priorDecision.resolvedToEntityId;
      }
    }
    const staleSuffix = `changed since a prior ${priorDecisionState} decision`;
    const staleReason = reviewItem.reason.includes(staleSuffix)
      ? reviewItem.reason
      : `${reviewItem.reason} (${staleSuffix})`;
    run(
      store.db,
      `update review_items
       set reason = ?, default_action = ?, details_json = ?, status = 'open', updated_at = ?
       where subject_id = ? and item_type = 'relationship_candidate'`,
      [
        staleReason,
        priorDecisionState === "accepted" ? "accept" : "reject",
        JSON.stringify(details),
        nowIso(),
        hint.relationshipCandidateId,
      ],
    );
  }
  if (changed) {
    reconcileRelationshipCandidates(store);
  }
}

function markEntityReplayConflict(
  store: WorkbenchStore,
  hint: EntityDecisionHint,
  priorDecisionState: "accepted" | "merged",
  resolvedEntityId: string,
  conflictReason: string,
): void {
  const reviewItem = queryOne<{
    reason: string;
    defaultAction: string;
    detailsJson: string;
  }>(
    store.db,
    `select reason,
            default_action as defaultAction,
            details_json as detailsJson
     from review_items
     where subject_id = ? and item_type = 'entity_candidate'`,
    [hint.candidateId],
  );
  if (!reviewItem) return;
  const details = JSON.parse(reviewItem.detailsJson) as Record<string, unknown>;
  details.priorDecisionState = priorDecisionState;
  details.priorResolvedEntityId = resolvedEntityId;
  details.factSignature = hint.factSignature;
  details.evidenceHash = hint.evidenceHash;
  details.replayConflict = true;
  const priorResolvedFields = latestResolvedEntityFields(store, resolvedEntityId);
  if (priorResolvedFields) {
    details.priorResolvedFields = priorResolvedFields;
  }
  const reason = reviewItem.reason.includes(conflictReason)
    ? reviewItem.reason
    : `${reviewItem.reason} (${conflictReason})`;
  run(
    store.db,
    `update review_items
     set reason = ?, default_action = ?, details_json = ?, status = 'open', updated_at = ?
     where subject_id = ? and item_type = 'entity_candidate'`,
    [
      reason,
      reviewItem.defaultAction,
      JSON.stringify(details),
      nowIso(),
      hint.candidateId,
    ],
  );
}

function reuseOrMarkStaleDeferredEntityReview(
  store: WorkbenchStore,
  hint: EntityDecisionHint,
  priorReviewDecision?: EntityReplayReviewDecisionRow,
  reviewItem?: EntityReplayReviewItemRow,
): void {
  if (!priorReviewDecision?.evidenceHash || priorReviewDecision.eventType !== "defer_review_item") {
    return;
  }

  if (!reviewItem || reviewItem.status === "resolved") return;
  if (priorReviewDecision.reviewItemId !== reviewItem.reviewItemId) {
    run(
      store.db,
      "update review_items set status = 'resolved', updated_at = ? where review_item_id = ?",
      [nowIso(), priorReviewDecision.reviewItemId],
    );
  }

  if (priorReviewDecision.evidenceHash === hint.evidenceHash) {
    run(
      store.db,
      `update review_items
       set status = 'deferred', updated_at = ?
       where subject_id = ? and item_type = 'entity_candidate'`,
      [nowIso(), hint.candidateId],
    );
    return;
  }

  const details = JSON.parse(reviewItem.detailsJson) as Record<string, unknown>;
  details.priorDecisionState = "deferred";
  details.stalePriorDecision = true;
  details.factSignature = hint.factSignature;
  details.evidenceHash = hint.evidenceHash;
  const staleSuffix = "changed since a prior deferred decision";
  const staleReason = reviewItem.reason.includes(staleSuffix)
    ? reviewItem.reason
    : `${reviewItem.reason} (${staleSuffix})`;
  run(
    store.db,
    `update review_items
     set reason = ?, details_json = ?, status = 'open', updated_at = ?
     where subject_id = ? and item_type = 'entity_candidate'`,
    [
      staleReason,
      JSON.stringify(details),
      nowIso(),
      hint.candidateId,
    ],
  );
}

function latestEntityReplayDecisionsByFactSignature(
  store: WorkbenchStore,
  factSignatures: string[],
): Map<string, EntityReplayDecisionRow> {
  return new Map(
    queryRowsByValues<EntityReplayDecisionRow>(
      store,
      factSignatures,
      (placeholders) => `
        with ranked as (
          select json_extract(payload_json, '$.fact_signature') as factSignature,
                 event_type as eventType,
                 json_extract(payload_json, '$.evidence_hash') as evidenceHash,
                 json_extract(payload_json, '$.resolved_entity_id') as resolvedEntityId,
                 row_number() over (
                   partition by json_extract(payload_json, '$.fact_signature')
                   order by created_at desc, event_id desc
                 ) as rowNumber
          from resolution_events
          where event_type in ('accept_entity_candidate', 'reject_entity_candidate')
            and json_extract(payload_json, '$.fact_signature') in (${placeholders})
        )
        select factSignature, eventType, evidenceHash, resolvedEntityId
        from ranked
        where rowNumber = 1
      `,
    ).map((row) => [row.factSignature, row]),
  );
}

function latestEntityMergeReplayDecisionsByFactSignature(
  store: WorkbenchStore,
  factSignatures: string[],
): Map<string, EntityReplayDecisionRow> {
  return new Map(
    queryRowsByValues<EntityReplayDecisionRow>(
      store,
      factSignatures,
      (placeholders) => `
        with ranked as (
          select json_extract(json_each.value, '$.fact_signature') as factSignature,
                 resolution_events.event_type as eventType,
                 json_extract(json_each.value, '$.evidence_hash') as evidenceHash,
                 json_extract(json_each.value, '$.resolved_entity_id') as resolvedEntityId,
                 row_number() over (
                   partition by json_extract(json_each.value, '$.fact_signature')
                   order by resolution_events.created_at desc, resolution_events.event_id desc
                 ) as rowNumber
          from resolution_events,
               json_each(resolution_events.payload_json, '$.candidate_replays')
          where resolution_events.event_type = 'merge_entity_candidates'
            and json_extract(json_each.value, '$.fact_signature') in (${placeholders})
        )
        select factSignature, eventType, evidenceHash, resolvedEntityId
        from ranked
        where rowNumber = 1
      `,
    ).map((row) => [row.factSignature, row]),
  );
}

function latestEntityReplayReviewDecisionsByFactSignature(
  store: WorkbenchStore,
  factSignatures: string[],
): Map<string, EntityReplayReviewDecisionRow> {
  return new Map(
    queryRowsByValues<EntityReplayReviewDecisionRow>(
      store,
      factSignatures,
      (placeholders) => `
        with ranked as (
          select json_extract(payload_json, '$.fact_signature') as factSignature,
                 event_type as eventType,
                 subject_id as reviewItemId,
                 json_extract(payload_json, '$.evidence_hash') as evidenceHash,
                 row_number() over (
                   partition by json_extract(payload_json, '$.fact_signature')
                   order by created_at desc, event_id desc
                 ) as rowNumber
          from resolution_events
          where event_type in ('defer_review_item', 'reopen_review_item')
            and json_extract(payload_json, '$.fact_signature') in (${placeholders})
        )
        select factSignature, eventType, reviewItemId, evidenceHash
        from ranked
        where rowNumber = 1
      `,
    ).map((row) => [row.factSignature, row]),
  );
}

function entityReplayCandidatesById(
  store: WorkbenchStore,
  candidateIds: string[],
): Map<string, EntityReplayCandidateRow> {
  return new Map(
    queryRowsByValues<EntityReplayCandidateRow>(
      store,
      candidateIds,
      (placeholders) => `
        select candidate_id as candidateId,
               review_status as reviewStatus
        from entity_candidates
        where candidate_id in (${placeholders})
      `,
    ).map((row) => [row.candidateId, row]),
  );
}

function entityReplayReviewItemsByCandidateId(
  store: WorkbenchStore,
  candidateIds: string[],
): Map<string, EntityReplayReviewItemRow> {
  return new Map(
    queryRowsByValues<EntityReplayReviewItemRow>(
      store,
      candidateIds,
      (placeholders) => `
        select subject_id as candidateId,
               review_item_id as reviewItemId,
               reason,
               default_action as defaultAction,
               details_json as detailsJson,
               status
        from review_items
        where item_type = 'entity_candidate'
          and subject_id in (${placeholders})
      `,
    ).map((row) => [row.candidateId, row]),
  );
}

function reuseOrMarkStaleDeferredLegalReview(
  store: WorkbenchStore,
  hint: LegalRefDecisionHint,
): void {
  const priorReviewDecision = queryOne<{
    eventType: string;
    reviewItemId: string;
    evidenceHash?: string | null;
  }>(
    store.db,
    `select event_type as eventType,
            subject_id as reviewItemId,
            json_extract(payload_json, '$.evidence_hash') as evidenceHash
     from resolution_events
     where event_type in ('defer_review_item', 'reopen_review_item')
       and json_extract(payload_json, '$.fact_signature') = ?
     order by created_at desc, event_id desc
     limit 1`,
    [hint.factSignature],
  );
  if (!priorReviewDecision?.evidenceHash || priorReviewDecision.eventType !== "defer_review_item") {
    return;
  }

  const reviewItem = queryOne<{
    reviewItemId: string;
    reason: string;
    detailsJson: string;
    status: string;
  }>(
    store.db,
    `select review_item_id as reviewItemId,
            reason,
            details_json as detailsJson,
            status
     from review_items
     where subject_id = ? and item_type = 'legal_ref'`,
    [hint.legalRefId],
  );
  if (!reviewItem || reviewItem.status === "resolved") return;
  if (priorReviewDecision.reviewItemId !== reviewItem.reviewItemId) {
    run(
      store.db,
      "update review_items set status = 'resolved', updated_at = ? where review_item_id = ?",
      [nowIso(), priorReviewDecision.reviewItemId],
    );
  }

  if (priorReviewDecision.evidenceHash === hint.evidenceHash) {
    run(
      store.db,
      `update review_items
       set status = 'deferred', updated_at = ?
       where subject_id = ? and item_type = 'legal_ref'`,
      [nowIso(), hint.legalRefId],
    );
    return;
  }

  const details = JSON.parse(reviewItem.detailsJson) as Record<string, unknown>;
  details.priorDecisionState = "deferred";
  details.stalePriorDecision = true;
  details.factSignature = hint.factSignature;
  details.evidenceHash = hint.evidenceHash;
  const staleSuffix = "changed since a prior deferred decision";
  const staleReason = reviewItem.reason.includes(staleSuffix)
    ? reviewItem.reason
    : `${reviewItem.reason} (${staleSuffix})`;
  run(
    store.db,
    `update review_items
     set reason = ?, details_json = ?, status = 'open', updated_at = ?
     where subject_id = ? and item_type = 'legal_ref'`,
    [
      staleReason,
      JSON.stringify(details),
      nowIso(),
      hint.legalRefId,
    ],
  );
}

function markRelationshipReplayConflict(
  store: WorkbenchStore,
  hint: RelationshipDecisionHint,
  priorDecisionState: "accepted",
  resolvedRelationshipType: string | null,
  resolvedFromEntityId: string | null,
  resolvedToEntityId: string | null,
  conflictReason: string,
): void {
  const reviewItem = queryOne<{
    reviewItemId: string;
    reason: string;
    defaultAction: string;
    detailsJson: string;
  }>(
    store.db,
    `select review_item_id as reviewItemId,
            reason,
            default_action as defaultAction,
            details_json as detailsJson
     from review_items
     where subject_id = ? and item_type = 'relationship_candidate'`,
    [hint.relationshipCandidateId],
  );
  const fallbackReviewItem = reviewItem ??
    relationshipReplayDraft(store, hint.relationshipCandidateId);
  if (!fallbackReviewItem) return;
  const details = JSON.parse(fallbackReviewItem.detailsJson) as Record<string, unknown>;
  details.priorDecisionState = priorDecisionState;
  details.factSignature = hint.factSignature;
  details.evidenceHash = hint.evidenceHash;
  details.replayConflict = true;
  if (resolvedRelationshipType) details.priorResolvedRelationshipType = resolvedRelationshipType;
  if (resolvedFromEntityId) details.priorResolvedFromEntityId = resolvedFromEntityId;
  if (resolvedToEntityId) details.priorResolvedToEntityId = resolvedToEntityId;
  const reason = fallbackReviewItem.reason.includes(conflictReason)
    ? fallbackReviewItem.reason
    : `${fallbackReviewItem.reason} (${conflictReason})`;
  run(
    store.db,
    `insert into review_items(
       review_item_id, item_type, subject_id, reason, default_action, status, details_json, created_at, updated_at
     ) values(
       ?, 'relationship_candidate', ?, ?, ?, 'open', ?, ?, ?
     )
     on conflict(review_item_id) do update set
       reason = excluded.reason,
       default_action = excluded.default_action,
       status = 'open',
       details_json = excluded.details_json,
       updated_at = excluded.updated_at`,
    [
      fallbackReviewItem.reviewItemId,
      hint.relationshipCandidateId,
      reason,
      fallbackReviewItem.defaultAction,
      JSON.stringify(details),
      nowIso(),
      nowIso(),
    ],
  );
}

function relationshipReplayDraft(
  store: WorkbenchStore,
  relationshipCandidateId: string,
): {
  reviewItemId: string;
  reason: string;
  defaultAction: string;
  detailsJson: string;
} | undefined {
  const candidate = queryOne<{
    sourceId: string;
    fromEntityRef: string;
    toEntityRef: string;
    relationshipType: string;
    rawValue?: string | null;
    needsReview: number;
  }>(
    store.db,
    `select source_items.source_id as sourceId,
            relationship_candidates.from_entity_ref as fromEntityRef,
            relationship_candidates.to_entity_ref as toEntityRef,
            relationship_candidates.relationship_type as relationshipType,
            relationship_candidates.raw_value as rawValue,
            relationship_candidates.needs_review as needsReview
     from relationship_candidates
     join source_items on source_items.source_item_id = relationship_candidates.source_item_id
     where relationship_candidates.relationship_candidate_id = ?`,
    [relationshipCandidateId],
  );
  if (!candidate) return undefined;
  const draft = buildRelationshipReviewDraft({
    relationshipCandidateId,
    sourceId: candidate.sourceId,
    fromEntityRef: candidate.fromEntityRef,
    toEntityRef: candidate.toEntityRef,
    relationshipType: candidate.relationshipType,
    rawValue: candidate.rawValue ?? null,
    needsReview: candidate.needsReview,
  });
  return {
    reviewItemId: draft.reviewItemId,
    reason: draft.reason,
    defaultAction: draft.defaultAction,
    detailsJson: JSON.stringify(draft.details),
  };
}

function reuseOrMarkStaleDeferredRelationshipReview(
  store: WorkbenchStore,
  hint: RelationshipDecisionHint,
  priorReviewDecision?: RelationshipReplayReviewDecisionRow,
  reviewItem?: RelationshipReplayReviewItemRow,
): void {
  if (!priorReviewDecision?.evidenceHash || priorReviewDecision.eventType !== "defer_review_item") {
    return;
  }
  if (!reviewItem || reviewItem.status === "resolved") return;
  if (priorReviewDecision.reviewItemId !== reviewItem.reviewItemId) {
    run(
      store.db,
      "update review_items set status = 'resolved', updated_at = ? where review_item_id = ?",
      [nowIso(), priorReviewDecision.reviewItemId],
    );
  }

  if (priorReviewDecision.evidenceHash === hint.evidenceHash) {
    run(
      store.db,
      `update review_items
       set status = 'deferred', updated_at = ?
       where subject_id = ? and item_type = 'relationship_candidate'`,
      [nowIso(), hint.relationshipCandidateId],
    );
    return;
  }

  const details = JSON.parse(reviewItem.detailsJson) as Record<string, unknown>;
  details.priorDecisionState = "deferred";
  details.stalePriorDecision = true;
  details.factSignature = hint.factSignature;
  details.evidenceHash = hint.evidenceHash;
  const staleSuffix = "changed since a prior deferred decision";
  const staleReason = reviewItem.reason.includes(staleSuffix)
    ? reviewItem.reason
    : `${reviewItem.reason} (${staleSuffix})`;
  run(
    store.db,
    `update review_items
     set reason = ?, details_json = ?, status = 'open', updated_at = ?
     where subject_id = ? and item_type = 'relationship_candidate'`,
    [
      staleReason,
      JSON.stringify(details),
      nowIso(),
      hint.relationshipCandidateId,
    ],
  );
}

function latestRelationshipReplayDecisionsByFactSignature(
  store: WorkbenchStore,
  factSignatures: string[],
): Map<string, RelationshipReplayDecisionRow> {
  return new Map(
    queryRowsByValues<RelationshipReplayDecisionRow>(
      store,
      factSignatures,
      (placeholders) => `
        with ranked as (
          select json_extract(payload_json, '$.fact_signature') as factSignature,
                 event_type as eventType,
                 event_id as eventId,
                 json_extract(payload_json, '$.evidence_hash') as evidenceHash,
                 json_extract(payload_json, '$.resolved_relationship_type') as resolvedRelationshipType,
                 json_extract(payload_json, '$.resolved_from_entity_id') as resolvedFromEntityId,
                 json_extract(payload_json, '$.resolved_to_entity_id') as resolvedToEntityId,
                 row_number() over (
                   partition by json_extract(payload_json, '$.fact_signature')
                   order by created_at desc, event_id desc
                 ) as rowNumber
          from resolution_events
          where event_type in ('accept_relationship_candidate', 'reject_relationship_candidate')
            and json_extract(payload_json, '$.fact_signature') in (${placeholders})
        )
        select factSignature,
               eventType,
               eventId,
               evidenceHash,
               resolvedRelationshipType,
               resolvedFromEntityId,
               resolvedToEntityId
        from ranked
        where rowNumber = 1
      `,
    ).map((row) => [row.factSignature, row]),
  );
}

function latestRelationshipReplayReviewDecisionsByFactSignature(
  store: WorkbenchStore,
  factSignatures: string[],
): Map<string, RelationshipReplayReviewDecisionRow> {
  return new Map(
    queryRowsByValues<RelationshipReplayReviewDecisionRow>(
      store,
      factSignatures,
      (placeholders) => `
        with ranked as (
          select json_extract(payload_json, '$.fact_signature') as factSignature,
                 event_type as eventType,
                 subject_id as reviewItemId,
                 json_extract(payload_json, '$.evidence_hash') as evidenceHash,
                 row_number() over (
                   partition by json_extract(payload_json, '$.fact_signature')
                   order by created_at desc, event_id desc
                 ) as rowNumber
          from resolution_events
          where event_type in ('defer_review_item', 'reopen_review_item')
            and json_extract(payload_json, '$.fact_signature') in (${placeholders})
        )
        select factSignature, eventType, reviewItemId, evidenceHash
        from ranked
        where rowNumber = 1
      `,
    ).map((row) => [row.factSignature, row]),
  );
}

function relationshipReplayCandidatesById(
  store: WorkbenchStore,
  relationshipCandidateIds: string[],
): Map<string, RelationshipReplayCandidateRow> {
  return new Map(
    queryRowsByValues<RelationshipReplayCandidateRow>(
      store,
      relationshipCandidateIds,
      (placeholders) => `
        select relationship_candidate_id as relationshipCandidateId,
               review_status as reviewStatus
        from relationship_candidates
        where relationship_candidate_id in (${placeholders})
      `,
    ).map((row) => [row.relationshipCandidateId, row]),
  );
}

function relationshipReplayReviewItemsByCandidateId(
  store: WorkbenchStore,
  relationshipCandidateIds: string[],
): Map<string, RelationshipReplayReviewItemRow> {
  return new Map(
    queryRowsByValues<RelationshipReplayReviewItemRow>(
      store,
      relationshipCandidateIds,
      (placeholders) => `
        select subject_id as relationshipCandidateId,
               review_item_id as reviewItemId,
               reason,
               details_json as detailsJson,
               status
        from review_items
        where item_type = 'relationship_candidate'
          and subject_id in (${placeholders})
      `,
    ).map((row) => [row.relationshipCandidateId, row]),
  );
}

function queryRowsByValues<T>(
  store: WorkbenchStore,
  values: string[],
  sqlForPlaceholders: (placeholders: string) => string,
): T[] {
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length === 0) return [];
  const rows: T[] = [];
  for (const chunk of chunks(uniqueValues, 500)) {
    rows.push(
      ...queryAll<T>(
        store.db,
        sqlForPlaceholders(chunk.map(() => "?").join(", ")),
        chunk,
      ),
    );
  }
  return rows;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function mergeAcceptedEntityCandidate(
  store: WorkbenchStore,
  candidateId: string,
  entityId: string,
): boolean {
  const entity = queryOne<{ mergedCandidateIds: string }>(
    store.db,
    "select merged_candidate_ids as mergedCandidateIds from canonical_entities where entity_id = ?",
    [entityId],
  );
  if (!entity) return false;
  const merged = JSON.parse(entity.mergedCandidateIds) as string[];
  if (!merged.includes(candidateId)) {
    merged.push(candidateId);
    run(
      store.db,
      "update canonical_entities set merged_candidate_ids = ?, updated_at = ? where entity_id = ?",
      [JSON.stringify(merged), nowIso(), entityId],
    );
  }
  run(store.db, "update entity_candidates set review_status = 'accepted' where candidate_id = ?", [
    candidateId,
  ]);
  refreshCanonicalEntityFieldsFromAcceptedCandidates(store, entityId);
  return true;
}

function latestResolvedEntityFields(
  store: WorkbenchStore,
  entityId: string,
): Record<string, unknown> | undefined {
  const row = queryOne<{ payloadJson: string }>(
    store.db,
    `select payload_json as payloadJson
     from resolution_events
     where event_type = 'set_entity_fields'
       and subject_id = ?
     order by created_at desc, event_id desc
     limit 1`,
    [entityId],
  );
  if (!row) return undefined;
  const payload = JSON.parse(row.payloadJson) as { fields?: Record<string, unknown> };
  return payload.fields && Object.keys(payload.fields).length > 0 ? payload.fields : undefined;
}

function entityFactSignature(
  sourceId: string,
  candidate: Pick<EntityCandidateInput, "sourceItemKey" | "proposedEntityId" | "name" | "kind">,
): string {
  return [
    "entity_candidate",
    sourceId,
    candidate.sourceItemKey,
    candidate.proposedEntityId,
    slugify(normalizeName(candidate.name)),
    candidate.kind,
  ].join(":");
}

async function entityEvidenceHash(
  candidate: Pick<EntityCandidateInput, "evidence">,
): Promise<string> {
  const canonicalEvidence = candidate.evidence
    .map((row) => ({
      fieldPath: row.fieldPath,
      observedValue: row.observedValue,
    }))
    .sort((left, right) =>
      left.fieldPath.localeCompare(right.fieldPath) ||
      left.observedValue.localeCompare(right.observedValue)
    );
  return `sha256:${await sha256Hex(JSON.stringify(canonicalEvidence))}`;
}

function legalRefFactSignature(
  sourceId: string,
  legalRef: Pick<LegalRefInput, "sourceItemKey" | "refType" | "citationText">,
): string {
  return [
    "legal_ref",
    sourceId,
    legalRef.sourceItemKey,
    legalRef.refType,
    slugify(normalizeName(legalRef.citationText)),
  ].join(":");
}

async function legalRefEvidenceHash(
  legalRef: Pick<
    LegalRefInput,
    "evidence" | "refType" | "citationText" | "normalizedCitation" | "url"
  >,
): Promise<string> {
  const canonicalEvidence = {
    refType: legalRef.refType,
    citationText: legalRef.citationText,
    normalizedCitation: legalRef.normalizedCitation ?? null,
    url: legalRef.url ?? null,
    evidence: legalRef.evidence
      .map((row) => ({
        fieldPath: row.fieldPath,
        observedValue: row.observedValue,
      }))
      .sort((left, right) =>
        left.fieldPath.localeCompare(right.fieldPath) ||
        left.observedValue.localeCompare(right.observedValue)
      ),
  };
  return `sha256:${await sha256Hex(JSON.stringify(canonicalEvidence))}`;
}

function relationshipFactSignature(
  sourceId: string,
  candidate: Pick<
    RelationshipCandidateInput,
    "sourceItemKey" | "fromEntityRef" | "toEntityRef" | "relationshipType"
  >,
): string {
  return [
    "relationship_candidate",
    sourceId,
    candidate.sourceItemKey,
    candidate.fromEntityRef,
    candidate.relationshipType,
    candidate.toEntityRef,
  ].join(":");
}

async function relationshipEvidenceHash(
  candidate: Pick<RelationshipCandidateInput, "rawValue" | "needsReview" | "evidence">,
): Promise<string> {
  const canonicalEvidence = {
    rawValue: candidate.rawValue ?? null,
    needsReview: candidate.needsReview === true,
    evidence: candidate.evidence
      .map((row: { fieldPath: string; observedValue: string }) => ({
        fieldPath: row.fieldPath,
        observedValue: row.observedValue,
      }))
      .sort((left: { fieldPath: string; observedValue: string }, right: {
        fieldPath: string;
        observedValue: string;
      }) =>
        left.fieldPath.localeCompare(right.fieldPath) ||
        left.observedValue.localeCompare(right.observedValue)
      ),
  };
  return `sha256:${await sha256Hex(JSON.stringify(canonicalEvidence))}`;
}

function reuseAcceptedLegalRefDecision(
  store: WorkbenchStore,
  legalRefId: string,
  priorDecision: {
    resolvedRefType?: string | null;
    resolvedNormalizedCitation?: string | null;
    resolvedUrl?: string | null;
  },
): void {
  run(
    store.db,
    "update legal_refs set ref_type = coalesce(?, ref_type), normalized_citation = ?, url = coalesce(?, url), review_status = 'accepted' where legal_ref_id = ?",
    [
      priorDecision.resolvedRefType ?? null,
      priorDecision.resolvedNormalizedCitation ?? null,
      priorDecision.resolvedUrl ?? null,
      legalRefId,
    ],
  );
}

function reuseAcceptedRelationshipDecision(
  store: WorkbenchStore,
  relationshipCandidateId: string,
  priorDecision: {
    eventId: string;
    resolvedRelationshipType?: string | null;
    resolvedFromEntityId?: string | null;
    resolvedToEntityId?: string | null;
  },
): { reused: boolean; missingEndpointId?: string } {
  const relationshipType = priorDecision.resolvedRelationshipType;
  const fromEntityId = priorDecision.resolvedFromEntityId;
  const toEntityId = priorDecision.resolvedToEntityId;
  if (!relationshipType || !fromEntityId || !toEntityId) return { reused: false };
  if (endpointStatus(store, fromEntityId).state !== "accepted") {
    return { reused: false, missingEndpointId: fromEntityId };
  }
  if (endpointStatus(store, toEntityId).state !== "accepted") {
    return { reused: false, missingEndpointId: toEntityId };
  }
  const relationshipId = `${fromEntityId}:${relationshipType}:${toEntityId}`;
  const existing = queryOne<{ relationshipId: string }>(
    store.db,
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = ?",
    [relationshipId],
  );
  if (isLegalAuthorityRelationship(relationshipType, toEntityId)) {
    run(
      store.db,
      "delete from relationship_legal_refs where relationship_id in (?, ?)",
      [relationshipCandidateId, relationshipId],
    );
  } else if (!existing) {
    run(
      store.db,
      `insert into canonical_relationships(
         relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at
       ) values(?, ?, ?, ?, 'accepted', ?, ?)`,
      [relationshipId, fromEntityId, relationshipType, toEntityId, priorDecision.eventId, nowIso()],
    );
  }
  run(
    store.db,
    "update relationship_candidates set review_status = 'accepted' where relationship_candidate_id = ?",
    [relationshipCandidateId],
  );
  return { reused: true };
}
