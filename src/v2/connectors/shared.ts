import {
  type ArtifactCaptureInput,
  buildEntityId,
  buildReviewItemId,
  type ConnectorResult,
  decodeHtmlEntities,
  normalizeName,
  type SourceDefinition,
} from "../domain.ts";
export { toPublicHttpUrl } from "../url_safety.ts";

export type { ConnectorResult } from "../domain.ts";

export interface ConnectorFetchResponse {
  status: number;
  text(): Promise<string>;
  json<T>(): Promise<T>;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<ConnectorFetchResponse>;

export interface ConnectorContext {
  fetcher: Fetcher;
  limit?: number;
}

export interface SourceConnector {
  sourceId: string;
  source: SourceDefinition;
  run(context: ConnectorContext): Promise<ConnectorResult>;
}

export function defaultFetcher(
  url: string,
  init?: RequestInit,
): Promise<ConnectorFetchResponse> {
  return fetch(url, init) as Promise<ConnectorFetchResponse>;
}

export function artifact(
  kind: ArtifactCaptureInput["kind"],
  extension: string,
  fetchedUrl: string,
  contentText: string,
): ArtifactCaptureInput {
  return { kind, extension, fetchedUrl, contentText };
}

export function fieldEvidence(path: string, value: unknown, artifactIndex?: number) {
  return {
    fieldPath: path,
    observedValue: String(value ?? ""),
    ...(artifactIndex === undefined ? {} : { artifactIndex }),
  };
}

export function buildCandidateReviewItem(
  subjectId: string,
  reason: string,
  defaultAction = "accept",
  details: Record<string, unknown> = {},
): {
  reviewItemId: string;
  itemType: "entity_candidate" | "relationship_candidate";
  subjectId: string;
  reason: string;
  defaultAction: string;
  details: Record<string, unknown>;
} {
  return {
    reviewItemId: buildReviewItemId(subjectId, reason),
    itemType: subjectId.startsWith("relationship.") ? "relationship_candidate" : "entity_candidate",
    subjectId,
    reason,
    defaultAction,
    details,
  };
}

export function captureSingle(text: string, pattern: RegExp, group = 1): string | undefined {
  const match = text.match(pattern);
  return match?.[group];
}

export function toAbsoluteUrl(baseUrl: string, maybeRelative: string): string {
  return new URL(maybeRelative, baseUrl).toString();
}

export function buildKnownEntityRef(name: string): string {
  const directAlias = knownEntityRefs.get(entityAliasKey(name));
  if (directAlias) return directAlias;
  for (const variant of acceptedStyleEntityVariants(name)) {
    const alias = knownEntityRefs.get(entityAliasKey(variant));
    if (alias) return alias;
  }
  for (const variant of acceptedStyleEntityVariants(name)) {
    if (looksLikeAgencyStyleEndpoint(variant)) return buildEntityId(variant);
  }
  return buildEntityId(name);
}

export function buildKnownCouncilOversightEntityRef(rawValue: string): string {
  const baseName = extractScopedCouncilOversightBaseName(rawValue);
  return buildKnownEntityRef(baseName ?? rawValue);
}

export function extractScopedCouncilOversightBaseName(rawValue: string): string | undefined {
  const normalized = normalizeName(rawValue);
  if (!normalized || /^all of\b/i.test(normalized)) return undefined;
  const parenthetical = normalized.match(/^(.+?)\s*\((including|excluding|jointly)\b/i);
  if (parenthetical?.[1]) return parenthetical[1].trim();
  const commaScoped = normalized.match(/^(.+?),\s*(including|excluding|jointly)\b/i);
  if (commaScoped?.[1]) return commaScoped[1].trim();
  return undefined;
}

export function isScopedCouncilOversightTarget(rawValue: string): boolean {
  return /\bincluding\b|\bjointly\b|^all of\b|\bexcluding\b/i.test(normalizeName(rawValue));
}

const defaultDeferCouncilOversightTargets = new Set([
  "Access to Justice Initiative",
  "Age-Friendly DC Task Force",
  "Behavioral Health Planning Council",
  "Cedar Hill Hospital",
  "Committee on Facilities and Procurement",
  "Committee on Housing and Neighborhood Revitalization",
  "Commission and Office on Re-Entry and Returning Citizen Affairs",
  "Contract Appeals Board",
  "Corrections Information Council",
  "Council on Physical Fitness, Health, and Nutrition",
  "Green Finance Authority",
  "Health Literacy Council",
  "Interfaith Council",
  "Interstate Compact Commissions",
  "Labor/Management Partnership Council",
  "Law Revision Commission",
  "Metropolitan Washington Airports Authority",
  "Metropolitan Washington Regional Ryan White Planning Council",
  "Multistate Tax Commission",
  "OCFO Office of Budget and Planning",
  "Office and Commission on African Affairs",
  "Office and Commission on African American Affairs",
  "Office of and Commission on Human Rights",
  "Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)",
  "Other Post-Employment Benefits/Retiree Health Contribution",
  "Pay-As-You-Go Capital",
  "Research Practice Partnership",
  "Robert F. Kennedy Memorial Stadium Community Benefits Oversight Committee",
  "Soil and Water Conservation District",
  "Statehood Commission and delegation",
  "Sustainable Energy Utility",
  "Universal Paid Leave Fund",
  "Washington Aqueduct",
  "Washington Metropolitan Area Transit Authority",
]);

export function defaultActionForCouncilOversightTarget(
  rawValue?: string | null,
): "accept" | "defer" {
  return councilOversightReviewPolicy(rawValue).defaultAction;
}

export function councilOversightReviewPolicy(
  rawValue?: string | null,
): { defaultAction: "accept" | "defer"; whyDeferred?: string } {
  if (!rawValue) return { defaultAction: "accept" };
  const normalized = normalizeName(rawValue);
  if (isScopedCouncilOversightTarget(normalized)) {
    return {
      defaultAction: "defer",
      whyDeferred:
        "Scoped oversight text uses including/excluding/jointly wording, so the exact oversight edge still needs a human decision.",
    };
  }
  if (defaultDeferCouncilOversightTargets.has(normalized)) {
    return {
      defaultAction: "defer",
      whyDeferred:
        "This named target stays on the conservative Council oversight defer list until a human confirms the committee relationship.",
    };
  }
  return { defaultAction: "accept" };
}

export function extractFirstUrl(input: string): string | undefined {
  return input.match(/https?:\/\/\S+/)?.[0];
}

export function maybeString(value: unknown): string | undefined {
  const text = typeof value === "string"
    ? normalizeName(decodeHtmlEntities(value))
    : String(value ?? "").trim();
  return text ? text : undefined;
}

function entityAliasKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

function acceptedStyleEntityVariants(name: string): string[] {
  const normalized = normalizeName(name);
  const variants: string[] = [];
  const withoutTrailingParenthetical = normalized.replace(/\s+\([^)]+\)\s*$/, "").trim();
  if (withoutTrailingParenthetical && withoutTrailingParenthetical !== normalized) {
    variants.push(withoutTrailingParenthetical);
  }
  for (const value of [...variants]) {
    if (
      /^deputy mayor for /i.test(value) && value.includes("/") &&
      !variants.includes(value.replace(/\/.*$/, "").trim())
    ) {
      variants.push(value.replace(/\/.*$/, "").trim());
    }
  }
  return variants;
}

function looksLikeAgencyStyleEndpoint(name: string): boolean {
  const value = entityAliasKey(name);
  return value.includes("department") ||
    value.includes("office") ||
    value.includes("agency") ||
    value.includes("deputy mayor") ||
    value.includes("city administrator") ||
    value.includes("chief financial officer");
}

const knownEntityRefs = new Map<string, string>([
  [
    "alcoholic beverages and cannabis administration",
    "dc.alcoholic_beverage_and_cannabis_administration",
  ],
  [
    "alcoholic beverages and cannabis administration (abca)",
    "dc.alcoholic_beverage_and_cannabis_administration",
  ],
  ["bicycle advisory council", "dc.bicycle_advisory_council"],
  [
    "board of review of anti-deficiency violations",
    "dc.board_of_review_for_anti_deficiency_violations",
  ],
  [
    "citizen review panel on child abuse and neglect",
    "dc.citizen_review_panel_on_child_abuse_and_neglect",
  ],
  ["clemency board", "dc.clemency_board"],
  ["commission on nightlife and culture", "dc.commission_on_nightlife_and_culture"],
  ["commission on poverty", "dc.commission_on_poverty"],
  ["commission on women", "dc.commission_for_women"],
  ["council", "dc.council_of_the_district_of_columbia"],
  ["council of the district of columbia", "dc.council_of_the_district_of_columbia"],
  [
    "department of consumer and regulatory affairs",
    "dc.department_of_licensing_and_consumer_protection",
  ],
  [
    "department of consumer and regulatory affairs (dcra)",
    "dc.department_of_licensing_and_consumer_protection",
  ],
  ["department of disability services", "dc.department_on_disability_services"],
  [
    "developmental disabilities state planning council",
    "dc.developmental_disabilities_state_planning_council_dd_council",
  ],
  ["destination dc", "dc.destination_dc"],
  ["department of employment services (does)", "dc.department_of_employment_services"],
  ["department of health", "dc.dc_health"],
  ["department of health (doh)", "dc.dc_health"],
  ["city administrator", "dc.office_of_the_city_administrator"],
  [
    "dc department of licensing and consumer protection",
    "dc.department_of_licensing_and_consumer_protection",
  ],
  ["deputy mayor for education", "dc.office_of_the_deputy_mayor_for_education"],
  [
    "deputy mayor for health and human services",
    "dc.office_of_the_deputy_mayor_for_health_and_human_services",
  ],
  [
    "deputy mayor for planning and economic development",
    "dc.office_of_the_deputy_mayor_for_planning_and_economic_development",
  ],
  [
    "deputy mayor for planning and economic development (dmped)",
    "dc.office_of_the_deputy_mayor_for_planning_and_economic_development",
  ],
  [
    "deputy mayor for public safety and justice",
    "dc.office_of_the_deputy_mayor_for_public_safety_and_justice",
  ],
  [
    "deputy mayor for public safety and justice/operations (dmpsj/o)",
    "dc.office_of_the_deputy_mayor_for_public_safety_and_justice",
  ],
  ["district of columbia auditor", "dc.office_of_the_dc_auditor"],
  ["district of columbia board of elections", "dc.board_of_elections"],
  ["district of columbia housing authority", "dc.dc_housing_authority"],
  ["district of columbia public library", "dc.dc_public_library"],
  [
    "district of columbia health benefit exchange authority",
    "dc.health_benefit_exchange_authority",
  ],
  ["district of columbia public library system", "dc.dc_public_library"],
  ["district of columbia water and sewer authority", "dc.dc_water"],
  ["doc", "dc.department_of_corrections"],
  ["dlcp/opl", "dc.department_of_licensing_and_consumer_protection"],
  ["does", "dc.department_of_employment_services"],
  ["doh", "dc.dc_health"],
  [
    "fire and emergency medical services department",
    "dc.fire_and_emergency_medical_services",
  ],
  ["health information exchange policy board", "dc.health_information_exchange_policy_board_hie"],
  ["historic preservation review board", "dc.historic_preservation_review_board_hprb"],
  ["housing finance agency", "dc.dc_housing_finance_agency"],
  ["inspector general", "dc.office_of_the_inspector_general"],
  ["mpd", "dc.metropolitan_police_department"],
  ["mayor's office of veterans affairs (mova)", "dc.mayor_s_office_of_veterans_affairs"],
  ["mayor", "dc.mayor"],
  ["mayor's office of veteran's affairs", "dc.mayor_s_office_of_veterans_affairs"],
  ["national capital planning commission", "dc.national_capital_planning_commission_ncpc"],
  [
    "office of the attorney general for the district of columbia",
    "dc.office_of_the_attorney_general",
  ],
  ["office of city administrator", "dc.office_of_the_city_administrator"],
  [
    "office of the state superintendent for education",
    "dc.office_of_the_state_superintendent_of_education",
  ],
  [
    "office of the people’s counsel",
    "dc.office_of_the_people_s_counsel_for_the_district_of_columbia",
  ],
  [
    "office of lesbian, gay, bisexual, transgender, and questioning affairs",
    "dc.mayor_s_office_of_lesbian_gay_bisexual_transgender_and_questioning_affairs",
  ],
  [
    "mayor's office on asian and pacific islander affairs",
    "dc.mayor_s_office_on_asian_and_pacific_island_affairs",
  ],
  ["office of religious affairs", "dc.mayor_s_office_of_religious_affairs"],
  ["office on returning citizen affairs", "dc.mayor_s_office_on_returning_citizen_affairs"],
  [
    "office on women’s policy and initiatives",
    "dc.mayor_s_office_on_women_s_policy_and_initiatives",
  ],
  ["pedestrian advisory council", "dc.pedestrian_advisory_council"],
  ["public charter school board", "dc.public_charter_school_board_pcsb"],
  ["public charter school board (pcsb)", "dc.public_charter_school_board_pcsb"],
  ["secretary of the district of columbia", "dc.office_of_the_secretary"],
  ["secretary of state of the district of columbia", "dc.office_of_the_secretary"],
  ["state superintendent of education", "dc.office_of_the_state_superintendent_of_education"],
  ["state rehabilitation council", "dc.state_rehabilitation_council_src"],
  ["statewide health coordinating council", "dc.statewide_health_coordinating_council_shcc"],
  ["statewide independent living council", "dc.statewide_independent_living_council_silc"],
  ["uniform law commission", "dc.uniform_law_commission_ulc"],
  [
    "washington convention center and sports authority (events dc)",
    "dc.washington_convention_and_sports_authority",
  ],
  ["washington metrorail safety commission", "dc.washington_metrorail_safety_commission"],
]);
