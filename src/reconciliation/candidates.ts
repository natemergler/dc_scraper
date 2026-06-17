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
  severity: "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  reviewCategory:
    | "kind_conflict"
    | "source_shadow"
    | "same_source_duplicate"
    | "relation_endpoint_review"
    | "locator_or_url_overlap";
  risks: string[];
  sourceFamilies: string[];
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
  ].filter((group) => !isDetectorNoise(group));

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
  const risks = collectRisks(group.entries);
  return {
    id: packetId,
    reason: group.reason,
    matchKey: group.matchKey,
    severity: classifySeverity(group.reason, risks),
    confidence: classifyConfidence(group.reason, risks),
    reviewCategory: classifyReviewCategory(group.reason, risks),
    risks,
    sourceFamilies: collectSourceFamilies(group.entries),
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

function collectSourceFamilies(entries: Entry[]): string[] {
  const sourceFamilies = new Set<string>();
  for (const entry of entries) {
    for (const source of collectSources(entry)) {
      const family = source.includes(".") ? source.split(".")[0] : source;
      sourceFamilies.add(family);
    }
  }
  return [...sourceFamilies].sort();
}

function classifySeverity(
  reason: CandidateReason,
  risks: string[],
): ReconciliationCandidatePacket["severity"] {
  if (risks.includes("kind_conflict") || risks.includes("family_conflict")) {
    return "high";
  }
  if (risks.includes("cross_source_shadow") && risks.includes("relation_review_needed")) {
    return "high";
  }
  if (reason === "shared_legal_locator" || risks.includes("cross_source_shadow")) {
    return "medium";
  }
  return "low";
}

function classifyConfidence(
  reason: CandidateReason,
  risks: string[],
): ReconciliationCandidatePacket["confidence"] {
  if (reason === "same_normalized_name" || reason === "shared_legal_locator") {
    return "high";
  }
  if (risks.includes("same_source_duplicate")) {
    return "medium";
  }
  return "low";
}

function classifyReviewCategory(
  reason: CandidateReason,
  risks: string[],
): ReconciliationCandidatePacket["reviewCategory"] {
  if (risks.includes("kind_conflict") || risks.includes("family_conflict")) {
    return "kind_conflict";
  }
  if (risks.includes("cross_source_shadow")) {
    return "source_shadow";
  }
  if (risks.includes("same_source_duplicate")) {
    return "same_source_duplicate";
  }
  if (risks.includes("relation_review_needed")) {
    return "relation_endpoint_review";
  }
  if (reason === "shared_url" || reason === "shared_legal_locator") {
    return "locator_or_url_overlap";
  }
  return "source_shadow";
}

function isDetectorNoise(group: CandidateGroup): boolean {
  if (group.reason !== "shared_url") {
    return false;
  }
  if (group.entries.every((entry) => entry.kind === "dc.legal_authority")) {
    return true;
  }
  if (isAuthorizedLegalAuthorityUrlGroup(group.entries)) {
    return true;
  }
  if (isCourtDiscoveryUrlGroup(group.entries, group.matchKey)) {
    return true;
  }
  if (isAncSupportUrlGroup(group.entries, group.matchKey)) {
    return true;
  }
  const families = new Set(group.entries.map((entry) => entry.family));
  const kinds = new Set(group.entries.map((entry) => entry.kind));
  const sourceFamilies = new Set(group.entries.flatMap(collectSources));

  if (sourceFamilies.size === 1 && kinds.size === 1 && group.entries.length > 2) {
    return true;
  }

  return families.size === 1 && families.has("area") && kinds.size === 1 &&
    sourceFamilies.size === 1;
}

function isAuthorizedLegalAuthorityUrlGroup(entries: Entry[]): boolean {
  const legalAuthorityIds = new Set(
    entries
      .filter((entry) => entry.kind === "dc.legal_authority")
      .map((entry) => entry.id),
  );
  if (legalAuthorityIds.size === 0) {
    return false;
  }

  return entries.every((entry) => {
    if (entry.kind === "dc.legal_authority") {
      return true;
    }
    const authorizedBy = entry.relations["dc.relation:authorized_by"] ?? [];
    return authorizedBy.some((relation) => legalAuthorityIds.has(relation.to));
  });
}

function isCourtDiscoveryUrlGroup(entries: Entry[], matchKey: string): boolean {
  const courts = entries.filter((entry) => entry.kind === "dc.court");
  const divisions = entries.filter((entry) => entry.kind === "dc.court_division");
  if (
    courts.length === 0 || divisions.length === 0 ||
    courts.length + divisions.length !== entries.length
  ) {
    return false;
  }

  const normalizedMatchKey = normalizeUrl(matchKey);
  const courtIds = new Set(courts.map((entry) => entry.id));
  const courtUrls = new Set(
    courts
      .flatMap((entry) => [entry.attributes.officialUrl, entry.attributes.sourcePageUrl])
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map(normalizeUrl),
  );
  if (!courtUrls.has(normalizedMatchKey)) {
    return false;
  }

  return divisions.every((entry) => {
    const discoveryUrl = entry.attributes.sourceDiscoveryPageUrl;
    if (typeof discoveryUrl !== "string" || normalizeUrl(discoveryUrl) !== normalizedMatchKey) {
      return false;
    }
    const parentRelations = entry.relations["dc.relation:part_of"] ?? [];
    return parentRelations.some((relation) => courtIds.has(relation.to));
  });
}

function isAncSupportUrlGroup(entries: Entry[], matchKey: string): boolean {
  const ancs = entries.filter((entry) => entry.kind === "dc.anc");
  const smds = entries.filter((entry) => entry.kind === "dc.smd");
  const seats = entries.filter((entry) => entry.kind === "dc.anc_commissioner_seat");
  if (
    ancs.length !== 1 ||
    smds.length + seats.length === 0 ||
    ancs.length + smds.length + seats.length !== entries.length
  ) {
    return false;
  }

  const anc = ancs[0];
  const normalizedMatchKey = normalizeUrl(matchKey);
  const ancSourceAncId = typeof anc.attributes.sourceAncId === "string"
    ? anc.attributes.sourceAncId
    : null;
  const ancUrls = new Set(
    [
      anc.attributes.officialUrl,
      anc.attributes.webUrl,
      anc.attributes.sourceOancProfileUrl,
    ]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map(normalizeUrl)
      .filter(Boolean),
  );
  if (!ancSourceAncId || !ancUrls.has(normalizedMatchKey)) {
    return false;
  }

  const smdsMatch = smds.every((smd) => {
    const smdSourceAncId = typeof smd.attributes.sourceAncId === "string"
      ? smd.attributes.sourceAncId
      : null;
    const smdWebUrl = typeof smd.attributes.webUrl === "string"
      ? normalizeUrl(smd.attributes.webUrl)
      : "";
    return smdSourceAncId === ancSourceAncId && smdWebUrl === normalizedMatchKey;
  });
  if (!smdsMatch) {
    return false;
  }

  return seats.every((seat) => {
    const seatSourceAncId = typeof seat.attributes.sourceAncId === "string"
      ? seat.attributes.sourceAncId
      : null;
    const seatProfileUrl = typeof seat.attributes.sourceOancProfileUrl === "string"
      ? normalizeUrl(seat.attributes.sourceOancProfileUrl)
      : "";
    return seatSourceAncId === ancSourceAncId &&
      seatProfileUrl === normalizedMatchKey;
  });
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
