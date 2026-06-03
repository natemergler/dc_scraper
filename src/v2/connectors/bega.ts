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
} from "./shared.ts";

const begaSource: SourceDefinition = {
  sourceId: "bega.structure",
  title: "BEGA Open-Government Structure",
  kind: "independent_agency_pages",
  accessMethod: "official_page_html",
  baseUrl: "https://bega.dc.gov/",
  notes:
    "Captures only the shallow institutional structure around BEGA, the Office of Government Ethics, and the Office of Open Government.",
};

const begaUrl = "https://bega.dc.gov/node/61616/";
const ogeUrl = "https://bega.dc.gov/page/office-government-ethics";
const oogUrl = "https://www.open-dc.gov/office-open-government";
const begaName = "Board of Ethics and Government Accountability";
const ogeName = "Office of Government Ethics";
const oogName = "Office of Open Government";
const sharedBranch = "Independent";
const sharedCluster = "Ethics and Open Government";

export const begaConnector: SourceConnector = {
  sourceId: begaSource.sourceId,
  source: begaSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const begaEndpoint: SourceEndpointDefinition = {
      endpointId: "bega.structure.about",
      sourceId: begaSource.sourceId,
      title: "About BEGA page",
      kind: "page",
      url: begaUrl,
      method: "GET",
      captureMode: "page",
    };
    const ogeEndpoint: SourceEndpointDefinition = {
      endpointId: "bega.structure.oge",
      sourceId: begaSource.sourceId,
      title: "Office of Government Ethics page",
      kind: "page",
      url: ogeUrl,
      method: "GET",
      captureMode: "page",
    };
    const oogEndpoint: SourceEndpointDefinition = {
      endpointId: "bega.structure.oog",
      sourceId: begaSource.sourceId,
      title: "Office of Open Government page",
      kind: "page",
      url: oogUrl,
      method: "GET",
      captureMode: "page",
    };

    const begaHtml = await fetchText(context, begaUrl);
    const ogeHtml = await fetchText(context, ogeUrl);
    const oogHtml = await fetchText(context, oogUrl);

    const begaSummary = maybeString(
      captureSingle(
        begaHtml,
        /The Board of Ethics and Government Accountability \(BEGA\)[\s\S]*?five Member Board\./i,
        0,
      ),
    ) ?? begaName;
    const ogeHeading = pageHeading(ogeHtml) ?? ogeName;
    const ogeSummary = maybeString(
      captureSingle(
        ogeHtml,
        /The\s+<strong>Office of Government Ethics \(OGE\)<\/strong>[\s\S]*?officials\./i,
        0,
      ),
    ) ?? ogeHeading;
    const oogHeading = pageHeading(oogHtml) ?? pageTitle(oogHtml) ?? oogName;
    const oogSummary = maybeString(
      captureSingle(
        oogHtml,
        /The Office of Open Government \(OOG\)[\s\S]*?District of Columbia\./i,
        0,
      ),
    ) ?? oogHeading;

    const begaItem: SourceItemInput = {
      itemKey: "about-bega",
      itemType: "institution_page",
      title: "About BEGA",
      body: {
        pageUrl: begaUrl,
        entityName: begaName,
        includesOffices: [ogeName, oogName],
      },
    };
    const ogeItem: SourceItemInput = {
      itemKey: "office-government-ethics",
      itemType: "institution_page",
      title: ogeHeading,
      body: {
        pageUrl: ogeUrl,
        entityName: ogeName,
        parentName: begaName,
      },
    };
    const oogItem: SourceItemInput = {
      itemKey: "office-open-government",
      itemType: "institution_page",
      title: oogHeading,
      body: {
        pageUrl: oogUrl,
        entityName: oogName,
        parentName: begaName,
      },
    };

    const entityCandidates: EntityCandidateInput[] = [
      {
        candidateId: buildCandidateId(begaSource.sourceId, begaName),
        sourceItemKey: begaItem.itemKey,
        proposedEntityId: buildEntityId(begaName),
        name: begaName,
        kind: "agency",
        rawKind: "independent_agency",
        branch: sharedBranch,
        cluster: sharedCluster,
        officialUrl: begaUrl,
        confidence: 0.99,
        duplicateHint: begaUrl,
        evidence: [
          fieldEvidence("body.summary", begaSummary),
        ],
      },
      {
        candidateId: buildCandidateId(begaSource.sourceId, ogeName),
        sourceItemKey: ogeItem.itemKey,
        proposedEntityId: buildEntityId(ogeName),
        name: ogeName,
        kind: "office",
        rawKind: "office",
        branch: sharedBranch,
        cluster: sharedCluster,
        officialUrl: ogeUrl,
        confidence: 0.98,
        duplicateHint: ogeUrl,
        evidence: [
          fieldEvidence("h1", ogeHeading),
          fieldEvidence("body.summary", ogeSummary),
        ],
      },
      {
        candidateId: buildCandidateId(begaSource.sourceId, oogName),
        sourceItemKey: oogItem.itemKey,
        proposedEntityId: buildEntityId(oogName),
        name: oogName,
        kind: "office",
        rawKind: "office",
        branch: sharedBranch,
        cluster: sharedCluster,
        officialUrl: oogUrl,
        confidence: 0.98,
        duplicateHint: oogUrl,
        evidence: [
          fieldEvidence("h1", oogHeading),
          fieldEvidence("body.summary", oogSummary),
        ],
      },
    ];

    const relationshipCandidates: RelationshipCandidateInput[] = [
      buildPartOfRelationship(
        ogeItem.itemKey,
        buildEntityId(ogeName),
        buildEntityId(begaName),
        begaName,
      ),
      buildPartOfRelationship(
        oogItem.itemKey,
        buildEntityId(oogName),
        buildEntityId(begaName),
        begaName,
      ),
    ];

    const reviewItems = [
      ...entityCandidates.map((candidate) =>
        buildCandidateReviewItem(
          candidate.candidateId,
          "Review BEGA structure candidate",
          "accept",
          {
            source: begaSource.sourceId,
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
        reason: "Review BEGA structural part_of relationship",
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
      source: begaSource,
      endpointResults: [
        {
          endpoint: begaEndpoint,
          status: "success",
          artifacts: [artifact("page", "html", begaUrl, begaHtml)],
          parsed: {
            items: [begaItem],
            entityCandidates: [entityCandidates[0]],
            reviewItems: [reviewItems[0]],
          },
        },
        {
          endpoint: ogeEndpoint,
          status: "success",
          artifacts: [artifact("page", "html", ogeUrl, ogeHtml)],
          parsed: {
            items: [ogeItem],
            entityCandidates: [entityCandidates[1]],
            relationshipCandidates: [relationshipCandidates[0]],
            reviewItems: [reviewItems[1], reviewItems[3]],
          },
        },
        {
          endpoint: oogEndpoint,
          status: "success",
          artifacts: [artifact("page", "html", oogUrl, oogHtml)],
          parsed: {
            items: [oogItem],
            entityCandidates: [entityCandidates[2]],
            relationshipCandidates: [relationshipCandidates[1]],
            reviewItems: [reviewItems[2], reviewItems[4]],
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

function pageHeading(html: string): string | undefined {
  return maybeString(
    captureSingle(html, /<h1[^>]*class="[^"]*page-title[^"]*"[^>]*>\s*([^<]+?)\s*<\/h1>/i) ??
      captureSingle(html, /<h1[^>]*id="page-title"[^>]*>\s*([^<]+?)\s*<\/h1>/i),
  );
}

function pageTitle(html: string): string | undefined {
  return maybeString(captureSingle(html, /<title>\s*([^<]+?)\s*<\/title>/i));
}

function buildPartOfRelationship(
  sourceItemKey: string,
  fromEntityRef: string,
  toEntityRef: string,
  rawValue: string,
): RelationshipCandidateInput {
  return {
    relationshipCandidateId: buildRelationshipCandidateId(
      begaSource.sourceId,
      `${sourceItemKey}-part-of`,
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
