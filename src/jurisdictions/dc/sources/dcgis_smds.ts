import { type ArcGISTableSource } from "../../../readers/arcgis_table.ts";
import { interpretDcgisSmds } from "../interpreters/dcgis_smds.ts";

export const dcgisSmdsSourceId = "dcgis.smds" as const;
export const dcgisJurisdiction = "dc" as const;

export interface DcGisSmdsSource extends ArcGISTableSource {
  id: typeof dcgisSmdsSourceId;
  jurisdiction: typeof dcgisJurisdiction;
  kind: "smds";
}

export interface DcGisSmdsSourceBinding {
  source: DcGisSmdsSource;
  interpret: typeof interpretDcgisSmds;
}

export const dcgisSmdsSource: DcGisSmdsSource = {
  id: dcgisSmdsSourceId,
  jurisdiction: dcgisJurisdiction,
  kind: "smds",
  type: "arcgis.table",
  tableUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/55",
  idField: "SMD_ID",
  outFields: ["*"],
  pageSize: 500,
};

export const dcgisSmdsBinding: DcGisSmdsSourceBinding = {
  source: dcgisSmdsSource,
  interpret: interpretDcgisSmds,
};
