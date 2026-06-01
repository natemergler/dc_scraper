import { ensureDir } from "@std/fs";
import { join, relative } from "@std/path";
import {
  buildReviewItemId,
  type CandidateStatus,
  compactDatePart,
  nowIso,
  type ResolutionEventInput,
  type ReviewStatus,
  slugify,
} from "../domain.ts";
import { queryOne, run, withTransaction } from "./db.ts";
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
  const dayDir = join(resolutionsDir, compactDatePart());
  await ensureDir(dayDir);
  const filePath = join(dayDir, "001-auto-review.jsonl");
  let sequenceNumber = 1;
  try {
    const existing = await Deno.readTextFile(filePath);
    sequenceNumber = existing.split("\n").filter(Boolean).length + 1;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const line = JSON.stringify({
    event_type: event.eventType,
    subject_id: event.subjectId,
    payload: event.payload,
  });
  await Deno.writeTextFile(filePath, `${line}\n`, { append: true, create: true });
  applyResolutionEvent(store, event, relative(resolutionsDir, filePath), sequenceNumber);
  return { filePath, sequenceNumber };
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
    case "defer_review_item":
      setReviewStatus(store, event.subjectId, "deferred");
      break;
    case "reopen_review_item":
      setReviewStatus(store, event.subjectId, "open");
      break;
  }
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
    store.db.exec("delete from resolution_events");
    store.db.exec("delete from canonical_relationships");
    store.db.exec("delete from canonical_entities");
    run(store.db, "delete from review_items where item_type = 'placeholder_entity'");
    run(store.db, "update entity_candidates set review_status = 'pending'");
    run(store.db, "update relationship_candidates set review_status = 'pending'");
    run(store.db, "update review_items set status = 'open' where status = 'resolved'");
    for (const record of records) {
      applyResolutionEventInCurrentTransaction(store, record);
    }
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
  const fromEntityId = ensureEntityExists(
    store,
    String(payload.fromEntityId ?? candidate.fromEntityRef),
    relationshipCandidateId,
  );
  const toEntityId = ensureEntityExists(
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

function ensureEntityExists(
  store: WorkbenchStore,
  entityId: string,
  relationshipCandidateId?: string,
): string {
  const existing = queryOne<{ entityId: string }>(
    store.db,
    "select entity_id as entityId from canonical_entities where entity_id = ?",
    [entityId],
  );
  if (existing) return entityId;
  const name = entityId.split(".").slice(1).join(" ").replaceAll("_", " ").replaceAll(
    /\b\w/g,
    (part) => part.toUpperCase(),
  );
  run(
    store.db,
    "insert into canonical_entities(entity_id, name, kind, review_status, merged_candidate_ids, is_placeholder, placeholder_reason, created_at, updated_at) values(?, ?, 'placeholder', 'placeholder', '[]', 1, ?, ?, ?)",
    [
      entityId,
      name,
      relationshipCandidateId
        ? `Created while accepting relationship candidate ${relationshipCandidateId}`
        : `Created while accepting a relationship candidate for ${entityId}`,
      nowIso(),
      nowIso(),
    ],
  );
  run(
    store.db,
    "insert into review_items(review_item_id, item_type, subject_id, reason, default_action, status, details_json, created_at, updated_at) values(?, 'placeholder_entity', ?, ?, 'defer', 'open', ?, ?, ?)",
    [
      buildReviewItemId(entityId, "placeholder"),
      entityId,
      "Placeholder entity created while accepting relationship candidate",
      JSON.stringify({
        entityId,
        relationshipCandidateId,
      }),
      nowIso(),
      nowIso(),
    ],
  );
  return entityId;
}

function setEntityCandidateStatus(
  store: WorkbenchStore,
  candidateId: string,
  status: CandidateStatus,
): void {
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
  run(
    store.db,
    "update relationship_candidates set review_status = ? where relationship_candidate_id = ?",
    [status, candidateId],
  );
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
  run(store.db, "update review_items set status = ?, updated_at = ? where review_item_id = ?", [
    status,
    nowIso(),
    reviewItemId,
  ]);
}
