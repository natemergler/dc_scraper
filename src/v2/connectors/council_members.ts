import {
  buildCandidateId,
  buildEntityId,
  buildRelationshipCandidateId,
  buildReviewItemId,
  type ConnectorResult,
  type EntityCandidateInput,
  type RelationshipCandidateInput,
  type ReviewItemInput,
  type SourceDefinition,
  type SourceEndpointDefinition,
  type SourceItemInput,
} from "../domain.ts";
import { artifact, buildCandidateReviewItem, fieldEvidence } from "./shared.ts";
import type { ConnectorContext, SourceConnector } from "./shared.ts";
import { normalizeName, slugify, stripHtml } from "../domain.ts";

const councilMembersSource: SourceDefinition = {
  sourceId: "council.members",
  title: "Council Members and Seats",
  kind: "official_page_html",
  accessMethod: "official_page_html",
  baseUrl: "https://dccouncil.gov/councilmembers/",
  tier: "tier0",
  releaseRole: "structure",
  smokeProfiles: ["structure", "tier0"],
  privacyNotes: [
    "Keep public names, seats, and roles only; no biographies or contact-directory fields.",
  ],
};

interface CouncilMemberBlock {
  title: string;
  people: Array<{ name: string; url: string }>;
}

export const councilMembersConnector: SourceConnector = {
  sourceId: councilMembersSource.sourceId,
  source: councilMembersSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const endpoint: SourceEndpointDefinition = {
      endpointId: "council.members.page",
      sourceId: councilMembersSource.sourceId,
      title: "Council members page",
      kind: "page",
      url: councilMembersSource.baseUrl,
      method: "GET",
      captureMode: "page",
    };
    const response = await context.fetcher(councilMembersSource.baseUrl);
    const html = await response.text();
    const sections = parseCouncilMemberBlocks(html);
    const items: SourceItemInput[] = [{
      itemKey: "council-members-page",
      itemType: "council_members_page",
      title: "Council members page",
      body: { sections },
    }];
    const personCandidates = buildCouncilMemberPersonCandidates(sections);
    const roleCandidates = buildCouncilSeatRoleCandidates(sections);
    const entityCandidates = [
      ...personCandidates,
      ...roleCandidates,
      ...buildWardAndDistrictCandidates(sections),
    ];
    const relationshipCandidates = buildCouncilMemberRelationships(sections);
    const reviewItems: ReviewItemInput[] = [
      ...entityCandidates.map((candidate) =>
        buildCandidateReviewItem(
          candidate.candidateId,
          "Review Council member or role candidate",
          "accept",
          {
            name: candidate.name,
            kind: candidate.kind,
            officialUrl: candidate.officialUrl,
            duplicateHint: candidate.duplicateHint,
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
        reason: "Review Council member-seat relationship",
        defaultAction: "accept",
        details: {
          fromEntityRef: candidate.fromEntityRef,
          toEntityRef: candidate.toEntityRef,
          relationshipType: candidate.relationshipType,
          rawValue: candidate.rawValue,
        },
      })),
    ];
    return {
      source: councilMembersSource,
      endpointResults: [{
        endpoint,
        status: "success",
        artifacts: [artifact("page", "html", councilMembersSource.baseUrl, html)],
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

function buildCouncilMemberPersonCandidates(
  sections: CouncilMemberBlock[],
): EntityCandidateInput[] {
  const seen = new Set<string>();
  const candidates: EntityCandidateInput[] = [];
  for (const section of sections) {
    for (const person of section.people) {
      if (seen.has(person.url)) continue;
      seen.add(person.url);
      candidates.push({
        candidateId: buildCandidateId(
          councilMembersSource.sourceId,
          `person-${slugify(person.url)}`,
        ),
        sourceItemKey: "council-members-page",
        proposedEntityId: buildEntityId(person.name),
        name: person.name,
        kind: "public_official",
        rawKind: "person",
        officialUrl: person.url,
        confidence: 0.99,
        duplicateHint: person.url,
        evidence: [fieldEvidence("member", person.name, 0)],
      });
    }
  }
  return candidates;
}

function buildCouncilSeatRoleCandidates(sections: CouncilMemberBlock[]): EntityCandidateInput[] {
  const candidates: EntityCandidateInput[] = [];
  for (const [sectionIndex, section] of sections.entries()) {
    if (section.title === "Chairman") {
      candidates.push(buildRoleCandidate("Council Chairman", sectionIndex, section.title));
      continue;
    }
    if (section.title === "Chairperson Pro Tempore") {
      candidates.push(
        buildRoleCandidate("Council Chairperson Pro Tempore", sectionIndex, section.title),
      );
      continue;
    }
    if (section.title === "At-Large") {
      for (const [index] of section.people.entries()) {
        candidates.push(
          buildRoleCandidate(`Council At-Large Seat ${index + 1}`, index, section.title),
        );
      }
    }
    if (section.title === "Ward Members") {
      for (const person of section.people) {
        const wardNumber = parseWardNumber(person.name);
        if (!wardNumber) continue;
        candidates.push(
          buildRoleCandidate(`Ward ${wardNumber} Council Seat`, wardNumber - 1, section.title),
        );
      }
    }
  }
  return candidates;
}

function buildWardAndDistrictCandidates(sections: CouncilMemberBlock[]): EntityCandidateInput[] {
  const candidates: EntityCandidateInput[] = [];
  const wardNumbers = new Set<number>();
  let needsDistrict = false;
  for (const section of sections) {
    if (section.title === "At-Large" || section.title === "Chairman") {
      needsDistrict = true;
    }
    if (section.title !== "Ward Members") continue;
    for (const person of section.people) {
      const wardNumber = parseWardNumber(person.name);
      if (wardNumber) wardNumbers.add(wardNumber);
    }
  }
  for (const wardNumber of [...wardNumbers].sort((a, b) => a - b)) {
    candidates.push({
      candidateId: buildCandidateId(councilMembersSource.sourceId, `ward-${wardNumber}`),
      sourceItemKey: "council-members-page",
      proposedEntityId: buildEntityId(`Ward ${wardNumber}`),
      name: `Ward ${wardNumber}`,
      kind: "ward",
      rawKind: "ward",
      confidence: 0.99,
      evidence: [fieldEvidence("ward", wardNumber, 0)],
    });
  }
  if (needsDistrict) {
    candidates.push({
      candidateId: buildCandidateId(councilMembersSource.sourceId, "district-of-columbia"),
      sourceItemKey: "council-members-page",
      proposedEntityId: buildEntityId("District of Columbia"),
      name: "District of Columbia",
      kind: "jurisdiction",
      rawKind: "jurisdiction",
      confidence: 0.99,
      evidence: [fieldEvidence("district", "District of Columbia", 0)],
    });
  }
  return candidates;
}

function buildCouncilMemberRelationships(
  sections: CouncilMemberBlock[],
): RelationshipCandidateInput[] {
  const relationships: RelationshipCandidateInput[] = [];
  for (const section of sections) {
    if (section.title === "Chairman") {
      const person = section.people[0];
      if (!person) continue;
      relationships.push(
        ...buildRoleRelationships(person.name, person.url, "Council Chairman", "district"),
      );
      continue;
    }
    if (section.title === "Chairperson Pro Tempore") {
      const person = section.people[0];
      if (!person) continue;
      relationships.push(...buildRoleRelationships(
        person.name,
        person.url,
        "Council Chairperson Pro Tempore",
      ));
      continue;
    }
    if (section.title === "At-Large") {
      for (const [index, person] of section.people.entries()) {
        relationships.push(...buildRoleRelationships(
          person.name,
          person.url,
          `Council At-Large Seat ${index + 1}`,
          "district",
        ));
      }
      continue;
    }
    if (section.title === "Ward Members") {
      for (const person of section.people) {
        const wardNumber = parseWardNumber(person.name);
        if (!wardNumber) continue;
        relationships.push(...buildRoleRelationships(
          person.name,
          person.url,
          `Ward ${wardNumber} Council Seat`,
          `ward-${wardNumber}`,
        ));
      }
    }
  }
  return relationships;
}

function buildRoleRelationships(
  personName: string,
  personUrl: string,
  roleName: string,
  representedTarget?: string,
): RelationshipCandidateInput[] {
  const fromEntityRef = buildEntityId(personName);
  const roleEntityRef = buildEntityId(roleName);
  const relationships: RelationshipCandidateInput[] = [{
    relationshipCandidateId: buildRelationshipCandidateId(
      councilMembersSource.sourceId,
      `${slugify(personUrl)}>${slugify(roleName)}:holds`,
    ),
    sourceItemKey: "council-members-page",
    fromEntityRef,
    toEntityRef: roleEntityRef,
    relationshipType: "holds",
    rawValue: roleName,
    evidence: [fieldEvidence("role", roleName, 0)],
  }, {
    relationshipCandidateId: buildRelationshipCandidateId(
      councilMembersSource.sourceId,
      `${slugify(roleName)}>council:part_of`,
    ),
    sourceItemKey: "council-members-page",
    fromEntityRef: roleEntityRef,
    toEntityRef: buildEntityId("Council of the District of Columbia"),
    relationshipType: "part_of",
    rawValue: "Council of the District of Columbia",
    evidence: [fieldEvidence("role", roleName, 0)],
  }];
  if (representedTarget) {
    const targetEntityRef = representedTarget === "district"
      ? buildEntityId("District of Columbia")
      : buildEntityId(`Ward ${representedTarget.replace("ward-", "")}`);
    relationships.push({
      relationshipCandidateId: buildRelationshipCandidateId(
        councilMembersSource.sourceId,
        `${slugify(roleName)}>${slugify(representedTarget)}:represents`,
      ),
      sourceItemKey: "council-members-page",
      fromEntityRef: roleEntityRef,
      toEntityRef: targetEntityRef,
      relationshipType: "represents",
      rawValue: representedTarget,
      evidence: [fieldEvidence("represents", representedTarget, 0)],
    });
  }
  return relationships;
}

function buildRoleCandidate(
  name: string,
  ordinal: number,
  sectionTitle: string,
): EntityCandidateInput {
  return {
    candidateId: buildCandidateId(
      councilMembersSource.sourceId,
      `${slugify(sectionTitle)}-${ordinal + 1}-${slugify(name)}`,
    ),
    sourceItemKey: "council-members-page",
    proposedEntityId: buildEntityId(name),
    name,
    kind: "council_role",
    rawKind: "role",
    confidence: 0.99,
    evidence: [fieldEvidence("role", name, 0)],
  };
}

function parseCouncilMemberBlocks(html: string): CouncilMemberBlock[] {
  return [
    ...html.matchAll(/<h3[^>]*>\s*([^<]+?)\s*<\/h3>\s*([\s\S]*?)(?=<h3[^>]*>|<footer|<\/main>)/gsi),
  ]
    .map((match) => ({
      title: normalizeName(stripHtml(match[1])),
      people: [...match[2].matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gsi)]
        .map((personMatch) => ({
          name: normalizeName(stripHtml(personMatch[2])),
          url: personMatch[1],
        }))
        .filter((person) => person.name.length > 0),
    }))
    .filter((section) =>
      ["Chairman", "Chairperson Pro Tempore", "At-Large", "Ward Members"].includes(section.title)
    );
}

function parseWardNumber(name: string): number | undefined {
  const match = name.match(/Ward\s+([0-9]+)/i);
  return match ? Number(match[1]) : undefined;
}
