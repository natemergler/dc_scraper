import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import { Workbench } from "../src/v2/workbench.ts";
import {
  admin311Fixture,
  adminBudgetPageFixture,
  adminProcurementPageFixture,
  arcgisLayerDetailFixture,
  arcgisServiceLayersFixture,
  begaAboutFixture,
  begaOgeFixture,
  begaOogFixture,
  councilCommitteeHealthDetailFixture,
  councilCommitteesFixture,
  councilCommitteeWholeDetailFixture,
  dcCourtOfAppealsFixture,
  dcCourtsHomeFixture,
  dcgisMetadataFixture,
  dcgisRowsFixture,
  dcSuperiorCourtFixture,
  enterpriseDatasetInventoryMetadataFixture,
  enterpriseDatasetInventoryRowsPageOneFixture,
  enterpriseDatasetInventoryRowsPageTwoFixture,
  governmentOperationsCatalogFixture,
  legalEntrypointsFixture,
  limsFixture,
  openDcBoardFixture,
  openDcIndexFixture,
  openDcTaskForceFixture,
  quickbaseAppointmentsCsvFixture,
  quickbaseFixture,
} from "./helpers/v2_fixtures.ts";

Deno.test("imports representative connector results and source inspection stays queryable after failures", async () => {
  const dir = await Deno.makeTempDir();
  const dbPath = join(dir, "workbench.sqlite");
  const dataDir = join(dir, "artifacts");
  const workbench = new Workbench(dbPath);
  workbench.init();
  const responses = new Map<string, string>([
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6?f=json",
      JSON.stringify(dcgisMetadataFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/6/query?where=1%3D1&outFields=OBJECTID%2CAGENCY_ID%2CAGENCY_NAME%2CTYPE%2CWEB_URL%2CBRANCH%2CMAYORAL_CLUSTER%2CLEGISLATION&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=2&f=json",
      JSON.stringify(dcgisRowsFixture),
    ],
    ["https://www.open-dc.gov/public-bodies", openDcIndexFixture],
    ["https://www.open-dc.gov/public-bodies/board-accountancy", openDcBoardFixture],
    [
      "https://www.open-dc.gov/public-bodies/adult-career-pathways-task-force",
      openDcTaskForceFixture,
    ],
    ["https://dccouncil.gov/committees/", councilCommitteesFixture],
    [
      "https://dccouncil.gov/committees/committee-of-the-whole/",
      councilCommitteeWholeDetailFixture,
    ],
    ["https://dccouncil.gov/committees/committee-on-health/", councilCommitteeHealthDetailFixture],
    ["https://lims.dccouncil.gov/api/Search/GetWhatsNew", limsFixture],
    [
      "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0",
      quickbaseFixture,
    ],
    [
      "https://octo.quickbase.com/db/bjngwr9pe?a=q&qid=-1243452&bq=1&isDDR=1&skip=0&dlta=xs",
      quickbaseAppointmentsCsvFixture,
    ],
    ["https://dc.gov/page/laws-regulations-and-courts", legalEntrypointsFixture],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/ServiceRequests/FeatureServer/21?f=json",
      admin311Fixture,
    ],
    ["https://cfo.dc.gov/budget", adminBudgetPageFixture],
    ["https://ocp.dc.gov/page/doing-business-dc-government", adminProcurementPageFixture],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer/46?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Certificate of Occupancy")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer/45?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Home Occupancy Permit")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer/5?f=json",
      JSON.stringify(arcgisLayerDetailFixture("ABCA Liquor License Locations")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/7?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Bias Crime")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/24?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Vehicular Crash Data")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/29?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Shot Spotter Gun Shots")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/10?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Certificate Of Occupancy Points")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/39?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Tax Lots")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/33?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Parcel Lots")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/35?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Reservations")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer?f=json",
      JSON.stringify(arcgisServiceLayersFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/8?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Mail Ballot Drop Boxes")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/9?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Election Day Vote Center")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/10?f=json",
      JSON.stringify(arcgisLayerDetailFixture("Early Vote Center")),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer?f=json",
      JSON.stringify(governmentOperationsCatalogFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5?f=json",
      JSON.stringify(enterpriseDatasetInventoryMetadataFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=2&f=json",
      JSON.stringify(enterpriseDatasetInventoryRowsPageOneFixture),
    ],
    [
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=2&resultRecordCount=2&f=json",
      JSON.stringify(enterpriseDatasetInventoryRowsPageTwoFixture),
    ],
    ["https://www.dccourts.gov/", dcCourtsHomeFixture],
    ["https://www.dccourts.gov/court-of-appeals", dcCourtOfAppealsFixture],
    ["https://www.dccourts.gov/superior-court", dcSuperiorCourtFixture],
    ["https://bega.dc.gov/node/61616/", begaAboutFixture],
    ["https://bega.dc.gov/page/office-government-ethics", begaOgeFixture],
    ["https://www.open-dc.gov/office-open-government", begaOogFixture],
  ]);
  const fetcher = async (url: string) => {
    const body = responses.get(url);
    if (!body) throw new Error(`Unexpected fixture url ${url}`);
    return {
      status: 200,
      text: async () => body,
      json: async <T>() => JSON.parse(body) as T,
    };
  };
  for (
    const sourceId of [
      "dcgis.agencies",
      "open_dc.public_bodies",
      "council.committees",
      "council.lims",
      "mota.quickbase",
      "legal.entrypoints",
      "admin.service_requests_311",
      "admin.budget_sources",
      "admin.enterprise_dataset_inventory",
      "dccourts.structure",
      "bega.structure",
      "admin.permits_licenses",
      "admin.crime_public_safety",
      "admin.procurement_sources",
      "admin.property_land",
      "admin.elections",
    ]
  ) {
    const connector = getConnector(sourceId);
    const result = await connector.run(createConnectorContext({ fetcher, limit: 2 }));
    await workbench.importConnectorResult(result, dataDir);
  }
  const dcgis = workbench.sourceSummary("dcgis.agencies");
  const quickbase = workbench.sourceSummary("mota.quickbase");
  const enterpriseInventory = workbench.sourceSummary("admin.enterprise_dataset_inventory");
  const courtsSummary = workbench.sourceSummary("dccourts.structure");
  const begaSummary = workbench.sourceSummary("bega.structure");
  const permitSummary = workbench.sourceSummary("admin.permits_licenses");
  const categories = new Set(workbench.datasets().map((dataset) => dataset.category));
  const hasRegisterRef = workbench.legalRefs().some((ref) => ref.ref_type === "dc_register");
  workbench.close();
  assertEquals(dcgis.fieldCount, 7);
  assertEquals(dcgis.entityCandidateCount, 2);
  assertEquals(dcgis.relationshipCandidateCount, 0);
  assertEquals(quickbase.latestStatus, "success");
  assertStringIncludes(quickbase.latestArtifactPath ?? "", "mota.quickbase");
  assertEquals(quickbase.itemCount > 0, true);
  assertEquals(quickbase.entityCandidateCount > 0, true);
  assertEquals(quickbase.relationshipCandidateCount > 0, true);
  assertEquals(enterpriseInventory.itemCount, 10);
  assertEquals(enterpriseInventory.fieldCount, 9);
  assertEquals(courtsSummary.itemCount, 3);
  assertEquals(courtsSummary.entityCandidateCount, 12);
  assertEquals(courtsSummary.relationshipCandidateCount, 11);
  assertEquals(begaSummary.itemCount, 3);
  assertEquals(begaSummary.entityCandidateCount, 3);
  assertEquals(begaSummary.relationshipCandidateCount, 2);
  assertEquals(hasRegisterRef, true);
  assertEquals(permitSummary.fieldCount > 0, true);
  assertEquals(categories.has("procurement"), true);
  assertEquals(categories.has("budget"), true);
  assertEquals(categories.has("crime_incidents"), true);
  assertEquals(categories.has("public_services"), true);
});
