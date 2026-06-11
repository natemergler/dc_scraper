import { type ReaderResultRecord } from "../../../readers/types.ts";
import { cite, type EntryFragment, type Finding } from "../../../core/types.ts";

export interface LegalEntrypointsInterpreterResult {
  entryFragments: EntryFragment[];
  relationFragments: [];
  findings: Finding[];
}

export interface LegalEntrypointPayload {
  name?: unknown;
  key?: unknown;
  url?: unknown;
  fromSeed?: unknown;
  indexUrl?: unknown;
}

const sourceKind = "legal.entrypoints" as const;
const legalSourceKind = "dc.legal_source" as const;

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function provisionalIdForEntry(key: string): string {
  return `${legalSourceKind}:${key}`;
}

export function interpretLegalEntrypoints(
  records: ReaderResultRecord[],
): LegalEntrypointsInterpreterResult {
  const entryFragments: EntryFragment[] = [];
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
        message: `legal.entrypoints payload for ${record.key} is not an object`,
      });
      continue;
    }

    const sourceRecord = payload as LegalEntrypointPayload;
    const name = asString(sourceRecord.name);
    const key = asString(sourceRecord.key);
    const url = asString(sourceRecord.url);
    const indexUrl = asString(sourceRecord.indexUrl);

    if (!name || !key || !url) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.legal_entrypoint_missing_fields",
        message: `legal.entrypoints record ${record.key} is missing required fields`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: record.key,
      provisionalId: provisionalIdForEntry(key),
      family: "authority",
      kind: legalSourceKind,
      name,
      attributes: {
        shortName: name,
        sourceLegalEntrypointKey: key,
        sourcePageUrl: url,
        sourceIndexUrl: indexUrl,
        sourceSeeded: sourceRecord.fromSeed === true,
      },
      citations: [cite(sourceKind, record.key, { url })],
    });
  }

  return { entryFragments, relationFragments: [], findings };
}
