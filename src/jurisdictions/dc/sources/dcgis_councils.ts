import { type ArcGISTableSource } from "../../../readers/arcgis_table.ts";
import { interpretDcgisCouncils } from "../interpreters/dcgis_councils.ts";

export const dcgisCouncilsSourceId = "dcgis.councils" as const;
export const dcgisJurisdiction = "dc" as const;

export interface DcGisCouncilsSource extends ArcGISTableSource {
  id: typeof dcgisCouncilsSourceId;
  jurisdiction: typeof dcgisJurisdiction;
  kind: "councils";
}

export interface DcGisCouncilsSourceBinding {
  source: DcGisCouncilsSource;
  interpret: typeof interpretDcgisCouncils;
}

export const dcgisCouncilsSource: DcGisCouncilsSource = {
  id: dcgisCouncilsSourceId,
  jurisdiction: dcgisJurisdiction,
  kind: "councils",
  type: "arcgis.table",
  tableUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24",
  where: "TYPE = 'Council'",
  outFields: ["*"],
  pageSize: 500,
};

export const dcgisCouncilsBinding: DcGisCouncilsSourceBinding = {
  source: dcgisCouncilsSource,
  interpret: interpretDcgisCouncils,
};
