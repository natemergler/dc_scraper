import {
  type CitationValue,
  cite,
  type EntryFragment,
  type RelationFragment,
} from "../../../core/types.ts";
import { parseLegalCitationLocators, parseLegalCitationLocatorsFromUrl } from "./citations.ts";

export interface LegalAuthorityLocatorInput {
  locator: string;
  url?: string;
}

interface ClassifiedLegalAuthority {
  authorityType: "dc_code" | "dc_law" | "mayors_order";
  locator: string;
  provisionalId: string;
  canonicalUrl?: string;
}

export interface LegalAuthorityArtifactsOptions {
  source: string;
  sourceRecordId: string;
  subjectProvisionalId: string;
  locatorInputs: LegalAuthorityLocatorInput[];
  emitAuthorities?: boolean;
}

export interface LegalAuthorityArtifacts {
  entryCitations: CitationValue[];
  entryFragments: EntryFragment[];
  relationFragments: RelationFragment[];
}

const legalAuthorityKind = "dc.legal_authority" as const;
const authorizedByRelationKind = "dc.relation:authorized_by" as const;

/**
 * Derives legal authority fragments from the citation locators an interpreter found on an entry.
 *
 * This keeps the ADR's "derive legal authority from entry citations" rule centralized while the
 * current source interpreters still own source-shaped locator extraction. Only alpha in-scope,
 * explicit locators become `dc.legal_authority` entries and `dc.relation:authorized_by` links;
 * all other locators remain evidence citations on the civic entry.
 */
export function buildRecordLegalAuthorityArtifacts(
  options: Omit<LegalAuthorityArtifactsOptions, "locatorInputs"> & {
    payload: Record<string, unknown>;
  },
): LegalAuthorityArtifacts {
  return buildLegalAuthorityArtifacts({
    ...options,
    locatorInputs: parseLegalCitationLocators(options.payload).map((locator) => ({ locator })),
  });
}

export function buildOpenDcLegalAuthorityLocatorInputs(
  textLocators: string[],
  enablingStatuteUrl?: string,
): LegalAuthorityLocatorInput[] {
  const merged = new Map<string, LegalAuthorityLocatorInput>();

  for (const locator of textLocators) {
    merged.set(locator, { locator });
  }

  if (enablingStatuteUrl) {
    const urlLocators = parseLegalCitationLocatorsFromUrl(enablingStatuteUrl);
    for (const locator of urlLocators) {
      const urlInput = { locator, url: enablingStatuteUrl };
      const matchKey = findMergeableLocatorKey(merged, urlInput);
      if (matchKey) {
        const existing = merged.get(matchKey);
        if (existing && !existing.url) {
          existing.url = enablingStatuteUrl;
        }
        continue;
      }
      merged.set(locator, urlInput);
    }
  }

  return [...merged.values()].sort((left, right) => left.locator.localeCompare(right.locator));
}

export function buildLegalAuthorityArtifacts(
  options: LegalAuthorityArtifactsOptions,
): LegalAuthorityArtifacts {
  const entryCitations: CitationValue[] = [
    cite(options.source, options.sourceRecordId),
  ];
  const entryFragmentsById = new Map<string, EntryFragment>();
  const relationFragmentsByTarget = new Map<string, RelationFragment>();

  for (const input of options.locatorInputs) {
    const classified = classifyLegalAuthorityLocator(input.locator);
    const locatorCitation = cite(options.source, options.sourceRecordId, {
      locator: classified?.locator ?? input.locator,
      url: input.url,
    });

    if (!classified || options.emitAuthorities === false) {
      mergeUniqueCitations(entryCitations, locatorCitation);
      continue;
    }

    const existingEntry = entryFragmentsById.get(classified.provisionalId);
    if (existingEntry) {
      existingEntry.citations = mergeCitationLists(existingEntry.citations, [locatorCitation]);
    } else {
      entryFragmentsById.set(classified.provisionalId, {
        fragmentType: "entry",
        source: options.source,
        sourceRecordId: options.sourceRecordId,
        provisionalId: classified.provisionalId,
        family: "authority",
        kind: legalAuthorityKind,
        name: classified.locator,
        attributes: {
          authorityType: classified.authorityType,
          locator: classified.locator,
          shortName: classified.locator,
          ...(classified.canonicalUrl ? { canonicalUrl: classified.canonicalUrl } : {}),
        },
        citations: [locatorCitation],
      });
    }

    const existingRelation = relationFragmentsByTarget.get(classified.provisionalId);
    if (existingRelation) {
      existingRelation.citations = mergeCitationLists(existingRelation.citations, [
        locatorCitation,
      ]);
    } else {
      relationFragmentsByTarget.set(classified.provisionalId, {
        fragmentType: "relation",
        source: options.source,
        sourceRecordId: options.sourceRecordId,
        from: options.subjectProvisionalId,
        relationKind: authorizedByRelationKind,
        to: classified.provisionalId,
        citations: [locatorCitation],
      });
    }
  }

  return {
    entryCitations,
    entryFragments: [...entryFragmentsById.values()].sort((left, right) =>
      left.provisionalId.localeCompare(right.provisionalId)
    ),
    relationFragments: [...relationFragmentsByTarget.values()].sort((left, right) =>
      left.to.localeCompare(right.to)
    ),
  };
}

function findMergeableLocatorKey(
  existing: Map<string, LegalAuthorityLocatorInput>,
  candidate: LegalAuthorityLocatorInput,
): string | null {
  const classifiedCandidate = classifyLegalAuthorityLocator(candidate.locator);
  if (!classifiedCandidate?.canonicalUrl) {
    return existing.has(candidate.locator) ? candidate.locator : null;
  }

  for (const [locator, input] of existing.entries()) {
    const classified = classifyLegalAuthorityLocator(input.locator);
    if (!classified) {
      continue;
    }
    if (
      classified.authorityType === classifiedCandidate.authorityType &&
      classified.canonicalUrl === classifiedCandidate.canonicalUrl
    ) {
      return locator;
    }
  }

  return existing.has(candidate.locator) ? candidate.locator : null;
}

function classifyLegalAuthorityLocator(rawLocator: string): ClassifiedLegalAuthority | null {
  const locator = rawLocator.trim().replace(/\s+/g, " ");

  const dcCodeMatch = locator.match(
    /^D\.?\s*C\.?\s*(?:Official\s+)?Code\s*§\s*([0-9][0-9A-Za-z.\-]*(?:\([^)]+\))*)$/i,
  );
  if (dcCodeMatch?.[1]) {
    const section = dcCodeMatch[1].trim();
    const canonicalLocator = `D.C. Code § ${section}`;
    const sectionRoot = section.replace(/(?:\([^)]+\))+$/g, "");
    return {
      authorityType: "dc_code",
      locator: canonicalLocator,
      provisionalId: `${legalAuthorityKind}:${stableKey(canonicalLocator)}`,
      canonicalUrl: `https://code.dccouncil.gov/us/dc/council/code/sections/${sectionRoot}`,
    };
  }

  const dcLawMatch = locator.match(/^D\.?\s*C\.?\s*Law\s+(\d+-\d+)$/i);
  if (dcLawMatch?.[1]) {
    const lawNumber = dcLawMatch[1].trim();
    const canonicalLocator = `D.C. Law ${lawNumber}`;
    return {
      authorityType: "dc_law",
      locator: canonicalLocator,
      provisionalId: `${legalAuthorityKind}:${stableKey(canonicalLocator)}`,
      canonicalUrl: `https://code.dccouncil.gov/us/dc/council/laws/${lawNumber}`,
    };
  }

  const mayorOrderMatch = locator.match(/^Mayor(?:'|’)?s\s+Order\s+(\d{4}-\d{1,4})$/i);
  if (mayorOrderMatch?.[1]) {
    const orderNumber = mayorOrderMatch[1].trim();
    const canonicalLocator = `Mayor's Order ${orderNumber}`;
    return {
      authorityType: "mayors_order",
      locator: canonicalLocator,
      provisionalId: `${legalAuthorityKind}:${stableKey(canonicalLocator)}`,
    };
  }

  return null;
}

function mergeCitationLists(
  existing: CitationValue[],
  incoming: CitationValue[],
): CitationValue[] {
  const merged = [...existing];
  for (const citation of incoming) {
    mergeUniqueCitations(merged, citation);
  }
  return merged;
}

function mergeUniqueCitations(target: CitationValue[], citation: CitationValue): void {
  const key = JSON.stringify(citation);
  const hasValue = target.some((candidate) => JSON.stringify(candidate) === key);
  if (!hasValue) {
    target.push(citation);
  }
}

function stableKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
