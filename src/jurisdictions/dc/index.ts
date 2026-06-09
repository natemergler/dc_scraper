import { KindRegistry } from "../../core/kinds.ts";
import { dcAncKind } from "./kinds/anc.ts";
import { dcAgencyKind } from "./kinds/agency.ts";
import { dcBoardKind } from "./kinds/board.ts";
import { dcCommissionKind } from "./kinds/commission.ts";
import { dcAuthorityKind } from "./kinds/authority.ts";
import { dcAncCommissionerSeatKind } from "./kinds/anc_commissioner_seat.ts";
import { dcCouncilCommitteeKind } from "./kinds/council_committee.ts";
import { dcCouncilmemberKind } from "./kinds/councilmember.ts";
import { dcSmdKind } from "./kinds/smd.ts";
import {
  dcAffiliatedWithRelation,
  dcChairsRelation,
  dcContainsRelation,
  dcGovernsRelation,
  dcMemberOfRelation,
  dcReportsToRelation,
  dcRepresentsRelation,
} from "./kinds/relation.ts";
import { interpretDcgisAgencies } from "./interpreters/dcgis_agencies.ts";
import { dcgisAgenciesBinding } from "./sources/dcgis_agencies.ts";
import { dcgisCommissionsBinding } from "./sources/dcgis_commissions.ts";
import { dcgisBoardsBinding } from "./sources/dcgis_boards.ts";
import { dcgisAuthoritiesBinding } from "./sources/dcgis_authorities.ts";
import { dcgisAncsBinding } from "./sources/dcgis_ancs.ts";
import { dcgisSmdsBinding } from "./sources/dcgis_smds.ts";
import { dccouncilCommitteesBinding } from "./sources/dccouncil_committees.ts";
import { dccouncilMembersBinding } from "./sources/dccouncil_members.ts";
import { openDCPublicBodiesBinding } from "./sources/open_dc_public_bodies.ts";
import { type DcInterpreterContext } from "./interpreters/context.ts";
import { type Revision } from "../../core/types.ts";

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
  revisions: Revision[];
}

const dcKindRegistry = new KindRegistry();
dcKindRegistry.register(dcAncKind);
dcKindRegistry.register(dcAgencyKind);
dcKindRegistry.register(dcBoardKind);
dcKindRegistry.register(dcCommissionKind);
dcKindRegistry.register(dcAuthorityKind);
dcKindRegistry.register(dcAncCommissionerSeatKind);
dcKindRegistry.register(dcCouncilCommitteeKind);
dcKindRegistry.register(dcCouncilmemberKind);
dcKindRegistry.register(dcSmdKind);
dcKindRegistry.registerRelation(dcChairsRelation);
dcKindRegistry.registerRelation(dcContainsRelation);
dcKindRegistry.registerRelation(dcAffiliatedWithRelation);
dcKindRegistry.registerRelation(dcGovernsRelation);
dcKindRegistry.registerRelation(dcMemberOfRelation);
dcKindRegistry.registerRelation(dcReportsToRelation);
dcKindRegistry.registerRelation(dcRepresentsRelation);

export const dcRuntime: DcJurisdictionRuntime = {
  jurisdiction: dcJurisdiction,
  kinds: dcKindRegistry,
  sources: [
    dcgisAncsBinding,
    dcgisAgenciesBinding,
    dcgisBoardsBinding,
    dcgisCommissionsBinding,
    dcgisAuthoritiesBinding,
    dcgisSmdsBinding,
    dccouncilMembersBinding,
    dccouncilCommitteesBinding,
    openDCPublicBodiesBinding,
  ],
  revisions: [],
};
