import { type AgencyDirectorySource as AgencyDirectoryReaderSource } from "../../../readers/agency_directory.ts";
import { interpretAgencyDirectory } from "../interpreters/agency_directory.ts";

export const agencyDirectorySourceId = "dc.agency_directory" as const;
export const dcJurisdiction = "dc" as const;

export interface AgencyDirectorySourceDef extends AgencyDirectoryReaderSource {
  id: typeof agencyDirectorySourceId;
  jurisdiction: typeof dcJurisdiction;
}

export interface AgencyDirectorySourceBinding {
  source: AgencyDirectorySourceDef;
  interpret: typeof interpretAgencyDirectory;
}

export const agencyDirectorySource: AgencyDirectorySourceDef = {
  id: agencyDirectorySourceId,
  jurisdiction: dcJurisdiction,
  type: "dc.agency_directory",
  url: "https://dc.gov/page/agency-list",
};

export const agencyDirectoryBinding: AgencyDirectorySourceBinding = {
  source: agencyDirectorySource,
  interpret: interpretAgencyDirectory,
};
