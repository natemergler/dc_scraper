import {
  type CitationValue,
  type Finding,
  isCitationValue,
  type LedgerState,
  type Revision,
} from "../core/types.ts";
import {
  findReconciliationCandidates,
  type ReconciliationCandidateEntry,
  type ReconciliationCandidatePacket,
} from "../reconciliation/candidates.ts";
import type { DraftRevision } from "../revisions/drafts.ts";

export type ReviewCategory =
  | "identity_conflict"
  | "kind_conflict"
  | "source_shadow"
  | "alias_candidate"
  | "same_source_duplicate"
  | "relation_endpoint_missing"
  | "legal_authority_ambiguous"
  | "source_stale_or_failed"
  | "incomplete_entry"
  | "out_of_scope_candidate"
  | "preserve_distinct_candidate";

export type ReviewSeverity = "high" | "medium" | "low";
export type ReviewConfidence = "high" | "medium" | "low";

export type ReviewClassification =
  | "source_ingestion_bug"
  | "compiler_rule_bug"
  | "curation_conflict"
  | "missing_source_coverage"
  | "out_of_scope"
  | "legal_authority_ambiguity";

export type ReviewResolutionType =
  | "preserve-distinct"
  | "source-shadow"
  | "alias"
  | "suppress"
  | "override-kind";

export type ReviewStatus = "open" | "drafted" | "applied";

export interface ReviewAffectedRef {
  fragmentIds: string[];
  baselineIds: string[];
  stateIds: string[];
  relationEndpoints: Array<{ from: string; kind: string; to: string }>;
}

export interface ReviewItem {
  id: string;
  category: ReviewCategory;
  classification: ReviewClassification;
  severity: ReviewSeverity;
  confidence: ReviewConfidence;
  status: ReviewStatus;
  title: string;
  summary: string;
  sourceFamilies: string[];
  affected: ReviewAffectedRef;
  candidateEntries: ReconciliationCandidateEntry[];
  sourceRefs: CitationValue[];
  citations: CitationValue[];
  urls: string[];
  legalLocators: string[];
  attributesThatAgree: Record<string, unknown>;
  attributesThatConflict: Record<string, unknown>;
  suggestedResolutions: ReviewResolutionType[];
  blocks: {
    stateGeneration: boolean;
    releaseReadiness: boolean;
  };
  draftRevisionIds: string[];
  trackedRevisionIds: string[];
  rationale: string;
  generatedAt: string;
  source: {
    type: "reconciliation_candidate" | "finding" | "tracked_revision";
    id: string;
    reason?: string;
    matchKey?: string;
    risks?: string[];
  };
}

export interface GenerateReviewItemsOptions {
  trackedRevisions?: Revision[];
  draftRevisions?: DraftRevision[];
  generatedAt?: string;
}

export function generateReviewItems(
  state: LedgerState,
  findings: Finding[] = [],
  options: GenerateReviewItemsOptions = {},
): ReviewItem[] {
  const generatedAt = options.generatedAt ?? state.generatedAt;
  const report = findReconciliationCandidates(state, { generatedAt });
  const items = report.candidates.map((candidate) =>
    reviewItemFromCandidate(candidate, generatedAt)
  );
  items.push(...ancProfileBoundaryItems(state, generatedAt));

  for (const finding of findings) {
    const item = reviewItemFromFinding(finding, generatedAt);
    if (item) {
      items.push(item);
    }
  }

  applyRevisionAwareness(items, options.trackedRevisions ?? [], options.draftRevisions ?? []);

  const existingIds = new Set(items.map((item) => item.id));
  for (const revision of options.trackedRevisions ?? []) {
    const item = reviewItemFromTrackedRevision(revision, generatedAt);
    if (!item || existingIds.has(item.id)) {
      continue;
    }
    items.push(item);
    existingIds.add(item.id);
  }

  return items.sort(compareReviewItems);
}

function ancProfileBoundaryItems(state: LedgerState, generatedAt: string): ReviewItem[] {
  const ancEntries = [...state.entries.values()].filter((entry) => entry.kind === "dc.anc");
  const bySourceAncId = new Map<string, typeof ancEntries[number]>();
  for (const entry of ancEntries) {
    const sourceAncId = entry.attributes.sourceAncId;
    if (typeof sourceAncId === "string") {
      bySourceAncId.set(sourceAncId.toUpperCase(), entry);
    }
  }

  const items: ReviewItem[] = [];
  for (const entry of ancEntries) {
    const sourceAncId = entry.attributes.sourceAncId;
    const profileUrl = entry.attributes.sourceOancProfileUrl;
    if (
      typeof sourceAncId !== "string" ||
      typeof profileUrl !== "string" ||
      !sourceAncId.includes("/")
    ) {
      continue;
    }

    const suffix = sourceAncId.split("/").at(-1)?.toUpperCase();
    if (!suffix) {
      continue;
    }
    const sibling = bySourceAncId.get(suffix);
    if (!sibling || sibling.id === entry.id) {
      continue;
    }

    const candidateEntries: ReconciliationCandidateEntry[] = [entry, sibling]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((candidate) => ({
        id: candidate.id,
        family: candidate.family,
        kind: candidate.kind,
        name: candidate.name,
        sources: collectSourcesForEntry(candidate),
        citations: candidate.citations,
        attributes: candidate.attributes,
        relations: candidate.relations,
      }));
    const citations = collectCitations(candidateEntries);
    const stateIds = candidateEntries.map((candidate) => candidate.id).sort();
    const sourceFamilies = uniqueSorted(
      candidateEntries.flatMap((candidate) => candidate.sources.map(sourceFamily)),
    );
    const id = `anc_profile_boundary:${stableReviewKey(sourceAncId)}:${stableReviewKey(suffix)}`;

    items.push({
      id,
      category: "identity_conflict",
      classification: "curation_conflict",
      severity: "medium",
      confidence: "medium",
      status: "open",
      title: `identity conflict: ANC ${sourceAncId} vs ANC ${suffix}`,
      summary:
        `OANC profile ${sourceAncId} appears adjacent to DCGIS ANC ${suffix}; this needs review before aliasing, preserving, or treating either source as stale.`,
      sourceFamilies,
      affected: {
        fragmentIds: [],
        baselineIds: stateIds,
        stateIds,
        relationEndpoints: collectRelationEndpoints(candidateEntries),
      },
      candidateEntries,
      sourceRefs: citations,
      citations,
      urls: collectUrls(candidateEntries, citations),
      legalLocators: collectLegalLocators(citations),
      attributesThatAgree: {
        sourceAncIdSuffix: suffix,
      },
      attributesThatConflict: {
        sourceAncIds: uniqueSorted(
          candidateEntries.map((candidate) => String(candidate.attributes.sourceAncId ?? "")),
        ),
        sources: uniqueSorted(candidateEntries.flatMap((candidate) => candidate.sources)),
      },
      suggestedResolutions: ["alias", "preserve-distinct", "source-shadow", "suppress"],
      blocks: {
        stateGeneration: false,
        releaseReadiness: true,
      },
      draftRevisionIds: [],
      trackedRevisionIds: [],
      rationale:
        "OANC profile evidence and DCGIS ANC boundary evidence use overlapping labels but do not prove the same canonical entry without operator review.",
      generatedAt,
      source: {
        type: "reconciliation_candidate",
        id,
        reason: "anc_profile_boundary",
        matchKey: `${sourceAncId}|${suffix}`,
        risks: ["identity_conflict", "cross_source_shadow"],
      },
    });
  }

  return items;
}

export function validateReviewItem(value: unknown, path = "review item"): ReviewItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid ${path}: review item must be an object`);
  }

  const item = value as ReviewItem;
  requireString(item.id, path, "id");
  requireString(item.category, path, "category");
  requireString(item.classification, path, "classification");
  requireString(item.severity, path, "severity");
  requireString(item.confidence, path, "confidence");
  requireString(item.status, path, "status");
  requireString(item.title, path, "title");
  requireString(item.summary, path, "summary");
  requireString(item.rationale, path, "rationale");
  requireString(item.generatedAt, path, "generatedAt");
  if (!Array.isArray(item.sourceFamilies)) {
    throw new Error(`invalid ${path}: sourceFamilies must be an array`);
  }
  if (!Array.isArray(item.candidateEntries)) {
    throw new Error(`invalid ${path}: candidateEntries must be an array`);
  }
  if (!Array.isArray(item.suggestedResolutions)) {
    throw new Error(`invalid ${path}: suggestedResolutions must be an array`);
  }
  if (!item.source || typeof item.source !== "object" || Array.isArray(item.source)) {
    throw new Error(`invalid ${path}: source must be an object`);
  }
  return item;
}

export function reviewItemFileName(id: string): string {
  return `${stableReviewIdSegment(id, 120)}.json`;
}

export function stableReviewKey(value: string): string {
  const key = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return key.length > 0 ? key : "item";
}

export function stableReviewIdSegment(value: string, maxSlugLength = 80): string {
  const slug = stableReviewKey(value).slice(0, maxSlugLength).replace(/-$/g, "");
  return `${slug}-${shortHash(value)}`;
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function reviewItemFromCandidate(
  candidate: ReconciliationCandidatePacket,
  generatedAt: string,
): ReviewItem {
  const stateIds = candidate.entries.map((entry) => entry.id).sort();
  const citations = collectCitations(candidate.entries);
  const category = categoryFromCandidate(candidate);
  const classification = classificationFromCandidate(candidate, category);
  const relations = collectRelationEndpoints(candidate.entries);
  const title = `${humanCategory(category)}: ${candidate.matchKey}`;
  const summary = summarizeCandidate(candidate);

  return {
    id: candidate.id,
    category,
    classification,
    severity: candidate.severity,
    confidence: candidate.confidence,
    status: "open",
    title,
    summary,
    sourceFamilies: candidate.sourceFamilies,
    affected: {
      fragmentIds: [],
      baselineIds: stateIds,
      stateIds,
      relationEndpoints: relations,
    },
    candidateEntries: candidate.entries,
    sourceRefs: citations,
    citations,
    urls: collectUrls(candidate.entries, citations),
    legalLocators: collectLegalLocators(citations),
    attributesThatAgree: attributesThatAgree(candidate),
    attributesThatConflict: attributesThatConflict(candidate),
    suggestedResolutions: suggestedResolutionsFor(category),
    blocks: {
      stateGeneration: false,
      releaseReadiness: candidate.severity === "high" || category === "legal_authority_ambiguous",
    },
    draftRevisionIds: [],
    trackedRevisionIds: [],
    rationale: rationaleForCandidate(candidate, category, classification),
    generatedAt,
    source: {
      type: "reconciliation_candidate",
      id: candidate.id,
      reason: candidate.reason,
      matchKey: candidate.matchKey,
      risks: candidate.risks,
    },
  };
}

function reviewItemFromFinding(finding: Finding, generatedAt: string): ReviewItem | null {
  const category = categoryFromFinding(finding);
  if (!category) {
    return null;
  }

  const citation = finding.citation && isCitationValue(finding.citation) ? finding.citation : null;
  const citations = citation ? [citation] : [];
  const id = `finding:${stableReviewKey(finding.code)}:${stableReviewKey(finding.message)}`;

  return {
    id,
    category,
    classification: classificationFromFinding(finding, category),
    severity: finding.kind === "conflict" ? "high" : "medium",
    confidence: "medium",
    status: "open",
    title: `${humanCategory(category)}: ${finding.code}`,
    summary: finding.message,
    sourceFamilies: citation && "source" in citation ? [sourceFamily(citation.source)] : [],
    affected: {
      fragmentIds: [],
      baselineIds: [],
      stateIds: [],
      relationEndpoints: [],
    },
    candidateEntries: [],
    sourceRefs: citations,
    citations,
    urls: collectUrls([], citations),
    legalLocators: collectLegalLocators(citations),
    attributesThatAgree: {},
    attributesThatConflict: { findingCode: finding.code },
    suggestedResolutions: suggestedResolutionsFor(category),
    blocks: {
      stateGeneration: finding.kind === "conflict",
      releaseReadiness: true,
    },
    draftRevisionIds: [],
    trackedRevisionIds: [],
    rationale:
      "Compiler or interpreter finding promoted into a review item so the operator can classify it before deciding whether this is a code fix, source gap, or curation decision.",
    generatedAt,
    source: {
      type: "finding",
      id: id,
    },
  };
}

function reviewItemFromTrackedRevision(
  revision: Revision,
  generatedAt: string,
): ReviewItem | null {
  const patch = revision.patch;
  const review = patch.review && typeof patch.review === "object" && !Array.isArray(patch.review)
    ? patch.review as Record<string, unknown>
    : null;

  let category: ReviewCategory | null = null;
  let summary = "";
  let suggestedResolutions: ReviewResolutionType[] = [];
  const affectedIds = new Set<string>([revision.targetId]);

  if (patch.suppress === true) {
    category = "source_shadow";
    summary = `Applied suppression revision for ${revision.targetId}.`;
    suggestedResolutions = ["source-shadow", "suppress", "preserve-distinct"];
  } else if (review) {
    const decision = review.decision;
    if (decision === "preserve_distinct") {
      category = "preserve_distinct_candidate";
      summary = `Applied preserve-distinct review for ${revision.targetId}.`;
      suggestedResolutions = ["preserve-distinct", "source-shadow", "alias"];
    } else if (decision === "source_shadow") {
      category = "source_shadow";
      summary = `Applied source-shadow review for ${revision.targetId}.`;
      suggestedResolutions = ["source-shadow", "preserve-distinct", "suppress"];
    } else if (decision === "alias") {
      category = "alias_candidate";
      summary = `Applied alias review for ${revision.targetId}.`;
      suggestedResolutions = ["alias", "preserve-distinct", "source-shadow"];
    }

    const relatedEntryIds = review.relatedEntryIds;
    if (Array.isArray(relatedEntryIds)) {
      for (const id of relatedEntryIds) {
        if (typeof id === "string") affectedIds.add(id);
      }
    }
    const canonicalEntryId = review.canonicalEntryId;
    if (typeof canonicalEntryId === "string") {
      affectedIds.add(canonicalEntryId);
    }
  } else if (revision.targetKind === "relation") {
    category = "relation_endpoint_missing";
    summary = `Applied relation retargeting revision for ${revision.targetId}.`;
    suggestedResolutions = ["source-shadow", "suppress"];
  }

  if (!category) {
    return null;
  }

  const evidence = revision.evidence ?? [];
  return {
    id: `tracked_revision:${revision.id}`,
    category,
    classification: category === "relation_endpoint_missing"
      ? "compiler_rule_bug"
      : "curation_conflict",
    severity: category === "source_shadow" || category === "relation_endpoint_missing"
      ? "high"
      : "medium",
    confidence: "high",
    status: "applied",
    title: `${humanCategory(category)}: ${revision.id}`,
    summary,
    sourceFamilies: collectSourceFamiliesFromCitations(evidence),
    affected: {
      fragmentIds: [],
      baselineIds: [...affectedIds].sort(),
      stateIds: [...affectedIds].sort(),
      relationEndpoints: [],
    },
    candidateEntries: [],
    sourceRefs: evidence,
    citations: evidence,
    urls: collectUrls([], evidence),
    legalLocators: collectLegalLocators(evidence),
    attributesThatAgree: {},
    attributesThatConflict: {},
    suggestedResolutions,
    blocks: {
      stateGeneration: false,
      releaseReadiness: false,
    },
    draftRevisionIds: [],
    trackedRevisionIds: [revision.id],
    rationale: revision.rationale ??
      "Tracked revision imported into the review queue as an applied audit item.",
    generatedAt,
    source: {
      type: "tracked_revision",
      id: revision.id,
    },
  };
}

function applyRevisionAwareness(
  items: ReviewItem[],
  trackedRevisions: Revision[],
  draftRevisions: DraftRevision[],
): void {
  for (const item of items) {
    for (const revision of trackedRevisions) {
      if (revisionMatchesItem(revision, item)) {
        item.trackedRevisionIds.push(revision.id);
      }
    }
    for (const draft of draftRevisions) {
      if (draft.sourceReviewItemId === item.id || revisionMatchesItem(draft, item)) {
        item.draftRevisionIds.push(draft.id);
      }
    }
    item.trackedRevisionIds = uniqueSorted(item.trackedRevisionIds);
    item.draftRevisionIds = uniqueSorted(item.draftRevisionIds);
    item.status = item.trackedRevisionIds.length > 0
      ? "applied"
      : item.draftRevisionIds.length > 0
      ? "drafted"
      : "open";
  }
}

function revisionMatchesItem(
  revision: Revision | DraftRevision,
  item: ReviewItem,
): boolean {
  const itemIds = new Set(item.affected.stateIds);
  if (itemIds.has(revision.targetId)) {
    return true;
  }

  const review = revision.patch.review;
  if (review && typeof review === "object" && !Array.isArray(review)) {
    const relatedEntryIds = (review as Record<string, unknown>).relatedEntryIds;
    if (Array.isArray(relatedEntryIds) && relatedEntryIds.some((id) => itemIds.has(String(id)))) {
      return true;
    }
    const canonicalEntryId = (review as Record<string, unknown>).canonicalEntryId;
    if (typeof canonicalEntryId === "string" && itemIds.has(canonicalEntryId)) {
      return true;
    }
  }

  const evidence = revision.evidence ?? [];
  return evidence.length > 0 &&
    item.citations.some((left) => evidence.some((right) => sameCitation(left, right)));
}

function categoryFromCandidate(candidate: ReconciliationCandidatePacket): ReviewCategory {
  if (candidate.risks.includes("kind_conflict") || candidate.risks.includes("family_conflict")) {
    return "kind_conflict";
  }
  if (candidate.reviewCategory === "same_source_duplicate") {
    return "same_source_duplicate";
  }
  if (candidate.reviewCategory === "relation_endpoint_review") {
    return "relation_endpoint_missing";
  }
  if (candidate.reason === "shared_legal_locator") {
    return "legal_authority_ambiguous";
  }
  if (candidate.reviewCategory === "source_shadow") {
    return "source_shadow";
  }
  if (candidate.reason === "same_normalized_name") {
    return "identity_conflict";
  }
  return "alias_candidate";
}

function classificationFromCandidate(
  candidate: ReconciliationCandidatePacket,
  category: ReviewCategory,
): ReviewClassification {
  if (category === "legal_authority_ambiguous") {
    return "legal_authority_ambiguity";
  }
  if (category === "relation_endpoint_missing") {
    return "compiler_rule_bug";
  }
  if (
    candidate.sourceFamilies.length === 1 &&
    candidate.sourceFamilies[0] === "open_dc" &&
    category === "same_source_duplicate"
  ) {
    return "source_ingestion_bug";
  }
  return "curation_conflict";
}

function categoryFromFinding(finding: Finding): ReviewCategory | null {
  if (finding.code.includes("relation_target") || finding.code.includes("relation_source")) {
    return "relation_endpoint_missing";
  }
  if (finding.code.includes("legal")) {
    return "legal_authority_ambiguous";
  }
  if (finding.code.includes("not_promoted") || finding.code.includes("promotion")) {
    return "out_of_scope_candidate";
  }
  if (finding.code.includes("missing") || finding.code.includes("invalid")) {
    return "incomplete_entry";
  }
  if (finding.kind === "conflict") {
    return "identity_conflict";
  }
  return null;
}

function classificationFromFinding(
  finding: Finding,
  category: ReviewCategory,
): ReviewClassification {
  if (category === "legal_authority_ambiguous") {
    return "legal_authority_ambiguity";
  }
  if (category === "out_of_scope_candidate") {
    return "out_of_scope";
  }
  if (finding.code.startsWith("dc.reader") || finding.code.startsWith("dc.interpreter")) {
    return "source_ingestion_bug";
  }
  if (finding.code.startsWith("compiler.")) {
    return "compiler_rule_bug";
  }
  return "curation_conflict";
}

function suggestedResolutionsFor(category: ReviewCategory): ReviewResolutionType[] {
  switch (category) {
    case "kind_conflict":
      return ["preserve-distinct", "source-shadow", "override-kind", "suppress"];
    case "source_shadow":
      return ["source-shadow", "preserve-distinct", "alias", "suppress"];
    case "same_source_duplicate":
      return ["suppress", "alias", "preserve-distinct"];
    case "alias_candidate":
    case "identity_conflict":
      return ["alias", "preserve-distinct", "source-shadow", "suppress"];
    case "relation_endpoint_missing":
      return ["source-shadow", "suppress"];
    case "legal_authority_ambiguous":
      return ["preserve-distinct", "suppress"];
    case "out_of_scope_candidate":
      return ["suppress"];
    case "preserve_distinct_candidate":
      return ["preserve-distinct", "source-shadow", "alias"];
    case "source_stale_or_failed":
    case "incomplete_entry":
      return ["suppress", "override-kind"];
  }
}

function summarizeCandidate(candidate: ReconciliationCandidatePacket): string {
  const entries = candidate.entries.map((entry) => `${entry.id} (${entry.kind})`).join(", ");
  return `${candidate.reason} matched ${candidate.entries.length} entries for "${candidate.matchKey}": ${entries}`;
}

function rationaleForCandidate(
  candidate: ReconciliationCandidatePacket,
  category: ReviewCategory,
  classification: ReviewClassification,
): string {
  return `Classified as ${classification} because ${candidate.reason} produced a ${
    humanCategory(category).toLowerCase()
  } review packet across ${candidate.sourceFamilies.join(", ") || "unknown sources"}.`;
}

function attributesThatAgree(candidate: ReconciliationCandidatePacket): Record<string, unknown> {
  const output: Record<string, unknown> = {
    matchKey: candidate.matchKey,
    detectorReason: candidate.reason,
  };
  const normalizedNames = uniqueSorted(candidate.entries.map((entry) => normalizeName(entry.name)));
  if (normalizedNames.length === 1) {
    output.normalizedName = normalizedNames[0];
  }
  return output;
}

function attributesThatConflict(candidate: ReconciliationCandidatePacket): Record<string, unknown> {
  return {
    kinds: uniqueSorted(candidate.entries.map((entry) => entry.kind)),
    families: uniqueSorted(candidate.entries.map((entry) => entry.family)),
    sources: uniqueSorted(candidate.entries.flatMap((entry) => entry.sources)),
    risks: candidate.risks,
  };
}

function collectCitations(entries: ReconciliationCandidateEntry[]): CitationValue[] {
  const citations: CitationValue[] = [];
  for (const entry of entries) {
    citations.push(...entry.citations);
    for (const relations of Object.values(entry.relations)) {
      for (const relation of relations) {
        citations.push(...(relation.citations ?? []));
      }
    }
  }
  return uniqueCitations(citations);
}

function collectSourcesForEntry(
  entry: {
    citations: CitationValue[];
    relations: Record<string, Array<{ citations?: CitationValue[] }>>;
  },
): string[] {
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

function collectRelationEndpoints(
  entries: ReconciliationCandidateEntry[],
): Array<{ from: string; kind: string; to: string }> {
  const endpoints: Array<{ from: string; kind: string; to: string }> = [];
  for (const entry of entries) {
    for (const relations of Object.values(entry.relations)) {
      for (const relation of relations) {
        endpoints.push({ from: entry.id, kind: relation.kind, to: relation.to });
      }
    }
  }
  return endpoints.sort((left, right) => {
    if (left.from === right.from) {
      if (left.kind === right.kind) return left.to.localeCompare(right.to);
      return left.kind.localeCompare(right.kind);
    }
    return left.from.localeCompare(right.from);
  });
}

function collectUrls(
  entries: ReconciliationCandidateEntry[],
  citations: CitationValue[],
): string[] {
  const urls = new Set<string>();
  for (const entry of entries) {
    for (const value of Object.values(entry.attributes)) {
      if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) {
        urls.add(value.trim());
      }
    }
  }
  for (const citation of citations) {
    if ("url" in citation && citation.url) {
      urls.add(citation.url);
    }
  }
  return [...urls].sort();
}

function collectLegalLocators(citations: CitationValue[]): string[] {
  const locators = new Set<string>();
  for (const citation of citations) {
    if ("locator" in citation && citation.locator) {
      locators.add(citation.locator);
    }
  }
  return [...locators].sort();
}

function collectSourceFamiliesFromCitations(citations: CitationValue[]): string[] {
  const families = new Set<string>();
  for (const citation of citations) {
    if ("source" in citation) {
      families.add(sourceFamily(citation.source));
    }
  }
  return [...families].sort();
}

function sourceFamily(source: string): string {
  return source.includes(".") ? source.split(".")[0] : source;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\s+/g, " ");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function uniqueCitations(citations: CitationValue[]): CitationValue[] {
  const seen = new Set<string>();
  const output: CitationValue[] = [];
  for (const citation of citations) {
    const key = JSON.stringify(citation);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(citation);
  }
  return output.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function sameCitation(left: CitationValue, right: CitationValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareReviewItems(left: ReviewItem, right: ReviewItem): number {
  const severity = severityRank(left.severity) - severityRank(right.severity);
  if (severity !== 0) return severity;
  const status = statusRank(left.status) - statusRank(right.status);
  if (status !== 0) return status;
  if (left.category === right.category) return left.id.localeCompare(right.id);
  return left.category.localeCompare(right.category);
}

function severityRank(severity: ReviewSeverity): number {
  if (severity === "high") return 0;
  if (severity === "medium") return 1;
  return 2;
}

function statusRank(status: ReviewStatus): number {
  if (status === "open") return 0;
  if (status === "drafted") return 1;
  return 2;
}

function humanCategory(category: ReviewCategory): string {
  return category.replace(/_/g, " ");
}

function requireString(value: unknown, path: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`invalid ${path}: ${field} must be a non-empty string`);
  }
}
