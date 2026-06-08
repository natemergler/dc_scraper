import { type ArcGISTableSource } from "../../../readers/arcgis_table.ts";
import { interpretDcgisAgencies } from "../interpreters/dcgis_agencies.ts";

export const dcgisAgenciesSourceId = "dcgis.agencies" as const;
export const dcgisJurisdiction = "dc" as const;

export interface DcGisAgenciesSource extends ArcGISTableSource {
  id: typeof dcgisAgenciesSourceId;
  jurisdiction: typeof dcgisJurisdiction;
  kind: "agencies";
}

export interface DcGisAgenciesInterpretationInput {
  source: DcGisAgenciesSource;
}

export interface DcGisAgenciesSourceBinding {
  source: DcGisAgenciesSource;
  interpret: typeof interpretDcgisAgencies;
}

export const dcgisAgenciesSource: DcGisAgenciesSource = {
  id: dcgisAgenciesSourceId,
  jurisdiction: dcgisJurisdiction,
  kind: "agencies",
  type: "arcgis.table",
  tableUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6",
  where: "TYPE = 'Agency'",
  outFields: ["*"],
  pageSize: 500,
};

export const dcgisAgenciesBinding: DcGisAgenciesSourceBinding = {
  source: dcgisAgenciesSource,
  interpret: interpretDcgisAgencies,
};
