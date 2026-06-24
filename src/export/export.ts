import { Database } from "@db/sqlite";
import { ensureDir } from "@std/fs";
import { isAbsolute, join } from "@std/path";

import { type CitationValue, isCitationValue } from "../core/types.ts";
import { dcEntityKindDescription } from "../jurisdictions/dc/kinds/entity.ts";
import { dcRelationDescription } from "../jurisdictions/dc/kinds/relation.ts";
import {
  deferredReviewGroupDescription,
  groupDeferredReviewItems,
  type ReviewCategory,
  reviewCategoryDescriptions,
  type ReviewItem,
  type ReviewQueue,
  reviewQueueForItem,
} from "../review/items.ts";
import type { Workspace } from "../workspace/workspace.ts";
import {
  buildDcAncSmdStructureRows,
  buildDcCouncilCommitteeMembershipRows,
  buildGovGraphProjection,
} from "./public_projection.ts";

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
  ancSmdStructureCount: number;
  councilCommitteeMembershipCount: number;
  govGraphNodeCount: number;
  govGraphEdgeCount: number;
  govGraphExcludedNodeCount: number;
  govGraphExcludedEdgeCount: number;
  govGraphBlockedReviewItemCount: number;
  ledgerSqlitePath: string;
}

export interface ReleaseVerificationResult {
  releaseRoot: string;
  manifestPath: string;
  valid: boolean;
  checkedFileCount: number;
  errors: string[];
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

export interface ReleaseSourceCoverageStats {
  source: string;
  snapshotCount: number;
  recordCount: number;
  citationCount: number;
}

interface ExportRelationRow {
  from_entry_id: string;
  relation_kind: string;
  to_entry_id: string;
  citations: string | null;
}

interface ExportEntryIndexValue {
  family: string;
  kind: string;
  name: string;
  shortName: string;
  attributes: Record<string, unknown>;
  citations: CitationValue[];
  relations: Record<string, Array<{ kind: string; to: string; citations: CitationValue[] }>>;
}

interface RelationExample {
  kind: string;
  from: string;
  to: string;
  source?: string;
  sourceRecordId?: string;
}

const SOURCE_COVERAGE_HEADERS = [
  "source",
  "source_type",
  "family",
  "publisher",
  "access_method",
  "source_url",
  "catalog_confidence",
  "collection_status",
  "reader_status",
  "interpreter_status",
  "release_status",
  "snapshot_count",
  "record_count",
  "citation_count",
  "scope",
  "contributes",
  "excludes",
  "notes",
] as const;

const SOURCE_COVERAGE_COLLECTION_STATUS_INDEX = SOURCE_COVERAGE_HEADERS.indexOf(
  "collection_status",
);
const SOURCE_COVERAGE_RELEASE_STATUS_INDEX = SOURCE_COVERAGE_HEADERS.indexOf("release_status");

export const SOURCE_COVERAGE_CATALOG_CONFIDENCES = ["high", "medium", "low"] as const;
export type SourceCoverageCatalogConfidence = typeof SOURCE_COVERAGE_CATALOG_CONFIDENCES[number];

export const SOURCE_COVERAGE_COLLECTION_STATUSES = [
  "collected",
  "collected_empty",
  "not_collected",
] as const;
export type SourceCoverageCollectionStatus = typeof SOURCE_COVERAGE_COLLECTION_STATUSES[number];

export const SOURCE_COVERAGE_READER_STATUSES = ["inventory_only", "uncataloged", "wired"] as const;
export type SourceCoverageReaderStatus = typeof SOURCE_COVERAGE_READER_STATUSES[number];

export const SOURCE_COVERAGE_INTERPRETER_STATUSES = ["not_wired", "unknown", "wired"] as const;
export type SourceCoverageInterpreterStatus = typeof SOURCE_COVERAGE_INTERPRETER_STATUSES[number];

export const SOURCE_COVERAGE_RELEASE_STATUSES = [
  "inventory_only",
  "exported",
  "collected_not_exported",
  "collected_empty",
  "not_collected",
] as const;
export type SourceCoverageReleaseStatus = typeof SOURCE_COVERAGE_RELEASE_STATUSES[number];

export interface SourceCoverageCatalogItem {
  source: string;
  sourceType: string;
  family: string;
  publisher: string;
  accessMethod: string;
  sourceUrl: string;
  catalogConfidence: SourceCoverageCatalogConfidence;
  scope: string;
  contributes: string;
  excludes: string;
  notes?: string;
}

export interface SourceCoveragePipelineStatuses {
  readerStatus: SourceCoverageReaderStatus;
  interpreterStatus: SourceCoverageInterpreterStatus;
  releaseStatus: SourceCoverageReleaseStatus;
}

interface ReviewPosture {
  total: number;
  queues: Record<ReviewQueue, number>;
  categories: Record<string, number>;
  deferredGroups: Array<{
    category: string;
    label: string;
    count: number;
    description: string;
  }>;
}

interface SourceCoverageFamilyRollup {
  family: string;
  rows: number;
  collectionStatuses: Record<string, number>;
  releaseStatuses: Record<string, number>;
}

const REVIEW_QUEUES: ReviewQueue[] = [
  "blocking",
  "actionable",
  "drafted",
  "applied",
  "deferred",
];

const REVIEW_CATEGORY_KEYS = Object.keys(reviewCategoryDescriptions).sort();

const SOURCE_COVERAGE_COLUMN = {
  source: 0,
  sourceType: 1,
  family: 2,
  publisher: 3,
  accessMethod: 4,
  sourceUrl: 5,
  catalogConfidence: 6,
  collectionStatus: 7,
  readerStatus: 8,
  interpreterStatus: 9,
  releaseStatus: 10,
  snapshotCount: 11,
  recordCount: 12,
  citationCount: 13,
  scope: 14,
  contributes: 15,
  excludes: 16,
  notes: 17,
} as const;

const SOURCE_COVERAGE_REQUIRED_TEXT_COLUMNS = [
  ["source", SOURCE_COVERAGE_COLUMN.source],
  ["source_type", SOURCE_COVERAGE_COLUMN.sourceType],
  ["family", SOURCE_COVERAGE_COLUMN.family],
  ["publisher", SOURCE_COVERAGE_COLUMN.publisher],
  ["access_method", SOURCE_COVERAGE_COLUMN.accessMethod],
  ["source_url", SOURCE_COVERAGE_COLUMN.sourceUrl],
  ["catalog_confidence", SOURCE_COVERAGE_COLUMN.catalogConfidence],
  ["collection_status", SOURCE_COVERAGE_COLUMN.collectionStatus],
  ["reader_status", SOURCE_COVERAGE_COLUMN.readerStatus],
  ["interpreter_status", SOURCE_COVERAGE_COLUMN.interpreterStatus],
  ["release_status", SOURCE_COVERAGE_COLUMN.releaseStatus],
  ["scope", SOURCE_COVERAGE_COLUMN.scope],
  ["contributes", SOURCE_COVERAGE_COLUMN.contributes],
  ["excludes", SOURCE_COVERAGE_COLUMN.excludes],
] as const;

const SOURCE_COVERAGE_COUNT_COLUMNS = [
  ["snapshot_count", SOURCE_COVERAGE_COLUMN.snapshotCount],
  ["record_count", SOURCE_COVERAGE_COLUMN.recordCount],
  ["citation_count", SOURCE_COVERAGE_COLUMN.citationCount],
] as const;

const SOURCE_COVERAGE_ALLOWED_VALUES = [
  [
    "catalog_confidence",
    SOURCE_COVERAGE_COLUMN.catalogConfidence,
    SOURCE_COVERAGE_CATALOG_CONFIDENCES,
  ],
  [
    "collection_status",
    SOURCE_COVERAGE_COLUMN.collectionStatus,
    SOURCE_COVERAGE_COLLECTION_STATUSES,
  ],
  [
    "reader_status",
    SOURCE_COVERAGE_COLUMN.readerStatus,
    SOURCE_COVERAGE_READER_STATUSES,
  ],
  [
    "interpreter_status",
    SOURCE_COVERAGE_COLUMN.interpreterStatus,
    SOURCE_COVERAGE_INTERPRETER_STATUSES,
  ],
  [
    "release_status",
    SOURCE_COVERAGE_COLUMN.releaseStatus,
    SOURCE_COVERAGE_RELEASE_STATUSES,
  ],
] as const;

const RELEASE_SCHEMA_VERSION = 1;

export interface ExportReleaseOptions {
  workspace: Workspace;
  jurisdiction: string;
  releaseRoot: string;
  sourceCatalog?: SourceCoverageCatalogItem[];
  sourceCoverageStats?: ReleaseSourceCoverageStats[];
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
  ).all() as ExportRelationRow[];

  const entriesOut: string[][] = [];
  const relationsOut: string[][] = [];
  const citationsOut: ExportCitationRow[] = [];
  const boardAffiliationsOut: string[][] = [];
  const commissionAffiliationsOut: string[][] = [];
  const authorityAffiliationsOut: string[][] = [];
  const entryKindCounts = new Map<string, number>();
  const relationKindCounts = new Map<string, number>();
  const governanceRelationKinds = new Set([
    "dc.relation:affiliated_with",
    "dc.relation:governs",
  ]);
  const entryIndex = new Map<string, ExportEntryIndexValue>();

  for (const row of entryRows) {
    const payload = safeJsonParse<Record<string, unknown>>(row.payload, {});
    const citations = parseCitationArray(payload.citations);
    const attributes = typeof payload.attributes === "object" && payload.attributes !== null
      ? payload.attributes as Record<string, unknown>
      : {};
    const family = String(payload.family ?? "");
    const kind = String(payload.kind ?? "");
    const name = String(payload.name ?? "");

    if (kind) {
      entryKindCounts.set(kind, (entryKindCounts.get(kind) ?? 0) + 1);
    }

    entriesOut.push([
      row.entry_id,
      family,
      kind,
      name,
      stableStringify(payload.attributes ?? {}),
      stableStringify(citations),
    ]);

    entryIndex.set(row.entry_id, {
      family,
      kind,
      name,
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

  const sourceCount = new Map<string, SourceStats>();
  const recordCountBySource = new Map<string, number>();
  const catalogBySource = new Map((options.sourceCatalog ?? []).map((item) => [item.source, item]));

  if (options.sourceCoverageStats) {
    for (const stat of options.sourceCoverageStats) {
      if (
        stat.snapshotCount === 0 && stat.recordCount === 0 && stat.citationCount === 0 &&
        !catalogBySource.has(stat.source)
      ) {
        continue;
      }
      sourceCount.set(stat.source, {
        snapshotRecords: stat.snapshotCount,
        citations: stat.citationCount,
      });
      recordCountBySource.set(stat.source, stat.recordCount);
    }
  } else {
    const snapshotRows = workspace.db.prepare(
      "SELECT source, COUNT(*) AS count FROM snapshots GROUP BY source ORDER BY source ASC",
    ).all() as Array<{ source: string; count: number }>;
    const recordRows = workspace.db.prepare(
      "SELECT source, COUNT(*) AS count FROM records GROUP BY source ORDER BY source ASC",
    ).all() as Array<{ source: string; count: number }>;
    for (const row of recordRows) {
      recordCountBySource.set(row.source, row.count);
    }
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
  }

  const sourceRows = Array.from(sourceCount.entries())
    .filter(([source, stats]) => {
      return stats.citations > 0 || stats.snapshotRecords > 0;
    })
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
  const sourceCoverageStatusCounts = buildSourceCoverageStatusCounts(sourceCoverageRows);
  const sourceCoverageReleaseStatusCounts = buildSourceCoverageReleaseStatusCounts(
    sourceCoverageRows,
  );
  const sourceCoverageFamilyRollup = buildSourceCoverageFamilyRollup(sourceCoverageRows);
  const projectedEntries = Array.from(entryIndex.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, entry]) => ({
      id,
      family: entry.family,
      kind: entry.kind,
      name: entry.name,
      attributes: entry.attributes,
      citations: entry.citations,
      relations: entry.relations,
    }));
  const reviewItems = options.reviewItems ?? [];
  const reviewPosture = buildReviewPosture(reviewItems);
  const govGraph = buildGovGraphProjection(projectedEntries, reviewItems);
  const ancSmdStructureRows = buildDcAncSmdStructureRows(projectedEntries);
  const councilCommitteeMembershipRows = buildDcCouncilCommitteeMembershipRows(projectedEntries);
  const relationExamples = buildRelationExamples(relationRows, entryIndex);

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
    join(releaseRoot, "dc_anc_smd_structure.csv"),
    [
      "anc_entry_id",
      "anc_name",
      "anc_short_name",
      "smd_entry_id",
      "smd_name",
      "commissioner_seat_entry_id",
      "commissioner_seat_name",
      "current_commissioner_name",
      "officer_role",
      "relation_citations",
    ],
    ancSmdStructureRows.map((row) => [
      row.ancEntryId,
      row.ancName,
      row.ancShortName,
      row.smdEntryId,
      row.smdName,
      row.commissionerSeatEntryId,
      row.commissionerSeatName,
      row.currentCommissionerName,
      row.officerRole,
      stableStringify(row.relationCitations),
    ]),
  );

  await writeCsv(
    join(releaseRoot, "dc_council_committee_membership.csv"),
    [
      "committee_entry_id",
      "committee_name",
      "committee_type",
      "councilmember_entry_id",
      "councilmember_name",
      "membership_role",
      "relation_citations",
    ],
    councilCommitteeMembershipRows.map((row) => [
      row.committeeEntryId,
      row.committeeName,
      row.committeeType,
      row.councilmemberEntryId,
      row.councilmemberName,
      row.membershipRole,
      stableStringify(row.relationCitations),
    ]),
  );

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

  await writeCsv(
    join(releaseRoot, "source_coverage.csv"),
    [...SOURCE_COVERAGE_HEADERS],
    sourceCoverageRows,
  );

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

  const releaseOutputs = {
    entriesCsv: "entries.csv",
    relationsCsv: "relations.csv",
    citationsCsv: "citations.csv",
    sourcesCsv: "sources.csv",
    sourceCoverageCsv: "source_coverage.csv",
    boardAffiliationsCsv: "dc_board_affiliations.csv",
    commissionAffiliationsCsv: "dc_commission_affiliations.csv",
    authorityAffiliationsCsv: "dc_authority_affiliations.csv",
    ancSmdStructureCsv: "dc_anc_smd_structure.csv",
    councilCommitteeMembershipCsv: "dc_council_committee_membership.csv",
    govGraphNodesJson: "govgraph_nodes.json",
    govGraphEdgesJson: "govgraph_edges.json",
    govGraphSummaryJson: "govgraph_summary.json",
    ledgerSqlite: "ledger.sqlite",
    readme: "README.md",
  };

  await Deno.writeTextFile(
    join(releaseRoot, "README.md"),
    buildReleaseReadme({
      schemaVersion: RELEASE_SCHEMA_VERSION,
      jurisdiction,
      exportedAt,
      entryCount: entriesOut.length,
      relationCount: relationsOut.length,
      citationCount: citationsOut.length,
      sourceCount: sourceRows.length,
      sourceCoverageRows,
      sourceCoverageStatusCounts,
      sourceCoverageReleaseStatusCounts,
      sourceCoverageFamilyRollup,
      entryKindCounts,
      relationKindCounts,
      relationExamples,
      reviewPosture,
      govGraphSummary: govGraph.summary,
    }),
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
        publisher TEXT NOT NULL,
        access_method TEXT NOT NULL,
        source_url TEXT NOT NULL,
        catalog_confidence TEXT NOT NULL,
        collection_status TEXT NOT NULL,
        reader_status TEXT NOT NULL,
        interpreter_status TEXT NOT NULL,
        release_status TEXT NOT NULL,
        snapshot_count INTEGER NOT NULL DEFAULT 0,
        record_count INTEGER NOT NULL DEFAULT 0,
        citation_count INTEGER NOT NULL DEFAULT 0,
        scope TEXT NOT NULL,
        contributes TEXT NOT NULL,
        excludes TEXT NOT NULL,
        notes TEXT NOT NULL
      );

      CREATE TABLE dc_anc_smd_structure (
        anc_entry_id TEXT NOT NULL,
        anc_name TEXT NOT NULL,
        anc_short_name TEXT NOT NULL,
        smd_entry_id TEXT NOT NULL,
        smd_name TEXT NOT NULL,
        commissioner_seat_entry_id TEXT NOT NULL,
        commissioner_seat_name TEXT NOT NULL,
        current_commissioner_name TEXT NOT NULL,
        officer_role TEXT NOT NULL,
        relation_citations TEXT NOT NULL,
        PRIMARY KEY (anc_entry_id, smd_entry_id)
      );

      CREATE TABLE dc_council_committee_membership (
        committee_entry_id TEXT NOT NULL,
        committee_name TEXT NOT NULL,
        committee_type TEXT NOT NULL,
        councilmember_entry_id TEXT NOT NULL,
        councilmember_name TEXT NOT NULL,
        membership_role TEXT NOT NULL,
        relation_citations TEXT NOT NULL,
        PRIMARY KEY (committee_entry_id, councilmember_entry_id)
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
      "INSERT INTO source_coverage (source, source_type, family, publisher, access_method, source_url, catalog_confidence, collection_status, reader_status, interpreter_status, release_status, snapshot_count, record_count, citation_count, scope, contributes, excludes, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const source of sourceCoverageRows) {
      insertSourceCoverage.run(
        source[SOURCE_COVERAGE_COLUMN.source],
        source[SOURCE_COVERAGE_COLUMN.sourceType],
        source[SOURCE_COVERAGE_COLUMN.family],
        source[SOURCE_COVERAGE_COLUMN.publisher],
        source[SOURCE_COVERAGE_COLUMN.accessMethod],
        source[SOURCE_COVERAGE_COLUMN.sourceUrl],
        source[SOURCE_COVERAGE_COLUMN.catalogConfidence],
        source[SOURCE_COVERAGE_COLUMN.collectionStatus],
        source[SOURCE_COVERAGE_COLUMN.readerStatus],
        source[SOURCE_COVERAGE_COLUMN.interpreterStatus],
        source[SOURCE_COVERAGE_COLUMN.releaseStatus],
        Number.parseInt(source[SOURCE_COVERAGE_COLUMN.snapshotCount], 10),
        Number.parseInt(source[SOURCE_COVERAGE_COLUMN.recordCount], 10),
        Number.parseInt(source[SOURCE_COVERAGE_COLUMN.citationCount], 10),
        source[SOURCE_COVERAGE_COLUMN.scope],
        source[SOURCE_COVERAGE_COLUMN.contributes],
        source[SOURCE_COVERAGE_COLUMN.excludes],
        source[SOURCE_COVERAGE_COLUMN.notes],
      );
    }

    const insertAncSmdStructure = ledgerDb.prepare(
      "INSERT INTO dc_anc_smd_structure (anc_entry_id, anc_name, anc_short_name, smd_entry_id, smd_name, commissioner_seat_entry_id, commissioner_seat_name, current_commissioner_name, officer_role, relation_citations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const row of ancSmdStructureRows) {
      insertAncSmdStructure.run(
        row.ancEntryId,
        row.ancName,
        row.ancShortName,
        row.smdEntryId,
        row.smdName,
        row.commissionerSeatEntryId,
        row.commissionerSeatName,
        row.currentCommissionerName,
        row.officerRole,
        stableStringify(row.relationCitations),
      );
    }

    const insertCouncilCommitteeMembership = ledgerDb.prepare(
      "INSERT INTO dc_council_committee_membership (committee_entry_id, committee_name, committee_type, councilmember_entry_id, councilmember_name, membership_role, relation_citations) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const row of councilCommitteeMembershipRows) {
      insertCouncilCommitteeMembership.run(
        row.committeeEntryId,
        row.committeeName,
        row.committeeType,
        row.councilmemberEntryId,
        row.councilmemberName,
        row.membershipRole,
        stableStringify(row.relationCitations),
      );
    }
  } finally {
    ledgerDb.close();
  }

  const outputFileMetadata = await buildOutputFileMetadata(releaseRoot, releaseOutputs);
  const manifestPath = join(releaseRoot, "manifest.json");
  const manifest = {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    jurisdiction,
    exportedAt,
    sourceCoverageStatusCounts,
    sourceCoverageReleaseStatusCounts,
    sourceCoverageFamilyRollup,
    reviewQueueCounts: reviewPosture.queues,
    reviewCategoryCounts: reviewPosture.categories,
    reviewDeferredGroups: reviewPosture.deferredGroups,
    outputs: releaseOutputs,
    outputFileMetadata,
    counts: {
      entries: entriesOut.length,
      entryKinds: Object.fromEntries(
        [...entryKindCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
      ),
      relations: relationsOut.length,
      relationKinds: Object.fromEntries(
        [...relationKindCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
      ),
      citations: citationsOut.length,
      sources: sourceRows.length,
      sourceCoverage: sourceCoverageRows.length,
      sourceCoverageFamilies: sourceCoverageFamilyRollup.length,
      sourceCoverageStatuses: sourceCoverageStatusCounts,
      sourceCoverageReleaseStatuses: sourceCoverageReleaseStatusCounts,
      reviewItems: reviewPosture.total,
      reviewQueues: reviewPosture.queues,
      reviewCategories: reviewPosture.categories,
      reviewDeferredGroups: reviewPosture.deferredGroups,
      outputFiles: Object.keys(releaseOutputs).length,
      boardAffiliations: boardAffiliationsOut.length,
      commissionAffiliations: commissionAffiliationsOut.length,
      authorityAffiliations: authorityAffiliationsOut.length,
      ancSmdStructure: ancSmdStructureRows.length,
      councilCommitteeMembership: councilCommitteeMembershipRows.length,
      govGraphNodes: govGraph.nodes.length,
      govGraphEdges: govGraph.edges.length,
    },
    govGraph: govGraph.summary,
  };

  await Deno.writeTextFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

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
    ancSmdStructureCount: ancSmdStructureRows.length,
    councilCommitteeMembershipCount: councilCommitteeMembershipRows.length,
    govGraphNodeCount: govGraph.nodes.length,
    govGraphEdgeCount: govGraph.edges.length,
    govGraphExcludedNodeCount: govGraph.summary.excludedNodeCount,
    govGraphExcludedEdgeCount: govGraph.summary.excludedEdgeCount,
    govGraphBlockedReviewItemCount: govGraph.summary.blockedReviewItemCount,
    ledgerSqlitePath: ledgerPath,
  };
}

export async function verifyReleaseArtifacts(
  releaseRoot: string,
): Promise<ReleaseVerificationResult> {
  const manifestPath = join(releaseRoot, "manifest.json");
  const errors: string[] = [];

  let manifest: Record<string, unknown>;
  try {
    const parsedManifest = JSON.parse(await Deno.readTextFile(manifestPath)) as unknown;
    if (!isRecord(parsedManifest)) {
      errors.push("manifest.json must contain a JSON object");
      return {
        releaseRoot,
        manifestPath,
        valid: false,
        checkedFileCount: 0,
        errors,
      };
    }
    manifest = parsedManifest;
  } catch (error) {
    errors.push(`unable to read manifest.json: ${(error as Error).message}`);
    return {
      releaseRoot,
      manifestPath,
      valid: false,
      checkedFileCount: 0,
      errors,
    };
  }

  const outputs = parseManifestOutputs(manifest.outputs, errors);
  const outputFileMetadata = parseOutputFileMetadata(manifest.outputFileMetadata, errors);

  if (!outputs || !outputFileMetadata) {
    return {
      releaseRoot,
      manifestPath,
      valid: false,
      checkedFileCount: 0,
      errors,
    };
  }

  const outputNames = Object.keys(outputs).sort();
  const metadataNames = Object.keys(outputFileMetadata).sort();
  for (const outputName of outputNames) {
    if (!(outputName in outputFileMetadata)) {
      errors.push(`manifest output ${outputName} is missing outputFileMetadata`);
    }
  }
  for (const metadataName of metadataNames) {
    if (!(metadataName in outputs)) {
      errors.push(`outputFileMetadata ${metadataName} has no matching manifest output`);
    }
  }

  const counts = isRecord(manifest.counts) ? manifest.counts : null;
  if (counts) {
    validateIntegerAgreement(
      outputNames.length,
      counts.outputFiles,
      "counts.outputFiles",
      "outputs",
      errors,
    );
  }

  await validateReleaseContract(releaseRoot, manifest, outputs, errors);

  let checkedFileCount = 0;
  for (const outputName of outputNames) {
    const outputPath = outputs[outputName];
    const metadata = outputFileMetadata[outputName];
    if (!metadata) {
      continue;
    }
    if (!isReleasePayloadPath(outputPath)) {
      errors.push(`manifest output ${outputName} has unsafe path: ${outputPath}`);
      continue;
    }
    if (metadata.path !== outputPath) {
      errors.push(
        `metadata path mismatch for ${outputName}: expected ${outputPath}, found ${metadata.path}`,
      );
    }

    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await Deno.readFile(join(releaseRoot, outputPath));
    } catch (error) {
      errors.push(`unable to read ${outputPath}: ${(error as Error).message}`);
      continue;
    }

    checkedFileCount += 1;
    if (bytes.byteLength !== metadata.byteSize) {
      errors.push(
        `byte size mismatch for ${outputName}: expected ${metadata.byteSize}, found ${bytes.byteLength}`,
      );
    }

    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = hexDigest(digest);
    if (sha256 !== metadata.sha256) {
      errors.push(
        `sha256 mismatch for ${outputName}: expected ${metadata.sha256}, found ${sha256}`,
      );
    }
  }

  return {
    releaseRoot,
    manifestPath,
    valid: errors.length === 0,
    checkedFileCount,
    errors,
  };
}

async function validateReleaseContract(
  releaseRoot: string,
  manifest: Record<string, unknown>,
  outputs: Record<string, string>,
  errors: string[],
): Promise<void> {
  if (manifest.schemaVersion !== RELEASE_SCHEMA_VERSION) {
    errors.push(
      `manifest.schemaVersion must be ${RELEASE_SCHEMA_VERSION}, found ${
        String(manifest.schemaVersion)
      }`,
    );
  }
  if (manifest.jurisdiction !== "dc") {
    errors.push(`manifest.jurisdiction must be dc, found ${String(manifest.jurisdiction)}`);
  }
  validateUtcIsoTimestamp(manifest.exportedAt, "manifest.exportedAt", errors);

  const manifestGovGraph = readRecordField(manifest, "govGraph", "manifest", errors);
  if (manifestGovGraph) {
    validateGovGraphSummary("manifest.govGraph", manifestGovGraph, errors);
  }

  const govGraphSummaryPath = outputs.govGraphSummaryJson;
  if (!govGraphSummaryPath) {
    errors.push("manifest outputs.govGraphSummaryJson is required");
    return;
  }
  if (!isReleasePayloadPath(govGraphSummaryPath)) {
    return;
  }

  let govGraphSummary: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(
      await Deno.readTextFile(join(releaseRoot, govGraphSummaryPath)),
    ) as unknown;
    if (!isRecord(parsed)) {
      errors.push("govgraph_summary.json must contain a JSON object");
    } else {
      govGraphSummary = parsed;
      validateGovGraphSummary("govgraph_summary.json", govGraphSummary, errors);
    }
  } catch (error) {
    errors.push(`unable to read govgraph_summary.json: ${(error as Error).message}`);
  }

  if (
    manifestGovGraph &&
    govGraphSummary &&
    stableStringify(manifestGovGraph) !== stableStringify(govGraphSummary)
  ) {
    errors.push("manifest.govGraph must match govgraph_summary.json");
  }
  const readinessSummary = govGraphSummary ?? manifestGovGraph;
  if (readinessSummary) {
    validateNoGovGraphReleaseBlockers(
      govGraphSummary ? "govgraph_summary.json" : "manifest.govGraph",
      readinessSummary,
      errors,
    );
  }
  if (govGraphSummary) {
    await validateJsonArrayOutputCount(
      releaseRoot,
      outputs,
      "govGraphNodesJson",
      "govgraph_summary.json.nodeCount",
      govGraphSummary.nodeCount,
      errors,
    );
    await validateJsonArrayOutputCount(
      releaseRoot,
      outputs,
      "govGraphEdgesJson",
      "govgraph_summary.json.edgeCount",
      govGraphSummary.edgeCount,
      errors,
    );
  }

  await validateReleaseArtifactCounts(releaseRoot, manifest, outputs, errors);
  await validateSourceCoverageContract(releaseRoot, manifest, outputs, errors);
}

async function validateReleaseArtifactCounts(
  releaseRoot: string,
  manifest: Record<string, unknown>,
  outputs: Record<string, string>,
  errors: string[],
): Promise<void> {
  const counts = readRecordField(manifest, "counts", "manifest", errors);
  if (!counts) {
    return;
  }

  for (
    const check of [
      ["entriesCsv", "counts.entries", "entries"] as const,
      ["relationsCsv", "counts.relations", "relations"] as const,
      ["citationsCsv", "counts.citations", "citations"] as const,
      ["sourcesCsv", "counts.sources", "sources"] as const,
      ["boardAffiliationsCsv", "counts.boardAffiliations", "boardAffiliations"] as const,
      [
        "commissionAffiliationsCsv",
        "counts.commissionAffiliations",
        "commissionAffiliations",
      ] as const,
      [
        "authorityAffiliationsCsv",
        "counts.authorityAffiliations",
        "authorityAffiliations",
      ] as const,
      ["ancSmdStructureCsv", "counts.ancSmdStructure", "ancSmdStructure"] as const,
      [
        "councilCommitteeMembershipCsv",
        "counts.councilCommitteeMembership",
        "councilCommitteeMembership",
      ] as const,
    ]
  ) {
    await validateCsvOutputRowCount(
      releaseRoot,
      outputs,
      check[0],
      check[1],
      counts[check[2]],
      errors,
    );
  }

  await validateJsonArrayOutputCount(
    releaseRoot,
    outputs,
    "govGraphNodesJson",
    "counts.govGraphNodes",
    counts.govGraphNodes,
    errors,
  );
  await validateJsonArrayOutputCount(
    releaseRoot,
    outputs,
    "govGraphEdgesJson",
    "counts.govGraphEdges",
    counts.govGraphEdges,
    errors,
  );
  await validateCsvColumnCountAgreement(
    releaseRoot,
    outputs,
    "entriesCsv",
    "kind",
    2,
    readCountRecordField(counts, "entryKinds", "manifest.counts", errors),
    "manifest.counts.entryKinds",
    errors,
  );
  await validateCsvColumnCountAgreement(
    releaseRoot,
    outputs,
    "relationsCsv",
    "relation_kind",
    1,
    readCountRecordField(counts, "relationKinds", "manifest.counts", errors),
    "manifest.counts.relationKinds",
    errors,
  );
  validateReviewPostureContract(manifest, counts, errors);
}

async function validateCsvOutputRowCount(
  releaseRoot: string,
  outputs: Record<string, string>,
  outputName: string,
  expectedLabel: string,
  expected: unknown,
  errors: string[],
): Promise<void> {
  const outputPath = outputs[outputName];
  if (!outputPath) {
    errors.push(`manifest outputs.${outputName} is required`);
    return;
  }
  if (!isReleasePayloadPath(outputPath)) {
    return;
  }

  let rows: string[][] | null = null;
  try {
    rows = parseReleaseCsvRows(
      await Deno.readTextFile(join(releaseRoot, outputPath)),
      outputPath,
      errors,
    );
  } catch (error) {
    errors.push(`unable to read ${outputPath}: ${(error as Error).message}`);
    return;
  }
  if (!rows) {
    return;
  }
  if (rows.length === 0) {
    errors.push(`${outputPath} must contain a header row`);
    return;
  }

  validateIntegerAgreement(
    rows.length - 1,
    expected,
    expectedLabel,
    `${outputPath} data rows`,
    errors,
  );
}

async function validateJsonArrayOutputCount(
  releaseRoot: string,
  outputs: Record<string, string>,
  outputName: string,
  expectedLabel: string,
  expected: unknown,
  errors: string[],
): Promise<void> {
  const outputPath = outputs[outputName];
  if (!outputPath) {
    errors.push(`manifest outputs.${outputName} is required`);
    return;
  }
  if (!isReleasePayloadPath(outputPath)) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await Deno.readTextFile(join(releaseRoot, outputPath))) as unknown;
  } catch (error) {
    errors.push(`unable to read ${outputPath}: ${(error as Error).message}`);
    return;
  }
  if (!Array.isArray(parsed)) {
    errors.push(`${outputPath} must contain a JSON array`);
    return;
  }

  validateIntegerAgreement(
    parsed.length,
    expected,
    expectedLabel,
    `${outputPath} array length`,
    errors,
  );
}

async function validateCsvColumnCountAgreement(
  releaseRoot: string,
  outputs: Record<string, string>,
  outputName: string,
  columnName: string,
  columnIndex: number,
  expected: Record<string, number> | null,
  expectedLabel: string,
  errors: string[],
): Promise<void> {
  if (!expected) {
    return;
  }

  const outputPath = outputs[outputName];
  if (!outputPath) {
    errors.push(`manifest outputs.${outputName} is required`);
    return;
  }
  if (!isReleasePayloadPath(outputPath)) {
    return;
  }

  let rows: string[][] | null = null;
  try {
    rows = parseReleaseCsvRows(
      await Deno.readTextFile(join(releaseRoot, outputPath)),
      outputPath,
      errors,
    );
  } catch (error) {
    errors.push(`unable to read ${outputPath}: ${(error as Error).message}`);
    return;
  }
  if (!rows) {
    return;
  }
  if (rows.length === 0) {
    errors.push(`${outputPath} must contain a header row`);
    return;
  }

  const [headers, ...dataRows] = rows;
  if (headers[columnIndex] !== columnName) {
    errors.push(`${outputPath} column ${columnIndex + 1} must be ${columnName}`);
    return;
  }

  for (const [index, row] of dataRows.entries()) {
    if (row.length <= columnIndex) {
      errors.push(`${outputPath} row ${index + 2} is missing ${columnName}`);
      return;
    }
  }

  validateCountRecordAgreement(
    countCsvColumn(dataRows, columnIndex),
    expected,
    `${outputPath} ${columnName} counts`,
    expectedLabel,
    errors,
  );
}

async function validateSourceCoverageContract(
  releaseRoot: string,
  manifest: Record<string, unknown>,
  outputs: Record<string, string>,
  errors: string[],
): Promise<void> {
  const sourceCoveragePath = outputs.sourceCoverageCsv;
  if (!sourceCoveragePath) {
    errors.push("manifest outputs.sourceCoverageCsv is required");
    return;
  }
  if (!isReleasePayloadPath(sourceCoveragePath)) {
    return;
  }

  let sourceCoverageRows: string[][] | null = null;
  try {
    sourceCoverageRows = parseReleaseCsvRows(
      await Deno.readTextFile(join(releaseRoot, sourceCoveragePath)),
      "source_coverage.csv",
      errors,
    );
  } catch (error) {
    errors.push(`unable to read source_coverage.csv: ${(error as Error).message}`);
    return;
  }
  if (!sourceCoverageRows) {
    return;
  }
  if (sourceCoverageRows.length === 0) {
    errors.push("source_coverage.csv must contain a header row");
    return;
  }

  const [headers, ...dataRows] = sourceCoverageRows;
  if (!arraysEqual(headers, [...SOURCE_COVERAGE_HEADERS])) {
    errors.push("source_coverage.csv headers must match the release source coverage contract");
    return;
  }

  for (const [index, row] of dataRows.entries()) {
    const lineNumber = index + 2;
    if (row.length !== SOURCE_COVERAGE_HEADERS.length) {
      errors.push(
        `source_coverage.csv row ${lineNumber} has ${row.length} fields, expected ${SOURCE_COVERAGE_HEADERS.length}`,
      );
      continue;
    }
    validateSourceCoverageDataRow(row, lineNumber, errors);
  }

  const counts = readRecordField(manifest, "counts", "manifest", errors);
  if (counts) {
    validateIntegerAgreement(
      dataRows.length,
      counts.sourceCoverage,
      "counts.sourceCoverage",
      "source_coverage.csv data rows",
      errors,
    );
  }

  const collectionStatusCounts = countCsvColumn(
    dataRows,
    SOURCE_COVERAGE_COLLECTION_STATUS_INDEX,
  );
  const releaseStatusCounts = countCsvColumn(dataRows, SOURCE_COVERAGE_RELEASE_STATUS_INDEX);
  const familyRollup = buildSourceCoverageFamilyRollup(dataRows);

  if (counts) {
    validateIntegerAgreement(
      familyRollup.length,
      counts.sourceCoverageFamilies,
      "counts.sourceCoverageFamilies",
      "source_coverage.csv family rollups",
      errors,
    );
  }

  validateCountRecordAgreement(
    collectionStatusCounts,
    readCountRecordField(manifest, "sourceCoverageStatusCounts", "manifest", errors),
    "source_coverage.csv collection_status counts",
    "manifest.sourceCoverageStatusCounts",
    errors,
  );
  validateCountRecordAgreement(
    releaseStatusCounts,
    readCountRecordField(manifest, "sourceCoverageReleaseStatusCounts", "manifest", errors),
    "source_coverage.csv release_status counts",
    "manifest.sourceCoverageReleaseStatusCounts",
    errors,
  );

  if (counts) {
    validateCountRecordAgreement(
      collectionStatusCounts,
      readCountRecordField(counts, "sourceCoverageStatuses", "manifest.counts", errors),
      "source_coverage.csv collection_status counts",
      "manifest.counts.sourceCoverageStatuses",
      errors,
    );
    validateCountRecordAgreement(
      releaseStatusCounts,
      readCountRecordField(counts, "sourceCoverageReleaseStatuses", "manifest.counts", errors),
      "source_coverage.csv release_status counts",
      "manifest.counts.sourceCoverageReleaseStatuses",
      errors,
    );
  }

  validateFamilyRollupAgreement(
    familyRollup,
    readSourceCoverageFamilyRollupField(
      manifest,
      "sourceCoverageFamilyRollup",
      "manifest",
      errors,
    ),
    "source_coverage.csv family rollup",
    "manifest.sourceCoverageFamilyRollup",
    errors,
  );
}

function validateSourceCoverageDataRow(
  row: string[],
  lineNumber: number,
  errors: string[],
): void {
  for (const [columnName, columnIndex] of SOURCE_COVERAGE_REQUIRED_TEXT_COLUMNS) {
    if ((row[columnIndex] ?? "").trim().length === 0) {
      errors.push(`source_coverage.csv row ${lineNumber} ${columnName} must be non-empty`);
    }
  }

  for (const [columnName, columnIndex] of SOURCE_COVERAGE_COUNT_COLUMNS) {
    if (!/^(0|[1-9]\d*)$/.test(row[columnIndex] ?? "")) {
      errors.push(
        `source_coverage.csv row ${lineNumber} ${columnName} must be a non-negative integer`,
      );
    }
  }

  for (const [columnName, columnIndex, allowedValues] of SOURCE_COVERAGE_ALLOWED_VALUES) {
    const value = (row[columnIndex] ?? "").trim();
    const allowed = allowedValues as readonly string[];
    if (value.length > 0 && !allowed.includes(value)) {
      errors.push(
        `source_coverage.csv row ${lineNumber} ${columnName} "${value}" must be one of ${
          allowed.join(", ")
        }`,
      );
    }
  }

  const snapshotCount = readSourceCoverageCount(row, SOURCE_COVERAGE_COLUMN.snapshotCount);
  const recordCount = readSourceCoverageCount(row, SOURCE_COVERAGE_COLUMN.recordCount);
  const citationCount = readSourceCoverageCount(row, SOURCE_COVERAGE_COLUMN.citationCount);
  if (snapshotCount === null || recordCount === null || citationCount === null) {
    return;
  }

  const expectedCollectionStatus = sourceCoverageCollectionStatus({ snapshotCount, recordCount });
  const collectionStatus = row[SOURCE_COVERAGE_COLUMN.collectionStatus] ?? "";
  if (collectionStatus !== expectedCollectionStatus) {
    errors.push(
      `source_coverage.csv row ${lineNumber} collection_status ${collectionStatus} does not match snapshot_count/record_count expected ${expectedCollectionStatus}`,
    );
  }

  const expectedReleaseStatus = expectedSourceCoverageReleaseStatus({
    sourceType: row[SOURCE_COVERAGE_COLUMN.sourceType] ?? "",
    snapshotCount,
    recordCount,
    citationCount,
  });
  const releaseStatus = row[SOURCE_COVERAGE_COLUMN.releaseStatus] ?? "";
  if (releaseStatus !== expectedReleaseStatus) {
    errors.push(
      `source_coverage.csv row ${lineNumber} release_status ${releaseStatus} does not match source_type/counts expected ${expectedReleaseStatus}`,
    );
  }
}

function readSourceCoverageCount(row: string[], columnIndex: number): number | null {
  const value = row[columnIndex] ?? "";
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    return null;
  }
  return Number.parseInt(value, 10);
}

function expectedSourceCoverageReleaseStatus(input: {
  sourceType: string;
  snapshotCount: number;
  recordCount: number;
  citationCount: number;
}): SourceCoverageReleaseStatus {
  return sourceCoverageReleaseStatus(input, input.sourceType === "inventory.backlog");
}

function readRecordField(
  value: Record<string, unknown>,
  field: string,
  label: string,
  errors: string[],
): Record<string, unknown> | null {
  const fieldValue = value[field];
  if (!isRecord(fieldValue)) {
    errors.push(`${label}.${field} must be an object`);
    return null;
  }
  return fieldValue;
}

function readCountRecordField(
  value: Record<string, unknown>,
  field: string,
  label: string,
  errors: string[],
): Record<string, number> | null {
  const fieldValue = value[field];
  if (!isRecord(fieldValue)) {
    errors.push(`${label}.${field} must be an object`);
    return null;
  }

  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(fieldValue)) {
    if (key.length === 0) {
      errors.push(`${label}.${field} keys must be non-empty strings`);
      return null;
    }
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      errors.push(`${label}.${field}.${key} must be a non-negative integer`);
      return null;
    }
    result[key] = count;
  }
  return result;
}

function readSourceCoverageFamilyRollupField(
  value: Record<string, unknown>,
  field: string,
  label: string,
  errors: string[],
): SourceCoverageFamilyRollup[] | null {
  const fieldValue = value[field];
  if (!Array.isArray(fieldValue)) {
    errors.push(`${label}.${field} must be an array`);
    return null;
  }

  const rollups: SourceCoverageFamilyRollup[] = [];
  for (const [index, rollup] of fieldValue.entries()) {
    const rollupLabel = `${label}.${field}[${index}]`;
    if (!isRecord(rollup)) {
      errors.push(`${rollupLabel} must be an object`);
      return null;
    }
    if (typeof rollup.family !== "string" || rollup.family.length === 0) {
      errors.push(`${rollupLabel}.family must be a non-empty string`);
      return null;
    }
    if (typeof rollup.rows !== "number" || !Number.isInteger(rollup.rows) || rollup.rows < 0) {
      errors.push(`${rollupLabel}.rows must be a non-negative integer`);
      return null;
    }

    const collectionStatuses = readCountRecordField(
      rollup,
      "collectionStatuses",
      rollupLabel,
      errors,
    );
    const releaseStatuses = readCountRecordField(rollup, "releaseStatuses", rollupLabel, errors);
    if (!collectionStatuses || !releaseStatuses) {
      return null;
    }

    rollups.push({
      family: rollup.family,
      rows: rollup.rows,
      collectionStatuses,
      releaseStatuses,
    });
  }

  return rollups;
}

function readReviewDeferredGroupsField(
  value: Record<string, unknown>,
  field: string,
  label: string,
  errors: string[],
): ReviewPosture["deferredGroups"] | null {
  const fieldValue = value[field];
  if (!Array.isArray(fieldValue)) {
    errors.push(`${label}.${field} must be an array`);
    return null;
  }

  const groups: ReviewPosture["deferredGroups"] = [];
  for (const [index, group] of fieldValue.entries()) {
    const groupLabel = `${label}.${field}[${index}]`;
    if (!isRecord(group)) {
      errors.push(`${groupLabel} must be an object`);
      return null;
    }
    if (typeof group.category !== "string" || group.category.length === 0) {
      errors.push(`${groupLabel}.category must be a non-empty string`);
      return null;
    }
    if (typeof group.label !== "string" || group.label.length === 0) {
      errors.push(`${groupLabel}.label must be a non-empty string`);
      return null;
    }
    if (typeof group.count !== "number" || !Number.isInteger(group.count) || group.count < 0) {
      errors.push(`${groupLabel}.count must be a non-negative integer`);
      return null;
    }
    if (typeof group.description !== "string" || group.description.length === 0) {
      errors.push(`${groupLabel}.description must be a non-empty string`);
      return null;
    }

    groups.push({
      category: group.category,
      label: group.label,
      count: group.count,
      description: group.description,
    });
  }

  return groups;
}

function validateReviewPostureContract(
  manifest: Record<string, unknown>,
  counts: Record<string, unknown>,
  errors: string[],
): void {
  const reviewQueueCounts = readCountRecordField(
    manifest,
    "reviewQueueCounts",
    "manifest",
    errors,
  );
  const countReviewQueues = readCountRecordField(
    counts,
    "reviewQueues",
    "manifest.counts",
    errors,
  );
  validateExactCountRecordKeys(
    reviewQueueCounts,
    REVIEW_QUEUES,
    "manifest.reviewQueueCounts",
    errors,
  );
  validateExactCountRecordKeys(
    countReviewQueues,
    REVIEW_QUEUES,
    "manifest.counts.reviewQueues",
    errors,
  );
  if (reviewQueueCounts && countReviewQueues) {
    validateCountRecordAgreement(
      reviewQueueCounts,
      countReviewQueues,
      "manifest.reviewQueueCounts",
      "manifest.counts.reviewQueues",
      errors,
    );
    validateIntegerAgreement(
      sumCountRecord(reviewQueueCounts),
      counts.reviewItems,
      "counts.reviewItems",
      "manifest.reviewQueueCounts total",
      errors,
    );
  }

  const reviewCategoryCounts = readCountRecordField(
    manifest,
    "reviewCategoryCounts",
    "manifest",
    errors,
  );
  const countReviewCategories = readCountRecordField(
    counts,
    "reviewCategories",
    "manifest.counts",
    errors,
  );
  validateAllowedCountRecordKeys(
    reviewCategoryCounts,
    REVIEW_CATEGORY_KEYS,
    "manifest.reviewCategoryCounts",
    errors,
  );
  validateAllowedCountRecordKeys(
    countReviewCategories,
    REVIEW_CATEGORY_KEYS,
    "manifest.counts.reviewCategories",
    errors,
  );
  if (reviewCategoryCounts && countReviewCategories) {
    validateCountRecordAgreement(
      reviewCategoryCounts,
      countReviewCategories,
      "manifest.reviewCategoryCounts",
      "manifest.counts.reviewCategories",
      errors,
    );
    validateIntegerAgreement(
      sumCountRecord(reviewCategoryCounts),
      counts.reviewItems,
      "counts.reviewItems",
      "manifest.reviewCategoryCounts total",
      errors,
    );
  }

  const reviewDeferredGroups = readReviewDeferredGroupsField(
    manifest,
    "reviewDeferredGroups",
    "manifest",
    errors,
  );
  const countReviewDeferredGroups = readReviewDeferredGroupsField(
    counts,
    "reviewDeferredGroups",
    "manifest.counts",
    errors,
  );
  validateReviewDeferredGroupCategories(
    reviewDeferredGroups,
    "manifest.reviewDeferredGroups",
    errors,
  );
  validateReviewDeferredGroupCategories(
    countReviewDeferredGroups,
    "manifest.counts.reviewDeferredGroups",
    errors,
  );
  validateReviewDeferredGroupsAgreement(
    reviewDeferredGroups,
    countReviewDeferredGroups,
    "manifest.reviewDeferredGroups",
    "manifest.counts.reviewDeferredGroups",
    errors,
  );

  if (reviewDeferredGroups && reviewQueueCounts) {
    validateIntegerAgreement(
      reviewDeferredGroups.reduce((sum, group) => sum + group.count, 0),
      reviewQueueCounts.deferred,
      "manifest.reviewQueueCounts.deferred",
      "manifest.reviewDeferredGroups count total",
      errors,
    );
  }
}

function validateExactCountRecordKeys(
  record: Record<string, number> | null,
  expectedKeys: readonly string[],
  label: string,
  errors: string[],
): void {
  if (!record) {
    return;
  }
  const actualKeys = Object.keys(record).sort();
  const expectedSortedKeys = [...expectedKeys].sort();
  if (!arraysEqual(actualKeys, expectedSortedKeys)) {
    errors.push(`${label} keys must be exactly ${expectedKeys.join(", ")}`);
  }
}

function validateAllowedCountRecordKeys(
  record: Record<string, number> | null,
  allowedKeys: readonly string[],
  label: string,
  errors: string[],
): void {
  if (!record) {
    return;
  }
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) {
      errors.push(`${label}.${key} is not a known review category`);
    }
  }
}

function validateReviewDeferredGroupCategories(
  groups: ReviewPosture["deferredGroups"] | null,
  label: string,
  errors: string[],
): void {
  if (!groups) {
    return;
  }
  for (const [index, group] of groups.entries()) {
    if (!REVIEW_CATEGORY_KEYS.includes(group.category)) {
      errors.push(`${label}[${index}].category ${group.category} is not a known review category`);
    }
  }
}

function validateIntegerAgreement(
  actual: number,
  expected: unknown,
  expectedLabel: string,
  actualLabel: string,
  errors: string[],
): void {
  if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0) {
    errors.push(`${expectedLabel} must be a non-negative integer`);
    return;
  }
  if (actual !== expected) {
    errors.push(`${expectedLabel} ${expected} does not match ${actualLabel} ${actual}`);
  }
}

function validateCountRecordAgreement(
  actual: Record<string, number>,
  expected: Record<string, number> | null,
  actualLabel: string,
  expectedLabel: string,
  errors: string[],
): void {
  if (!expected) {
    return;
  }
  if (stableStringify(actual) !== stableStringify(expected)) {
    errors.push(
      `${actualLabel} must match ${expectedLabel}: expected ${stableStringify(expected)}, found ${
        stableStringify(actual)
      }`,
    );
  }
}

function validateFamilyRollupAgreement(
  actual: SourceCoverageFamilyRollup[],
  expected: SourceCoverageFamilyRollup[] | null,
  actualLabel: string,
  expectedLabel: string,
  errors: string[],
): void {
  if (!expected) {
    return;
  }
  if (stableStringify(actual) !== stableStringify(expected)) {
    errors.push(
      `${actualLabel} must match ${expectedLabel}: expected ${stableStringify(expected)}, found ${
        stableStringify(actual)
      }`,
    );
  }
}

function validateReviewDeferredGroupsAgreement(
  actual: ReviewPosture["deferredGroups"] | null,
  expected: ReviewPosture["deferredGroups"] | null,
  actualLabel: string,
  expectedLabel: string,
  errors: string[],
): void {
  if (!actual || !expected) {
    return;
  }
  if (stableStringify(actual) !== stableStringify(expected)) {
    errors.push(
      `${actualLabel} must match ${expectedLabel}: expected ${stableStringify(expected)}, found ${
        stableStringify(actual)
      }`,
    );
  }
}

function countCsvColumn(rows: string[][], index: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = row[index] ?? "";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function sumCountRecord(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function parseReleaseCsvRows(
  contents: string,
  label: string,
  errors: string[],
): string[][] | null {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  const pushRow = () => {
    currentRow.push(currentField);
    rows.push(currentRow);
    currentRow = [];
    currentField = "";
  };

  for (let index = 0; index < contents.length; index++) {
    const character = contents[index];

    if (inQuotes) {
      if (character === '"') {
        if (contents[index + 1] === '"') {
          currentField += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === ",") {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if (character === "\r" || character === "\n") {
      if (character === "\r" && contents[index + 1] === "\n") {
        index += 1;
      }
      pushRow();
      continue;
    }

    currentField += character;
  }

  if (inQuotes) {
    errors.push(`${label} contains an unterminated quoted field`);
    return null;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    pushRow();
  }

  return rows;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateGovGraphSummary(
  label: string,
  summary: Record<string, unknown>,
  errors: string[],
): void {
  for (
    const field of [
      "nodeCount",
      "edgeCount",
      "excludedNodeCount",
      "excludedEdgeCount",
      "blockedReviewItemCount",
      "mappedRelationCount",
    ]
  ) {
    validateNonNegativeInteger(summary[field], `${label}.${field}`, errors);
  }

  const nodeKindCounts = readCountRecordField(summary, "nodeKindCounts", label, errors);
  const nodeCategoryCounts = readCountRecordField(summary, "nodeCategoryCounts", label, errors);
  const edgeVerbCounts = readCountRecordField(summary, "edgeVerbCounts", label, errors);
  const blockedReviewCountsByCategory = readCountRecordField(
    summary,
    "blockedReviewCountsByCategory",
    label,
    errors,
  );
  if (nodeKindCounts) {
    validateIntegerAgreement(
      sumCountRecord(nodeKindCounts),
      summary.nodeCount,
      `${label}.nodeCount`,
      `${label}.nodeKindCounts total`,
      errors,
    );
  }
  if (nodeCategoryCounts) {
    validateIntegerAgreement(
      sumCountRecord(nodeCategoryCounts),
      summary.nodeCount,
      `${label}.nodeCount`,
      `${label}.nodeCategoryCounts total`,
      errors,
    );
  }
  if (edgeVerbCounts) {
    validateIntegerAgreement(
      sumCountRecord(edgeVerbCounts),
      summary.edgeCount,
      `${label}.edgeCount`,
      `${label}.edgeVerbCounts total`,
      errors,
    );
  }
  if (blockedReviewCountsByCategory) {
    validateIntegerAgreement(
      sumCountRecord(blockedReviewCountsByCategory),
      summary.blockedReviewItemCount,
      `${label}.blockedReviewItemCount`,
      `${label}.blockedReviewCountsByCategory total`,
      errors,
    );
  }

  const mappedRelationCounts = summary.mappedRelationCounts;
  if (!Array.isArray(mappedRelationCounts)) {
    errors.push(`${label}.mappedRelationCounts must be an array`);
    return;
  }
  let mappedRelationTotal = 0;
  for (const [index, mapping] of mappedRelationCounts.entries()) {
    if (!isRecord(mapping)) {
      errors.push(`${label}.mappedRelationCounts[${index}] must be an object`);
      continue;
    }
    if (typeof mapping.relationKind !== "string" || mapping.relationKind.length === 0) {
      errors.push(`${label}.mappedRelationCounts[${index}].relationKind must be a string`);
    }
    if (typeof mapping.verb !== "string" || mapping.verb.length === 0) {
      errors.push(`${label}.mappedRelationCounts[${index}].verb must be a string`);
    }
    validateNonNegativeInteger(
      mapping.count,
      `${label}.mappedRelationCounts[${index}].count`,
      errors,
    );
    if (typeof mapping.count === "number" && Number.isInteger(mapping.count)) {
      mappedRelationTotal += mapping.count;
    }
  }
  validateIntegerAgreement(
    mappedRelationTotal,
    summary.mappedRelationCount,
    `${label}.mappedRelationCount`,
    `${label}.mappedRelationCounts total`,
    errors,
  );
}

function validateNoGovGraphReleaseBlockers(
  label: string,
  summary: Record<string, unknown>,
  errors: string[],
): void {
  if (
    typeof summary.blockedReviewItemCount !== "number" ||
    !Number.isInteger(summary.blockedReviewItemCount)
  ) {
    return;
  }
  if (summary.blockedReviewItemCount !== 0) {
    errors.push(
      `${label}.blockedReviewItemCount must be 0 for release verification, found ${summary.blockedReviewItemCount}`,
    );
  }
}

function validateNonNegativeInteger(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    errors.push(`${label} must be a non-negative integer`);
  }
}

function validateUtcIsoTimestamp(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${label} must be a UTC ISO timestamp string`);
    return;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    errors.push(`${label} must be a UTC ISO timestamp string`);
  }
}

function buildReleaseReadme(input: {
  schemaVersion: number;
  jurisdiction: string;
  exportedAt: string;
  entryCount: number;
  relationCount: number;
  citationCount: number;
  sourceCount: number;
  sourceCoverageRows: string[][];
  sourceCoverageStatusCounts: Record<string, number>;
  sourceCoverageReleaseStatusCounts: Record<string, number>;
  sourceCoverageFamilyRollup: SourceCoverageFamilyRollup[];
  entryKindCounts: Map<string, number>;
  relationKindCounts: Map<string, number>;
  relationExamples: RelationExample[];
  reviewPosture: ReviewPosture;
  govGraphSummary: {
    nodeCount: number;
    nodeKindCounts: Record<string, number>;
    nodeCategoryCounts: Record<string, number>;
    edgeCount: number;
    edgeVerbCounts: Record<string, number>;
    excludedNodeCount: number;
    excludedEdgeCount: number;
    blockedReviewItemCount: number;
    mappedRelationCount: number;
    mappedRelationCounts: Array<{
      relationKind: string;
      verb: string;
      count: number;
    }>;
  };
}): string {
  return [
    "# Civic Ledger release",
    "",
    "## Release notes",
    "",
    "Generated from committed Civic Ledger state.",
    "Snapshots, records, review items, and workspace databases are not release truth.",
    "Use `manifest.json` for machine-readable file names, counts, byte sizes, and SHA-256 checksums.",
    "Because `manifest.json` contains the checksum table, it is not included in its own `outputFileMetadata`; that table covers release payload files and `README.md`.",
    "`deno task civic release verify <release-root>` checks payload metadata plus schema version, release identity, artifact file/row counts, entity/relation kind rollups, zero GovGraph-blocking review items, review posture/category/deferred-description agreement, source coverage metadata/status/count/rollup agreement, and GovGraph summary/manifest agreement. Add `--json` for machine-readable validity, checked file count, and error details.",
    "",
    "## Summary",
    "",
    `- Jurisdiction: ${input.jurisdiction}`,
    `- Schema version: ${input.schemaVersion}`,
    `- Exported at: ${input.exportedAt}`,
    `- Entries: ${input.entryCount}`,
    `- Relations: ${input.relationCount}`,
    `- Citations: ${input.citationCount}`,
    `- Source rows in \`sources.csv\`: ${input.sourceCount}`,
    "",
    "## Scope and caveats",
    "",
    "- This alpha release is a reproducible checkpoint from committed state, not proof that a fresh live scrape will reproduce identical rows.",
    "- It is source-backed DC civic structure data, not a complete civic database, public website, or legal research product.",
    "- Legal authority graph facts are limited to explicit D.C. Code, D.C. Law, and Mayor's Order locators found in source-derived citations.",
    "- Unsupported appoints, oversees, advises, administers, and enforces claims remain out of scope unless a source explicitly supports them.",
    `- Release-blocking review items in GovGraph projection: ${input.govGraphSummary.blockedReviewItemCount}`,
    "",
    "## Source coverage",
    "",
    `- Source coverage rows: ${input.sourceCoverageRows.length}`,
    "- Collection statuses:",
    ...sourceCoverageCountLines(input.sourceCoverageStatusCounts),
    "- Release statuses:",
    ...sourceCoverageCountLines(input.sourceCoverageReleaseStatusCounts),
    `- Source coverage families: ${input.sourceCoverageFamilyRollup.length}`,
    "- Family rollup:",
    ...sourceCoverageFamilyRollupLines(input.sourceCoverageFamilyRollup),
    ...notCollectedSourceCoverageLines(input.sourceCoverageRows),
    "- `source_coverage.csv` distinguishes publisher, access method, source URL, catalog confidence, collection status, reader/interpreter wiring, release status, scope, contribution, exclusions, and caveats.",
    "- Catalog confidence is confidence in the source-inventory row and access path, not a completeness claim about the exported civic facts.",
    "- `manifest.json` records collection counts under `sourceCoverageStatusCounts` / `counts.sourceCoverageStatuses`, release counts under `sourceCoverageReleaseStatusCounts` / `counts.sourceCoverageReleaseStatuses`, and category rollups under `sourceCoverageFamilyRollup`.",
    "",
    "## Legal scope",
    "",
    "- Legal-source entries (`dc.legal_source`) are official entrypoint anchors for inspection; they are not full legal text ingestion.",
    "- Legal authority entries (`dc.legal_authority`) are promoted only from explicit D.C. Code, D.C. Law, and Mayor's Order locators already present in source-derived citations.",
    "- Citations may preserve evidence, URLs, or out-of-scope locators without creating legal authority entries.",
    "- GovGraph legal-authority nodes expose canonical official Code/Law URLs when the locator maps to one; Mayor's Order authorities remain locator evidence without canonical official URLs in this release.",
    ...deferredLegalSourceInventoryLines(input.sourceCoverageRows),
    "",
    "## Entity taxonomy",
    "",
    "- Entry kinds are counts of exported ledger entries, not claims that every matching DC entity has been discovered.",
    "- Zero-row or not-yet-automated source families remain visible in `source_coverage.csv`.",
    "- D.C. is treated as a District jurisdiction; the alpha does not emit synthetic county, state, federal-branch, or city/county placeholder hierarchy without source-backed entries.",
    ...entryKindSummaryLines(input.entryKindCounts, input.sourceCoverageRows),
    "",
    "## Relationship evidence",
    "",
    "- Relation kinds are emitted from source-derived records plus tracked revisions; names describe release evidence, not exhaustive civic powers.",
    ...relationKindSummaryLines(input.relationKindCounts),
    "- Relation examples:",
    ...relationExampleSummaryLines(input.relationExamples),
    "- Contract-facing relationship terms:",
    ...contractRelationTermLines(),
    "",
    "## Review posture",
    "",
    "- Review items are regenerated from committed state and current findings during export.",
    "- Deferred items are parked because they do not currently affect public output or the active release decision path.",
    "- `manifest.json` records review summaries under `reviewQueueCounts`, `reviewCategoryCounts`, `reviewDeferredGroups`, and matching `counts` fields for machine-readable release checks, including descriptions for each deferred group.",
    `- Review items: ${input.reviewPosture.total}`,
    ...reviewQueueSummaryLines(input.reviewPosture),
    "- Review queue notes:",
    ...reviewQueueNoteLines(),
    "- Review categories:",
    ...reviewCategorySummaryLines(input.reviewPosture),
    "- Review category notes:",
    ...reviewCategoryNoteLines(input.reviewPosture),
    "- Deferred review groups:",
    ...deferredReviewGroupSummaryLines(input.reviewPosture),
    ...deferredReviewGroupNoteLines(input.reviewPosture),
    "",
    "## Public projection",
    "",
    "- `govgraph_nodes.json` and `govgraph_edges.json` are downstream-friendly projections from the same committed state.",
    `- Projected nodes: ${input.govGraphSummary.nodeCount}`,
    "- Projected node categories:",
    ...summaryCountLines(input.govGraphSummary.nodeCategoryCounts),
    `- Projected edges: ${input.govGraphSummary.edgeCount}`,
    `- Excluded projection nodes: ${input.govGraphSummary.excludedNodeCount}`,
    `- Excluded projection edges: ${input.govGraphSummary.excludedEdgeCount}`,
    `- Projected relation labels remapped for public use: ${input.govGraphSummary.mappedRelationCount}`,
    "- Remapped relation labels:",
    ...mappedRelationSummaryLines(input.govGraphSummary.mappedRelationCounts),
    "- Unsupported or stale relation verbs remain reviewable in raw ledger artifacts but are excluded from GovGraph edges unless they map to an alpha-supported public relationship.",
    "- Projected edge verbs:",
    ...summaryCountLines(input.govGraphSummary.edgeVerbCounts),
    "- `govgraph_summary.json` reports projection counts, node kind/category counts, edge verb counts, mapped relation label counts, excluded nodes/edges, and release-blocking review categories.",
    "",
    "## Artifacts",
    "",
    "- `entries.csv` - ledger entries with kind, name, attributes, and citations.",
    "- `relations.csv` - source-backed relation rows between entries.",
    "- `citations.csv` - entry and relation citation details.",
    "- `sources.csv` - collected source snapshot and citation counts.",
    "- `source_coverage.csv` - source inventory publisher/access metadata, catalog confidence, collection/release status, scope, contribution, exclusions, and caveats.",
    "- `README.md` - human-readable release summary and caveat trail.",
    "- `dc_board_affiliations.csv` - board-to-agency affiliation view.",
    "- `dc_commission_affiliations.csv` - commission-to-agency affiliation view.",
    "- `dc_authority_affiliations.csv` - authority-to-agency affiliation view.",
    "- `dc_anc_smd_structure.csv` - ANC, SMD, commissioner-seat structure view.",
    "- `dc_council_committee_membership.csv` - Council committee membership and chair view.",
    "- `govgraph_nodes.json` - downstream-friendly public node projection.",
    "- `govgraph_edges.json` - downstream-friendly public edge projection.",
    "- `govgraph_summary.json` - projection counts, node kind/category counts, edge verbs, mapped relation label counts, excluded nodes/edges, and blocking review counts.",
    "- `ledger.sqlite` - query-ready SQLite package for the release files and DC-specific views.",
    "- `manifest.json` - machine-readable release manifest; it describes the manifest-managed outputs but is not included in its own checksum table.",
    "",
  ].join("\n");
}

function buildReviewPosture(reviewItems: ReviewItem[]): ReviewPosture {
  const queues = Object.fromEntries(REVIEW_QUEUES.map((queue) => [queue, 0])) as Record<
    ReviewQueue,
    number
  >;
  const categories = new Map<string, number>();
  for (const item of reviewItems) {
    queues[reviewQueueForItem(item)] += 1;
    categories.set(item.category, (categories.get(item.category) ?? 0) + 1);
  }
  return {
    total: reviewItems.length,
    queues,
    categories: Object.fromEntries(
      [...categories.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    deferredGroups: groupDeferredReviewItems(
      reviewItems.filter((item) => reviewQueueForItem(item) === "deferred"),
    ).map((group) => ({
      category: group.category,
      label: group.label,
      count: group.items.length,
      description: deferredReviewGroupDescription(group.category, group.label) ??
        "Deferred review group preserved for operator inspection; inspect review items for source evidence and suggested resolutions.",
    })),
  };
}

function reviewQueueSummaryLines(posture: ReviewPosture): string[] {
  return REVIEW_QUEUES.map((queue) => `- ${queue}: ${posture.queues[queue]}`);
}

function reviewQueueNoteLines(): string[] {
  return [
    "  - blocking: Open items that would block state generation or current public-output release readiness.",
    "  - actionable: Open items that still need an operator decision, but do not currently block the active release path.",
    "  - drafted: A draft revision exists; validate, apply, or revise it before treating the decision as tracked.",
    "  - applied: A tracked revision or imported review decision already accounts for the item and is retained as audit evidence.",
    "  - deferred: Parked, non-blocking work outside current alpha scope or without public-output impact.",
  ];
}

function reviewCategorySummaryLines(posture: ReviewPosture): string[] {
  return Object.entries(posture.categories).map(([category, count]) => `  - ${category}: ${count}`);
}

function reviewCategoryNoteLines(posture: ReviewPosture): string[] {
  return Object.keys(posture.categories).map((category) => {
    const description = reviewCategoryDescriptions[category as ReviewCategory] ??
      "Review item category preserved for operator inspection.";
    return `  - ${category}: ${description}`;
  });
}

function deferredReviewGroupSummaryLines(posture: ReviewPosture): string[] {
  if (posture.deferredGroups.length === 0) {
    return ["  - none"];
  }

  return posture.deferredGroups.map((group) =>
    `  - ${group.category} / ${group.label}: ${group.count}`
  );
}

function deferredReviewGroupNoteLines(posture: ReviewPosture): string[] {
  const notes = posture.deferredGroups.map((group) =>
    `  - ${group.category} / ${group.label}: ${group.description}`
  );

  return notes.length > 0 ? ["- Deferred review group notes:", ...notes] : [];
}

function summaryCountLines(counts: Record<string, number>): string[] {
  return Object.entries(counts).map(([label, count]) => `  - ${label}: ${count}`);
}

function mappedRelationSummaryLines(
  counts: Array<{ relationKind: string; verb: string; count: number }>,
): string[] {
  if (counts.length === 0) {
    return ["  - none"];
  }

  return counts.map((mapping) =>
    `  - ${mapping.relationKind} -> ${mapping.verb}: ${mapping.count}`
  );
}

function buildSourceCoverageStatusCounts(rows: string[][]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = row[SOURCE_COVERAGE_COLUMN.collectionStatus] || "unknown";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildSourceCoverageReleaseStatusCounts(rows: string[][]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const status = row[SOURCE_COVERAGE_COLUMN.releaseStatus] || "unknown";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildSourceCoverageFamilyRollup(rows: string[][]): SourceCoverageFamilyRollup[] {
  const rollups = new Map<
    string,
    {
      rows: number;
      collectionStatuses: Map<string, number>;
      releaseStatuses: Map<string, number>;
    }
  >();

  for (const row of rows) {
    const family = row[SOURCE_COVERAGE_COLUMN.family] || "unclassified";
    const rollup = rollups.get(family) ?? {
      rows: 0,
      collectionStatuses: new Map<string, number>(),
      releaseStatuses: new Map<string, number>(),
    };
    rollup.rows += 1;
    incrementCount(
      rollup.collectionStatuses,
      row[SOURCE_COVERAGE_COLUMN.collectionStatus] || "unknown",
    );
    incrementCount(
      rollup.releaseStatuses,
      row[SOURCE_COVERAGE_COLUMN.releaseStatus] || "unknown",
    );
    rollups.set(family, rollup);
  }

  return [...rollups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([family, rollup]) => ({
      family,
      rows: rollup.rows,
      collectionStatuses: sortedCountRecord(rollup.collectionStatuses),
      releaseStatuses: sortedCountRecord(rollup.releaseStatuses),
    }));
}

function sourceCoverageCountLines(counts: Record<string, number>): string[] {
  return Object.entries(counts).map(([status, count]) => `  - ${status}: ${count}`);
}

function sourceCoverageFamilyRollupLines(rollups: SourceCoverageFamilyRollup[]): string[] {
  if (rollups.length === 0) {
    return ["  - none"];
  }

  return rollups.map((rollup) =>
    `  - ${rollup.family}: ${formatCount(rollup.rows, "row")}; collection ${
      formatInlineCounts(rollup.collectionStatuses)
    }; release ${formatInlineCounts(rollup.releaseStatuses)}`
  );
}

function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sortedCountRecord(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function formatInlineCounts(counts: Record<string, number>): string {
  return Object.entries(counts).map(([status, count]) => `${status}: ${count}`).join(", ");
}

function notCollectedSourceCoverageLines(sourceCoverageRows: string[][]): string[] {
  const rows = sourceCoverageRows.filter((row) =>
    row[SOURCE_COVERAGE_COLUMN.collectionStatus] === "not_collected"
  );
  if (rows.length === 0) {
    return [];
  }

  return [
    "- Not-collected inventory rows:",
    ...rows.map((row) => {
      const source = row[SOURCE_COVERAGE_COLUMN.source] || "unknown";
      const family = row[SOURCE_COVERAGE_COLUMN.family] || "unclassified";
      const scope = row[SOURCE_COVERAGE_COLUMN.scope] || "No source scope recorded.";
      return `  - ${source} (${family}): ${scope}`;
    }),
  ];
}

function deferredLegalSourceInventoryLines(sourceCoverageRows: string[][]): string[] {
  const rows = sourceCoverageRows.filter((row) =>
    row[SOURCE_COVERAGE_COLUMN.sourceType] === "inventory.backlog" &&
    row[SOURCE_COVERAGE_COLUMN.family] === "legal_provenance"
  );
  if (rows.length === 0) {
    return ["- Deferred legal source inventory rows: none recorded in `source_coverage.csv`."];
  }

  return [
    "- Deferred legal source inventory rows in `source_coverage.csv`:",
    ...rows.map((row) => {
      const source = row[SOURCE_COVERAGE_COLUMN.source] || "unknown";
      const scope = row[SOURCE_COVERAGE_COLUMN.scope] || "No source scope recorded.";
      return `  - ${source}: ${scope}`;
    }),
  ];
}

function buildRelationExamples(
  relationRows: ExportRelationRow[],
  entryIndex: Map<string, ExportEntryIndexValue>,
): RelationExample[] {
  const examples = new Map<string, RelationExample>();

  for (const row of relationRows) {
    const from = entryIndex.get(row.from_entry_id);
    const to = entryIndex.get(row.to_entry_id);
    if (!from || !to) {
      continue;
    }

    const citations = parseCitationArray(safeJsonParse(row.citations, []));
    const sourceCitation = firstSourceCitation(citations);
    const candidate: RelationExample = {
      kind: row.relation_kind,
      from: relationExampleEndpoint(row.from_entry_id, from),
      to: relationExampleEndpoint(row.to_entry_id, to),
      source: sourceCitation?.source,
      sourceRecordId: sourceCitation?.sourceRecordId,
    };
    const existing = examples.get(row.relation_kind);
    if (!existing || (!existing.source && candidate.source)) {
      examples.set(row.relation_kind, candidate);
    }
  }

  return [...examples.values()].sort((left, right) => left.kind.localeCompare(right.kind));
}

function relationExampleSummaryLines(examples: RelationExample[]): string[] {
  if (examples.length === 0) {
    return ["  - No emitted relations in this release."];
  }

  return examples.map((example) => {
    const evidence = example.source
      ? ` (source: ${example.source}:${example.sourceRecordId})`
      : " (source: inspect citations.csv)";
    return `  - ${example.kind}: ${example.from} -> ${example.to}${evidence}`;
  });
}

function relationExampleEndpoint(id: string, entry: ExportEntryIndexValue): string {
  return entry.name ? `${entry.name} (${id})` : id;
}

function contractRelationTermLines(): string[] {
  return [
    "  - elected / office holder: `dc.relation:holds` links people to sourced elected-office entries; `dc.relation:represents` links sourced people, seats, or areas to wards and SMDs.",
    "  - agency / department / office: entity kind plus `dc.relation:reports_to` and `dc.relation:part_of` express explicit hierarchy when source text names it.",
    "  - board / commission / council / authority affiliation: `dc.relation:governs` captures sourced governing or administering agency labels and is projected as `administered_by` only for safe agency or office targets.",
    "  - advisory / appointing / oversight / enforcement powers: alpha does not infer `advises`, `appoints`, `oversees`, `administers`, or `enforces` edges from names, membership text, or broad enabling prose.",
  ];
}

function firstSourceCitation(
  citations: CitationValue[],
): { source: string; sourceRecordId: string } | undefined {
  return citations.find((citation): citation is { source: string; sourceRecordId: string } =>
    "source" in citation
  );
}

function relationKindSummaryLines(relationKindCounts: Map<string, number>): string[] {
  return [...relationKindCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => {
      const description = dcRelationDescription(kind) ??
        "Source-backed relation kind; inspect relations.csv and citations.csv before broad use.";
      return `- ${kind}: ${count} - ${description}`;
    });
}

function entryKindSummaryLines(
  entryKindCounts: Map<string, number>,
  sourceCoverageRows: string[][],
): string[] {
  const counts = new Map(entryKindCounts);
  if (
    !counts.has("dc.authority") &&
    sourceCoverageStatus(sourceCoverageRows, "dcgis.authorities") === "collected_empty"
  ) {
    counts.set("dc.authority", 0);
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => {
      const description = entryKindDescription(kind, count, sourceCoverageRows);
      return `- ${kind}: ${count} - ${description}`;
    });
}

function entryKindDescription(kind: string, count: number, sourceCoverageRows: string[][]): string {
  if (
    kind === "dc.authority" &&
    count === 0 &&
    sourceCoverageStatus(sourceCoverageRows, "dcgis.authorities") === "collected_empty"
  ) {
    return "Authority source is collected-empty in this release; see source_coverage.csv for the live-source caveat.";
  }

  return dcEntityKindDescription(kind) ??
    "Ledger entry kind; inspect entries.csv for source-specific citations.";
}

function sourceCoverageStatus(sourceCoverageRows: string[][], source: string): string | undefined {
  return sourceCoverageRows.find((row) => row[SOURCE_COVERAGE_COLUMN.source] === source)
    ?.[SOURCE_COVERAGE_COLUMN.collectionStatus];
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
    const collectionStatus = sourceCoverageCollectionStatus({ snapshotCount, recordCount });
    const pipelineStatuses = sourceCoveragePipelineStatuses({
      catalogItem,
      snapshotCount,
      recordCount,
      citationCount,
    });

    return [
      source,
      catalogItem?.sourceType ?? "",
      catalogItem?.family ?? "",
      catalogItem?.publisher ?? "",
      catalogItem?.accessMethod ?? "",
      catalogItem?.sourceUrl ?? "",
      catalogItem?.catalogConfidence ?? "",
      collectionStatus,
      pipelineStatuses.readerStatus,
      pipelineStatuses.interpreterStatus,
      pipelineStatuses.releaseStatus,
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

export function sourceCoveragePipelineStatuses(input: {
  catalogItem?: SourceCoverageCatalogItem;
  snapshotCount: number;
  recordCount: number;
  citationCount: number;
}): SourceCoveragePipelineStatuses {
  const isInventoryOnly = input.catalogItem?.sourceType === "inventory.backlog";
  return {
    readerStatus: isInventoryOnly ? "inventory_only" : input.catalogItem ? "wired" : "uncataloged",
    interpreterStatus: isInventoryOnly ? "not_wired" : input.catalogItem ? "wired" : "unknown",
    releaseStatus: sourceCoverageReleaseStatus(input, isInventoryOnly),
  };
}

export function sourceCoverageCollectionStatus(input: {
  snapshotCount: number;
  recordCount: number;
}): SourceCoverageCollectionStatus {
  if (input.snapshotCount === 0) {
    return "not_collected";
  }
  return input.recordCount === 0 ? "collected_empty" : "collected";
}

function sourceCoverageReleaseStatus(
  input: {
    snapshotCount: number;
    recordCount: number;
    citationCount: number;
  },
  isInventoryOnly: boolean,
): SourceCoverageReleaseStatus {
  if (isInventoryOnly) {
    return "inventory_only";
  }
  if (input.citationCount > 0) {
    return "exported";
  }
  if (input.recordCount > 0) {
    return "collected_not_exported";
  }
  if (input.snapshotCount > 0) {
    return "collected_empty";
  }
  return "not_collected";
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

async function buildOutputFileMetadata(
  releaseRoot: string,
  outputs: Record<string, string>,
): Promise<Record<string, { path: string; byteSize: number; sha256: string }>> {
  const metadata = await Promise.all(
    Object.entries(outputs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async ([outputName, outputPath]) => {
        const bytes = await Deno.readFile(join(releaseRoot, outputPath));
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return [
          outputName,
          {
            path: outputPath,
            byteSize: bytes.byteLength,
            sha256: hexDigest(digest),
          },
        ] as const;
      }),
  );
  return Object.fromEntries(metadata);
}

function parseManifestOutputs(
  value: unknown,
  errors: string[],
): Record<string, string> | null {
  if (!isRecord(value)) {
    errors.push("manifest outputs must be an object");
    return null;
  }

  const outputs: Record<string, string> = {};
  for (const [outputName, outputPath] of Object.entries(value)) {
    if (typeof outputPath !== "string" || outputPath.length === 0) {
      errors.push(`manifest output ${outputName} must be a non-empty path string`);
      continue;
    }
    outputs[outputName] = outputPath;
  }
  return outputs;
}

function parseOutputFileMetadata(
  value: unknown,
  errors: string[],
): Record<string, { path: string; byteSize: number; sha256: string }> | null {
  if (!isRecord(value)) {
    errors.push("manifest outputFileMetadata must be an object");
    return null;
  }

  const metadata: Record<string, { path: string; byteSize: number; sha256: string }> = {};
  for (const [outputName, rawMetadata] of Object.entries(value)) {
    if (!isRecord(rawMetadata)) {
      errors.push(`outputFileMetadata ${outputName} must be an object`);
      continue;
    }
    if (typeof rawMetadata.path !== "string" || rawMetadata.path.length === 0) {
      errors.push(`outputFileMetadata ${outputName}.path must be a non-empty string`);
      continue;
    }
    if (typeof rawMetadata.byteSize !== "number" || !Number.isInteger(rawMetadata.byteSize)) {
      errors.push(`outputFileMetadata ${outputName}.byteSize must be an integer`);
      continue;
    }
    if (typeof rawMetadata.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(rawMetadata.sha256)) {
      errors.push(`outputFileMetadata ${outputName}.sha256 must be a SHA-256 hex digest`);
      continue;
    }
    metadata[outputName] = {
      path: rawMetadata.path,
      byteSize: rawMetadata.byteSize,
      sha256: rawMetadata.sha256,
    };
  }
  return metadata;
}

function isReleasePayloadPath(path: string): boolean {
  if (path.length === 0 || isAbsolute(path)) {
    return false;
  }
  return !path.split(/[\\/]+/).includes("..");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hexDigest(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
