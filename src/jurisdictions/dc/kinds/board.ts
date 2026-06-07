import { defineEntryKind } from "../../../core/kinds.ts";

export const dcBoardKind = defineEntryKind({
  kind: "dc.board",
  family: "organization",
  attributes: {
    shortName: { required: true, type: "string" },
    sourceBoardId: { required: false, type: "string" },
  },
});
