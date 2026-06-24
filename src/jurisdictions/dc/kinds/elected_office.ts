import { defineEntryKind } from "../../../core/kinds.ts";

export const dcElectedOfficeKind = defineEntryKind({
  kind: "dc.elected_office",
  family: "position",
  attributes: {
    officeType: { required: true, type: "string" },
    sourceLabel: { required: true, type: "string" },
    wardNumber: { required: false, type: "string" },
  },
});
