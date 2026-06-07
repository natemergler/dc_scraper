import { defineEntryKind } from "../../../core/kinds.ts";

export const dcCommissionKind = defineEntryKind({
  kind: "dc.commission",
  family: "organization",
  attributes: {
    shortName: { required: true, type: "string" },
    sourceCommissionId: { required: false, type: "string" },
  },
});
