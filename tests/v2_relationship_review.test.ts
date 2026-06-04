import { assertEquals } from "@std/assert";
import { buildRelationshipReviewDraft } from "../src/v2/workbench/relationship_review.ts";

Deno.test("generic relationship review accepts unlisted safe relationships", () => {
  const draft = buildRelationshipReviewDraft({
    relationshipCandidateId: "relationship.test.relationship_review.safe",
    sourceId: "test.relationship_review",
    fromEntityRef: "dc.source_board",
    toEntityRef: "dc.target_agency",
    relationshipType: "governed_by",
    rawValue: "Target Agency",
    needsReview: 0,
  });

  assertEquals(draft.defaultAction, "accept");
  assertEquals(draft.details.whyDeferred, undefined);
});

Deno.test("generic relationship review defers unlisted ambiguous relationships", () => {
  const draft = buildRelationshipReviewDraft({
    relationshipCandidateId: "relationship.test.relationship_review.ambiguous",
    sourceId: "test.relationship_review",
    fromEntityRef: "dc.source_board",
    toEntityRef: "dc.target_agency",
    relationshipType: "governed_by",
    rawValue: "Target Agency",
    needsReview: 1,
  });

  assertEquals(draft.defaultAction, "defer");
});

Deno.test("bega structure keeps safe part_of relationships accept-default", () => {
  const draft = buildRelationshipReviewDraft({
    relationshipCandidateId: "relationship.test.relationship_review.bega",
    sourceId: "bega.structure",
    fromEntityRef: "dc.office_of_open_government",
    toEntityRef: "dc.board_of_ethics_and_government_accountability",
    relationshipType: "part_of",
    rawValue: "Office of Open Government -> BEGA",
    needsReview: 1,
  });

  assertEquals(draft.defaultAction, "accept");
});

Deno.test("dc courts structure keeps safe part_of relationships accept-default", () => {
  const draft = buildRelationshipReviewDraft({
    relationshipCandidateId: "relationship.test.relationship_review.dccourts",
    sourceId: "dccourts.structure",
    fromEntityRef: "dc.superior_court_of_the_district_of_columbia",
    toEntityRef: "dc.district_of_columbia_courts",
    relationshipType: "part_of",
    rawValue: "Superior Court -> DC Courts",
    needsReview: 1,
  });

  assertEquals(draft.defaultAction, "accept");
});
