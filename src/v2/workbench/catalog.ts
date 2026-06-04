import { normalizeName, nowIso } from "../domain.ts";
import { getConnector } from "../connectors.ts";
import { queryAll, queryOne, run } from "./db.ts";
import type { WorkbenchStore } from "./store.ts";
import type { SourceEndpointDefinition } from "../domain.ts";

export interface SourceSummary {
  sourceId: string;
  title: string;
  latestStatus?: string;
  latestRunFinishedAt?: string;
  latestArtifactPath?: string;
  itemCount: number;
  fieldCount: number;
  entityCandidateCount: number;
  relationshipCandidateCount: number;
}

export interface SourceListRow {
  sourceId: string;
  title: string;
  latestStatus?: string;
  latestRunFinishedAt?: string;
}

export interface PublicBodyComparisonSourceSummary {
  sourceId: string;
  title: string;
  latestStatus?: string;
  latestRunFinishedAt?: string;
  latestArtifactPath?: string;
  itemCount: number;
  fieldCount: number;
  entityCandidateCount: number;
  relationshipCandidateCount: number;
  normalizedNameCount: number;
  sharedNameCount: number;
  exclusiveNameCount: number;
}

export interface PublicBodyComparisonRow {
  normalizedName: string;
  displayName: string;
  sourceIds: string[];
  sourceTitles: string[];
}

export type PublicBodyVariantMatchKind =
  | "acronym_parenthetical"
  | "parenthetical_alias"
  | "governance_suffix";

export interface PublicBodyVariantMatchName {
  normalizedName: string;
  displayName: string;
  sourceId: string;
  sourceTitle: string;
}

export interface PublicBodyVariantMatch {
  variantName: string;
  matchKinds: PublicBodyVariantMatchKind[];
  sourceIds: string[];
  sourceTitles: string[];
  names: PublicBodyVariantMatchName[];
}

export interface PublicBodyComparisonReport {
  sourceSummaries: PublicBodyComparisonSourceSummary[];
  rows: PublicBodyComparisonRow[];
  sharedNameCount: number;
  exclusiveNameCount: number;
  conservativeVariantMatches: PublicBodyVariantMatch[];
  conservativeVariantMatchCount: number;
}

interface PublicBodyComparisonCandidateRow {
  normalizedName: string;
  displayName: string;
  sourceId: string;
  sourceTitle: string;
  kind: string;
  rawKind?: string | null;
}

export function upsertSource(
  store: WorkbenchStore,
  sourceId: string,
  title: string,
  kind: string,
  accessMethod: string,
  baseUrl: string,
  notes?: string,
): void {
  run(
    store.db,
    "insert or replace into sources(source_id, title, kind, access_method, base_url, notes, updated_at) values(?, ?, ?, ?, ?, ?, ?)",
    [sourceId, title, kind, accessMethod, baseUrl, notes ?? null, nowIso()],
  );
}

export function upsertEndpoint(store: WorkbenchStore, endpoint: SourceEndpointDefinition): void {
  run(
    store.db,
    "insert or replace into source_endpoints(endpoint_id, source_id, title, kind, url, method, capture_mode, updated_at) values(?, ?, ?, ?, ?, ?, ?, ?)",
    [
      endpoint.endpointId,
      endpoint.sourceId,
      endpoint.title,
      endpoint.kind,
      endpoint.url,
      endpoint.method,
      endpoint.captureMode,
      nowIso(),
    ],
  );
}

export function sourceSummary(store: WorkbenchStore, sourceId: string): SourceSummary {
  const source = queryOne<{ sourceId: string; title: string }>(
    store.db,
    "select source_id as sourceId, title from sources where source_id = ?",
    [sourceId],
  );
  if (!source) throw new Error(`Unknown source: ${sourceId}`);
  const latestRun = queryOne<{ latestStatus?: string; latestRunFinishedAt?: string }>(
    store.db,
    `select status as latestStatus, finished_at as latestRunFinishedAt
     from source_runs
     where source_id = ?
     order by coalesce(finished_at, started_at) desc
     limit 1`,
    [sourceId],
  );
  const latestArtifact = queryOne<{ latestArtifactPath?: string }>(
    store.db,
    `select source_artifacts.path as latestArtifactPath
     from source_artifacts
     join source_runs on source_runs.run_id = source_artifacts.run_id
     where source_runs.source_id = ?
     order by source_artifacts.created_at desc
     limit 1`,
    [sourceId],
  );
  const counts = queryOne<{
    itemCount: number;
    fieldCount: number;
    entityCandidateCount: number;
    relationshipCandidateCount: number;
  }>(
    store.db,
    `select
       (select count(*) from source_items where source_id = ?) as itemCount,
       (select count(*) from source_fields join source_endpoints on source_endpoints.endpoint_id = source_fields.endpoint_id where source_endpoints.source_id = ?) as fieldCount,
       (select count(*) from entity_candidates join source_items on source_items.source_item_id = entity_candidates.source_item_id where source_items.source_id = ?) as entityCandidateCount,
       (select count(*) from relationship_candidates join source_items on source_items.source_item_id = relationship_candidates.source_item_id where source_items.source_id = ?) as relationshipCandidateCount`,
    [sourceId, sourceId, sourceId, sourceId],
  );
  if (!counts) throw new Error(`No source summary counts for ${sourceId}`);
  return { ...source, ...latestRun, ...latestArtifact, ...counts };
}

export function listSources(store: WorkbenchStore): SourceListRow[] {
  return queryAll<SourceListRow>(
    store.db,
    `select
       sources.source_id as sourceId,
       sources.title as title,
       (
         select status from source_runs
         where source_runs.source_id = sources.source_id
         order by coalesce(finished_at, started_at) desc
         limit 1
       ) as latestStatus,
       (
         select finished_at from source_runs
         where source_runs.source_id = sources.source_id
         order by coalesce(finished_at, started_at) desc
         limit 1
       ) as latestRunFinishedAt
     from sources
    order by sources.source_id`,
  );
}

export function comparePublicBodies(store: WorkbenchStore): PublicBodyComparisonReport {
  const sourceIds = [
    "council.committees",
    "dcgis.boards_commissions_councils",
    "open_dc.public_bodies",
    "mota.quickbase",
    "oanc.anc_profiles",
  ] as const;
  const sourceRows = sourceIds.map((sourceId) => sourceSummaryOrConfigured(store, sourceId));
  const rows = queryAll<PublicBodyComparisonCandidateRow>(
    store.db,
    `select
       entity_candidates.normalized_name as normalizedName,
       entity_candidates.name as displayName,
       sources.source_id as sourceId,
       sources.title as sourceTitle,
       entity_candidates.kind as kind,
       entity_candidates.raw_kind as rawKind
     from entity_candidates
     join source_items on source_items.source_item_id = entity_candidates.source_item_id
     join sources on sources.source_id = source_items.source_id
     where sources.source_id in (?, ?, ?, ?, ?)
     order by entity_candidates.normalized_name, sources.source_id, entity_candidates.name`,
    [...sourceIds],
  ).filter((row) =>
    isPublicBodyComparisonCandidate(row.sourceId, row.kind, row.rawKind ?? undefined)
  );
  const groupedRows = buildExactPublicBodyComparisonRows(rows);
  const conservativeVariantMatches = buildConservativeVariantMatches(rows);
  const normalizedNameCountBySource = new Map<string, number>();
  const sharedNameCountBySource = new Map<string, number>();
  for (const row of groupedRows) {
    for (const sourceId of row.sourceIds) {
      normalizedNameCountBySource.set(
        sourceId,
        (normalizedNameCountBySource.get(sourceId) ?? 0) + 1,
      );
      if (row.sourceIds.length > 1) {
        sharedNameCountBySource.set(sourceId, (sharedNameCountBySource.get(sourceId) ?? 0) + 1);
      }
    }
  }
  const sourceSummaries = sourceRows.map((source) => ({
    ...source,
    normalizedNameCount: normalizedNameCountBySource.get(source.sourceId) ?? 0,
    sharedNameCount: sharedNameCountBySource.get(source.sourceId) ?? 0,
    exclusiveNameCount: (normalizedNameCountBySource.get(source.sourceId) ?? 0) -
      (sharedNameCountBySource.get(source.sourceId) ?? 0),
  }));
  return {
    sourceSummaries,
    rows: groupedRows,
    sharedNameCount: groupedRows.filter((row) => row.sourceIds.length > 1).length,
    exclusiveNameCount: groupedRows.filter((row) => row.sourceIds.length === 1).length,
    conservativeVariantMatches,
    conservativeVariantMatchCount: conservativeVariantMatches.length,
  };
}

function buildExactPublicBodyComparisonRows(
  rows: PublicBodyComparisonCandidateRow[],
): PublicBodyComparisonRow[] {
  const grouped = new Map<string, {
    normalizedName: string;
    displayName: string;
    sources: Map<string, string>;
  }>();
  for (const row of rows) {
    const group = grouped.get(row.normalizedName) ?? {
      normalizedName: row.normalizedName,
      displayName: row.displayName,
      sources: new Map<string, string>(),
    };
    if (!grouped.has(row.normalizedName)) grouped.set(row.normalizedName, group);
    group.sources.set(row.sourceId, row.sourceTitle);
    if (!group.displayName) group.displayName = row.displayName;
  }
  return [...grouped.values()].map((group) => ({
    normalizedName: group.normalizedName,
    displayName: group.displayName,
    sourceIds: [...group.sources.keys()].sort(),
    sourceTitles: [...group.sources.values()].sort(),
  })).sort((a, b) => a.normalizedName.localeCompare(b.normalizedName));
}

function buildConservativeVariantMatches(
  rows: PublicBodyComparisonCandidateRow[],
): PublicBodyVariantMatch[] {
  const grouped = new Map<string, {
    variantName: string;
    matchKinds: Set<PublicBodyVariantMatchKind>;
    names: Map<string, PublicBodyVariantMatchName>;
    normalizedNames: Set<string>;
    sourceTitles: Map<string, string>;
  }>();
  for (const row of rows) {
    const entry: PublicBodyVariantMatchName = {
      normalizedName: row.normalizedName,
      displayName: row.displayName,
      sourceId: row.sourceId,
      sourceTitle: row.sourceTitle,
    };
    for (const key of comparisonKeysForVariantMatching(row)) {
      const groupKey = normalizedComparisonKey(key.variantName);
      if (!groupKey) continue;
      const group = grouped.get(groupKey) ?? {
        variantName: key.variantName,
        matchKinds: new Set<PublicBodyVariantMatchKind>(),
        names: new Map<string, PublicBodyVariantMatchName>(),
        normalizedNames: new Set<string>(),
        sourceTitles: new Map<string, string>(),
      };
      if (!grouped.has(groupKey)) grouped.set(groupKey, group);
      if (key.matchKind) group.matchKinds.add(key.matchKind);
      group.names.set(`${row.sourceId}:${normalizedComparisonKey(row.normalizedName)}`, entry);
      group.normalizedNames.add(normalizedComparisonKey(row.normalizedName));
      group.sourceTitles.set(row.sourceId, row.sourceTitle);
    }
  }
  return [...grouped.values()]
    .filter((group) =>
      group.matchKinds.size > 0 &&
      group.sourceTitles.size > 1 &&
      group.normalizedNames.size > 1 &&
      group.normalizedNames.has(normalizedComparisonKey(group.variantName))
    )
    .map((group) => ({
      variantName: group.variantName,
      matchKinds: [...group.matchKinds].sort(compareVariantMatchKinds),
      sourceIds: [...group.sourceTitles.keys()].sort(),
      sourceTitles: [...group.sourceTitles.values()].sort(),
      names: [...group.names.values()].sort((a, b) =>
        compareVariantMatchNames(a, b, group.variantName)
      ),
    }))
    .sort((a, b) => a.variantName.localeCompare(b.variantName));
}

function comparisonKeysForVariantMatching(
  row: PublicBodyComparisonCandidateRow,
): Array<{ variantName: string; matchKind?: PublicBodyVariantMatchKind }> {
  const keys: Array<{ variantName: string; matchKind?: PublicBodyVariantMatchKind }> = [{
    variantName: row.displayName,
  }];
  for (const key of conservativeVariantKeys(row.displayName)) {
    if (
      !keys.some((candidate) =>
        normalizedComparisonKey(candidate.variantName) ===
          normalizedComparisonKey(key.variantName) &&
        candidate.matchKind === key.matchKind
      )
    ) {
      keys.push(key);
    }
  }
  return keys;
}

function conservativeVariantKeys(
  displayName: string,
): Array<{ variantName: string; matchKind: PublicBodyVariantMatchKind }> {
  const normalized = normalizeName(displayName);
  const variants: Array<{ variantName: string; matchKind: PublicBodyVariantMatchKind }> = [];
  const parentheticalMatch = normalized.match(/^(.+?)\s+\(([^)]+)\)\s*$/);
  const nameWithoutParenthetical = parentheticalMatch?.[1]
    ? normalizeName(parentheticalMatch[1])
    : normalized;
  if (parentheticalMatch?.[1]) {
    if (nameWithoutParenthetical && nameWithoutParenthetical !== normalized) {
      variants.push({
        variantName: nameWithoutParenthetical,
        matchKind: isAcronymLike(parentheticalMatch[2])
          ? "acronym_parenthetical"
          : "parenthetical_alias",
      });
    }
  }
  const governanceSuffixMatch = nameWithoutParenthetical.match(
    /^(.+?)\s+(?:advisory\s+board|board(?:\s+of\s+directors)?)$/i,
  );
  if (governanceSuffixMatch?.[1]) {
    const variantName = normalizeName(governanceSuffixMatch[1]);
    if (variantName && variantName !== normalized) {
      variants.push({
        variantName,
        matchKind: "governance_suffix",
      });
    }
  }
  return variants.filter((variant, index, all) =>
    all.findIndex((candidate) =>
      normalizedComparisonKey(candidate.variantName) ===
        normalizedComparisonKey(variant.variantName) &&
      candidate.matchKind === variant.matchKind
    ) === index
  );
}

function isAcronymLike(value: string): boolean {
  const normalized = normalizeName(value);
  return /^[A-Z0-9][A-Z0-9/&.\-\s]{1,11}$/.test(normalized);
}

function normalizedComparisonKey(value: string): string {
  return normalizeName(value).toLowerCase();
}

function compareVariantMatchKinds(
  a: PublicBodyVariantMatchKind,
  b: PublicBodyVariantMatchKind,
): number {
  const order: PublicBodyVariantMatchKind[] = [
    "acronym_parenthetical",
    "parenthetical_alias",
    "governance_suffix",
  ];
  return order.indexOf(a) - order.indexOf(b);
}

function compareVariantMatchNames(
  a: PublicBodyVariantMatchName,
  b: PublicBodyVariantMatchName,
  variantName: string,
): number {
  const variantKey = normalizedComparisonKey(variantName);
  const aIsExact = normalizedComparisonKey(a.displayName) === variantKey ? 0 : 1;
  const bIsExact = normalizedComparisonKey(b.displayName) === variantKey ? 0 : 1;
  return aIsExact - bIsExact ||
    a.sourceId.localeCompare(b.sourceId) ||
    a.displayName.localeCompare(b.displayName);
}

function isPublicBodyComparisonCandidate(
  sourceId: string,
  kind: string,
  rawKind?: string,
): boolean {
  if (sourceId === "mota.quickbase") {
    return isPublicBodyLikeKind(kind);
  }
  if (sourceId === "oanc.anc_profiles") {
    return kind === "commission" && (rawKind === "anc" || rawKind === "commission");
  }
  return isPublicBodyLikeKind(kind);
}

function isPublicBodyLikeKind(kind: string): boolean {
  return [
    "public_body",
    "board",
    "commission",
    "council",
    "committee",
    "task_force",
    "office",
    "agency",
  ].includes(kind);
}

function sourceSummaryOrConfigured(store: WorkbenchStore, sourceId: string): SourceSummary {
  try {
    return sourceSummary(store, sourceId);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== `Unknown source: ${sourceId}`) {
      throw error;
    }
  }
  const connector = getConnector(sourceId);
  return {
    sourceId,
    title: connector.source.title,
    latestStatus: "unfetched",
    itemCount: 0,
    fieldCount: 0,
    entityCandidateCount: 0,
    relationshipCandidateCount: 0,
  };
}
