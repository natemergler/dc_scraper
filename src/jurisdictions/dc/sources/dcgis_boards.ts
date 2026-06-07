import { type ArcGISTableSource } from "../../../readers/arcgis_table.ts";
import { interpretDcgisBoards } from "../interpreters/dcgis_boards.ts";

export const dcgisBoardsSourceId = "dcgis.boards" as const;
export const dcgisJurisdiction = "dc" as const;

export interface DcGisBoardsSource extends ArcGISTableSource {
  id: typeof dcgisBoardsSourceId;
  jurisdiction: typeof dcgisJurisdiction;
  kind: "boards";
}

export interface DcGisBoardsSourceBinding {
  source: DcGisBoardsSource;
  interpret: typeof interpretDcgisBoards;
}

export const dcgisBoardsSource: DcGisBoardsSource = {
  id: dcgisBoardsSourceId,
  jurisdiction: dcgisJurisdiction,
  kind: "boards",
  type: "arcgis.table",
  tableUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/24",
  where: "TYPE = 'Board'",
  outFields: ["*"],
  pageSize: 500,
};

export const dcgisBoardsBinding: DcGisBoardsSourceBinding = {
  source: dcgisBoardsSource,
  interpret: interpretDcgisBoards,
};
