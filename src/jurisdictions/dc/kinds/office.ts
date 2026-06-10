import { defineEntryKind } from "../../../core/kinds.ts";

export const dcOfficeKind = defineEntryKind({
  kind: "dc.office",
  family: "organization",
  attributes: {
    shortName: { required: true, type: "string" },
    sourceOfficeKey: { required: false, type: "string" },
  },
});
