import type { EntryFragment } from "../../core/types.ts";
import type { EntryPromotionDecision, PromotionPolicy } from "../../compiler/promotion.ts";
import { agencyDirectorySourceId } from "./sources/agency_directory.ts";
import { dcgisAgenciesSourceId } from "./sources/dcgis_agencies.ts";
import { dcgisAncsSourceId } from "./sources/dcgis_ancs.ts";
import { dcgisAuthoritiesSourceId } from "./sources/dcgis_authorities.ts";
import { dcgisBoardsSourceId } from "./sources/dcgis_boards.ts";
import { dcgisCommissionsSourceId } from "./sources/dcgis_commissions.ts";
import { dcgisCouncilsSourceId } from "./sources/dcgis_councils.ts";
import { dcgisSmdsSourceId } from "./sources/dcgis_smds.ts";
import { dccouncilCommitteesSourceId } from "./sources/dccouncil_committees.ts";
import { dccouncilMembersSourceId } from "./sources/dccouncil_members.ts";
import { mayorExecutiveStructureSourceId } from "./sources/mayor_executive_structure.ts";
import { oancProfilesSourceId } from "./sources/oanc_profiles.ts";
import { openDCPublicBodiesSourceId } from "./sources/open_dc_public_bodies.ts";
import { begaStructureSourceId } from "./sources/bega_structure.ts";
import { dccourtsStructureSourceId } from "./sources/dccourts_structure.ts";
import { legalEntrypointsSourceId } from "./sources/legal_entrypoints.ts";

const promotedKindsBySource = new Map<string, Set<string>>([
  [agencyDirectorySourceId, new Set(["dc.agency"])],
  [dcgisAgenciesSourceId, new Set(["dc.agency"])],
  [dcgisAncsSourceId, new Set(["dc.anc"])],
  [dcgisAuthoritiesSourceId, new Set(["dc.authority"])],
  [dcgisBoardsSourceId, new Set(["dc.board"])],
  [dcgisCommissionsSourceId, new Set(["dc.commission"])],
  [dcgisCouncilsSourceId, new Set(["dc.council"])],
  [dcgisSmdsSourceId, new Set(["dc.smd", "dc.anc_commissioner_seat"])],
  [dccouncilCommitteesSourceId, new Set(["dc.committee", "dc.councilmember"])],
  [dccouncilMembersSourceId, new Set(["dc.councilmember", "dc.elected_office", "dc.ward"])],
  [mayorExecutiveStructureSourceId, new Set(["dc.office"])],
  [oancProfilesSourceId, new Set(["dc.anc", "dc.ward"])],
  [begaStructureSourceId, new Set(["dc.agency", "dc.office"])],
  [dccourtsStructureSourceId, new Set(["dc.court_system", "dc.court", "dc.court_division"])],
  [legalEntrypointsSourceId, new Set(["dc.legal_source"])],
]);

const openDcPromotableSpecificKinds = new Set([
  "dc.board",
  "dc.commission",
  "dc.authority",
  "dc.council",
]);

export const dcPromotionPolicy: PromotionPolicy = {
  decideEntryFragment: decideDcEntryPromotion,
  canonicalizeRelationKind(kind) {
    if (kind !== "dc.relation:affiliated_with") {
      return { kind };
    }

    return {
      kind: "dc.relation:governs",
      finding: {
        kind: "warn",
        code: "dc.promotion.relation_kind_deprecated",
        message:
          "relation kind dc.relation:affiliated_with was migrated to dc.relation:governs by DC promotion policy",
      },
    };
  },
};

function decideDcEntryPromotion(fragment: EntryFragment): EntryPromotionDecision {
  if (fragment.source === openDCPublicBodiesSourceId) {
    return decideOpenDcPublicBodyPromotion(fragment);
  }

  const allowedKinds = promotedKindsBySource.get(fragment.source);
  if (allowedKinds?.has(fragment.kind)) {
    return { action: "promote" };
  }

  return {
    action: "conflict",
    code: "dc.promotion.unexpected_entry_fragment",
    message:
      `DC promotion policy has no rule promoting ${fragment.kind} fragments from ${fragment.source}`,
    citation: fragment.citations[0],
  };
}

function decideOpenDcPublicBodyPromotion(fragment: EntryFragment): EntryPromotionDecision {
  if (openDcPromotableSpecificKinds.has(fragment.kind)) {
    return {
      action: "promote_with_warning",
      code: "dc.promotion.opendc_specific_public_body_promoted",
      message:
        `Open DC public body ${fragment.provisionalId} promoted as ${fragment.kind}; review may still be needed for identity reconciliation`,
      citation: fragment.citations[0],
    };
  }

  return {
    action: "review_required",
    code: "dc.promotion.opendc_public_body_review_required",
    message:
      `Open DC public body ${fragment.provisionalId} was not promoted because ${fragment.kind} is not a safe Open DC promotion kind`,
    citation: fragment.citations[0],
  };
}
