import { defineEntryKind } from "../../../core/kinds.ts";

export const dcWardKind = defineEntryKind({
  kind: "dc.ward",
  family: "area",
  attributes: {
    wardNumber: { required: true, type: "string" },
  },
});
