import { defineRelationKind } from "../../../core/kinds.ts";

export const dcAffiliatedWithRelation = defineRelationKind({
  kind: "dc.relation:affiliated_with",
});

export const dcGovernsRelation = defineRelationKind({
  kind: "dc.relation:governs",
});

export const dcReportsToRelation = defineRelationKind({
  kind: "dc.relation:reports_to",
});

export const dcAuthorizedByRelation = defineRelationKind({
  kind: "dc.relation:authorized_by",
});

export const dcContainsRelation = defineRelationKind({
  kind: "dc.relation:contains",
});

export const dcRepresentsRelation = defineRelationKind({
  kind: "dc.relation:represents",
});

export const dcHoldsRelation = defineRelationKind({
  kind: "dc.relation:holds",
});

export const dcChairsRelation = defineRelationKind({
  kind: "dc.relation:chairs",
});

export const dcMemberOfRelation = defineRelationKind({
  kind: "dc.relation:member_of",
});

export const dcPartOfRelation = defineRelationKind({
  kind: "dc.relation:part_of",
});
