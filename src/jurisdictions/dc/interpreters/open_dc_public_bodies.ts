import { type ReaderResultRecord } from "../../../readers/types.ts";
import { sanitizeOpenDCPublicBodyDescriptionText } from "../../../readers/open_dc_public_bodies.ts";
import {
  cite,
  type EntryFragment,
  type Finding,
  type RelationFragment,
} from "../../../core/types.ts";
import { parseLegalCitationLocators } from "./citations.ts";
import {
  type DcInterpreterContext,
  normalizeAgencyLookupKey,
  publicBodyLookupKey,
} from "./context.ts";
import {
  buildLegalAuthorityArtifacts,
  buildOpenDcLegalAuthorityLocatorInputs,
  canonicalOpenDcLegalAuthorityUrl,
  isRejectedLegalAuthorityLocator,
} from "./legal_authorities.ts";
import { dcBoardKind } from "../kinds/board.ts";
import { dcCommissionKind } from "../kinds/commission.ts";
import { dcCouncilKind } from "../kinds/council.ts";
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
  description?: unknown;
  officialUrl?: unknown;
  enablingStatute?: unknown;
  enablingStatuteUrl?: unknown;
  governingAgency?: unknown;
  governingAgencyAcronym?: unknown;
  administeringAgency?: unknown;
  fromSupplementalIndex?: unknown;
}

interface ParsedOpenDcPublicBodyRecord {
  record: ReaderResultRecord;
  name: string;
  slug: string;
  detailUrl: string;
  description?: string;
  officialUrl?: string;
  enablingStatute?: string;
  enablingStatuteUrl?: string;
  governingAgency?: string;
  governingAgencyAcronym?: string;
  administeringAgency?: string;
  fromSupplementalIndex: boolean;
  detected: string;
  provisionalId: string;
  normalizedName: string;
}

interface OpenDcLegalAuthorityCorrection {
  enablingStatute?: string;
  enablingStatuteUrl?: string;
  suppressLegalAuthority?: boolean;
  rationale: string;
}

const sourceKind = "open_dc.public_bodies" as const;
const governsRelationKind = "dc.relation:governs" as const;
const standardKinds = new Set(["board", "commission", "authority", "council"]);

const legalAuthorityCorrections = new Map<string, OpenDcLegalAuthorityCorrection>([
  [
    "opioid-fatality-review-board",
    {
      enablingStatute: "Mayor's Order 2019-024: Establishment - Opioid Fatality Review Board",
      enablingStatuteUrl:
        "https://dcregs.dc.gov/Common/MayorOrders.aspx?Type=MayorOrder&OrderNumber=2019-024",
      rationale:
        "live D.C. Register shows Mayor's Order 2019-026 is a Financial Literacy Council appointment; 2019-024 establishes the Opioid Fatality Review Board",
    },
  ],
  [
    "dc-commission-poverty",
    {
      enablingStatute: "D.C. Code § 3-641.02",
      enablingStatuteUrl: "https://code.dccouncil.gov/us/dc/council/code/sections/3-641.02",
      rationale: "live D.C. Code section 3-641 404s; section 3-641.02 is the establishment section",
    },
  ],
  [
    "food-policy-council",
    {
      enablingStatute: "D.C. Code § 48-312",
      enablingStatuteUrl: "https://code.dccouncil.gov/us/dc/council/code/sections/48-312",
      rationale: "live D.C. Code section 48-314.05 404s; section 48-312 establishes the council",
    },
  ],
  [
    "district-columbia-taxicab-commission-dctc",
    {
      enablingStatute: "D.C. Code § 50-301.04",
      enablingStatuteUrl: "https://code.dccouncil.gov/us/dc/council/code/sections/50-301.04",
      rationale:
        "live D.C. Code section 50-304 404s as prior codification; section 50-301.04 is the current official section",
    },
  ],
  [
    "dc-children-and-youth-investment-trust-corporation-board-directors",
    {
      suppressLegalAuthority: true,
      rationale:
        "Open DC locator D.C. Code § 13-38 does not resolve as a live D.C. Code section; official search surfaces D.C. Law 13-38, so the authority evidence is ambiguous",
    },
  ],
  [
    "metropolitan-washington-airports-authority-board-directors-mwaa",
    {
      suppressLegalAuthority: true,
      rationale:
        "Open DC locator D.C. Code § 9-1006 does not resolve as a live D.C. Code section and needs a future human replacement decision",
    },
  ],
]);

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
    case "council":
      return dcCouncilKind.kind;
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
    case "council":
      return dcCouncilKind.family;
    default:
      return dcAgencyKind.family;
  }
}

function makeProvisionalId(detected: string, slug: string): string {
  const prefix = entryKindForPublicBody(detected);
  return `${prefix}:${slug}`;
}

function resolvePublicBodyProvisionalId(
  detected: string,
  name: string,
  slug: string,
  context?: DcInterpreterContext,
): { provisionalId: string; shadowedSourceRecordId?: string } {
  const provisionalId = makeProvisionalId(detected, slug);
  const standardKinds = new Set(["board", "commission", "authority", "council"]);
  if (!standardKinds.has(detected)) {
    return { provisionalId };
  }

  const kind = entryKindForPublicBody(detected);
  const trusted = context?.publicBodyLookup?.get(publicBodyLookupKey(kind, name));
  if (!trusted) {
    return { provisionalId };
  }

  return {
    provisionalId: trusted.provisionalId,
    shadowedSourceRecordId: trusted.sourceRecordId,
  };
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
  const parsedRecords: ParsedOpenDcPublicBodyRecord[] = [];
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
    const description = sanitizeOpenDCPublicBodyDescriptionText(
      asString(sourceRecord.description) ?? undefined,
    );
    const officialUrl = asString(sourceRecord.officialUrl);
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
    const resolvedPublicBody = resolvePublicBodyProvisionalId(detected, name, slug, context);
    const provisionalId = resolvedPublicBody.provisionalId;
    const normalizedName = normalizeAgencyLookupKey(name);
    if (resolvedPublicBody.shadowedSourceRecordId) {
      findings.push({
        kind: "info",
        code: "dc.interpreter.opendc_public_body_source_shadow_merged",
        message: `Open DC public body "${name}" matched trusted ${
          entryKindForPublicBody(detected)
        } source record ${resolvedPublicBody.shadowedSourceRecordId}; using canonical id ${provisionalId}`,
        citation: cite(sourceKind, record.key),
      });
    }
    parsedRecords.push({
      record,
      name,
      slug,
      detailUrl,
      description,
      officialUrl: officialUrl ?? undefined,
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

  const staleDuplicateRecords = staleDuplicateRecordsFor(parsedRecords);
  for (const staleDuplicate of staleDuplicateRecords.values()) {
    const origin = staleDuplicate.fromSupplementalIndex ? "supplemental index" : "primary index";
    findings.push({
      kind: "info",
      code: "dc.interpreter.opendc_stale_or_failed_duplicate",
      message:
        `Open DC public body "${staleDuplicate.name}" slug ${staleDuplicate.slug} from ${origin} has no substantive details and duplicates a substantive Open DC slug; entry fragment suppressed`,
      citation: cite(sourceKind, staleDuplicate.record.key),
    });
  }

  for (const parsed of parsedRecords) {
    if (staleDuplicateRecords.has(parsed.record.key)) {
      continue;
    }

    if (!standardKinds.has(parsed.detected)) {
      findings.push({
        kind: "info",
        code: "dc.interpreter.opendc_unclassified_body",
        message:
          `Public body "${parsed.name}" identified as "${parsed.detected}"; requires promotion review`,
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

    const legalAuthorityCorrection = legalAuthorityCorrections.get(parsed.slug);
    if (legalAuthorityCorrection) {
      findings.push({
        kind: "info",
        code: legalAuthorityCorrection.suppressLegalAuthority
          ? "dc.interpreter.opendc_enabling_statute_suppressed"
          : "dc.interpreter.opendc_enabling_statute_corrected",
        message:
          `Open DC public body "${parsed.name}" legal authority evidence adjusted: ${legalAuthorityCorrection.rationale}`,
        citation: cite(sourceKind, parsed.record.key, { locator: "enablingStatute" }),
      });
    }

    const correctedEnablingStatute = legalAuthorityCorrection?.suppressLegalAuthority
      ? undefined
      : legalAuthorityCorrection?.enablingStatute ?? parsed.enablingStatute;
    const correctedEnablingStatuteUrl = legalAuthorityCorrection?.suppressLegalAuthority
      ? undefined
      : legalAuthorityCorrection?.enablingStatuteUrl ?? parsed.enablingStatuteUrl;

    const legalLocators = correctedEnablingStatute
      ? parseLegalCitationLocators({ LEGAL_REFERENCE: correctedEnablingStatute })
      : [];
    const legalAuthorityLocatorInputs = buildOpenDcLegalAuthorityLocatorInputs(
      legalLocators,
      correctedEnablingStatuteUrl,
    );
    const releaseLegalAuthorityLocatorInputs = legalAuthorityLocatorInputs.filter((input) =>
      !isRejectedLegalAuthorityLocator(input.locator)
    );
    const canonicalEnablingStatuteUrl = canonicalOpenDcLegalAuthorityUrl(
      legalLocators,
      correctedEnablingStatuteUrl,
    );
    const legalAuthorityArtifacts = buildLegalAuthorityArtifacts({
      source: sourceKind,
      sourceRecordId: parsed.record.key,
      subjectProvisionalId: parsed.provisionalId,
      locatorInputs: legalAuthorityLocatorInputs,
      emitAuthorities: standardKinds.has(parsed.detected),
    });
    const citations = legalAuthorityArtifacts.entryCitations;

    const attributes: Record<string, unknown> = {
      shortName: parsed.name,
      sourceOpenDcSlug: parsed.slug,
      sourceOpenDcUrl: parsed.detailUrl,
    };

    if (correctedEnablingStatute && releaseLegalAuthorityLocatorInputs.length > 0) {
      attributes.enablingStatute = correctedEnablingStatute;
    }
    if (canonicalEnablingStatuteUrl && releaseLegalAuthorityLocatorInputs.length > 0) {
      attributes.enablingStatuteUrl = canonicalEnablingStatuteUrl;
    }
    if (parsed.description) {
      attributes.description = parsed.description;
    }
    if (parsed.officialUrl) {
      attributes.officialUrl = parsed.officialUrl;
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
    entryFragments.push(...legalAuthorityArtifacts.entryFragments);

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
    relationFragments.push(...legalAuthorityArtifacts.relationFragments);

    if (correctedEnablingStatute && legalAuthorityLocatorInputs.length === 0) {
      findings.push({
        kind: "info",
        code: "dc.interpreter.opendc_enabling_statute_unparsed",
        message:
          `Could not parse legal citation from enabling statute: "${correctedEnablingStatute}"`,
        citation: cite(sourceKind, parsed.record.key, { locator: "enablingStatute" }),
      });
    } else if (
      correctedEnablingStatute && legalAuthorityLocatorInputs.length > 0 &&
      releaseLegalAuthorityLocatorInputs.length === 0
    ) {
      findings.push({
        kind: "info",
        code: "dc.interpreter.opendc_enabling_statute_rejected",
        message:
          `Rejected implausible legal citation from enabling statute: "${correctedEnablingStatute}"`,
        citation: cite(sourceKind, parsed.record.key, { locator: "enablingStatute" }),
      });
    }
  }

  return { entryFragments, relationFragments, findings };
}

function staleDuplicateRecordsFor(
  parsedRecords: ParsedOpenDcPublicBodyRecord[],
): Map<string, ParsedOpenDcPublicBodyRecord> {
  const recordsByNormalizedName = new Map<string, ParsedOpenDcPublicBodyRecord[]>();
  for (const parsed of parsedRecords) {
    const records = recordsByNormalizedName.get(parsed.normalizedName) ?? [];
    records.push(parsed);
    recordsByNormalizedName.set(parsed.normalizedName, records);
  }

  const staleRecords = new Map<string, ParsedOpenDcPublicBodyRecord>();
  for (const records of recordsByNormalizedName.values()) {
    if (records.length <= 1 || !records.some(hasSubstantiveOpenDcPublicBodyDetails)) {
      continue;
    }

    for (const record of records) {
      if (!hasSubstantiveOpenDcPublicBodyDetails(record)) {
        staleRecords.set(record.record.key, record);
      }
    }
  }
  return staleRecords;
}

function hasSubstantiveOpenDcPublicBodyDetails(record: ParsedOpenDcPublicBodyRecord): boolean {
  return Boolean(
    record.description || record.officialUrl || record.enablingStatute ||
      record.enablingStatuteUrl ||
      record.governingAgency || record.governingAgencyAcronym || record.administeringAgency,
  );
}
