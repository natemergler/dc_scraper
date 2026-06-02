import {
  type ArtifactCaptureInput,
  buildEntityId,
  buildReviewItemId,
  type ConnectorResult,
  decodeHtmlEntities,
  normalizeName,
  type SourceDefinition,
} from "../domain.ts";

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
  return knownEntityRefs.get(entityAliasKey(name)) ?? buildEntityId(name);
}

export function toPublicHttpUrl(
  baseUrl: string,
  maybeRelative: string | undefined,
): string | undefined {
  const raw = maybeRelative?.trim();
  if (!raw || looksLikeLocalPath(raw)) return undefined;
  let url: URL;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const href = url.toString();
  return looksLikeLocalPath(href) ? undefined : href;
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

function looksLikeLocalPath(value: string): boolean {
  const decoded = repeatedlyDecodeURIComponent(value).replaceAll("\\", "/");
  return /(^|\/)file:/i.test(decoded) ||
    /^[a-z]:\//i.test(decoded) ||
    /(^|\/)Users\/[^/]+/i.test(decoded) ||
    /(^|\/)home\/[^/]+/i.test(decoded);
}

function repeatedlyDecodeURIComponent(value: string): string {
  let decoded = value;
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function entityAliasKey(name: string): string {
  return normalizeName(name).toLowerCase();
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
  ["bicycle advisory council", "dc.bicycle_advisory_council_bac"],
  [
    "board for the condemnation of insanitary buildings",
    "dc.board_for_the_condemnation_of_insanitary_buildings_bcib",
  ],
  [
    "board of architecture, interior design, and landscape architecture",
    "dc.board_of_architecture_interior_design_and_landscape_architecture_boaidla",
  ],
  ["board of barber and cosmetology", "dc.board_of_barber_and_cosmetology_bobc"],
  ["board of funeral directors", "dc.board_of_funeral_directors_bofd"],
  ["board of industrial trades", "dc.board_of_industrial_trades_boit"],
  ["board of professional engineering", "dc.board_of_professional_engineering_bope"],
  ["board of real estate appraisers", "dc.board_of_real_estate_appraisers_borea"],
  [
    "board of review of anti-deficiency violations",
    "dc.board_of_review_for_anti_deficiency_violations_brav",
  ],
  [
    "citizen review panel on child abuse and neglect",
    "dc.citizen_review_panel_for_child_abuse_and_neglect_crp",
  ],
  ["clemency board", "dc.clemency_board_cb"],
  ["combat sports commission", "dc.combat_sports_commission_csc"],
  ["commission on aging", "dc.commission_on_aging_coa"],
  [
    "commission on climate change and resiliency",
    "dc.commission_on_climate_change_and_resiliency_cccr",
  ],
  ["commission on fashion arts and events", "dc.commission_on_fashion_arts_and_events_cfae"],
  ["commission on health equity", "dc.commission_on_health_equity_cohe"],
  [
    "commission on judicial disabilities and tenure",
    "dc.commission_on_judicial_disabilities_and_tenure_cjdt",
  ],
  ["commission on nightlife and culture", "dc.commission_on_nightlife_and_culture_cnc"],
  ["commission on persons with disabilities", "dc.commission_on_persons_with_disabilities_cpd"],
  ["commission on poverty", "dc.commission_on_poverty_cp"],
  ["commission on women", "dc.commission_for_women_cfw"],
  [
    "commission on the martin luther king, jr. holiday",
    "dc.commission_on_the_martin_luther_king_jr_holiday_cmlk",
  ],
  ["council", "dc.council_of_the_district_of_columbia"],
  ["council of the district of columbia", "dc.council_of_the_district_of_columbia"],
  [
    "developmental disabilities state planning council",
    "dc.developmental_disabilities_state_planning_council_dd_council",
  ],
  ["destination dc", "dc.washington_d_c_convention_and_tourism_corporation_destination_dc"],
  ["department of employment services (does)", "dc.department_of_employment_services"],
  ["department of health", "dc.dc_health"],
  ["department of health (doh)", "dc.dc_health"],
  ["city administrator", "dc.office_of_the_city_administrator"],
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
    "deputy mayor for public safety and justice",
    "dc.office_of_the_deputy_mayor_for_public_safety_and_justice",
  ],
  ["district of columbia auditor", "dc.office_of_the_dc_auditor"],
  ["district of columbia board of elections", "dc.board_of_elections"],
  ["district of columbia housing authority", "dc.dc_housing_authority"],
  [
    "district of columbia health benefit exchange authority",
    "dc.health_benefit_exchange_authority",
  ],
  ["district of columbia public library system", "dc.dc_public_library"],
  ["district of columbia sentencing commission", "dc.sentencing_commission"],
  [
    "district of columbia state athletics commission",
    "dc.district_of_columbia_state_athletics_commission_dcsac",
  ],
  ["district of columbia water and sewer authority", "dc.dc_water"],
  ["dlcp/opl", "dc.department_of_licensing_and_consumer_protection"],
  ["does", "dc.department_of_employment_services"],
  ["doh", "dc.dc_health"],
  ["financial literacy council", "dc.financial_literacy_council_flc"],
  [
    "fire and emergency medical services department",
    "dc.fire_and_emergency_medical_services",
  ],
  ["food policy council", "dc.food_policy_council_fpc"],
  ["green buildings advisory council", "dc.green_building_advisory_council_gbac"],
  ["health information exchange policy board", "dc.health_information_exchange_policy_board_hie"],
  ["historic preservation review board", "dc.historic_preservation_review_board_hprb"],
  ["housing finance agency", "dc.dc_housing_finance_agency"],
  ["inspector general", "dc.office_of_the_inspector_general"],
  ["judicial nomination commission", "dc.judicial_nomination_commission_jnc"],
  ["mayor's office of veterans affairs (mova)", "dc.mayor_s_office_of_veterans_affairs"],
  ["mayor", "dc.mayor"],
  ["national capital planning commission", "dc.national_capital_planning_commission_ncpc"],
  [
    "office of the attorney general for the district of columbia",
    "dc.office_of_the_attorney_general",
  ],
  [
    "office of the people’s counsel",
    "dc.office_of_the_people_s_counsel_for_the_district_of_columbia",
  ],
  [
    "office of lesbian, gay, bisexual, transgender, and questioning affairs",
    "dc.mayor_s_office_of_lesbian_gay_bisexual_transgender_and_questioning_affairs",
  ],
  ["office on returning citizen affairs", "dc.mayor_s_office_on_returning_citizen_affairs"],
  [
    "office on women’s policy and initiatives",
    "dc.mayor_s_office_on_women_s_policy_and_initiatives",
  ],
  ["pedestrian advisory council", "dc.pedestrian_advisory_council_pac"],
  ["real estate commission", "dc.real_estate_commission_rec"],
  ["rental housing commission", "dc.rental_housing_commission_rhc"],
  ["secretary of the district of columbia", "dc.office_of_the_secretary"],
  ["state rehabilitation council", "dc.state_rehabilitation_council_src"],
  ["statewide health coordinating council", "dc.statewide_health_coordinating_council_shcc"],
  ["statewide independent living council", "dc.statewide_independent_living_council_silc"],
  ["uniform law commission", "dc.uniform_law_commission_ulc"],
  [
    "washington convention center and sports authority (events dc)",
    "dc.washington_convention_and_sports_authority",
  ],
  ["washington metrorail safety commission", "dc.washington_metrorail_safety_commission_wmsc"],
]);
