export interface ArcgisTableSource extends SourceEvidenceMetadata {
  id: string;
  family: string;
  kind: "arcgis_table";
  title: string;
  url: string;
  table_name: string;
}

export interface ArcgisMetadataSource extends SourceEvidenceMetadata {
  id: string;
  family: string;
  kind: "arcgis_metadata";
  title: string;
  url: string;
  table_name: string;
}

export interface PageManifestSource extends SourceEvidenceMetadata {
  id: string;
  family: string;
  kind: "page_manifest";
  title: string;
  url: string;
}

export interface JsonApiEndpoint {
  id: string;
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
}

export interface JsonApiManifestSource extends SourceEvidenceMetadata {
  id: string;
  family: string;
  kind: "json_api_manifest";
  title: string;
  url: string;
  endpoints: JsonApiEndpoint[];
}

export type SourceEvidenceDepth =
  | "row-backed"
  | "metadata-only"
  | "page-manifest"
  | "endpoint-manifest";

interface SourceEvidenceMetadata {
  evidence_depth?: SourceEvidenceDepth;
  claim_scope?: string;
}

export type SourceDefinition =
  | ArcgisTableSource
  | ArcgisMetadataSource
  | PageManifestSource
  | JsonApiManifestSource;

export function sourceEvidenceDepth(
  definition?: Pick<SourceDefinition, "kind"> & SourceEvidenceMetadata,
): SourceEvidenceDepth {
  if (definition?.evidence_depth) return definition.evidence_depth;
  switch (definition?.kind) {
    case "arcgis_table":
      return "row-backed";
    case "arcgis_metadata":
      return "metadata-only";
    case "page_manifest":
      return "page-manifest";
    case "json_api_manifest":
      return "endpoint-manifest";
    default:
      return "page-manifest";
  }
}

export function sourceClaimScope(
  definition?: Pick<SourceDefinition, "kind"> & SourceEvidenceMetadata,
): string {
  if (definition?.claim_scope) return definition.claim_scope;
  switch (definition?.kind) {
    case "arcgis_table":
      return "rows, fields, and row counts";
    case "arcgis_metadata":
      return "fields and row counts only";
    case "page_manifest":
      return "links, assets, and page title only";
    case "json_api_manifest":
      return "endpoint ids, methods, and sample counts only";
    default:
      return "page-level or manifest-level evidence only";
  }
}

export const tier1SourceIds = [
  "dcgis.agencies",
  "dcgis.boards_commissions_councils",
  "enterprise_dataset_inventory",
  "dc_code",
  "dc_law_library",
  "dc_government_directories",
  "open_dc_public_bodies",
  "ocp_transparency_portal",
  "dcregs",
  "council_lims",
  "council_hms",
  "council_hearings_page",
  "council_oversight_budget_schedules",
  "dc_courts",
  "ocfo_budget",
  "ocfo_financial_reports",
  "boe_results",
  "boe_voter_statistics",
  "boe_maps",
  "anc_source",
  "anc_resolutions",
  "pass.purchase_orders",
  "pass.payments",
  "pass.forecast",
  "pass.contracts",
  "pass.solicitations",
  "pass.solicitation_attachments",
  "service_requests_311",
  "crime_incidents",
  "building_permits",
  "business_licenses",
  "scout",
  "propertyquest",
];

export const sourceDefinitions: Record<string, SourceDefinition> = {
  "dcgis.agencies": {
    id: "dcgis.agencies",
    family: "dcgis",
    kind: "arcgis_table",
    title: "District Government Agencies",
    table_name: "government_operations.agencies",
    url:
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6",
  },
  "dcgis.boards_commissions_councils": {
    id: "dcgis.boards_commissions_councils",
    family: "dcgis",
    kind: "arcgis_table",
    title: "District Boards, Commissions, and Councils",
    table_name: "government_operations.boards_commissions_councils",
    url:
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24",
  },
  "enterprise_dataset_inventory": {
    id: "enterprise_dataset_inventory",
    family: "dcgis",
    kind: "arcgis_metadata",
    title: "Enterprise Dataset Inventory",
    table_name: "government_operations.enterprise_dataset_inventory_2025",
    url:
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/11",
  },
  "dc_code": {
    id: "dc_code",
    family: "law_library",
    kind: "page_manifest",
    title: "D.C. Code",
    url: "https://code.dccouncil.gov/us/dc/council/code",
  },
  "dc_law_library": {
    id: "dc_law_library",
    family: "law_library",
    kind: "page_manifest",
    title: "D.C. Law Library",
    url: "https://code.dccouncil.gov/",
  },
  "dc_government_directories": {
    id: "dc_government_directories",
    family: "directory",
    kind: "page_manifest",
    title: "District Government Directories",
    url: "https://dc.gov/page/district-government-directories",
    claim_scope: "directory front door, searchable agency and office surface",
    evidence_depth: "page-manifest",
  },
  "open_dc_public_bodies": {
    id: "open_dc_public_bodies",
    family: "open_dc",
    kind: "page_manifest",
    title: "Open DC Public Bodies",
    url: "https://www.open-dc.gov/public-bodies",
    claim_scope: "public-bodies front door and accountability surface",
    evidence_depth: "page-manifest",
  },
  "ocp_transparency_portal": {
    id: "ocp_transparency_portal",
    family: "ocp",
    kind: "page_manifest",
    title: "OCP Contracts and Procurement Transparency Portal",
    url: "https://contracts.ocp.dc.gov/",
    claim_scope: "procurement front door and portal navigation surface",
    evidence_depth: "page-manifest",
  },
  "dcregs": {
    id: "dcregs",
    family: "dcregs",
    kind: "page_manifest",
    title: "D.C. Register and DCMR",
    url: "https://dcregs.dc.gov/",
  },
  "council_lims": {
    id: "council_lims",
    family: "council",
    kind: "json_api_manifest",
    title: "Council LIMS",
    url: "https://lims.dccouncil.gov/",
    endpoints: [
      {
        id: "search_master",
        url: "https://lims.dccouncil.gov/api/Search/GetSearchMaster",
      },
      {
        id: "whats_new",
        url: "https://lims.dccouncil.gov/api/Search/GetWhatsNew",
      },
      {
        id: "trending",
        url: "https://lims.dccouncil.gov/api/Search/GetTrendingList",
      },
    ],
  },
  "council_hms": {
    id: "council_hms",
    family: "council",
    kind: "json_api_manifest",
    title: "Council HMS hearings",
    url: "https://lims.dccouncil.gov/hearings",
    endpoints: [
      {
        id: "upcoming_hearings",
        url: "https://lims.dccouncil.gov/Hearings/API/Public/GetUpcomingHearings",
        method: "POST",
        body: {},
      },
      {
        id: "hearings_calendar",
        url: "https://lims.dccouncil.gov/Hearings/API/Public/GetHearingsCalendar",
        method: "POST",
        body: { SearchText: "" },
      },
    ],
  },
  "council_hearings_page": {
    id: "council_hearings_page",
    family: "council",
    kind: "page_manifest",
    title: "Council hearings page",
    url: "https://dccouncil.gov/hearings/",
  },
  "council_oversight_budget_schedules": {
    id: "council_oversight_budget_schedules",
    family: "council",
    kind: "page_manifest",
    title: "Council oversight and budget schedules",
    url: "https://dccouncil.gov/2025-2026-performance-oversight-fy-2027-budget-schedules/",
  },
  "dc_courts": {
    id: "dc_courts",
    family: "courts",
    kind: "page_manifest",
    title: "District of Columbia Courts",
    url: "https://www.dccourts.gov/",
  },
  "ocfo_budget": {
    id: "ocfo_budget",
    family: "ocfo",
    kind: "page_manifest",
    title: "OCFO budget and capital plan publications",
    url: "https://cfo.dc.gov/budget",
  },
  "ocfo_financial_reports": {
    id: "ocfo_financial_reports",
    family: "ocfo",
    kind: "page_manifest",
    title: "OCFO annual financial reports",
    url: "https://cfo.dc.gov/service/annual-comprehensive-financial-reports-0",
  },
  "boe_results": {
    id: "boe_results",
    family: "boe",
    kind: "page_manifest",
    title: "DC Board of Elections results",
    url: "https://www.dcboe.org/Elections/Election-Results-Archives/",
  },
  "boe_voter_statistics": {
    id: "boe_voter_statistics",
    family: "boe",
    kind: "page_manifest",
    title: "DC Board of Elections voter statistics",
    url: "https://www.dcboe.org/data%2C-maps%2C-forms/voter-registration-statistics",
  },
  "boe_maps": {
    id: "boe_maps",
    family: "boe",
    kind: "page_manifest",
    title: "DC Board of Elections maps",
    url: "https://www.dcboe.org/data%2C-maps%2C-forms/maps",
  },
  "anc_source": {
    id: "anc_source",
    family: "anc",
    kind: "page_manifest",
    title: "Advisory Neighborhood Commission source materials",
    url: "https://anc.dc.gov/",
  },
  "anc_resolutions": {
    id: "anc_resolutions",
    family: "anc",
    kind: "json_api_manifest",
    title: "ANC resolutions portal",
    url: "https://resolutions.anc.dc.gov/",
    endpoints: [
      {
        id: "default_resolution_list",
        url: "https://resolutions.anc.dc.gov/WSMethods_Documents.aspx/GetDocuments",
        method: "POST",
        body: {
          wardsIds: "",
          ancIds: "",
          searchFromDate: "",
          searchToDate: "",
        },
      },
    ],
  },
  "pass.purchase_orders": {
    id: "pass.purchase_orders",
    family: "pass",
    kind: "arcgis_metadata",
    title: "PASS Purchase Orders",
    table_name: "government_operations.pass_purchase_orders",
    url:
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/16",
  },
  "pass.payments": {
    id: "pass.payments",
    family: "pass",
    kind: "arcgis_metadata",
    title: "PASS Payments",
    table_name: "government_operations.pass_payments",
    url:
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/17",
  },
  "pass.forecast": {
    id: "pass.forecast",
    family: "pass",
    kind: "arcgis_metadata",
    title: "PASS Forecast",
    table_name: "government_operations.pass_forecast",
    url:
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/18",
  },
  "pass.contracts": {
    id: "pass.contracts",
    family: "pass",
    kind: "arcgis_metadata",
    title: "PASS Contracts",
    table_name: "government_operations.pass_contracts",
    url:
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/37",
  },
  "pass.solicitations": {
    id: "pass.solicitations",
    family: "pass",
    kind: "arcgis_metadata",
    title: "PASS Solicitations",
    table_name: "government_operations.pass_solicitations",
    url:
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/19",
  },
  "pass.solicitation_attachments": {
    id: "pass.solicitation_attachments",
    family: "pass",
    kind: "arcgis_metadata",
    title: "PASS Solicitations Attachments",
    table_name: "government_operations.pass_solicitation_attachments",
    url:
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/20",
  },
  "service_requests_311": {
    id: "service_requests_311",
    family: "operations",
    kind: "arcgis_metadata",
    title: "311 service requests",
    table_name: "service_requests.2026",
    url:
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/ServiceRequests/FeatureServer/21",
  },
  "crime_incidents": {
    id: "crime_incidents",
    family: "operations",
    kind: "arcgis_metadata",
    title: "Crime incidents",
    table_name: "mpd.crime_incidents_2026",
    url: "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/FeatureServer/41",
  },
  "building_permits": {
    id: "building_permits",
    family: "operations",
    kind: "arcgis_metadata",
    title: "Building permits",
    table_name: "dcra.building_permits_2026",
    url: "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/18",
  },
  "business_licenses": {
    id: "business_licenses",
    family: "operations",
    kind: "arcgis_metadata",
    title: "Business licenses",
    table_name: "dcra.basic_business_license",
    url: "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/0",
  },
  "scout": {
    id: "scout",
    family: "property",
    kind: "page_manifest",
    title: "SCOUT",
    url: "https://scout.dcra.dc.gov/",
  },
  "propertyquest": {
    id: "propertyquest",
    family: "property",
    kind: "page_manifest",
    title: "PropertyQuest",
    url: "https://propertyquest.dc.gov/",
  },
};
