import { defineEntryKind } from "../../../core/kinds.ts";

export const dcOfficeKind = defineEntryKind({
  kind: "dc.office",
  family: "organization",
  attributes: {
    shortName: { required: true, type: "string" },
    description: { required: false, type: "string" },
    officialUrl: { required: false, type: "string" },
    sourcePageUrl: { required: false, type: "string" },
    sourcePageUrls: { required: false, type: "json" },
    sourceOfficeKey: { required: false, type: "string" },
  },
});
