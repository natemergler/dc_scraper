import { type DCCourtsStructureSource as DCCourtsStructureReaderSource } from "../../../readers/dccourts_structure.ts";
import { interpretDCCourtsStructure } from "../interpreters/dccourts_structure.ts";

export const dccourtsStructureSourceId = "dccourts.structure" as const;
export const dcJurisdiction = "dc" as const;

export interface DCCourtsStructureSourceDef extends DCCourtsStructureReaderSource {
  id: typeof dccourtsStructureSourceId;
  jurisdiction: typeof dcJurisdiction;
}

export interface DCCourtsStructureSourceBinding {
  source: DCCourtsStructureSourceDef;
  interpret: typeof interpretDCCourtsStructure;
}

export const dccourtsStructureSource: DCCourtsStructureSourceDef = {
  id: dccourtsStructureSourceId,
  jurisdiction: dcJurisdiction,
  type: "dccourts.structure",
  homeUrl: "https://www.dccourts.gov/",
  courtOfAppealsUrl: "https://www.dccourts.gov/court-of-appeals",
  superiorCourtUrl: "https://www.dccourts.gov/superior-court",
};

export const dccourtsStructureBinding: DCCourtsStructureSourceBinding = {
  source: dccourtsStructureSource,
  interpret: interpretDCCourtsStructure,
};
