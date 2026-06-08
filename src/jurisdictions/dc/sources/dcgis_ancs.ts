import { type ArcGISTableSource } from "../../../readers/arcgis_table.ts";
import { interpretDcgisAncs } from "../interpreters/dcgis_ancs.ts";

export const dcgisAncsSourceId = "dcgis.ancs" as const;
export const dcgisJurisdiction = "dc" as const;

export interface DcGisAncsSource extends ArcGISTableSource {
  id: typeof dcgisAncsSourceId;
  jurisdiction: typeof dcgisJurisdiction;
  kind: "ancs";
}

export interface DcGisAncsSourceBinding {
  source: DcGisAncsSource;
  interpret: typeof interpretDcgisAncs;
}

export const dcgisAncsSource: DcGisAncsSource = {
  id: dcgisAncsSourceId,
  jurisdiction: dcgisJurisdiction,
  kind: "ancs",
  type: "arcgis.table",
  tableUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/54",
  idField: "ANC_ID",
  outFields: ["*"],
  pageSize: 500,
};

export const dcgisAncsBinding: DcGisAncsSourceBinding = {
  source: dcgisAncsSource,
  interpret: interpretDcgisAncs,
};
