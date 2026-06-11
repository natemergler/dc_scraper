import { type ReaderResultRecord } from "../../../readers/types.ts";
import {
  cite,
  type EntryFragment,
  type Finding,
  type RelationFragment,
} from "../../../core/types.ts";
import { parseLegalCitationLocators } from "./citations.ts";
import { type DcInterpreterContext, normalizeAgencyLookupKey } from "./context.ts";
import { dcBoardKind } from "../kinds/board.ts";
import { dcCommissionKind } from "../kinds/commission.ts";
import { dcAuthorityKind } from "../kinds/authority.ts";
import { dcAgencyKind } from "../kinds/agency.ts";

export interface OpenDCPublicBodiesInterpreterResult {
  entryFragments: EntryFragment[];
  relationFragments: RelationFragment[];
  findings: Finding[];
}

export interface OpenDCPublicBodyPayload {
  name?: unknown;
  slug?: unknown;
  detailUrl?: unknown;
  enablingStatute?: unknown;
  enablingStatuteUrl?: unknown;
  governingAgency?: unknown;
  governingAgencyAcronym?: unknown;
  administeringAgency?: unknown;
  fromSupplementalIndex?: unknown;
}

const sourceKind = "open_dc.public_bodies" as const;
const governsRelationKind = "dc.relation:governs" as const;

const nonRelationshipAgencyLabels = new Set<string>([
  "n/a",
  "na",
  "none",
  "executive office of the mayor",
  "mayor's office",
  "office of the mayor",
  "dc government",
  "district of columbia",
  "district of columbia government",
  "independent agency",
]);

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function detectKindFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("committee")) {
    return "committee";
  }
  if (lower.includes("commission")) {
    return "commission";
  }
  if (lower.includes("board")) {
    return "board";
  }
  if (lower.includes("authority")) {
    return "authority";
  }
  if (/\btask(?:[- ]?force)\b/.test(lower)) {
    return "task_force";
  }
  if (lower.includes("council")) {
    return "council";
  }
  if (lower.includes("office")) {
    return "office";
  }
  if (lower.includes("agency")) {
    return "agency";
  }
  return "public_body";
}

function entryKindForPublicBody(detected: string): string {
  switch (detected) {
    case "board":
      return dcBoardKind.kind;
    case "commission":
      return dcCommissionKind.kind;
    case "authority":
      return dcAuthorityKind.kind;
    default:
      return dcAgencyKind.kind;
  }
}

function entryFamilyForPublicBody(detected: string): string {
  switch (detected) {
    case "board":
      return dcBoardKind.family;
    case "commission":
      return dcCommissionKind.family;
    case "authority":
      return dcAuthorityKind.family;
    default:
      return dcAgencyKind.family;
  }
}

function makeProvisionalId(detected: string, slug: string): string {
  const prefix = entryKindForPublicBody(detected);
  return `${prefix}:${slug}`;
}

function isNonRelationshipLabel(label: string): boolean {
  const normalized = label.toLowerCase().replace(/\s+/g, " ").trim();
  return nonRelationshipAgencyLabels.has(normalized);
}

function resolveAgencyRelation(
  name: string,
  subjectProvisionalId: string,
  context?: DcInterpreterContext,
): { resolvedId: string } | undefined {
  if (!name) return undefined;
  if (isNonRelationshipLabel(name)) return undefined;

  const normalized = normalizeAgencyLookupKey(name);

  if (context?.agencyLookup) {
    const resolvedId = context.agencyLookup.get(normalized);
    if (resolvedId) {
      const fullId = resolvedId.includes(":") ? resolvedId : `dc.agency:${resolvedId}`;
      return fullId === subjectProvisionalId ? undefined : { resolvedId: fullId };
    }
  }

  return undefined;
}

function getAgencyRelationFinding(
  subjectName: string,
  agencyLabel: string,
  subjectProvisionalId: string,
  context?: DcInterpreterContext,
): { code: string; message: string } | undefined {
  if (!agencyLabel || isNonRelationshipLabel(agencyLabel)) return undefined;

  const normalized = normalizeAgencyLookupKey(agencyLabel);

  if (context?.agencyLookup) {
    const resolvedId = context.agencyLookup.get(normalized);
    if (resolvedId) {
      const fullId = resolvedId.includes(":") ? resolvedId : `dc.agency:${resolvedId}`;
      if (fullId === subjectProvisionalId) {
        return {
          code: "dc.interpreter.opendc_governing_agency_self_reference",
          message:
            `Public body "${subjectName}" has governing agency "${agencyLabel}" that resolves to self`,
        };
      }
      return {
        code: "dc.interpreter.opendc_governing_agency_unresolved",
        message:
          `Public body "${subjectName}" has governing agency "${agencyLabel}" that does not resolve to a known agency in lookup`,
      };
    }
    return {
      code: "dc.interpreter.opendc_governing_agency_unresolved",
      message:
        `Public body "${subjectName}" has governing agency "${agencyLabel}" that does not resolve to a known agency in lookup`,
    };
  }

  return {
    code: "dc.interpreter.opendc_governing_agency_unresolved",
    message:
      `Public body "${subjectName}" has governing agency "${agencyLabel}" but no agency lookup is available`,
  };
}

export function interpretOpenDCPublicBodies(
  records: ReaderResultRecord[],
  context?: DcInterpreterContext,
): OpenDCPublicBodiesInterpreterResult {
  const entryFragments: EntryFragment[] = [];
  const relationFragments: RelationFragment[] = [];
  const findings: Finding[] = [];
  const parsedRecords: Array<{
    record: ReaderResultRecord;
    name: string;
    slug: string;
    detailUrl: string;
    enablingStatute?: string;
    enablingStatuteUrl?: string;
    governingAgency?: string;
    governingAgencyAcronym?: string;
    administeringAgency?: string;
    fromSupplementalIndex: boolean;
    detected: string;
    provisionalId: string;
    normalizedName: string;
  }> = [];
  const normalizedNameToSlugs = new Map<string, Set<string>>();

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
        message: `open_dc.public_bodies payload for ${record.key} is not an object`,
      });
      continue;
    }

    const sourceRecord = payload as Record<string, unknown>;

    const name = asString(sourceRecord.name);
    const slug = asString(sourceRecord.slug);
    const detailUrl = asString(sourceRecord.detailUrl);
    const enablingStatute = asString(sourceRecord.enablingStatute);
    const enablingStatuteUrl = asString(sourceRecord.enablingStatuteUrl);
    const governingAgency = asString(sourceRecord.governingAgency);
    const governingAgencyAcronym = asString(sourceRecord.governingAgencyAcronym);
    const administeringAgency = asString(sourceRecord.administeringAgency);
    const fromSupplementalIndex = sourceRecord.fromSupplementalIndex === true;

    if (!name || !slug || !detailUrl) {
      findings.push({
        kind: "warn",
        code: "dc.interpreter.opendc_missing_fields",
        message: `open_dc.public_bodies record ${record.key} is missing required fields`,
        citation: cite(sourceKind, record.key),
      });
      continue;
    }

    const detected = detectKindFromName(name);
    const provisionalId = makeProvisionalId(detected, slug);
    const normalizedName = normalizeAgencyLookupKey(name);
    parsedRecords.push({
      record,
      name,
      slug,
      detailUrl,
      enablingStatute: enablingStatute ?? undefined,
      enablingStatuteUrl: enablingStatuteUrl ?? undefined,
      governingAgency: governingAgency ?? undefined,
      governingAgencyAcronym: governingAgencyAcronym ?? undefined,
      administeringAgency: administeringAgency ?? undefined,
      fromSupplementalIndex,
      detected,
      provisionalId,
      normalizedName,
    });

    let slugSet = normalizedNameToSlugs.get(normalizedName);
    if (!slugSet) {
      slugSet = new Set<string>();
      normalizedNameToSlugs.set(normalizedName, slugSet);
    }
    slugSet.add(slug);
  }

  for (const parsed of parsedRecords) {
    const standardKinds = new Set(["board", "commission", "authority"]);
    if (!standardKinds.has(parsed.detected)) {
      findings.push({
        kind: "info",
        code: "dc.interpreter.opendc_unclassified_body",
        message:
          `Public body "${parsed.name}" identified as "${parsed.detected}"; classified as dc.agency`,
        citation: cite(sourceKind, parsed.record.key),
      });
    }

    const duplicateSlugs = normalizedNameToSlugs.get(parsed.normalizedName);
    if (duplicateSlugs && duplicateSlugs.size > 1) {
      findings.push({
        kind: "info",
        code: "dc.interpreter.opendc_likely_duplicate_public_body",
        message:
          `Public body "${parsed.name}" appears under multiple Open DC slugs after normalization: ${
            [...duplicateSlugs].sort().join(", ")
          }`,
        citation: cite(sourceKind, parsed.record.key),
      });
    }

    const citations = [cite(sourceKind, parsed.record.key)];

    const legalLocators = parsed.enablingStatute
      ? parseLegalCitationLocators({ LEGAL_REFERENCE: parsed.enablingStatute })
      : [];

    for (const locator of legalLocators) {
      citations.push(cite(sourceKind, parsed.record.key, { locator }));
    }

    const attributes: Record<string, unknown> = {
      shortName: parsed.name,
      sourceOpenDcSlug: parsed.slug,
      sourceOpenDcUrl: parsed.detailUrl,
    };

    if (parsed.enablingStatute) {
      attributes.enablingStatute = parsed.enablingStatute;
    }
    if (parsed.enablingStatuteUrl) {
      attributes.enablingStatuteUrl = parsed.enablingStatuteUrl;
    }

    entryFragments.push({
      fragmentType: "entry",
      source: sourceKind,
      sourceRecordId: parsed.record.key,
      provisionalId: parsed.provisionalId,
      family: entryFamilyForPublicBody(parsed.detected),
      kind: entryKindForPublicBody(parsed.detected),
      name: parsed.name,
      attributes,
      citations,
    });

    const governingResolution = resolveAgencyRelation(
      parsed.governingAgency ?? "",
      parsed.provisionalId,
      context,
    );
    if (governingResolution) {
      relationFragments.push({
        fragmentType: "relation",
        source: sourceKind,
        sourceRecordId: parsed.record.key,
        from: parsed.provisionalId,
        relationKind: governsRelationKind,
        to: governingResolution.resolvedId,
        citations: [cite(sourceKind, parsed.record.key)],
      });
    } else if (parsed.governingAgency) {
      const finding = getAgencyRelationFinding(
        parsed.name,
        parsed.governingAgency,
        parsed.provisionalId,
        context,
      );
      if (finding) {
        findings.push({
          kind: "info",
          code: finding.code,
          message: finding.message,
          citation: cite(sourceKind, parsed.record.key, { locator: "governingAgency" }),
        });
      }
    }

    const administeringResolution = resolveAgencyRelation(
      parsed.administeringAgency ?? "",
      parsed.provisionalId,
      context,
    );
    if (administeringResolution) {
      relationFragments.push({
        fragmentType: "relation",
        source: sourceKind,
        sourceRecordId: parsed.record.key,
        from: parsed.provisionalId,
        relationKind: governsRelationKind,
        to: administeringResolution.resolvedId,
        citations: [cite(sourceKind, parsed.record.key)],
      });
    } else if (parsed.administeringAgency) {
      const finding = getAgencyRelationFinding(
        parsed.name,
        parsed.administeringAgency,
        parsed.provisionalId,
        context,
      );
      if (finding) {
        findings.push({
          kind: "info",
          code: finding.code,
          message: finding.message,
          citation: cite(sourceKind, parsed.record.key, { locator: "administeringAgency" }),
        });
      }
    }

    if (parsed.enablingStatute && legalLocators.length === 0) {
      findings.push({
        kind: "info",
        code: "dc.interpreter.opendc_enabling_statute_unparsed",
        message:
          `Could not parse legal citation from enabling statute: "${parsed.enablingStatute}"`,
        citation: cite(sourceKind, parsed.record.key, { locator: "enablingStatute" }),
      });
    }
  }

  return { entryFragments, relationFragments, findings };
}
