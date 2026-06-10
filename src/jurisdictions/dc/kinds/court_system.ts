import { defineEntryKind } from "../../../core/kinds.ts";

export const dcCourtSystemKind = defineEntryKind({
  kind: "dc.court_system",
  family: "organization",
  attributes: {
    shortName: { required: true, type: "string" },
    sourceCourtSystemKey: { required: false, type: "string" },
  },
});
