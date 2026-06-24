import { KindRegistry } from "../../core/kinds.ts";
import { dcAncKind } from "./kinds/anc.ts";
import { dcAgencyKind } from "./kinds/agency.ts";
import { dcBoardKind } from "./kinds/board.ts";
import { dcCommissionKind } from "./kinds/commission.ts";
import { dcCouncilKind } from "./kinds/council.ts";
import { dcAuthorityKind } from "./kinds/authority.ts";
import { dcAncCommissionerSeatKind } from "./kinds/anc_commissioner_seat.ts";
import { dcCourtKind } from "./kinds/court.ts";
import { dcCourtDivisionKind } from "./kinds/court_division.ts";
import { dcCourtSystemKind } from "./kinds/court_system.ts";
import { dcCouncilCommitteeKind } from "./kinds/council_committee.ts";
import { dcCouncilmemberKind } from "./kinds/councilmember.ts";
import { dcElectedOfficeKind } from "./kinds/elected_office.ts";
import { dcLegalAuthorityKind } from "./kinds/legal_authority.ts";
import { dcOfficeKind } from "./kinds/office.ts";
import { dcLegalSourceKind } from "./kinds/legal_source.ts";
import { dcSmdKind } from "./kinds/smd.ts";
import { dcWardKind } from "./kinds/ward.ts";
import {
  dcAffiliatedWithRelation,
  dcAuthorizedByRelation,
  dcChairsRelation,
  dcContainsRelation,
  dcGovernsRelation,
  dcHoldsRelation,
  dcMemberOfRelation,
  dcPartOfRelation,
  dcReportsToRelation,
  dcRepresentsRelation,
} from "./kinds/relation.ts";
import { interpretDcgisAgencies } from "./interpreters/dcgis_agencies.ts";
import { agencyDirectoryBinding } from "./sources/agency_directory.ts";
import { dcgisAgenciesBinding } from "./sources/dcgis_agencies.ts";
import { dcgisCommissionsBinding } from "./sources/dcgis_commissions.ts";
import { dcgisBoardsBinding } from "./sources/dcgis_boards.ts";
import { dcgisCouncilsBinding } from "./sources/dcgis_councils.ts";
import { dcgisAuthoritiesBinding } from "./sources/dcgis_authorities.ts";
import { dcgisAncsBinding } from "./sources/dcgis_ancs.ts";
import { dcgisSmdsBinding } from "./sources/dcgis_smds.ts";
import { dccouncilCommitteesBinding } from "./sources/dccouncil_committees.ts";
import { dccouncilMembersBinding } from "./sources/dccouncil_members.ts";
import { openDCPublicBodiesBinding } from "./sources/open_dc_public_bodies.ts";
import { begaStructureBinding } from "./sources/bega_structure.ts";
import { dccourtsStructureBinding } from "./sources/dccourts_structure.ts";
import { legalEntrypointsBinding } from "./sources/legal_entrypoints.ts";
import { mayorExecutiveStructureBinding } from "./sources/mayor_executive_structure.ts";
import { oancProfilesBinding } from "./sources/oanc_profiles.ts";
import { type DcInterpreterContext } from "./interpreters/context.ts";
import { type Revision } from "../../core/types.ts";
import type { PromotionPolicy } from "../../compiler/promotion.ts";
import { dcPromotionPolicy } from "./promotion.ts";
import type { SourceCoverageCatalogItem } from "../../export/export.ts";

export const dcJurisdiction = "dc";

export interface DcSourceBinding {
  source: {
    id: string;
    jurisdiction: string;
    type: string;
  };
  interpret: (
    records: Parameters<typeof interpretDcgisAgencies>[0],
    context?: DcInterpreterContext,
  ) => ReturnType<typeof interpretDcgisAgencies>;
}

export interface DcJurisdictionRuntime {
  jurisdiction: string;
  kinds: KindRegistry;
  sources: DcSourceBinding[];
  promotionPolicy: PromotionPolicy;
  sourceCoverage: SourceCoverageCatalogItem[];
  revisions: Revision[];
}

const dcKindRegistry = new KindRegistry();
dcKindRegistry.register(dcAncKind);
dcKindRegistry.register(dcAgencyKind);
dcKindRegistry.register(dcBoardKind);
dcKindRegistry.register(dcCommissionKind);
dcKindRegistry.register(dcCouncilKind);
dcKindRegistry.register(dcAuthorityKind);
dcKindRegistry.register(dcAncCommissionerSeatKind);
dcKindRegistry.register(dcCourtSystemKind);
dcKindRegistry.register(dcCourtKind);
dcKindRegistry.register(dcCourtDivisionKind);
dcKindRegistry.register(dcCouncilCommitteeKind);
dcKindRegistry.register(dcCouncilmemberKind);
dcKindRegistry.register(dcElectedOfficeKind);
dcKindRegistry.register(dcLegalAuthorityKind);
dcKindRegistry.register(dcOfficeKind);
dcKindRegistry.register(dcLegalSourceKind);
dcKindRegistry.register(dcSmdKind);
dcKindRegistry.register(dcWardKind);
dcKindRegistry.registerRelation(dcAuthorizedByRelation);
dcKindRegistry.registerRelation(dcChairsRelation);
dcKindRegistry.registerRelation(dcContainsRelation);
dcKindRegistry.registerRelation(dcAffiliatedWithRelation);
dcKindRegistry.registerRelation(dcGovernsRelation);
dcKindRegistry.registerRelation(dcHoldsRelation);
dcKindRegistry.registerRelation(dcMemberOfRelation);
dcKindRegistry.registerRelation(dcPartOfRelation);
dcKindRegistry.registerRelation(dcReportsToRelation);
dcKindRegistry.registerRelation(dcRepresentsRelation);

export const dcRuntime: DcJurisdictionRuntime = {
  jurisdiction: dcJurisdiction,
  kinds: dcKindRegistry,
  promotionPolicy: dcPromotionPolicy,
  sources: [
    dcgisAncsBinding,
    dcgisAgenciesBinding,
    agencyDirectoryBinding,
    dcgisBoardsBinding,
    dcgisCommissionsBinding,
    dcgisCouncilsBinding,
    dcgisAuthoritiesBinding,
    dcgisSmdsBinding,
    dccouncilMembersBinding,
    dccouncilCommitteesBinding,
    openDCPublicBodiesBinding,
    begaStructureBinding,
    dccourtsStructureBinding,
    legalEntrypointsBinding,
    mayorExecutiveStructureBinding,
    oancProfilesBinding,
  ],
  sourceCoverage: [
    {
      source: "dc.agency_directory",
      sourceType: "dc.agency_directory",
      family: "executive_agencies",
      publisher: "District of Columbia",
      accessMethod: "HTML directory page",
      sourceUrl: "https://dc.gov/page/agency-list",
      catalogConfidence: "high",
      scope: "Official DC agency list page at dc.gov.",
      contributes:
        "Source-backed official URLs for canonical dc.agency entries when directory rows resolve cleanly to the existing agency spine.",
      excludes:
        "Contacts, staff directories, program-only rows, logos/images, and unmatched rows that do not safely resolve to canonical agencies.",
      notes:
        "The page includes some clusters, campaigns, and program surfaces; this source enriches existing agencies and does not auto-create duplicate agency entries for unmatched rows.",
    },
    {
      source: "bega.structure",
      sourceType: "bega.structure",
      family: "institutional_structure",
      publisher: "Board of Ethics and Government Accountability",
      accessMethod: "HTML institution pages",
      sourceUrl: "https://bega.dc.gov/",
      catalogConfidence: "medium",
      scope:
        "Board of Ethics and Government Accountability, Office of Government Ethics, and Office of Open Government institutional structure pages.",
      contributes: "BEGA/OGE/OOG organization entries and source-backed part_of relations.",
      excludes: "Staff, contacts, forms, events, and broad ethics/legal databases.",
    },
    {
      source: "dccouncil.committees",
      sourceType: "dccouncil.committees",
      family: "council_structure",
      publisher: "Council of the District of Columbia",
      accessMethod: "HTML committee pages",
      sourceUrl: "https://dccouncil.gov/committees/",
      catalogConfidence: "high",
      scope: "Council committee pages and membership lists from official Council web pages.",
      contributes:
        "Council committee entries, chair relations, and committee membership relations.",
      excludes:
        "Legislation, hearing records, staff biographies, contacts, and committee document archives.",
    },
    {
      source: "dccouncil.members",
      sourceType: "dccouncil.members",
      family: "council_structure",
      publisher: "Council of the District of Columbia",
      accessMethod: "HTML roster/profile pages",
      sourceUrl: "https://dccouncil.gov/councilmembers/",
      catalogConfidence: "high",
      scope: "Official Councilmember roster/profile links.",
      contributes:
        "Councilmember entries, elected office nodes, and ward representation relations from official roster labels.",
      excludes:
        "Personal contact details, biographies beyond names/official profile URLs, newsletters, and campaign material.",
    },
    {
      source: "dccourts.structure",
      sourceType: "dccourts.structure",
      family: "judicial_structure",
      publisher: "District of Columbia Courts",
      accessMethod: "HTML court structure pages",
      sourceUrl: "https://www.dccourts.gov/",
      catalogConfidence: "medium",
      scope:
        "DC Courts home, Court of Appeals, Superior Court, and direct Superior Court division links.",
      contributes:
        "Court system, court, and court division entries with part_of relations, official URLs, and bounded source-backed descriptions.",
      excludes:
        "Case search, filings, calendars, judges/staff profiles, contacts, and legal advice.",
      notes:
        "Live collection from this environment currently returns HTTP 403, so the source falls back to a tracked official-structure seed rooted in dccourts.gov URLs until live collection is available again.",
    },
    {
      source: "dcgis.agencies",
      sourceType: "arcgis.table",
      family: "executive_agencies",
      publisher: "DCGIS / OCTO",
      accessMethod: "ArcGIS REST table",
      sourceUrl:
        "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6",
      catalogConfidence: "high",
      scope: "DCGIS agency table.",
      contributes:
        "Core agency entries, agency name lookup context for source-backed relation endpoint resolution, and authorized_by relations when explicit legal locators are present.",
      excludes: "Contacts, service directories, and non-agency program pages.",
    },
    {
      source: "dcgis.ancs",
      sourceType: "arcgis.table",
      family: "advisory_neighborhood_commissions",
      publisher: "DCGIS / OCTO",
      accessMethod: "ArcGIS REST table",
      sourceUrl:
        "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/54",
      catalogConfidence: "high",
      scope: "DCGIS ANC boundary/source table.",
      contributes: "ANC entries and identifiers used by SMD containment relations.",
      excludes: "Commissioner contact data, meeting details, and financial records.",
    },
    {
      source: "dcgis.authorities",
      sourceType: "arcgis.table",
      family: "public_bodies",
      publisher: "DCGIS / OCTO",
      accessMethod: "ArcGIS REST table",
      sourceUrl:
        "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24",
      catalogConfidence: "high",
      scope: "DCGIS Government Operations layer filtered to TYPE = 'Authority'.",
      contributes:
        "Authority entries, governing agency relations, and legal authority nodes/authorized_by relations when explicit locators are present.",
      excludes: "Boards, commissions, councils, contacts, and membership rosters.",
      notes:
        "Current live layer has no Authority rows; this is collected-empty source coverage, not a failed source.",
    },
    {
      source: "dcgis.boards",
      sourceType: "arcgis.table",
      family: "public_bodies",
      publisher: "DCGIS / OCTO",
      accessMethod: "ArcGIS REST table",
      sourceUrl:
        "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24",
      catalogConfidence: "high",
      scope: "DCGIS Government Operations layer filtered to TYPE = 'Board'.",
      contributes:
        "Board entries, governing agency relations, and legal authority nodes/authorized_by relations from explicit locators.",
      excludes: "Contacts, membership rosters, meeting details, and source-shadow merge decisions.",
    },
    {
      source: "dcgis.commissions",
      sourceType: "arcgis.table",
      family: "public_bodies",
      publisher: "DCGIS / OCTO",
      accessMethod: "ArcGIS REST table",
      sourceUrl:
        "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24",
      catalogConfidence: "high",
      scope: "DCGIS Government Operations layer filtered to TYPE = 'Commission'.",
      contributes:
        "Commission entries, governing agency relations, and legal authority nodes/authorized_by relations from explicit locators.",
      excludes: "Contacts, membership rosters, meeting details, and source-shadow merge decisions.",
    },
    {
      source: "dcgis.councils",
      sourceType: "arcgis.table",
      family: "public_bodies",
      publisher: "DCGIS / OCTO",
      accessMethod: "ArcGIS REST table",
      sourceUrl:
        "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24",
      catalogConfidence: "high",
      scope: "DCGIS Government Operations layer filtered to TYPE = 'Council'.",
      contributes:
        "Council entries, governing agency relations, and legal authority nodes/authorized_by relations from explicit locators.",
      excludes:
        "Council committees, Councilmember offices, contacts, membership rosters, and source-shadow merge decisions.",
    },
    {
      source: "dcgis.smds",
      sourceType: "arcgis.table",
      family: "advisory_neighborhood_commissions",
      publisher: "DCGIS / OCTO",
      accessMethod: "ArcGIS REST table",
      sourceUrl:
        "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/55",
      catalogConfidence: "high",
      scope: "DCGIS SMD boundary/source table.",
      contributes:
        "SMD entries, ANC containment relations, commissioner seat entries, and seat-to-SMD representation relations.",
      excludes:
        "Commissioner emails, phone numbers, addresses, meeting locations, and broad person profiles.",
    },
    {
      source: "legal.entrypoints",
      sourceType: "legal.entrypoints",
      family: "legal_provenance",
      publisher: "District of Columbia",
      accessMethod: "HTML legal entrypoint page",
      sourceUrl: "https://dc.gov/page/laws-regulations-and-courts",
      catalogConfidence: "high",
      scope:
        "Official legal entrypoint anchors for Code, Register/DCMR, laws/regulations/courts, and Mayor's Orders.",
      contributes: "Legal source anchor entries for provenance and inspection.",
      excludes:
        "Full legal databases, section/rule/order entities, legal interpretation, and completeness claims.",
    },
    {
      source: "mayor.executive_structure",
      sourceType: "mayor.executive_structure",
      family: "executive_structure",
      publisher: "Executive Office of the Mayor",
      accessMethod: "HTML organization pages",
      sourceUrl:
        "https://mayor.dc.gov/page/organizational-charts-agencies-and-offices-under-mayors-authority",
      catalogConfidence: "medium",
      scope: "Official Mayor/DC.gov executive branch and organizational-chart pages.",
      contributes:
        "Mayor/EOM office entries plus part_of and reports_to relations where source-backed.",
      excludes:
        "Staff biographies, initiatives, programs, events, contacts, stale successor choices, and silent agency merges.",
    },
    {
      source: "oanc.profiles",
      sourceType: "oanc.profiles",
      family: "advisory_neighborhood_commissions",
      publisher: "Office of Advisory Neighborhood Commissions",
      accessMethod: "HTML ANC profile pages",
      sourceUrl: "https://oanc.dc.gov/landing-page/ancs-ward",
      catalogConfidence: "high",
      scope: "Official OANC ANC index and profile pages.",
      contributes:
        "ANC profile URLs, represented-neighborhood summaries, and ward-to-ANC containment relations where conservatively extractable.",
      excludes:
        "Emails, phones, physical addresses, meeting locations, financial document details, commissioner contact fields, and broad person records.",
    },
    {
      source: "open_dc.public_bodies",
      sourceType: "open_dc.public_bodies",
      family: "public_bodies",
      publisher: "District of Columbia Open Government / Open DC",
      accessMethod: "HTML index and detail pages",
      sourceUrl: "https://www.open-dc.gov/public-bodies",
      catalogConfidence: "high",
      scope: "Open DC public body index/detail pages.",
      contributes:
        "Public body entries, legal authority nodes/authorized_by relations from explicit enabling locators, duplicate/source-shadow signals, and governing/administering relation candidates.",
      excludes:
        "Contacts, member lists, meeting pages, local file links, event-title authority noise, and automatic duplicate merges.",
    },
    {
      source: "inventory.open_data_catalog",
      sourceType: "inventory.backlog",
      family: "source_inventory",
      publisher: "Office of the Chief Technology Officer / District of Columbia",
      accessMethod: "ArcGIS Hub catalog",
      sourceUrl: "https://opendata.dc.gov/",
      catalogConfidence: "high",
      scope: "Open Data DC and District dataset catalog surfaces beyond the wired DCGIS layers.",
      contributes:
        "Contract-visible inventory row only; no alpha reader or ledger facts are emitted from this category.",
      excludes:
        "Dataset import, schema normalization, portal metadata completeness, and automated dataset freshness checks.",
      notes: "Inventoried-only backlog category from the original contract source list.",
    },
    {
      source: "inventory.administrative_datasets",
      sourceType: "inventory.backlog",
      family: "administrative_datasets",
      publisher: "Office of the Chief Technology Officer / District agencies",
      accessMethod: "Open Data DC catalog and agency data portals",
      sourceUrl: "https://opendata.dc.gov/",
      catalogConfidence: "medium",
      scope:
        "Administrative, operational, service, and agency dataset surfaces beyond named alpha civic-structure sources.",
      contributes:
        "Contract-visible inventory row only; no alpha administrative-dataset reader or ledger facts are wired.",
      excludes:
        "Dataset import, schema normalization, operational record ingestion, service-request records, and automated dataset freshness checks.",
      notes:
        "Inventoried-only backlog category from the original contract source list; separate from the broader Open Data catalog row so administrative datasets remain visible as a contract category.",
    },
    {
      source: "inventory.budget_finance",
      sourceType: "inventory.backlog",
      family: "budget_finance",
      publisher: "Office of the Chief Financial Officer / District of Columbia",
      accessMethod: "HTML publications and financial transparency portals",
      sourceUrl: "https://cfo.dc.gov/budget",
      catalogConfidence: "high",
      scope: "Budget, finance, Open Budget, and Open Checkbook public portals.",
      contributes: "Contract-visible inventory row only; no alpha budget/spending reader is wired.",
      excludes:
        "Budget documents, expenditure transactions, grants, vendor payments, and fiscal relationships.",
      notes: "Inventoried-only backlog category from the original contract source list.",
    },
    {
      source: "inventory.procurement_contracting",
      sourceType: "inventory.backlog",
      family: "procurement_contracting",
      publisher: "Office of Contracting and Procurement",
      accessMethod: "HTML source index and procurement portal",
      sourceUrl: "https://ocp.dc.gov/page/doing-business-dc-government",
      catalogConfidence: "high",
      scope: "DC procurement, contracting, solicitation, and vendor-facing portals.",
      contributes: "Contract-visible inventory row only; no alpha procurement reader is wired.",
      excludes:
        "Solicitation records, awards, vendor profiles, contract amounts, and procurement relationships.",
      notes: "Inventoried-only backlog category from the original contract source list.",
    },
    {
      source: "inventory.permits_licenses",
      sourceType: "inventory.backlog",
      family: "permits_licenses",
      publisher: "DCGIS / District agencies",
      accessMethod: "ArcGIS REST service and public search portals",
      sourceUrl:
        "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer",
      catalogConfidence: "high",
      scope: "Permits, licenses, inspections, and SCOUT-style public regulatory portals.",
      contributes: "Contract-visible inventory row only; no alpha permit/license reader is wired.",
      excludes:
        "Permit applications, inspections, licensed-business records, enforcement actions, and contact data.",
      notes: "Inventoried-only backlog category from the original contract source list.",
    },
    {
      source: "inventory.property_land",
      sourceType: "inventory.backlog",
      family: "property_land",
      publisher: "DCGIS / District property agencies",
      accessMethod: "ArcGIS REST service and public search portals",
      sourceUrl:
        "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer",
      catalogConfidence: "high",
      scope: "Property, land, real-property, OTR, and PropertyQuest-style public portals.",
      contributes: "Contract-visible inventory row only; no alpha property/land reader is wired.",
      excludes:
        "Parcel records, ownership/tax records, assessments, maps, and property transactions.",
      notes: "Inventoried-only backlog category from the original contract source list.",
    },
    {
      source: "inventory.public_safety_crime",
      sourceType: "inventory.backlog",
      family: "public_safety",
      publisher: "DCGIS / public safety agencies",
      accessMethod: "ArcGIS REST service and public dashboards",
      sourceUrl:
        "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer",
      catalogConfidence: "high",
      scope: "Public safety, crime cards, incident, and emergency/public-safety data portals.",
      contributes: "Contract-visible inventory row only; no alpha public-safety reader is wired.",
      excludes:
        "Incident records, police/fire/EMS operational data, personally identifying details, and public-safety analytics.",
      notes: "Inventoried-only backlog category from the original contract source list.",
    },
    {
      source: "inventory.elections",
      sourceType: "inventory.backlog",
      family: "elections",
      publisher: "DC Board of Elections / DCGIS",
      accessMethod: "HTML election pages and ArcGIS REST layers",
      sourceUrl: "https://dcboe.org/",
      catalogConfidence: "high",
      scope: "Board of Elections, election results, precinct, district, and election GIS layers.",
      contributes: "Contract-visible inventory row only; no alpha election reader is wired.",
      excludes:
        "Election results, candidate/campaign data, voter data, precinct histories, and campaign finance.",
      notes: "Inventoried-only backlog category from the original contract source list.",
    },
    {
      source: "inventory.legislation_lims",
      sourceType: "inventory.backlog",
      family: "legislative_data",
      publisher: "Council of the District of Columbia",
      accessMethod: "LIMS web app / JSON endpoints",
      sourceUrl: "https://lims.dccouncil.gov/",
      catalogConfidence: "high",
      scope: "Council legislation and LIMS bill, hearing, vote, and legislative-history surfaces.",
      contributes:
        "Contract-visible inventory row only; no alpha legislation/LIMS reader is wired.",
      excludes:
        "Bills, votes, hearings, transcripts, legislative histories, and inferred policy relationships.",
      notes: "Inventoried-only backlog category from the original contract source list.",
    },
    {
      source: "inventory.dc_laws",
      sourceType: "inventory.backlog",
      family: "legal_provenance",
      publisher: "D.C. Law Library / Council of the District of Columbia",
      accessMethod: "Official law corpus website / bulk files",
      sourceUrl: "https://code.dccouncil.gov/dclaws",
      catalogConfidence: "high",
      scope: "D.C. laws codified in the D.C. Code and grouped by Council period.",
      contributes:
        "Contract-visible legal-source inventory row only; alpha authority entries remain limited to explicit supported D.C. Law locators already found in source-derived citations.",
      excludes:
        "Full law text ingestion, legislative history, legal interpretation, and uncodified LIMS material.",
      notes: "Inventoried-only legal publication family from the original contract source list.",
    },
    {
      source: "inventory.federal_laws_codified",
      sourceType: "inventory.backlog",
      family: "legal_provenance",
      publisher: "D.C. Law Library",
      accessMethod: "Official federal-law corpus website / bulk files",
      sourceUrl: "https://code.dccouncil.gov/usc",
      catalogConfidence: "high",
      scope: "Federal laws codified in the D.C. Code corpus.",
      contributes:
        "Contract-visible legal-source inventory row for federal/DC hybrid authority context.",
      excludes:
        "Full federal-law ingestion, constitutional analysis, legal interpretation, and authority promotion outside supported alpha locators.",
      notes: "Inventoried-only legal publication family from the original contract source list.",
    },
    {
      source: "inventory.dcmr",
      sourceType: "inventory.backlog",
      family: "legal_provenance",
      publisher: "Office of Documents and Administrative Issuances",
      accessMethod: "DCRegs website",
      sourceUrl: "https://dcregs.dc.gov/",
      catalogConfidence: "high",
      scope: "District of Columbia Municipal Regulations administrative-law corpus.",
      contributes:
        "Contract-visible legal-source inventory row for administrative rules and implementation context.",
      excludes:
        "Full regulation text ingestion, agency procedure modeling, legal interpretation, and regulatory enforcement relationships.",
      notes: "Inventoried-only legal publication family from the original contract source list.",
    },
    {
      source: "inventory.dcr",
      sourceType: "inventory.backlog",
      family: "legal_provenance",
      publisher: "Office of Documents and Administrative Issuances",
      accessMethod: "DCRegs website",
      sourceUrl: "https://dcregs.dc.gov/",
      catalogConfidence: "high",
      scope: "District of Columbia Register notices, rulemakings, and official publications.",
      contributes:
        "Contract-visible legal-source inventory row for administrative process and notice history.",
      excludes:
        "Register issue ingestion, notice-to-rule mapping, legal interpretation, and automated rulemaking timelines.",
      notes: "Inventoried-only legal publication family from the original contract source list.",
    },
    {
      source: "inventory.mayors_orders",
      sourceType: "inventory.backlog",
      family: "legal_provenance",
      publisher: "Executive Office of the Mayor / Office of Documents",
      accessMethod: "Mayor/DCRegs order publication pages",
      sourceUrl: "https://mayor.dc.gov/page/mayors-orders",
      catalogConfidence: "high",
      scope:
        "Mayor's Orders used for executive directives, delegations, appointments, and reorganizations.",
      contributes:
        "Contract-visible legal-source inventory row; alpha authority entries remain limited to explicit Mayor's Order locators already found in citations.",
      excludes:
        "Full order text ingestion, appointment modeling, delegation analysis, and inferred executive powers.",
      notes: "Inventoried-only legal publication family from the original contract source list.",
    },
    {
      source: "inventory.mayors_memoranda",
      sourceType: "inventory.backlog",
      family: "legal_provenance",
      publisher: "Executive Office of the Mayor / Office of Documents",
      accessMethod: "DCRegs publication surfaces",
      sourceUrl: "https://dcregs.dc.gov/",
      catalogConfidence: "medium",
      scope: "Mayor's Memoranda and related executive administrative publications.",
      contributes:
        "Contract-visible legal-source inventory row for executive administrative context.",
      excludes:
        "Full memorandum text ingestion, legal interpretation, and treating memoranda as equivalent to statutes or regulations.",
      notes: "Inventoried-only legal publication family from the original contract source list.",
    },
    {
      source: "inventory.oah",
      sourceType: "inventory.backlog",
      family: "legal_provenance",
      publisher: "Office of Administrative Hearings",
      accessMethod: "Official agency website",
      sourceUrl: "https://oah.dc.gov/",
      catalogConfidence: "medium",
      scope: "Office of Administrative Hearings public information and adjudication context.",
      contributes:
        "Contract-visible legal-source inventory row for administrative adjudication and enforcement architecture.",
      excludes:
        "Case record scraping, decision corpus ingestion, legal advice, and complete enforcement workflows.",
      notes: "Inventoried-only legal institution family from the original contract source list.",
    },
    {
      source: "inventory.oag",
      sourceType: "inventory.backlog",
      family: "legal_provenance",
      publisher: "Office of the Attorney General for the District of Columbia",
      accessMethod: "Official agency website",
      sourceUrl: "https://oag.dc.gov/",
      catalogConfidence: "medium",
      scope: "Office of the Attorney General public legal resources and enforcement context.",
      contributes:
        "Contract-visible legal-source inventory row for legal office and public enforcement context.",
      excludes:
        "Litigation corpus ingestion, consumer complaint data, legal advice, and statutory-power inference.",
      notes: "Inventoried-only legal institution family from the original contract source list.",
    },
    {
      source: "inventory.dc_courts_legal",
      sourceType: "inventory.backlog",
      family: "legal_provenance",
      publisher: "District of Columbia Courts",
      accessMethod: "Official court website",
      sourceUrl: "https://www.dccourts.gov/",
      catalogConfidence: "medium",
      scope: "D.C. Courts legal/court publication surfaces beyond alpha court structure entries.",
      contributes:
        "Contract-visible legal-source inventory row for court rules, opinions, records surfaces, and judicial context.",
      excludes:
        "Case record scraping, opinions corpus ingestion, court-rule completeness, and legal advice.",
      notes:
        "Separate from the collected dccourts.structure entity source; this row marks broader legal/court materials as backlog.",
    },
    {
      source: "inventory.home_rule_act",
      sourceType: "inventory.backlog",
      family: "legal_provenance",
      publisher: "D.C. Law Library",
      accessMethod: "Official Code website",
      sourceUrl: "https://code.dccouncil.gov/us/dc/council/code/titles/1/chapters/2",
      catalogConfidence: "high",
      scope:
        "District of Columbia Home Rule Act framework for Mayor/Council local authority and federal oversight context.",
      contributes:
        "Contract-visible legal-source inventory row for the federal-district framework and city/county caveats.",
      excludes:
        "Constitutional analysis, complete charter modeling, and inferred authority relationships.",
      notes: "Inventoried-only legal framework family from the original contract source list.",
    },
    {
      source: "inventory.mota_quickbase",
      sourceType: "inventory.backlog",
      family: "public_bodies",
      publisher: "Mayor's Office of Talent and Appointments / OCTO Quickbase",
      accessMethod: "Quickbase report / CSV surface",
      sourceUrl: "https://octo.quickbase.com/db/bjngwr9pe",
      catalogConfidence: "medium",
      scope: "MOTA Quickbase public-body/membership-style surface referenced by the old packet.",
      contributes:
        "Contract-visible inventory row only; not used for alpha state because of contact/person-data boundaries.",
      excludes:
        "Member/contact details, personal profiles, phone/email fields, and automatic public-body merges.",
      notes:
        "Inventoried-only backlog category; only revisit if it improves entity correctness without turning the ledger into a contact warehouse.",
    },
  ],
  revisions: [],
};
