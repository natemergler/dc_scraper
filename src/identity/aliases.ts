import { join } from "@std/path";

import {
  type Citation,
  type CitationValue,
  type Entry,
  isCitationValue,
  type ValidationIssue,
} from "../core/types.ts";

export interface IdentityAlias {
  id: string;
  canonicalId: string;
  previousIds: string[];
  sourceRefs: Citation[];
  kind?: string;
  name?: string;
  rationale: string;
  evidence: CitationValue[];
}

export type IdentityResolution =
  | {
    status: "resolved";
    input: string;
    canonicalId: string;
    aliases: IdentityAlias[];
  }
  | {
    status: "missing";
    input: string;
  }
  | {
    status: "ambiguous";
    input: string;
    canonicalIds: string[];
    aliases: IdentityAlias[];
  };

export interface IdentityAliasResolver {
  aliases: IdentityAlias[];
  issues: ValidationIssue[];
  resolvePreviousId(id: string): IdentityResolution;
  resolveSourceRef(ref: Citation): IdentityResolution;
  assertTargetExists(entries: Map<string, Entry>): ValidationIssue[];
}

interface IdentityAliasFile {
  schemaVersion?: number;
  jurisdiction?: string;
  aliases?: unknown;
}

export async function loadIdentityAliases(identityRoot: string): Promise<IdentityAlias[]> {
  const aliases: IdentityAlias[] = [];

  let entries: Array<{ name: string; isFile: boolean }>;
  try {
    entries = [];
    for await (const entry of Deno.readDir(identityRoot)) {
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
      `failed to read identity root ${identityRoot}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(identityRoot, entry.name);
    const rawText = await Deno.readTextFile(path);
    let payload: unknown;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new Error(`invalid JSON in identity file ${path}`);
    }
    aliases.push(...parseIdentityAliasPayload(path, payload));
  }

  return aliases.sort(compareAliases);
}

export function parseIdentityAliasPayload(path: string, payload: unknown): IdentityAlias[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`invalid identity payload in ${path}: payload must be an object`);
  }

  const file = payload as IdentityAliasFile;
  if (
    file.schemaVersion !== undefined &&
    file.schemaVersion !== 1
  ) {
    throw new Error(`invalid identity payload in ${path}: schemaVersion must be 1`);
  }

  if (file.aliases !== undefined) {
    if (!Array.isArray(file.aliases)) {
      throw new Error(`invalid identity payload in ${path}: aliases must be an array`);
    }
    return file.aliases.map((alias, index) =>
      parseIdentityAlias(`${path}#aliases[${index}]`, alias)
    )
      .sort(compareAliases);
  }

  return [parseIdentityAlias(path, payload)];
}

export function buildIdentityAliasResolver(aliases: IdentityAlias[]): IdentityAliasResolver {
  const sortedAliases = [...aliases].sort(compareAliases);
  const previousIdIndex = indexAliases(sortedAliases, (alias) => alias.previousIds);
  const sourceRefIndex = indexAliases(
    sortedAliases,
    (alias) => alias.sourceRefs.map(sourceRefKey),
  );
  const issues = validateAliasIndex(previousIdIndex, "previousIds")
    .concat(validateAliasIndex(sourceRefIndex, "sourceRefs"))
    .sort(compareIssues);

  return {
    aliases: sortedAliases,
    issues,
    resolvePreviousId(id: string): IdentityResolution {
      return resolveFromIndex(id, previousIdIndex);
    },
    resolveSourceRef(ref: Citation): IdentityResolution {
      return resolveFromIndex(sourceRefKey(ref), sourceRefIndex);
    },
    assertTargetExists(entries: Map<string, Entry>): ValidationIssue[] {
      const missing: ValidationIssue[] = [];
      for (const alias of sortedAliases) {
        if (entries.has(alias.canonicalId)) {
          continue;
        }
        missing.push({
          code: "identity.alias_target_missing",
          path: alias.id,
          message:
            `identity alias ${alias.id} targets missing canonical entry ${alias.canonicalId}`,
        });
      }
      return missing.sort(compareIssues);
    },
  };
}

export function citationIdentityKey(ref: Citation): string {
  return sourceRefKey(ref);
}

function parseIdentityAlias(path: string, value: unknown): IdentityAlias {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid identity alias in ${path}: alias must be an object`);
  }

  const candidate = value as Record<string, unknown>;
  const id = requireString(candidate.id, path, "id");
  const canonicalId = requireString(candidate.canonicalId, path, "canonicalId");
  const previousIds = optionalStringArray(candidate.previousIds, path, "previousIds");
  const sourceRefs = optionalCitationArray(candidate.sourceRefs, path, "sourceRefs");
  if (previousIds.length === 0 && sourceRefs.length === 0) {
    throw new Error(
      `invalid identity alias in ${path}: previousIds or sourceRefs must be present`,
    );
  }

  const kind = optionalString(candidate.kind, path, "kind");
  const name = optionalString(candidate.name, path, "name");
  const rationale = requireString(candidate.rationale, path, "rationale");
  const evidence = optionalCitationValueArray(candidate.evidence, path, "evidence");

  return {
    id,
    canonicalId,
    previousIds,
    sourceRefs,
    ...(kind ? { kind } : {}),
    ...(name ? { name } : {}),
    rationale,
    evidence,
  };
}

function indexAliases(
  aliases: IdentityAlias[],
  keysForAlias: (alias: IdentityAlias) => string[],
): Map<string, IdentityAlias[]> {
  const index = new Map<string, IdentityAlias[]>();
  for (const alias of aliases) {
    for (const key of keysForAlias(alias)) {
      const existing = index.get(key) ?? [];
      existing.push(alias);
      index.set(key, existing);
    }
  }
  return index;
}

function validateAliasIndex(
  index: Map<string, IdentityAlias[]>,
  field: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [key, aliases] of index) {
    const canonicalIds = uniqueSorted(aliases.map((alias) => alias.canonicalId));
    if (canonicalIds.length <= 1) {
      continue;
    }
    issues.push({
      code: "identity.alias_ambiguous",
      path: `${field}.${key}`,
      message: `${field} selector ${key} maps to multiple canonical IDs: ${
        canonicalIds.join(", ")
      }`,
    });
  }
  return issues;
}

function resolveFromIndex(
  input: string,
  index: Map<string, IdentityAlias[]>,
): IdentityResolution {
  const aliases = index.get(input) ?? [];
  if (aliases.length === 0) {
    return { status: "missing", input };
  }

  const canonicalIds = uniqueSorted(aliases.map((alias) => alias.canonicalId));
  if (canonicalIds.length > 1) {
    return {
      status: "ambiguous",
      input,
      canonicalIds,
      aliases: [...aliases].sort(compareAliases),
    };
  }

  return {
    status: "resolved",
    input,
    canonicalId: canonicalIds[0],
    aliases: [...aliases].sort(compareAliases),
  };
}

function sourceRefKey(ref: Citation): string {
  return [
    ref.source,
    ref.sourceRecordId,
    ref.locator ?? "",
    ref.url ?? "",
  ].join("|");
}

function requireString(candidate: unknown, path: string, field: string): string {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    throw new Error(`invalid identity alias in ${path}: ${field} must be a non-empty string`);
  }
  return candidate;
}

function optionalString(candidate: unknown, path: string, field: string): string | undefined {
  if (candidate === undefined) {
    return undefined;
  }
  return requireString(candidate, path, field);
}

function optionalStringArray(candidate: unknown, path: string, field: string): string[] {
  if (candidate === undefined) {
    return [];
  }
  if (
    !Array.isArray(candidate) ||
    !candidate.every((item) => typeof item === "string" && item.trim().length > 0)
  ) {
    throw new Error(
      `invalid identity alias in ${path}: ${field} must be a non-empty string array`,
    );
  }
  return uniqueSorted(candidate);
}

function optionalCitationArray(candidate: unknown, path: string, field: string): Citation[] {
  if (candidate === undefined) {
    return [];
  }
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error(
      `invalid identity alias in ${path}: ${field} must be a non-empty citation array`,
    );
  }
  const citations = candidate.filter(isCitation);
  if (citations.length !== candidate.length) {
    throw new Error(
      `invalid identity alias in ${path}: ${field} must contain only source citations`,
    );
  }
  return [...citations].sort((left, right) =>
    sourceRefKey(left).localeCompare(sourceRefKey(right))
  );
}

function optionalCitationValueArray(
  candidate: unknown,
  path: string,
  field: string,
): CitationValue[] {
  if (candidate === undefined) {
    return [];
  }
  if (!Array.isArray(candidate)) {
    throw new Error(`invalid identity alias in ${path}: ${field} must be an array`);
  }
  const citations = candidate.filter(isCitationValue);
  if (citations.length !== candidate.length) {
    throw new Error(
      `invalid identity alias in ${path}: ${field} must contain only citation values`,
    );
  }
  return [...citations].sort((left, right) => {
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
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

function compareAliases(left: IdentityAlias, right: IdentityAlias): number {
  return left.id.localeCompare(right.id);
}

function compareIssues(left: ValidationIssue, right: ValidationIssue): number {
  if (left.code === right.code) {
    return left.path.localeCompare(right.path);
  }
  return left.code.localeCompare(right.code);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
