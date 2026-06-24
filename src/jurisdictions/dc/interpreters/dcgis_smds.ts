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
  REP_NAME?: unknown;
  FIRST_NAME?: unknown;
  LAST_NAME?: unknown;
  WEB_URL?: unknown;
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

function parseRepresentativeName(payload: Record<string, unknown>): string | null {
  return asString(payload.REP_NAME);
}

function parseFirstName(payload: Record<string, unknown>): string | null {
  return asString(payload.FIRST_NAME);
}

function parseLastName(payload: Record<string, unknown>): string | null {
  return asString(payload.LAST_NAME);
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

function isVacantRepresentativeName(name: string | null): boolean {
  return name !== null && name.trim().toUpperCase() === "VACANT";
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
    const representativeName = parseRepresentativeName(sourceRecord);
    const firstName = parseFirstName(sourceRecord);
    const lastName = parseLastName(sourceRecord);

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
    if (representativeName && !isVacantRepresentativeName(representativeName)) {
      seatAttributes.sourceRepresentativeName = representativeName;
      if (firstName) {
        seatAttributes.sourceFirstName = firstName;
      }
      if (lastName) {
        seatAttributes.sourceLastName = lastName;
      }
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

    if (representativeName && isVacantRepresentativeName(representativeName)) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.smd_representative_vacant",
        message:
          `dcgis.smds record ${record.key} is vacant; skipping current commissioner provenance`,
        citation: cite(sourceKind, record.key),
      });
    } else if (!representativeName) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.smd_representative_missing",
        message: `dcgis.smds record ${record.key} has no representative name fields`,
        citation: cite(sourceKind, record.key),
      });
    }

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
