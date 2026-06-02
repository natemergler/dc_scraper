import {
  buildDatasetId,
  type ConnectorResult,
  type DatasetInput,
  type SourceDefinition,
  type SourceEndpointDefinition,
  type SourceFieldInput,
  type SourceItemInput,
} from "../domain.ts";
import { artifact, fieldEvidence, toPublicHttpUrl } from "./shared.ts";
import type { ConnectorContext, SourceConnector } from "./shared.ts";

const admin311Source: SourceDefinition = {
  sourceId: "admin.service_requests_311",
  title: "311 Service Requests",
  kind: "dataset_metadata",
  accessMethod: "official_arcgis_rest",
  baseUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/ServiceRequests/FeatureServer/21",
};

export const admin311Connector: SourceConnector = {
  sourceId: admin311Source.sourceId,
  source: admin311Source,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const endpoint: SourceEndpointDefinition = {
      endpointId: "admin.service_requests_311.main",
      sourceId: admin311Source.sourceId,
      title: "311 service requests dataset metadata",
      kind: "arcgis_table",
      url: admin311Source.baseUrl,
      method: "GET",
      captureMode: "schema",
    };
    const metadataUrl = `${admin311Source.baseUrl}?f=json`;
    const response = await context.fetcher(metadataUrl);
    const text = await response.text();
    const payload = JSON.parse(text);
    const title = String(payload.name ?? "");
    const description = String(payload.description ?? "");
    const looksLike311 = /service\s*requests?|311/i.test(`${title} ${description}`);
    if (!looksLike311) {
      return {
        source: admin311Source,
        endpointResults: [{
          endpoint,
          status: "failed",
          errorText: `Expected 311 service-request layer metadata, got "${
            title || "unknown"
          }" from ${metadataUrl}`,
          artifacts: [artifact("schema", "json", metadataUrl, text)],
        }],
      };
    }
    const fields: SourceFieldInput[] = (payload.fields ?? []).map(
      (field: Record<string, unknown>, index: number) => ({
        fieldName: String(field.name),
        fieldType: String(field.type ?? "unknown"),
        fieldLabel: String(field.alias ?? field.name),
        ordinal: index,
      }),
    );
    const item: SourceItemInput = {
      itemKey: "schema",
      itemType: "dataset_schema",
      title: title || "311 Service Requests",
      body: payload,
    };
    const dataset: DatasetInput = {
      datasetId: buildDatasetId(admin311Source.sourceId, "schema"),
      sourceItemKey: "schema",
      name: title || "311 Service Requests",
      category: "service_requests",
      ownerName: "District of Columbia",
      accessMethod: admin311Source.accessMethod,
      artifactDepth: "schema",
      officialUrl: admin311Source.baseUrl,
      evidence: [fieldEvidence("field_count", fields.length)],
    };
    return {
      source: admin311Source,
      endpointResults: [{
        endpoint,
        status: "success",
        artifacts: [artifact("schema", "json", metadataUrl, text)],
        parsed: {
          fields,
          items: [item],
          datasets: [dataset],
        },
      }],
    };
  },
};

const enterpriseDatasetInventorySource: SourceDefinition = {
  sourceId: "admin.enterprise_dataset_inventory",
  title: "Enterprise Dataset Inventory and Government Operations Catalog",
  kind: "dataset_inventory",
  accessMethod: "official_arcgis_rest",
  baseUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/5",
  notes:
    "Captures the live Enterprise Dataset Inventory rows plus the surrounding Government Operations service catalog. This lane is inventory-only and does not turn table families into graph facts.",
};

const governmentOperationsServiceUrl =
  "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer";

interface GovernmentOperationsCatalogGroup {
  itemKey: string;
  title: string;
  classification: string;
  nextLane: string;
  notes: string;
  entryIds: number[];
}

const governmentOperationsCatalogGroups: GovernmentOperationsCatalogGroup[] = [
  {
    itemKey: "enterprise-dataset-inventory-current",
    title: "Enterprise Dataset Inventory",
    classification: "current_inventory_source",
    nextLane: "#65 current inventory rows",
    notes: "Use the live table rows as compact dataset inventory only.",
    entryIds: [5],
  },
  {
    itemKey: "enterprise-dataset-inventory-history",
    title: "Historical Enterprise Dataset Inventory tables",
    classification: "inventory_only",
    nextLane: "defer unless a history lane needs year-over-year comparison",
    notes:
      "Keep historical tables visible as source inventory without ingesting every year by default.",
    entryIds: [7, 11, 12, 21, 22, 26, 27, 31, 33],
  },
  {
    itemKey: "district-agencies",
    title: "District Government Agencies",
    classification: "active_structure_lane",
    nextLane: "covered by dcgis.agencies",
    notes: "This is already a structure lane, not a new dataset-inventory target.",
    entryIds: [6],
  },
  {
    itemKey: "district-boards-commissions-councils",
    title: "District Boards Commissions and Councils",
    classification: "active_structure_lane",
    nextLane: "covered by dcgis.boards_commissions_councils",
    notes:
      "Keep this visible here as catalog context, but route modeling through the existing structure source.",
    entryIds: [24],
  },
  {
    itemKey: "election-infrastructure",
    title: "Election infrastructure layers",
    classification: "inventory_only",
    nextLane: "retain shallow elections metadata only",
    notes:
      "Treat vote centers and drop boxes as metadata inventory, not a new BOE structure lane yet.",
    entryIds: [8, 9, 10],
  },
  {
    itemKey: "foia-tables",
    title: "FOIA tables and reports",
    classification: "defer_person_heavy_records",
    nextLane: "separate FOIA/privacy decision required",
    notes:
      "Do not ingest request rows or cumulative reports into the graph or release datasets beyond catalog visibility.",
    entryIds: [1, 14, 25, 28, 32, 34, 36],
  },
  {
    itemKey: "pass-procurement",
    title: "PASS / STaR2 procurement tables",
    classification: "inventory_only",
    nextLane: "keep at source inventory until a dedicated procurement lane exists",
    notes:
      "Expose the procurement family as official tables without turning transactions or solicitations into graph facts.",
    entryIds: [2, 3, 4, 16, 17, 18, 19, 20, 37],
  },
  {
    itemKey: "employee-salary",
    title: "DC Government Employee Salary",
    classification: "out_of_scope_person_heavy",
    nextLane: "do not ingest without a separate scope and privacy decision",
    notes: "Salary records are explicitly outside the civic-structure release surface.",
    entryIds: [35],
  },
];

export const adminEnterpriseDatasetInventoryConnector: SourceConnector = {
  sourceId: enterpriseDatasetInventorySource.sourceId,
  source: enterpriseDatasetInventorySource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const catalogEndpoint: SourceEndpointDefinition = {
      endpointId: "admin.enterprise_dataset_inventory.catalog",
      sourceId: enterpriseDatasetInventorySource.sourceId,
      title: "Government Operations catalog metadata",
      kind: "arcgis_service",
      url: governmentOperationsServiceUrl,
      method: "GET",
      captureMode: "schema",
    };
    const metadataEndpoint: SourceEndpointDefinition = {
      endpointId: "admin.enterprise_dataset_inventory.table_metadata",
      sourceId: enterpriseDatasetInventorySource.sourceId,
      title: "Enterprise Dataset Inventory table metadata",
      kind: "arcgis_table",
      url: enterpriseDatasetInventorySource.baseUrl,
      method: "GET",
      captureMode: "schema",
    };
    const rowsEndpoint: SourceEndpointDefinition = {
      endpointId: "admin.enterprise_dataset_inventory.rows",
      sourceId: enterpriseDatasetInventorySource.sourceId,
      title: "Enterprise Dataset Inventory rows",
      kind: "arcgis_table",
      url: enterpriseDatasetInventorySource.baseUrl,
      method: "GET",
      captureMode: "rows",
    };

    const catalogUrl = `${governmentOperationsServiceUrl}?f=json`;
    const catalogResponse = await context.fetcher(catalogUrl);
    const catalogText = await catalogResponse.text();
    const catalogPayload = JSON.parse(catalogText) as Record<string, unknown>;

    const metadataUrl = `${enterpriseDatasetInventorySource.baseUrl}?f=json`;
    const metadataResponse = await context.fetcher(metadataUrl);
    const metadataText = await metadataResponse.text();
    const metadataPayload = JSON.parse(metadataText) as Record<string, unknown>;
    const fields: SourceFieldInput[] =
      ((metadataPayload.fields ?? []) as Array<Record<string, unknown>>)
        .map((field, index) => ({
          fieldName: String(field.name ?? ""),
          fieldType: String(field.type ?? "unknown"),
          fieldLabel: String(field.alias ?? field.name ?? ""),
          ordinal: index,
        }));

    const countUrl = buildArcGisQueryUrl(enterpriseDatasetInventorySource.baseUrl, {
      where: "1=1",
      returnCountOnly: "true",
      f: "json",
    });
    const countResponse = await context.fetcher(countUrl);
    const countText = await countResponse.text();
    const countPayload = JSON.parse(countText) as Record<string, unknown>;
    const totalCount = Math.max(0, Number(countPayload.count ?? 0));
    const requestedCount = typeof context.limit === "number"
      ? Math.min(totalCount, context.limit)
      : totalCount;
    const maxRecordCount = Math.max(1, Number(metadataPayload.maxRecordCount ?? 1000));

    const rowArtifacts: ReturnType<typeof artifact>[] = [];
    const items: SourceItemInput[] = [];
    const datasets: DatasetInput[] = [];

    for (let offset = 0; offset < requestedCount; offset += maxRecordCount) {
      const pageSize = Math.min(maxRecordCount, requestedCount - offset);
      const pageUrl = buildArcGisQueryUrl(enterpriseDatasetInventorySource.baseUrl, {
        where: "1=1",
        outFields: "*",
        orderByFields: "OBJECTID",
        returnGeometry: "false",
        resultOffset: String(offset),
        resultRecordCount: String(pageSize),
        f: "json",
      });
      const pageResponse = await context.fetcher(pageUrl);
      const pageText = await pageResponse.text();
      const pagePayload = JSON.parse(pageText) as Record<string, unknown>;
      const artifactIndex = rowArtifacts.length;
      rowArtifacts.push(artifact("rows", "json", pageUrl, pageText));
      for (const feature of (pagePayload.features ?? []) as Array<Record<string, unknown>>) {
        const attributes = (feature.attributes ?? {}) as Record<string, unknown>;
        const objectId = Number(attributes.OBJECTID ?? 0);
        const rawDatasetId = String(attributes.DATASET_ID ?? `objectid-${objectId}`);
        const datasetName = String(attributes.DATASET_NAME ?? rawDatasetId);
        const datasetUrl = toPublicHttpUrl(
          enterpriseDatasetInventorySource.baseUrl,
          toOptionalString(attributes.DATASET_URL),
        );
        const systemUpdatedOn = formatArcGisDate(attributes.SYSTEM_UPDATED_ON);
        const itemKey = `dataset-${objectId || items.length + 1}`;
        items.push({
          itemKey,
          itemType: "enterprise_dataset_inventory_row",
          title: datasetName,
          artifactIndex,
          body: {
            datasetId: rawDatasetId,
            publicationStatus: toOptionalString(attributes.PUBLICATION_STATUS),
            agencyName: toOptionalString(attributes.AGENCY_NAME),
            datasetName,
            datasetCategory: toOptionalString(attributes.DATASET_CATEGORY),
            datasetStatus: toOptionalString(attributes.DATASET_STATUS),
            datasetUrl,
            systemUpdatedOn,
            objectId,
            sourceTableUrl: enterpriseDatasetInventorySource.baseUrl,
            sourceRow: attributes,
          },
        });
        datasets.push({
          datasetId: buildDatasetId(enterpriseDatasetInventorySource.sourceId, rawDatasetId),
          sourceItemKey: itemKey,
          name: datasetName,
          category: normalizeDatasetCategory(
            toOptionalString(attributes.DATASET_CATEGORY) ?? "dataset inventory",
          ),
          ownerName: toOptionalString(attributes.AGENCY_NAME),
          accessMethod: enterpriseDatasetInventorySource.accessMethod,
          artifactDepth: "rows",
          officialUrl: datasetUrl,
          evidence: [
            fieldEvidence("DATASET_ID", rawDatasetId, artifactIndex),
            fieldEvidence(
              "AGENCY_NAME",
              toOptionalString(attributes.AGENCY_NAME) ?? "",
              artifactIndex,
            ),
            fieldEvidence(
              "DATASET_STATUS",
              toOptionalString(attributes.DATASET_STATUS) ?? "",
              artifactIndex,
            ),
          ],
        });
      }
    }

    return {
      source: enterpriseDatasetInventorySource,
      endpointResults: [
        {
          endpoint: catalogEndpoint,
          status: "success",
          artifacts: [artifact("schema", "json", catalogUrl, catalogText)],
          parsed: {
            items: buildGovernmentOperationsCatalogItems(catalogPayload),
          },
        },
        {
          endpoint: metadataEndpoint,
          status: "success",
          artifacts: [artifact("schema", "json", metadataUrl, metadataText)],
          parsed: {
            fields,
          },
        },
        {
          endpoint: rowsEndpoint,
          status: "success",
          artifacts: rowArtifacts,
          parsed: {
            items,
            datasets,
          },
        },
      ],
    };
  },
};

interface ArcGisLayerTarget {
  id: number;
  category: string;
}

interface ArcGisCatalogSpec {
  source: SourceDefinition;
  endpointId: string;
  endpointTitle: string;
  serviceUrl: string;
  targets: ArcGisLayerTarget[];
}

function buildArcGisCatalogConnector(spec: ArcGisCatalogSpec): SourceConnector {
  return {
    sourceId: spec.source.sourceId,
    source: spec.source,
    async run(context: ConnectorContext): Promise<ConnectorResult> {
      const endpoint: SourceEndpointDefinition = {
        endpointId: spec.endpointId,
        sourceId: spec.source.sourceId,
        title: spec.endpointTitle,
        kind: "arcgis_service",
        url: spec.serviceUrl,
        method: "GET",
        captureMode: "schema_sample",
      };
      const serviceUrl = `${spec.serviceUrl}?f=json`;
      const serviceResponse = await context.fetcher(serviceUrl);
      const serviceText = await serviceResponse.text();
      const servicePayload = JSON.parse(serviceText);
      const layers = (servicePayload.layers ?? []) as Array<Record<string, unknown>>;
      const layerById = new Map<number, Record<string, unknown>>();
      for (const layer of layers) {
        layerById.set(Number(layer.id), layer);
      }
      const selected = spec.targets.filter((target) => layerById.has(target.id));
      const detailArtifacts: string[] = [];
      const items: SourceItemInput[] = [];
      const datasets: DatasetInput[] = [];
      const fields: SourceFieldInput[] = [];

      for (const target of selected) {
        const layer = layerById.get(target.id) ?? {};
        const layerName = String(layer.name ?? `Layer ${target.id}`);
        const layerUrl = `${spec.serviceUrl}/${target.id}`;
        const detailUrl = `${layerUrl}?f=json`;
        const detailResponse = await context.fetcher(detailUrl);
        const detailText = await detailResponse.text();
        const detailPayload = JSON.parse(detailText);
        detailArtifacts.push(detailText);
        const itemKey = `layer-${target.id}`;
        items.push({
          itemKey,
          itemType: "dataset_layer",
          title: layerName,
          body: {
            layerId: target.id,
            serviceUrl: spec.serviceUrl,
            layerUrl,
            category: target.category,
            description: detailPayload.description ?? "",
            maxRecordCount: detailPayload.maxRecordCount ?? null,
            capabilities: detailPayload.capabilities ?? null,
            supportsPagination: detailPayload.advancedQueryCapabilities?.supportsPagination ?? null,
          },
          artifactIndex: items.length + 1,
        });
        datasets.push({
          datasetId: buildDatasetId(spec.source.sourceId, itemKey),
          sourceItemKey: itemKey,
          name: layerName,
          category: target.category,
          ownerName: "District of Columbia",
          accessMethod: "official_arcgis_rest",
          artifactDepth: "schema",
          officialUrl: layerUrl,
          evidence: [
            fieldEvidence("layerId", target.id, items.length),
            fieldEvidence("capabilities", detailPayload.capabilities ?? "", items.length),
          ],
        });
        for (
          const [index, field] of ((detailPayload.fields ?? []) as Array<Record<string, unknown>>)
            .entries()
        ) {
          fields.push({
            fieldName: `${itemKey}.${String(field.name)}`,
            fieldType: String(field.type ?? "unknown"),
            fieldLabel: String(field.alias ?? field.name),
            ordinal: index,
            artifactIndex: items.length,
          });
        }
      }

      return {
        source: spec.source,
        endpointResults: [{
          endpoint,
          status: "success",
          artifacts: [
            artifact("schema", "json", serviceUrl, serviceText),
            ...selected.map((target, index) =>
              artifact(
                "schema",
                "json",
                `${spec.serviceUrl}/${target.id}?f=json`,
                detailArtifacts[index],
              )
            ),
          ],
          parsed: {
            fields,
            items,
            datasets,
          },
        }],
      };
    },
  };
}

function buildGovernmentOperationsCatalogItems(
  payload: Record<string, unknown>,
): SourceItemInput[] {
  const entries = [
    ...((payload.layers ?? []) as Array<Record<string, unknown>>).map((entry) => ({
      id: Number(entry.id),
      name: String(entry.name ?? `Layer ${entry.id ?? "unknown"}`),
      entryType: "layer",
    })),
    ...((payload.tables ?? []) as Array<Record<string, unknown>>).map((entry) => ({
      id: Number(entry.id),
      name: String(entry.name ?? `Table ${entry.id ?? "unknown"}`),
      entryType: "table",
    })),
  ];
  return governmentOperationsCatalogGroups.flatMap((group) => {
    const matchedEntries = entries.filter((entry) => group.entryIds.includes(entry.id));
    if (matchedEntries.length === 0) return [];
    return [{
      itemKey: group.itemKey,
      itemType: "government_operations_catalog_group",
      title: group.title,
      body: {
        classification: group.classification,
        nextLane: group.nextLane,
        notes: group.notes,
        matchedEntries,
      },
    }];
  });
}

function buildArcGisQueryUrl(
  baseUrl: string,
  params: Record<string, string>,
): string {
  const url = new URL(`${baseUrl}/query`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function formatArcGisDate(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return new Date(value).toISOString();
}

function normalizeDatasetCategory(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ||
    "dataset_inventory";
}

function toOptionalString(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return text ? text : undefined;
}

const adminPermitSource: SourceDefinition = {
  sourceId: "admin.permits_licenses",
  title: "Permits and Business Licensing Metadata",
  kind: "dataset_metadata",
  accessMethod: "official_arcgis_rest",
  baseUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/MapServer",
};

export const adminPermitsConnector = buildArcGisCatalogConnector({
  source: adminPermitSource,
  endpointId: "admin.permits_licenses.catalog",
  endpointTitle: "Permits and licenses layer metadata",
  serviceUrl: adminPermitSource.baseUrl,
  targets: [
    { id: 46, category: "permits" },
    { id: 45, category: "permits" },
    { id: 5, category: "business_licenses" },
  ],
});

const adminCrimeSource: SourceDefinition = {
  sourceId: "admin.crime_public_safety",
  title: "Crime and Public Safety Dataset Metadata",
  kind: "dataset_metadata",
  accessMethod: "official_arcgis_rest",
  baseUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer",
};

export const adminCrimeConnector = buildArcGisCatalogConnector({
  source: adminCrimeSource,
  endpointId: "admin.crime_public_safety.catalog",
  endpointTitle: "Crime and public safety layer metadata",
  serviceUrl: adminCrimeSource.baseUrl,
  targets: [
    { id: 7, category: "crime_incidents" },
    { id: 24, category: "crime_incidents" },
    { id: 29, category: "crime_incidents" },
  ],
});

const adminPropertySource: SourceDefinition = {
  sourceId: "admin.property_land",
  title: "Property and Land Dataset Metadata",
  kind: "dataset_metadata",
  accessMethod: "official_arcgis_rest",
  baseUrl: "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer",
};

export const adminPropertyConnector = buildArcGisCatalogConnector({
  source: adminPropertySource,
  endpointId: "admin.property_land.catalog",
  endpointTitle: "Property and land layer metadata",
  serviceUrl: adminPropertySource.baseUrl,
  targets: [
    { id: 10, category: "permits" },
    { id: 39, category: "property" },
    { id: 33, category: "property" },
    { id: 35, category: "property" },
  ],
});

const adminElectionsSource: SourceDefinition = {
  sourceId: "admin.elections",
  title: "Elections Location Dataset Metadata",
  kind: "dataset_metadata",
  accessMethod: "official_arcgis_rest",
  baseUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer",
};

export const adminElectionsConnector = buildArcGisCatalogConnector({
  source: adminElectionsSource,
  endpointId: "admin.elections.catalog",
  endpointTitle: "Election infrastructure layer metadata",
  serviceUrl: adminElectionsSource.baseUrl,
  targets: [
    { id: 8, category: "elections" },
    { id: 9, category: "elections" },
    { id: 10, category: "elections" },
  ],
});

const adminProcurementSource: SourceDefinition = {
  sourceId: "admin.procurement_sources",
  title: "Procurement and Contracts Public Sources",
  kind: "source_index",
  accessMethod: "official_page_html",
  baseUrl: "https://ocp.dc.gov/page/doing-business-dc-government",
};

export const adminProcurementConnector: SourceConnector = {
  sourceId: adminProcurementSource.sourceId,
  source: adminProcurementSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const endpoint: SourceEndpointDefinition = {
      endpointId: "admin.procurement_sources.main",
      sourceId: adminProcurementSource.sourceId,
      title: "Procurement source index",
      kind: "page",
      url: adminProcurementSource.baseUrl,
      method: "GET",
      captureMode: "documents",
    };
    const response = await context.fetcher(adminProcurementSource.baseUrl);
    const html = await response.text();
    const items: SourceItemInput[] = [
      {
        itemKey: "ocp-doing-business",
        itemType: "procurement_source",
        title: "OCP Doing Business with DC Government",
        body: { url: adminProcurementSource.baseUrl },
      },
      {
        itemKey: "pass-solicitations",
        itemType: "procurement_source",
        title: "PASS Procurement Automated Support System",
        body: { url: "https://contracts.ocp.dc.gov/" },
      },
      {
        itemKey: "purchase-card-data",
        itemType: "procurement_source",
        title: "Purchase Card Transactions",
        body: { url: "https://opencheckbook.dc.gov/" },
      },
    ];
    const datasets: DatasetInput[] = items.map((item) => ({
      datasetId: buildDatasetId(adminProcurementSource.sourceId, item.itemKey),
      sourceItemKey: item.itemKey,
      name: item.title,
      category: "procurement",
      ownerName: "District of Columbia",
      accessMethod: adminProcurementSource.accessMethod,
      artifactDepth: "page",
      officialUrl: String(item.body.url ?? adminProcurementSource.baseUrl),
      evidence: [fieldEvidence("url", item.body.url ?? "")],
    }));
    return {
      source: adminProcurementSource,
      endpointResults: [{
        endpoint,
        status: "success",
        artifacts: [artifact("page", "html", adminProcurementSource.baseUrl, html)],
        parsed: {
          items,
          datasets,
        },
      }],
    };
  },
};

const adminBudgetSource: SourceDefinition = {
  sourceId: "admin.budget_sources",
  title: "Budget and OCFO Publication Sources",
  kind: "source_index",
  accessMethod: "official_page_html",
  baseUrl: "https://cfo.dc.gov/budget",
};

export const adminBudgetConnector: SourceConnector = {
  sourceId: adminBudgetSource.sourceId,
  source: adminBudgetSource,
  async run(context: ConnectorContext): Promise<ConnectorResult> {
    const endpoint: SourceEndpointDefinition = {
      endpointId: "admin.budget_sources.main",
      sourceId: adminBudgetSource.sourceId,
      title: "Budget source index",
      kind: "page",
      url: adminBudgetSource.baseUrl,
      method: "GET",
      captureMode: "documents",
    };
    const response = await context.fetcher(adminBudgetSource.baseUrl);
    const html = await response.text();
    const items: SourceItemInput[] = [
      {
        itemKey: "ocfo-budget-page",
        itemType: "budget_source",
        title: "OCFO Budget Publications",
        body: { url: adminBudgetSource.baseUrl },
      },
      {
        itemKey: "ocfo-opencheckbook",
        itemType: "budget_source",
        title: "Open Checkbook",
        body: { url: "https://opencheckbook.dc.gov/" },
      },
    ];
    const datasets: DatasetInput[] = items.map((item) => ({
      datasetId: buildDatasetId(adminBudgetSource.sourceId, item.itemKey),
      sourceItemKey: item.itemKey,
      name: item.title,
      category: "budget",
      ownerName: "District of Columbia",
      accessMethod: adminBudgetSource.accessMethod,
      artifactDepth: "page",
      officialUrl: String(item.body.url ?? adminBudgetSource.baseUrl),
      evidence: [fieldEvidence("url", item.body.url ?? "")],
    }));
    return {
      source: adminBudgetSource,
      endpointResults: [{
        endpoint,
        status: "success",
        artifacts: [artifact("page", "html", adminBudgetSource.baseUrl, html)],
        parsed: { items, datasets },
      }],
    };
  },
};
