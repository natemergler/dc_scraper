import { type ReaderResultRecord } from "../../../readers/types.ts";
import { cite, type EntryFragment, type Finding } from "../../../core/types.ts";
import { type DcInterpreterContext, normalizeAgencyLookupKey } from "./context.ts";

export interface AgencyDirectoryInterpreterResult {
  entryFragments: EntryFragment[];
  relationFragments: [];
  findings: Finding[];
}

export interface AgencyDirectoryPayload {
  directoryName?: unknown;
  officialUrl?: unknown;
  sourcePageUrl?: unknown;
  subdomain?: unknown;
}

const sourceKind = "dc.agency_directory" as const;
const agencyKind = "dc.agency" as const;

export function interpretAgencyDirectory(
  records: ReaderResultRecord[],
  context?: DcInterpreterContext,
): AgencyDirectoryInterpreterResult {
  const entryFragments: EntryFragment[] = [];
  const findings: Finding[] = [];
  const seenByAgencyId = new Map<string, string>();

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
        message: `dc.agency_directory payload for ${record.key} is not an object`,
      });
      continue;
    }

    const sourceRecord = payload as AgencyDirectoryPayload;
    const directoryName = asString(sourceRecord.directoryName);
    const officialUrl = asString(sourceRecord.officialUrl);
    const sourcePageUrl = asString(sourceRecord.sourcePageUrl);
    if (!directoryName || !officialUrl || !sourcePageUrl) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.agency_directory_missing_fields",
        message: `dc.agency_directory record ${record.key} is missing required fields`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const agencyId = resolveAgencyId(directoryName, context);
    if (!agencyId) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.agency_directory_unmatched",
        message:
          `Agency directory row "${directoryName}" did not resolve to an existing canonical dc.agency entry`,
        citation: cite(sourceKind, record.key, { url: sourcePageUrl }),
      });
      continue;
    }

    const priorUrl = seenByAgencyId.get(agencyId);
    if (priorUrl) {
      if (priorUrl !== officialUrl) {
        findings.push({
          kind: "warn",
          code: "dc.interpreter.agency_directory_duplicate_match",
          message:
            `Agency directory resolved multiple official URLs for ${agencyId}: ${priorUrl} vs ${officialUrl}`,
          citation: cite(sourceKind, record.key, { url: sourcePageUrl }),
        });
      }
      continue;
    }
    seenByAgencyId.set(agencyId, officialUrl);

    const canonicalName = context?.agencyNameLookup?.get(agencyId) ?? directoryName;

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: record.key,
      provisionalId: agencyId,
      family: "organization",
      kind: agencyKind,
      name: canonicalName,
      attributes: {
        officialUrl,
        sourcePageUrl,
      },
      citations: [cite(sourceKind, record.key, { url: sourcePageUrl })],
    });
  }

  return { entryFragments, relationFragments: [], findings };
}

function resolveAgencyId(
  directoryName: string,
  context?: DcInterpreterContext,
): string | null {
  const agencyLookup = context?.agencyLookup;
  if (!agencyLookup) {
    return null;
  }

  for (const candidate of candidateNames(directoryName)) {
    const normalized = normalizeAgencyLookupKey(candidate);
    if (!normalized) {
      continue;
    }
    const resolved = agencyLookup.get(normalized);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function candidateNames(directoryName: string): string[] {
  const output = new Set<string>();
  output.add(directoryName.trim());

  const withoutAcronym = directoryName
    .replace(/\s+-\s+[A-Z0-9][A-Z0-9 .&()/-]{1,15}$/u, "")
    .trim();
  if (withoutAcronym) {
    output.add(withoutAcronym);
  }

  const withoutQualifier = directoryName.replace(/\s*\([^)]*\)\s*$/u, "").trim();
  if (withoutQualifier) {
    output.add(withoutQualifier);
  }

  const withoutBoth = withoutAcronym.replace(/\s*\([^)]*\)\s*$/u, "").trim();
  if (withoutBoth) {
    output.add(withoutBoth);
  }

  return [...output];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
