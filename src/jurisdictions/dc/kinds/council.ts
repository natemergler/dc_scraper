import { defineEntryKind } from "../../../core/kinds.ts";

export const dcCouncilKind = defineEntryKind({
  kind: "dc.council",
  family: "organization",
  attributes: {
    shortName: { required: true, type: "string" },
    sourceCouncilId: { required: false, type: "string" },
  },
});
