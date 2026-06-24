import { defineEntryKind } from "../../../core/kinds.ts";

export const dcCouncilCommitteeKind = defineEntryKind({
  kind: "dc.committee",
  family: "organization",
  attributes: {
    sourceCommitteeSlug: { required: true, type: "string" },
    sourceUrl: { required: true, type: "string" },
    committeeType: { required: true, type: "string" },
  },
});
