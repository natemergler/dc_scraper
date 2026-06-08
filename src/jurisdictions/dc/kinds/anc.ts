import { defineEntryKind } from "../../../core/kinds.ts";

export const dcAncKind = defineEntryKind({
  kind: "dc.anc",
  family: "organization",
  attributes: {
    sourceAncId: { required: false, type: "string" },
    webUrl: { required: false, type: "string" },
    gisId: { required: false, type: "string" },
  },
});
