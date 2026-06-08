import { defineEntryKind } from "../../../core/kinds.ts";

export const dcSmdKind = defineEntryKind({
  kind: "dc.smd",
  family: "area",
  attributes: {
    sourceSmdId: { required: false, type: "string" },
    sourceAncId: { required: false, type: "string" },
    webUrl: { required: false, type: "string" },
    email: { required: false, type: "string" },
  },
});
