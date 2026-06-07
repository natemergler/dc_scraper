import {
  type Reader,
  type ReaderInput,
  type ReaderResult,
  type ReaderResultRecord,
  type ReaderResultSnapshot,
  type ReaderSource,
} from "./types.ts";

export type ArcGISJsonResponse = {
  features?: Array<{ attributes: Record<string, unknown> }>;
  exceededTransferLimit?: boolean;
  objectIdFieldName?: string;
  error?: {
    code?: number;
    message?: string;
    details?: string[];
  };
};

export interface ArcGISTableSource extends ReaderSource {
  type: "arcgis.table";
  tableUrl: string;
  outFields?: string[];
  where?: string;
  pageSize?: number;
  objectIdField?: string;
  idField?: string;
}

export interface ArcGISTableReaderOptions {
  fetcher?: (input: string) => Promise<Response>;
  defaultPageSize?: number;
}

export class ArcGISTableReader implements Reader<ArcGISTableSource> {
  private readonly fetcher: (input: string) => Promise<Response>;
  private readonly defaultPageSize: number;

  constructor(options: ArcGISTableReaderOptions = {}) {
    this.fetcher = options.fetcher ?? ((input: string) => fetch(input));
    this.defaultPageSize = options.defaultPageSize ?? 500;
  }

  async collect(input: ReaderInput<ArcGISTableSource>): Promise<ReaderResult> {
    const { source, limit } = input;
    const pageSize = source.pageSize ?? this.defaultPageSize;
    const idField = source.idField ?? source.objectIdField ?? "OBJECTID";

    const snapshots: ReaderResultSnapshot[] = [];
    const records: ReaderResultRecord[] = [];

    let offset = 0;
    let page = 0;
    let remaining = limit;

    while (true) {
      if (typeof remaining === "number" && remaining <= 0) {
        break;
      }

      const pageLimit = typeof remaining === "number" ? Math.min(pageSize, remaining) : pageSize;
      const pagePayload = await this.fetchPage(source, offset, pageLimit);
      const features = pagePayload.features ?? [];
      const snapshotKey = `page-${page}`;
      snapshots.push({
        source: source.id,
        key: snapshotKey,
        payload: {
          source: source.id,
          offset,
          limit: pageLimit,
          features,
          exceededTransferLimit: pagePayload.exceededTransferLimit ?? false,
          objectIdFieldName: pagePayload.objectIdFieldName ?? null,
          total: features.length,
        },
      });

      const selectedFeatures = typeof remaining === "number"
        ? features.slice(0, remaining)
        : features;
      for (const feature of selectedFeatures) {
        const sourceRecordId = this.getSourceRecordId(
          feature,
          idField,
          pagePayload.objectIdFieldName,
        );
        records.push({
          source: source.id,
          snapshotKey,
          key: sourceRecordId,
          payload: feature.attributes,
        });
      }

      if (typeof remaining === "number") {
        remaining -= selectedFeatures.length;
      }

      if (features.length === 0) {
        break;
      }
      if (typeof pagePayload.exceededTransferLimit === "boolean") {
        if (!pagePayload.exceededTransferLimit) {
          break;
        }
      } else if (features.length < pageLimit) {
        break;
      }

      if (typeof remaining === "number" && remaining <= 0) {
        break;
      }

      offset += pageLimit;
      page += 1;
    }

    return { snapshots, records };
  }

  private async fetchPage(
    source: ArcGISTableSource,
    offset: number,
    limit: number,
  ): Promise<ArcGISJsonResponse> {
    const url = new URL(source.tableUrl);
    const params = new URLSearchParams(url.search);
    params.set("where", source.where ?? "1=1");
    params.set("outFields", source.outFields?.join(",") ?? "*");
    params.set("f", "json");
    params.set("returnGeometry", "false");
    params.set("resultOffset", String(offset));
    params.set("resultRecordCount", String(limit));
    url.search = params.toString();

    let response: Response;
    try {
      response = await this.fetcher(url.toString());
    } catch (error) {
      throw new Error(
        `ArcGIS request failed for ${source.id}: ${
          error instanceof Error ? error.message : "network error"
        }`,
      );
    }

    const body = await response.text();
    let payload: ArcGISJsonResponse;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error(`ArcGIS response from ${source.id} is not valid JSON`);
    }

    if (!response.ok) {
      throw new Error(`ArcGIS request failed for ${source.id}: HTTP ${response.status}`);
    }

    if (payload.error) {
      const message = payload.error.message ?? "unknown ArcGIS error";
      throw new Error(`ArcGIS query error for ${source.id}: ${message}`);
    }

    if (!Array.isArray(payload.features)) {
      throw new Error(`ArcGIS response missing features for ${source.id}`);
    }

    return payload;
  }

  private getSourceRecordId(
    feature: { attributes: Record<string, unknown> },
    idField: string,
    fallbackObjectIdField?: string,
  ): string {
    const explicitId = feature.attributes[idField];
    const fallbackId = fallbackObjectIdField
      ? feature.attributes[fallbackObjectIdField]
      : undefined;
    const candidate = explicitId ?? fallbackId;
    if (typeof candidate === "string" || typeof candidate === "number") {
      return String(candidate);
    }
    if (typeof candidate === "bigint") {
      return candidate.toString();
    }
    throw new Error(`ArcGIS feature is missing identifier field ${idField}`);
  }
}
