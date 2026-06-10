import { type OpenDCPublicBodiesSource as OpenDCPublicBodiesReaderSource } from "../../../readers/open_dc_public_bodies.ts";
import { interpretOpenDCPublicBodies } from "../interpreters/open_dc_public_bodies.ts";

export const openDCPublicBodiesSourceId = "open_dc.public_bodies" as const;
export const dcJurisdiction = "dc" as const;

export interface OpenDCPublicBodiesSourceDef extends OpenDCPublicBodiesReaderSource {
  id: typeof openDCPublicBodiesSourceId;
  jurisdiction: typeof dcJurisdiction;
}

export interface OpenDCPublicBodiesSourceBinding {
  source: OpenDCPublicBodiesSourceDef;
  interpret: typeof interpretOpenDCPublicBodies;
}

export const openDCPublicBodiesSource: OpenDCPublicBodiesSourceDef = {
  id: openDCPublicBodiesSourceId,
  jurisdiction: dcJurisdiction,
  type: "open_dc.public_bodies",
  indexUrl: "https://www.open-dc.gov/public-bodies",
  supplementalIndexUrl: "https://www.open-dc.gov/public-bodies-general-0",
};

export const openDCPublicBodiesBinding: OpenDCPublicBodiesSourceBinding = {
  source: openDCPublicBodiesSource,
  interpret: interpretOpenDCPublicBodies,
};
