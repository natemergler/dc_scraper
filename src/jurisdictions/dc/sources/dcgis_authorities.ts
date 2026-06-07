import { type ArcGISTableSource } from "../../../readers/arcgis_table.ts";
import { interpretDcgisAuthorities } from "../interpreters/dcgis_authorities.ts";

export const dcgisAuthoritiesSourceId = "dcgis.authorities" as const;
export const dcgisJurisdiction = "dc" as const;

export interface DcGisAuthoritiesSource extends ArcGISTableSource {
  id: typeof dcgisAuthoritiesSourceId;
  jurisdiction: typeof dcgisJurisdiction;
  kind: "authorities";
}

export interface DcGisAuthoritiesSourceBinding {
  source: DcGisAuthoritiesSource;
  interpret: typeof interpretDcgisAuthorities;
}

export const dcgisAuthoritiesSource: DcGisAuthoritiesSource = {
  id: dcgisAuthoritiesSourceId,
  jurisdiction: dcgisJurisdiction,
  kind: "authorities",
  type: "arcgis.table",
  tableUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24",
  where: "TYPE = 'Authority'",
  outFields: ["*"],
  pageSize: 500,
};

export const dcgisAuthoritiesBinding: DcGisAuthoritiesSourceBinding = {
  source: dcgisAuthoritiesSource,
  interpret: interpretDcgisAuthorities,
};
