import { recordPath, writeYamlFile } from "./io.ts";

type SeedRecord = { id: string; record_type: string; [key: string]: unknown };

export async function seedBaselineRecords(
  repoPath: string,
): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;
  for (const record of baselineRecords()) {
    const path = recordPath(repoPath, record as { id: string; record_type: never });
    try {
      await Deno.stat(path);
      existing++;
      continue;
    } catch {
      await writeYamlFile(path, record);
      created++;
    }
  }
  return { created, existing };
}

function baselineRecords(): SeedRecord[] {
  return [
    source("open_data_dc", "Open Data DC", "https://opendata.dc.gov/", "portal"),
    source(
      "dcgis.government_operations",
      "DCGIS Government Operations ArcGIS service",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer",
      "arcgis_service",
    ),
    source(
      "dcgis.agencies",
      "District Government Agencies table",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6",
      "arcgis_table",
    ),
    source(
      "dcgis.boards_commissions_councils",
      "District Boards, Commissions, and Councils table",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24",
      "arcgis_table",
    ),
    source("dc_law_library", "D.C. Law Library", "https://code.dccouncil.gov/", "legal_portal"),
    source("dc_code", "D.C. Code", "https://code.dccouncil.gov/us/dc/council/code", "legal_corpus"),
    source(
      "dcregs",
      "D.C. Register and DCMR",
      "https://dcregs.dc.gov/",
      "administrative_law_portal",
    ),
    source("council_lims", "Council LIMS", "https://lims.dccouncil.gov/", "legislative_system"),
    source(
      "council_hms",
      "Council HMS hearings",
      "https://lims.dccouncil.gov/hearings",
      "hearing_system",
    ),
    source(
      "council_hearings_page",
      "Council hearings page",
      "https://dccouncil.gov/hearings/",
      "publication_page",
    ),
    source(
      "council_oversight_budget_schedules",
      "Council oversight and budget schedules",
      "https://dccouncil.gov/2025-2026-performance-oversight-fy-2027-budget-schedules/",
      "publication_page",
    ),
    source(
      "dc_courts",
      "District of Columbia Courts",
      "https://www.dccourts.gov/",
      "publication_page",
    ),
    source(
      "ocfo_budget",
      "OCFO budget and capital plan publications",
      "https://cfo.dc.gov/budget",
      "publication_page",
    ),
    source(
      "ocfo_financial_reports",
      "OCFO annual financial reports",
      "https://cfo.dc.gov/service/annual-comprehensive-financial-reports-0",
      "publication_page",
    ),
    source(
      "boe_results",
      "DC Board of Elections results",
      "https://www.dcboe.org/Elections/Election-Results-Archives/",
      "publication_page",
    ),
    source(
      "boe_voter_statistics",
      "DC Board of Elections voter statistics",
      "https://www.dcboe.org/data%2C-maps%2C-forms/voter-registration-statistics",
      "publication_page",
    ),
    source(
      "boe_maps",
      "DC Board of Elections maps",
      "https://www.dcboe.org/data%2C-maps%2C-forms/maps",
      "publication_page",
    ),
    source(
      "anc_source",
      "Advisory Neighborhood Commission source materials",
      "https://anc.dc.gov/",
      "publication_page",
    ),
    source(
      "anc_resolutions",
      "ANC resolutions portal",
      "https://resolutions.anc.dc.gov/",
      "json_api_manifest",
    ),
    source(
      "enterprise_dataset_inventory",
      "Enterprise Dataset Inventory",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/11",
      "arcgis_metadata_table",
    ),
    source(
      "pass",
      "PASS procurement and payment data",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer",
      "arcgis_tables",
    ),
    source(
      "pass.purchase_orders",
      "PASS Purchase Orders",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/16",
      "arcgis_metadata_table",
    ),
    source(
      "pass.payments",
      "PASS Payments",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/17",
      "arcgis_metadata_table",
    ),
    source(
      "pass.forecast",
      "PASS Forecast",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/18",
      "arcgis_metadata_table",
    ),
    source(
      "pass.contracts",
      "PASS Contracts",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/37",
      "arcgis_metadata_table",
    ),
    source(
      "pass.solicitations",
      "PASS Solicitations",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/19",
      "arcgis_metadata_table",
    ),
    source(
      "pass.solicitation_attachments",
      "PASS Solicitations Attachments",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/20",
      "arcgis_metadata_table",
    ),
    source(
      "service_requests_311",
      "311 service requests",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/ServiceRequests/FeatureServer/21",
      "arcgis_metadata_layer",
    ),
    source(
      "crime_incidents",
      "Crime incidents",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/FeatureServer/41",
      "arcgis_metadata_layer",
    ),
    source(
      "building_permits",
      "Building permits",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/18",
      "arcgis_metadata_layer",
    ),
    source(
      "business_licenses",
      "Business licenses",
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer/0",
      "arcgis_metadata_table",
    ),
    source("scout", "SCOUT", "https://scout.dcra.dc.gov/", "ui_heavy_source"),
    source("propertyquest", "PropertyQuest", "https://propertyquest.dc.gov/", "ui_heavy_source"),

    legal(
      "home_rule_act",
      "District of Columbia Home Rule Act",
      "statutory",
      "congressional_review",
      ["dc_code"],
    ),
    legal("dc_code_legal_corpus", "D.C. Code", "statutory", "codified_statutory_law", ["dc_code"]),
    legal(
      "dcmr_legal_corpus",
      "District of Columbia Municipal Regulations",
      "administrative",
      "register_to_dcmr",
      ["dcregs"],
    ),
    legal(
      "dc_register",
      "District of Columbia Register",
      "administrative",
      "publication_to_codification",
      ["dcregs"],
    ),
    legal("council_rules", "Council rules", "procedural", "council_publication", ["council_lims"]),
    legal("anc_act", "Advisory Neighborhood Commissions Act", "statutory", "congressional_review", [
      "dc_code",
    ]),

    unit("dc.mayor", "Mayor of the District of Columbia", "elected_office", [
      "municipal",
      "state_equivalent",
    ], ["dc_code"]),
    unit("dc.council", "Council of the District of Columbia", "legislative_body", [
      "municipal",
      "state_equivalent",
    ], ["dc_code"]),
    unit("dc.attorney.general", "Attorney General for the District of Columbia", "elected_office", [
      "municipal",
      "state_equivalent",
    ], ["dc_code"]),
    unit("dc.courts", "District of Columbia Courts", "judicial_body", ["federalized_local"], [
      "dc_code",
      "dc_courts",
    ]),
    unit("dc.anc.system", "Advisory Neighborhood Commission system", "anc_system", [
      "neighborhood_advisory",
    ], ["anc_source", "dc_code"]),
    unit("district.voters", "District voters", "external_actor", ["federal_interface"], [
      "dc_code",
    ]),
    unit("us.congress", "United States Congress", "external_actor", ["federal_interface"], [
      "dc_code",
    ]),

    relationshipType("elects", "Actor elects an office or body."),
    relationshipType("appoints", "Actor appoints a civic unit, office, board member, or officer."),
    relationshipType("confirms", "Actor confirms a nomination or appointment."),
    relationshipType("oversees", "Actor oversees or exercises oversight over another civic unit."),
    relationshipType("publishes", "Actor publishes legal or administrative material."),
    relationshipType("codifies", "Actor codifies legal or administrative material."),
    relationshipType("advises", "Actor advises another civic unit or process."),
    relationshipType("gives_great_weight_to", "Actor gives great weight to ANC recommendations."),
    relationshipType("reviews", "Actor reviews a District law or action."),

    relationship(
      "district.voters.elect.dc.mayor",
      "District voters elect the Mayor",
      "elects",
      "district.voters",
      "dc.mayor",
    ),
    relationship(
      "district.voters.elect.dc.council",
      "District voters elect the Council",
      "elects",
      "district.voters",
      "dc.council",
    ),
    relationship(
      "us.congress.reviews.dc.legislation",
      "Congress reviews District legislation under Home Rule mechanics",
      "reviews",
      "us.congress",
      "dc.council",
    ),

    pipeline(
      "official_registry_refresh",
      "Fetch DCGIS registry snapshots, generate candidates, promote broad thin records.",
      ["dcgis.agencies", "dcgis.boards_commissions_councils"],
    ),
    pipeline(
      "legal_materials_manifest",
      "Track statutory and administrative legal source systems before deeper parsing.",
      ["dc_code", "dcregs"],
    ),
    pipeline(
      "publication_manifest_refresh",
      "Manifest OCFO, BOE, Council, and ANC publication pages before PDF/table parsing.",
      [
        "council_hearings_page",
        "council_oversight_budget_schedules",
        "dc_courts",
        "ocfo_budget",
        "ocfo_financial_reports",
        "boe_results",
        "boe_voter_statistics",
        "anc_source",
        "scout",
        "propertyquest",
      ],
    ),
    pipeline(
      "anc_resolutions_manifest_refresh",
      "Track ANC resolution metadata and attachment manifests.",
      ["anc_resolutions"],
    ),
    pipeline(
      "source_discovery_metadata_refresh",
      "Track source-discovery metadata from the Enterprise Dataset Inventory.",
      ["enterprise_dataset_inventory"],
    ),
    pipeline(
      "pass_metadata_refresh",
      "Track PASS procurement and payment table metadata before row-level ingestion.",
      [
        "pass.purchase_orders",
        "pass.payments",
        "pass.forecast",
        "pass.contracts",
        "pass.solicitations",
        "pass.solicitation_attachments",
      ],
    ),
    pipeline(
      "operational_metadata_refresh",
      "Track operational ArcGIS feed metadata before row-level ingestion.",
      ["service_requests_311", "crime_incidents", "building_permits", "business_licenses"],
    ),

    gap(
      "lims_api_documentation",
      "Council LIMS public API documentation is thin; discovered endpoints are snapshotted but should be periodically reverified.",
      ["council_lims"],
    ),
    gap(
      "scout_api_deferred",
      "SCOUT is a UI-heavy source; public/bulk API investigation is deferred.",
      ["scout"],
    ),
    gap(
      "propertyquest_api_deferred",
      "PropertyQuest is a UI-heavy source; public/bulk API investigation is deferred.",
      ["propertyquest"],
    ),
    gap(
      "legal_authority_crosswalk",
      "Legal authority strings from registry rows are preserved but not fully normalized.",
      ["dc_code", "dcgis.agencies"],
    ),
    gap(
      "current_officeholders_deferred",
      "Current officeholder people and tenures are intentionally deferred from the contract release.",
      ["boe_results"],
    ),
  ];
}

function source(id: string, name: string, official_url: string, source_type: string): SeedRecord {
  return { id, record_type: "source", name, official_url, source_type, status: "active" };
}

function legal(
  id: string,
  name: string,
  law_family: string,
  update_tracking_model: string,
  source_refs: string[],
): SeedRecord {
  return {
    id,
    record_type: "legal_material",
    name,
    law_family,
    update_tracking_model,
    status: "active",
    source_refs,
  };
}

function unit(
  id: string,
  name: string,
  unit_kind: string,
  operating_layers: string[],
  source_refs: string[],
): SeedRecord {
  return {
    id,
    record_type: "civic_unit",
    name,
    unit_kind,
    operating_layers,
    status: "active",
    source_refs,
  };
}

function relationshipType(id: string, definition: string): SeedRecord {
  return {
    id,
    record_type: "relationship_type",
    name: id.replaceAll("_", " "),
    definition,
    status: "active",
    source_refs: ["dc_code"],
  };
}

function relationship(
  id: string,
  name: string,
  relationship_type_id: string,
  sourceId: string,
  targetId: string,
): SeedRecord {
  return {
    id,
    record_type: "relationship",
    name,
    relationship_type_id,
    source_actor: { kind: "civic_unit", id: sourceId },
    target_actor: { kind: "civic_unit", id: targetId },
    status: "active",
    source_refs: ["dc_code"],
  };
}

function pipeline(id: string, name: string, source_refs: string[]): SeedRecord {
  return {
    id,
    record_type: "pipeline",
    name,
    update_strategy: name,
    status: "active",
    source_refs,
  };
}

function gap(id: string, description: string, source_refs: string[]): SeedRecord {
  return {
    id,
    record_type: "gap",
    name: id.replaceAll("_", " "),
    description,
    severity: "warning",
    release_relevant: true,
    status: "open",
    source_refs,
  };
}
