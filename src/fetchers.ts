import {
  ArcgisMetadataSource,
  ArcgisTableSource,
  JsonApiManifestSource,
  PageManifestSource,
  sourceDefinitions,
} from "./source_definitions.ts";
import { failurePath, makeSnapshotEnvelope, writeFailure, writeSnapshot } from "./snapshots.ts";

export interface FetchLike {
  fetch(
    url: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;
}

export const liveFetch: FetchLike = {
  fetch(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
    return fetch(url, init);
  },
};

export interface FetchSourceResult {
  sourceId: string;
  status: "success" | "failed";
  path: string;
  rowCount?: number;
  itemCount?: number;
}

export async function fetchSource(
  repoPath: string,
  sourceId: string,
  http: FetchLike = liveFetch,
): Promise<FetchSourceResult> {
  const definition = sourceDefinitions[sourceId];
  if (!definition) throw new Error(`Unknown source id ${sourceId}`);
  if (definition.kind === "arcgis_table") return fetchArcgisTable(repoPath, definition, http);
  if (definition.kind === "arcgis_metadata") {
    return fetchArcgisMetadata(repoPath, definition, http);
  }
  if (definition.kind === "json_api_manifest") {
    return fetchJsonApiManifest(repoPath, definition, http);
  }
  return fetchPageManifest(repoPath, definition, http);
}

export async function fetchArcgisMetadata(
  repoPath: string,
  definition: ArcgisMetadataSource,
  http: FetchLike = liveFetch,
): Promise<FetchSourceResult> {
  try {
    const metadata = await getJson(http, `${definition.url}?f=json`);
    const rowCount = await fetchRowCount(http, definition.url);
    const payload = {
      source_title: definition.title,
      table_name: definition.table_name,
      metadata,
      row_count: rowCount,
      row_capture: "metadata_only",
    };
    const envelope = await makeSnapshotEnvelope(definition.id, definition.url, payload);
    const path = await writeSnapshot(repoPath, envelope);
    await Deno.remove(failurePath(repoPath, definition.id)).catch(() => {});
    return { sourceId: definition.id, status: "success", path, rowCount };
  } catch (error) {
    const path = await writeFailure(repoPath, {
      source_id: definition.id,
      source_url: definition.url,
      fetched_at: new Date().toISOString(),
      status: "failed",
      failure_mode: "fetch_failed",
      error_summary: error instanceof Error ? error.message : String(error),
      recommended_follow_up:
        "Verify the ArcGIS metadata endpoint and keep this failure manifest visible until the source lane is repaired or documented as deferred.",
    });
    return { sourceId: definition.id, status: "failed", path };
  }
}

export async function fetchArcgisTable(
  repoPath: string,
  definition: ArcgisTableSource,
  http: FetchLike = liveFetch,
): Promise<FetchSourceResult> {
  try {
    const metadata = await getJson(http, `${definition.url}?f=json`);
    const rows = await fetchAllRows(http, definition.url);
    const payload = {
      source_title: definition.title,
      table_name: definition.table_name,
      metadata,
      rows,
      row_count: rows.length,
    };
    const envelope = await makeSnapshotEnvelope(definition.id, definition.url, payload);
    const path = await writeSnapshot(repoPath, envelope);
    await Deno.remove(failurePath(repoPath, definition.id)).catch(() => {});
    return { sourceId: definition.id, status: "success", path, rowCount: rows.length };
  } catch (error) {
    const path = await writeFailure(repoPath, {
      source_id: definition.id,
      source_url: definition.url,
      fetched_at: new Date().toISOString(),
      status: "failed",
      failure_mode: "fetch_failed",
      error_summary: error instanceof Error ? error.message : String(error),
      recommended_follow_up:
        "Verify the official endpoint and keep this failure manifest visible until the source lane is repaired or documented as deferred.",
    });
    return { sourceId: definition.id, status: "failed", path };
  }
}

export async function fetchPageManifest(
  repoPath: string,
  definition: PageManifestSource,
  http: FetchLike = liveFetch,
): Promise<FetchSourceResult> {
  try {
    const response = await http.fetch(definition.url);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `HTTP ${response.status} from ${definition.url}${text ? `: ${text.slice(0, 120)}` : ""}`,
      );
    }
    const html = await response.text();
    const links = extractLinks(html, definition.url);
    const assets = extractAssets(html, definition.url);
    const payload = {
      source_title: definition.title,
      page_title: extractTitle(html) ?? definition.title,
      fetched_url: definition.url,
      link_count: links.length,
      asset_count: assets.length,
      manifest_item_count: links.length + assets.length,
      links,
      assets,
    };
    const envelope = await makeSnapshotEnvelope(definition.id, definition.url, payload);
    const path = await writeSnapshot(repoPath, envelope);
    await Deno.remove(failurePath(repoPath, definition.id)).catch(() => {});
    return {
      sourceId: definition.id,
      status: "success",
      path,
      itemCount: links.length + assets.length,
    };
  } catch (error) {
    const path = await writeFailure(repoPath, {
      source_id: definition.id,
      source_url: definition.url,
      fetched_at: new Date().toISOString(),
      status: "failed",
      failure_mode: "fetch_failed",
      error_summary: error instanceof Error ? error.message : String(error),
      recommended_follow_up:
        "Verify the publication page manually and keep this failure manifest visible until a stable manifest or documented gap exists.",
    });
    return { sourceId: definition.id, status: "failed", path };
  }
}

export async function fetchJsonApiManifest(
  repoPath: string,
  definition: JsonApiManifestSource,
  http: FetchLike = liveFetch,
): Promise<FetchSourceResult> {
  try {
    const endpoints = [];
    for (const endpoint of definition.endpoints) {
      const response = await http.fetch(endpoint.url, {
        method: endpoint.method ?? "GET",
        body: endpoint.body === undefined ? undefined : JSON.stringify(endpoint.body),
        headers: endpoint.body === undefined ? undefined : { "Content-Type": "application/json" },
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const normalizedJson = normalizeJsonPayload(json);
      endpoints.push({
        id: endpoint.id,
        url: endpoint.url,
        method: endpoint.method ?? "GET",
        status: response.status,
        ok: response.ok,
        item_count: countJsonItems(normalizedJson),
        sample: sampleJson(normalizedJson),
      });
    }

    const failed = endpoints.filter((endpoint) => !endpoint.ok);
    if (failed.length > 0) {
      throw new Error(
        `JSON API endpoint failure(s): ${
          failed.map((endpoint) => `${endpoint.id} HTTP ${endpoint.status}`).join(", ")
        }`,
      );
    }

    const payload = {
      source_title: definition.title,
      page_url: definition.url,
      endpoint_count: endpoints.length,
      total_item_count: sumEndpointItemCounts(endpoints),
      endpoints,
    };
    const envelope = await makeSnapshotEnvelope(definition.id, definition.url, payload);
    const path = await writeSnapshot(repoPath, envelope);
    await Deno.remove(failurePath(repoPath, definition.id)).catch(() => {});
    return {
      sourceId: definition.id,
      status: "success",
      path,
      itemCount: sumEndpointItemCounts(endpoints) ?? endpoints.length,
    };
  } catch (error) {
    const path = await writeFailure(repoPath, {
      source_id: definition.id,
      source_url: definition.url,
      fetched_at: new Date().toISOString(),
      status: "failed",
      failure_mode: "fetch_failed",
      error_summary: error instanceof Error ? error.message : String(error),
      recommended_follow_up:
        "Verify the JSON API endpoint manifest manually and keep this failure manifest visible until the source lane is repaired or documented as deferred.",
    });
    return { sourceId: definition.id, status: "failed", path };
  }
}

async function fetchAllRows(http: FetchLike, tableUrl: string): Promise<Record<string, unknown>[]> {
  const url =
    `${tableUrl}/query?where=1%3D1&outFields=*&returnGeometry=false&f=json&resultOffset=0&resultRecordCount=2000`;
  const payload = await getJson(http, url);
  if (typeof payload !== "object" || payload === null) {
    throw new Error("ArcGIS query returned a non-object payload.");
  }
  const root = payload as Record<string, unknown>;
  if (Array.isArray(root.features)) {
    return root.features.map((feature) => {
      if (typeof feature === "object" && feature !== null && !Array.isArray(feature)) {
        const attributes = (feature as Record<string, unknown>).attributes;
        if (typeof attributes === "object" && attributes !== null && !Array.isArray(attributes)) {
          return attributes as Record<string, unknown>;
        }
      }
      return {};
    });
  }
  if (Array.isArray(root.rows)) {
    return root.rows.filter((row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row)
    );
  }
  throw new Error("ArcGIS query returned no features.");
}

async function fetchRowCount(http: FetchLike, tableUrl: string): Promise<number> {
  const payload = await getJson(
    http,
    `${tableUrl}/query?where=1%3D1&returnCountOnly=true&f=json`,
  );
  if (typeof payload !== "object" || payload === null) {
    throw new Error("ArcGIS count query returned a non-object payload.");
  }
  const count = (payload as Record<string, unknown>).count;
  if (typeof count !== "number") {
    throw new Error("ArcGIS count query returned no count.");
  }
  return count;
}

async function getJson(http: FetchLike, url: string): Promise<unknown> {
  const response = await http.fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} from ${url}${text ? `: ${text.slice(0, 120)}` : ""}`);
  }
  return response.json();
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(stripTags(match[1]).trim()) : null;
}

function extractLinks(html: string, baseUrl: string): { url: string; text: string }[] {
  const links = new Map<string, string>();
  const anchorPattern = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const href = decodeHtml(match[2]).trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      continue;
    }
    try {
      const url = new URL(href, baseUrl).toString();
      const text = decodeHtml(stripTags(match[3]).replace(/\s+/g, " ").trim());
      links.set(url, text);
    } catch {
      // Ignore malformed hrefs; the page manifest is an audit artifact, not a browser.
    }
  }
  return [...links.entries()]
    .map(([url, text]) => ({ url, text }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

function extractAssets(html: string, baseUrl: string): { kind: string; url: string }[] {
  const assets = new Map<string, string>();
  for (const match of html.matchAll(/<script\b[^>]*src\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
    addAsset(assets, "script", match[2], baseUrl);
  }
  for (const match of html.matchAll(/<link\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
    const tag = match[0];
    const rel = tag.match(/\brel\s*=\s*(["'])(.*?)\1/i)?.[2]?.toLowerCase() ?? "";
    const kind = rel.includes("stylesheet") ? "stylesheet" : rel || "link";
    addAsset(assets, kind, match[2], baseUrl);
  }
  return [...assets.entries()]
    .map(([url, kind]) => ({ kind, url }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.url.localeCompare(b.url));
}

function addAsset(
  assets: Map<string, string>,
  kind: string,
  rawUrl: string,
  baseUrl: string,
): void {
  const value = decodeHtml(rawUrl).trim();
  if (!value || value.startsWith("data:")) return;
  try {
    assets.set(new URL(value, baseUrl).toString(), kind);
  } catch {
    // Ignore malformed asset references; manifests are audit evidence, not full browser emulation.
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function countJsonItems(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.results)) return record.results.length;
    if (Array.isArray(record.data)) return record.data.length;
    if (Array.isArray(record.list)) return record.list.length;
    if (typeof record.pagination === "object" && record.pagination !== null) {
      const totalCount = (record.pagination as Record<string, unknown>).totalCount;
      if (typeof totalCount === "number") return totalCount;
    }
  }
  return null;
}

function normalizeJsonPayload(value: unknown): unknown {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.d === "string") {
      try {
        return JSON.parse(record.d);
      } catch {
        return value;
      }
    }
  }
  return value;
}

function sumEndpointItemCounts(endpoints: { item_count: number | null }[]): number | null {
  let total = 0;
  for (const endpoint of endpoints) {
    if (endpoint.item_count === null) return null;
    total += endpoint.item_count;
  }
  return total;
}

function sampleJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 3);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 8));
  }
  return value;
}
