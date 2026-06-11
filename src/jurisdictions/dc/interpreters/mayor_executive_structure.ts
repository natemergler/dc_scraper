import { type ReaderResultRecord } from "../../../readers/types.ts";
import {
  cite,
  type EntryFragment,
  type Finding,
  type RelationFragment,
} from "../../../core/types.ts";
import { type DcInterpreterContext, normalizeAgencyLookupKey } from "./context.ts";

export interface MayorExecutiveStructureInterpreterResult {
  entryFragments: EntryFragment[];
  relationFragments: RelationFragment[];
  findings: Finding[];
}

export interface MayorExecutiveStructurePayload {
  key?: unknown;
  name?: unknown;
  sourceUrl?: unknown;
  entryKind?: unknown;
  parentKey?: unknown;
  relationKind?: unknown;
  pageTitle?: unknown;
  heading?: unknown;
}

const sourceKind = "mayor.executive_structure" as const;
const officeKind = "dc.office" as const;
const partOfRelationKind = "dc.relation:part_of" as const;
const reportsToRelationKind = "dc.relation:reports_to" as const;

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function makeOfficeProvisionalId(key: string): string {
  return `dc.office:${key}`;
}

function makeAgencyProvisionalId(agencyId: string): string {
  return `dc.agency:${agencyId}`;
}

function relationKindForSourceValue(value: string | null) {
  if (value === "part_of") {
    return partOfRelationKind;
  }
  if (value === "reports_to") {
    return reportsToRelationKind;
  }
  return null;
}

export function interpretMayorExecutiveStructure(
  records: ReaderResultRecord[],
  context?: DcInterpreterContext,
): MayorExecutiveStructureInterpreterResult {
  const entryFragments: EntryFragment[] = [];
  const relationFragments: RelationFragment[] = [];
  const findings: Finding[] = [];
  const officeIdsByKey = new Map<string, string>();
  const parsedRecords: Array<{
    record: ReaderResultRecord;
    key: string;
    name: string;
    sourceUrl: string;
    entryKind: "office" | "agency_ref";
    parentKey?: string;
    relationKind?: "dc.relation:part_of" | "dc.relation:reports_to";
    pageTitle?: string;
    heading?: string;
  }> = [];

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
        message: `mayor.executive_structure payload for ${record.key} is not an object`,
      });
      continue;
    }

    const sourceRecord = payload as MayorExecutiveStructurePayload;
    const key = asString(sourceRecord.key);
    const name = asString(sourceRecord.name);
    const sourceUrl = asString(sourceRecord.sourceUrl);
    const sourceEntryKind = asString(sourceRecord.entryKind);
    const relationKind = relationKindForSourceValue(asString(sourceRecord.relationKind));

    if (
      !key || !name || !sourceUrl ||
      (sourceEntryKind !== "office" && sourceEntryKind !== "agency_ref")
    ) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.mayor_executive_structure_missing_fields",
        message: `mayor.executive_structure record ${record.key} is missing required fields`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const entryKind: "office" | "agency_ref" = sourceEntryKind;
    const parsed = {
      record,
      key,
      name,
      sourceUrl,
      entryKind,
      parentKey: asString(sourceRecord.parentKey) ?? undefined,
      relationKind: relationKind ?? undefined,
      pageTitle: asString(sourceRecord.pageTitle) ?? undefined,
      heading: asString(sourceRecord.heading) ?? undefined,
    };
    parsedRecords.push(parsed);

    if (entryKind === "office") {
      officeIdsByKey.set(key, makeOfficeProvisionalId(key));
    }
  }

  for (const parsed of parsedRecords) {
    if (parsed.entryKind !== "office") {
      continue;
    }

    const attributes: Record<string, unknown> = {
      shortName: parsed.name,
      sourceOfficeKey: parsed.key,
      sourceMayorExecutiveStructureKey: parsed.key,
      sourcePageUrl: parsed.sourceUrl,
    };
    if (parsed.pageTitle) {
      attributes.sourcePageTitle = parsed.pageTitle;
    }
    if (parsed.heading) {
      attributes.sourceHeading = parsed.heading;
    }

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: parsed.record.key,
      provisionalId: makeOfficeProvisionalId(parsed.key),
      family: "organization",
      kind: officeKind,
      name: parsed.name,
      attributes,
      citations: [cite(sourceKind, parsed.record.key, { url: parsed.sourceUrl })],
    });
  }

  for (const parsed of parsedRecords) {
    if (!parsed.parentKey) {
      continue;
    }

    const parentId = officeIdsByKey.get(parsed.parentKey);
    if (!parentId) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.mayor_executive_parent_missing",
        message:
          `Mayor executive structure record ${parsed.record.key} references missing parent "${parsed.parentKey}"`,
        citation: cite(sourceKind, parsed.record.key, { url: parsed.sourceUrl }),
      });
      continue;
    }

    if (!parsed.relationKind) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.mayor_executive_relation_missing",
        message: `Mayor executive structure record ${parsed.record.key} has no relation kind`,
        citation: cite(sourceKind, parsed.record.key, { url: parsed.sourceUrl }),
      });
      continue;
    }

    if (parsed.entryKind === "office") {
      relationFragments.push({
        fragmentType: "relation",
        source: sourceKind,
        sourceRecordId: parsed.record.key,
        from: makeOfficeProvisionalId(parsed.key),
        relationKind: parsed.relationKind,
        to: parentId,
        citations: [cite(sourceKind, parsed.record.key, { url: parsed.sourceUrl })],
      });
      continue;
    }

    const agencyId = context?.agencyLookup?.get(normalizeAgencyLookupKey(parsed.name));
    if (!agencyId) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.mayor_executive_agency_unresolved",
        message:
          `Mayor executive structure record ${parsed.record.key} references unresolved agency "${parsed.name}"`,
        citation: cite(sourceKind, parsed.record.key, { url: parsed.sourceUrl }),
      });
      continue;
    }

    relationFragments.push({
      fragmentType: "relation",
      source: sourceKind,
      sourceRecordId: parsed.record.key,
      from: makeAgencyProvisionalId(agencyId),
      relationKind: parsed.relationKind,
      to: parentId,
      citations: [cite(sourceKind, parsed.record.key, { url: parsed.sourceUrl })],
    });
  }

  return { entryFragments, relationFragments, findings };
}
