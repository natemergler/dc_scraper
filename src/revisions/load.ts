import { join } from "@std/path";

import {
  type Citation,
  type CitationValue,
  isCitationValue,
  type Revision,
  type RevisionTargetSelector,
} from "../core/types.ts";

export async function loadRevisions(revisionRoot: string): Promise<Revision[]> {
  const revisions: Revision[] = [];

  let entries: Array<{ name: string; isFile: boolean }>;
  try {
    entries = [];
    for await (const entry of Deno.readDir(revisionRoot)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) {
        continue;
      }
      entries.push(entry);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw new Error(
      `failed to read revision root ${revisionRoot}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const path = join(revisionRoot, entry.name);
    const rawText = await Deno.readTextFile(path);
    let payload: unknown;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new Error(`invalid JSON in revision file ${path}`);
    }

    revisions.push(parseRevisionPayload(path, payload));
  }

  return revisions;
}

export function parseRevisionPayload(path: string, payload: unknown): Revision {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`invalid revision payload in ${path}: revision must be an object`);
  }

  const candidate = payload as Record<string, unknown>;

  const id = candidate.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error(`invalid revision payload in ${path}: id must be a non-empty string`);
  }

  const source = candidate.source;
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error(`invalid revision payload in ${path}: source must be a non-empty string`);
  }

  const targetKind = candidate.targetKind;
  if (targetKind !== "entry" && targetKind !== "relation") {
    throw new Error(
      `invalid revision payload in ${path}: targetKind must be 'entry' or 'relation'`,
    );
  }

  const targetId = candidate.targetId;
  if (typeof targetId !== "string" || targetId.trim().length === 0) {
    throw new Error(`invalid revision payload in ${path}: targetId must be a non-empty string`);
  }

  const target = parseTargetSelector(path, candidate.target);

  const patch = candidate.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error(`invalid revision payload in ${path}: patch must be an object`);
  }

  const rationale = candidate.rationale;
  if (rationale !== undefined && (typeof rationale !== "string" || rationale.trim().length === 0)) {
    throw new Error(
      `invalid revision payload in ${path}: rationale must be a non-empty string when present`,
    );
  }

  const evidence = candidate.evidence;
  let parsedEvidence: CitationValue[] | undefined;
  if (evidence !== undefined) {
    if (!Array.isArray(evidence)) {
      throw new Error(
        `invalid revision payload in ${path}: evidence must be an array when present`,
      );
    }
    parsedEvidence = evidence.filter((value): value is CitationValue => isCitationValue(value));
    if (parsedEvidence.length !== evidence.length) {
      throw new Error(
        `invalid revision payload in ${path}: evidence must contain only citation values`,
      );
    }
  }

  if ((patch as Record<string, unknown>).suppress === true) {
    if (targetKind !== "entry") {
      throw new Error(
        `invalid revision payload in ${path}: suppress revisions must target entries`,
      );
    }
    if (typeof rationale !== "string" || rationale.trim().length === 0) {
      throw new Error(
        `invalid revision payload in ${path}: suppress revisions require rationale`,
      );
    }
  }

  const review = (patch as Record<string, unknown>).review;
  if (review !== undefined) {
    if (targetKind !== "entry") {
      throw new Error(
        `invalid revision payload in ${path}: review revisions must target entries`,
      );
    }
    if (typeof rationale !== "string" || rationale.trim().length === 0) {
      throw new Error(
        `invalid revision payload in ${path}: review revisions require rationale`,
      );
    }
    validateReviewPatch(path, review);
  }

  return {
    id,
    source,
    targetKind,
    targetId,
    ...(target ? { target } : {}),
    ...(typeof rationale === "string" ? { rationale } : {}),
    ...(parsedEvidence ? { evidence: parsedEvidence } : {}),
    patch: patch as Record<string, unknown>,
  };
}

function parseTargetSelector(
  path: string,
  value: unknown,
): RevisionTargetSelector | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid revision payload in ${path}: target must be an object`);
  }

  const target = value as Record<string, unknown>;
  const canonicalId = optionalString(path, "target.canonicalId", target.canonicalId);
  const previousIds = optionalStringArray(path, "target.previousIds", target.previousIds);
  const sourceRefs = optionalCitationArray(path, "target.sourceRefs", target.sourceRefs);
  const kind = optionalString(path, "target.kind", target.kind);
  const name = optionalString(path, "target.name", target.name);

  if (
    canonicalId === undefined &&
    previousIds === undefined &&
    sourceRefs === undefined &&
    kind === undefined &&
    name === undefined
  ) {
    throw new Error(
      `invalid revision payload in ${path}: target must include at least one selector field`,
    );
  }

  return {
    ...(canonicalId ? { canonicalId } : {}),
    ...(previousIds ? { previousIds } : {}),
    ...(sourceRefs ? { sourceRefs } : {}),
    ...(kind ? { kind } : {}),
    ...(name ? { name } : {}),
  };
}

function validateReviewPatch(path: string, value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid revision payload in ${path}: review must be an object`);
  }

  const review = value as Record<string, unknown>;
  const decision = review.decision;
  if (
    decision !== "preserve_distinct" &&
    decision !== "alias" &&
    decision !== "source_shadow"
  ) {
    throw new Error(
      `invalid revision payload in ${path}: review.decision must be preserve_distinct, alias, or source_shadow`,
    );
  }

  if (review.relatedEntryIds !== undefined) {
    validateStringArray(path, "review.relatedEntryIds", review.relatedEntryIds);
  }
  if (review.aliasNames !== undefined) {
    validateStringArray(path, "review.aliasNames", review.aliasNames);
  }
  if (
    review.canonicalEntryId !== undefined &&
    (typeof review.canonicalEntryId !== "string" || review.canonicalEntryId.trim().length === 0)
  ) {
    throw new Error(
      `invalid revision payload in ${path}: review.canonicalEntryId must be a non-empty string`,
    );
  }

  if (decision === "preserve_distinct" && !hasNonEmptyStringArray(review.relatedEntryIds)) {
    throw new Error(
      `invalid revision payload in ${path}: preserve_distinct review requires relatedEntryIds`,
    );
  }
  if (decision === "alias" && !hasNonEmptyStringArray(review.aliasNames)) {
    throw new Error(
      `invalid revision payload in ${path}: alias review requires aliasNames`,
    );
  }
  if (
    decision === "source_shadow" &&
    (typeof review.canonicalEntryId !== "string" || review.canonicalEntryId.trim().length === 0)
  ) {
    throw new Error(
      `invalid revision payload in ${path}: source_shadow review requires canonicalEntryId`,
    );
  }
}

function validateStringArray(path: string, field: string, value: unknown): void {
  if (!Array.isArray(value) || !hasNonEmptyStringArray(value)) {
    throw new Error(
      `invalid revision payload in ${path}: ${field} must be a non-empty string array`,
    );
  }
}

function hasNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function optionalString(path: string, field: string, value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `invalid revision payload in ${path}: ${field} must be a non-empty string`,
    );
  }
  return value;
}

function optionalStringArray(path: string, field: string, value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  validateStringArray(path, field, value);
  return [...(value as string[])].sort((left, right) => left.localeCompare(right));
}

function optionalCitationArray(
  path: string,
  field: string,
  value: unknown,
): Citation[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `invalid revision payload in ${path}: ${field} must be a non-empty source citation array`,
    );
  }
  const citations = value.filter(isCitation);
  if (citations.length !== value.length) {
    throw new Error(
      `invalid revision payload in ${path}: ${field} must contain only source citations`,
    );
  }
  return [...citations].sort((left, right) => {
    return citationKey(left).localeCompare(citationKey(right));
  });
}

function isCitation(value: unknown): value is Citation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.source === "string" &&
    typeof candidate.sourceRecordId === "string" &&
    (candidate.locator === undefined || typeof candidate.locator === "string") &&
    (candidate.url === undefined || typeof candidate.url === "string")
  );
}

function citationKey(citation: Citation): string {
  return [
    citation.source,
    citation.sourceRecordId,
    citation.locator ?? "",
    citation.url ?? "",
  ].join("|");
}
