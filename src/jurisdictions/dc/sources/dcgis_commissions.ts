import { type ArcGISTableSource } from "../../../readers/arcgis_table.ts";
import { interpretDcgisCommissions } from "../interpreters/dcgis_commissions.ts";

export const dcgisCommissionsSourceId = "dcgis.commissions" as const;
export const dcgisJurisdiction = "dc" as const;

export interface DcGisCommissionsSource extends ArcGISTableSource {
  id: typeof dcgisCommissionsSourceId;
  jurisdiction: typeof dcgisJurisdiction;
  kind: "commissions";
}

export interface DcGisCommissionsInterpretationInput {
  source: DcGisCommissionsSource;
}

export interface DcGisCommissionsSourceBinding {
  source: DcGisCommissionsSource;
  interpret: typeof interpretDcgisCommissions;
}

export const dcgisCommissionsSource: DcGisCommissionsSource = {
  id: dcgisCommissionsSourceId,
  jurisdiction: dcgisJurisdiction,
  kind: "commissions",
  type: "arcgis.table",
  // Canonical, live-tested commissions layer from the DC Open Data service catalog.
  tableUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24",
  where: "TYPE = 'Commission'",
  outFields: ["*"],
  pageSize: 500,
};

export const dcgisCommissionsBinding: DcGisCommissionsSourceBinding = {
  source: dcgisCommissionsSource,
  interpret: interpretDcgisCommissions,
};
