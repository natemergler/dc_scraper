import { KindRegistry } from "../../core/kinds.ts";
import { dcAgencyKind } from "./kinds/agency.ts";
import { dcBoardKind } from "./kinds/board.ts";
import { dcCommissionKind } from "./kinds/commission.ts";
import { dcAuthorityKind } from "./kinds/authority.ts";
import {
  dcAffiliatedWithRelation,
  dcGovernsRelation,
  dcReportsToRelation,
} from "./kinds/relation.ts";
import { interpretDcgisAgencies } from "./interpreters/dcgis_agencies.ts";
import { dcgisAgenciesBinding } from "./sources/dcgis_agencies.ts";
import { dcgisCommissionsBinding } from "./sources/dcgis_commissions.ts";
import { dcgisBoardsBinding } from "./sources/dcgis_boards.ts";
import { dcgisAuthoritiesBinding } from "./sources/dcgis_authorities.ts";
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
dcKindRegistry.register(dcAgencyKind);
dcKindRegistry.register(dcBoardKind);
dcKindRegistry.register(dcCommissionKind);
dcKindRegistry.register(dcAuthorityKind);
dcKindRegistry.registerRelation(dcAffiliatedWithRelation);
dcKindRegistry.registerRelation(dcGovernsRelation);
dcKindRegistry.registerRelation(dcReportsToRelation);

export const dcRuntime: DcJurisdictionRuntime = {
  jurisdiction: dcJurisdiction,
  kinds: dcKindRegistry,
  sources: [
    dcgisAgenciesBinding,
    dcgisBoardsBinding,
    dcgisCommissionsBinding,
    dcgisAuthoritiesBinding,
  ],
  revisions: [],
};
