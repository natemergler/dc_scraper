import { buildReviewItemId } from "../domain.ts";
import {
  councilOversightReviewPolicy,
  defaultActionForCouncilOversightTarget,
} from "../connectors/shared.ts";

export interface RelationshipReviewCandidate {
  relationshipCandidateId: string;
  sourceId: string;
  fromEntityRef: string;
  toEntityRef: string;
  relationshipType: string;
  rawValue?: string | null;
  needsReview: number;
}

export interface RelationshipReviewDraft {
  reviewItemId: string;
  reason: string;
  defaultAction: "accept" | "defer";
  details: Record<string, unknown>;
}

export function buildRelationshipReviewDraft(
  candidate: RelationshipReviewCandidate,
): RelationshipReviewDraft {
  const defaultAction = reviewDefaultAction(candidate);
  const whyDeferred = reviewWhyDeferred(candidate, defaultAction);
  return {
    reviewItemId: buildReviewItemId(
      candidate.relationshipCandidateId,
      reviewItemSuffix(candidate),
    ),
    reason: reviewReason(candidate),
    defaultAction,
    details: {
      fromEntityRef: candidate.fromEntityRef,
      toEntityRef: candidate.toEntityRef,
      relationshipType: candidate.relationshipType,
      ...(candidate.rawValue === null || candidate.rawValue === undefined
        ? {}
        : { rawValue: candidate.rawValue }),
      ...(candidate.needsReview === 1 ? { needsReview: true } : {}),
      ...(whyDeferred ? { whyDeferred } : {}),
    },
  };
}

function reviewItemSuffix(candidate: RelationshipReviewCandidate): string {
  switch (candidate.sourceId) {
    case "council.committees":
      return "committee";
    case "mota.quickbase":
      return candidate.relationshipType === "overseen_by"
        ? "council-oversight"
        : "governing-agency";
    case "open_dc.public_bodies":
      return candidate.relationshipCandidateId.includes("administering_agency")
        ? "administering-agency"
        : "governing-agency";
    default:
      return candidate.relationshipType;
  }
}

function reviewReason(candidate: RelationshipReviewCandidate): string {
  switch (candidate.sourceId) {
    case "council.committees":
      if (candidate.relationshipType === "overseen_by") {
        return "Review Council committee oversight relationship";
      }
      if (candidate.relationshipType === "chairs") return "Review committee chair relationship";
      if (candidate.relationshipType === "member_of") {
        if (candidate.needsReview === 1) {
          return "Review Committee of the Whole roster/prose membership tension";
        }
        return "Review committee member relationship";
      }
      return "Review committee to Council relationship";
    case "council.members":
      return "Review Council member-seat relationship";
    case "dcgis.agencies":
      return "Review agency relationship inferred from branch metadata";
    case "dcgis.boards_commissions_councils":
      return "Review public-body relationship from DCGIS metadata";
    case "mota.quickbase":
      return candidate.relationshipType === "overseen_by"
        ? "Review potential council oversight relationship for committee"
        : "Review governing agency inferred from seat designation";
    case "oanc.anc_profiles":
      return "Review ANC structure relationship";
    case "open_dc.public_bodies":
      return candidate.relationshipCandidateId.includes("administering_agency")
        ? "Review administering agency relationship from Open DC"
        : "Review governing agency relationship from Open DC";
    default:
      return "Review relationship candidate";
  }
}

function reviewDefaultAction(
  candidate: RelationshipReviewCandidate,
): "accept" | "defer" {
  switch (candidate.sourceId) {
    case "council.committees":
      if (candidate.relationshipType === "member_of" && candidate.needsReview === 1) {
        return "defer";
      }
      if (candidate.relationshipType !== "overseen_by") return "accept";
      return defaultActionForCouncilOversightTarget(candidate.rawValue);
    case "council.members":
    case "bega.structure":
    case "dccourts.structure":
    case "oanc.anc_profiles":
      return "accept";
    case "dcgis.agencies":
    case "dcgis.boards_commissions_councils":
      return candidate.rawValue === "Other" ? "defer" : "accept";
    case "mota.quickbase":
      return "accept";
    case "open_dc.public_bodies":
      return "accept";
    default:
      return candidate.needsReview === 1 ? "defer" : "accept";
  }
}

function reviewWhyDeferred(
  candidate: RelationshipReviewCandidate,
  defaultAction: "accept" | "defer",
): string | undefined {
  if (defaultAction !== "defer") return undefined;
  switch (candidate.sourceId) {
    case "council.committees":
      if (candidate.relationshipType === "member_of" && candidate.needsReview === 1) {
        return "The source summary says all Councilmembers are part of this committee, but the explicit committee roster omits this member.";
      }
      if (candidate.relationshipType !== "overseen_by") return undefined;
      return councilOversightReviewPolicy(candidate.rawValue).whyDeferred ??
        "This oversight edge stays deferred until a human confirms the committee relationship.";
    case "dcgis.agencies":
    case "dcgis.boards_commissions_councils":
      if (candidate.rawValue !== "Other") return undefined;
      return 'The source only labels the parent branch as "Other", so this relationship still needs a human decision.';
    default:
      if (candidate.needsReview === 1) {
        return "The source marked this relationship candidate as needing review.";
      }
      return undefined;
  }
}
