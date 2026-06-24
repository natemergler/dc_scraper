import { type ReaderResultRecord } from "../../../readers/types.ts";
import {
  cite,
  type EntryFragment,
  type Finding,
  type RelationFragment,
} from "../../../core/types.ts";
import { fileSafeLedgerId } from "./context.ts";
import { dcCouncilCommitteeKind } from "../kinds/council_committee.ts";
import { dcCouncilmemberKind } from "../kinds/councilmember.ts";
import { parseCouncilmemberTitle } from "./dccouncil_member_titles.ts";
import { type DcInterpreterContext } from "./context.ts";

export interface DCCouncilCommitteesInterpreterResult {
  entryFragments: EntryFragment[];
  relationFragments: RelationFragment[];
  findings: Finding[];
}

export interface DCCouncilCommitteePayload {
  committeeName?: unknown;
  committeeSlug?: unknown;
  committeeType?: unknown;
  committeeUrl?: unknown;
  chairpersonName?: unknown;
  chairpersonUrl?: unknown;
  councilmembers?: unknown;
}

const sourceKind = "dccouncil.committees" as const;
const chairsRelationKind = "dc.relation:chairs" as const;
const memberOfRelationKind = "dc.relation:member_of" as const;

export function interpretDccouncilCommittees(
  records: ReaderResultRecord[],
  context?: DcInterpreterContext,
): DCCouncilCommitteesInterpreterResult {
  const entryFragments: EntryFragment[] = [];
  const relationFragments: RelationFragment[] = [];
  const findings: Finding[] = [];

  for (const record of records) {
    if (!record || typeof record !== "object") {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.invalid_record",
        message: "record missing source envelope",
      });
      continue;
    }

    const payload = record.payload;
    if (!payload || typeof payload !== "object") {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.invalid_payload",
        message: `dccouncil.committees payload for ${record.key} is not an object`,
      });
      continue;
    }

    const committeeName = asString((payload as DCCouncilCommitteePayload).committeeName);
    const committeeSlug = asString((payload as DCCouncilCommitteePayload).committeeSlug);
    const committeeType = asString((payload as DCCouncilCommitteePayload).committeeType);
    const committeeUrl = asString((payload as DCCouncilCommitteePayload).committeeUrl);
    const chairpersonName = asString((payload as DCCouncilCommitteePayload).chairpersonName);
    const chairpersonUrl = asString((payload as DCCouncilCommitteePayload).chairpersonUrl);
    const councilmembers = parseCouncilmembers(
      (payload as DCCouncilCommitteePayload).councilmembers,
    );

    if (!committeeName || !committeeSlug || !committeeType || !committeeUrl) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.council_committee_missing_fields",
        message: `dccouncil.committees record ${record.key} is missing required committee fields`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const committeeId = `dc.committee:${fileSafeLedgerId(committeeSlug)}`;
    const citations = [cite(sourceKind, record.key)];

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: record.key,
      provisionalId: committeeId,
      family: dcCouncilCommitteeKind.family,
      kind: dcCouncilCommitteeKind.kind,
      name: committeeName,
      attributes: {
        sourceCommitteeSlug: committeeSlug,
        sourceUrl: committeeUrl,
        committeeType,
      },
      citations,
    });

    if (!chairpersonName || !chairpersonUrl) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.council_committee_chair_missing",
        message: `dccouncil.committees record ${record.key} is missing a chairperson`,
        citation: cite(sourceKind, record.key),
      });
    } else {
      const chairpersonId = makeCouncilmemberId(chairpersonUrl);
      entryFragments.push(
        makeCouncilmemberEntry(chairpersonId, chairpersonName, chairpersonUrl, record.key),
      );
      relationFragments.push({
        fragmentType: "relation",
        source: sourceKind,
        sourceRecordId: record.key,
        from: chairpersonId,
        relationKind: chairsRelationKind,
        to: committeeId,
        citations,
      });
      relationFragments.push({
        fragmentType: "relation",
        source: sourceKind,
        sourceRecordId: record.key,
        from: chairpersonId,
        relationKind: memberOfRelationKind,
        to: committeeId,
        citations,
      });
    }

    for (const member of councilmembers) {
      const councilmemberId = makeCouncilmemberId(member.url);
      entryFragments.push(
        makeCouncilmemberEntry(councilmemberId, member.name, member.url, record.key),
      );
      relationFragments.push({
        fragmentType: "relation",
        source: sourceKind,
        sourceRecordId: record.key,
        from: councilmemberId,
        relationKind: memberOfRelationKind,
        to: committeeId,
        citations,
      });
    }

    if (committeeSlug === "committee-of-the-whole" && context?.councilmemberLookup) {
      const existingMemberIds = new Set<string>();
      if (chairpersonUrl) {
        existingMemberIds.add(makeCouncilmemberId(chairpersonUrl));
      }
      for (const member of councilmembers) {
        existingMemberIds.add(makeCouncilmemberId(member.url));
      }

      for (const [profileSlug, rosterMember] of context.councilmemberLookup.entries()) {
        if (existingMemberIds.has(rosterMember.provisionalId)) {
          continue;
        }
        relationFragments.push({
          fragmentType: "relation",
          source: sourceKind,
          sourceRecordId: record.key,
          from: rosterMember.provisionalId,
          relationKind: memberOfRelationKind,
          to: committeeId,
          citations: [
            cite(sourceKind, record.key),
            cite("dccouncil.members", rosterMember.sourceRecordId),
          ],
        });
      }
    }
  }

  return { entryFragments, relationFragments, findings };
}

function makeCouncilmemberEntry(
  provisionalId: string,
  name: string,
  profileUrl: string,
  sourceRecordId: string,
): EntryFragment {
  const parsed = parseCouncilmemberTitle(name);
  const attributes: Record<string, unknown> = {
    sourceProfileSlug: extractProfileSlug(profileUrl),
    sourceProfileUrl: profileUrl,
  };
  if (parsed.roleLabel) {
    attributes.officeLabel = parsed.roleLabel;
  }
  if (parsed.wardNumber) {
    attributes.wardNumber = parsed.wardNumber;
  }
  return {
    fragmentType: "entry",
    source: sourceKind,
    sourceRecordId,
    provisionalId,
    family: dcCouncilmemberKind.family,
    kind: dcCouncilmemberKind.kind,
    name: parsed.displayName,
    attributes,
    citations: [cite(sourceKind, sourceRecordId)],
  };
}

function makeCouncilmemberId(profileUrl: string): string {
  return `dc.councilmember:${fileSafeLedgerId(extractProfileSlug(profileUrl))}`;
}

function extractProfileSlug(profileUrl: string): string {
  const url = new URL(profileUrl);
  const slug = url.pathname.replace(/\/+$/, "").split("/").pop();
  return slug && slug.length > 0 ? slug : profileUrl;
}

function parseCouncilmembers(value: unknown): Array<{ name: string; url: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const members: Array<{ name: string; url: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const name = asString((item as { name?: unknown }).name);
    const url = asString((item as { url?: unknown }).url);
    if (!name || !url) {
      continue;
    }
    members.push({ name, url });
  }
  return members;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
