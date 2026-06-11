import { type OancProfilesSource as OancProfilesReaderSource } from "../../../readers/oanc_profiles.ts";
import { interpretOancProfiles } from "../interpreters/oanc_profiles.ts";

export const oancProfilesSourceId = "oanc.profiles" as const;
export const dcJurisdiction = "dc" as const;

export interface OancProfilesSourceDef extends OancProfilesReaderSource {
  id: typeof oancProfilesSourceId;
  jurisdiction: typeof dcJurisdiction;
}

export interface OancProfilesSourceBinding {
  source: OancProfilesSourceDef;
  interpret: typeof interpretOancProfiles;
}

export const oancProfilesSource: OancProfilesSourceDef = {
  id: oancProfilesSourceId,
  jurisdiction: dcJurisdiction,
  type: "oanc.profiles",
  indexUrl: "https://oanc.dc.gov/landing-page/ancs-ward",
};

export const oancProfilesBinding: OancProfilesSourceBinding = {
  source: oancProfilesSource,
  interpret: interpretOancProfiles,
};
