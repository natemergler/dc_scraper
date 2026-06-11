import {
  type CitationValue,
  type Entry,
  type EntryFragment,
  type Finding,
  isCitationValue,
  type LedgerState,
  type RelationFragment,
} from "../core/types.ts";
import { KindRegistry } from "../core/kinds.ts";
import { type Revision } from "../core/types.ts";

export interface CompileOptions {
  jurisdiction: string;
  fragments: Array<EntryFragment | RelationFragment>;
  kindRegistry: KindRegistry;
  findings?: Finding[];
  revisions?: Revision[];
  generatedAt?: string;
}

export interface CompilerResult {
  ok: boolean;
  baseline: LedgerState;
  state: LedgerState | null;
  findings: Finding[];
  conflicts: Finding[];
}

const conflictCode = {
  duplicateEntryKindConflict: "compiler.conflict.entry_kind_mismatch",
  missingEntrySource: "compiler.conflict.relation_source_missing",
  missingEntryTarget: "compiler.conflict.relation_target_missing",
  missingRevisionTarget: "compiler.conflict.revision_target_missing",
  invalidRevisionPatch: "compiler.conflict.revision_invalid_state",
} as const;

const relationKindMigrations: Record<string, string> = {
  "dc.relation:affiliated_with": "dc.relation:governs",
} as const;

type MutableRelationShape = {
  kind: string;
  to: string;
  citations?: CitationValue[];
};

type MutableRelations = Record<string, Array<MutableRelationShape>>;

const defaultTimestamp = () => new Date().toISOString();

export function compileFragments(input: CompileOptions): CompilerResult {
  const findings: Finding[] = [...(input.findings ?? [])];
  const conflicts: Finding[] = [];

  const entryFragments = input.fragments.filter((fragment): fragment is EntryFragment =>
    fragment.fragmentType === "entry"
  ).sort(compareEntryFragments);
  const relationFragments = input.fragments.filter((fragment): fragment is RelationFragment =>
    fragment.fragmentType === "relation"
  ).sort(compareRelationFragments);

  const provisionalEntries = mergeEntryFragments(entryFragments, conflicts);
  const baseState = buildStateFromEntries(
    input.jurisdiction,
    input.generatedAt ?? defaultTimestamp(),
    provisionalEntries,
    relationFragments,
    findings,
    conflicts,
  );

  const stateWithRelations = validateAndSortState(baseState, input.kindRegistry, conflicts);

  if (conflicts.length > 0) {
    return finalize({ ok: false, baseline: stateWithRelations, state: null, findings, conflicts });
  }

  const revisedState = applyRevisions(
    input.revisions ?? [],
    stateWithRelations,
    input.kindRegistry,
    findings,
    conflicts,
  );

  const validatedRevised = validateAndSortState(revisedState, input.kindRegistry, conflicts);

  const ok = conflicts.length === 0;
  return finalize({
    ok,
    baseline: stateWithRelations,
    state: ok ? validatedRevised : null,
    findings,
    conflicts,
  });
}

function finalize(result: CompilerResult): CompilerResult {
  return {
    ok: result.ok,
    baseline: result.baseline,
    state: result.state,
    findings: [...result.findings],
    conflicts: [...result.conflicts],
  };
}

function compareEntryFragments(left: EntryFragment, right: EntryFragment): number {
  if (left.provisionalId === right.provisionalId) {
    return left.sourceRecordId.localeCompare(right.sourceRecordId);
  }
  return left.provisionalId.localeCompare(right.provisionalId);
}

function compareRelationFragments(left: RelationFragment, right: RelationFragment): number {
  if (left.from === right.from) {
    if (left.relationKind === right.relationKind) {
      if (left.to === right.to) {
        return left.sourceRecordId.localeCompare(right.sourceRecordId);
      }
      return left.to.localeCompare(right.to);
    }
    return left.relationKind.localeCompare(right.relationKind);
  }
  return left.from.localeCompare(right.from);
}

function mergeEntryFragments(
  entryFragments: EntryFragment[],
  conflicts: Finding[],
): Map<string, Entry> {
  const provisionalEntries = new Map<string, Entry>();

  for (const fragment of entryFragments) {
    const existing = provisionalEntries.get(fragment.provisionalId);
    if (!existing) {
      provisionalEntries.set(fragment.provisionalId, {
        id: fragment.provisionalId,
        family: fragment.family,
        kind: fragment.kind,
        name: fragment.name,
        attributes: {
          ...fragment.attributes,
        },
        citations: sortUniqueCitations(fragment.citations),
        relations: {},
      });
      continue;
    }

    if (existing.kind !== fragment.kind) {
      conflicts.push({
        kind: "conflict",
        code: conflictCode.duplicateEntryKindConflict,
        message:
          `provisional entry ${fragment.provisionalId} has conflicting kinds: ${existing.kind} vs ${fragment.kind}`,
      });
    }

    if (existing.family !== fragment.family) {
      existing.family = fragment.family;
    }

    if (fragment.name.length > existing.name.length) {
      existing.name = fragment.name;
    }

    for (const [attribute, value] of Object.entries(fragment.attributes)) {
      existing.attributes[attribute] = value;
    }

    existing.citations = sortUniqueCitations(existing.citations.concat(fragment.citations));
  }

  return provisionalEntries;
}

function buildStateFromEntries(
  jurisdiction: string,
  generatedAt: string,
  entries: Map<string, Entry>,
  relationFragments: RelationFragment[],
  findings: Finding[],
  conflicts: Finding[],
): LedgerState {
  const state: LedgerState = {
    jurisdiction,
    generatedAt,
    entries,
    findings,
  };

  for (const relation of relationFragments) {
    const relationKind = canonicalizeRelationKind(relation.relationKind, findings);
    const sourceEntry = state.entries.get(relation.from);
    if (!sourceEntry) {
      conflicts.push({
        kind: "conflict",
        code: conflictCode.missingEntrySource,
        message: `relation source entry not found: ${relation.from}`,
      });
      continue;
    }

    if (!state.entries.has(relation.to)) {
      conflicts.push({
        kind: "conflict",
        code: conflictCode.missingEntryTarget,
        message: `relation target entry not found: ${relation.to}`,
      });
      continue;
    }

    const existingRelations = sourceEntry.relations[relationKind] ?? [];
    sourceEntry.relations[relationKind] = dedupeRelations([
      ...existingRelations,
      {
        kind: relationKind,
        to: relation.to,
        citations: sortUniqueCitations(relation.citations),
      },
    ]);
  }

  return state;
}

function dedupeRelations(relations: MutableRelations[string]): MutableRelations[string] {
  const seen = new Set<string>();
  const deduped: MutableRelations[string] = [];

  for (const relation of relations) {
    const key = `${relation.kind}|${relation.to}|${
      JSON.stringify(sortUniqueCitations(relation.citations ?? []))
    }`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      kind: relation.kind,
      to: relation.to,
      citations: sortUniqueCitations(relation.citations ?? []),
    });
  }

  return deduped.sort((left, right) => {
    if (left.kind === right.kind) return left.to.localeCompare(right.to);
    return left.kind.localeCompare(right.kind);
  });
}

function applyRevisions(
  revisions: Revision[],
  baseline: LedgerState,
  kindRegistry: KindRegistry,
  findings: Finding[],
  conflicts: Finding[],
): LedgerState {
  const outputState: LedgerState = {
    jurisdiction: baseline.jurisdiction,
    generatedAt: baseline.generatedAt,
    findings: baseline.findings,
    entries: new Map(baseline.entries),
  };

  for (const revision of [...revisions].sort((left, right) => left.id.localeCompare(right.id))) {
    const entry = outputState.entries.get(revision.targetId);
    if (!entry) {
      conflicts.push({
        kind: "conflict",
        code: conflictCode.missingRevisionTarget,
        message: `revision target entry not found: ${revision.targetId}`,
      });
      continue;
    }

    if (revision.targetKind === "entry") {
      const patched = applyEntryPatch(entry, revision.patch, findings);
      outputState.entries.set(revision.targetId, patched);

      const result = kindRegistry.validateEntry(patched);
      if (!result.ok) {
        conflicts.push({
          kind: "conflict",
          code: conflictCode.invalidRevisionPatch,
          message: `invalid state after applying revision ${revision.id} to ${revision.targetId}: ${
            result.issues
              .map((issue) => issue.message).join(", ")
          }`,
        });
      }
      continue;
    }

    if (revision.targetKind === "relation") {
      let patched: Entry;
      try {
        patched = applyRelationPatch(entry, revision.patch, revision.id, findings);
        outputState.entries.set(revision.targetId, patched);
      } catch (error) {
        conflicts.push({
          kind: "conflict",
          code: conflictCode.invalidRevisionPatch,
          message: error instanceof Error ? error.message : "invalid relation revision",
        });
        continue;
      }

      const result = kindRegistry.validateEntry(patched);
      if (!result.ok) {
        conflicts.push({
          kind: "conflict",
          code: conflictCode.invalidRevisionPatch,
          message:
            `invalid state after applying relation revision ${revision.id} to ${revision.targetId}: ${
              result.issues
                .map((issue) => issue.message).join(", ")
            }`,
        });
      }
      continue;
    }

    findings.push({
      kind: "info",
      code: `compiler.revision.target_${revision.targetKind}_unsupported`,
      message: `revision target kind ${revision.targetKind} is not implemented`,
    });
  }

  return outputState;
}

function applyRelationPatch(
  entry: Entry,
  patch: Record<string, unknown>,
  revisionId: string,
  findings: Finding[],
): Entry {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error(`invalid relation revision ${revisionId}: patch must be an object`);
  }

  if (!("relations" in patch)) {
    throw new Error(
      `invalid relation revision ${revisionId}: patch must include a relations object`,
    );
  }

  const relationsPayload = patch.relations;
  if (
    !relationsPayload || typeof relationsPayload !== "object" || Array.isArray(relationsPayload)
  ) {
    throw new Error(
      `invalid relation revision ${revisionId}: patch.relations must be an object`,
    );
  }

  const output: Entry = {
    id: entry.id,
    family: entry.family,
    kind: entry.kind,
    name: entry.name,
    attributes: { ...entry.attributes },
    citations: [...entry.citations],
    relations: {},
  };

  for (const [kind, rawRelations] of Object.entries(relationsPayload)) {
    if (!Array.isArray(rawRelations)) {
      throw new Error(
        `invalid relation revision ${revisionId}: relations facet ${kind} must be an array`,
      );
    }

    const canonicalKind = canonicalizeRelationKind(kind, findings);

    const canonicalRelations = rawRelations
      .map((relation) => {
        const candidate = relation as { kind?: unknown; to?: unknown; citations?: unknown[] };
        if (typeof candidate.kind !== "string" || typeof candidate.to !== "string") {
          return null;
        }
        const relationKind = canonicalizeRelationKind(candidate.kind, findings);
        const citations = Array.isArray(candidate.citations)
          ? candidate.citations.filter(isCitationValue)
          : [];
        return {
          kind: relationKind,
          to: candidate.to,
          citations: sortUniqueCitations(citations),
        };
      })
      .filter((relation): relation is { kind: string; to: string; citations: CitationValue[] } =>
        relation !== null
      )
      .sort((left, right) => {
        if (left.kind === right.kind) return left.to.localeCompare(right.to);
        return left.kind.localeCompare(right.kind);
      });

    output.relations[canonicalKind] = dedupeRelations([
      ...(output.relations[canonicalKind] ?? []),
      ...canonicalRelations,
    ]);
  }

  output.relations = sortRelationMap(output.relations);

  return output;
}

function applyEntryPatch(
  entry: Entry,
  patch: Record<string, unknown>,
  findings: Finding[],
): Entry {
  const output: Entry = {
    id: entry.id,
    family: entry.family,
    kind: entry.kind,
    name: entry.name,
    attributes: { ...entry.attributes },
    citations: [...entry.citations],
    relations: { ...entry.relations },
  };

  if (typeof patch.kind === "string") {
    output.kind = patch.kind;
  }

  if (typeof patch.name === "string") {
    output.name = patch.name;
  }

  if (patch.family && typeof patch.family === "string") {
    output.family = patch.family;
  }

  if (
    patch.attributes && typeof patch.attributes === "object" && !Array.isArray(patch.attributes)
  ) {
    output.attributes = {
      ...output.attributes,
      ...(patch.attributes as Record<string, unknown>),
    };
  }

  if (Array.isArray(patch.citations)) {
    const normalized = patch.citations.filter((candidate): candidate is unknown =>
      isCitationValue(candidate)
    );
    if (normalized.length !== patch.citations.length) {
      findings.push({
        kind: "warn",
        code: "compiler.revision.patch_invalid_citation",
        message: "revision citations contained non-citation values; invalid entries were dropped",
      });
    }
    output.citations = sortUniqueCitations(normalized as CitationValue[]);
  }

  if (patch.relations && typeof patch.relations === "object" && !Array.isArray(patch.relations)) {
    output.relations = {};
    for (const [kind, rawRelations] of Object.entries(patch.relations)) {
      if (!Array.isArray(rawRelations)) continue;
      const canonicalKind = canonicalizeRelationKind(kind, findings);
      const canonicalRelations = rawRelations
        .map((relation) => {
          const candidate = relation as { kind?: unknown; to?: unknown; citations?: unknown[] };
          if (typeof candidate.kind !== "string" || typeof candidate.to !== "string") {
            return null;
          }
          const relationKind = canonicalizeRelationKind(candidate.kind, findings);

          const citations = Array.isArray(candidate.citations)
            ? candidate.citations.filter(isCitationValue)
            : [];

          return {
            kind: relationKind,
            to: candidate.to,
            citations,
          };
        })
        .filter((relation): relation is { kind: string; to: string; citations: CitationValue[] } =>
          relation !== null
        )
        .map((relation) => ({
          ...relation,
          citations: sortUniqueCitations(relation.citations),
        }))
        .sort((left, right) => {
          if (left.kind === right.kind) return left.to.localeCompare(right.to);
          return left.kind.localeCompare(right.kind);
        });

      output.relations[canonicalKind] = dedupeRelations([
        ...(output.relations[canonicalKind] ?? []),
        ...canonicalRelations,
      ]);
    }
  }

  output.citations = sortUniqueCitations(output.citations);
  output.attributes = sortObjectKeys(output.attributes);
  output.relations = sortRelationMap(output.relations);
  return output;
}

function canonicalizeRelationKind(kind: string, findings: Finding[]): string {
  const migrated = relationKindMigrations[kind];
  if (!migrated || migrated === kind) return kind;
  findings.push({
    kind: "warn",
    code: "compiler.relation_kind_deprecated",
    message: `relation kind ${kind} was migrated to ${migrated} during compile`,
  });
  return migrated;
}

function sortUniqueCitations(citations: CitationValue[]): CitationValue[] {
  const seen = new Set<string>();
  const unique: CitationValue[] = [];
  for (const citation of citations) {
    if (!isCitationValue(citation)) continue;
    const key = citationIdentity(citation);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(citation);
  }
  return unique.sort((left, right) => {
    return citationIdentity(left).localeCompare(citationIdentity(right));
  });
}

function citationIdentity(citation: CitationValue): string {
  if ("source" in citation) {
    return [
      "source",
      citation.source,
      citation.sourceRecordId,
      citation.locator ?? "",
      citation.url ?? "",
    ].join(":");
  }
  return `uncited:${citation.reason ?? ""}`;
}

function validateAndSortState(
  state: LedgerState,
  kindRegistry: KindRegistry,
  conflicts: Finding[],
): LedgerState {
  for (const [entryId, entry] of state.entries) {
    entry.relations = sortRelationMap(entry.relations);
    entry.citations = sortUniqueCitations(entry.citations);
  }

  const ordered = new Map<string, Entry>();
  for (const key of [...state.entries.keys()].sort()) {
    const entry = state.entries.get(key);
    if (!entry) continue;
    ordered.set(key, entry);
  }

  const output: LedgerState = {
    jurisdiction: state.jurisdiction,
    generatedAt: state.generatedAt,
    findings: [...state.findings],
    entries: ordered,
  };

  for (const issue of output.entries.values()) {
    const validationResult = kindRegistry.validateEntry(issue);
    if (!validationResult.ok) {
      for (const issueResult of validationResult.issues) {
        conflicts.push({
          kind: "conflict",
          code: issueResult.code,
          message: `state validation failed for ${issue.id}: ${issueResult.message}`,
        });
      }
    }
  }
  return output;
}

function sortObjectKeys(source: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    output[key] = source[key];
  }
  return output;
}

function sortRelationMap(
  relations: Record<string, Array<MutableRelationShape>>,
): Record<string, Array<{ kind: string; to: string; citations: CitationValue[] }>> {
  const output: Record<string, Array<{ kind: string; to: string; citations: CitationValue[] }>> =
    {};
  for (const key of Object.keys(relations).sort()) {
    output[key] = [...relations[key]].sort((left, right) => {
      if (left.kind === right.kind) return left.to.localeCompare(right.to);
      return left.kind.localeCompare(right.kind);
    }).map((relation) => ({
      ...relation,
      citations: sortUniqueCitations(relation.citations ?? []),
    }));
  }
  return output;
}
