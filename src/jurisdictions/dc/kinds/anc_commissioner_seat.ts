import { defineEntryKind } from "../../../core/kinds.ts";

export const dcAncCommissionerSeatKind = defineEntryKind({
  kind: "dc.anc_commissioner_seat",
  family: "position",
  attributes: {
    currentHolderName: { required: false, type: "string" },
    officerRole: { required: false, type: "string" },
    sourceSmdId: { required: true, type: "string" },
    sourceAncId: { required: false, type: "string" },
    sourceOancProfileUrl: { required: false, type: "string" },
    sourcePageLastModified: { required: false, type: "string" },
    sourceRepresentativeName: { required: false, type: "string" },
    sourceFirstName: { required: false, type: "string" },
    sourceLastName: { required: false, type: "string" },
  },
});
