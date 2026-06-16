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
import { dcOfficeKind } from "./kinds/office.ts";
import { dcLegalSourceKind } from "./kinds/legal_source.ts";
import { dcSmdKind } from "./kinds/smd.ts";
import {
  dcAffiliatedWithRelation,
  dcChairsRelation,
  dcContainsRelation,
  dcGovernsRelation,
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
dcKindRegistry.register(dcOfficeKind);
dcKindRegistry.register(dcLegalSourceKind);
dcKindRegistry.register(dcSmdKind);
dcKindRegistry.registerRelation(dcChairsRelation);
dcKindRegistry.registerRelation(dcContainsRelation);
dcKindRegistry.registerRelation(dcAffiliatedWithRelation);
dcKindRegistry.registerRelation(dcGovernsRelation);
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
      scope:
        "Board of Ethics and Government Accountability, Office of Government Ethics, and Office of Open Government institutional structure pages.",
      contributes: "BEGA/OGE/OOG organization entries and source-backed part_of relations.",
      excludes: "Staff, contacts, forms, events, and broad ethics/legal databases.",
    },
    {
      source: "dccouncil.committees",
      sourceType: "dccouncil.committees",
      family: "council_structure",
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
      scope: "Official Councilmember roster/profile links.",
      contributes: "Councilmember entries used by committee membership and chair relations.",
      excludes:
        "Personal contact details, biographies beyond names/official profile URLs, newsletters, and campaign material.",
    },
    {
      source: "dccourts.structure",
      sourceType: "dccourts.structure",
      family: "judicial_structure",
      scope:
        "DC Courts home, Court of Appeals, Superior Court, and direct Superior Court division links.",
      contributes:
        "Court system, court, and court division entries with part_of relations when collected.",
      excludes:
        "Case search, filings, calendars, judges/staff profiles, contacts, and legal advice.",
      notes:
        "Live collection from this environment has returned HTTP 403; fixture and CLI coverage exist, but current committed state has no live courts records.",
    },
    {
      source: "dcgis.agencies",
      sourceType: "arcgis.table",
      family: "executive_agencies",
      scope: "DCGIS agency table.",
      contributes:
        "Core agency entries and agency name lookup context for source-backed relation endpoint resolution.",
      excludes: "Contacts, service directories, and non-agency program pages.",
    },
    {
      source: "dcgis.ancs",
      sourceType: "arcgis.table",
      family: "advisory_neighborhood_commissions",
      scope: "DCGIS ANC boundary/source table.",
      contributes: "ANC entries and identifiers used by SMD containment relations.",
      excludes: "Commissioner contact data, meeting details, and financial records.",
    },
    {
      source: "dcgis.authorities",
      sourceType: "arcgis.table",
      family: "public_bodies",
      scope: "DCGIS Government Operations layer filtered to TYPE = 'Authority'.",
      contributes: "Authority entries and governance relations when live rows exist.",
      excludes: "Boards, commissions, councils, contacts, and membership rosters.",
      notes:
        "Current live layer has no Authority rows; this is collected-empty source coverage, not a failed source.",
    },
    {
      source: "dcgis.boards",
      sourceType: "arcgis.table",
      family: "public_bodies",
      scope: "DCGIS Government Operations layer filtered to TYPE = 'Board'.",
      contributes: "Board entries, governing agency relations, and legal/provenance citations.",
      excludes: "Contacts, membership rosters, meeting details, and source-shadow merge decisions.",
    },
    {
      source: "dcgis.commissions",
      sourceType: "arcgis.table",
      family: "public_bodies",
      scope: "DCGIS Government Operations layer filtered to TYPE = 'Commission'.",
      contributes:
        "Commission entries, governing agency relations, and legal/provenance citations.",
      excludes: "Contacts, membership rosters, meeting details, and source-shadow merge decisions.",
    },
    {
      source: "dcgis.councils",
      sourceType: "arcgis.table",
      family: "public_bodies",
      scope: "DCGIS Government Operations layer filtered to TYPE = 'Council'.",
      contributes: "Council entries, governing agency relations, and legal/provenance citations.",
      excludes:
        "Council committees, Councilmember offices, contacts, membership rosters, and source-shadow merge decisions.",
    },
    {
      source: "dcgis.smds",
      sourceType: "arcgis.table",
      family: "advisory_neighborhood_commissions",
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
      scope: "Official OANC ANC index and profile pages.",
      contributes:
        "ANC profile URLs and represented-neighborhood summaries where conservatively extractable.",
      excludes:
        "Emails, phones, physical addresses, meeting locations, financial document details, commissioner contact fields, and broad person records.",
    },
    {
      source: "open_dc.public_bodies",
      sourceType: "open_dc.public_bodies",
      family: "public_bodies",
      scope: "Open DC public body index/detail pages.",
      contributes:
        "Public body entries, legal/provenance citations, duplicate/source-shadow signals, and governing/administering relation candidates.",
      excludes:
        "Contacts, member lists, meeting pages, local file links, event-title authority noise, and automatic duplicate merges.",
    },
  ],
  revisions: [],
};
