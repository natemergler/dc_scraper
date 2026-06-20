import { type ReaderResultRecord } from "../../../readers/types.ts";
import {
  cite,
  type EntryFragment,
  type Finding,
  type RelationFragment,
} from "../../../core/types.ts";
import { buildRecordLegalAuthorityArtifacts } from "./legal_authorities.ts";
import {
  dcAgencyReferenceId,
  type DcInterpreterContext,
  normalizeAgencyLookupKey,
} from "./context.ts";

export interface DcgisBoardsInterpreterResult {
  entryFragments: EntryFragment[];
  relationFragments: RelationFragment[];
  findings: Finding[];
}

export interface DcGisBoardPayload {
  BOARD_ID?: unknown;
  BOARDID?: unknown;
  ENTITY_ID?: unknown;
  OBJECTID?: unknown;
  BOARD_NAME?: unknown;
  NAME?: unknown;
  SHORT_NAME?: unknown;
  SHORTNAME?: unknown;
  AGENCY_ID?: unknown;
  GOVERNING_AGENCY?: unknown;
}

const dcBoardKind = "dc.board" as const;
const relationKind = "dc.relation:governs" as const;
const sourceKind = "dcgis.boards";

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseBoardId(payload: Record<string, unknown>): string | null {
  const candidates = [payload.BOARD_ID, payload.BOARDID, payload.ENTITY_ID, payload.OBJECTID];
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

function parseBoardName(payload: Record<string, unknown>): string | null {
  return asString(payload.BOARD_NAME) ?? asString(payload.NAME);
}

function parseShortName(payload: Record<string, unknown>, fallback: string): string {
  return asString(payload.SHORT_NAME) ?? asString(payload.SHORTNAME) ?? fallback;
}

function parseAgencyId(
  payload: Record<string, unknown>,
  context?: DcInterpreterContext,
): string | null {
  const explicitAgencyId = asString(payload.AGENCY_ID);
  if (explicitAgencyId) {
    return context?.agencyIdLookup?.get(explicitAgencyId) ?? explicitAgencyId;
  }

  const governingAgency = asString(payload.GOVERNING_AGENCY);
  if (!governingAgency) {
    return null;
  }

  const normalized = normalizeAgencyLookupKey(governingAgency);
  const resolvedAgencyId = context?.agencyLookup?.get(normalized);
  if (resolvedAgencyId) {
    return resolvedAgencyId;
  }

  return /^[A-Za-z0-9._:-]+$/.test(governingAgency) ? governingAgency : null;
}

function makeBoardProvisionalId(boardId: string): string {
  return `dc.board:${boardId}`;
}

function makeAgencyProvisionalId(agencyId: string): string {
  return dcAgencyReferenceId(agencyId);
}

export function interpretDcgisBoards(
  records: ReaderResultRecord[],
  context?: DcInterpreterContext,
): DcgisBoardsInterpreterResult {
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
        message: `dcgis.boards payload for ${record.key} is not an object`,
      });
      continue;
    }

    const sourceRecord = payload as Record<string, unknown>;
    const boardId = parseBoardId(sourceRecord);
    if (!boardId) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.board_id_missing",
        message: `dcgis.boards record ${record.key} has no board id`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const boardName = parseBoardName(sourceRecord);
    if (!boardName) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.board_name_missing",
        message: `dcgis.boards record ${record.key} has no name`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const provisionalId = makeBoardProvisionalId(boardId);
    const shortName = parseShortName(sourceRecord, boardName);
    const legalAuthorityArtifacts = buildRecordLegalAuthorityArtifacts({
      source: sourceKind,
      sourceRecordId: record.key,
      subjectProvisionalId: provisionalId,
      payload: sourceRecord,
    });
    const citations = legalAuthorityArtifacts.entryCitations;

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: record.key,
      provisionalId,
      family: "organization",
      kind: dcBoardKind,
      name: boardName,
      attributes: {
        shortName,
        sourceBoardId: boardId,
      },
      citations,
    });
    entryFragments.push(...legalAuthorityArtifacts.entryFragments);
    relationFragments.push(...legalAuthorityArtifacts.relationFragments);

    const parentAgencyId = parseAgencyId(sourceRecord, context);
    if (parentAgencyId) {
      relationFragments.push({
        fragmentType: "relation",
        source: sourceKind,
        sourceRecordId: record.key,
        from: provisionalId,
        relationKind,
        to: makeAgencyProvisionalId(parentAgencyId),
        citations: [cite(sourceKind, record.key)],
      });
    }
  }

  return { entryFragments, relationFragments, findings };
}
