import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { createConnectorContext, getConnector } from "../src/v2/connectors.ts";
import {
  admin311WrongLayerFixture,
  enterpriseDatasetInventoryMetadataFixture,
  enterpriseDatasetInventoryRowsPageOneFixture,
  enterpriseDatasetInventoryRowsPageTwoFixture,
  governmentOperationsCatalogFixture,
} from "./helpers/v2_fixtures.ts";

Deno.test("Enterprise Dataset Inventory connector captures rows and classifies Government Operations tables conservatively", async () => {
  const progressMessages: string[] = [];
  const result = await getConnector("admin.enterprise_dataset_inventory").run(
    createConnectorContext({
      onProgress: (event) => progressMessages.push(event.message),
      fetcher: async (url: string) => ({
        status: 200,
        text: async () => {
          switch (url) {
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer?f=json":
              return JSON.stringify(governmentOperationsCatalogFixture);
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5?f=json":
              return JSON.stringify(enterpriseDatasetInventoryMetadataFixture);
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=2&f=json":
              return JSON.stringify(enterpriseDatasetInventoryRowsPageOneFixture);
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=2&resultRecordCount=2&f=json":
              return JSON.stringify(enterpriseDatasetInventoryRowsPageTwoFixture);
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=4&resultRecordCount=2&f=json":
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=6&resultRecordCount=2&f=json":
              return JSON.stringify({ features: [] });
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        },
        json: async <T>() => {
          throw new Error(`No json fixture for ${url}`) as T;
        },
      }),
    }),
  );
  assertEquals(result.endpointResults.length, 3);
  assertEquals(progressMessages.includes("Fetching Enterprise Dataset Inventory row count"), false);
  assert(
    progressMessages.includes(
      "Fetching Enterprise Dataset Inventory row page batch starting at 1 (4 page(s) of up to 2)",
    ),
  );
  assert(
    progressMessages.includes(
      "Fetching Enterprise Dataset Inventory rows starting at 1 (page 1, up to 2)",
    ),
  );
  assert(
    progressMessages.includes(
      "Fetching Enterprise Dataset Inventory rows starting at 3 (page 2, up to 2)",
    ),
  );
  assert(
    progressMessages.includes(
      "Fetched 3 Enterprise Dataset Inventory row(s) across 2 page artifact(s)",
    ),
  );
  assert(result.endpointResults.every((endpoint) => endpoint.status === "success"));
  const catalogParsed = result.endpointResults[0].parsed;
  const metadataParsed = result.endpointResults[1].parsed;
  const rowsParsed = result.endpointResults[2].parsed;
  assert(catalogParsed);
  assert(metadataParsed);
  assert(rowsParsed);
  assertEquals(catalogParsed.items?.length, 8);
  assert(
    catalogParsed.items?.some((item) =>
      item.title === "Election infrastructure layers" &&
      item.body.classification === "inventory_only"
    ),
  );
  assert(
    catalogParsed.items?.some((item) =>
      item.title === "DC Government Employee Salary" &&
      item.body.classification === "out_of_scope_person_heavy"
    ),
  );
  assert(
    catalogParsed.items?.some((item) =>
      item.title === "PASS / STaR2 procurement tables" &&
      item.body.classification === "inventory_only"
    ),
  );
  assertEquals(metadataParsed.fields?.length, 9);
  assertEquals(result.endpointResults[1].artifacts.length, 1);
  assertEquals(result.endpointResults[2].artifacts.length, 2);
  assertEquals(rowsParsed.items?.length, 3);
  assertEquals(rowsParsed.datasets?.length, 3);
  assert(
    rowsParsed.datasets?.some((dataset) =>
      dataset.name === "311 City Service Requests" &&
      dataset.category === "public_services" &&
      dataset.ownerName === "Office of Unified Communications" &&
      dataset.officialUrl ===
        "https://opendata.dc.gov/datasets/DCGIS::311-city-service-requests/about"
    ),
  );
  assert(
    rowsParsed.items?.some((item) =>
      item.title === "Film Rebate Ledger" &&
      item.body.datasetName === "Film Rebate Ledger" &&
      item.body.rawDatasetName === " Film Rebate Ledger " &&
      item.body.systemUpdatedOn === "2026-03-04T14:08:53.000Z"
    ),
  );
  assertEquals(
    rowsParsed.datasets?.find((dataset) => dataset.datasetId.includes("ocfo_edi_009999"))?.name,
    "Film Rebate Ledger",
  );
});

Deno.test("Enterprise Dataset Inventory connector fetches row pages concurrently without a count request", async () => {
  const allFeatures = [
    ...enterpriseDatasetInventoryRowsPageOneFixture.features,
    ...enterpriseDatasetInventoryRowsPageTwoFixture.features,
  ];
  let activeRowRequests = 0;
  let maxActiveRowRequests = 0;
  const result = await getConnector("admin.enterprise_dataset_inventory").run(
    createConnectorContext({
      fetcher: async (url: string) => ({
        status: 200,
        text: async () => {
          switch (url) {
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer?f=json":
              return JSON.stringify(governmentOperationsCatalogFixture);
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5?f=json":
              return JSON.stringify({
                ...enterpriseDatasetInventoryMetadataFixture,
                maxRecordCount: 1,
              });
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=1&f=json":
              return delayedRowPage({ features: [allFeatures[0]], exceededTransferLimit: true });
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=1&resultRecordCount=1&f=json":
              return delayedRowPage({ features: [allFeatures[1]], exceededTransferLimit: true });
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=2&resultRecordCount=1&f=json":
              return delayedRowPage({ features: [allFeatures[2]] });
            case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=3&resultRecordCount=1&f=json":
              return delayedRowPage({ features: [] });
            default:
              throw new Error(`Unexpected url ${url}`);
          }
        },
        json: async <T>() => {
          throw new Error(`No json fixture for ${url}`) as T;
        },
      }),
    }),
  );

  assertEquals(maxActiveRowRequests, 4);
  assertEquals(result.endpointResults[2].parsed?.datasets?.length, 3);

  async function delayedRowPage(payload: Record<string, unknown>): Promise<string> {
    activeRowRequests += 1;
    maxActiveRowRequests = Math.max(maxActiveRowRequests, activeRowRequests);
    await new Promise((resolve) => setTimeout(resolve, 10));
    activeRowRequests -= 1;
    return JSON.stringify(payload);
  }
});

Deno.test("Enterprise Dataset Inventory connector fails loudly on row page error payloads", async () => {
  await assertRejects(
    () =>
      getConnector("admin.enterprise_dataset_inventory").run(
        createConnectorContext({
          fetcher: async (url: string) => ({
            status: 200,
            text: async () => {
              switch (url) {
                case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer?f=json":
                  return JSON.stringify(governmentOperationsCatalogFixture);
                case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5?f=json":
                  return JSON.stringify(enterpriseDatasetInventoryMetadataFixture);
                case "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5/query?where=1%3D1&outFields=OBJECTID%2CDATASET_ID%2CPUBLICATION_STATUS%2CAGENCY_NAME%2CDATASET_NAME%2CDATASET_CATEGORY%2CDATASET_STATUS%2CDATASET_URL%2CSYSTEM_UPDATED_ON&orderByFields=OBJECTID&returnGeometry=false&resultOffset=0&resultRecordCount=2&f=json":
                  return JSON.stringify({
                    error: {
                      message: "Failed to execute query.",
                      details: ["Invalid field name"],
                    },
                  });
                default:
                  throw new Error(`Unexpected url ${url}`);
              }
            },
            json: async <T>() => {
              throw new Error(`No json fixture for ${url}`) as T;
            },
          }),
        }),
      ),
    Error,
    "admin.enterprise_dataset_inventory rows page 1 failed: Failed to execute query.: Invalid field name",
  );
});

Deno.test("admin 311 connector fails safely for non-311 layer metadata", async () => {
  const result = await getConnector("admin.service_requests_311").run(
    createConnectorContext({
      fetcher: async () => ({
        status: 200,
        text: async () => admin311WrongLayerFixture,
        json: async <T>() => JSON.parse(admin311WrongLayerFixture) as T,
      }),
    }),
  );
  assertEquals(result.endpointResults[0].status, "failed");
  assertStringIncludes(
    result.endpointResults[0].errorText ?? "",
    "Expected 311 service-request layer",
  );
  assertEquals(result.endpointResults[0].parsed, undefined);
});
