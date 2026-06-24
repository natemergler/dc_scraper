import { defineEntryKind } from "../../../core/kinds.ts";

export const dcAgencyKind = defineEntryKind({
  kind: "dc.agency",
  family: "organization",
  attributes: {
    shortName: { required: true, type: "string" },
    officialUrl: { required: false, type: "string" },
    sourcePageUrl: { required: false, type: "string" },
    sourceAgencyId: { required: false, type: "string" },
  },
});

export const dcKinds = [dcAgencyKind] as const;
