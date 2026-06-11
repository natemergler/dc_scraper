import { type CitationValue, type Entry, type LedgerState } from "../core/types.ts";

export interface ReconciliationCandidateEntry {
  id: string;
  family: string;
  kind: string;
  name: string;
  sources: string[];
  citations: CitationValue[];
  attributes: Record<string, unknown>;
  relations: Record<string, Array<{ kind: string; to: string; citations?: CitationValue[] }>>;
}

export interface ReconciliationCandidatePacket {
  id: string;
  reason: "same_normalized_name" | "shared_url" | "shared_legal_locator";
  matchKey: string;
  risks: string[];
  entries: ReconciliationCandidateEntry[];
}

export interface ReconciliationCandidateReport {
  generatedAt: string;
  candidateCount: number;
  candidates: ReconciliationCandidatePacket[];
}

export interface FindReconciliationCandidatesOptions {
  generatedAt?: string;
  limit?: number;
}

type CandidateReason = ReconciliationCandidatePacket["reason"];

interface CandidateGroup {
  reason: CandidateReason;
  matchKey: string;
  entries: Entry[];
}

const URL_ATTRIBUTE_RE = /(?:^|_)(?:url|uri)$/i;

export function findReconciliationCandidates(
  state: LedgerState,
  options: FindReconciliationCandidatesOptions = {},
): ReconciliationCandidateReport {
  const groups: CandidateGroup[] = [
    ...groupsForEntryKey(state, "same_normalized_name", (entry) => normalizeName(entry.name)),
    ...groupsForEntryKey(state, "shared_url", (entry) => collectUrls(entry)),
    ...groupsForEntryKey(state, "shared_legal_locator", (entry) => collectLegalLocators(entry)),
  ];

  const candidates = groups
    .map((group) => toPacket(group))
    .sort(comparePackets);
  const limited = typeof options.limit === "number"
    ? candidates.slice(0, options.limit)
    : candidates;

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    candidateCount: candidates.length,
    candidates: limited,
  };
}

function groupsForEntryKey(
  state: LedgerState,
  reason: CandidateReason,
  keyer: (entry: Entry) => string | string[] | null,
): CandidateGroup[] {
  const keyedEntries = new Map<string, Entry[]>();
  for (const entry of state.entries.values()) {
    const rawKeys = keyer(entry);
    const keys = Array.isArray(rawKeys) ? rawKeys : rawKeys ? [rawKeys] : [];
    for (const key of keys) {
      if (!key) continue;
      const entries = keyedEntries.get(key) ?? [];
      entries.push(entry);
      keyedEntries.set(key, entries);
    }
  }

  const groups: CandidateGroup[] = [];
  for (const [matchKey, entries] of keyedEntries.entries()) {
    const unique = uniqueEntries(entries);
    if (unique.length < 2) continue;
    groups.push({
      reason,
      matchKey,
      entries: unique.sort((left, right) => left.id.localeCompare(right.id)),
    });
  }
  return groups;
}

function toPacket(group: CandidateGroup): ReconciliationCandidatePacket {
  const packetId = `${group.reason}:${stableKey(group.matchKey)}`;
  return {
    id: packetId,
    reason: group.reason,
    matchKey: group.matchKey,
    risks: collectRisks(group.entries),
    entries: group.entries.map(toCandidateEntry),
  };
}

function toCandidateEntry(entry: Entry): ReconciliationCandidateEntry {
  return {
    id: entry.id,
    family: entry.family,
    kind: entry.kind,
    name: entry.name,
    sources: collectSources(entry),
    citations: entry.citations,
    attributes: entry.attributes,
    relations: entry.relations,
  };
}

function collectSources(entry: Entry): string[] {
  const sources = new Set<string>();
  for (const citation of entry.citations) {
    if ("source" in citation) {
      sources.add(citation.source);
    }
  }
  for (const relations of Object.values(entry.relations)) {
    for (const relation of relations) {
      for (const citation of relation.citations ?? []) {
        if ("source" in citation) {
          sources.add(citation.source);
        }
      }
    }
  }
  return [...sources].sort();
}

function collectRisks(entries: Entry[]): string[] {
  const risks = new Set<string>();
  const kinds = new Set(entries.map((entry) => entry.kind));
  const families = new Set(entries.map((entry) => entry.family));
  const sourceSets = entries.map(collectSources);
  const sourceUnion = new Set(sourceSets.flat());

  if (kinds.size > 1) {
    risks.add("kind_conflict");
  }
  if (families.size > 1) {
    risks.add("family_conflict");
  }
  if (sourceUnion.size > 1) {
    risks.add("cross_source_shadow");
  } else if (sourceUnion.size === 1 && entries.length > 1) {
    risks.add("same_source_duplicate");
  }
  if (entries.some((entry) => Object.keys(entry.relations).length > 0)) {
    risks.add("relation_review_needed");
  }

  return [...risks].sort();
}

function normalizeName(name: string): string | null {
  const normalized = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function collectUrls(entry: Entry): string[] {
  const urls = new Set<string>();
  for (const value of Object.values(entry.attributes)) {
    if (typeof value === "string" && looksLikeUrl(value)) {
      urls.add(normalizeUrl(value));
    }
  }
  for (const [key, value] of Object.entries(entry.attributes)) {
    if (typeof value === "string" && URL_ATTRIBUTE_RE.test(key)) {
      urls.add(normalizeUrl(value));
    }
  }
  for (const citation of entry.citations) {
    if ("url" in citation && citation.url) {
      urls.add(normalizeUrl(citation.url));
    }
  }
  return [...urls].filter(Boolean).sort();
}

function collectLegalLocators(entry: Entry): string[] {
  const locators = new Set<string>();
  for (const citation of entry.citations) {
    if ("locator" in citation && citation.locator) {
      locators.add(normalizeLocator(citation.locator));
    }
  }
  return [...locators].filter(Boolean).sort();
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeLocator(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueEntries(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  const unique: Entry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    unique.push(entry);
  }
  return unique;
}

function stableKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function comparePackets(left: ReconciliationCandidatePacket, right: ReconciliationCandidatePacket) {
  if (left.reason === right.reason) {
    return left.matchKey.localeCompare(right.matchKey);
  }
  return left.reason.localeCompare(right.reason);
}
