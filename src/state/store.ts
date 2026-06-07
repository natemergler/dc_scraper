import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import {
  type BaseRelation,
  type CitationValue,
  type Entry,
  isCitationValue,
  type LedgerState,
} from "../core/types.ts";
import { KindRegistry } from "../core/kinds.ts";
import { validateStateEntries } from "./validation.ts";

export interface StateStoreResult {
  state: LedgerState;
  backlinks: Map<string, BaseRelation[]>;
}

export async function writeCommittedState(state: LedgerState, stateRoot: string): Promise<void> {
  const entriesDir = join(stateRoot, "entries");
  await ensureDir(entriesDir);
  const expectedEntryFiles = new Set(Array.from(state.entries.keys()).map((id) => `${id}.json`));
  for await (const candidate of Deno.readDir(entriesDir)) {
    if (
      candidate.isFile && candidate.name.endsWith(".json") &&
      !expectedEntryFiles.has(candidate.name)
    ) {
      await Deno.remove(join(entriesDir, candidate.name));
    }
  }

  const entries = Array.from(state.entries.values()).sort((left, right) =>
    left.id.localeCompare(right.id)
  );

  for (const entry of entries) {
    const normalized = normalizeStoredEntry(entry);
    const outputPath = join(entriesDir, `${entry.id}.json`);
    const payload = JSON.stringify(normalized, null, 2) + "\n";
    await Deno.writeTextFile(outputPath, payload);
  }
}

export async function loadCommittedState(
  stateRoot: string,
  registry: KindRegistry,
): Promise<StateStoreResult> {
  const entriesDir = join(stateRoot, "entries");
  const entries: Map<string, Entry> = new Map();
  const backlinks = new Map<string, BaseRelation[]>();
  let hasEntries = false;

  await Deno.mkdir(entriesDir, { recursive: true });
  for await (const candidate of Deno.readDir(entriesDir)) {
    if (!candidate.isFile || !candidate.name.endsWith(".json")) {
      continue;
    }

    const filePath = join(entriesDir, candidate.name);
    const fileText = await Deno.readTextFile(filePath);
    const raw = JSON.parse(fileText);
    const entry = parseStoredEntry(raw, candidate.name);
    entries.set(entry.id, entry);
    hasEntries = true;
  }

  if (!hasEntries) {
    return {
      state: { jurisdiction: "", generatedAt: "", entries: new Map(), findings: [] },
      backlinks,
    };
  }

  const validation = validateStateEntries(entries, registry);
  if (!validation.ok) {
    throw new Error(
      `state validation failed: ${validation.issues.map((issue) => issue.message).join(", ")}`,
    );
  }

  for (const entry of entries.values()) {
    for (const relations of Object.values(entry.relations)) {
      for (const relation of relations) {
        const backlink: BaseRelation = {
          kind: relation.kind,
          to: entry.id,
          citations: relation.citations ?? [],
        };
        const current = backlinks.get(relation.to) ?? [];
        current.push(backlink);
        backlinks.set(relation.to, current);
      }
    }
  }

  for (const list of backlinks.values()) {
    list.sort((left, right) => {
      if (left.kind === right.kind) return left.to.localeCompare(right.to);
      return left.kind.localeCompare(right.kind);
    });
    list.forEach((relation) => {
      relation.citations = sortCitations(relation.citations ?? []);
    });
  }

  for (const entry of entries.values()) {
    entry.relations = normalizeRelationsForMemory(entry.relations);
  }

  const generatedAt = new Date().toISOString();
  return {
    state: {
      jurisdiction: "",
      generatedAt,
      entries,
      findings: [],
    },
    backlinks,
  };
}

const citationCompare = (left: CitationValue, right: CitationValue): number => {
  const leftSource = "source" in left ? `${left.source}:${left.sourceRecordId}` : "uncited";
  const rightSource = "source" in right ? `${right.source}:${right.sourceRecordId}` : "uncited";
  return leftSource.localeCompare(rightSource);
};

const sortCitations = (citations: CitationValue[] = []): CitationValue[] => {
  return [...citations].sort(citationCompare);
};

function normalizeRelationsForMemory(
  relations: Record<string, BaseRelation[]>,
): Record<string, BaseRelation[]> {
  const normalized: Record<string, BaseRelation[]> = {};
  const facetNames = Object.keys(relations ?? {}).sort();
  for (const facet of facetNames) {
    const outgoing = (relations[facet] ?? []).map((relation) => ({
      kind: relation.kind,
      to: relation.to,
      citations: sortCitations(relation.citations ?? []),
    }));

    normalized[facet] = outgoing.sort((left, right) => {
      if (left.kind === right.kind) return left.to.localeCompare(right.to);
      return left.kind.localeCompare(right.kind);
    });
  }

  return normalized;
}

function normalizeStoredEntry(entry: Entry) {
  const attributes = Object.keys(entry.attributes ?? {}).sort().reduce((acc, key) => {
    acc[key] = entry.attributes[key];
    return acc;
  }, {} as Record<string, unknown>);

  const relations = normalizeRelationsForMemory(entry.relations ?? {});
  const citations = sortCitations(entry.citations ?? []);

  return {
    id: entry.id,
    family: entry.family,
    kind: entry.kind,
    name: entry.name,
    attributes,
    citations,
    relations,
  };
}

function parseStoredEntry(raw: unknown, fileName: string): Entry {
  if (!raw || typeof raw !== "object") {
    throw new Error(`entry file ${fileName} is not an object`);
  }

  const candidate = raw as Record<string, unknown>;

  if (typeof candidate.id !== "string") {
    throw new Error(`entry file ${fileName} missing id`);
  }

  if (typeof candidate.family !== "string") {
    throw new Error(`entry file ${fileName} missing family`);
  }

  if (typeof candidate.kind !== "string") {
    throw new Error(`entry file ${fileName} missing kind`);
  }

  if (typeof candidate.name !== "string") {
    throw new Error(`entry file ${fileName} missing name`);
  }

  if (!Array.isArray(candidate.citations)) {
    throw new Error(`entry file ${fileName} missing citations`);
  }
  const citations = candidate.citations as unknown[];
  if (!citations.every(isCitationValue)) {
    throw new Error(`entry file ${fileName} has invalid citations`);
  }

  const relations = parseStoredRelations(candidate.relations);

  return {
    id: candidate.id,
    family: candidate.family,
    kind: candidate.kind,
    name: candidate.name,
    attributes: typeof candidate.attributes === "object" && candidate.attributes !== null
      ? candidate.attributes as Record<string, unknown>
      : {},
    citations: candidate.citations as CitationValue[],
    relations,
  };
}

function parseStoredRelations(raw: unknown): Record<string, BaseRelation[]> {
  if (!raw) return {};
  if (typeof raw !== "object") {
    throw new Error("relations must be an object");
  }
  const relations: Record<string, BaseRelation[]> = {};
  for (const [facet, rawRelations] of Object.entries(raw)) {
    if (!Array.isArray(rawRelations)) {
      throw new Error(`relation facet ${facet} must be an array`);
    }
    relations[facet] = rawRelations.map((rawRelation) => {
      if (!rawRelation || typeof rawRelation !== "object") {
        throw new Error(`invalid relation in facet ${facet}`);
      }
      const candidate = rawRelation as Record<string, unknown>;
      if (typeof candidate.kind !== "string" || typeof candidate.to !== "string") {
        throw new Error(`relation in facet ${facet} missing kind/to`);
      }
      const relationCitations = candidate.citations as unknown[] | undefined;
      if (relationCitations && !Array.isArray(relationCitations)) {
        throw new Error(`citations for relation ${facet}/${candidate.kind} must be an array`);
      }
      if (relationCitations && !relationCitations.every(isCitationValue)) {
        throw new Error(`relation citations in ${facet}/${candidate.kind} are invalid`);
      }

      return {
        kind: candidate.kind,
        to: candidate.to,
        citations: relationCitations ? relationCitations as CitationValue[] : [],
      };
    });
  }
  return relations;
}
