import { type ReaderResultRecord } from "../../../readers/types.ts";
import {
  cite,
  type EntryFragment,
  type Finding,
  type RelationFragment,
} from "../../../core/types.ts";
import { fileSafeLedgerId } from "./context.ts";

export interface OancProfilesInterpreterResult {
  entryFragments: EntryFragment[];
  relationFragments: RelationFragment[];
  findings: Finding[];
}

export interface OancProfilePayload {
  ancId?: unknown;
  name?: unknown;
  profileUrl?: unknown;
  representedNeighborhoods?: unknown;
  wardNumbers?: unknown;
}

const sourceKind = "oanc.profiles" as const;
const dcAncKind = "dc.anc" as const;
const dcWardKind = "dc.ward" as const;
const containsRelationKind = "dc.relation:contains" as const;

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function makeAncProvisionalId(ancId: string): string {
  return `dc.anc:${fileSafeLedgerId(ancId)}`;
}

function makeWardProvisionalId(wardNumber: string): string {
  return `dc.ward:${fileSafeLedgerId(wardNumber)}`;
}

function parseWardNumbers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asString(item))
    .filter((item): item is string => item !== null)
    .filter((item, index, values) => values.indexOf(item) === index)
    .sort();
}

export function interpretOancProfiles(
  records: ReaderResultRecord[],
): OancProfilesInterpreterResult {
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
        message: `oanc.profiles payload for ${record.key} is not an object`,
      });
      continue;
    }

    const sourceRecord = payload as OancProfilePayload;
    const ancId = asString(sourceRecord.ancId);
    const name = asString(sourceRecord.name);
    const profileUrl = asString(sourceRecord.profileUrl);
    if (!ancId || !name || !profileUrl) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.oanc_profile_missing_fields",
        message: `oanc.profiles record ${record.key} is missing required fields`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const attributes: Record<string, unknown> = {
      sourceAncId: ancId,
      sourceOancProfileUrl: profileUrl,
    };
    const representedNeighborhoods = asString(sourceRecord.representedNeighborhoods);
    if (representedNeighborhoods) {
      attributes.representedNeighborhoods = representedNeighborhoods;
    }
    const wardNumbers = parseWardNumbers(sourceRecord.wardNumbers);
    if (wardNumbers.length > 0) {
      attributes.sourceWardNumbers = wardNumbers;
    }
    const ancCitations = [cite(sourceKind, record.key, { url: profileUrl })];
    const wardCitations = [cite(sourceKind, record.key)];

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: record.key,
      provisionalId: makeAncProvisionalId(ancId),
      family: "organization",
      kind: dcAncKind,
      name,
      attributes,
      citations: ancCitations,
    });

    for (const wardNumber of wardNumbers) {
      const wardId = makeWardProvisionalId(wardNumber);
      entryFragments.push({
        fragmentType: "entry",
        source: sourceKind,
        sourceRecordId: record.key,
        provisionalId: wardId,
        family: "area",
        kind: dcWardKind,
        name: `Ward ${wardNumber}`,
        attributes: {
          wardNumber,
        },
        citations: wardCitations,
      });
      relationFragments.push({
        fragmentType: "relation",
        source: sourceKind,
        sourceRecordId: record.key,
        from: wardId,
        relationKind: containsRelationKind,
        to: makeAncProvisionalId(ancId),
        citations: wardCitations,
      });
    }
  }

  return { entryFragments, relationFragments, findings };
}
