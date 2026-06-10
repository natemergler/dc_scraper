import { type LegalEntrypointsSource as LegalEntrypointsReaderSource } from "../../../readers/legal_entrypoints.ts";
import { interpretLegalEntrypoints } from "../interpreters/legal_entrypoints.ts";

export const legalEntrypointsSourceId = "legal.entrypoints" as const;
export const dcJurisdiction = "dc" as const;

export interface LegalEntrypointsSourceDef extends LegalEntrypointsReaderSource {
  id: typeof legalEntrypointsSourceId;
  jurisdiction: typeof dcJurisdiction;
}

export interface LegalEntrypointsSourceBinding {
  source: LegalEntrypointsSourceDef;
  interpret: typeof interpretLegalEntrypoints;
}

export const legalEntrypointsSource: LegalEntrypointsSourceDef = {
  id: legalEntrypointsSourceId,
  jurisdiction: dcJurisdiction,
  type: "legal.entrypoints",
  indexUrl: "https://dc.gov/page/laws-regulations-and-courts",
  seededEntrypoints: [
    {
      key: "district-of-columbia-official-code",
      name: "District of Columbia Official Code",
      url: "https://code.dccouncil.gov/",
    },
    {
      key: "dc-register-dcmr",
      name: "DC Register / DCMR",
      url: "https://dcregs.dc.gov/",
    },
    {
      key: "mayors-orders",
      name: "Mayor's Orders",
      url: "https://mayor.dc.gov/page/mayors-orders",
    },
    {
      key: "laws-regulations-and-courts",
      name: "Laws, Regulations and Courts",
      url: "https://dc.gov/page/laws-regulations-and-courts",
    },
  ],
};

export const legalEntrypointsBinding: LegalEntrypointsSourceBinding = {
  source: legalEntrypointsSource,
  interpret: interpretLegalEntrypoints,
};
