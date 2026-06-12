import { type ReaderResultRecord } from "../../../readers/types.ts";
import {
  cite,
  type EntryFragment,
  type Finding,
  type RelationFragment,
} from "../../../core/types.ts";
import { collectRecordCitations } from "./citations.ts";
import { dcAgencyCanonicalId } from "./context.ts";

export interface DcgisAgenciesInterpreterResult {
  entryFragments: EntryFragment[];
  relationFragments: RelationFragment[];
  findings: Finding[];
}

export interface DcGisAgencyPayload {
  AGENCY_ID?: unknown;
  AGENCYID?: unknown;
  OBJECTID?: unknown;
  AGENCY_NAME?: unknown;
  NAME?: unknown;
  PARENT_AGENCY?: unknown;
  PARENT_AGENCY_ID?: unknown;
  parent_agency_id?: unknown;
  SHORT_NAME?: unknown;
  SHORTNAME?: unknown;
}

const dcAgencyKind = "dc.agency" as const;
const relationKind = "dc.relation:reports_to" as const;
const sourceKind = "dcgis.agencies" as const;

type ParsedAgency = {
  record: ReaderResultRecord;
  sourceRecord: Record<string, unknown>;
  agencyId: string;
  agencyName: string;
  parentAgencyId: string | null;
  provisionalId: string;
};

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseAgencyId(payload: Record<string, unknown>): string | null {
  const candidates = [
    payload.AGENCY_ID,
    payload.AGENCYID,
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

function parseAgencyName(payload: Record<string, unknown>): string | null {
  const candidate = asString(payload.AGENCY_NAME) ??
    asString(payload.NAME);
  return candidate;
}

function parseShortName(payload: Record<string, unknown>, fallback: string): string {
  return asString(payload.SHORT_NAME) ?? asString(payload.SHORTNAME) ?? fallback;
}

function parseParentAgencyId(payload: Record<string, unknown>): string | null {
  const candidate = payload.PARENT_AGENCY ?? payload.PARENT_AGENCY_ID ?? payload.parent_agency_id;
  if (typeof candidate === "string") {
    const value = candidate.trim();
    return value.length > 0 ? value : null;
  }
  if (typeof candidate === "number") {
    return String(candidate);
  }
  return null;
}

export function interpretDcgisAgencies(
  records: ReaderResultRecord[],
): DcgisAgenciesInterpreterResult {
  const entryFragments: EntryFragment[] = [];
  const relationFragments: RelationFragment[] = [];
  const findings: Finding[] = [];
  const parsedAgencies: ParsedAgency[] = [];

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
        message: `dcgis.agencies payload for ${record.key} is not an object`,
      });
      continue;
    }

    const sourceRecord = payload as Record<string, unknown>;
    const agencyId = parseAgencyId(sourceRecord);
    if (!agencyId) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.agency_id_missing",
        message: `dcgis.agencies record ${record.key} has no agency id`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const agencyName = parseAgencyName(sourceRecord);
    if (!agencyName) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.agency_name_missing",
        message: `dcgis.agencies record ${record.key} has no name`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const provisionalId = dcAgencyCanonicalId(agencyName);
    parsedAgencies.push({
      record,
      sourceRecord,
      agencyId,
      agencyName,
      parentAgencyId: parseParentAgencyId(sourceRecord),
      provisionalId,
    });
  }

  const idBySourceAgencyId = new Map<string, string>();
  const sourceIdsByCanonicalId = new Map<string, Set<string>>();
  for (const agency of parsedAgencies) {
    idBySourceAgencyId.set(agency.agencyId, agency.provisionalId);
    const existing = sourceIdsByCanonicalId.get(agency.provisionalId) ?? new Set<string>();
    existing.add(agency.agencyId);
    sourceIdsByCanonicalId.set(agency.provisionalId, existing);
  }

  for (const [canonicalId, sourceIds] of sourceIdsByCanonicalId) {
    if (sourceIds.size <= 1) {
      continue;
    }
    findings.push({
      kind: "conflict",
      code: "dc.identity.canonical_id_collision",
      message: `dcgis.agencies canonical ID ${canonicalId} is shared by source agency IDs ${
        [...sourceIds].sort().join(", ")
      }`,
      citation: cite(sourceKind, [...sourceIds].sort()[0]),
    });
  }

  for (const agency of parsedAgencies) {
    const { record, sourceRecord, agencyId, agencyName, parentAgencyId, provisionalId } = agency;
    const shortName = parseShortName(sourceRecord, agencyName);
    const citations = collectRecordCitations(sourceKind, record.key, sourceRecord);

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: record.key,
      provisionalId,
      family: "organization",
      kind: dcAgencyKind,
      name: agencyName,
      attributes: {
        shortName,
        sourceAgencyId: agencyId,
      },
      citations,
    });

    if (parentAgencyId && parentAgencyId !== agencyId) {
      const parentProvisionalId = idBySourceAgencyId.get(parentAgencyId);
      if (!parentProvisionalId) {
        findings.push({
          kind: "warn",
          code: "dc.interpreter.parent_agency_missing",
          message:
            `dcgis.agencies record ${record.key} references missing parent agency ${parentAgencyId}`,
          citation: cite(sourceKind, record.key),
        });
        continue;
      }
      relationFragments.push({
        fragmentType: "relation",
        source: sourceKind,
        sourceRecordId: record.key,
        from: provisionalId,
        relationKind,
        to: parentProvisionalId,
        citations,
      });
    }
  }

  return { entryFragments, relationFragments, findings };
}
