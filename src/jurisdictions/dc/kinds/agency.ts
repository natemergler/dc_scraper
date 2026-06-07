import { defineEntryKind } from "../../../core/kinds.ts";

export const dcAgencyKind = defineEntryKind({
  kind: "dc.agency",
  family: "organization",
  attributes: {
    shortName: { required: true, type: "string" },
    sourceAgencyId: { required: false, type: "string" },
  },
});

export const dcKinds = [dcAgencyKind] as const;
