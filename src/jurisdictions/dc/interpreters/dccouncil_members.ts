import { type ReaderResultRecord } from "../../../readers/types.ts";
import {
  cite,
  type EntryFragment,
  type Finding,
  type RelationFragment,
} from "../../../core/types.ts";
import { fileSafeLedgerId } from "./context.ts";
import { dcCouncilmemberKind } from "../kinds/councilmember.ts";
import { makeWardId, parseCouncilmemberTitle } from "./dccouncil_member_titles.ts";
import { type DcInterpreterContext } from "./context.ts";

const sourceKind = "dccouncil.members" as const;
const dcElectedOfficeKind = "dc.elected_office" as const;
const dcWardKind = "dc.ward" as const;
const holdsRelationKind = "dc.relation:holds" as const;
const representsRelationKind = "dc.relation:represents" as const;

export function interpretDccouncilMembers(
  records: ReaderResultRecord[],
  context?: DcInterpreterContext,
): { entryFragments: EntryFragment[]; relationFragments: RelationFragment[]; findings: Finding[] } {
  const entryFragments: EntryFragment[] = [];
  const relationFragments: RelationFragment[] = [];
  const findings: Finding[] = [];

  for (const record of records) {
    const payload = record.payload;
    if (!payload || typeof payload !== "object") {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.invalid_payload",
        message: `dccouncil.members payload for ${record.key} is not an object`,
      });
      continue;
    }

    const memberName = asString((payload as { memberName?: unknown }).memberName);
    const profileSlug = asString((payload as { profileSlug?: unknown }).profileSlug);
    const profileUrl = asString((payload as { profileUrl?: unknown }).profileUrl);
    if (!memberName || !profileSlug || !profileUrl) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.councilmember_missing_fields",
        message: `dccouncil.members record ${record.key} is missing required member fields`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const provisionalId = `dc.councilmember:${fileSafeLedgerId(profileSlug)}`;
    const parsed = parseCouncilmemberTitle(memberName);
    const citations = [cite(sourceKind, record.key)];
    const attributes: Record<string, unknown> = {
      sourceProfileSlug: profileSlug,
      sourceProfileUrl: profileUrl,
    };
    if (parsed.roleLabel) {
      attributes.officeLabel = parsed.roleLabel;
    }
    if (parsed.wardNumber) {
      attributes.wardNumber = parsed.wardNumber;
    }
    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: record.key,
      provisionalId,
      family: dcCouncilmemberKind.family,
      kind: dcCouncilmemberKind.kind,
      name: parsed.displayName,
      attributes,
      citations,
    });

    if (parsed.officeId && parsed.officeName && parsed.officeType && parsed.roleLabel) {
      entryFragments.push({
        fragmentType: "entry",
        source: sourceKind,
        sourceRecordId: record.key,
        provisionalId: parsed.officeId,
        family: "position",
        kind: dcElectedOfficeKind,
        name: parsed.officeName,
        attributes: {
          officeType: parsed.officeType,
          sourceLabel: parsed.roleLabel,
          ...(parsed.wardNumber ? { wardNumber: parsed.wardNumber } : {}),
        },
        citations,
      });
      relationFragments.push({
        fragmentType: "relation",
        source: sourceKind,
        sourceRecordId: record.key,
        from: provisionalId,
        relationKind: holdsRelationKind,
        to: parsed.officeId,
        citations,
      });
    }

    if (parsed.wardNumber) {
      const wardId = makeWardId(parsed.wardNumber);
      entryFragments.push({
        fragmentType: "entry",
        source: sourceKind,
        sourceRecordId: record.key,
        provisionalId: wardId,
        family: "area",
        kind: dcWardKind,
        name: `Ward ${parsed.wardNumber}`,
        attributes: {
          wardNumber: parsed.wardNumber,
        },
        citations,
      });
      relationFragments.push({
        fragmentType: "relation",
        source: sourceKind,
        sourceRecordId: record.key,
        from: provisionalId,
        relationKind: representsRelationKind,
        to: wardId,
        citations,
      });
      if (parsed.officeId) {
        relationFragments.push({
          fragmentType: "relation",
          source: sourceKind,
          sourceRecordId: record.key,
          from: parsed.officeId,
          relationKind: representsRelationKind,
          to: wardId,
          citations,
        });
      }
    }

    if (!context?.councilmemberLookup) {
      context ??= {};
      context.councilmemberLookup = new Map();
    }
    context.councilmemberLookup.set(profileSlug, {
      provisionalId,
      sourceRecordId: record.key,
    });
  }

  return { entryFragments, relationFragments, findings };
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
