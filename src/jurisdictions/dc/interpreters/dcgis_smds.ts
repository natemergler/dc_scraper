import { type ReaderResultRecord } from "../../../readers/types.ts";
import {
  cite,
  type EntryFragment,
  type Finding,
  type RelationFragment,
} from "../../../core/types.ts";
import { collectRecordCitations } from "./citations.ts";
import { fileSafeLedgerId } from "./context.ts";

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
const relationKind = "dc.relation:contains" as const;
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
    const attributes: Record<string, unknown> = {
      sourceSmdId: smdId,
    };
    const ancId = parseAncId(sourceRecord);
    if (ancId) {
      attributes.sourceAncId = ancId;
    }
    const webUrl = asString(sourceRecord.WEB_URL);
    if (webUrl) {
      attributes.webUrl = webUrl;
    }
    const email = asString(sourceRecord.EMAIL);
    if (email) {
      attributes.email = email;
    }

    const provisionalId = makeSmdProvisionalId(smdId);
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

    if (!ancId) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.smd_anc_id_missing",
        message: `dcgis.smds record ${record.key} has no ANC id`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    relationFragments.push({
      fragmentType: "relation",
      source: sourceKind,
      sourceRecordId: record.key,
      from: makeAncProvisionalId(ancId),
      relationKind,
      to: provisionalId,
      citations,
    });
  }

  return { entryFragments, relationFragments, findings };
}
