import {
  buildCandidateId,
  buildEntityId,
  buildRelationshipCandidateId,
  buildReviewItemId,
  type EntityCandidateInput,
  type RelationshipCandidateInput,
  type SourceDefinition,
  type SourceEndpointDefinition,
  type SourceItemInput,
} from "../domain.ts";
import {
  artifact,
  buildCandidateReviewItem,
  captureSingle,
  type ConnectorContext,
  type ConnectorResult,
  fieldEvidence,
  maybeString,
  type SourceConnector,
  toAbsoluteUrl,
} from "./shared.ts";

const dcCourtsSource: SourceDefinition = {
  sourceId: "dccourts.structure",
  title: "District of Columbia Courts Structure",
  kind: "court_pages",
  accessMethod: "official_page_html",
  baseUrl: "https://www.dccourts.gov/",
  notes:
    "Captures only the shallow institutional court structure: the DC Courts root, the Court of Appeals, the Superior Court, and direct Superior Court divisions.",
  tier: "tier1",
  releaseRole: "structure",
  smokeProfiles: ["structure"],
  privacyNotes: [
    "Institutional court structure only; no judges, case records, or contact-directory data.",
  ],
};

const homeUrl = dcCourtsSource.baseUrl;
const courtOfAppealsUrl = "https://www.dccourts.gov/court-of-appeals";
const superiorCourtUrl = "https://www.dccourts.gov/superior-court";
const dcCourtsRootName = "District of Columbia Courts";

export const dcCourtsConnector: SourceConnector = {
  sourceId: dcCourtsSource.sourceId,
  source: dcCourtsSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const homeEndpoint: SourceEndpointDefinition = {
      endpointId: "dccourts.structure.home",
      sourceId: dcCourtsSource.sourceId,
      title: "DC Courts homepage",
      kind: "page",
      url: homeUrl,
      method: "GET",
      captureMode: "page",
    };
    const courtOfAppealsEndpoint: SourceEndpointDefinition = {
      endpointId: "dccourts.structure.court_of_appeals",
      sourceId: dcCourtsSource.sourceId,
      title: "Court of Appeals page",
      kind: "page",
      url: courtOfAppealsUrl,
      method: "GET",
      captureMode: "page",
    };
    const superiorCourtEndpoint: SourceEndpointDefinition = {
      endpointId: "dccourts.structure.superior_court",
      sourceId: dcCourtsSource.sourceId,
      title: "Superior Court page",
      kind: "page",
      url: superiorCourtUrl,
      method: "GET",
      captureMode: "page",
    };

    const homeHtml = await fetchText(context, homeUrl);
    const courtOfAppealsHtml = await fetchText(context, courtOfAppealsUrl);
    const superiorCourtHtml = await fetchText(context, superiorCourtUrl);

    const homeItem: SourceItemInput = {
      itemKey: "home",
      itemType: "court_page",
      title: pageTitle(homeHtml) ?? "DC Courts Homepage",
      body: {
        pageUrl: homeUrl,
        rootName: dcCourtsRootName,
      },
    };
    const courtOfAppealsName =
      maybeString(captureSingle(courtOfAppealsHtml, /<h1[^>]*>([^<]+)<\/h1>/i)) ??
        "Court of Appeals";
    const courtOfAppealsItem: SourceItemInput = {
      itemKey: "court-of-appeals",
      itemType: "court_page",
      title: courtOfAppealsName,
      body: {
        pageUrl: courtOfAppealsUrl,
        overviewHeading: captureSingle(courtOfAppealsHtml, /<h2[^>]*>\s*Overview\s*<\/h2>/i)
          ? "Overview"
          : null,
      },
    };
    const superiorCourtName =
      maybeString(captureSingle(superiorCourtHtml, /<h1[^>]*>([^<]+)<\/h1>/i)) ??
        "Superior Court";
    const divisionLinks = directSuperiorCourtDivisionLinks(superiorCourtHtml);
    const superiorCourtItem: SourceItemInput = {
      itemKey: "superior-court",
      itemType: "court_page",
      title: superiorCourtName,
      body: {
        pageUrl: superiorCourtUrl,
        divisionCount: divisionLinks.length,
        divisions: divisionLinks,
      },
    };

    const entityCandidates: EntityCandidateInput[] = [
      {
        candidateId: buildCandidateId(dcCourtsSource.sourceId, dcCourtsRootName),
        sourceItemKey: homeItem.itemKey,
        proposedEntityId: buildEntityId(dcCourtsRootName),
        name: dcCourtsRootName,
        kind: "court_system",
        rawKind: "court_system",
        branch: "Judicial",
        cluster: "Judicial",
        officialUrl: homeUrl,
        confidence: 0.99,
        duplicateHint: homeUrl,
        evidence: [fieldEvidence("title", pageTitle(homeHtml) ?? dcCourtsRootName)],
      },
      {
        candidateId: buildCandidateId(dcCourtsSource.sourceId, courtOfAppealsName),
        sourceItemKey: courtOfAppealsItem.itemKey,
        proposedEntityId: buildEntityId(courtOfAppealsName),
        name: courtOfAppealsName,
        kind: "court",
        rawKind: "court",
        branch: "Judicial",
        cluster: "Judicial",
        officialUrl: courtOfAppealsUrl,
        confidence: 0.98,
        duplicateHint: courtOfAppealsUrl,
        evidence: [fieldEvidence("h1", courtOfAppealsName)],
      },
      {
        candidateId: buildCandidateId(dcCourtsSource.sourceId, superiorCourtName),
        sourceItemKey: superiorCourtItem.itemKey,
        proposedEntityId: buildEntityId(superiorCourtName),
        name: superiorCourtName,
        kind: "court",
        rawKind: "court",
        branch: "Judicial",
        cluster: "Judicial",
        officialUrl: superiorCourtUrl,
        confidence: 0.98,
        duplicateHint: superiorCourtUrl,
        evidence: [fieldEvidence("h1", superiorCourtName)],
      },
      ...divisionLinks.map((division) => ({
        candidateId: buildCandidateId(dcCourtsSource.sourceId, division.name),
        sourceItemKey: superiorCourtItem.itemKey,
        proposedEntityId: buildEntityId(division.name),
        name: division.name,
        kind: "court_division",
        rawKind: "court_division",
        branch: "Judicial",
        cluster: "Judicial",
        officialUrl: division.url,
        confidence: 0.96,
        duplicateHint: division.url,
        evidence: [fieldEvidence(`division.${division.slug}`, division.name)],
      })),
    ];

    const relationshipCandidates: RelationshipCandidateInput[] = [
      buildPartOfRelationship(
        "court-of-appeals",
        courtOfAppealsItem.itemKey,
        buildEntityId(courtOfAppealsName),
        buildEntityId(dcCourtsRootName),
        "Court of Appeals",
      ),
      buildPartOfRelationship(
        "superior-court",
        superiorCourtItem.itemKey,
        buildEntityId(superiorCourtName),
        buildEntityId(dcCourtsRootName),
        "Superior Court",
      ),
      ...divisionLinks.map((division) =>
        buildPartOfRelationship(
          division.slug,
          superiorCourtItem.itemKey,
          buildEntityId(division.name),
          buildEntityId(superiorCourtName),
          division.name,
        )
      ),
    ];

    const reviewItems = [
      ...entityCandidates.map((candidate) =>
        buildCandidateReviewItem(
          candidate.candidateId,
          "Review DC Courts structure candidate",
          "accept",
          {
            source: dcCourtsSource.sourceId,
            name: candidate.name,
            kind: candidate.kind,
            officialUrl: candidate.officialUrl ?? null,
          },
        )
      ),
      ...relationshipCandidates.map((candidate) => ({
        reviewItemId: buildReviewItemId(candidate.relationshipCandidateId, "part-of"),
        itemType: "relationship_candidate" as const,
        subjectId: candidate.relationshipCandidateId,
        reason: "Review DC Courts structural part_of relationship",
        defaultAction: "accept",
        details: {
          fromEntityRef: candidate.fromEntityRef,
          toEntityRef: candidate.toEntityRef,
          relationshipType: candidate.relationshipType,
          rawValue: candidate.rawValue ?? null,
        },
      })),
    ];

    return {
      source: dcCourtsSource,
      endpointResults: [
        {
          endpoint: homeEndpoint,
          status: "success",
          artifacts: [artifact("page", "html", homeUrl, homeHtml)],
          parsed: {
            items: [homeItem],
            entityCandidates: [entityCandidates[0]],
            reviewItems: [reviewItems[0]],
          },
        },
        {
          endpoint: courtOfAppealsEndpoint,
          status: "success",
          artifacts: [artifact("page", "html", courtOfAppealsUrl, courtOfAppealsHtml)],
          parsed: {
            items: [courtOfAppealsItem],
            entityCandidates: [entityCandidates[1]],
            relationshipCandidates: [relationshipCandidates[0]],
            reviewItems: [reviewItems[1], reviewItems[entityCandidates.length]],
          },
        },
        {
          endpoint: superiorCourtEndpoint,
          status: "success",
          artifacts: [artifact("page", "html", superiorCourtUrl, superiorCourtHtml)],
          parsed: {
            items: [superiorCourtItem],
            entityCandidates: entityCandidates.slice(2),
            relationshipCandidates: relationshipCandidates.slice(1),
            reviewItems: reviewItems.slice(2),
          },
        },
      ],
    };
  },
};

async function fetchText(context: ConnectorContext, url: string): Promise<string> {
  const response = await context.fetcher(url);
  return await response.text();
}

function pageTitle(html: string): string | undefined {
  return captureSingle(html, /<title>\s*([^<]+?)\s*<\/title>/i);
}

function directSuperiorCourtDivisionLinks(
  html: string,
): Array<{ name: string; slug: string; url: string }> {
  const matches = html.matchAll(
    /<a[^>]+href="(\/superior-court\/superior-court-divisions\/([^/"?#]+))"[^>]*>\s*([^<]+?)\s*<\/a>/gi,
  );
  const seen = new Set<string>();
  const divisions: Array<{ name: string; slug: string; url: string }> = [];
  for (const match of matches) {
    const href = match[1];
    const slug = match[2];
    const name = match[3].replace(/\s+/g, " ").trim();
    if (!name.endsWith("Division")) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    divisions.push({
      name,
      slug,
      url: toAbsoluteUrl(superiorCourtUrl, href),
    });
  }
  return divisions;
}

function buildPartOfRelationship(
  rawKey: string,
  sourceItemKey: string,
  fromEntityRef: string,
  toEntityRef: string,
  rawValue: string,
): RelationshipCandidateInput {
  return {
    relationshipCandidateId: buildRelationshipCandidateId(
      dcCourtsSource.sourceId,
      `${rawKey}-part-of`,
    ),
    sourceItemKey,
    fromEntityRef,
    toEntityRef,
    relationshipType: "part_of",
    rawValue,
    needsReview: true,
    evidence: [fieldEvidence("part_of", rawValue)],
  };
}
