import {
  buildCandidateId,
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
  buildKnownEntityRef,
  captureSingle,
  fieldEvidence,
  resolveKnownEntityRef,
  toAbsoluteUrl,
  toPublicHttpUrl,
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
  tier: "tier0",
  releaseRole: "public_body",
  smokeProfiles: ["structure", "tier0"],
  privacyNotes: [
    "Keep public-body structure and legal authority evidence; drop local or contact-like URLs.",
  ],
};

const priorityPublicBodySlugs = new Set([
  "advisory-committee-street-harassment",
  "juvenile-abscondence-review-committee",
  "tax-revision-commission",
]);
const openDcDetailFetchConcurrency = 6;

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
    const links = selectOpenDcLinks(
      parseOpenDcIndex(indexHtml),
      context.limit,
    );
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

function selectOpenDcLinks(
  links: Array<{ href: string; text: string; slug: string }>,
  limit?: number,
): Array<{ href: string; text: string; slug: string }> {
  const canonicalLinks = canonicalizeOpenDcLinks(links);
  if (limit === undefined) {
    return canonicalLinks;
  }
  const prioritizedLinks = prioritizeOpenDcLinks(canonicalLinks);
  const selected = new Map<string, { href: string; text: string; slug: string }>();
  const limitedLinks = Number.isFinite(limit)
    ? prioritizedLinks.slice(0, Math.max(0, limit))
    : prioritizedLinks;
  for (const link of limitedLinks) {
    selected.set(link.href, link);
  }
  for (const link of prioritizedLinks) {
    if (priorityPublicBodySlugs.has(link.slug)) {
      selected.set(link.href, link);
    }
  }
  return [...selected.values()];
}

function prioritizeOpenDcLinks(
  links: Array<{ href: string; text: string; slug: string }>,
): Array<{ href: string; text: string; slug: string }> {
  const boosted = links.filter(shouldBoostOpenDcLink);
  const boostedHrefs = new Set(boosted.map((link) => link.href));
  return [
    ...boosted,
    ...links.filter((link) => !boostedHrefs.has(link.href)),
  ];
}

function canonicalizeOpenDcLinks(
  links: Array<{ href: string; text: string; slug: string }>,
): Array<{ href: string; text: string; slug: string }> {
  const bestByText = new Map<string, { href: string; text: string; slug: string }>();
  const order: string[] = [];
  for (const link of links) {
    const key = normalizeName(link.text).toLowerCase();
    if (!key) continue;
    const existing = bestByText.get(key);
    if (!existing) {
      bestByText.set(key, link);
      order.push(key);
      continue;
    }
    if (compareOpenDcLinkQuality(link, existing) < 0) {
      bestByText.set(key, link);
    }
  }
  return order.map((key) => bestByText.get(key)!);
}

function compareOpenDcLinkQuality(
  left: { href: string; text: string; slug: string },
  right: { href: string; text: string; slug: string },
): number {
  const leftScore = scoreOpenDcSlug(left.slug);
  const rightScore = scoreOpenDcSlug(right.slug);
  if (leftScore !== rightScore) return leftScore - rightScore;
  if (left.slug.length !== right.slug.length) return left.slug.length - right.slug.length;
  return left.href.localeCompare(right.href);
}

function scoreOpenDcSlug(slug: string): number {
  let score = 0;
  if (/-\d+$/.test(slug)) score += 10;
  if (/--/.test(slug)) score += 5;
  return score;
}

function shouldBoostOpenDcLink(link: { text: string }): boolean {
  const parenthetical = extractOpenDcParentheticalParts(link.text);
  return !!parenthetical &&
    !isAcronymLike(parenthetical.aliasName) &&
    !!resolveKnownEntityRef(parenthetical.aliasName);
}

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
  for (let start = 0; start < links.length; start += openDcDetailFetchConcurrency) {
    const batch = links.slice(start, start + openDcDetailFetchConcurrency);
    const batchRecords = await Promise.all(
      batch.map(async (link, offset) => {
        const artifactIndex = start + offset;
        const detailUrl = toAbsoluteUrl(openDcSource.baseUrl, link.href);
        const detailResponse = await fetcher(detailUrl);
        const detailHtml = await detailResponse.text();
        return {
          artifactIndex,
          detailUrl,
          detailHtml,
          detail: parseOpenDcDetail(detailHtml, detailUrl),
        };
      }),
    );
    records.push(...batchRecords);
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
        administeringAgency: detail.administeringAgency,
        enablingAuthority: detail.enablingAuthority,
        enablingAuthorityUrl: detail.enablingAuthorityUrl,
        meetingCount: detail.meetingCount,
      },
    });
    for (const [index, link] of detail.meetingLinks.entries()) {
      items.push({
        itemKey: `${itemKey}:meeting:${index + 1}`,
        itemType: "meeting_link",
        title: `${detail.name} meeting link`,
        artifactIndex,
        body: { label: link.label, href: link.href, parentItemKey: itemKey },
      });
    }
    for (const [index, link] of detail.documentLinks.entries()) {
      items.push({
        itemKey: `${itemKey}:document:${index + 1}`,
        itemType: "document_link",
        title: `${detail.name} document link`,
        artifactIndex,
        body: { label: link.label, href: link.href, parentItemKey: itemKey },
      });
    }
    const candidateId = buildCandidateId(openDcSource.sourceId, itemKey);
    const identity = resolveOpenDcCandidateIdentity(detail.name);
    const proposedEntityId = identity.proposedEntityId;
    entityCandidates.push({
      candidateId,
      sourceItemKey: itemKey,
      proposedEntityId,
      name: identity.name,
      kind: detectEntityKind(undefined, identity.name),
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
      buildCandidateReviewItem(candidateId, "Review Open DC public body candidate", "accept", {
        name: identity.name,
        kind: detectEntityKind(undefined, identity.name),
        confidence: 0.92,
        officialUrl: detailUrl,
        duplicateHint: detailUrl,
        safeToAutoAccept: true,
      }),
    );
    const governingAgencyRef = detail.governingAgency
      ? openDcRelationshipEndpointRef(detail.governingAgency, proposedEntityId, identity.name)
      : undefined;
    if (detail.governingAgency && governingAgencyRef) {
      const relationshipCandidateId = buildRelationshipCandidateId(
        openDcSource.sourceId,
        `${itemKey}-governing-agency`,
      );
      relationshipCandidates.push({
        relationshipCandidateId,
        sourceItemKey: itemKey,
        fromEntityRef: proposedEntityId,
        toEntityRef: governingAgencyRef,
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
        details: {
          fromEntityRef: proposedEntityId,
          toEntityRef: governingAgencyRef,
          relationshipType: "governed_by",
          rawValue: detail.governingAgency,
        },
      });
    } else if (detail.governingAgency && shouldReviewOpenDcAgencyLabel(detail.governingAgency)) {
      reviewItems.push(
        buildOpenDcAgencyLabelReviewItem({
          itemKey,
          detailName: detail.name,
          detailUrl,
          fieldPath: "governingAgency",
          rawValue: detail.governingAgency,
        }),
      );
    }
    const administeringAgencyRef = detail.administeringAgency
      ? openDcRelationshipEndpointRef(detail.administeringAgency, proposedEntityId, identity.name)
      : undefined;
    if (detail.administeringAgency && administeringAgencyRef) {
      const relationshipCandidateId = buildRelationshipCandidateId(
        openDcSource.sourceId,
        `${itemKey}-administering-agency`,
      );
      relationshipCandidates.push({
        relationshipCandidateId,
        sourceItemKey: itemKey,
        fromEntityRef: proposedEntityId,
        toEntityRef: administeringAgencyRef,
        relationshipType: "governed_by",
        rawValue: detail.administeringAgency,
        evidence: [fieldEvidence("administeringAgency", detail.administeringAgency, artifactIndex)],
      });
      reviewItems.push({
        reviewItemId: buildReviewItemId(relationshipCandidateId, "administering-agency"),
        itemType: "relationship_candidate",
        subjectId: relationshipCandidateId,
        reason: "Review administering agency relationship from Open DC",
        defaultAction: "accept",
        details: {
          fromEntityRef: proposedEntityId,
          toEntityRef: administeringAgencyRef,
          relationshipType: "governed_by",
          rawValue: detail.administeringAgency,
        },
      });
    } else if (
      detail.administeringAgency && shouldReviewOpenDcAgencyLabel(detail.administeringAgency)
    ) {
      reviewItems.push(
        buildOpenDcAgencyLabelReviewItem({
          itemKey,
          detailName: detail.name,
          detailUrl,
          fieldPath: "administeringAgency",
          rawValue: detail.administeringAgency,
        }),
      );
    }
    if (detail.enablingAuthority) {
      const parsed = parseLegalReference(detail.enablingAuthority, detail.enablingAuthorityUrl);
      if (
        shouldCreateOpenDcLegalRef(detail.enablingAuthority, detail.enablingAuthorityUrl, parsed)
      ) {
        const legalRefId = buildLegalRefId(openDcSource.sourceId, `${itemKey}-authority`);
        legalRefs.push({
          legalRefId,
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
  }
  return { items, entityCandidates, relationshipCandidates, legalRefs, reviewItems };
}

function resolveOpenDcCandidateIdentity(
  name: string,
): { name: string; proposedEntityId: string } {
  const normalized = normalizeName(name);
  const parenthetical = extractOpenDcParentheticalParts(normalized);
  if (!parenthetical) {
    return { name: normalized, proposedEntityId: buildKnownEntityRef(normalized) };
  }
  const { baseName, aliasName } = parenthetical;
  if (baseName && aliasName && isAcronymLike(aliasName)) {
    return { name: baseName, proposedEntityId: buildKnownEntityRef(baseName) };
  }
  if (aliasName) {
    const knownAliasEntityRef = resolveKnownEntityRef(aliasName);
    if (knownAliasEntityRef) {
      return { name: normalized, proposedEntityId: knownAliasEntityRef };
    }
  }
  return { name: normalized, proposedEntityId: buildKnownEntityRef(normalized) };
}

function extractOpenDcParentheticalParts(
  name: string,
): { baseName: string; aliasName: string } | undefined {
  const normalized = normalizeName(name);
  const parentheticalMatch = normalized.match(/^(.+?)\s+\(([^)]+)\)\s*$/);
  if (!parentheticalMatch) return undefined;
  const baseName = normalizeName(parentheticalMatch[1] ?? "");
  const aliasName = normalizeName(parentheticalMatch[2] ?? "");
  if (!baseName || !aliasName) return undefined;
  return { baseName, aliasName };
}

function isAcronymLike(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9/&.\-\s]{1,11}$/.test(normalizeName(value));
}

function openDcRelationshipEndpointRef(
  label: string,
  subjectEntityRef: string,
  subjectName: string,
): string | undefined {
  const normalizedLabel = normalizeName(label).toLowerCase();
  if (
    openDcNonRelationshipAgencyLabels.has(normalizedLabel) ||
    openDcReviewableNonRelationshipAgencyLabels.has(normalizedLabel)
  ) {
    return undefined;
  }
  if (matchesSubjectParentheticalAlias(label, subjectName)) return undefined;
  const endpointRef = buildKnownEntityRef(label);
  return endpointRef === subjectEntityRef ? undefined : endpointRef;
}

function matchesSubjectParentheticalAlias(label: string, subjectName: string): boolean {
  const parenthetical = extractOpenDcParentheticalParts(subjectName);
  if (!parenthetical) return false;
  return compactAliasKey(label) === compactAliasKey(parenthetical.aliasName);
}

function compactAliasKey(value: string): string {
  return normalizeName(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function shouldReviewOpenDcAgencyLabel(label: string): boolean {
  return openDcReviewableNonRelationshipAgencyLabels.has(normalizeName(label).toLowerCase());
}

function shouldCreateOpenDcLegalRef(
  authorityText: string,
  authorityUrl: string | undefined,
  parsed: ReturnType<typeof parseLegalReference>,
): boolean {
  if (parsed.refType !== "unknown") return true;
  return looksLikeOpenDcReviewableAuthority(authorityText, authorityUrl);
}

function looksLikeOpenDcReviewableAuthority(
  authorityText: string,
  authorityUrl?: string,
): boolean {
  const text = normalizeName(stripHtml(authorityText));
  if (!text || looksLikeOpenDcNonLegalAuthority(text)) return false;
  if (
    authorityUrl &&
    /(law\.cornell\.edu\/uscode|code\.dccouncil|dccode\.org|dcregs\.dc\.gov|Mayors?_Order_[0-9]{4}-[0-9]{2,3})/i
      .test(authorityUrl)
  ) {
    return true;
  }
  return /\b(?:U\.?S\.?\s+Code|D\.?\s*C\.?\s*(?:Official\s+)?Code|D\.?\s*C\.?\s*M\.?\s*R|D\.?\s*C\.?\s+Law|D\.?\s*C\.?\s+Act|Public\s+Law|Mayor['’]?s?\s+Order|MO\s+[0-9]{4}-[0-9]{2,3}|CDCR\s+[0-9A-Za-z.\-]+|[0-9]{4}-[0-9]{2,3}\s*;\s*amended\s+by|§)\b/i
    .test(text);
}

function looksLikeOpenDcNonLegalAuthority(text: string): boolean {
  return /^(?:n\/a|na|none)$/i.test(text) ||
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ||
    /^(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(text) ||
    /\bmeeting\b/i.test(text) ||
    /\bguidelines?\b/i.test(text) ||
    /\bbylaws?\b/i.test(text) ||
    /^[A-Z]{2,6}$/.test(text);
}

function buildOpenDcAgencyLabelReviewItem(input: {
  itemKey: string;
  detailName: string;
  detailUrl: string;
  fieldPath: "governingAgency" | "administeringAgency";
  rawValue: string;
}): ReviewItemInput {
  const subjectId = openDcSource.sourceId;
  return {
    reviewItemId: buildReviewItemId(
      subjectId,
      `${input.itemKey}-${input.fieldPath}-${input.rawValue}`,
    ),
    itemType: "source_status",
    subjectId,
    reason: "Review Open DC agency label that did not map to a relationship endpoint",
    defaultAction: "defer",
    details: {
      needsReview: true,
      sourceId: openDcSource.sourceId,
      endpointId: "open_dc.public_bodies.detail",
      itemKey: input.itemKey,
      detailName: input.detailName,
      detailUrl: input.detailUrl,
      fieldPath: input.fieldPath,
      rawValue: input.rawValue,
      relationshipType: "governed_by",
      whyDeferred:
        "Open DC label looks like an agency endpoint but did not map to an accepted relationship endpoint.",
    },
  };
}

const openDcNonRelationshipAgencyLabels = new Set([
  "board of trustees",
  "independent agency",
]);

const openDcReviewableNonRelationshipAgencyLabels = new Set([
  "department of eduaction",
  "mayor's office of general counsel",
]);

function parseOpenDcDetail(
  html: string,
  detailUrl: string,
): {
  slug: string;
  name: string;
  governingAgency?: string;
  administeringAgency?: string;
  enablingAuthority?: string;
  enablingAuthorityUrl?: string;
  meetingCount: number;
  meetingLinks: Array<{ href: string; label: string }>;
  documentLinks: Array<{ href: string; label: string }>;
} {
  const slug = detailUrl.split("/").pop() ?? detailUrl;
  const name = captureSingle(html, /<h1 class="page-title">([^<]+)<\/h1>/i) ?? slug;
  const enablingAuthorityUrl = toPublicHttpUrl(
    detailUrl,
    captureSingle(
      html,
      /Enabling Statute \/ Mayoral Order:[\s\S]*?<div class="field-items"><div class="field-item even"><a href="([^"]+)"/i,
    ),
  );
  const enablingAuthority = captureSingle(
    html,
    /Enabling Statute \/ Mayoral Order:[\s\S]*?<div class="field-items"><div class="field-item even"><a [^>]+>([\s\S]*?)<\/a>/i,
  ) ??
    captureSingle(
      html,
      /Enabling Statute \/ Mayoral Order:[\s\S]*?<div class="field-items"><div class="field-item even">([\s\S]*?)<\/div>/i,
    );
  const governingAgency = captureSingle(
    html,
    /Governing Agency \/ Agency Acronym:[\s\S]*?<div class="field-items"><div class="field-item even">([\s\S]*?)<\/div>/i,
  );
  const administeringAgency = captureSingle(
    html,
    /Administering Agency \/ Agency Acronym:[\s\S]*?<div class="field-items"><div class="field-item even">([\s\S]*?)<\/div>/i,
  );
  const meetingCount = [...html.matchAll(/class="view-meetings-calendar"/g)].length;
  const meetingLinks = [...html.matchAll(/<a href="([^"]*meetings[^"]*)"[^>]*>(.*?)<\/a>/gsi)]
    .map((match) => ({
      href: toPublicHttpUrl(detailUrl, match[1]),
      label: normalizeName(stripHtml(match[2])),
    }))
    .filter((link): link is { href: string; label: string } => link.href !== undefined);
  const documentLinks = [...html.matchAll(/<a href="([^"]+\.pdf[^"]*)"[^>]*>(.*?)<\/a>/gsi)]
    .map((match) => ({
      href: toPublicHttpUrl(detailUrl, match[1]),
      label: normalizeName(stripHtml(match[2])),
    }))
    .filter((link): link is { href: string; label: string } => link.href !== undefined);
  return {
    slug,
    name: normalizeName(stripHtml(name)),
    governingAgency: governingAgency ? normalizeName(stripHtml(governingAgency)) : undefined,
    administeringAgency: administeringAgency
      ? normalizeName(stripHtml(administeringAgency))
      : undefined,
    enablingAuthority: enablingAuthority ? normalizeName(stripHtml(enablingAuthority)) : undefined,
    enablingAuthorityUrl,
    meetingCount,
    meetingLinks,
    documentLinks,
  };
}
