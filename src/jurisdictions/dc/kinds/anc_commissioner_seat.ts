import { defineEntryKind } from "../../../core/kinds.ts";

export const dcAncCommissionerSeatKind = defineEntryKind({
  kind: "dc.anc_commissioner_seat",
  family: "position",
  attributes: {
    sourceSmdId: { required: true, type: "string" },
    sourceAncId: { required: false, type: "string" },
    officeEmail: { required: false, type: "string" },
  },
});
