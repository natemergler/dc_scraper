import { buildReviewItemId } from "../domain.ts";

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

const defaultDeferCouncilOversightTargets = new Set([
  "Access to Justice Initiative",
  "Age-Friendly DC Task Force",
  "Behavioral Health Planning Council",
  "Cedar Hill Hospital",
  "Committee on Facilities and Procurement",
  "Committee on Housing and Neighborhood Revitalization",
  "Commission and Office on Re-Entry and Returning Citizen Affairs",
  "Contract Appeals Board",
  "Corrections Information Council",
  "Council on Physical Fitness, Health, and Nutrition",
  "Green Finance Authority",
  "Health Literacy Council",
  "Interfaith Council",
  "Interstate Compact Commissions",
  "Labor/Management Partnership Council",
  "Law Revision Commission",
  "Metropolitan Washington Airports Authority",
  "Metropolitan Washington Regional Ryan White Planning Council",
  "Multistate Tax Commission",
  "OCFO Office of Budget and Planning",
  "Office and Commission on African Affairs",
  "Office and Commission on African American Affairs",
  "Office of and Commission on Human Rights",
  "Office of the Chief Financial Officer (excluding the Office of Lottery and Gaming)",
  "Other Post-Employment Benefits/Retiree Health Contribution",
  "Pay-As-You-Go Capital",
  "Research Practice Partnership",
  "Robert F. Kennedy Memorial Stadium Community Benefits Oversight Committee",
  "Soil and Water Conservation District",
  "Statehood Commission and delegation",
  "Sustainable Energy Utility",
  "Universal Paid Leave Fund",
  "Washington Aqueduct",
  "Washington Metropolitan Area Transit Authority",
]);

export function buildRelationshipReviewDraft(
  candidate: RelationshipReviewCandidate,
): RelationshipReviewDraft {
  return {
    reviewItemId: buildReviewItemId(
      candidate.relationshipCandidateId,
      reviewItemSuffix(candidate),
    ),
    reason: reviewReason(candidate),
    defaultAction: reviewDefaultAction(candidate),
    details: {
      fromEntityRef: candidate.fromEntityRef,
      toEntityRef: candidate.toEntityRef,
      relationshipType: candidate.relationshipType,
      ...(candidate.rawValue === null || candidate.rawValue === undefined
        ? {}
        : { rawValue: candidate.rawValue }),
      ...(candidate.needsReview === 1 ? { needsReview: true } : {}),
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
      if (candidate.relationshipType === "authorized_by") return "authorized-by";
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
      if (candidate.relationshipType === "authorized_by") {
        return "Review legal authority relationship from Open DC enabling authority";
      }
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
      if (candidate.relationshipType !== "overseen_by") return "accept";
      return shouldDeferCouncilOversight(candidate.rawValue) ? "defer" : "accept";
    case "council.members":
    case "oanc.anc_profiles":
      return "accept";
    case "dcgis.agencies":
    case "dcgis.boards_commissions_councils":
      return candidate.rawValue === "Other" ? "defer" : "accept";
    case "mota.quickbase":
      return candidate.relationshipType === "overseen_by" ? "defer" : "accept";
    case "open_dc.public_bodies":
      if (candidate.relationshipType === "authorized_by") {
        return candidate.needsReview === 1 ? "defer" : "accept";
      }
      return "accept";
    default:
      return candidate.needsReview === 1 ? "accept" : "defer";
  }
}

function shouldDeferCouncilOversight(rawValue?: string | null): boolean {
  if (!rawValue) return false;
  return defaultDeferCouncilOversightTargets.has(rawValue) ||
    rawValue.includes("including") ||
    rawValue.includes("jointly") ||
    rawValue.startsWith("All of ");
}
