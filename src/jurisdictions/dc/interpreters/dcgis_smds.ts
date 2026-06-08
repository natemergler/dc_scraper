import { type ReaderResultRecord } from "../../../readers/types.ts";
import {
  cite,
  type EntryFragment,
  type Finding,
  type RelationFragment,
} from "../../../core/types.ts";
import { collectRecordCitations } from "./citations.ts";
import { fileSafeLedgerId } from "./context.ts";
import { dcAncCommissionerSeatKind } from "../kinds/anc_commissioner_seat.ts";

export interface DcgisSmdsInterpreterResult {
  entryFragments: EntryFragment[];
  relationFragments: RelationFragment[];
  findings: Finding[];
}

export interface DcGisSmdPayload {
  SMD_ID?: unknown;
  ANC_ID?: unknown;
  NAME?: unknown;
  WEB_URL?: unknown;
  EMAIL?: unknown;
}

const dcSmdKind = "dc.smd" as const;
const containsRelationKind = "dc.relation:contains" as const;
const representsRelationKind = "dc.relation:represents" as const;
const sourceKind = "dcgis.smds" as const;

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseSmdId(payload: Record<string, unknown>): string | null {
  return asString(payload.SMD_ID);
}

function parseAncId(payload: Record<string, unknown>): string | null {
  return asString(payload.ANC_ID);
}

function parseSmdName(payload: Record<string, unknown>): string | null {
  return asString(payload.NAME);
}

function makeSmdProvisionalId(smdId: string): string {
  return `dc.smd:${fileSafeLedgerId(smdId)}`;
}

function makeAncProvisionalId(ancId: string): string {
  return `dc.anc:${fileSafeLedgerId(ancId)}`;
}

function makeSeatProvisionalId(smdId: string): string {
  return `dc.anc_commissioner_seat:${fileSafeLedgerId(smdId)}`;
}

export function interpretDcgisSmds(
  records: ReaderResultRecord[],
): DcgisSmdsInterpreterResult {
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
        message: `dcgis.smds payload for ${record.key} is not an object`,
      });
      continue;
    }

    const sourceRecord = payload as Record<string, unknown>;
    const smdId = parseSmdId(sourceRecord);
    if (!smdId) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.smd_id_missing",
        message: `dcgis.smds record ${record.key} has no SMD id`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    let smdName = parseSmdName(sourceRecord);
    if (!smdName) {
      smdName = `SMD ${smdId}`;
      findings.push({
        kind: "warn",
        code: "dc.interpreter.smd_name_missing",
        message: `dcgis.smds record ${record.key} has no name; using fallback ${smdName}`,
        citation: cite(sourceKind, record.key),
      });
    }

    const citations = collectRecordCitations(sourceKind, record.key, sourceRecord);
    const ancId = parseAncId(sourceRecord);
    const officeEmail = asString(sourceRecord.EMAIL);

    const attributes: Record<string, unknown> = {
      sourceSmdId: smdId,
    };
    if (ancId) {
      attributes.sourceAncId = ancId;
    }
    const webUrl = asString(sourceRecord.WEB_URL);
    if (webUrl) {
      attributes.webUrl = webUrl;
    }
    const provisionalId = makeSmdProvisionalId(smdId);
    const seatProvisionalId = makeSeatProvisionalId(smdId);
    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: record.key,
      provisionalId,
      family: "area",
      kind: dcSmdKind,
      name: smdName,
      attributes,
      citations,
    });

    const seatAttributes: Record<string, unknown> = {
      sourceSmdId: smdId,
    };
    if (ancId) {
      seatAttributes.sourceAncId = ancId;
    }
    if (officeEmail) {
      seatAttributes.officeEmail = officeEmail;
    }

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: record.key,
      provisionalId: seatProvisionalId,
      family: dcAncCommissionerSeatKind.family,
      kind: dcAncCommissionerSeatKind.kind,
      name: `Commissioner Seat for ${smdName}`,
      attributes: seatAttributes,
      citations,
    });

    if (ancId) {
      relationFragments.push({
        fragmentType: "relation",
        source: sourceKind,
        sourceRecordId: record.key,
        from: makeAncProvisionalId(ancId),
        relationKind: containsRelationKind,
        to: provisionalId,
        citations,
      });
    } else {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.smd_anc_id_missing",
        message: `dcgis.smds record ${record.key} has no ANC id`,
        citation: cite(sourceKind, record.key),
      });
    }

    relationFragments.push({
      fragmentType: "relation",
      source: sourceKind,
      sourceRecordId: record.key,
      from: seatProvisionalId,
      relationKind: representsRelationKind,
      to: provisionalId,
      citations,
    });
  }

  return { entryFragments, relationFragments, findings };
}
