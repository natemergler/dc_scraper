import { type ReaderResultRecord } from "../../../readers/types.ts";
import {
  cite,
  type EntryFragment,
  type Finding,
  type RelationFragment,
} from "../../../core/types.ts";
import { collectRecordCitations } from "./citations.ts";
import {
  dcAgencyReferenceId,
  type DcInterpreterContext,
  normalizeAgencyLookupKey,
} from "./context.ts";

export interface DcgisCouncilsInterpreterResult {
  entryFragments: EntryFragment[];
  relationFragments: RelationFragment[];
  findings: Finding[];
}

export interface DcGisCouncilPayload {
  COUNCIL_ID?: unknown;
  COUNCILID?: unknown;
  ENTITY_ID?: unknown;
  OBJECTID?: unknown;
  COUNCIL_NAME?: unknown;
  NAME?: unknown;
  SHORT_NAME?: unknown;
  SHORTNAME?: unknown;
  AGENCY_ID?: unknown;
  GOVERNING_AGENCY?: unknown;
}

const dcCouncilKind = "dc.council" as const;
const relationKind = "dc.relation:governs" as const;
const sourceKind = "dcgis.councils" as const;

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseCouncilId(payload: Record<string, unknown>): string | null {
  const candidates = [
    payload.COUNCIL_ID,
    payload.COUNCILID,
    payload.ENTITY_ID,
    payload.OBJECTID,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const value = candidate.trim();
      if (value.length > 0) {
        return value;
      }
    }
    if (typeof candidate === "number") {
      return String(candidate);
    }
  }
  return null;
}

function parseCouncilName(payload: Record<string, unknown>): string | null {
  return asString(payload.COUNCIL_NAME) ?? asString(payload.NAME);
}

function parseShortName(payload: Record<string, unknown>, fallback: string): string {
  return asString(payload.SHORT_NAME) ?? asString(payload.SHORTNAME) ?? fallback;
}

function parseAgencyId(
  payload: Record<string, unknown>,
  context?: DcInterpreterContext,
): string | null {
  const value = asString(payload.AGENCY_ID);
  if (value) {
    return context?.agencyIdLookup?.get(value) ?? value;
  }

  const governingAgency = asString(payload.GOVERNING_AGENCY);
  if (!governingAgency) {
    return null;
  }

  const normalized = normalizeAgencyLookupKey(governingAgency);
  const resolvedByName = context?.agencyLookup?.get(normalized);
  if (resolvedByName) {
    return resolvedByName;
  }

  return /^[A-Za-z0-9._:-]+$/.test(governingAgency) ? governingAgency : null;
}

function makeCouncilProvisionalId(councilId: string): string {
  return `dc.council:${councilId}`;
}

function makeAgencyProvisionalId(agencyId: string): string {
  return dcAgencyReferenceId(agencyId);
}

export function interpretDcgisCouncils(
  records: ReaderResultRecord[],
  context?: DcInterpreterContext,
): DcgisCouncilsInterpreterResult {
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
        message: `dcgis.councils payload for ${record.key} is not an object`,
      });
      continue;
    }

    const sourceRecord = payload as Record<string, unknown>;
    const councilId = parseCouncilId(sourceRecord);
    if (!councilId) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.council_id_missing",
        message: `dcgis.councils record ${record.key} has no council id`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const councilName = parseCouncilName(sourceRecord);
    if (!councilName) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.council_name_missing",
        message: `dcgis.councils record ${record.key} has no name`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const provisionalId = makeCouncilProvisionalId(councilId);
    const shortName = parseShortName(sourceRecord, councilName);
    const citations = collectRecordCitations(sourceKind, record.key, sourceRecord);

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: record.key,
      provisionalId,
      family: "organization",
      kind: dcCouncilKind,
      name: councilName,
      attributes: {
        shortName,
        sourceCouncilId: councilId,
      },
      citations,
    });

    const parentAgencyId = parseAgencyId(sourceRecord, context);
    if (parentAgencyId) {
      relationFragments.push({
        fragmentType: "relation",
        source: sourceKind,
        sourceRecordId: record.key,
        from: provisionalId,
        relationKind,
        to: makeAgencyProvisionalId(parentAgencyId),
        citations,
      });
    }
  }

  return { entryFragments, relationFragments, findings };
}
