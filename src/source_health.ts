import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { sourceDefinitions } from "./source_definitions.ts";
import { snapshotPath } from "./snapshots.ts";
import { writeJsonFile } from "./io.ts";

export interface SourceBaseline {
  source_id: string;
  source_url: string;
  captured_at: string;
  kind: "arcgis_table" | "arcgis_metadata" | "page_manifest" | "json_api_manifest" | "unknown";
  link_urls?: string[];
  asset_urls?: string[];
  endpoint_ids?: string[];
  field_names?: string[];
  row_count?: number;
}

export interface SourceHealthDiff {
  sourceId: string;
  status: "unchanged" | "changed" | "missing_baseline" | "missing_snapshot";
  baselineKind: SourceBaseline["kind"] | null;
  currentKind: SourceBaseline["kind"] | null;
  addedLinks: string[];
  removedLinks: string[];
  addedAssets: string[];
  removedAssets: string[];
  addedEndpoints: string[];
  removedEndpoints: string[];
  addedFields: string[];
  removedFields: string[];
  rowCountBefore: number | null;
  rowCountAfter: number | null;
  baselinePath: string;
  snapshotPath: string;
}

export async function writeSourceBaseline(
  repoPath: string,
  sourceId: string,
  baseline?: SourceBaseline,
): Promise<SourceBaseline> {
  const nextBaseline = baseline ?? await baselineFromSnapshot(repoPath, sourceId);
  const path = sourceBaselinePath(repoPath, sourceId);
  await ensureDir(dirname(path));
  await writeJsonFile(path, nextBaseline);
  return nextBaseline;
}

export async function compareSourceToBaseline(
  repoPath: string,
  sourceId: string,
): Promise<SourceHealthDiff> {
  const baselinePath = sourceBaselinePath(repoPath, sourceId);
  const latestPath = snapshotPath(repoPath, sourceId);
  const baseline = await readJson<SourceBaseline>(baselinePath);
  if (!baseline) return emptyDiff(sourceId, "missing_baseline", baselinePath, latestPath);
  const current = await readJson<Record<string, unknown>>(latestPath);
  if (!current) return emptyDiff(sourceId, "missing_snapshot", baselinePath, latestPath);

  const currentBaseline = baselineFromSnapshotPayload(sourceId, current);
  const addedLinks = difference(currentBaseline.link_urls ?? [], baseline.link_urls ?? []);
  const removedLinks = difference(baseline.link_urls ?? [], currentBaseline.link_urls ?? []);
  const addedAssets = difference(currentBaseline.asset_urls ?? [], baseline.asset_urls ?? []);
  const removedAssets = difference(baseline.asset_urls ?? [], currentBaseline.asset_urls ?? []);
  const addedEndpoints = difference(
    currentBaseline.endpoint_ids ?? [],
    baseline.endpoint_ids ?? [],
  );
  const removedEndpoints = difference(
    baseline.endpoint_ids ?? [],
    currentBaseline.endpoint_ids ?? [],
  );
  const addedFields = difference(currentBaseline.field_names ?? [], baseline.field_names ?? []);
  const removedFields = difference(baseline.field_names ?? [], currentBaseline.field_names ?? []);
  const rowCountBefore = baseline.row_count ?? null;
  const rowCountAfter = currentBaseline.row_count ?? null;
  const status = baseline.kind !== currentBaseline.kind ||
      addedLinks.length ||
      removedLinks.length ||
      addedAssets.length ||
      removedAssets.length ||
      addedEndpoints.length ||
      removedEndpoints.length ||
      addedFields.length ||
      removedFields.length
    ? "changed"
    : "unchanged";

  return {
    sourceId,
    status,
    baselineKind: baseline.kind,
    currentKind: currentBaseline.kind,
    addedLinks,
    removedLinks,
    addedAssets,
    removedAssets,
    addedEndpoints,
    removedEndpoints,
    addedFields,
    removedFields,
    rowCountBefore,
    rowCountAfter,
    baselinePath,
    snapshotPath: latestPath,
  };
}

export async function compareAllSourcesToBaselines(
  repoPath: string,
  sourceIds = Object.keys(sourceDefinitions),
): Promise<SourceHealthDiff[]> {
  const diffs: SourceHealthDiff[] = [];
  for (const sourceId of sourceIds) {
    diffs.push(await compareSourceToBaseline(repoPath, sourceId));
  }
  return diffs;
}

export function renderSourceHealth(diffs: SourceHealthDiff[]): string {
  const lines = ["Source health", "", "Status            Source", "------            ------"];
  for (const diff of diffs) {
    lines.push(`${diff.status.padEnd(16)}  ${diff.sourceId}`);
    if (
      diff.baselineKind && diff.currentKind &&
      diff.baselineKind !== diff.currentKind
    ) {
      lines.push(`  kind: ${diff.baselineKind} -> ${diff.currentKind}`);
    }
    if (diff.addedLinks.length) lines.push(`  added links: ${diff.addedLinks.length}`);
    if (diff.removedLinks.length) lines.push(`  removed links: ${diff.removedLinks.length}`);
    if (diff.addedAssets.length) lines.push(`  added assets: ${diff.addedAssets.length}`);
    if (diff.removedAssets.length) lines.push(`  removed assets: ${diff.removedAssets.length}`);
    if (diff.addedEndpoints.length) {
      lines.push(`  added endpoints: ${diff.addedEndpoints.join(", ")}`);
    }
    if (diff.removedEndpoints.length) {
      lines.push(`  removed endpoints: ${diff.removedEndpoints.join(", ")}`);
    }
    if (diff.addedFields.length) lines.push(`  added fields: ${diff.addedFields.join(", ")}`);
    if (diff.removedFields.length) lines.push(`  removed fields: ${diff.removedFields.join(", ")}`);
    if (
      diff.rowCountBefore !== null && diff.rowCountAfter !== null &&
      diff.rowCountBefore !== diff.rowCountAfter
    ) {
      lines.push(`  row count: ${diff.rowCountBefore} -> ${diff.rowCountAfter}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function sourceBaselinePath(repoPath: string, sourceId: string): string {
  return join(repoPath, "snapshots", ...sourceId.split("."), "baseline.json");
}

async function baselineFromSnapshot(repoPath: string, sourceId: string): Promise<SourceBaseline> {
  const snapshot = await readJson<Record<string, unknown>>(snapshotPath(repoPath, sourceId));
  if (!snapshot) throw new Error(`No latest snapshot for ${sourceId}`);
  return baselineFromSnapshotPayload(sourceId, snapshot);
}

function baselineFromSnapshotPayload(
  sourceId: string,
  snapshot: Record<string, unknown>,
): SourceBaseline {
  const payload = (snapshot.payload ?? {}) as Record<string, unknown>;
  const definition = sourceDefinitions[sourceId];
  const kind = definition?.kind ?? inferKind(payload);
  const baseline: SourceBaseline = {
    source_id: sourceId,
    source_url: typeof snapshot.source_url === "string"
      ? snapshot.source_url
      : definition?.url ?? "",
    captured_at: new Date().toISOString(),
    kind,
  };

  if (kind === "page_manifest") {
    baseline.link_urls = extractLinkUrls(payload);
    baseline.asset_urls = extractAssetUrls(payload);
  }
  if (kind === "json_api_manifest") {
    baseline.endpoint_ids = extractEndpointIds(payload);
  }
  if (kind === "arcgis_table" || kind === "arcgis_metadata") {
    baseline.field_names = extractFieldNames(payload);
    baseline.row_count = typeof payload.row_count === "number" ? payload.row_count : undefined;
  }
  return baseline;
}

function extractEndpointIds(payload: Record<string, unknown>): string[] {
  const endpoints = Array.isArray(payload.endpoints) ? payload.endpoints : [];
  return endpoints
    .map((endpoint) =>
      typeof endpoint === "object" && endpoint !== null && !Array.isArray(endpoint)
        ? (endpoint as Record<string, unknown>).id
        : null
    )
    .filter((id): id is string => typeof id === "string")
    .sort();
}

function extractLinkUrls(payload: Record<string, unknown>): string[] {
  const links = Array.isArray(payload.links) ? payload.links : [];
  return links
    .map((link) =>
      typeof link === "object" && link !== null && !Array.isArray(link)
        ? (link as Record<string, unknown>).url
        : null
    )
    .filter((url): url is string => typeof url === "string")
    .sort();
}

function extractAssetUrls(payload: Record<string, unknown>): string[] {
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  return assets
    .map((asset) =>
      typeof asset === "object" && asset !== null && !Array.isArray(asset)
        ? (asset as Record<string, unknown>).url
        : null
    )
    .filter((url): url is string => typeof url === "string")
    .sort();
}

function extractFieldNames(payload: Record<string, unknown>): string[] {
  const metadata = payload.metadata;
  const fields = typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).fields
    : [];
  return (Array.isArray(fields) ? fields : [])
    .map((field) =>
      typeof field === "object" && field !== null && !Array.isArray(field)
        ? (field as Record<string, unknown>).name
        : null
    )
    .filter((name): name is string => typeof name === "string")
    .sort();
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch {
    return null;
  }
}

function difference(values: string[], baseline: string[]): string[] {
  const baselineSet = new Set(baseline);
  return values.filter((value) => !baselineSet.has(value)).sort();
}

function emptyDiff(
  sourceId: string,
  status: SourceHealthDiff["status"],
  baselinePath: string,
  latestPath: string,
): SourceHealthDiff {
  return {
    sourceId,
    status,
    baselineKind: null,
    currentKind: null,
    addedLinks: [],
    removedLinks: [],
    addedAssets: [],
    removedAssets: [],
    addedEndpoints: [],
    removedEndpoints: [],
    addedFields: [],
    removedFields: [],
    rowCountBefore: null,
    rowCountAfter: null,
    baselinePath,
    snapshotPath: latestPath,
  };
}

function inferKind(payload: Record<string, unknown>): SourceBaseline["kind"] {
  if (Array.isArray(payload.links)) return "page_manifest";
  if (Array.isArray(payload.endpoints)) return "json_api_manifest";
  if (payload.metadata) return "arcgis_table";
  return "unknown";
}
