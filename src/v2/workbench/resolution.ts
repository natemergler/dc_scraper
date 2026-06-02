import { ensureDir } from "@std/fs";
import { join, relative } from "@std/path";
import {
  type CandidateStatus,
  compactDatePart,
  normalizeName,
  nowIso,
  parseLegalReference,
  type ResolutionEventInput,
  type ReviewStatus,
  sha256Hex,
  slugify,
} from "../domain.ts";
import { queryOne, run, withTransaction } from "./db.ts";
import { reconcileRelationshipCandidates } from "./reconciliation.ts";
import type { WorkbenchStore } from "./store.ts";

interface ResolutionRecord {
  event: ResolutionEventInput;
  resolutionFile: string;
  sequenceNumber: number;
}

export async function appendResolutionEvent(
  store: WorkbenchStore,
  event: ResolutionEventInput,
  resolutionsDir: string,
): Promise<{ filePath: string; sequenceNumber: number }> {
  const enrichedEvent = await enrichResolutionEvent(store, event);
  const dayDir = join(resolutionsDir, compactDatePart());
  const filePath = join(dayDir, "001-auto-review.jsonl");
  let sequenceNumber = 1;
  try {
    const existing = await Deno.readTextFile(filePath);
    sequenceNumber = existing.split("\n").filter(Boolean).length + 1;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const line = JSON.stringify({
    event_type: enrichedEvent.eventType,
    subject_id: enrichedEvent.subjectId,
    payload: enrichedEvent.payload,
  });
  applyResolutionEvent(store, enrichedEvent, relative(resolutionsDir, filePath), sequenceNumber);
  await ensureDir(dayDir);
  await Deno.writeTextFile(filePath, `${line}\n`, { append: true, create: true });
  return { filePath, sequenceNumber };
}

async function enrichResolutionEvent(
  store: WorkbenchStore,
  event: ResolutionEventInput,
): Promise<ResolutionEventInput> {
  if (event.eventType === "defer_review_item" || event.eventType === "reopen_review_item") {
    return await enrichReviewStatusResolutionEvent(store, event);
  }
  if (event.eventType === "merge_entity_candidates") {
    return await enrichMergeEntityResolutionEvent(store, event);
  }
  if (
    event.eventType !== "accept_entity_candidate" &&
    event.eventType !== "reject_entity_candidate" &&
    event.eventType !== "accept_relationship_candidate" &&
    event.eventType !== "reject_relationship_candidate" &&
    event.eventType !== "accept_legal_ref" &&
    event.eventType !== "reject_legal_ref"
  ) {
    return event;
  }
  if (
    event.eventType === "accept_relationship_candidate" ||
    event.eventType === "reject_relationship_candidate"
  ) {
    return await enrichRelationshipResolutionEvent(store, event);
  }
  if (event.eventType === "accept_legal_ref" || event.eventType === "reject_legal_ref") {
    return await enrichLegalRefResolutionEvent(store, event);
  }
  const metadata = await entityResolutionMetadata(store, event.subjectId);
  if (!metadata) return event;
  return {
    ...event,
    payload: {
      ...event.payload,
      fact_signature: event.payload.fact_signature ?? metadata.factSignature,
      evidence_hash: event.payload.evidence_hash ?? metadata.evidenceHash,
      ...(event.eventType === "accept_entity_candidate"
        ? {
          resolved_entity_id: event.payload.resolved_entity_id ?? event.payload.entityId ??
            metadata.proposedEntityId,
        }
        : {}),
    },
  };
}

async function enrichMergeEntityResolutionEvent(
  store: WorkbenchStore,
  event: ResolutionEventInput,
): Promise<ResolutionEventInput> {
  const candidateIds = Array.isArray(event.payload.candidateIds)
    ? event.payload.candidateIds.filter((candidateId): candidateId is string =>
      typeof candidateId === "string"
    )
    : [];
  const resolvedEntityId = typeof event.payload.entityId === "string"
    ? event.payload.entityId
    : null;
  const candidateReplays = [];
  for (const candidateId of candidateIds) {
    const metadata = await entityResolutionMetadata(store, candidateId);
    if (!metadata) continue;
    candidateReplays.push({
      candidate_id: candidateId,
      fact_signature: metadata.factSignature,
      evidence_hash: metadata.evidenceHash,
      resolved_entity_id: resolvedEntityId ?? metadata.proposedEntityId,
    });
  }
  if (candidateReplays.length === 0) return event;
  return {
    ...event,
    payload: {
      ...event.payload,
      candidate_replays: event.payload.candidate_replays ?? candidateReplays,
    },
  };
}

async function enrichReviewStatusResolutionEvent(
  store: WorkbenchStore,
  event: ResolutionEventInput,
): Promise<ResolutionEventInput> {
  const reviewItem = queryOne<{
    itemType: string;
    subjectId: string;
  }>(
    store.db,
    `select item_type as itemType,
            subject_id as subjectId
     from review_items
     where review_item_id = ?`,
    [event.subjectId],
  );
  if (!reviewItem) return event;
  const metadata = await reviewStatusResolutionMetadata(
    store,
    reviewItem.itemType,
    reviewItem.subjectId,
  );
  if (!metadata) return event;
  return {
    ...event,
    payload: {
      ...event.payload,
      review_item_type: event.payload.review_item_type ?? reviewItem.itemType,
      review_subject_id: event.payload.review_subject_id ?? reviewItem.subjectId,
      fact_signature: event.payload.fact_signature ?? metadata.factSignature,
      evidence_hash: event.payload.evidence_hash ?? metadata.evidenceHash,
    },
  };
}

async function reviewStatusResolutionMetadata(
  store: WorkbenchStore,
  itemType: string,
  subjectId: string,
): Promise<{ factSignature: string; evidenceHash: string } | undefined> {
  switch (itemType) {
    case "entity_candidate":
      return await entityResolutionMetadata(store, subjectId);
    case "relationship_candidate":
      return await relationshipResolutionMetadata(store, subjectId);
    case "legal_ref":
      return await legalRefResolutionMetadata(store, subjectId);
    default:
      return undefined;
  }
}

async function enrichRelationshipResolutionEvent(
  store: WorkbenchStore,
  event: ResolutionEventInput,
): Promise<ResolutionEventInput> {
  const metadata = await relationshipResolutionMetadata(store, event.subjectId);
  if (!metadata) return event;
  return {
    ...event,
    payload: {
      ...event.payload,
      fact_signature: event.payload.fact_signature ?? metadata.factSignature,
      evidence_hash: event.payload.evidence_hash ?? metadata.evidenceHash,
      ...(event.eventType === "accept_relationship_candidate"
        ? {
          resolved_relationship_type: event.payload.resolved_relationship_type ??
            event.payload.relationshipType ??
            metadata.relationshipType,
          resolved_from_entity_id: event.payload.resolved_from_entity_id ??
            event.payload.fromEntityId ??
            metadata.fromEntityRef,
          resolved_to_entity_id: event.payload.resolved_to_entity_id ?? event.payload.toEntityId ??
            metadata.toEntityRef,
        }
        : {}),
    },
  };
}

async function entityResolutionMetadata(
  store: WorkbenchStore,
  candidateId: string,
): Promise<
  {
    factSignature: string;
    evidenceHash: string;
    proposedEntityId: string;
  } | undefined
> {
  const candidate = queryOne<{
    sourceId: string;
    itemKey: string;
    proposedEntityId: string;
    name: string;
    kind: string;
  }>(
    store.db,
    `select source_items.source_id as sourceId,
            source_items.item_key as itemKey,
            entity_candidates.proposed_entity_id as proposedEntityId,
            entity_candidates.name,
            entity_candidates.kind
     from entity_candidates
     join source_items on source_items.source_item_id = entity_candidates.source_item_id
     where entity_candidates.candidate_id = ?`,
    [candidateId],
  );
  if (!candidate) return undefined;
  const evidenceRows = store.db.prepare(
    `select field_path as fieldPath,
            observed_value as observedValue
     from entity_candidate_evidence
     where candidate_id = ?
     order by field_path, observed_value`,
  ).all(candidateId) as Array<{
    fieldPath: string;
    observedValue: string;
  }>;
  const factSignature = [
    "entity_candidate",
    candidate.sourceId,
    candidate.itemKey,
    candidate.proposedEntityId,
    slugify(normalizeName(candidate.name)),
    candidate.kind,
  ].join(":");
  const evidenceHash = `sha256:${await sha256Hex(
    JSON.stringify(evidenceRows.map((row) => ({
      fieldPath: row.fieldPath,
      observedValue: row.observedValue,
    }))),
  )}`;
  return {
    factSignature,
    evidenceHash,
    proposedEntityId: candidate.proposedEntityId,
  };
}

async function relationshipResolutionMetadata(
  store: WorkbenchStore,
  relationshipCandidateId: string,
): Promise<
  {
    factSignature: string;
    evidenceHash: string;
    relationshipType: string;
    fromEntityRef: string;
    toEntityRef: string;
  } | undefined
> {
  const candidate = queryOne<{
    sourceId: string;
    itemKey: string;
    fromEntityRef: string;
    toEntityRef: string;
    relationshipType: string;
    rawValue?: string | null;
    needsReview: number;
  }>(
    store.db,
    `select source_items.source_id as sourceId,
            source_items.item_key as itemKey,
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
  const evidenceRows = store.db.prepare(
    `select field_path as fieldPath,
            observed_value as observedValue
     from relationship_candidate_evidence
     where relationship_candidate_id = ?
     order by field_path, observed_value`,
  ).all(relationshipCandidateId) as Array<{
    fieldPath: string;
    observedValue: string;
  }>;
  const factSignature = [
    "relationship_candidate",
    candidate.sourceId,
    candidate.itemKey,
    candidate.fromEntityRef,
    candidate.relationshipType,
    candidate.toEntityRef,
  ].join(":");
  const evidenceHash = `sha256:${await sha256Hex(
    JSON.stringify({
      rawValue: candidate.rawValue ?? null,
      needsReview: candidate.needsReview === 1,
      evidence: evidenceRows.map((row) => ({
        fieldPath: row.fieldPath,
        observedValue: row.observedValue,
      })),
    }),
  )}`;
  return {
    factSignature,
    evidenceHash,
    relationshipType: candidate.relationshipType,
    fromEntityRef: candidate.fromEntityRef,
    toEntityRef: candidate.toEntityRef,
  };
}

async function legalRefResolutionMetadata(
  store: WorkbenchStore,
  legalRefId: string,
): Promise<
  {
    factSignature: string;
    evidenceHash: string;
    resolvedRefType: string;
    resolvedNormalizedCitation: string | null;
    url: string | null;
  } | undefined
> {
  const legalRef = queryOne<{
    sourceId: string;
    itemKey: string;
    refType: string;
    citationText: string;
    normalizedCitation?: string | null;
    url?: string | null;
  }>(
    store.db,
    `select source_items.source_id as sourceId,
            source_items.item_key as itemKey,
            legal_refs.ref_type as refType,
            legal_refs.citation_text as citationText,
            legal_refs.normalized_citation as normalizedCitation,
            legal_refs.url as url
     from legal_refs
     join source_items on source_items.source_item_id = legal_refs.source_item_id
     where legal_refs.legal_ref_id = ?`,
    [legalRefId],
  );
  if (!legalRef) return undefined;
  const evidenceRows = store.db.prepare(
    `select field_path as fieldPath,
            observed_value as observedValue
     from legal_ref_evidence
     where legal_ref_id = ?
     order by field_path, observed_value`,
  ).all(legalRefId) as Array<{
    fieldPath: string;
    observedValue: string;
  }>;
  const parsed = parseLegalReference(legalRef.citationText, legalRef.url ?? undefined);
  const inferredRefType = legalRef.refType === "unknown" ? parsed.refType : legalRef.refType;
  const resolvedRefType = inferredRefType;
  const resolvedNormalizedCitation = legalRef.normalizedCitation ??
    parsed.normalizedCitation ??
    null;
  const factSignature = [
    "legal_ref",
    legalRef.sourceId,
    legalRef.itemKey,
    legalRef.refType,
    slugify(normalizeName(legalRef.citationText)),
  ].join(":");
  const evidenceHash = `sha256:${await sha256Hex(
    JSON.stringify({
      refType: legalRef.refType,
      citationText: legalRef.citationText,
      normalizedCitation: legalRef.normalizedCitation ?? null,
      url: legalRef.url ?? null,
      evidence: evidenceRows.map((row) => ({
        fieldPath: row.fieldPath,
        observedValue: row.observedValue,
      })),
    }),
  )}`;
  return {
    factSignature,
    evidenceHash,
    resolvedRefType,
    resolvedNormalizedCitation,
    url: legalRef.url ?? null,
  };
}

async function enrichLegalRefResolutionEvent(
  store: WorkbenchStore,
  event: ResolutionEventInput,
): Promise<ResolutionEventInput> {
  const metadata = await legalRefResolutionMetadata(store, event.subjectId);
  if (!metadata) return event;
  const resolvedRefType = String(event.payload.refType ?? metadata.resolvedRefType);
  const resolvedNormalizedCitation = event.payload.normalizedCitation === null ? null : String(
    event.payload.normalizedCitation ??
      metadata.resolvedNormalizedCitation ??
      "",
  ) || null;
  return {
    ...event,
    payload: {
      ...event.payload,
      fact_signature: event.payload.fact_signature ?? metadata.factSignature,
      evidence_hash: event.payload.evidence_hash ?? metadata.evidenceHash,
      ...(event.eventType === "accept_legal_ref"
        ? {
          resolved_ref_type: event.payload.resolved_ref_type ?? resolvedRefType,
          resolved_normalized_citation: event.payload.resolved_normalized_citation ??
            resolvedNormalizedCitation,
          resolved_url: event.payload.resolved_url ?? metadata.url,
        }
        : {}),
    },
  };
}

export function applyResolutionEvent(
  store: WorkbenchStore,
  event: ResolutionEventInput,
  resolutionFile: string,
  sequenceNumber: number,
): void {
  withTransaction(store.db, () => {
    applyResolutionEventInCurrentTransaction(store, {
      event,
      resolutionFile,
      sequenceNumber,
    });
  });
}

function applyResolutionEventInCurrentTransaction(
  store: WorkbenchStore,
  record: ResolutionRecord,
): void {
  const { event, resolutionFile, sequenceNumber } = record;
  const eventId = resolutionEventId(resolutionFile, sequenceNumber);
  run(
    store.db,
    "insert into resolution_events(event_id, event_type, subject_id, payload_json, resolution_file, sequence_number, created_at) values(?, ?, ?, ?, ?, ?, ?)",
    [
      eventId,
      event.eventType,
      event.subjectId,
      JSON.stringify(event.payload),
      resolutionFile,
      sequenceNumber,
      nowIso(),
    ],
  );
  switch (event.eventType) {
    case "accept_entity_candidate":
      acceptEntityCandidate(store, event.subjectId, event.payload);
      break;
    case "reject_entity_candidate":
      setEntityCandidateStatus(store, event.subjectId, "rejected");
      resolveReviewBySubject(store, event.subjectId);
      break;
    case "merge_entity_candidates":
      mergeEntityCandidates(store, event.payload);
      break;
    case "set_entity_fields":
      setEntityFields(store, event.payload);
      break;
    case "accept_relationship_candidate":
      acceptRelationshipCandidate(store, event.subjectId, event.payload, eventId);
      break;
    case "reject_relationship_candidate":
      setRelationshipCandidateStatus(store, event.subjectId, "rejected");
      resolveReviewBySubject(store, event.subjectId);
      break;
    case "accept_legal_ref":
      acceptLegalRef(store, event.subjectId, event.payload);
      break;
    case "reject_legal_ref":
      setLegalRefStatus(store, event.subjectId, "rejected");
      resolveReviewBySubject(store, event.subjectId);
      break;
    case "defer_review_item":
      setReviewStatus(store, event.subjectId, "deferred");
      break;
    case "reopen_review_item":
      setReviewStatus(store, event.subjectId, "open");
      break;
  }
  reconcileRelationshipCandidates(store);
}

export async function replayResolutionDirectory(
  store: WorkbenchStore,
  resolutionsDir: string,
): Promise<void> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(resolutionsDir)) {
    if (!entry.isDirectory) continue;
    const subdir = join(resolutionsDir, entry.name);
    for await (const child of Deno.readDir(subdir)) {
      if (child.isFile && child.name.endsWith(".jsonl")) {
        files.push(join(subdir, child.name));
      }
    }
  }
  files.sort();
  const records: ResolutionRecord[] = [];
  for (const file of files) {
    const content = await Deno.readTextFile(file);
    const lines = content.split("\n").filter(Boolean);
    for (const [index, line] of lines.entries()) {
      const parsed = JSON.parse(line) as {
        event_type: ResolutionEventInput["eventType"];
        subject_id: string;
        payload: Record<string, unknown>;
      };
      records.push({
        event: {
          eventType: parsed.event_type,
          subjectId: parsed.subject_id,
          payload: parsed.payload,
        },
        resolutionFile: relative(resolutionsDir, file),
        sequenceNumber: index + 1,
      });
    }
  }
  withTransaction(store.db, () => {
    store.db.exec("delete from relationship_legal_refs");
    store.db.exec("delete from entity_legal_refs");
    store.db.exec("delete from canonical_relationships");
    store.db.exec("delete from canonical_entities");
    store.db.exec("delete from resolution_events");
    run(store.db, "delete from review_items where item_type = 'placeholder_entity'");
    run(store.db, "delete from review_items where item_type = 'relationship_candidate'");
    run(store.db, "delete from reconciliation_blockers");
    run(store.db, "delete from reconciliation_items");
    run(store.db, "update entity_candidates set review_status = 'pending'");
    run(store.db, "update relationship_candidates set review_status = 'pending'");
    run(store.db, "update legal_refs set review_status = 'pending'");
    run(store.db, "update review_items set status = 'open' where status = 'resolved'");
    for (const record of records) {
      applyResolutionEventInCurrentTransaction(store, record);
    }
    reconcileRelationshipCandidates(store);
  });
}

function resolutionEventId(resolutionFile: string, sequenceNumber: number): string {
  const filePart = slugify(resolutionFile) || "inline";
  return `resolution.${filePart}.${String(sequenceNumber).padStart(6, "0")}`;
}

function acceptEntityCandidate(
  store: WorkbenchStore,
  candidateId: string,
  payload: Record<string, unknown>,
): void {
  const candidate = queryOne<{
    proposedEntityId: string;
    name: string;
    kind: string;
    branch?: string;
    cluster?: string;
    officialUrl?: string;
    reviewStatus: CandidateStatus;
  }>(
    store.db,
    "select proposed_entity_id as proposedEntityId, name, kind, branch, cluster, official_url as officialUrl, review_status as reviewStatus from entity_candidates where candidate_id = ?",
    [candidateId],
  );
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
  if (candidate.reviewStatus === "rejected") {
    throw new Error(`Conflict: candidate ${candidateId} was already rejected`);
  }
  const entityId = String(payload.entityId ?? candidate.proposedEntityId);
  const existing = queryOne<{
    mergedCandidateIds: string;
    isPlaceholder: number;
    placeholderReason?: string;
  }>(
    store.db,
    "select merged_candidate_ids as mergedCandidateIds, is_placeholder as isPlaceholder, placeholder_reason as placeholderReason from canonical_entities where entity_id = ?",
    [entityId],
  );
  if (!existing) {
    run(
      store.db,
      "insert into canonical_entities(entity_id, name, kind, branch, cluster, official_url, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values(?, ?, ?, ?, ?, ?, 'accepted', ?, 0, null, ?, ?)",
      [
        entityId,
        candidate.name,
        candidate.kind,
        candidate.branch ?? null,
        candidate.cluster ?? null,
        candidate.officialUrl ?? null,
        JSON.stringify([candidateId]),
        nowIso(),
        nowIso(),
      ],
    );
  } else {
    const merged = JSON.parse(existing.mergedCandidateIds) as string[];
    if (!merged.includes(candidateId)) merged.push(candidateId);
    if (existing.isPlaceholder) {
      run(
        store.db,
        "update canonical_entities set name = ?, kind = ?, branch = ?, cluster = ?, official_url = ?, review_status = 'accepted', merged_candidate_ids = ?, is_placeholder = 0, placeholder_reason = null, updated_at = ? where entity_id = ?",
        [
          candidate.name,
          candidate.kind,
          candidate.branch ?? null,
          candidate.cluster ?? null,
          candidate.officialUrl ?? null,
          JSON.stringify(merged),
          nowIso(),
          entityId,
        ],
      );
      resolveReviewBySubject(store, entityId);
    } else {
      run(
        store.db,
        "update canonical_entities set merged_candidate_ids = ?, updated_at = ? where entity_id = ?",
        [JSON.stringify(merged), nowIso(), entityId],
      );
    }
  }
  setEntityCandidateStatus(store, candidateId, "accepted");
  resolveReviewBySubject(store, candidateId);
}

function mergeEntityCandidates(
  store: WorkbenchStore,
  payload: Record<string, unknown>,
): void {
  const entityId = String(payload.entityId);
  const candidateIds = payload.candidateIds as string[];
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    throw new Error("merge_entity_candidates requires candidateIds");
  }
  for (const candidateId of candidateIds) {
    acceptEntityCandidate(store, candidateId, { entityId });
  }
}

function setEntityFields(store: WorkbenchStore, payload: Record<string, unknown>): void {
  const entityId = String(payload.entityId);
  const current = queryOne<{
    name: string;
    kind: string;
    branch?: string;
    cluster?: string;
    officialUrl?: string;
  }>(
    store.db,
    "select name, kind, branch, cluster, official_url as officialUrl from canonical_entities where entity_id = ?",
    [entityId],
  );
  if (!current) throw new Error(`Entity not found: ${entityId}`);
  const fields = payload.fields as Record<string, unknown>;
  const next = { ...current, ...fields };
  for (const key of ["name", "kind", "branch", "cluster", "officialUrl"] as const) {
    const before = current[key];
    const after = next[key];
    if (before && after && before !== after && key !== "branch" && key !== "cluster") {
      throw new Error(`Conflict: ${entityId}.${key} already set to ${before}`);
    }
  }
  run(
    store.db,
    "update canonical_entities set name = ?, kind = ?, branch = ?, cluster = ?, official_url = ?, updated_at = ? where entity_id = ?",
    [
      String(next.name),
      String(next.kind),
      next.branch ?? null,
      next.cluster ?? null,
      next.officialUrl ?? null,
      nowIso(),
      entityId,
    ],
  );
}

function acceptRelationshipCandidate(
  store: WorkbenchStore,
  relationshipCandidateId: string,
  payload: Record<string, unknown>,
  eventId: string,
): void {
  const candidate = queryOne<{
    fromEntityRef: string;
    toEntityRef: string;
    relationshipType: string;
    reviewStatus: CandidateStatus;
  }>(
    store.db,
    "select from_entity_ref as fromEntityRef, to_entity_ref as toEntityRef, relationship_type as relationshipType, review_status as reviewStatus from relationship_candidates where relationship_candidate_id = ?",
    [relationshipCandidateId],
  );
  if (!candidate) throw new Error(`Relationship candidate not found: ${relationshipCandidateId}`);
  if (candidate.reviewStatus === "rejected") {
    throw new Error(`Conflict: relationship candidate ${relationshipCandidateId} was rejected`);
  }
  const relationshipType = String(payload.relationshipType ?? candidate.relationshipType);
  const fromEntityId = requireAcceptedEntity(
    store,
    String(payload.fromEntityId ?? candidate.fromEntityRef),
    relationshipCandidateId,
  );
  const toEntityId = requireAcceptedEntity(
    store,
    String(payload.toEntityId ?? candidate.toEntityRef),
    relationshipCandidateId,
  );
  const relationshipId = `${fromEntityId}:${relationshipType}:${toEntityId}`;
  const existing = queryOne<{ relationshipId: string }>(
    store.db,
    "select relationship_id as relationshipId from canonical_relationships where relationship_id = ?",
    [relationshipId],
  );
  if (!existing) {
    run(
      store.db,
      "insert into canonical_relationships(relationship_id, from_entity_id, relationship_type, to_entity_id, review_status, source_event_id, created_at) values(?, ?, ?, ?, 'accepted', ?, ?)",
      [relationshipId, fromEntityId, relationshipType, toEntityId, eventId, nowIso()],
    );
  }
  setRelationshipCandidateStatus(store, relationshipCandidateId, "accepted");
  resolveReviewBySubject(store, relationshipCandidateId);
}

function requireAcceptedEntity(
  store: WorkbenchStore,
  entityId: string,
  relationshipCandidateId: string,
): string {
  const existing = queryOne<{ entityId: string; isPlaceholder: number }>(
    store.db,
    "select entity_id as entityId, is_placeholder as isPlaceholder from canonical_entities where entity_id = ?",
    [entityId],
  );
  if (!existing) {
    throw new Error(
      `Cannot accept blocked relationship candidate ${relationshipCandidateId}: endpoint ${entityId} is not an accepted canonical entity`,
    );
  }
  if (existing.isPlaceholder === 1) {
    throw new Error(
      `Cannot accept blocked relationship candidate ${relationshipCandidateId}: endpoint ${entityId} is still a placeholder`,
    );
  }
  return entityId;
}

function setEntityCandidateStatus(
  store: WorkbenchStore,
  candidateId: string,
  status: CandidateStatus,
): void {
  const candidate = queryOne<{ candidateId: string }>(
    store.db,
    "select candidate_id as candidateId from entity_candidates where candidate_id = ?",
    [candidateId],
  );
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
  run(store.db, "update entity_candidates set review_status = ? where candidate_id = ?", [
    status,
    candidateId,
  ]);
}

function setRelationshipCandidateStatus(
  store: WorkbenchStore,
  candidateId: string,
  status: CandidateStatus,
): void {
  const candidate = queryOne<{ candidateId: string }>(
    store.db,
    "select relationship_candidate_id as candidateId from relationship_candidates where relationship_candidate_id = ?",
    [candidateId],
  );
  if (!candidate) throw new Error(`Relationship candidate not found: ${candidateId}`);
  run(
    store.db,
    "update relationship_candidates set review_status = ? where relationship_candidate_id = ?",
    [status, candidateId],
  );
}

function acceptLegalRef(
  store: WorkbenchStore,
  legalRefId: string,
  payload: Record<string, unknown>,
): void {
  const legalRef = queryOne<{
    legalRefId: string;
    refType: string;
    citationText: string;
    normalizedCitation?: string;
    url?: string;
    reviewStatus: CandidateStatus;
  }>(
    store.db,
    "select legal_ref_id as legalRefId, ref_type as refType, citation_text as citationText, normalized_citation as normalizedCitation, url, review_status as reviewStatus from legal_refs where legal_ref_id = ?",
    [legalRefId],
  );
  if (!legalRef) throw new Error(`Legal ref not found: ${legalRefId}`);
  if (legalRef.reviewStatus === "rejected") {
    throw new Error(`Conflict: legal ref ${legalRefId} was already rejected`);
  }
  const parsed = parseLegalReference(legalRef.citationText, legalRef.url);
  const inferredRefType = legalRef.refType === "unknown" ? parsed.refType : legalRef.refType;
  const refType = String(payload.refType ?? inferredRefType);
  const normalizedCitation = payload.normalizedCitation === null ? null : String(
    payload.normalizedCitation ?? legalRef.normalizedCitation ?? parsed.normalizedCitation ?? "",
  );
  run(
    store.db,
    "update legal_refs set ref_type = ?, normalized_citation = ?, url = coalesce(?, url), review_status = 'accepted' where legal_ref_id = ?",
    [
      refType,
      normalizedCitation === "" ? null : normalizedCitation,
      typeof payload.url === "string" ? payload.url : null,
      legalRefId,
    ],
  );
  resolveReviewBySubject(store, legalRefId);
}

function setLegalRefStatus(
  store: WorkbenchStore,
  legalRefId: string,
  status: CandidateStatus,
): void {
  const legalRef = queryOne<{ legalRefId: string }>(
    store.db,
    "select legal_ref_id as legalRefId from legal_refs where legal_ref_id = ?",
    [legalRefId],
  );
  if (!legalRef) throw new Error(`Legal ref not found: ${legalRefId}`);
  run(store.db, "update legal_refs set review_status = ? where legal_ref_id = ?", [
    status,
    legalRefId,
  ]);
}

function resolveReviewBySubject(store: WorkbenchStore, subjectId: string): void {
  run(
    store.db,
    "update review_items set status = 'resolved', updated_at = ? where subject_id = ?",
    [nowIso(), subjectId],
  );
}

function setReviewStatus(
  store: WorkbenchStore,
  reviewItemId: string,
  status: ReviewStatus,
): void {
  const reviewItem = queryOne<{ reviewItemId: string }>(
    store.db,
    "select review_item_id as reviewItemId from review_items where review_item_id = ?",
    [reviewItemId],
  );
  if (!reviewItem) throw new Error(`Review item not found: ${reviewItemId}`);
  run(store.db, "update review_items set status = ?, updated_at = ? where review_item_id = ?", [
    status,
    nowIso(),
    reviewItemId,
  ]);
}
