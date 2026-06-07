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
