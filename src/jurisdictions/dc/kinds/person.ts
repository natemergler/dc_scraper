import { defineEntryKind } from "../../../core/kinds.ts";

export const dcPersonKind = defineEntryKind({
  kind: "dc.person",
  family: "person",
  attributes: {
    sourceSmdId: { required: true, type: "string" },
    sourceAncId: { required: false, type: "string" },
    sourceRepresentativeName: { required: true, type: "string" },
    firstName: { required: false, type: "string" },
    lastName: { required: false, type: "string" },
  },
});
