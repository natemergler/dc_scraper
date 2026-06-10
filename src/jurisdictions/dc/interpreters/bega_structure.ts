import { type ReaderResultRecord } from "../../../readers/types.ts";
import {
  cite,
  type EntryFragment,
  type Finding,
  type RelationFragment,
} from "../../../core/types.ts";

export interface BegaStructureInterpreterResult {
  entryFragments: EntryFragment[];
  relationFragments: RelationFragment[];
  findings: Finding[];
}

export interface BegaStructurePayload {
  name?: unknown;
  key?: unknown;
  url?: unknown;
  entryKind?: unknown;
  parentName?: unknown;
  pageTitle?: unknown;
  heading?: unknown;
  summary?: unknown;
}

const sourceKind = "bega.structure" as const;
const partOfRelationKind = "dc.relation:part_of" as const;

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function entryKindForSourceKind(entryKind: string): "dc.agency" | "dc.office" | null {
  if (entryKind === "agency") {
    return "dc.agency";
  }
  if (entryKind === "office") {
    return "dc.office";
  }
  return null;
}

function provisionalIdForEntry(kind: "dc.agency" | "dc.office", name: string): string {
  return `${kind}:${slugify(name)}`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function interpretBegaStructure(
  records: ReaderResultRecord[],
): BegaStructureInterpreterResult {
  const entryFragments: EntryFragment[] = [];
  const relationFragments: RelationFragment[] = [];
  const findings: Finding[] = [];
  const parsedRecords: Array<{
    record: ReaderResultRecord;
    name: string;
    key: string;
    url: string;
    entryKind: "dc.agency" | "dc.office";
    parentName?: string;
    pageTitle?: string;
    heading?: string;
    summary?: string;
    provisionalId: string;
  }> = [];
  const entryIdsByName = new Map<string, string>();

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
        message: `bega.structure payload for ${record.key} is not an object`,
      });
      continue;
    }

    const sourceRecord = payload as BegaStructurePayload;
    const name = asString(sourceRecord.name);
    const key = asString(sourceRecord.key);
    const url = asString(sourceRecord.url);
    const sourceEntryKind = asString(sourceRecord.entryKind);
    const entryKind = sourceEntryKind ? entryKindForSourceKind(sourceEntryKind) : null;

    if (!name || !key || !url || !entryKind) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.bega_missing_fields",
        message: `bega.structure record ${record.key} is missing required fields`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const provisionalId = provisionalIdForEntry(entryKind, name);
    const parsed = {
      record,
      name,
      key,
      url,
      entryKind,
      parentName: asString(sourceRecord.parentName) ?? undefined,
      pageTitle: asString(sourceRecord.pageTitle) ?? undefined,
      heading: asString(sourceRecord.heading) ?? undefined,
      summary: asString(sourceRecord.summary) ?? undefined,
      provisionalId,
    };
    parsedRecords.push(parsed);
    entryIdsByName.set(name, provisionalId);
  }

  for (const parsed of parsedRecords) {
    const attributes: Record<string, unknown> = {
      shortName: parsed.name,
      sourceBegaStructureKey: parsed.key,
      sourcePageUrl: parsed.url,
    };
    if (parsed.entryKind === "dc.office") {
      attributes.sourceOfficeKey = parsed.key;
    }
    if (parsed.pageTitle) {
      attributes.sourcePageTitle = parsed.pageTitle;
    }
    if (parsed.heading) {
      attributes.sourceHeading = parsed.heading;
    }
    if (parsed.summary) {
      attributes.sourceSummary = parsed.summary;
    }

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: parsed.record.key,
      provisionalId: parsed.provisionalId,
      family: "organization",
      kind: parsed.entryKind,
      name: parsed.name,
      attributes,
      citations: [cite(sourceKind, parsed.record.key, { url: parsed.url })],
    });
  }

  for (const parsed of parsedRecords) {
    if (!parsed.parentName) {
      continue;
    }

    const parentId = entryIdsByName.get(parsed.parentName);
    if (!parentId) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.bega_parent_missing",
        message:
          `BEGA structure record ${parsed.record.key} references missing parent "${parsed.parentName}"`,
        citation: cite(sourceKind, parsed.record.key),
      });
      continue;
    }

    relationFragments.push({
      fragmentType: "relation",
      source: sourceKind,
      sourceRecordId: parsed.record.key,
      from: parsed.provisionalId,
      relationKind: partOfRelationKind,
      to: parentId,
      citations: [cite(sourceKind, parsed.record.key, { url: parsed.url })],
    });
  }

  return { entryFragments, relationFragments, findings };
}
