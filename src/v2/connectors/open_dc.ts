import {
  buildCandidateId,
  buildEntityId,
  buildLegalRefId,
  buildRelationshipCandidateId,
  buildReviewItemId,
  type EntityCandidateInput,
  type LegalRefInput,
  parseLegalReference,
  type RelationshipCandidateInput,
  type ReviewItemInput,
  type SourceDefinition,
  type SourceEndpointDefinition,
  type SourceItemInput,
} from "../domain.ts";
import {
  artifact,
  buildCandidateReviewItem,
  captureSingle,
  fieldEvidence,
  toAbsoluteUrl,
} from "./shared.ts";
import type { ConnectorContext, ConnectorResult, SourceConnector } from "./shared.ts";
import { detectEntityKind } from "../domain.ts";
import { normalizeName, stripHtml } from "../domain.ts";

const openDcSource: SourceDefinition = {
  sourceId: "open_dc.public_bodies",
  title: "Open DC Public Bodies",
  kind: "public_body_pages",
  accessMethod: "official_page_html",
  baseUrl: "https://www.open-dc.gov/public-bodies",
};

export const openDcConnector: SourceConnector = {
  sourceId: openDcSource.sourceId,
  source: openDcSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const indexEndpoint: SourceEndpointDefinition = {
      endpointId: "open_dc.public_bodies.index",
      sourceId: openDcSource.sourceId,
      title: "Open DC public bodies index",
      kind: "page",
      url: openDcSource.baseUrl,
      method: "GET",
      captureMode: "page",
    };
    const detailEndpoint: SourceEndpointDefinition = {
      endpointId: "open_dc.public_bodies.detail",
      sourceId: openDcSource.sourceId,
      title: "Open DC public body detail pages",
      kind: "page",
      url: openDcSource.baseUrl,
      method: "GET",
      captureMode: "documents",
    };
    const indexResponse = await context.fetcher(openDcSource.baseUrl);
    const indexHtml = await indexResponse.text();
    const links = parseOpenDcIndex(indexHtml).slice(0, context.limit ?? 8);
    const detailRecords = await fetchOpenDcDetailRecords(context.fetcher, links);
    const detailParsed = deriveOpenDcDetailParsed(detailRecords);
    return {
      source: openDcSource,
      endpointResults: [
        {
          endpoint: indexEndpoint,
          status: "success",
          artifacts: [artifact("page", "html", openDcSource.baseUrl, indexHtml)],
          parsed: {
            items: links.map((link) => ({
              itemKey: link.slug,
              itemType: "public_body_index",
              title: link.text,
              body: { href: toAbsoluteUrl(openDcSource.baseUrl, link.href) },
              artifactIndex: 0,
            })),
          },
        },
        {
          endpoint: detailEndpoint,
          status: "success",
          artifacts: detailRecords.map((record) =>
            artifact("page", "html", record.detailUrl, record.detailHtml)
          ),
          parsed: detailParsed,
        },
      ],
    };
  },
};

function parseOpenDcIndex(html: string): Array<{ href: string; text: string; slug: string }> {
  const matches = [...html.matchAll(/<a href="(\/public-bodies\/[^"#?]+)"[^>]*>(.*?)<\/a>/gsi)];
  const seen = new Set<string>();
  const results: Array<{ href: string; text: string; slug: string }> = [];
  for (const match of matches) {
    const href = match[1];
    const text = normalizeName(stripHtml(match[2]));
    if (!href.startsWith("/public-bodies/")) continue;
    if (href.includes("/meetings")) continue;
    if (!text || text === "Public Bodies") continue;
    if (seen.has(href)) continue;
    seen.add(href);
    results.push({ href, text, slug: href.split("/").pop() ?? href });
  }
  return results;
}

interface OpenDcDetailRecord {
  artifactIndex: number;
  detailUrl: string;
  detailHtml: string;
  detail: ReturnType<typeof parseOpenDcDetail>;
}

async function fetchOpenDcDetailRecords(
  fetcher: ConnectorContext["fetcher"],
  links: Array<{ href: string; text: string; slug: string }>,
): Promise<OpenDcDetailRecord[]> {
  const records: OpenDcDetailRecord[] = [];
  for (const [artifactIndex, link] of links.entries()) {
    const detailUrl = toAbsoluteUrl(openDcSource.baseUrl, link.href);
    const detailResponse = await fetcher(detailUrl);
    const detailHtml = await detailResponse.text();
    records.push({
      artifactIndex,
      detailUrl,
      detailHtml,
      detail: parseOpenDcDetail(detailHtml, detailUrl),
    });
  }
  return records;
}

function deriveOpenDcDetailParsed(records: OpenDcDetailRecord[]): {
  items: SourceItemInput[];
  entityCandidates: EntityCandidateInput[];
  relationshipCandidates: RelationshipCandidateInput[];
  legalRefs: LegalRefInput[];
  reviewItems: ReviewItemInput[];
} {
  const items: SourceItemInput[] = [];
  const entityCandidates: EntityCandidateInput[] = [];
  const relationshipCandidates: RelationshipCandidateInput[] = [];
  const legalRefs: LegalRefInput[] = [];
  const reviewItems: ReviewItemInput[] = [];
  for (const record of records) {
    const { detail, detailUrl, artifactIndex } = record;
    const itemKey = detail.slug;
    items.push({
      itemKey,
      itemType: "public_body_detail",
      title: detail.name,
      artifactIndex,
      body: {
        name: detail.name,
        slug: detail.slug,
        url: detailUrl,
        governingAgency: detail.governingAgency,
        enablingAuthority: detail.enablingAuthority,
        enablingAuthorityUrl: detail.enablingAuthorityUrl,
        meetingCount: detail.meetingCount,
      },
    });
    const candidateId = buildCandidateId(openDcSource.sourceId, itemKey);
    const proposedEntityId = buildEntityId(detail.name);
    entityCandidates.push({
      candidateId,
      sourceItemKey: itemKey,
      proposedEntityId,
      name: detail.name,
      kind: detectEntityKind(undefined, detail.name),
      rawKind: "public_body",
      officialUrl: detailUrl,
      confidence: 0.92,
      duplicateHint: detailUrl,
      evidence: [
        fieldEvidence("name", detail.name, artifactIndex),
        fieldEvidence("url", detailUrl, artifactIndex),
        fieldEvidence("governingAgency", detail.governingAgency ?? "", artifactIndex),
      ],
    });
    reviewItems.push(
      buildCandidateReviewItem(candidateId, "Review Open DC public body candidate"),
    );
    if (detail.governingAgency) {
      const relationshipCandidateId = buildRelationshipCandidateId(
        openDcSource.sourceId,
        `${itemKey}-governing-agency`,
      );
      relationshipCandidates.push({
        relationshipCandidateId,
        sourceItemKey: itemKey,
        fromEntityRef: proposedEntityId,
        toEntityRef: buildEntityId(detail.governingAgency),
        relationshipType: "governed_by",
        rawValue: detail.governingAgency,
        evidence: [fieldEvidence("governingAgency", detail.governingAgency, artifactIndex)],
      });
      reviewItems.push({
        reviewItemId: buildReviewItemId(relationshipCandidateId, "governing-agency"),
        itemType: "relationship_candidate",
        subjectId: relationshipCandidateId,
        reason: "Review governing agency relationship from Open DC",
        defaultAction: "accept",
        details: {},
      });
    }
    if (detail.enablingAuthority) {
      const parsed = parseLegalReference(detail.enablingAuthority, detail.enablingAuthorityUrl);
      legalRefs.push({
        legalRefId: buildLegalRefId(openDcSource.sourceId, `${itemKey}-authority`),
        sourceItemKey: itemKey,
        refType: parsed.refType,
        citationText: parsed.citationText,
        normalizedCitation: parsed.normalizedCitation,
        url: detail.enablingAuthorityUrl,
        needsReview: parsed.needsReview,
        evidence: [fieldEvidence("enablingAuthority", detail.enablingAuthority, artifactIndex)],
        attachEntityRef: proposedEntityId,
      });
    }
  }
  return { items, entityCandidates, relationshipCandidates, legalRefs, reviewItems };
}

function parseOpenDcDetail(
  html: string,
  detailUrl: string,
): {
  slug: string;
  name: string;
  governingAgency?: string;
  enablingAuthority?: string;
  enablingAuthorityUrl?: string;
  meetingCount: number;
} {
  const slug = detailUrl.split("/").pop() ?? detailUrl;
  const name = captureSingle(html, /<h1 class="page-title">([^<]+)<\/h1>/i) ?? slug;
  const enablingBlock = captureSingle(
    html,
    /Enabling Statute \/ Mayoral Order:[\s\S]*?<div class="field-items"><div class="field-item even"><a href="([^"]+)">([\s\S]*?)<\/a>/i,
    0,
  );
  const enablingAuthorityUrl = enablingBlock
    ? captureSingle(enablingBlock, /href="([^"]+)"/i)
    : undefined;
  const enablingAuthority = captureSingle(
    html,
    /Enabling Statute \/ Mayoral Order:[\s\S]*?<div class="field-items"><div class="field-item even"><a [^>]+>([\s\S]*?)<\/a>/i,
  );
  const governingAgency = captureSingle(
    html,
    /Governing Agency \/ Agency Acronym:[\s\S]*?<div class="field-items"><div class="field-item even">([\s\S]*?)<\/div>/i,
  );
  const meetingCount = [...html.matchAll(/class="view-meetings-calendar"/g)].length;
  return {
    slug,
    name: normalizeName(stripHtml(name)),
    governingAgency: governingAgency ? normalizeName(stripHtml(governingAgency)) : undefined,
    enablingAuthority: enablingAuthority ? normalizeName(stripHtml(enablingAuthority)) : undefined,
    enablingAuthorityUrl,
    meetingCount,
  };
}
