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
import {
  artifact,
  buildCandidateReviewItem,
  buildKnownCouncilOversightEntityRef,
  buildKnownEntityRef,
  councilOversightReviewPolicy,
  defaultActionForCouncilOversightTarget,
  fieldEvidence,
} from "./shared.ts";
import type { ConnectorContext, SourceConnector } from "./shared.ts";
import { normalizeName, slugify, stripHtml } from "../domain.ts";

const councilCommitteesSource: SourceDefinition = {
  sourceId: "council.committees",
  title: "Council Committees",
  kind: "committee_pages",
  accessMethod: "official_page_html",
  baseUrl: "https://dccouncil.gov/committees/",
  tier: "tier0",
  releaseRole: "structure",
  smokeProfiles: ["structure", "tier0"],
  privacyNotes: [
    "Keep committee structure and oversight evidence; no staff-directory or contact output.",
  ],
};

const councilLimsSource: SourceDefinition = {
  sourceId: "council.lims",
  title: "Council LIMS What's New",
  kind: "json_api",
  accessMethod: "official_json_api",
  baseUrl: "https://lims.dccouncil.gov/api/Search/GetWhatsNew",
  tier: "tier1",
  releaseRole: "inventory",
  smokeProfiles: ["structure", "inventory"],
  privacyNotes: [
    "Inventory-only legislative publication surface; do not imply full legal-action modeling.",
  ],
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
    const committees = parseCouncilCommittees(html).slice(0, context.limit ?? 12);
    const committeeDetails = await fetchCommitteeDetails(context.fetcher, committees);
    const items: SourceItemInput[] = committees.map((committee) => ({
      itemKey: committee.slug,
      itemType: "committee_page",
      title: committee.name,
      body: committee,
    }));
    for (const detail of committeeDetails) {
      items.push({
        itemKey: `${detail.committee.slug}:oversight`,
        itemType: "committee_oversight_detail",
        title: `${detail.committee.name} oversight detail`,
        artifactIndex: detail.artifactIndex,
        body: {
          committee: detail.committee.name,
          oversightTargets: detail.oversightTargets,
        },
      });
      items.push({
        itemKey: `${detail.committee.slug}:members`,
        itemType: "committee_members_detail",
        title: `${detail.committee.name} councilmembers detail`,
        artifactIndex: detail.artifactIndex,
        body: {
          committee: detail.committee.name,
          chairperson: detail.chairperson,
          members: detail.members,
        },
      });
    }
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
      evidence: [fieldEvidence("committee", committee.name, 0)],
    }));
    const relationshipCandidates: RelationshipCandidateInput[] = committees.map((committee) => ({
      relationshipCandidateId: buildRelationshipCandidateId(
        councilCommitteesSource.sourceId,
        `${committee.slug}-part-of`,
      ),
      sourceItemKey: committee.slug,
      fromEntityRef: buildEntityId(committee.name),
      toEntityRef: buildKnownEntityRef("Council"),
      relationshipType: "part_of",
      rawValue: "Council committee",
      evidence: [fieldEvidence("committee", committee.name, 0)],
    }));
    for (const detail of committeeDetails) {
      for (
        const [index, target] of detail.oversightTargets.filter(isExplicitOversightTarget)
          .entries()
      ) {
        relationshipCandidates.push({
          relationshipCandidateId: buildRelationshipCandidateId(
            councilCommitteesSource.sourceId,
            `${detail.committee.slug}-oversight-${index + 1}`,
          ),
          sourceItemKey: `${detail.committee.slug}:oversight`,
          fromEntityRef: buildKnownCouncilOversightEntityRef(target),
          toEntityRef: buildEntityId(detail.committee.name),
          relationshipType: "overseen_by",
          rawValue: target,
          needsReview: true,
          evidence: [fieldEvidence("oversight", target, detail.artifactIndex)],
        });
      }
    }
    for (const detail of committeeDetails) {
      if (detail.chairperson) {
        relationshipCandidates.push(
          ...buildCommitteeMemberRelationships(detail.committee, detail.chairperson, true),
        );
      }
      for (const member of detail.members) {
        relationshipCandidates.push(
          ...buildCommitteeMemberRelationships(detail.committee, member, false),
        );
      }
    }
    const reviewItems: ReviewItemInput[] = [
      ...entityCandidates.map((candidate) =>
        buildCandidateReviewItem(
          candidate.candidateId,
          "Review Council committee candidate",
          "accept",
          {
            name: candidate.name,
            kind: candidate.kind,
            confidence: candidate.confidence,
            officialUrl: candidate.officialUrl,
            duplicateHint: candidate.duplicateHint,
          },
        )
      ),
      ...relationshipCandidates.map((candidate) => ({
        reviewItemId: buildReviewItemId(candidate.relationshipCandidateId, "committee"),
        itemType: "relationship_candidate" as const,
        subjectId: candidate.relationshipCandidateId,
        reason: candidate.relationshipType === "overseen_by"
          ? "Review Council committee oversight relationship"
          : candidate.relationshipType === "chairs"
          ? "Review committee chair relationship"
          : candidate.relationshipType === "member_of"
          ? "Review committee member relationship"
          : "Review committee to Council relationship",
        defaultAction: defaultActionForRelationship(candidate),
        details: {
          fromEntityRef: candidate.fromEntityRef,
          toEntityRef: candidate.toEntityRef,
          relationshipType: candidate.relationshipType,
          rawValue: candidate.rawValue,
          ...relationshipReviewPolicyDetails(candidate),
        },
      })),
    ];
    return {
      source: councilCommitteesSource,
      endpointResults: [{
        endpoint,
        status: "success",
        artifacts: [
          artifact("page", "html", councilCommitteesSource.baseUrl, html),
          ...committeeDetails.map((detail) =>
            artifact("page", "html", detail.committee.url, detail.html)
          ),
        ],
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

function defaultActionForRelationship(candidate: RelationshipCandidateInput): "accept" | "defer" {
  if (candidate.relationshipType !== "overseen_by") return "accept";
  return defaultActionForCouncilOversightTarget(candidate.rawValue);
}

function relationshipReviewPolicyDetails(
  candidate: RelationshipCandidateInput,
): Record<string, unknown> {
  if (candidate.relationshipType !== "overseen_by") return {};
  const policy = councilOversightReviewPolicy(candidate.rawValue);
  return policy.whyDeferred ? { whyDeferred: policy.whyDeferred } : {};
}

function isExplicitOversightTarget(target: string): boolean {
  return !/^all of the\b/i.test(target.trim());
}

function buildCommitteeMemberRelationships(
  committee: { slug: string; name: string; url: string },
  member: { name: string; url: string },
  chair: boolean,
): RelationshipCandidateInput[] {
  const committeeId = buildEntityId(committee.name);
  const memberId = buildEntityId(member.name);
  const relationships: RelationshipCandidateInput[] = [];
  if (chair) {
    relationships.push({
      relationshipCandidateId: buildRelationshipCandidateId(
        councilCommitteesSource.sourceId,
        `${committee.slug}-${slugify(member.url)}-chairs`,
      ),
      sourceItemKey: `${committee.slug}:members`,
      fromEntityRef: memberId,
      toEntityRef: committeeId,
      relationshipType: "chairs",
      rawValue: member.name,
      evidence: [fieldEvidence("chairperson", member.name, 1)],
    });
  }
  relationships.push({
    relationshipCandidateId: buildRelationshipCandidateId(
      councilCommitteesSource.sourceId,
      `${committee.slug}-${slugify(member.url)}-member_of`,
    ),
    sourceItemKey: `${committee.slug}:members`,
    fromEntityRef: memberId,
    toEntityRef: committeeId,
    relationshipType: "member_of",
    rawValue: member.name,
    evidence: [fieldEvidence("member", member.name, 1)],
  });
  return relationships;
}

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

interface CommitteeDetailRecord {
  committee: { slug: string; name: string; url: string };
  html: string;
  artifactIndex: number;
  oversightTargets: string[];
  chairperson?: { name: string; url: string };
  members: Array<{ name: string; url: string }>;
}

async function fetchCommitteeDetails(
  fetcher: ConnectorContext["fetcher"],
  committees: Array<{ slug: string; name: string; url: string }>,
): Promise<CommitteeDetailRecord[]> {
  const records: CommitteeDetailRecord[] = [];
  for (const [index, committee] of committees.entries()) {
    const response = await fetcher(committee.url);
    const html = await response.text();
    records.push({
      committee,
      html,
      artifactIndex: index + 1,
      oversightTargets: parseOversightTargets(html),
      ...parseCommitteeMembers(html),
    });
  }
  return records;
}

function parseOversightTargets(html: string): string[] {
  const oversightBlock = captureOversightBlock(html);
  if (!oversightBlock) return [];
  return [...oversightBlock.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gsi)]
    .map((match) => normalizeName(stripHtml(match[1])))
    .filter((value) => value.length > 0);
}

function captureOversightBlock(html: string): string | undefined {
  const match = html.match(
    /<h[1-6][^>]*>\s*(?:Oversight|Agencies Under This Committee)\s*<\/h[1-6]>[\s\S]*?(<ul[^>]*>[\s\S]*?<\/ul>)/i,
  );
  return match?.[1];
}

function parseCommitteeMembers(html: string): {
  chairperson?: { name: string; url: string };
  members: Array<{ name: string; url: string }>;
} {
  const councilmembersBlock = html.match(
    /<h[1-6][^>]*>\s*Councilmembers\s*<\/h[1-6]>\s*([\s\S]*?)(?=<h[1-3][^>]*>|<footer|<\/main>)/i,
  )?.[1] ?? "";
  const chairpersonMatch = councilmembersBlock.match(
    /<h4[^>]*>\s*Chairperson\s*<\/h4>[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
  );
  const membersSection = councilmembersBlock.match(
    /<h4[^>]*>\s*Councilmembers\s*<\/h4>\s*([\s\S]*)/i,
  )?.[1] ?? "";
  const chairperson = chairpersonMatch
    ? {
      url: chairpersonMatch[1],
      name: normalizeName(stripHtml(chairpersonMatch[2])),
    }
    : undefined;
  const members = [
    ...membersSection.matchAll(
      /<a href="(https:\/\/dccouncil\.gov\/council\/[^\"]+)"[^>]*>([\s\S]*?)<\/a>/gsi,
    ),
  ]
    .map((match) => ({
      url: match[1],
      name: normalizeName(stripHtml(match[2])),
    }))
    .filter((member) => member.name.length > 0);
  return { chairperson, members };
}
