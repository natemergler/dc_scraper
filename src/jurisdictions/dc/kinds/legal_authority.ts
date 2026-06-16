import { defineEntryKind } from "../../../core/kinds.ts";

export const dcLegalAuthorityKind = defineEntryKind({
  kind: "dc.legal_authority",
  family: "authority",
  attributes: {
    authorityType: { required: true, type: "string" },
    locator: { required: true, type: "string" },
    canonicalUrl: { required: false, type: "string" },
    shortName: { required: false, type: "string" },
  },
});

export const dcKinds = [dcLegalAuthorityKind] as const;
