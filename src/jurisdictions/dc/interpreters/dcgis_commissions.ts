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

export interface DcgisCommissionsInterpreterResult {
  entryFragments: EntryFragment[];
  relationFragments: RelationFragment[];
  findings: Finding[];
}

export interface DcGisCommissionsPayload {
  ENTITY_ID?: unknown;
  COMMISSION_ID?: unknown;
  COMMISSIONID?: unknown;
  OBJECTID?: unknown;
  COMMISSION_NAME?: unknown;
  NAME?: unknown;
  SHORT_NAME?: unknown;
  SHORTNAME?: unknown;
  AGENCY_ID?: unknown;
  GOVERNING_AGENCY?: unknown;
}

const dcCommissionKind = "dc.commission" as const;
const relationKind = "dc.relation:governs" as const;
const sourceKind = "dcgis.commissions" as const;

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseCommissionId(payload: Record<string, unknown>): string | null {
  const candidates = [
    payload.ENTITY_ID,
    payload.COMMISSION_ID,
    payload.COMMISSIONID,
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

function parseCommissionName(payload: Record<string, unknown>): string | null {
  return asString(payload.COMMISSION_NAME) ?? asString(payload.NAME);
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

  // Governing agency may sometimes be a human-readable label in the live source.
  // Only emit relations when it appears to be a machine-style id.
  return /^[A-Za-z0-9._:-]+$/.test(governingAgency) ? governingAgency : null;
}

function makeCommissionProvisionalId(commissionId: string): string {
  return `dc.commission:${commissionId}`;
}

function makeAgencyProvisionalId(agencyId: string): string {
  return dcAgencyReferenceId(agencyId);
}

export function interpretDcgisCommissions(
  records: ReaderResultRecord[],
  context?: DcInterpreterContext,
): DcgisCommissionsInterpreterResult {
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
        message: `dcgis.commissions payload for ${record.key} is not an object`,
      });
      continue;
    }

    const sourceRecord = payload as Record<string, unknown>;
    const commissionId = parseCommissionId(sourceRecord);
    if (!commissionId) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.commission_id_missing",
        message: `dcgis.commissions record ${record.key} has no commission id`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const commissionName = parseCommissionName(sourceRecord);
    if (!commissionName) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.commission_name_missing",
        message: `dcgis.commissions record ${record.key} has no name`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const provisionalId = makeCommissionProvisionalId(commissionId);
    const shortName = parseShortName(sourceRecord, commissionName);
    const citations = collectRecordCitations(sourceKind, record.key, sourceRecord);

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: record.key,
      provisionalId,
      family: "organization",
      kind: dcCommissionKind,
      name: commissionName,
      attributes: {
        shortName,
        sourceCommissionId: commissionId,
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
