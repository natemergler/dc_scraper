import { Database } from "@db/sqlite";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

import { type CitationValue, isCitationValue } from "../core/types.ts";
import type { ReviewItem } from "../review/items.ts";
import type { Workspace } from "../workspace/workspace.ts";
import { buildGovGraphProjection } from "./public_projection.ts";

export interface ExportResult {
  releaseRoot: string;
  entryCount: number;
  relationCount: number;
  citationCount: number;
  sourceCount: number;
  sourceCoverageCount: number;
  boardAffiliationCount: number;
  commissionAffiliationCount: number;
  authorityAffiliationCount: number;
  govGraphNodeCount: number;
  govGraphEdgeCount: number;
  ledgerSqlitePath: string;
}

interface ExportCitationRow {
  citationType: "entry" | "relation";
  entryId: string;
  source: string;
  sourceRecordId: string;
  locator?: string;
  url?: string;
  uncited: boolean;
  reason?: string;
  fromEntryId?: string;
  relationKind?: string;
  toEntryId?: string;
}

interface SourceStats {
  snapshotRecords: number;
  citations: number;
}

export interface SourceCoverageCatalogItem {
  source: string;
  sourceType: string;
  family: string;
  scope: string;
  contributes: string;
  excludes: string;
  notes?: string;
}

export interface ExportReleaseOptions {
  workspace: Workspace;
  jurisdiction: string;
  releaseRoot: string;
  sourceCatalog?: SourceCoverageCatalogItem[];
  reviewItems?: ReviewItem[];
}

export async function exportReleaseArtifacts(
  options: ExportReleaseOptions,
): Promise<ExportResult> {
  const { workspace, jurisdiction, releaseRoot } = options;
  await ensureDir(releaseRoot);

  const entryRows = workspace.db.prepare(
    "SELECT entry_id, payload FROM state_entries ORDER BY entry_id ASC",
  ).all() as Array<{ entry_id: string; payload: string }>;

  const relationRows = workspace.db.prepare(
    "SELECT from_entry_id, relation_kind, to_entry_id, citations FROM state_relations ORDER BY from_entry_id ASC, relation_kind ASC, to_entry_id ASC",
  ).all() as Array<{
    from_entry_id: string;
    relation_kind: string;
    to_entry_id: string;
    citations: string | null;
  }>;

  const entriesOut: string[][] = [];
  const relationsOut: string[][] = [];
  const citationsOut: ExportCitationRow[] = [];
  const boardAffiliationsOut: string[][] = [];
  const commissionAffiliationsOut: string[][] = [];
  const authorityAffiliationsOut: string[][] = [];
  const relationKindCounts = new Map<string, number>();
  const governanceRelationKinds = new Set([
    "dc.relation:affiliated_with",
    "dc.relation:governs",
  ]);
  const entryIndex = new Map<
    string,
    {
      family: string;
      kind: string;
      name: string;
      shortName: string;
      attributes: Record<string, unknown>;
      citations: CitationValue[];
      relations: Record<string, Array<{ kind: string; to: string; citations: CitationValue[] }>>;
    }
  >();

  for (const row of entryRows) {
    const payload = safeJsonParse<Record<string, unknown>>(row.payload, {});
    const citations = parseCitationArray(payload.citations);
    const attributes = typeof payload.attributes === "object" && payload.attributes !== null
      ? payload.attributes as Record<string, unknown>
      : {};

    entriesOut.push([
      row.entry_id,
      String(payload.family ?? ""),
      String(payload.kind ?? ""),
      String(payload.name ?? ""),
      stableStringify(payload.attributes ?? {}),
      stableStringify(citations),
    ]);

    entryIndex.set(row.entry_id, {
      family: String(payload.family ?? ""),
      kind: String(payload.kind ?? ""),
      name: String(payload.name ?? ""),
      shortName: typeof attributes.shortName === "string" ? attributes.shortName : "",
      attributes,
      citations,
      relations: {},
    });

    for (const citation of citations) {
      citationsOut.push(toExportCitationRow({
        type: "entry",
        entryId: row.entry_id,
        citation,
      }));
    }
  }

  for (const row of relationRows) {
    const previousKindCount = relationKindCounts.get(row.relation_kind) ?? 0;
    relationKindCounts.set(row.relation_kind, previousKindCount + 1);

    const citations = parseCitationArray(safeJsonParse(row.citations, []));
    const indexedEntry = entryIndex.get(row.from_entry_id);
    if (indexedEntry) {
      const relationsForKind = indexedEntry.relations[row.relation_kind] ?? [];
      relationsForKind.push({
        kind: row.relation_kind,
        to: row.to_entry_id,
        citations,
      });
      indexedEntry.relations[row.relation_kind] = relationsForKind;
    }

    relationsOut.push([
      row.from_entry_id,
      row.relation_kind,
      row.to_entry_id,
      stableStringify(citations),
    ]);

    if (governanceRelationKinds.has(row.relation_kind)) {
      const board = entryIndex.get(row.from_entry_id);
      if (board?.kind === "dc.board") {
        const agency = entryIndex.get(row.to_entry_id);
        boardAffiliationsOut.push([
          row.from_entry_id,
          board.name,
          board.shortName,
          row.to_entry_id,
          agency?.name ?? "",
          stableStringify(citations),
        ]);
      }

      const commission = entryIndex.get(row.from_entry_id);
      if (commission?.kind === "dc.commission") {
        const agency = entryIndex.get(row.to_entry_id);
        commissionAffiliationsOut.push([
          row.from_entry_id,
          commission.name,
          commission.shortName,
          row.to_entry_id,
          agency?.name ?? "",
          stableStringify(citations),
        ]);
      }

      const authority = entryIndex.get(row.from_entry_id);
      if (authority?.kind === "dc.authority") {
        const agency = entryIndex.get(row.to_entry_id);
        authorityAffiliationsOut.push([
          row.from_entry_id,
          authority.name,
          authority.shortName,
          row.to_entry_id,
          agency?.name ?? "",
          stableStringify(citations),
        ]);
      }
    }

    for (const citation of citations) {
      citationsOut.push(toExportCitationRow({
        type: "relation",
        entryId: row.from_entry_id,
        citation,
        fromEntryId: row.from_entry_id,
        relationKind: row.relation_kind,
        toEntryId: row.to_entry_id,
      }));
    }
  }

  const snapshotRows = workspace.db.prepare(
    "SELECT source, COUNT(*) AS count FROM snapshots GROUP BY source ORDER BY source ASC",
  ).all() as Array<{ source: string; count: number }>;
  const recordRows = workspace.db.prepare(
    "SELECT source, COUNT(*) AS count FROM records GROUP BY source ORDER BY source ASC",
  ).all() as Array<{ source: string; count: number }>;
  const recordCountBySource = new Map(recordRows.map((row) => [row.source, row.count]));

  const sourceCount = new Map<string, SourceStats>();
  for (const snapshot of snapshotRows) {
    sourceCount.set(snapshot.source, {
      snapshotRecords: snapshot.count,
      citations: 0,
    });
  }

  for (const citation of citationsOut) {
    if (!citation.source) {
      continue;
    }
    const current = sourceCount.get(citation.source);
    if (current) {
      current.citations += 1;
      sourceCount.set(citation.source, current);
      continue;
    }

    sourceCount.set(citation.source, {
      snapshotRecords: 0,
      citations: 1,
    });
  }

  const sourceRows = Array.from(sourceCount.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, stats]) => [
      source,
      String(stats.snapshotRecords),
      String(stats.citations),
    ]);

  const sourceCoverageRows = buildSourceCoverageRows({
    catalog: options.sourceCatalog ?? [],
    sourceRows,
    recordCountBySource,
  });
  const govGraph = buildGovGraphProjection(
    Array.from(entryIndex.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, entry]) => ({
        id,
        family: entry.family,
        kind: entry.kind,
        name: entry.name,
        attributes: entry.attributes,
        citations: entry.citations,
        relations: entry.relations,
      })),
    options.reviewItems ?? [],
  );

  const exportedAt = new Date().toISOString();

  await writeCsv(join(releaseRoot, "entries.csv"), [
    "entry_id",
    "family",
    "kind",
    "name",
    "attributes",
    "citations",
  ], entriesOut);

  await writeCsv(join(releaseRoot, "relations.csv"), [
    "from_entry_id",
    "relation_kind",
    "to_entry_id",
    "citations",
  ], relationsOut);

  const sortedBoardAffiliations = [...boardAffiliationsOut].sort((left, right) => {
    if (left[0] === right[0]) {
      return left[3].localeCompare(right[3]);
    }
    return left[0].localeCompare(right[0]);
  });
  const sortedCommissionAffiliations = [...commissionAffiliationsOut].sort((left, right) => {
    if (left[0] === right[0]) {
      return left[3].localeCompare(right[3]);
    }
    return left[0].localeCompare(right[0]);
  });
  const sortedAuthorityAffiliations = [...authorityAffiliationsOut].sort((left, right) => {
    if (left[0] === right[0]) {
      return left[3].localeCompare(right[3]);
    }
    return left[0].localeCompare(right[0]);
  });

  await writeCsv(join(releaseRoot, "dc_board_affiliations.csv"), [
    "board_entry_id",
    "board_name",
    "board_short_name",
    "agency_entry_id",
    "agency_name",
    "relation_citations",
  ], sortedBoardAffiliations);

  await writeCsv(join(releaseRoot, "dc_commission_affiliations.csv"), [
    "commission_entry_id",
    "commission_name",
    "commission_short_name",
    "agency_entry_id",
    "agency_name",
    "relation_citations",
  ], sortedCommissionAffiliations);

  await writeCsv(join(releaseRoot, "dc_authority_affiliations.csv"), [
    "authority_entry_id",
    "authority_name",
    "authority_short_name",
    "agency_entry_id",
    "agency_name",
    "relation_citations",
  ], sortedAuthorityAffiliations);

  await writeCsv(
    join(releaseRoot, "citations.csv"),
    [
      "citation_type",
      "entry_id",
      "source",
      "source_record_id",
      "locator",
      "url",
      "uncited",
      "reason",
      "from_entry_id",
      "relation_kind",
      "to_entry_id",
    ],
    citationsOut.map((citation) => [
      citation.citationType,
      citation.entryId,
      citation.source,
      citation.sourceRecordId,
      citation.locator ?? "",
      citation.url ?? "",
      citation.uncited ? "true" : "false",
      citation.reason ?? "",
      citation.fromEntryId ?? "",
      citation.relationKind ?? "",
      citation.toEntryId ?? "",
    ]),
  );

  await writeCsv(join(releaseRoot, "sources.csv"), [
    "source",
    "snapshot_records",
    "citation_count",
  ], sourceRows);

  await writeCsv(join(releaseRoot, "source_coverage.csv"), [
    "source",
    "source_type",
    "family",
    "collection_status",
    "snapshot_count",
    "record_count",
    "citation_count",
    "scope",
    "contributes",
    "excludes",
    "notes",
  ], sourceCoverageRows);

  await Deno.writeTextFile(
    join(releaseRoot, "govgraph_nodes.json"),
    JSON.stringify(govGraph.nodes, null, 2) + "\n",
  );

  await Deno.writeTextFile(
    join(releaseRoot, "govgraph_edges.json"),
    JSON.stringify(govGraph.edges, null, 2) + "\n",
  );

  await Deno.writeTextFile(
    join(releaseRoot, "govgraph_summary.json"),
    JSON.stringify(govGraph.summary, null, 2) + "\n",
  );

  const manifestPath = join(releaseRoot, "manifest.json");
  const manifest = {
    schemaVersion: 1,
    jurisdiction,
    exportedAt,
    outputs: {
      entriesCsv: "entries.csv",
      relationsCsv: "relations.csv",
      citationsCsv: "citations.csv",
      sourcesCsv: "sources.csv",
      sourceCoverageCsv: "source_coverage.csv",
      boardAffiliationsCsv: "dc_board_affiliations.csv",
      commissionAffiliationsCsv: "dc_commission_affiliations.csv",
      authorityAffiliationsCsv: "dc_authority_affiliations.csv",
      govGraphNodesJson: "govgraph_nodes.json",
      govGraphEdgesJson: "govgraph_edges.json",
      govGraphSummaryJson: "govgraph_summary.json",
      ledgerSqlite: "ledger.sqlite",
      readme: "README.md",
    },
    counts: {
      entries: entriesOut.length,
      relations: relationsOut.length,
      relationKinds: Object.fromEntries(
        [...relationKindCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
      ),
      citations: citationsOut.length,
      sources: sourceRows.length,
      sourceCoverage: sourceCoverageRows.length,
      boardAffiliations: boardAffiliationsOut.length,
      commissionAffiliations: commissionAffiliationsOut.length,
      authorityAffiliations: authorityAffiliationsOut.length,
      govGraphNodes: govGraph.nodes.length,
      govGraphEdges: govGraph.edges.length,
    },
    govGraph: govGraph.summary,
  };

  await Deno.writeTextFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  await Deno.writeTextFile(
    join(releaseRoot, "README.md"),
    [
      `# Civic Ledger release`,
      `jurisdiction,${jurisdiction}`,
      `exported_at,${exportedAt}`,
      `entries,${entriesOut.length}`,
      `relations,${relationsOut.length}`,
      `citations,${citationsOut.length}`,
      `sources,${sourceRows.length}`,
      "",
      "Artifacts:",
      "- entries.csv",
      "- relations.csv",
      "- citations.csv",
      "- sources.csv",
      "- source_coverage.csv",
      "- dc_board_affiliations.csv",
      "- dc_commission_affiliations.csv",
      "- dc_authority_affiliations.csv",
      "- govgraph_nodes.json",
      "- govgraph_edges.json",
      "- govgraph_summary.json",
      "- manifest.json",
      "- ledger.sqlite",
      "",
    ].join("\n"),
  );

  const ledgerPath = join(releaseRoot, "ledger.sqlite");
  try {
    Deno.removeSync(ledgerPath);
  } catch {
    // expected when ledger.sqlite does not exist
  }

  const ledgerDb = new Database(ledgerPath);
  try {
    ledgerDb.exec(`
      CREATE TABLE entries (
        entry_id TEXT PRIMARY KEY,
        family TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        attributes TEXT NOT NULL,
        citations TEXT NOT NULL
      );

      CREATE TABLE relations (
        from_entry_id TEXT NOT NULL,
        relation_kind TEXT NOT NULL,
        to_entry_id TEXT NOT NULL,
        citations TEXT NOT NULL,
        PRIMARY KEY (from_entry_id, relation_kind, to_entry_id)
      );

      CREATE TABLE citations (
        citation_id INTEGER PRIMARY KEY AUTOINCREMENT,
        citation_type TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        source TEXT,
        source_record_id TEXT,
        locator TEXT,
        url TEXT,
        uncited INTEGER NOT NULL,
        reason TEXT,
        from_entry_id TEXT,
        relation_kind TEXT,
        to_entry_id TEXT
      );

      CREATE TABLE sources (
        source TEXT PRIMARY KEY,
        snapshot_records INTEGER NOT NULL DEFAULT 0,
        citation_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE source_coverage (
        source TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        family TEXT NOT NULL,
        collection_status TEXT NOT NULL,
        snapshot_count INTEGER NOT NULL DEFAULT 0,
        record_count INTEGER NOT NULL DEFAULT 0,
        citation_count INTEGER NOT NULL DEFAULT 0,
        scope TEXT NOT NULL,
        contributes TEXT NOT NULL,
        excludes TEXT NOT NULL,
        notes TEXT NOT NULL
      );
    `);

    const insertEntry = ledgerDb.prepare(
      "INSERT INTO entries (entry_id, family, kind, name, attributes, citations) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const entry of entriesOut) {
      insertEntry.run(entry[0], entry[1], entry[2], entry[3], entry[4], entry[5]);
    }

    const insertRelation = ledgerDb.prepare(
      "INSERT INTO relations (from_entry_id, relation_kind, to_entry_id, citations) VALUES (?, ?, ?, ?)",
    );
    for (const relation of relationsOut) {
      insertRelation.run(relation[0], relation[1], relation[2], relation[3]);
    }

    const insertCitation = ledgerDb.prepare(
      "INSERT INTO citations (citation_type, entry_id, source, source_record_id, locator, url, uncited, reason, from_entry_id, relation_kind, to_entry_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const citation of citationsOut) {
      insertCitation.run(
        citation.citationType,
        citation.entryId,
        citation.source || null,
        citation.sourceRecordId,
        citation.locator ?? null,
        citation.url ?? null,
        citation.uncited ? 1 : 0,
        citation.reason ?? null,
        citation.fromEntryId ?? null,
        citation.relationKind ?? null,
        citation.toEntryId ?? null,
      );
    }

    const insertSource = ledgerDb.prepare(
      "INSERT INTO sources (source, snapshot_records, citation_count) VALUES (?, ?, ?)",
    );
    for (const source of sourceRows) {
      insertSource.run(source[0], Number.parseInt(source[1], 10), Number.parseInt(source[2], 10));
    }

    const insertSourceCoverage = ledgerDb.prepare(
      "INSERT INTO source_coverage (source, source_type, family, collection_status, snapshot_count, record_count, citation_count, scope, contributes, excludes, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const source of sourceCoverageRows) {
      insertSourceCoverage.run(
        source[0],
        source[1],
        source[2],
        source[3],
        Number.parseInt(source[4], 10),
        Number.parseInt(source[5], 10),
        Number.parseInt(source[6], 10),
        source[7],
        source[8],
        source[9],
        source[10],
      );
    }
  } finally {
    ledgerDb.close();
  }

  return {
    releaseRoot,
    entryCount: entriesOut.length,
    relationCount: relationsOut.length,
    citationCount: citationsOut.length,
    sourceCount: sourceRows.length,
    sourceCoverageCount: sourceCoverageRows.length,
    boardAffiliationCount: boardAffiliationsOut.length,
    commissionAffiliationCount: commissionAffiliationsOut.length,
    authorityAffiliationCount: authorityAffiliationsOut.length,
    govGraphNodeCount: govGraph.nodes.length,
    govGraphEdgeCount: govGraph.edges.length,
    ledgerSqlitePath: ledgerPath,
  };
}

function buildSourceCoverageRows(input: {
  catalog: SourceCoverageCatalogItem[];
  sourceRows: string[][];
  recordCountBySource: Map<string, number>;
}): string[][] {
  const sourceStats = new Map(
    input.sourceRows.map((row) => [
      row[0],
      {
        snapshotCount: Number.parseInt(row[1], 10),
        citationCount: Number.parseInt(row[2], 10),
      },
    ]),
  );
  const catalogBySource = new Map(input.catalog.map((item) => [item.source, item]));
  const sources = new Set<string>([
    ...input.catalog.map((item) => item.source),
    ...input.sourceRows.map((row) => row[0]),
  ]);

  return [...sources].sort((left, right) => left.localeCompare(right)).map((source) => {
    const catalogItem = catalogBySource.get(source);
    const stats = sourceStats.get(source);
    const snapshotCount = stats?.snapshotCount ?? 0;
    const recordCount = input.recordCountBySource.get(source) ?? 0;
    const citationCount = stats?.citationCount ?? 0;
    const collectionStatus = snapshotCount === 0
      ? "not_collected"
      : recordCount === 0
      ? "collected_empty"
      : "collected";

    return [
      source,
      catalogItem?.sourceType ?? "",
      catalogItem?.family ?? "",
      collectionStatus,
      String(snapshotCount),
      String(recordCount),
      String(citationCount),
      catalogItem?.scope ?? "",
      catalogItem?.contributes ?? "",
      catalogItem?.excludes ?? "",
      catalogItem?.notes ?? "",
    ];
  });
}

function toExportCitationRow(input: {
  type: "entry" | "relation";
  entryId: string;
  citation: CitationValue;
  fromEntryId?: string;
  relationKind?: string;
  toEntryId?: string;
}): ExportCitationRow {
  if (isUncitedCitation(input.citation)) {
    return {
      citationType: input.type,
      entryId: input.entryId,
      source: "",
      sourceRecordId: "",
      uncited: true,
      reason: input.citation.reason,
      fromEntryId: input.fromEntryId,
      relationKind: input.relationKind,
      toEntryId: input.toEntryId,
    };
  }

  return {
    citationType: input.type,
    entryId: input.entryId,
    source: input.citation.source,
    sourceRecordId: input.citation.sourceRecordId,
    locator: input.citation.locator,
    url: input.citation.url,
    uncited: false,
    fromEntryId: input.fromEntryId,
    relationKind: input.relationKind,
    toEntryId: input.toEntryId,
  };
}

function isUncitedCitation(value: CitationValue): value is { uncited: true; reason?: string } {
  return (value as { uncited?: unknown }).uncited === true;
}

function parseCitationArray(value: unknown): CitationValue[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isCitationValue);
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (value === null) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stabilize(value));
}

function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stabilize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, raw]) => [key, stabilize(raw)]),
    );
  }

  return value;
}

async function writeCsv(path: string, headers: string[], rows: string[][]): Promise<void> {
  const payload = [
    headers,
    ...rows,
  ].map((row) => row.map((value) => escapeCsv(value)).join(",")).join("\n") + "\n";
  await Deno.writeTextFile(path, payload);
}

function escapeCsv(value: string): string {
  const safe = value ?? "";
  if (safe.includes(",") || safe.includes("\n") || safe.includes("\r") || safe.includes('"')) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}
