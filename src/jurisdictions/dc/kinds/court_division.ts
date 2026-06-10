import { defineEntryKind } from "../../../core/kinds.ts";

export const dcCourtDivisionKind = defineEntryKind({
  kind: "dc.court_division",
  family: "organization",
  attributes: {
    shortName: { required: true, type: "string" },
    sourceCourtDivisionKey: { required: false, type: "string" },
  },
});
