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
}

const sourceKind = "oanc.profiles" as const;
const dcAncKind = "dc.anc" as const;

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

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: record.key,
      provisionalId: makeAncProvisionalId(ancId),
      family: "organization",
      kind: dcAncKind,
      name,
      attributes,
      citations: [cite(sourceKind, record.key, { url: profileUrl })],
    });
  }

  return { entryFragments, relationFragments, findings };
}
