import {
  buildCandidateId,
  buildDatasetId,
  buildEntityId,
  buildRelationshipCandidateId,
  buildReviewItemId,
  type ConnectorResult,
  type DatasetInput,
  type RelationshipCandidateInput,
  type ReviewItemInput,
  type SourceDefinition,
  type SourceEndpointDefinition,
  type SourceItemInput,
} from "../domain.ts";
import { artifact, buildCandidateReviewItem, fieldEvidence } from "./shared.ts";
import type { ConnectorContext, SourceConnector } from "./shared.ts";
import { normalizeName, stripHtml } from "../domain.ts";

const councilCommitteesSource: SourceDefinition = {
  sourceId: "council.committees",
  title: "Council Committees",
  kind: "committee_pages",
  accessMethod: "official_page_html",
  baseUrl: "https://dccouncil.gov/committees/",
};

const councilLimsSource: SourceDefinition = {
  sourceId: "council.lims",
  title: "Council LIMS What's New",
  kind: "json_api",
  accessMethod: "official_json_api",
  baseUrl: "https://lims.dccouncil.gov/api/Search/GetWhatsNew",
};

export const councilCommitteesConnector: SourceConnector = {
  sourceId: councilCommitteesSource.sourceId,
  source: councilCommitteesSource,
  async run(context): Promise<ConnectorResult> {
    const endpoint: SourceEndpointDefinition = {
      endpointId: "council.committees.page",
      sourceId: councilCommitteesSource.sourceId,
      title: "Council committees page",
      kind: "page",
      url: councilCommitteesSource.baseUrl,
      method: "GET",
      captureMode: "page",
    };
    const response = await context.fetcher(councilCommitteesSource.baseUrl);
    const html = await response.text();
    const committees = parseCouncilCommittees(html);
    const items: SourceItemInput[] = committees.map((committee) => ({
      itemKey: committee.slug,
      itemType: "committee_page",
      title: committee.name,
      body: committee,
    }));
    const entityCandidates = committees.map((committee) => ({
      candidateId: buildCandidateId(councilCommitteesSource.sourceId, committee.slug),
      sourceItemKey: committee.slug,
      proposedEntityId: buildEntityId(committee.name),
      name: committee.name,
      kind: "committee",
      rawKind: "committee",
      officialUrl: committee.url,
      confidence: 0.95,
      duplicateHint: committee.url,
      evidence: [fieldEvidence("committee", committee.name)],
    }));
    const relationshipCandidates: RelationshipCandidateInput[] = committees.map((committee) => ({
      relationshipCandidateId: buildRelationshipCandidateId(
        councilCommitteesSource.sourceId,
        `${committee.slug}-part-of`,
      ),
      sourceItemKey: committee.slug,
      fromEntityRef: buildEntityId(committee.name),
      toEntityRef: "dc.council",
      relationshipType: "part_of",
      rawValue: "Council committee",
      evidence: [fieldEvidence("committee", committee.name)],
    }));
    const reviewItems: ReviewItemInput[] = [
      ...entityCandidates.map((candidate) =>
        buildCandidateReviewItem(candidate.candidateId, "Review Council committee candidate")
      ),
      ...relationshipCandidates.map((candidate) => ({
        reviewItemId: buildReviewItemId(candidate.relationshipCandidateId, "committee"),
        itemType: "relationship_candidate" as const,
        subjectId: candidate.relationshipCandidateId,
        reason: "Review committee to Council relationship",
        defaultAction: "accept",
        details: {},
      })),
    ];
    return {
      source: councilCommitteesSource,
      endpointResults: [{
        endpoint,
        status: "success",
        artifacts: [artifact("page", "html", councilCommitteesSource.baseUrl, html)],
        parsed: {
          items,
          entityCandidates,
          relationshipCandidates,
          reviewItems,
        },
      }],
    };
  },
};

export const councilLimsConnector: SourceConnector = {
  sourceId: councilLimsSource.sourceId,
  source: councilLimsSource,
  async run(context): Promise<ConnectorResult> {
    const endpoint: SourceEndpointDefinition = {
      endpointId: "council.lims.whats_new",
      sourceId: councilLimsSource.sourceId,
      title: "Council LIMS what's new",
      kind: "json",
      url: councilLimsSource.baseUrl,
      method: "GET",
      captureMode: "sample",
    };
    const response = await context.fetcher(councilLimsSource.baseUrl);
    const payloadText = await response.text();
    const payload = JSON.parse(payloadText);
    const items: SourceItemInput[] = payload.map((row: Record<string, unknown>) => ({
      itemKey: String(row.legislationNumber ?? row.legislationId),
      itemType: "lims_legislation_item",
      title: String(row.title ?? row.legislationNumber),
      body: row,
    }));
    const dataset: DatasetInput = {
      datasetId: buildDatasetId(councilLimsSource.sourceId, "whats-new"),
      sourceItemKey: items[0]?.itemKey ?? "whats-new",
      name: "Council LIMS What's New feed",
      category: "legislative",
      ownerName: "Council of the District of Columbia",
      accessMethod: councilLimsSource.accessMethod,
      artifactDepth: "sample",
      officialUrl: councilLimsSource.baseUrl,
      evidence: [fieldEvidence("endpoint", councilLimsSource.baseUrl)],
    };
    return {
      source: councilLimsSource,
      endpointResults: [{
        endpoint,
        status: "success",
        artifacts: [artifact("sample", "json", councilLimsSource.baseUrl, payloadText)],
        parsed: {
          items,
          datasets: [dataset],
        },
      }],
    };
  },
};

function parseCouncilCommittees(html: string): Array<{ slug: string; name: string; url: string }> {
  const matches = [
    ...html.matchAll(/<a href="(https:\/\/dccouncil\.gov\/committees\/[^"]+)"[^>]*>(.*?)<\/a>/gsi),
  ];
  const seen = new Set<string>();
  const results: Array<{ slug: string; name: string; url: string }> = [];
  for (const match of matches) {
    const url = match[1];
    const name = normalizeName(stripHtml(match[2]));
    if (!name || name.startsWith("Committees")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({
      slug: url.replaceAll(/\/+$/g, "").split("/").pop() ?? name,
      name,
      url,
    });
  }
  return results;
}
