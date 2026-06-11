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
import { type DcInterpreterContext } from "./interpreters/context.ts";
import { type Revision } from "../../core/types.ts";
import type { PromotionPolicy } from "../../compiler/promotion.ts";
import { dcPromotionPolicy } from "./promotion.ts";

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
  ],
  revisions: [],
};
