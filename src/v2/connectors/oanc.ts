import {
  buildCandidateId,
  buildEntityId,
  buildLegalRefId,
  buildRelationshipCandidateId,
  buildReviewItemId,
  type ConnectorResult,
  type EntityCandidateInput,
  type LegalRefInput,
  parseLegalReference,
  type RelationshipCandidateInput,
  type ReviewItemInput,
  type SourceDefinition,
  type SourceEndpointDefinition,
  type SourceItemInput,
} from "../domain.ts";
import { artifact, buildCandidateReviewItem, fieldEvidence } from "./shared.ts";
import type { ConnectorContext, SourceConnector } from "./shared.ts";
import { normalizeName, stripHtml } from "../domain.ts";

const oancSource: SourceDefinition = {
  sourceId: "oanc.anc_profiles",
  title: "OANC ANC Profiles",
  kind: "anc_profile_pages",
  accessMethod: "official_page_html",
  baseUrl: "https://oanc.dc.gov/anc-profile-listing",
};

interface AncListingEntry {
  label: string;
  value: string;
  slug: string;
  url: string;
  wardNumbers: number[];
}

interface AncProfileRecord {
  entry: AncListingEntry;
  html: string;
  commissioners: Array<{ smd: string; name: string; role?: string }>;
}

export const oancAncProfilesConnector: SourceConnector = {
  sourceId: oancSource.sourceId,
  source: oancSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const endpoint: SourceEndpointDefinition = {
      endpointId: "oanc.anc_profiles.listing",
      sourceId: oancSource.sourceId,
      title: "OANC ANC listing page",
      kind: "page",
      url: oancSource.baseUrl,
      method: "GET",
      captureMode: "page",
    };
    const response = await context.fetcher(oancSource.baseUrl);
    const listingHtml = await response.text();
    const listing = parseAncListingPage(listingHtml).slice(
      0,
      context.limit ?? Number.POSITIVE_INFINITY,
    );
    const profileRecords: AncProfileRecord[] = [];
    for (const entry of listing) {
      const profileResponse = await context.fetcher(entry.url);
      const profileHtml = await profileResponse.text();
      profileRecords.push({
        entry,
        html: profileHtml,
        commissioners: parseAncCommissioners(profileHtml),
      });
    }
    const items: SourceItemInput[] = [{
      itemKey: "anc-listing",
      itemType: "anc_listing_page",
      title: "OANC ANC listing page",
      body: {
        entries: listing.map((entry) => ({
          label: entry.label,
          value: entry.value,
          url: entry.url,
        })),
      },
    }];
    for (const record of profileRecords) {
      items.push({
        itemKey: record.entry.slug,
        itemType: "anc_profile_page",
        title: record.entry.label,
        body: {
          label: record.entry.label,
          url: record.entry.url,
          wardNumbers: record.entry.wardNumbers,
          commissioners: record.commissioners,
        },
      });
    }
    const entityCandidates = buildAncEntityCandidates(profileRecords);
    const legalRefs = buildAncLegalRefs(listingHtml, profileRecords);
    const relationshipCandidates = buildAncRelationshipCandidates(profileRecords);
    const reviewItems: ReviewItemInput[] = [
      ...entityCandidates.map((candidate) =>
        buildCandidateReviewItem(
          candidate.candidateId,
          "Review ANC candidate",
          "accept",
          {
            name: candidate.name,
            kind: candidate.kind,
            officialUrl: candidate.officialUrl,
          },
        )
      ),
      ...relationshipCandidates.map((candidate) => ({
        reviewItemId: buildReviewItemId(
          candidate.relationshipCandidateId,
          candidate.relationshipType,
        ),
        itemType: "relationship_candidate" as const,
        subjectId: candidate.relationshipCandidateId,
        reason: "Review ANC structure relationship",
        defaultAction: "accept",
        details: {
          fromEntityRef: candidate.fromEntityRef,
          toEntityRef: candidate.toEntityRef,
          relationshipType: candidate.relationshipType,
          rawValue: candidate.rawValue,
        },
      })),
      ...legalRefs.map((legalRef) => ({
        reviewItemId: buildReviewItemId(legalRef.legalRefId, "anc-legal-ref"),
        itemType: "legal_ref" as const,
        subjectId: legalRef.legalRefId,
        reason: "Review ANC legal authority citation",
        defaultAction: "accept",
        details: {
          refType: legalRef.refType,
          citationText: legalRef.citationText,
          normalizedCitation: legalRef.normalizedCitation,
        },
      })),
    ];
    return {
      source: oancSource,
      endpointResults: [{
        endpoint,
        status: "success",
        artifacts: [
          artifact("page", "html", oancSource.baseUrl, listingHtml),
          ...profileRecords.map((record) =>
            artifact("page", "html", record.entry.url, record.html)
          ),
        ],
        parsed: {
          items,
          entityCandidates,
          relationshipCandidates,
          legalRefs,
          reviewItems,
        },
      }],
    };
  },
};

function buildAncEntityCandidates(profileRecords: AncProfileRecord[]): EntityCandidateInput[] {
  const candidates: EntityCandidateInput[] = [{
    candidateId: buildCandidateId(oancSource.sourceId, "anc-system"),
    sourceItemKey: "anc-listing",
    proposedEntityId: buildEntityId("Advisory Neighborhood Commissions"),
    name: "Advisory Neighborhood Commissions",
    kind: "commission",
    rawKind: "commission",
    officialUrl: "https://oanc.dc.gov/",
    confidence: 0.98,
    duplicateHint: "https://oanc.dc.gov/",
    evidence: [fieldEvidence("system", "Advisory Neighborhood Commissions", 0)],
  }];
  for (const record of profileRecords) {
    const ancName = record.entry.label;
    candidates.push({
      candidateId: buildCandidateId(oancSource.sourceId, record.entry.slug),
      sourceItemKey: record.entry.slug,
      proposedEntityId: buildEntityId(ancName),
      name: ancName,
      kind: "commission",
      rawKind: "anc",
      officialUrl: record.entry.url,
      confidence: 0.98,
      duplicateHint: record.entry.url,
      evidence: [fieldEvidence("ANC", ancName, 1)],
    });
    for (const wardNumber of record.entry.wardNumbers) {
      candidates.push({
        candidateId: buildCandidateId(
          oancSource.sourceId,
          `${record.entry.slug}-ward-${wardNumber}`,
        ),
        sourceItemKey: record.entry.slug,
        proposedEntityId: buildEntityId(`Ward ${wardNumber}`),
        name: `Ward ${wardNumber}`,
        kind: "ward",
        rawKind: "ward",
        confidence: 0.98,
        evidence: [fieldEvidence("ward", wardNumber, 1)],
      });
    }
    for (const commissioner of record.commissioners) {
      if (commissioner.name.toLowerCase() === "vacant") continue;
      candidates.push({
        candidateId: buildCandidateId(
          oancSource.sourceId,
          `${record.entry.slug}-${commissioner.smd}`,
        ),
        sourceItemKey: record.entry.slug,
        proposedEntityId: buildEntityId(commissioner.name),
        name: commissioner.name,
        kind: "public_official",
        rawKind: "person",
        officialUrl: record.entry.url,
        confidence: 0.95,
        duplicateHint: record.entry.url,
        evidence: [fieldEvidence("commissioner", commissioner.name, 1)],
      });
      candidates.push({
        candidateId: buildCandidateId(
          oancSource.sourceId,
          `${record.entry.slug}-${commissioner.smd}-smd`,
        ),
        sourceItemKey: record.entry.slug,
        proposedEntityId: buildEntityId(`SMD ${commissioner.smd}`),
        name: `SMD ${commissioner.smd}`,
        kind: "smd",
        rawKind: "smd",
        confidence: 0.98,
        evidence: [fieldEvidence("smd", commissioner.smd, 1)],
      });
    }
  }
  return candidates;
}

function buildAncLegalRefs(
  listingHtml: string,
  profileRecords: AncProfileRecord[],
): LegalRefInput[] {
  const citationMatch = listingHtml.match(/D\.C\.\s+Code\s+1-309\.13\(j\)\(1\)/i);
  if (!citationMatch) return [];
  const parsed = parseLegalReference(citationMatch[0], oancSource.baseUrl);
  return profileRecords.map((record) => ({
    legalRefId: buildLegalRefId(oancSource.sourceId, `${record.entry.slug}-authority`),
    sourceItemKey: "anc-listing",
    refType: parsed.refType,
    citationText: parsed.citationText,
    normalizedCitation: parsed.normalizedCitation,
    url: oancSource.baseUrl,
    needsReview: parsed.needsReview,
    evidence: [fieldEvidence("authority", parsed.citationText, 0)],
    attachEntityRef: buildEntityId("Advisory Neighborhood Commissions"),
  }));
}

function buildAncRelationshipCandidates(
  profileRecords: AncProfileRecord[],
): RelationshipCandidateInput[] {
  const relationships: RelationshipCandidateInput[] = [];
  for (const record of profileRecords) {
    const ancId = buildEntityId(record.entry.label);
    for (const wardNumber of record.entry.wardNumbers) {
      relationships.push({
        relationshipCandidateId: buildRelationshipCandidateId(
          oancSource.sourceId,
          `${record.entry.slug}-ward-${wardNumber}-part_of`,
        ),
        sourceItemKey: record.entry.slug,
        fromEntityRef: ancId,
        toEntityRef: buildEntityId(`Ward ${wardNumber}`),
        relationshipType: "part_of",
        rawValue: `Ward ${wardNumber}`,
        evidence: [fieldEvidence("ward", wardNumber, 1)],
      });
    }
    for (const commissioner of record.commissioners) {
      if (commissioner.name.toLowerCase() === "vacant") continue;
      const commissionerId = buildEntityId(commissioner.name);
      const smdId = buildEntityId(`SMD ${commissioner.smd}`);
      relationships.push({
        relationshipCandidateId: buildRelationshipCandidateId(
          oancSource.sourceId,
          `${record.entry.slug}-${commissioner.smd}-represents`,
        ),
        sourceItemKey: record.entry.slug,
        fromEntityRef: commissionerId,
        toEntityRef: smdId,
        relationshipType: "represents",
        rawValue: commissioner.smd,
        evidence: [fieldEvidence("commissioner", commissioner.name, 1)],
      });
      relationships.push({
        relationshipCandidateId: buildRelationshipCandidateId(
          oancSource.sourceId,
          `${record.entry.slug}-${commissioner.smd}-member_of`,
        ),
        sourceItemKey: record.entry.slug,
        fromEntityRef: commissionerId,
        toEntityRef: ancId,
        relationshipType: "member_of",
        rawValue: commissioner.name,
        evidence: [fieldEvidence("commissioner", commissioner.name, 1)],
      });
      relationships.push({
        relationshipCandidateId: buildRelationshipCandidateId(
          oancSource.sourceId,
          `${record.entry.slug}-${commissioner.smd}-part_of`,
        ),
        sourceItemKey: record.entry.slug,
        fromEntityRef: smdId,
        toEntityRef: ancId,
        relationshipType: "part_of",
        rawValue: commissioner.smd,
        evidence: [fieldEvidence("smd", commissioner.smd, 1)],
      });
    }
  }
  return relationships;
}

function parseAncListingPage(html: string): AncListingEntry[] {
  const options = [...html.matchAll(/<option\s+value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/gsi)];
  return options
    .map((match) => ({
      value: match[1],
      label: normalizeName(stripHtml(match[2])),
    }))
    .filter((option) => option.label.startsWith("ANC "))
    .map((option) => {
      const code = option.label.replace(/^ANC\s+/i, "");
      const slug = `anc-${code.toLowerCase().replaceAll(/[^a-z0-9]/g, "")}`;
      return {
        ...option,
        slug,
        url: `https://oanc.dc.gov/anc-profile/${slug}`,
        wardNumbers: [...new Set((code.match(/[0-9]+/g) ?? []).map((value) => Number(value)))]
          .filter(
            (value) => Number.isFinite(value) && value > 0,
          ),
      };
    });
}

function parseAncCommissioners(html: string): Array<{ smd: string; name: string; role?: string }> {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gsi)];
  const commissioners: Array<{ smd: string; name: string; role?: string }> = [];
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gsi)].map((match) =>
      normalizeName(stripHtml(match[1]))
    );
    if (cells.length < 2) continue;
    if (cells[0] === "SMD") continue;
    const smd = cells[0];
    const parsed = splitCommissionerName(cells[1]);
    commissioners.push({ smd, ...parsed });
  }
  return commissioners.filter((row) => row.smd.length > 0 && row.name.length > 0);
}

function splitCommissionerName(value: string): { name: string; role?: string } {
  const text = normalizeName(value);
  if (!text || /^vacant$/i.test(text)) return { name: text };
  const match = text.match(
    /^(.*?)(?:\s+(Chairperson|Vice Chairperson|Secretary|Treasurer|Chair|Vice Chair))$/i,
  );
  if (!match) return { name: text };
  return { name: normalizeName(match[1]), role: match[2] };
}
