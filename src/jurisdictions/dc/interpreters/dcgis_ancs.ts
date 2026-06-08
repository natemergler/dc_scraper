import { type ReaderResultRecord } from "../../../readers/types.ts";
import {
  cite,
  type EntryFragment,
  type Finding,
  type RelationFragment,
} from "../../../core/types.ts";
import { collectRecordCitations } from "./citations.ts";
import { fileSafeLedgerId } from "./context.ts";

export interface DcgisAncsInterpreterResult {
  entryFragments: EntryFragment[];
  relationFragments: RelationFragment[];
  findings: Finding[];
}

export interface DcGisAncPayload {
  ANC_ID?: unknown;
  NAME?: unknown;
  WEB_URL?: unknown;
  GIS_ID?: unknown;
}

const dcAncKind = "dc.anc" as const;
const sourceKind = "dcgis.ancs" as const;

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseAncId(payload: Record<string, unknown>): string | null {
  return asString(payload.ANC_ID);
}

function parseAncName(payload: Record<string, unknown>): string | null {
  return asString(payload.NAME);
}

function makeAncProvisionalId(ancId: string): string {
  return `dc.anc:${fileSafeLedgerId(ancId)}`;
}

export function interpretDcgisAncs(
  records: ReaderResultRecord[],
): DcgisAncsInterpreterResult {
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
        message: `dcgis.ancs payload for ${record.key} is not an object`,
      });
      continue;
    }

    const sourceRecord = payload as Record<string, unknown>;
    const ancId = parseAncId(sourceRecord);
    if (!ancId) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.anc_id_missing",
        message: `dcgis.ancs record ${record.key} has no ANC id`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    let ancName = parseAncName(sourceRecord);
    if (!ancName) {
      ancName = `ANC ${ancId}`;
      findings.push({
        kind: "warn",
        code: "dc.interpreter.anc_name_missing",
        message: `dcgis.ancs record ${record.key} has no name; using fallback ${ancName}`,
        citation: cite(sourceKind, record.key),
      });
    }

    const citations = collectRecordCitations(sourceKind, record.key, sourceRecord);
    const attributes: Record<string, unknown> = {
      sourceAncId: ancId,
    };
    const webUrl = asString(sourceRecord.WEB_URL);
    if (webUrl) {
      attributes.webUrl = webUrl;
    }
    const gisId = asString(sourceRecord.GIS_ID);
    if (gisId) {
      attributes.gisId = gisId;
    }

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: record.key,
      provisionalId: makeAncProvisionalId(ancId),
      family: "organization",
      kind: dcAncKind,
      name: ancName,
      attributes,
      citations,
    });
  }

  return { entryFragments, relationFragments, findings };
}
