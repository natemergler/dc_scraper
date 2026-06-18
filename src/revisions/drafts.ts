import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { type CitationValue, isCitationValue, type Revision } from "../core/types.ts";
import {
  type ReviewItem,
  type ReviewResolutionType,
  stableReviewIdSegment,
} from "../review/items.ts";
import { parseRevisionPayload } from "./load.ts";

export interface DraftRevision extends Revision {
  status: "draft";
  sourceReviewItemId: string;
  decisionType: ReviewResolutionType;
  relatedIds: string[];
  targetSelector: {
    stateId?: string;
    sourceRefs: CitationValue[];
  };
  generatedBy: "review CLI";
}

export interface CreateDraftRevisionOptions {
  decisionType: ReviewResolutionType;
  targetId?: string;
  kind?: string;
  rationale?: string;
}

export function draftRevisionRoot(workspaceRoot: string): string {
  return join(workspaceRoot, "draft-revisions");
}

export function draftRevisionFileName(id: string): string {
  return `${stableReviewIdSegment(id, 120)}.json`;
}

export function createDraftRevision(
  item: ReviewItem,
  options: CreateDraftRevisionOptions,
): DraftRevision {
  const decisionType = options.decisionType;
  const stateIds = [...item.affected.stateIds].sort();
  if (stateIds.length === 0) {
    throw new Error(`review item ${item.id} does not identify a state entry target`);
  }
  if (options.targetId && !stateIds.includes(options.targetId)) {
    throw new Error(
      `review resolution target ${options.targetId} is not one of the review item entries`,
    );
  }

  const primaryTarget = options.targetId ?? stateIds[0];
  const relatedIds = stateIds.filter((id) => id !== primaryTarget);
  const id = `review-${decisionType}-${stableReviewIdSegment(item.id)}${
    options.targetId ? `-${stableReviewIdSegment(options.targetId, 40)}` : ""
  }`;
  const rationale = options.rationale ?? defaultRationale(item, decisionType, primaryTarget);
  const evidence = item.citations.length > 0 ? item.citations : item.sourceRefs;
  const base = {
    id,
    source: "review_cli",
    status: "draft" as const,
    sourceReviewItemId: item.id,
    decisionType,
    relatedIds,
    targetSelector: {
      stateId: primaryTarget,
      sourceRefs: evidence,
    },
    generatedBy: "review CLI" as const,
    targetKind: "entry" as const,
    targetId: primaryTarget,
    rationale,
    evidence,
  };

  if (decisionType === "preserve-distinct") {
    const distinctIds = relatedIds.length > 0
      ? relatedIds
      : stateIds.filter((id) => id !== primaryTarget);
    if (distinctIds.length === 0) {
      throw new Error("preserve-distinct requires at least one related entry");
    }
    return validateDraftRevision({
      ...base,
      patch: {
        review: {
          decision: "preserve_distinct",
          relatedEntryIds: distinctIds,
        },
      },
    }, `draft ${id}`);
  }

  if (decisionType === "source-shadow") {
    if (!options.targetId) {
      throw new Error("source-shadow resolution requires --target <canonical-entry-id>");
    }
    const shadowId = stateIds.find((id) => id !== options.targetId);
    if (!shadowId) {
      throw new Error("source-shadow resolution requires a non-target shadow entry");
    }
    return validateDraftRevision({
      ...base,
      targetId: shadowId,
      targetSelector: {
        stateId: shadowId,
        sourceRefs: evidence,
      },
      relatedIds: [options.targetId],
      patch: {
        suppress: true,
        review: {
          decision: "source_shadow",
          canonicalEntryId: options.targetId,
        },
      },
    }, `draft ${id}`);
  }

  if (decisionType === "suppress") {
    return validateDraftRevision({
      ...base,
      patch: {
        suppress: true,
      },
    }, `draft ${id}`);
  }

  if (decisionType === "alias") {
    if (!options.targetId) {
      throw new Error("alias resolution requires --target <canonical-entry-id>");
    }
    const aliasNames = item.candidateEntries
      .filter((entry) => entry.id !== options.targetId)
      .map((entry) => entry.name)
      .filter((name, index, values) => values.indexOf(name) === index);
    if (aliasNames.length === 0) {
      throw new Error("alias resolution requires at least one alias name");
    }
    return validateDraftRevision({
      ...base,
      patch: {
        review: {
          decision: "alias",
          aliasNames,
        },
      },
    }, `draft ${id}`);
  }

  if (decisionType === "override-kind") {
    if (!options.kind) {
      throw new Error("override-kind resolution requires --kind <kind>");
    }
    return validateDraftRevision({
      ...base,
      patch: {
        kind: options.kind,
      },
    }, `draft ${id}`);
  }

  throw new Error(`unsupported review resolution: ${decisionType}`);
}

export async function writeDraftRevision(
  workspaceRoot: string,
  draft: DraftRevision,
): Promise<string> {
  const root = draftRevisionRoot(workspaceRoot);
  await ensureDir(root);
  const path = join(root, draftRevisionFileName(draft.id));
  await Deno.writeTextFile(path, `${JSON.stringify(draft, null, 2)}\n`);
  return path;
}

export async function loadDraftRevisions(workspaceRoot: string): Promise<DraftRevision[]> {
  const root = draftRevisionRoot(workspaceRoot);
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(root)) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        files.push(entry.name);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }

  const drafts: DraftRevision[] = [];
  for (const file of files.sort()) {
    const path = join(root, file);
    const raw = await Deno.readTextFile(path);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(`invalid JSON in draft revision file ${path}`);
    }
    drafts.push(validateDraftRevision(payload, path));
  }
  return drafts.sort((left, right) => left.id.localeCompare(right.id));
}

export async function loadDraftRevision(
  workspaceRoot: string,
  draftIdOrPath: string,
): Promise<DraftRevision> {
  const drafts = await loadDraftRevisions(workspaceRoot);
  const draft = drafts.find((candidate) => draftMatchesRef(candidate, draftIdOrPath));
  if (!draft) {
    throw new Error(`draft revision not found: ${draftIdOrPath}`);
  }
  return draft;
}

function draftMatchesRef(draft: DraftRevision, ref: string): boolean {
  if (draft.id === ref) {
    return true;
  }
  const name = ref.split(/[\\/]/).pop() ?? ref;
  const fileName = draftRevisionFileName(draft.id);
  if (name === fileName) {
    return true;
  }
  return name.endsWith(".json") ? false : `${name}.json` === fileName;
}

export async function applyDraftRevision(
  workspaceRoot: string,
  revisionRoot: string,
  draftIdOrPath: string,
): Promise<string> {
  const draft = await loadDraftRevision(workspaceRoot, draftIdOrPath);
  const tracked = trackedRevisionFromDraft(draft);
  parseRevisionPayload(`draft ${draft.id}`, tracked);

  await ensureDir(revisionRoot);
  const path = join(revisionRoot, `${tracked.id}.json`);
  try {
    await Deno.lstat(path);
    throw new Error(`tracked revision already exists: ${path}`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  await Deno.writeTextFile(path, `${JSON.stringify(tracked, null, 2)}\n`);
  await Deno.remove(join(draftRevisionRoot(workspaceRoot), draftRevisionFileName(draft.id)));
  return path;
}

export function validateDraftRevision(value: unknown, path = "draft revision"): DraftRevision {
  const revision = parseRevisionPayload(path, value);
  const candidate = value as Record<string, unknown>;

  if (candidate.status !== "draft") {
    throw new Error(`invalid draft revision in ${path}: status must be draft`);
  }
  if (
    typeof candidate.sourceReviewItemId !== "string" ||
    candidate.sourceReviewItemId.trim().length === 0
  ) {
    throw new Error(
      `invalid draft revision in ${path}: sourceReviewItemId must be a non-empty string`,
    );
  }
  if (!isReviewResolutionType(candidate.decisionType)) {
    throw new Error(`invalid draft revision in ${path}: decisionType is unsupported`);
  }
  if (candidate.generatedBy !== "review CLI") {
    throw new Error(`invalid draft revision in ${path}: generatedBy must be review CLI`);
  }
  if (!Array.isArray(candidate.relatedIds)) {
    throw new Error(`invalid draft revision in ${path}: relatedIds must be an array`);
  }
  if (
    !candidate.targetSelector ||
    typeof candidate.targetSelector !== "object" ||
    Array.isArray(candidate.targetSelector)
  ) {
    throw new Error(`invalid draft revision in ${path}: targetSelector must be an object`);
  }

  const targetSelector = candidate.targetSelector as Record<string, unknown>;
  const sourceRefs = targetSelector.sourceRefs;
  if (!Array.isArray(sourceRefs) || !sourceRefs.every(isCitationValue)) {
    throw new Error(
      `invalid draft revision in ${path}: targetSelector.sourceRefs must be citations`,
    );
  }

  return {
    ...revision,
    status: "draft",
    sourceReviewItemId: candidate.sourceReviewItemId,
    decisionType: candidate.decisionType,
    relatedIds: candidate.relatedIds.filter((id): id is string => typeof id === "string"),
    targetSelector: {
      ...(typeof targetSelector.stateId === "string" ? { stateId: targetSelector.stateId } : {}),
      sourceRefs,
    },
    generatedBy: "review CLI",
  };
}

export function trackedRevisionFromDraft(draft: DraftRevision): Revision {
  return {
    id: draft.id,
    source: "review_cli",
    targetKind: draft.targetKind,
    targetId: draft.targetId,
    rationale: draft.rationale,
    evidence: draft.evidence,
    patch: draft.patch,
  };
}

function defaultRationale(
  item: ReviewItem,
  decisionType: ReviewResolutionType,
  targetId: string,
): string {
  return `Draft ${decisionType} resolution for ${item.id}; target ${targetId}. ${item.rationale}`;
}

function isReviewResolutionType(value: unknown): value is ReviewResolutionType {
  return value === "preserve-distinct" ||
    value === "source-shadow" ||
    value === "alias" ||
    value === "suppress" ||
    value === "override-kind";
}
