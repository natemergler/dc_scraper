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
  seededStructure: [
    {
      key: "district-of-columbia-courts",
      name: "District of Columbia Courts",
      url: "https://www.dccourts.gov/",
      entryKind: "court_system",
      pageTitle: "DC Courts Homepage | District of Columbia Courts",
      heading: "District of Columbia Courts",
    },
    {
      key: "court-of-appeals",
      name: "Court of Appeals",
      url: "https://www.dccourts.gov/court-of-appeals",
      entryKind: "court",
      parentName: "District of Columbia Courts",
      pageTitle: "Court of Appeals | District of Columbia Courts",
      heading: "Court of Appeals",
      summary:
        "The District of Columbia Court of Appeals is the highest court of the District of Columbia.",
    },
    {
      key: "superior-court",
      name: "Superior Court",
      url: "https://www.dccourts.gov/superior-court",
      entryKind: "court",
      parentName: "District of Columbia Courts",
      pageTitle: "Superior Court | District of Columbia Courts",
      heading: "Superior Court",
      summary:
        "The Superior Court is the court of general jurisdiction over nearly all local legal matters including criminal, family, civil, juvenile, landlord-tenant, probate, small claims, and tax.",
    },
    {
      key: "civil-division",
      name: "Civil Division",
      url: "https://www.dccourts.gov/superior-court/superior-court-divisions/civil-division",
      entryKind: "court_division",
      parentName: "Superior Court",
      discoveryPageUrl: "https://www.dccourts.gov/superior-court",
    },
    {
      key: "criminal-division",
      name: "Criminal Division",
      url: "https://www.dccourts.gov/superior-court/superior-court-divisions/criminal-division",
      entryKind: "court_division",
      parentName: "Superior Court",
      discoveryPageUrl: "https://www.dccourts.gov/superior-court",
    },
    {
      key: "domestic-violence-division",
      name: "Domestic Violence Division",
      url:
        "https://www.dccourts.gov/superior-court/superior-court-divisions/domestic-violence-division",
      entryKind: "court_division",
      parentName: "Superior Court",
      discoveryPageUrl: "https://www.dccourts.gov/superior-court",
    },
    {
      key: "family-court-operations-division",
      name: "Family Court Operations Division",
      url:
        "https://www.dccourts.gov/superior-court/superior-court-divisions/family-court-operations-division",
      entryKind: "court_division",
      parentName: "Superior Court",
      discoveryPageUrl: "https://www.dccourts.gov/superior-court",
    },
    {
      key: "family-court-social-services-division",
      name: "Family Court Social Services Division",
      url:
        "https://www.dccourts.gov/superior-court/superior-court-divisions/family-court-social-services-division",
      entryKind: "court_division",
      parentName: "Superior Court",
      discoveryPageUrl: "https://www.dccourts.gov/superior-court",
    },
    {
      key: "multi-door-dispute-resolution-division",
      name: "Multi-Door Dispute Resolution Division",
      url:
        "https://www.dccourts.gov/superior-court/superior-court-divisions/multi-door-dispute-resolution-division",
      entryKind: "court_division",
      parentName: "Superior Court",
      discoveryPageUrl: "https://www.dccourts.gov/superior-court",
    },
    {
      key: "probate-division",
      name: "Probate Division",
      url: "https://www.dccourts.gov/superior-court/superior-court-divisions/probate-division",
      entryKind: "court_division",
      parentName: "Superior Court",
      discoveryPageUrl: "https://www.dccourts.gov/superior-court",
    },
    {
      key: "special-operations-division",
      name: "Special Operations Division",
      url:
        "https://www.dccourts.gov/superior-court/superior-court-divisions/special-operations-division",
      entryKind: "court_division",
      parentName: "Superior Court",
      discoveryPageUrl: "https://www.dccourts.gov/superior-court",
    },
    {
      key: "tax-division",
      name: "Tax Division",
      url: "https://www.dccourts.gov/superior-court/superior-court-divisions/tax-division",
      entryKind: "court_division",
      parentName: "Superior Court",
      discoveryPageUrl: "https://www.dccourts.gov/superior-court",
    },
  ],
};

export const dccourtsStructureBinding: DCCourtsStructureSourceBinding = {
  source: dccourtsStructureSource,
  interpret: interpretDCCourtsStructure,
};
