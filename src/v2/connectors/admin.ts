import {
  buildDatasetId,
  type ConnectorResult,
  type DatasetInput,
  type SourceDefinition,
  type SourceEndpointDefinition,
  type SourceFieldInput,
  type SourceItemInput,
} from "../domain.ts";
import { artifact, fieldEvidence } from "./shared.ts";
import type { ConnectorContext, SourceConnector } from "./shared.ts";

const admin311Source: SourceDefinition = {
  sourceId: "admin.service_requests_311",
  title: "311 Service Requests",
  kind: "dataset_metadata",
  accessMethod: "official_arcgis_rest",
  baseUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Service_WebMercator/MapServer/33",
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
      title: String(payload.name ?? "311 Service Requests"),
      body: payload,
    };
    const dataset: DatasetInput = {
      datasetId: buildDatasetId(admin311Source.sourceId, "schema"),
      sourceItemKey: "schema",
      name: String(payload.name ?? "311 Service Requests"),
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
        for (const [index, field] of ((detailPayload.fields ?? []) as Array<Record<string, unknown>>).entries()) {
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
          artifacts: [artifact("schema", "json", serviceUrl, serviceText), ...selected.map((target, index) =>
            artifact(
              "schema",
              "json",
              `${spec.serviceUrl}/${target.id}?f=json`,
              detailArtifacts[index],
            )
          )],
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
  baseUrl:
    "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer",
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
