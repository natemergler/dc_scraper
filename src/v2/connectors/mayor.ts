import {
  buildCandidateId,
  buildEntityId,
  buildRelationshipCandidateId,
  buildReviewItemId,
  type EntityCandidateInput,
  normalizeName,
  type RelationshipCandidateInput,
  slugify,
  type SourceDefinition,
  type SourceEndpointDefinition,
  type SourceItemInput,
  stripHtml,
} from "../domain.ts";
import {
  artifact,
  buildCandidateReviewItem,
  captureSingle,
  type ConnectorContext,
  type ConnectorResult,
  fieldEvidence,
  type SourceConnector,
  toAbsoluteUrl,
} from "./shared.ts";

export const mayorOfficeSource: SourceDefinition = {
  sourceId: "mayor.office",
  title: "Mayor Officeholder",
  kind: "official_page_html",
  accessMethod: "official_page_html",
  baseUrl: "https://mayor.dc.gov/",
  tier: "tier0",
  releaseRole: "structure",
  smokeProfiles: ["structure", "tier0"],
  privacyNotes: [
    "Capture only the public mayor officeholder name and official biography URL.",
  ],
};

const mayorOfficeName = "Mayor";

interface MayorOfficeholder {
  name: string;
  titleText: string;
  bioUrl?: string;
}

export const mayorOfficeConnector: SourceConnector = {
  sourceId: mayorOfficeSource.sourceId,
  source: mayorOfficeSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const endpoint: SourceEndpointDefinition = {
      endpointId: "mayor.office.home",
      sourceId: mayorOfficeSource.sourceId,
      title: "Mayor homepage",
      kind: "page",
      url: mayorOfficeSource.baseUrl,
      method: "GET",
      captureMode: "page",
    };
    const response = await context.fetcher(mayorOfficeSource.baseUrl);
    const html = await response.text();
    const officeholder = parseMayorOfficeholder(html);
    if (!officeholder) {
      return {
        source: mayorOfficeSource,
        endpointResults: [{
          endpoint,
          status: "success",
          artifacts: [artifact("page", "html", mayorOfficeSource.baseUrl, html)],
          parsed: {
            items: [{
              itemKey: "mayor-home",
              itemType: "mayor_homepage",
              title: "Mayor homepage",
              body: { pageUrl: mayorOfficeSource.baseUrl, officeholderFound: false },
            }],
            reviewItems: [{
              reviewItemId: buildReviewItemId("mayor.office.home", "missing-officeholder"),
              itemType: "source_status",
              subjectId: "mayor.office.home",
              reason: "Mayor homepage did not expose a parseable officeholder name",
              defaultAction: "defer",
              details: { source: mayorOfficeSource.sourceId, pageUrl: mayorOfficeSource.baseUrl },
            }],
          },
        }],
      };
    }

    const item: SourceItemInput = {
      itemKey: "mayor-home",
      itemType: "mayor_homepage",
      title: officeholder.titleText,
      body: {
        pageUrl: mayorOfficeSource.baseUrl,
        officeholderName: officeholder.name,
        officeTitle: mayorOfficeName,
        bioUrl: officeholder.bioUrl ?? null,
      },
    };
    const entityCandidates = buildMayorEntityCandidates(item, officeholder);
    const relationshipCandidates = buildMayorRelationships(item, officeholder);
    const reviewItems = [
      ...entityCandidates.map((candidate) =>
        buildCandidateReviewItem(
          candidate.candidateId,
          "Review Mayor officeholder candidate",
          "accept",
          {
            source: mayorOfficeSource.sourceId,
            name: candidate.name,
            kind: candidate.kind,
            officialUrl: candidate.officialUrl ?? null,
          },
        )
      ),
      ...relationshipCandidates.map((candidate) => ({
        reviewItemId: buildReviewItemId(candidate.relationshipCandidateId, "holds"),
        itemType: "relationship_candidate" as const,
        subjectId: candidate.relationshipCandidateId,
        reason: "Review Mayor officeholder relationship",
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
      source: mayorOfficeSource,
      endpointResults: [{
        endpoint,
        status: "success",
        artifacts: [artifact("page", "html", mayorOfficeSource.baseUrl, html)],
        parsed: {
          items: [item],
          entityCandidates,
          relationshipCandidates,
          reviewItems,
        },
      }],
    };
  },
};

export function parseMayorOfficeholder(html: string): MayorOfficeholder | undefined {
  const titleText = normalizeName(
    stripHtml(
      captureSingle(html, /<h2[^>]*class="[^"]*\bcat-main\b[^"]*"[^>]*>([\s\S]*?)<\/h2>/i) ?? "",
    ),
  );
  const match = titleText.match(/^Mayor\s+(.+)$/i);
  const name = normalizeName(match?.[1] ?? "");
  if (!name) return undefined;
  return {
    name,
    titleText,
    bioUrl: parseMayorBioUrl(html, name),
  };
}

function parseMayorBioUrl(html: string, officeholderName: string): string | undefined {
  const lastName = officeholderName.split(/\s+/).at(-1) ?? "";
  const linkPattern = new RegExp(
    `<a\\s+href="([^"]+)"[^>]*(?:title="[^"]*Bio[^"]*"[^>]*)?>[\\s\\S]*?(?:Read\\s+Mayor\\s+${
      escapeRegExp(lastName)
    }[^<]*Bio|Mayor[^<]*Biography)[\\s\\S]*?<\\/a>`,
    "i",
  );
  const href = captureSingle(html, linkPattern);
  return href ? toAbsoluteUrl(mayorOfficeSource.baseUrl, href) : undefined;
}

function buildMayorEntityCandidates(
  item: SourceItemInput,
  officeholder: MayorOfficeholder,
): EntityCandidateInput[] {
  return [{
    candidateId: buildCandidateId(
      mayorOfficeSource.sourceId,
      `person-${slugify(officeholder.name)}`,
    ),
    sourceItemKey: item.itemKey,
    proposedEntityId: buildEntityId(officeholder.name),
    name: officeholder.name,
    kind: "public_official",
    rawKind: "person",
    officialUrl: officeholder.bioUrl,
    confidence: 0.99,
    duplicateHint: officeholder.bioUrl,
    evidence: [fieldEvidence("officeholder", officeholder.titleText, 0)],
  }, {
    candidateId: buildCandidateId(mayorOfficeSource.sourceId, "mayor-office"),
    sourceItemKey: item.itemKey,
    proposedEntityId: buildEntityId(mayorOfficeName),
    name: mayorOfficeName,
    kind: "office",
    rawKind: "office",
    officialUrl: mayorOfficeSource.baseUrl,
    confidence: 0.99,
    duplicateHint: mayorOfficeSource.baseUrl,
    evidence: [fieldEvidence("office", mayorOfficeName, 0)],
  }];
}

function buildMayorRelationships(
  item: SourceItemInput,
  officeholder: MayorOfficeholder,
): RelationshipCandidateInput[] {
  return [{
    relationshipCandidateId: buildRelationshipCandidateId(
      mayorOfficeSource.sourceId,
      `${slugify(officeholder.name)}>mayor:holds`,
    ),
    sourceItemKey: item.itemKey,
    fromEntityRef: buildEntityId(officeholder.name),
    toEntityRef: buildEntityId(mayorOfficeName),
    relationshipType: "holds",
    rawValue: mayorOfficeName,
    evidence: [fieldEvidence("officeholder", officeholder.titleText, 0)],
  }];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
