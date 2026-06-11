import { defineEntryKind } from "../../../core/kinds.ts";

export const dcLegalSourceKind = defineEntryKind({
  kind: "dc.legal_source",
  family: "authority",
  attributes: {
    shortName: { required: true, type: "string" },
    sourceLegalEntrypointKey: { required: false, type: "string" },
  },
});
