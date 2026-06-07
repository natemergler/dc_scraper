import { defineEntryKind } from "../../../core/kinds.ts";

export const dcAuthorityKind = defineEntryKind({
  kind: "dc.authority",
  family: "authority",
  attributes: {
    shortName: { required: true, type: "string" },
    sourceAuthorityId: { required: false, type: "string" },
  },
});
