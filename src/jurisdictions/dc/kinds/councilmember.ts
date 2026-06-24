import { defineEntryKind } from "../../../core/kinds.ts";

export const dcCouncilmemberKind = defineEntryKind({
  kind: "dc.councilmember",
  family: "person",
  attributes: {
    sourceProfileSlug: { required: true, type: "string" },
    sourceProfileUrl: { required: true, type: "string" },
    officeLabel: { required: false, type: "string" },
    wardNumber: { required: false, type: "string" },
  },
});
