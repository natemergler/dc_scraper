import { type BegaStructureSource as BegaStructureReaderSource } from "../../../readers/bega_structure.ts";
import { interpretBegaStructure } from "../interpreters/bega_structure.ts";

export const begaStructureSourceId = "bega.structure" as const;
export const dcJurisdiction = "dc" as const;

export interface BegaStructureSourceDef extends BegaStructureReaderSource {
  id: typeof begaStructureSourceId;
  jurisdiction: typeof dcJurisdiction;
}

export interface BegaStructureSourceBinding {
  source: BegaStructureSourceDef;
  interpret: typeof interpretBegaStructure;
}

export const begaStructureSource: BegaStructureSourceDef = {
  id: begaStructureSourceId,
  jurisdiction: dcJurisdiction,
  type: "bega.structure",
  pages: [
    {
      key: "board-of-ethics-and-government-accountability",
      name: "Board of Ethics and Government Accountability",
      url: "https://bega.dc.gov/node/61616/",
      entryKind: "agency",
    },
    {
      key: "office-of-government-ethics",
      name: "Office of Government Ethics",
      url: "https://bega.dc.gov/page/office-government-ethics",
      entryKind: "office",
      parentName: "Board of Ethics and Government Accountability",
    },
    {
      key: "office-of-open-government",
      name: "Office of Open Government",
      url: "https://www.open-dc.gov/office-open-government",
      entryKind: "office",
      parentName: "Board of Ethics and Government Accountability",
    },
  ],
};

export const begaStructureBinding: BegaStructureSourceBinding = {
  source: begaStructureSource,
  interpret: interpretBegaStructure,
};
