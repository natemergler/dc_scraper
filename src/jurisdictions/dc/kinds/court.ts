import { defineEntryKind } from "../../../core/kinds.ts";

export const dcCourtKind = defineEntryKind({
  kind: "dc.court",
  family: "organization",
  attributes: {
    shortName: { required: true, type: "string" },
    sourceCourtKey: { required: false, type: "string" },
  },
});
