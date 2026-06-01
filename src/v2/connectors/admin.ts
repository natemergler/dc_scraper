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
