import { Database } from "@db/sqlite";
import { ensureDir } from "@std/fs";
import { basename, dirname, isAbsolute, join } from "@std/path";

import { type CitationValue, isCitationValue } from "../core/types.ts";
import { dcEntityKindDescription } from "../jurisdictions/dc/kinds/entity.ts";
import { dcPublicRelationVerb, dcRelationDescription } from "../jurisdictions/dc/kinds/relation.ts";
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
  type DcAncSmdStructureRow,
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
  dcAgencyCount: number;
  dcOfficeCount: number;
  dcCouncilmemberCount: number;
  dcCouncilCommitteeCount: number;
  dcPublicBodyCount: number;
  dcPublicBodyAffiliationCount: number;
  dcAncCount: number;
  dcSmdCount: number;
  dcSmdCommissionerCount: number;
  dcWardCount: number;
  dcCourtCount: number;
  dcLegalAuthorityCount: number;
  dcRelationshipCount: number;
  dcSourceCount: number;
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

interface PublicReleaseTables {
  agencies: string[][];
  offices: string[][];
  councilmembers: string[][];
  councilCommittees: string[][];
  publicBodies: string[][];
  publicBodyAffiliations: string[][];
  ancs: string[][];
  smds: string[][];
  smdCommissioners: string[][];
  wards: string[][];
  courts: string[][];
  legalAuthorities: string[][];
  relationships: string[][];
  sources: string[][];
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

interface ReleaseProvenance {
  gitHeadCommit: string | null;
  gitHeadRef: string | null;
  gitHeadBranch: string | null;
  gitSource: "git_metadata" | "unavailable";
  workingTreeStatus: "clean" | "dirty" | "unknown";
  workingTreeChangedPathCount: number | null;
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

const RELEASE_OUTPUT_CATEGORIES = [
  "public_csv",
  "traceability_csv",
  "compatibility_csv",
  "machine_json",
  "database",
  "documentation",
] as const;

type ReleaseOutputCategory = typeof RELEASE_OUTPUT_CATEGORIES[number];
const RELEASE_OUTPUT_PATHS = {
  dcAgenciesCsv: "dc_agencies.csv",
  dcOfficesCsv: "dc_offices.csv",
  dcCouncilmembersCsv: "dc_councilmembers.csv",
  dcCouncilCommitteesCsv: "dc_council_committees.csv",
  councilCommitteeMembershipCsv: "dc_council_committee_memberships.csv",
  dcPublicBodiesCsv: "dc_public_bodies.csv",
  dcPublicBodyAffiliationsCsv: "dc_public_body_affiliations.csv",
  dcAncsCsv: "dc_ancs.csv",
  dcSmdsCsv: "dc_smds.csv",
  dcSmdCommissionersCsv: "_local/dc_smd_commissioners.csv",
  dcWardsCsv: "dc_wards.csv",
  dcCourtsCsv: "dc_courts.csv",
  dcLegalAuthoritiesCsv: "dc_legal_authorities.csv",
  dcRelationshipsCsv: "dc_relationships.csv",
  dcSourcesCsv: "dc_sources.csv",
  entriesCsv: "_local/ledger_entries.csv",
  relationsCsv: "_local/ledger_relations.csv",
  citationsCsv: "_local/ledger_citations.csv",
  sourcesCsv: "_local/source_counts.csv",
  sourceCoverageCsv: "_local/source_coverage.csv",
  boardAffiliationsCsv: "_local/dc_board_affiliations.csv",
  commissionAffiliationsCsv: "_local/dc_commission_affiliations.csv",
  authorityAffiliationsCsv: "_local/dc_authority_affiliations.csv",
  ancSmdStructureCsv: "_local/dc_anc_smd_structure.csv",
  govGraphNodesJson: "govgraph_nodes.json",
  govGraphEdgesJson: "govgraph_edges.json",
  govGraphSummaryJson: "govgraph_summary.json",
  ledgerSqlite: "ledger.sqlite",
  readme: "README.md",
  sha256Sums: "SHA256SUMS",
} as const;
type ReleaseOutputName = keyof typeof RELEASE_OUTPUT_PATHS;
const RELEASE_OUTPUT_ORDER = Object.keys(RELEASE_OUTPUT_PATHS) as ReleaseOutputName[];

interface ReleaseOutputCatalogItem {
  outputName: string;
  path: string;
  category: ReleaseOutputCategory;
  releaseAsset: boolean;
  description: string;
  byteSize: number;
  sha256: string;
  rowCount?: number;
  columnCount?: number;
  columns?: string[];
}

interface ReleaseAssetIndex {
  paths: string[];
  outputNames: string[];
  items: Array<{
    outputName: string;
    path: string;
    category: ReleaseOutputCategory;
    releaseAsset: true;
    description: string;
    byteSize?: number;
    sha256?: string;
    rowCount?: number;
    columnCount?: number;
    columns?: string[];
  }>;
  categories: Record<string, number>;
  note: string;
  count: number;
}

interface LocalOnlyOutputIndex {
  paths: string[];
  outputNames: string[];
  items: Array<{
    outputName: string;
    path: string;
    category: ReleaseOutputCategory;
    description: string;
    rowCount?: number;
    columnCount?: number;
    columns?: string[];
  }>;
  categories: Record<string, number>;
  note: string;
  count: number;
}

interface ReleaseStartHere {
  primaryReadme: string;
  recommendedEntryPoints: Array<{
    label: string;
    path: string;
    note: string;
  }>;
  releaseAssetCount: number;
  publicCsvCount: number;
  localAuditOutputCount: number;
  sqliteCatalogTable: string;
  govGraphSchemaFile: string;
}

interface SqliteTableIndex {
  description: string;
  metadataTables: string[];
  publicTables: string[];
  traceabilityTables: string[];
  compatibilityTables: string[];
  rawLedgerTables: string[];
}

interface SqliteTableCatalogRow {
  tableName: string;
  tableGroup: "metadata" | "public" | "traceability" | "compatibility" | "raw_ledger";
  tableKind: "table" | "view";
  releasePath: string;
  isReleaseAsset: boolean;
  rowCount?: number;
  columnCount?: number;
  columnsJson?: string;
  description: string;
}

interface OutputFileMetadata {
  path: string;
  byteSize: number;
  sha256: string;
  rowCount?: number;
  columnCount?: number;
  columns?: string[];
}

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

const RELEASE_OUTPUT_CATALOG_METADATA: Record<
  ReleaseOutputName,
  { category: ReleaseOutputCategory; releaseAsset: boolean; description: string }
> = {
  dcAgenciesCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "Agencies, official URLs, and parent offices.",
  },
  dcOfficesCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "Offices and hierarchy context.",
  },
  dcCouncilmembersCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "Current Council roster, seats, wards, and profiles.",
  },
  dcCouncilCommitteesCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "Council committees, chairs, and members.",
  },
  councilCommitteeMembershipCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "Committee membership rows, roles, and sources.",
  },
  dcPublicBodiesCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "Boards, commissions, councils, authorities, and legal context.",
  },
  dcPublicBodyAffiliationsCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "Public-body administering agency or office links.",
  },
  dcAncsCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "ANCs, wards, neighborhoods, SMD counts, commissioners, and notes.",
  },
  dcSmdsCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "Single Member Districts, wards, ANCs, and current commissioners.",
  },
  dcSmdCommissionersCsv: {
    category: "compatibility_csv",
    releaseAsset: false,
    description: "Compatibility SMD commissioner table; prefer dc_smds.csv.",
  },
  dcWardsCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "Ward identifiers and names.",
  },
  dcCourtsCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "D.C. court structure table.",
  },
  dcLegalAuthoritiesCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "Legal locators, URLs, and usage counts.",
  },
  dcRelationshipsCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "Public relationships with names, source URLs, and source IDs.",
  },
  dcSourcesCsv: {
    category: "public_csv",
    releaseAsset: true,
    description: "Sources, status, scope, counts, and caveats.",
  },
  entriesCsv: {
    category: "traceability_csv",
    releaseAsset: false,
    description: "Audit table with every ledger entry, attributes JSON, and citations.",
  },
  relationsCsv: {
    category: "traceability_csv",
    releaseAsset: false,
    description: "Audit table with every raw ledger relation and citation evidence.",
  },
  citationsCsv: {
    category: "traceability_csv",
    releaseAsset: false,
    description: "Audit table connecting entries and relations back to source records.",
  },
  sourcesCsv: {
    category: "traceability_csv",
    releaseAsset: false,
    description: "Audit table with source snapshot and citation counts.",
  },
  sourceCoverageCsv: {
    category: "traceability_csv",
    releaseAsset: false,
    description: "Audit table with source inventory, status, scope, and caveats.",
  },
  boardAffiliationsCsv: {
    category: "compatibility_csv",
    releaseAsset: false,
    description:
      "Compatibility board-to-agency link table; prefer dc_public_body_affiliations.csv.",
  },
  commissionAffiliationsCsv: {
    category: "compatibility_csv",
    releaseAsset: false,
    description:
      "Compatibility commission-to-agency link table; prefer dc_public_body_affiliations.csv.",
  },
  authorityAffiliationsCsv: {
    category: "compatibility_csv",
    releaseAsset: false,
    description:
      "Compatibility authority-to-agency link table; may be zero-row when no authority rows are exported.",
  },
  ancSmdStructureCsv: {
    category: "compatibility_csv",
    releaseAsset: false,
    description: "Compatibility ANC/SMD structure table; prefer dc_ancs.csv and dc_smds.csv.",
  },
  govGraphNodesJson: {
    category: "machine_json",
    releaseAsset: true,
    description: "GovGraph node projection.",
  },
  govGraphEdgesJson: {
    category: "machine_json",
    releaseAsset: true,
    description: "GovGraph edge projection.",
  },
  govGraphSummaryJson: {
    category: "machine_json",
    releaseAsset: true,
    description: "GovGraph count and invariant summary.",
  },
  ledgerSqlite: {
    category: "database",
    releaseAsset: true,
    description: "SQLite database with the public tables, audit tables, and a table catalog.",
  },
  readme: {
    category: "documentation",
    releaseAsset: true,
    description: "Short release index.",
  },
  sha256Sums: {
    category: "documentation",
    releaseAsset: true,
    description:
      "SHA-256 checksums for generated upload assets except manifest.json and SHA256SUMS.",
  },
};

const RELEASE_CSV_HEADER_CONTRACTS: Partial<Record<ReleaseOutputName, readonly string[]>> = {
  entriesCsv: ["entry_id", "family", "kind", "name", "attributes", "citations"],
  relationsCsv: ["from_entry_id", "relation_kind", "to_entry_id", "citations"],
  citationsCsv: [
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
  sourcesCsv: ["source", "snapshot_records", "citation_count"],
  sourceCoverageCsv: SOURCE_COVERAGE_HEADERS,
  boardAffiliationsCsv: [
    "board_entry_id",
    "board_name",
    "board_short_name",
    "agency_entry_id",
    "agency_name",
    "relation_citations",
  ],
  commissionAffiliationsCsv: [
    "commission_entry_id",
    "commission_name",
    "commission_short_name",
    "agency_entry_id",
    "agency_name",
    "relation_citations",
  ],
  authorityAffiliationsCsv: [
    "authority_entry_id",
    "authority_name",
    "authority_short_name",
    "agency_entry_id",
    "agency_name",
    "relation_citations",
  ],
  ancSmdStructureCsv: [
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
  councilCommitteeMembershipCsv: [
    "committee_entry_id",
    "committee_name",
    "committee_type",
    "councilmember_entry_id",
    "councilmember_name",
    "membership_role",
    "source_url",
    "source_id",
  ],
  dcAgenciesCsv: [
    "agency_id",
    "name",
    "short_name",
    "official_url",
    "parent_id",
    "parent_name",
    "source_url",
    "source_id",
  ],
  dcOfficesCsv: [
    "office_id",
    "name",
    "short_name",
    "official_url",
    "parent_id",
    "parent_name",
    "source_url",
    "source_id",
  ],
  dcCouncilmembersCsv: [
    "sort_order",
    "councilmember_id",
    "name",
    "seat_type",
    "office_title",
    "ward",
    "is_at_large",
    "profile_url",
    "source_url",
    "source_id",
  ],
  dcCouncilCommitteesCsv: [
    "committee_id",
    "name",
    "committee_type",
    "chair_id",
    "chair_name",
    "member_count",
    "members",
    "source_url",
    "source_id",
  ],
  dcPublicBodiesCsv: [
    "public_body_id",
    "name",
    "body_type",
    "short_name",
    "official_url",
    "enabling_authority",
    "authority_url",
    "open_dc_url",
    "current_state_note",
    "agency_ids",
    "agency_names",
    "source_url",
    "source_id",
  ],
  dcPublicBodyAffiliationsCsv: [
    "public_body_id",
    "public_body_name",
    "body_type",
    "relation_type",
    "target_id",
    "target_name",
    "target_type",
    "source_url",
    "source_id",
  ],
  dcAncsCsv: [
    "anc_id",
    "anc",
    "official_url",
    "oanc_profile_url",
    "wards",
    "neighborhoods",
    "smd_count",
    "current_commissioners",
    "current_state_note",
    "source_url",
    "source_id",
  ],
  dcSmdsCsv: [
    "smd_id",
    "smd",
    "anc_id",
    "anc",
    "wards",
    "commissioner_seat_id",
    "current_commissioner_name",
    "officer_role",
    "source_url",
    "source_id",
  ],
  dcSmdCommissionersCsv: [
    "smd",
    "anc",
    "wards",
    "current_commissioner_name",
    "officer_role",
    "smd_id",
    "anc_id",
    "commissioner_seat_id",
    "source_url",
    "source_id",
  ],
  dcWardsCsv: ["ward_id", "ward_number", "name"],
  dcCourtsCsv: [
    "court_id",
    "name",
    "court_type",
    "parent_id",
    "parent_name",
    "official_url",
    "source_url",
    "source_id",
  ],
  dcLegalAuthoritiesCsv: [
    "authority_id",
    "authority_type",
    "locator",
    "canonical_url",
    "name",
    "used_by_count",
    "used_by_ids",
    "used_by_names",
  ],
  dcRelationshipsCsv: [
    "from_id",
    "from_name",
    "from_type",
    "relationship",
    "to_id",
    "to_name",
    "to_type",
    "source_url",
    "source_id",
  ],
  dcSourcesCsv: [
    "source_id",
    "publisher",
    "source_url",
    "family",
    "access_method",
    "collection_status",
    "release_status",
    "record_count",
    "citation_count",
    "scope",
    "contributes",
    "known_limits",
    "notes",
  ],
};

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
  const stagingRoot = await createReleaseStagingRoot(options.releaseRoot);
  try {
    const result = await exportReleaseArtifactsIntoRoot({
      ...options,
      releaseRoot: stagingRoot,
    });
    await replaceReleaseRoot(stagingRoot, options.releaseRoot);
    return {
      ...result,
      releaseRoot: options.releaseRoot,
      ledgerSqlitePath: join(options.releaseRoot, "ledger.sqlite"),
    };
  } catch (error) {
    await removeIfExists(stagingRoot);
    throw error;
  }
}

async function exportReleaseArtifactsIntoRoot(
  options: ExportReleaseOptions,
): Promise<ExportResult> {
  const { workspace, jurisdiction, releaseRoot } = options;
  await ensureDir(releaseRoot);
  await removeObsoleteReleaseOutputs(releaseRoot);

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
  const provenance = await buildReleaseProvenance();
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
  const publicReleaseTables = buildPublicReleaseTables({
    entryIndex,
    sourceCoverageRows,
    ancSmdStructureRows,
  });

  const exportedAt = new Date().toISOString();
  const govGraphSummary = {
    jurisdiction,
    exportedAt,
    ...govGraph.summary,
  };

  await writeCsv(join(releaseRoot, RELEASE_OUTPUT_PATHS.entriesCsv), [
    "entry_id",
    "family",
    "kind",
    "name",
    "attributes",
    "citations",
  ], entriesOut);

  await writeCsv(join(releaseRoot, RELEASE_OUTPUT_PATHS.relationsCsv), [
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

  await writeCsv(join(releaseRoot, RELEASE_OUTPUT_PATHS.boardAffiliationsCsv), [
    "board_entry_id",
    "board_name",
    "board_short_name",
    "agency_entry_id",
    "agency_name",
    "relation_citations",
  ], sortedBoardAffiliations);

  await writeCsv(join(releaseRoot, RELEASE_OUTPUT_PATHS.commissionAffiliationsCsv), [
    "commission_entry_id",
    "commission_name",
    "commission_short_name",
    "agency_entry_id",
    "agency_name",
    "relation_citations",
  ], sortedCommissionAffiliations);

  await writeCsv(join(releaseRoot, RELEASE_OUTPUT_PATHS.authorityAffiliationsCsv), [
    "authority_entry_id",
    "authority_name",
    "authority_short_name",
    "agency_entry_id",
    "agency_name",
    "relation_citations",
  ], sortedAuthorityAffiliations);

  await writeCsv(
    join(releaseRoot, RELEASE_OUTPUT_PATHS.ancSmdStructureCsv),
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
    join(releaseRoot, RELEASE_OUTPUT_PATHS.councilCommitteeMembershipCsv),
    [
      "committee_entry_id",
      "committee_name",
      "committee_type",
      "councilmember_entry_id",
      "councilmember_name",
      "membership_role",
      "source_url",
      "source_id",
    ],
    councilCommitteeMembershipRows.map((row) => [
      row.committeeEntryId,
      row.committeeName,
      row.committeeType,
      row.councilmemberEntryId,
      row.councilmemberName,
      row.membershipRole,
      relationSourceUrl(row.relationCitations, sourceCoverageRows),
      sourceCitationId(firstCitationRef(row.relationCitations)),
    ]),
  );

  await writeCsv(join(releaseRoot, "dc_agencies.csv"), [
    "agency_id",
    "name",
    "short_name",
    "official_url",
    "parent_id",
    "parent_name",
    "source_url",
    "source_id",
  ], publicReleaseTables.agencies);

  await writeCsv(join(releaseRoot, "dc_offices.csv"), [
    "office_id",
    "name",
    "short_name",
    "official_url",
    "parent_id",
    "parent_name",
    "source_url",
    "source_id",
  ], publicReleaseTables.offices);

  await writeCsv(join(releaseRoot, "dc_councilmembers.csv"), [
    "sort_order",
    "councilmember_id",
    "name",
    "seat_type",
    "office_title",
    "ward",
    "is_at_large",
    "profile_url",
    "source_url",
    "source_id",
  ], publicReleaseTables.councilmembers);

  await writeCsv(join(releaseRoot, "dc_council_committees.csv"), [
    "committee_id",
    "name",
    "committee_type",
    "chair_id",
    "chair_name",
    "member_count",
    "members",
    "source_url",
    "source_id",
  ], publicReleaseTables.councilCommittees);

  await writeCsv(join(releaseRoot, "dc_public_bodies.csv"), [
    "public_body_id",
    "name",
    "body_type",
    "short_name",
    "official_url",
    "enabling_authority",
    "authority_url",
    "open_dc_url",
    "current_state_note",
    "agency_ids",
    "agency_names",
    "source_url",
    "source_id",
  ], publicReleaseTables.publicBodies);

  await writeCsv(join(releaseRoot, "dc_public_body_affiliations.csv"), [
    "public_body_id",
    "public_body_name",
    "body_type",
    "relation_type",
    "target_id",
    "target_name",
    "target_type",
    "source_url",
    "source_id",
  ], publicReleaseTables.publicBodyAffiliations);

  await writeCsv(join(releaseRoot, "dc_ancs.csv"), [
    "anc_id",
    "anc",
    "official_url",
    "oanc_profile_url",
    "wards",
    "neighborhoods",
    "smd_count",
    "current_commissioners",
    "current_state_note",
    "source_url",
    "source_id",
  ], publicReleaseTables.ancs);

  await writeCsv(join(releaseRoot, "dc_smds.csv"), [
    "smd_id",
    "smd",
    "anc_id",
    "anc",
    "wards",
    "commissioner_seat_id",
    "current_commissioner_name",
    "officer_role",
    "source_url",
    "source_id",
  ], publicReleaseTables.smds);

  await writeCsv(join(releaseRoot, RELEASE_OUTPUT_PATHS.dcSmdCommissionersCsv), [
    "smd",
    "anc",
    "wards",
    "current_commissioner_name",
    "officer_role",
    "smd_id",
    "anc_id",
    "commissioner_seat_id",
    "source_url",
    "source_id",
  ], publicReleaseTables.smdCommissioners);

  await writeCsv(join(releaseRoot, "dc_wards.csv"), [
    "ward_id",
    "ward_number",
    "name",
  ], publicReleaseTables.wards);

  await writeCsv(join(releaseRoot, "dc_courts.csv"), [
    "court_id",
    "name",
    "court_type",
    "parent_id",
    "parent_name",
    "official_url",
    "source_url",
    "source_id",
  ], publicReleaseTables.courts);

  await writeCsv(join(releaseRoot, "dc_legal_authorities.csv"), [
    "authority_id",
    "authority_type",
    "locator",
    "canonical_url",
    "name",
    "used_by_count",
    "used_by_ids",
    "used_by_names",
  ], publicReleaseTables.legalAuthorities);

  await writeCsv(join(releaseRoot, "dc_relationships.csv"), [
    "from_id",
    "from_name",
    "from_type",
    "relationship",
    "to_id",
    "to_name",
    "to_type",
    "source_url",
    "source_id",
  ], publicReleaseTables.relationships);

  await writeCsv(join(releaseRoot, "dc_sources.csv"), [
    "source_id",
    "publisher",
    "source_url",
    "family",
    "access_method",
    "collection_status",
    "release_status",
    "record_count",
    "citation_count",
    "scope",
    "contributes",
    "known_limits",
    "notes",
  ], publicReleaseTables.sources);

  await writeCsv(
    join(releaseRoot, RELEASE_OUTPUT_PATHS.citationsCsv),
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

  await writeCsv(join(releaseRoot, RELEASE_OUTPUT_PATHS.sourcesCsv), [
    "source",
    "snapshot_records",
    "citation_count",
  ], sourceRows);

  await writeCsv(
    join(releaseRoot, RELEASE_OUTPUT_PATHS.sourceCoverageCsv),
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
    JSON.stringify(govGraphSummary, null, 2) + "\n",
  );

  const releaseOutputs = { ...RELEASE_OUTPUT_PATHS };

  const outputRowCounts: Partial<Record<ReleaseOutputName, number>> = {
    dcAgenciesCsv: publicReleaseTables.agencies.length,
    dcOfficesCsv: publicReleaseTables.offices.length,
    dcCouncilmembersCsv: publicReleaseTables.councilmembers.length,
    dcCouncilCommitteesCsv: publicReleaseTables.councilCommittees.length,
    councilCommitteeMembershipCsv: councilCommitteeMembershipRows.length,
    dcPublicBodiesCsv: publicReleaseTables.publicBodies.length,
    dcPublicBodyAffiliationsCsv: publicReleaseTables.publicBodyAffiliations.length,
    dcAncsCsv: publicReleaseTables.ancs.length,
    dcSmdsCsv: publicReleaseTables.smds.length,
    dcSmdCommissionersCsv: publicReleaseTables.smdCommissioners.length,
    dcWardsCsv: publicReleaseTables.wards.length,
    dcCourtsCsv: publicReleaseTables.courts.length,
    dcLegalAuthoritiesCsv: publicReleaseTables.legalAuthorities.length,
    dcRelationshipsCsv: publicReleaseTables.relationships.length,
    dcSourcesCsv: publicReleaseTables.sources.length,
    entriesCsv: entriesOut.length,
    relationsCsv: relationsOut.length,
    citationsCsv: citationsOut.length,
    sourcesCsv: sourceRows.length,
    sourceCoverageCsv: sourceCoverageRows.length,
    boardAffiliationsCsv: sortedBoardAffiliations.length,
    commissionAffiliationsCsv: sortedCommissionAffiliations.length,
    authorityAffiliationsCsv: sortedAuthorityAffiliations.length,
    ancSmdStructureCsv: ancSmdStructureRows.length,
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
      provenance,
      entryKindCounts,
      relationKindCounts,
      relationExamples,
      reviewPosture,
      govGraphSummary,
      outputRowCounts,
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
      CREATE TABLE ledger_entries (
        entry_id TEXT PRIMARY KEY,
        family TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        attributes TEXT NOT NULL,
        citations TEXT NOT NULL
      );

      CREATE TABLE ledger_relations (
        from_entry_id TEXT NOT NULL,
        relation_kind TEXT NOT NULL,
        to_entry_id TEXT NOT NULL,
        citations TEXT NOT NULL,
        PRIMARY KEY (from_entry_id, relation_kind, to_entry_id)
      );

      CREATE TABLE ledger_citations (
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

      CREATE TABLE source_counts (
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

      CREATE TABLE dc_board_affiliations (
        board_entry_id TEXT NOT NULL,
        board_name TEXT NOT NULL,
        board_short_name TEXT NOT NULL,
        agency_entry_id TEXT NOT NULL,
        agency_name TEXT NOT NULL,
        relation_citations TEXT NOT NULL,
        PRIMARY KEY (board_entry_id, agency_entry_id)
      );

      CREATE TABLE dc_commission_affiliations (
        commission_entry_id TEXT NOT NULL,
        commission_name TEXT NOT NULL,
        commission_short_name TEXT NOT NULL,
        agency_entry_id TEXT NOT NULL,
        agency_name TEXT NOT NULL,
        relation_citations TEXT NOT NULL,
        PRIMARY KEY (commission_entry_id, agency_entry_id)
      );

      CREATE TABLE dc_authority_affiliations (
        authority_entry_id TEXT NOT NULL,
        authority_name TEXT NOT NULL,
        authority_short_name TEXT NOT NULL,
        agency_entry_id TEXT NOT NULL,
        agency_name TEXT NOT NULL,
        relation_citations TEXT NOT NULL,
        PRIMARY KEY (authority_entry_id, agency_entry_id)
      );

      CREATE TABLE dc_council_committee_memberships (
        committee_entry_id TEXT NOT NULL,
        committee_name TEXT NOT NULL,
        committee_type TEXT NOT NULL,
        councilmember_entry_id TEXT NOT NULL,
        councilmember_name TEXT NOT NULL,
        membership_role TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_id TEXT NOT NULL,
        PRIMARY KEY (committee_entry_id, councilmember_entry_id)
      );

      CREATE TABLE dc_agencies (
        agency_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        short_name TEXT NOT NULL,
        official_url TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        parent_name TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_id TEXT NOT NULL
      );

      CREATE TABLE dc_offices (
        office_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        short_name TEXT NOT NULL,
        official_url TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        parent_name TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_id TEXT NOT NULL
      );

      CREATE TABLE dc_councilmembers (
        sort_order TEXT NOT NULL,
        councilmember_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        seat_type TEXT NOT NULL,
        office_title TEXT NOT NULL,
        ward TEXT NOT NULL,
        is_at_large TEXT NOT NULL,
        profile_url TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_id TEXT NOT NULL
      );

      CREATE TABLE dc_council_committees (
        committee_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        committee_type TEXT NOT NULL,
        chair_id TEXT NOT NULL,
        chair_name TEXT NOT NULL,
        member_count INTEGER NOT NULL,
        members TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_id TEXT NOT NULL
      );

      CREATE TABLE dc_public_bodies (
        public_body_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        body_type TEXT NOT NULL,
        short_name TEXT NOT NULL,
        official_url TEXT NOT NULL,
        enabling_authority TEXT NOT NULL,
        authority_url TEXT NOT NULL,
        open_dc_url TEXT NOT NULL,
        current_state_note TEXT NOT NULL,
        agency_ids TEXT NOT NULL,
        agency_names TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_id TEXT NOT NULL
      );

      CREATE TABLE dc_public_body_affiliations (
        public_body_id TEXT NOT NULL,
        public_body_name TEXT NOT NULL,
        body_type TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_name TEXT NOT NULL,
        target_type TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_id TEXT NOT NULL
      );

      CREATE TABLE dc_ancs (
        anc_id TEXT PRIMARY KEY,
        anc TEXT NOT NULL,
        official_url TEXT NOT NULL,
        oanc_profile_url TEXT NOT NULL,
        wards TEXT NOT NULL,
        neighborhoods TEXT NOT NULL,
        smd_count INTEGER NOT NULL,
        current_commissioners TEXT NOT NULL,
        current_state_note TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_id TEXT NOT NULL
      );

      CREATE TABLE dc_smds (
        smd_id TEXT PRIMARY KEY,
        smd TEXT NOT NULL,
        anc_id TEXT NOT NULL,
        anc TEXT NOT NULL,
        wards TEXT NOT NULL,
        commissioner_seat_id TEXT NOT NULL,
        current_commissioner_name TEXT NOT NULL,
        officer_role TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_id TEXT NOT NULL
      );

      CREATE TABLE dc_smd_commissioners (
        smd TEXT NOT NULL,
        anc TEXT NOT NULL,
        wards TEXT NOT NULL,
        current_commissioner_name TEXT NOT NULL,
        officer_role TEXT NOT NULL,
        smd_id TEXT PRIMARY KEY,
        anc_id TEXT NOT NULL,
        commissioner_seat_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_id TEXT NOT NULL
      );

      CREATE TABLE dc_wards (
        ward_id TEXT PRIMARY KEY,
        ward_number TEXT NOT NULL,
        name TEXT NOT NULL
      );

      CREATE TABLE dc_courts (
        court_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        court_type TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        parent_name TEXT NOT NULL,
        official_url TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_id TEXT NOT NULL
      );

      CREATE TABLE dc_legal_authorities (
        authority_id TEXT PRIMARY KEY,
        authority_type TEXT NOT NULL,
        locator TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        name TEXT NOT NULL,
        used_by_count INTEGER NOT NULL,
        used_by_ids TEXT NOT NULL,
        used_by_names TEXT NOT NULL
      );

      CREATE TABLE dc_relationships (
        from_id TEXT NOT NULL,
        from_name TEXT NOT NULL,
        from_type TEXT NOT NULL,
        relationship TEXT NOT NULL,
        to_id TEXT NOT NULL,
        to_name TEXT NOT NULL,
        to_type TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_id TEXT NOT NULL
      );

      CREATE TABLE dc_sources (
        source_id TEXT PRIMARY KEY,
        publisher TEXT NOT NULL,
        source_url TEXT NOT NULL,
        family TEXT NOT NULL,
        access_method TEXT NOT NULL,
        collection_status TEXT NOT NULL,
        release_status TEXT NOT NULL,
        record_count INTEGER NOT NULL,
        citation_count INTEGER NOT NULL,
        scope TEXT NOT NULL,
        contributes TEXT NOT NULL,
        known_limits TEXT NOT NULL,
        notes TEXT NOT NULL
      );

      CREATE TABLE release_table_catalog (
        table_name TEXT PRIMARY KEY,
        table_group TEXT NOT NULL,
        table_kind TEXT NOT NULL,
        release_path TEXT NOT NULL,
        is_release_asset INTEGER NOT NULL,
        row_count INTEGER,
        column_count INTEGER,
        columns_json TEXT,
        description TEXT NOT NULL
      );

      CREATE VIEW entries AS SELECT * FROM ledger_entries;
      CREATE VIEW relations AS SELECT * FROM ledger_relations;
      CREATE VIEW citations AS SELECT * FROM ledger_citations;
      CREATE VIEW sources AS SELECT * FROM source_counts;
    `);

    const insertEntry = ledgerDb.prepare(
      "INSERT INTO ledger_entries (entry_id, family, kind, name, attributes, citations) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const entry of entriesOut) {
      insertEntry.run(entry[0], entry[1], entry[2], entry[3], entry[4], entry[5]);
    }

    const insertRelation = ledgerDb.prepare(
      "INSERT INTO ledger_relations (from_entry_id, relation_kind, to_entry_id, citations) VALUES (?, ?, ?, ?)",
    );
    for (const relation of relationsOut) {
      insertRelation.run(relation[0], relation[1], relation[2], relation[3]);
    }

    const insertCitation = ledgerDb.prepare(
      "INSERT INTO ledger_citations (citation_type, entry_id, source, source_record_id, locator, url, uncited, reason, from_entry_id, relation_kind, to_entry_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      "INSERT INTO source_counts (source, snapshot_records, citation_count) VALUES (?, ?, ?)",
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

    insertRows(
      ledgerDb,
      "dc_board_affiliations",
      [
        "board_entry_id",
        "board_name",
        "board_short_name",
        "agency_entry_id",
        "agency_name",
        "relation_citations",
      ],
      sortedBoardAffiliations,
    );
    insertRows(
      ledgerDb,
      "dc_commission_affiliations",
      [
        "commission_entry_id",
        "commission_name",
        "commission_short_name",
        "agency_entry_id",
        "agency_name",
        "relation_citations",
      ],
      sortedCommissionAffiliations,
    );
    insertRows(
      ledgerDb,
      "dc_authority_affiliations",
      [
        "authority_entry_id",
        "authority_name",
        "authority_short_name",
        "agency_entry_id",
        "agency_name",
        "relation_citations",
      ],
      sortedAuthorityAffiliations,
    );

    const insertCouncilCommitteeMembership = ledgerDb.prepare(
      "INSERT INTO dc_council_committee_memberships (committee_entry_id, committee_name, committee_type, councilmember_entry_id, councilmember_name, membership_role, source_url, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const row of councilCommitteeMembershipRows) {
      insertCouncilCommitteeMembership.run(
        row.committeeEntryId,
        row.committeeName,
        row.committeeType,
        row.councilmemberEntryId,
        row.councilmemberName,
        row.membershipRole,
        relationSourceUrl(row.relationCitations, sourceCoverageRows),
        sourceCitationId(firstCitationRef(row.relationCitations)),
      );
    }

    insertRows(
      ledgerDb,
      "dc_agencies",
      [
        "agency_id",
        "name",
        "short_name",
        "official_url",
        "parent_id",
        "parent_name",
        "source_url",
        "source_id",
      ],
      publicReleaseTables.agencies,
    );
    insertRows(
      ledgerDb,
      "dc_offices",
      [
        "office_id",
        "name",
        "short_name",
        "official_url",
        "parent_id",
        "parent_name",
        "source_url",
        "source_id",
      ],
      publicReleaseTables.offices,
    );
    insertRows(
      ledgerDb,
      "dc_councilmembers",
      [
        "sort_order",
        "councilmember_id",
        "name",
        "seat_type",
        "office_title",
        "ward",
        "is_at_large",
        "profile_url",
        "source_url",
        "source_id",
      ],
      publicReleaseTables.councilmembers,
    );
    insertRows(
      ledgerDb,
      "dc_council_committees",
      [
        "committee_id",
        "name",
        "committee_type",
        "chair_id",
        "chair_name",
        "member_count",
        "members",
        "source_url",
        "source_id",
      ],
      publicReleaseTables.councilCommittees,
    );
    insertRows(
      ledgerDb,
      "dc_public_bodies",
      [
        "public_body_id",
        "name",
        "body_type",
        "short_name",
        "official_url",
        "enabling_authority",
        "authority_url",
        "open_dc_url",
        "current_state_note",
        "agency_ids",
        "agency_names",
        "source_url",
        "source_id",
      ],
      publicReleaseTables.publicBodies,
    );
    insertRows(
      ledgerDb,
      "dc_public_body_affiliations",
      [
        "public_body_id",
        "public_body_name",
        "body_type",
        "relation_type",
        "target_id",
        "target_name",
        "target_type",
        "source_url",
        "source_id",
      ],
      publicReleaseTables.publicBodyAffiliations,
    );
    insertRows(
      ledgerDb,
      "dc_ancs",
      [
        "anc_id",
        "anc",
        "official_url",
        "oanc_profile_url",
        "wards",
        "neighborhoods",
        "smd_count",
        "current_commissioners",
        "current_state_note",
        "source_url",
        "source_id",
      ],
      publicReleaseTables.ancs,
    );
    insertRows(
      ledgerDb,
      "dc_smds",
      [
        "smd_id",
        "smd",
        "anc_id",
        "anc",
        "wards",
        "commissioner_seat_id",
        "current_commissioner_name",
        "officer_role",
        "source_url",
        "source_id",
      ],
      publicReleaseTables.smds,
    );
    insertRows(
      ledgerDb,
      "dc_smd_commissioners",
      [
        "smd",
        "anc",
        "wards",
        "current_commissioner_name",
        "officer_role",
        "smd_id",
        "anc_id",
        "commissioner_seat_id",
        "source_url",
        "source_id",
      ],
      publicReleaseTables.smdCommissioners,
    );
    insertRows(
      ledgerDb,
      "dc_wards",
      ["ward_id", "ward_number", "name"],
      publicReleaseTables.wards,
    );
    insertRows(
      ledgerDb,
      "dc_courts",
      [
        "court_id",
        "name",
        "court_type",
        "parent_id",
        "parent_name",
        "official_url",
        "source_url",
        "source_id",
      ],
      publicReleaseTables.courts,
    );
    insertRows(
      ledgerDb,
      "dc_legal_authorities",
      [
        "authority_id",
        "authority_type",
        "locator",
        "canonical_url",
        "name",
        "used_by_count",
        "used_by_ids",
        "used_by_names",
      ],
      publicReleaseTables.legalAuthorities,
    );
    insertRows(
      ledgerDb,
      "dc_relationships",
      [
        "from_id",
        "from_name",
        "from_type",
        "relationship",
        "to_id",
        "to_name",
        "to_type",
        "source_url",
        "source_id",
      ],
      publicReleaseTables.relationships,
    );
    insertRows(
      ledgerDb,
      "dc_sources",
      [
        "source_id",
        "publisher",
        "source_url",
        "family",
        "access_method",
        "collection_status",
        "release_status",
        "record_count",
        "citation_count",
        "scope",
        "contributes",
        "known_limits",
        "notes",
      ],
      publicReleaseTables.sources,
    );
    insertRows(
      ledgerDb,
      "release_table_catalog",
      [
        "table_name",
        "table_group",
        "table_kind",
        "release_path",
        "is_release_asset",
        "row_count",
        "column_count",
        "columns_json",
        "description",
      ],
      buildSqliteTableCatalogRows(outputRowCounts),
    );
  } finally {
    ledgerDb.close();
  }

  const releaseOutputsWithoutSha256Sums = Object.fromEntries(
    Object.entries(releaseOutputs).filter(([outputName]) => outputName !== "sha256Sums"),
  );
  const preSha256SumsMetadata = await buildOutputFileMetadata(
    releaseRoot,
    releaseOutputsWithoutSha256Sums,
    outputRowCounts,
  );
  const preSha256SumsCatalog = buildReleaseOutputCatalog(
    releaseOutputsWithoutSha256Sums,
    preSha256SumsMetadata,
  );
  await Deno.writeTextFile(
    join(releaseRoot, RELEASE_OUTPUT_PATHS.sha256Sums),
    buildReleaseSha256Sums(preSha256SumsCatalog),
  );

  const outputFileMetadata = await buildOutputFileMetadata(
    releaseRoot,
    releaseOutputs,
    outputRowCounts,
  );
  const outputCatalog = buildReleaseOutputCatalog(releaseOutputs, outputFileMetadata);
  const releaseAssetIndex = buildReleaseAssetIndex(outputCatalog);
  const localOnlyOutputIndex = buildLocalOnlyOutputIndex(outputCatalog);
  const startHere = buildReleaseStartHere(outputCatalog, releaseAssetIndex, localOnlyOutputIndex);
  const manifestPath = join(releaseRoot, "manifest.json");
  const manifest = {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    jurisdiction,
    exportedAt,
    startHere,
    sourceCoverageStatusCounts,
    sourceCoverageReleaseStatusCounts,
    sourceCoverageFamilyRollup,
    provenance,
    reviewQueueCounts: reviewPosture.queues,
    reviewCategoryCounts: reviewPosture.categories,
    reviewDeferredGroups: reviewPosture.deferredGroups,
    outputs: releaseOutputs,
    outputCatalog,
    releaseAssets: releaseAssetIndex,
    manifestFile: {
      path: "manifest.json",
      releaseAsset: true,
      checksumListedInSha256Sums: false,
      note:
        "manifest.json is uploaded as a release asset but is not listed in SHA256SUMS because it records file hashes and is written after the other file metadata is calculated.",
    },
    localOnlyOutputs: localOnlyOutputIndex,
    sqliteTables: buildSqliteTableIndex(),
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
      collectedSourceCount: sourceRows.length,
      sourceCoverage: sourceCoverageRows.length,
      sourceInventoryCount: sourceCoverageRows.length,
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
      dcAgencies: publicReleaseTables.agencies.length,
      dcOffices: publicReleaseTables.offices.length,
      dcCouncilmembers: publicReleaseTables.councilmembers.length,
      dcCouncilCommittees: publicReleaseTables.councilCommittees.length,
      dcPublicBodies: publicReleaseTables.publicBodies.length,
      dcPublicBodyAffiliations: publicReleaseTables.publicBodyAffiliations.length,
      dcAncs: publicReleaseTables.ancs.length,
      dcSmds: publicReleaseTables.smds.length,
      dcSmdCommissioners: publicReleaseTables.smdCommissioners.length,
      dcWards: publicReleaseTables.wards.length,
      dcCourts: publicReleaseTables.courts.length,
      dcLegalAuthorities: publicReleaseTables.legalAuthorities.length,
      dcRelationships: publicReleaseTables.relationships.length,
      dcSources: publicReleaseTables.sources.length,
      publicSourceRows: publicReleaseTables.sources.length,
      govGraphNodes: govGraph.nodes.length,
      govGraphEdges: govGraph.edges.length,
    },
    govGraph: govGraphSummary,
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
    dcAgencyCount: publicReleaseTables.agencies.length,
    dcOfficeCount: publicReleaseTables.offices.length,
    dcCouncilmemberCount: publicReleaseTables.councilmembers.length,
    dcCouncilCommitteeCount: publicReleaseTables.councilCommittees.length,
    dcPublicBodyCount: publicReleaseTables.publicBodies.length,
    dcPublicBodyAffiliationCount: publicReleaseTables.publicBodyAffiliations.length,
    dcAncCount: publicReleaseTables.ancs.length,
    dcSmdCount: publicReleaseTables.smds.length,
    dcSmdCommissionerCount: publicReleaseTables.smdCommissioners.length,
    dcWardCount: publicReleaseTables.wards.length,
    dcCourtCount: publicReleaseTables.courts.length,
    dcLegalAuthorityCount: publicReleaseTables.legalAuthorities.length,
    dcRelationshipCount: publicReleaseTables.relationships.length,
    dcSourceCount: publicReleaseTables.sources.length,
    govGraphNodeCount: govGraph.nodes.length,
    govGraphEdgeCount: govGraph.edges.length,
    govGraphExcludedNodeCount: govGraph.summary.excludedNodeCount,
    govGraphExcludedEdgeCount: govGraph.summary.excludedEdgeCount,
    govGraphBlockedReviewItemCount: govGraph.summary.blockedReviewItemCount,
    ledgerSqlitePath: ledgerPath,
  };
}

async function removeObsoleteReleaseOutputs(releaseRoot: string): Promise<void> {
  for (
    const fileName of [
      "entries.csv",
      "relations.csv",
      "citations.csv",
      "sources.csv",
      "dc_council_committee_membership.csv",
      "ledger_entries.csv",
      "ledger_relations.csv",
      "ledger_citations.csv",
      "source_counts.csv",
      "source_coverage.csv",
      "dc_smd_commissioners.csv",
      "dc_board_affiliations.csv",
      "dc_commission_affiliations.csv",
      "dc_authority_affiliations.csv",
      "dc_anc_smd_structure.csv",
    ]
  ) {
    try {
      await Deno.remove(join(releaseRoot, fileName));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }
}

async function createReleaseStagingRoot(releaseRoot: string): Promise<string> {
  const parent = dirname(releaseRoot);
  await ensureDir(parent);
  const rootName = basename(releaseRoot) || "release";
  const stagingRoot = join(parent, `.${rootName}.export-${crypto.randomUUID()}.tmp`);
  await ensureDir(stagingRoot);
  return stagingRoot;
}

async function replaceReleaseRoot(stagingRoot: string, releaseRoot: string): Promise<void> {
  await removeIfExists(releaseRoot);
  await Deno.rename(stagingRoot, releaseRoot);
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

function buildPublicReleaseTables(input: {
  entryIndex: Map<string, ExportEntryIndexValue>;
  sourceCoverageRows: string[][];
  ancSmdStructureRows: DcAncSmdStructureRow[];
}): PublicReleaseTables {
  const entries = [...input.entryIndex.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );

  const agencies: string[][] = [];
  const offices: string[][] = [];
  const councilmembers: string[][] = [];
  const councilCommittees: string[][] = [];
  const publicBodies: string[][] = [];
  const publicBodyAffiliations: string[][] = [];
  const ancs: string[][] = [];
  const wards: string[][] = [];
  const courts: string[][] = [];
  const legalAuthorities: string[][] = [];
  const relationships: string[][] = [];
  const ancSummaries = buildAncSummaries(input.ancSmdStructureRows);
  const committeeMembers = buildCommitteeMembers(input.entryIndex);
  const legalAuthorityUsage = buildLegalAuthorityUsage(input.entryIndex);
  const sourceUrls = new Map(
    input.sourceCoverageRows.map((row) => [
      row[SOURCE_COVERAGE_COLUMN.source],
      row[SOURCE_COVERAGE_COLUMN.sourceUrl],
    ]),
  );

  for (const [id, entry] of entries) {
    const primaryCitation = sourceRefForEntry(entry);
    const sourceUrl = primaryCitation.url || sourceUrls.get(primaryCitation.source) ||
      firstStringAttribute(entry, [
        "sourceProfileUrl",
        "sourceUrl",
        "sourcePageUrl",
        "sourceOpenDcUrl",
        "sourceOancProfileUrl",
        "webUrl",
        "officialUrl",
        "canonicalUrl",
      ]);
    const sourceId = sourceCitationId(primaryCitation);

    for (const [relationKind, relations] of Object.entries(entry.relations)) {
      for (const relation of relations) {
        const target = input.entryIndex.get(relation.to);
        const relationCitation = firstCitationRef(relation.citations ?? []);
        relationships.push([
          id,
          entry.name,
          entry.kind,
          publicRelationLabel(relationKind, entry.kind, target?.kind),
          relation.to,
          target?.name ?? "",
          target?.kind ?? "",
          relationCitation.url || sourceUrls.get(relationCitation.source) || "",
          sourceCitationId(relationCitation),
        ]);
      }
    }

    if (entry.kind === "dc.agency") {
      const parent = firstRelatedEntry(
        entry,
        ["dc.relation:reports_to", "dc.relation:part_of"],
        input.entryIndex,
      );
      agencies.push([
        id,
        entry.name,
        entry.shortName,
        stringAttribute(entry, "officialUrl"),
        parent?.id ?? "",
        parent?.name ?? "",
        sourceUrl,
        sourceId,
      ]);
      continue;
    }

    if (entry.kind === "dc.office") {
      const parent = firstRelatedEntry(
        entry,
        ["dc.relation:reports_to", "dc.relation:part_of"],
        input.entryIndex,
      );
      offices.push([
        id,
        entry.name,
        entry.shortName,
        stringAttribute(entry, "officialUrl"),
        parent?.id ?? "",
        parent?.name ?? "",
        sourceUrl,
        sourceId,
      ]);
      continue;
    }

    if (entry.kind === "dc.councilmember") {
      const officeTitle = stringAttribute(entry, "officeLabel");
      const ward = stringAttribute(entry, "wardNumber");
      const seatType = councilmemberSeatType(entry, officeTitle, ward);
      councilmembers.push([
        councilmemberSortOrder(entry, seatType, ward),
        id,
        entry.name,
        seatType,
        officeTitle,
        ward,
        seatType === "at_large" || seatType === "chairman" ? "true" : "false",
        stringAttribute(entry, "sourceProfileUrl"),
        sourceUrl,
        sourceId,
      ]);
      continue;
    }

    if (entry.kind === "dc.committee") {
      const chair = committeeChair(id, input.entryIndex);
      const members = committeeMembers.get(id) ?? [];
      councilCommittees.push([
        id,
        entry.name,
        stringAttribute(entry, "committeeType"),
        chair?.id ?? "",
        chair?.name ?? "",
        String(members.length),
        members.map((member) => member.name).join("; "),
        sourceUrl || stringAttribute(entry, "sourceUrl"),
        sourceId,
      ]);
      continue;
    }

    if (isPublicBodyKind(entry.kind)) {
      const publicBodyAgencies = publicBodyAgencyLinks(entry, input.entryIndex);
      const legalAuthority = primaryLegalAuthority(entry, input.entryIndex);
      publicBodies.push([
        id,
        entry.name,
        publicBodyType(entry.kind),
        entry.shortName,
        stringAttribute(entry, "officialUrl"),
        legalAuthority?.locator || stringAttribute(entry, "enablingStatute"),
        legalAuthority?.canonicalUrl || stringAttribute(entry, "enablingStatuteUrl"),
        stringAttribute(entry, "sourceOpenDcUrl"),
        stringAttribute(entry, "currentStateNote"),
        publicBodyAgencies.map((agency) => agency.id).join("; "),
        publicBodyAgencies.map((agency) => agency.name).join("; "),
        sourceUrl,
        sourceId,
      ]);

      for (const relationKind of ["dc.relation:governs", "dc.relation:affiliated_with"]) {
        for (const relation of entry.relations[relationKind] ?? []) {
          const target = input.entryIndex.get(relation.to);
          const relationCitation = firstCitationRef(relation.citations ?? []);
          publicBodyAffiliations.push([
            id,
            entry.name,
            publicBodyType(entry.kind),
            publicRelationLabel(relationKind, entry.kind, target?.kind),
            relation.to,
            target?.name ?? "",
            target?.kind ?? "",
            relationCitation.url || sourceUrls.get(relationCitation.source) || "",
            sourceCitationId(relationCitation),
          ]);
        }
      }
      continue;
    }

    if (entry.kind === "dc.anc") {
      const ancSummary = ancSummaries.get(id);
      ancs.push([
        id,
        entry.name,
        firstStringAttribute(entry, ["officialUrl", "webUrl"]),
        stringAttribute(entry, "sourceOancProfileUrl"),
        joinedAttribute(entry, "sourceWardNumbers"),
        joinedAttribute(entry, "representedNeighborhoods"),
        String(ancSummary?.smdCount ?? 0),
        ancSummary?.commissioners.join("; ") ?? "",
        stringAttribute(entry, "currentStateNote") || stringAttribute(entry, "description"),
        sourceUrl,
        sourceId,
      ]);
      continue;
    }

    if (entry.kind === "dc.ward") {
      wards.push([id, stringAttribute(entry, "wardNumber"), entry.name]);
      continue;
    }

    if (
      entry.kind === "dc.court_system" ||
      entry.kind === "dc.court" ||
      entry.kind === "dc.court_division"
    ) {
      const parent = firstRelatedEntry(entry, ["dc.relation:part_of"], input.entryIndex);
      courts.push([
        id,
        entry.name,
        entry.kind.replace("dc.", ""),
        parent?.id ?? "",
        parent?.name ?? "",
        stringAttribute(entry, "officialUrl"),
        sourceUrl,
        sourceId,
      ]);
      continue;
    }

    if (entry.kind === "dc.legal_authority") {
      const usage = legalAuthorityUsage.get(id) ?? [];
      legalAuthorities.push([
        id,
        stringAttribute(entry, "authorityType"),
        stringAttribute(entry, "locator"),
        stringAttribute(entry, "canonicalUrl"),
        entry.name,
        String(usage.length),
        usage.map((usedBy) => usedBy.id).join("; "),
        usage.map((usedBy) => usedBy.name).join("; "),
      ]);
    }
  }

  const smds = input.ancSmdStructureRows.map((row) => {
    const citation = firstCitationRef(row.relationCitations);
    const ancEntry = input.entryIndex.get(row.ancEntryId);
    return [
      row.smdEntryId,
      publicSmdCode(row.smdName),
      row.ancEntryId,
      publicAncCode(row.ancName),
      ancEntry ? joinedAttribute(ancEntry, "sourceWardNumbers") : "",
      row.commissionerSeatEntryId,
      row.currentCommissionerName,
      row.officerRole,
      citation.url || sourceUrls.get(citation.source) || "",
      sourceCitationId(citation),
    ];
  });

  const smdCommissioners = input.ancSmdStructureRows.map((row) => {
    const citation = firstCitationRef(row.relationCitations);
    const ancEntry = input.entryIndex.get(row.ancEntryId);
    return [
      publicSmdCode(row.smdName),
      publicAncCode(row.ancName),
      ancEntry ? joinedAttribute(ancEntry, "sourceWardNumbers") : "",
      row.currentCommissionerName,
      row.officerRole,
      row.smdEntryId,
      row.ancEntryId,
      row.commissionerSeatEntryId,
      citation.url || sourceUrls.get(citation.source) || "",
      sourceCitationId(citation),
    ];
  });

  const sources = input.sourceCoverageRows.map((row) => [
    row[SOURCE_COVERAGE_COLUMN.source],
    row[SOURCE_COVERAGE_COLUMN.publisher],
    row[SOURCE_COVERAGE_COLUMN.sourceUrl],
    row[SOURCE_COVERAGE_COLUMN.family],
    row[SOURCE_COVERAGE_COLUMN.accessMethod],
    row[SOURCE_COVERAGE_COLUMN.collectionStatus],
    row[SOURCE_COVERAGE_COLUMN.releaseStatus],
    row[SOURCE_COVERAGE_COLUMN.recordCount],
    row[SOURCE_COVERAGE_COLUMN.citationCount],
    row[SOURCE_COVERAGE_COLUMN.scope],
    row[SOURCE_COVERAGE_COLUMN.contributes],
    row[SOURCE_COVERAGE_COLUMN.excludes],
    row[SOURCE_COVERAGE_COLUMN.notes],
  ]);

  const byFirstColumn = (left: string[], right: string[]) => left[0].localeCompare(right[0]);
  for (
    const table of [
      agencies,
      offices,
      councilmembers,
      councilCommittees,
      publicBodies,
      publicBodyAffiliations,
      ancs,
      smds,
      smdCommissioners,
      wards,
      courts,
      legalAuthorities,
      relationships,
      sources,
    ]
  ) {
    table.sort(byFirstColumn);
  }

  return {
    agencies,
    offices,
    councilmembers,
    councilCommittees,
    publicBodies,
    publicBodyAffiliations,
    ancs,
    smds,
    smdCommissioners,
    wards,
    courts,
    legalAuthorities,
    relationships,
    sources,
  };
}

function buildAncSummaries(
  rows: DcAncSmdStructureRow[],
): Map<string, { smdCount: number; commissioners: string[] }> {
  const summaries = new Map<string, { smdIds: Set<string>; commissioners: Set<string> }>();
  for (const row of rows) {
    const summary = summaries.get(row.ancEntryId) ?? {
      smdIds: new Set<string>(),
      commissioners: new Set<string>(),
    };
    summary.smdIds.add(row.smdEntryId);
    if (row.currentCommissionerName) {
      summary.commissioners.add(row.currentCommissionerName);
    }
    summaries.set(row.ancEntryId, summary);
  }

  return new Map(
    [...summaries.entries()].map(([ancId, summary]) => [
      ancId,
      {
        smdCount: summary.smdIds.size,
        commissioners: [...summary.commissioners].sort((left, right) => left.localeCompare(right)),
      },
    ]),
  );
}

function buildCommitteeMembers(
  entryIndex: Map<string, ExportEntryIndexValue>,
): Map<string, Array<{ id: string; name: string; sortOrder: string }>> {
  const membersByCommittee = new Map<
    string,
    Array<{ id: string; name: string; sortOrder: string }>
  >();
  for (const [id, entry] of entryIndex.entries()) {
    if (entry.kind !== "dc.councilmember") {
      continue;
    }
    const officeTitle = stringAttribute(entry, "officeLabel");
    const ward = stringAttribute(entry, "wardNumber");
    const seatType = councilmemberSeatType(entry, officeTitle, ward);
    for (const relation of entry.relations["dc.relation:member_of"] ?? []) {
      const members = membersByCommittee.get(relation.to) ?? [];
      members.push({
        id,
        name: entry.name,
        sortOrder: councilmemberSortOrder(entry, seatType, ward),
      });
      membersByCommittee.set(relation.to, members);
    }
  }
  for (const members of membersByCommittee.values()) {
    members.sort((left, right) =>
      left.sortOrder.localeCompare(right.sortOrder) || left.name.localeCompare(right.name)
    );
  }
  return membersByCommittee;
}

function buildLegalAuthorityUsage(
  entryIndex: Map<string, ExportEntryIndexValue>,
): Map<string, Array<{ id: string; name: string }>> {
  const usageByAuthority = new Map<string, Array<{ id: string; name: string }>>();
  for (const [id, entry] of entryIndex.entries()) {
    for (const relation of entry.relations["dc.relation:authorized_by"] ?? []) {
      const usedBy = usageByAuthority.get(relation.to) ?? [];
      usedBy.push({ id, name: entry.name });
      usageByAuthority.set(relation.to, usedBy);
    }
  }
  for (const usage of usageByAuthority.values()) {
    usage.sort((left, right) => left.name.localeCompare(right.name));
  }
  return usageByAuthority;
}

function primaryLegalAuthority(
  entry: ExportEntryIndexValue,
  entryIndex: Map<string, ExportEntryIndexValue>,
): { locator: string; canonicalUrl: string } | null {
  for (const relation of entry.relations["dc.relation:authorized_by"] ?? []) {
    const authority = entryIndex.get(relation.to);
    if (authority?.kind !== "dc.legal_authority") {
      continue;
    }
    return {
      locator: stringAttribute(authority, "locator"),
      canonicalUrl: stringAttribute(authority, "canonicalUrl"),
    };
  }
  return null;
}

function publicBodyAgencyLinks(
  entry: ExportEntryIndexValue,
  entryIndex: Map<string, ExportEntryIndexValue>,
): Array<{ id: string; name: string }> {
  const agencies = new Map<string, string>();
  for (const relationKind of ["dc.relation:governs", "dc.relation:affiliated_with"]) {
    for (const relation of entry.relations[relationKind] ?? []) {
      const target = entryIndex.get(relation.to);
      agencies.set(relation.to, target?.name ?? "");
    }
  }
  return [...agencies.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function publicRelationLabel(
  relationKind: string,
  fromKind: string,
  toKind: string | undefined,
): string {
  if (toKind) {
    const publicVerb = dcPublicRelationVerb({ relationKind, fromKind, toKind });
    if (publicVerb) return publicVerb;
  }
  return relationKind.replace("dc.relation:", "");
}

function councilmemberSeatType(
  entry: ExportEntryIndexValue,
  officeTitle: string,
  ward: string,
): string {
  const officeTitleLower = officeTitle.toLowerCase();
  if (officeTitleLower.includes("chairman") || entry.name === "Phil Mendelson") {
    return "chairman";
  }
  if (officeTitleLower.includes("at-large")) {
    return "at_large";
  }
  if (ward) {
    return "ward";
  }
  return "unknown";
}

function councilmemberSortOrder(
  entry: ExportEntryIndexValue,
  seatType: string,
  ward: string,
): string {
  if (seatType === "chairman") {
    return "00";
  }
  if (seatType === "ward") {
    return `2${ward.padStart(2, "0")}`;
  }
  if (seatType === "at_large") {
    const atLargeOrder: Record<string, string> = {
      "Anita Bonds": "10",
      "Robert C. White, Jr.": "11",
      "Christina Henderson": "12",
      "Doni Crawford": "13",
    };
    return atLargeOrder[entry.name] ?? `1${entry.name}`;
  }
  return `99${entry.name}`;
}

function insertRows(
  db: Database,
  table: string,
  columns: string[],
  rows: Array<Array<string | number | null>>,
): void {
  const columnSql = columns.join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const statement = db.prepare(`INSERT INTO ${table} (${columnSql}) VALUES (${placeholders})`);
  for (const row of rows) {
    statement.run(...row);
  }
}

function isPublicBodyKind(kind: string): boolean {
  return kind === "dc.board" || kind === "dc.commission" || kind === "dc.council" ||
    kind === "dc.authority";
}

function publicBodyType(kind: string): string {
  return kind.replace("dc.", "");
}

function publicSmdCode(name: string): string {
  return name.replace(/^SMD\s+/i, "").trim();
}

function publicAncCode(name: string): string {
  return name.replace(/^ANC\s+/i, "").trim();
}

function committeeChair(
  committeeId: string,
  entryIndex: Map<string, ExportEntryIndexValue>,
): { id: string; name: string } | null {
  for (const [id, entry] of entryIndex.entries()) {
    for (const relation of entry.relations["dc.relation:chairs"] ?? []) {
      if (relation.to === committeeId) {
        return { id, name: entry.name };
      }
    }
  }
  return null;
}

function firstRelatedEntry(
  entry: ExportEntryIndexValue,
  relationKinds: string[],
  entryIndex: Map<string, ExportEntryIndexValue>,
): { id: string; name: string } | null {
  for (const relationKind of relationKinds) {
    const relation = entry.relations[relationKind]?.[0];
    if (!relation) {
      continue;
    }
    const related = entryIndex.get(relation.to);
    return { id: relation.to, name: related?.name ?? "" };
  }
  return null;
}

function stringAttribute(entry: ExportEntryIndexValue, key: string): string {
  const value = entry.attributes[key];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function firstStringAttribute(entry: ExportEntryIndexValue, keys: string[]): string {
  for (const key of keys) {
    const value = stringAttribute(entry, key);
    if (value) {
      return value;
    }
  }
  return "";
}

function joinedAttribute(entry: ExportEntryIndexValue, key: string): string {
  const value = entry.attributes[key];
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join("; ");
  }
  return stringAttribute(entry, key);
}

function firstCitationRef(citations: CitationValue[]): {
  source: string;
  sourceRecordId: string;
  url: string;
} {
  for (const citation of citations) {
    if ("source" in citation || "url" in citation) {
      const record = citation as Record<string, unknown>;
      return {
        source: typeof record.source === "string" ? record.source : "",
        sourceRecordId: typeof record.sourceRecordId === "string" ? record.sourceRecordId : "",
        url: typeof record.url === "string" ? record.url : "",
      };
    }
  }
  return { source: "", sourceRecordId: "", url: "" };
}

function sourceRefForEntry(entry: ExportEntryIndexValue): {
  source: string;
  sourceRecordId: string;
  url: string;
} {
  for (const preferredSource of preferredSourcesForKind(entry.kind)) {
    const citation = citationRefForSource(entry.citations, preferredSource);
    if (citation.source) {
      return citation;
    }
  }
  return firstCitationRef(entry.citations);
}

function preferredSourcesForKind(kind: string): string[] {
  switch (kind) {
    case "dc.agency":
      return ["dc.agency_directory", "dcgis.agencies"];
    case "dc.councilmember":
      return ["dccouncil.members", "dccouncil.committees"];
    case "dc.committee":
      return ["dccouncil.committees"];
    case "dc.anc":
      return ["dcgis.ancs", "oanc.profiles"];
    case "dc.smd":
    case "dc.anc_commissioner_seat":
      return ["dcgis.smds"];
    case "dc.board":
      return ["open_dc.public_bodies", "dcgis.boards"];
    case "dc.commission":
      return ["open_dc.public_bodies", "dcgis.commissions"];
    case "dc.council":
      return ["open_dc.public_bodies", "dcgis.councils"];
    case "dc.authority":
      return ["open_dc.public_bodies", "dcgis.authorities"];
    default:
      return [];
  }
}

function citationRefForSource(citations: CitationValue[], source: string): {
  source: string;
  sourceRecordId: string;
  url: string;
} {
  for (const citation of citations) {
    const ref = firstCitationRef([citation]);
    if (ref.source === source) {
      return ref;
    }
  }
  return { source: "", sourceRecordId: "", url: "" };
}

function sourceCitationId(citation: { source: string; sourceRecordId: string }): string {
  if (!citation.source) {
    return "";
  }
  if (!citation.sourceRecordId) {
    return citation.source;
  }
  return `${citation.source}:${citation.sourceRecordId}`;
}

function relationSourceUrl(citations: CitationValue[], sourceCoverageRows: string[][]): string {
  const citation = firstCitationRef(citations);
  if (citation.url) {
    return citation.url;
  }
  if (!citation.source) {
    return "";
  }
  const sourceRow = sourceCoverageRows.find((row) =>
    row[SOURCE_COVERAGE_COLUMN.source] === citation.source
  );
  return sourceRow?.[SOURCE_COVERAGE_COLUMN.sourceUrl] ?? "";
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
  const outputCatalog = parseReleaseOutputCatalog(manifest.outputCatalog, errors);
  const outputFileMetadata = parseOutputFileMetadata(manifest.outputFileMetadata, errors);

  if (!outputs || !outputCatalog || !outputFileMetadata) {
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
  validateReleaseOutputCatalog(outputs, outputCatalog, outputFileMetadata, errors);
  validateReleaseAssetIndexes(manifest, outputCatalog, errors);
  await validateSha256SumsContract(releaseRoot, outputCatalog, errors);

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
    validateOutputFileMetadataAgainstPayload(outputName, outputPath, metadata, bytes, errors);
  }

  return {
    releaseRoot,
    manifestPath,
    valid: errors.length === 0,
    checkedFileCount,
    errors,
  };
}

function validateOutputFileMetadataAgainstPayload(
  outputName: string,
  outputPath: string,
  metadata: OutputFileMetadata,
  bytes: Uint8Array,
  errors: string[],
): void {
  const expectedHeaders = RELEASE_CSV_HEADER_CONTRACTS[outputName as ReleaseOutputName];
  if (!expectedHeaders) {
    if (typeof metadata.rowCount === "number") {
      errors.push(`outputFileMetadata ${outputName}.rowCount is only valid for CSV outputs`);
    }
    if (typeof metadata.columnCount === "number") {
      errors.push(`outputFileMetadata ${outputName}.columnCount is only valid for CSV outputs`);
    }
    if (metadata.columns) {
      errors.push(`outputFileMetadata ${outputName}.columns is only valid for CSV outputs`);
    }
    return;
  }

  if (typeof metadata.rowCount !== "number") {
    errors.push(`outputFileMetadata ${outputName}.rowCount is required for CSV outputs`);
  }
  if (metadata.columnCount !== expectedHeaders.length) {
    errors.push(
      `outputFileMetadata ${outputName}.columnCount must be ${expectedHeaders.length}`,
    );
  }
  if (!metadata.columns) {
    errors.push(`outputFileMetadata ${outputName}.columns is required for CSV outputs`);
  } else if (!arraysEqual(metadata.columns, [...expectedHeaders])) {
    errors.push(`outputFileMetadata ${outputName}.columns must match the release CSV contract`);
  }

  const rows = parseReleaseCsvRows(new TextDecoder().decode(bytes), outputPath, errors);
  if (!rows || rows.length === 0) {
    return;
  }
  if (typeof metadata.rowCount === "number" && rows.length - 1 !== metadata.rowCount) {
    errors.push(
      `outputFileMetadata ${outputName}.rowCount mismatch: expected ${metadata.rowCount}, found ${
        rows.length - 1
      }`,
    );
  }
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
  validateReleaseProvenance(manifest.provenance, errors);
  validateManifestFileSummary(manifest.manifestFile, errors);

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
  const manifestReviewQueueCounts = readCountRecordField(
    manifest,
    "reviewQueueCounts",
    "manifest",
    errors,
  );
  if (manifestGovGraph && manifestReviewQueueCounts) {
    const govGraphReviewQueueCounts = readCountRecordField(
      manifestGovGraph,
      "reviewQueueCounts",
      "manifest.govGraph",
      errors,
    );
    if (govGraphReviewQueueCounts) {
      validateCountRecordAgreement(
        govGraphReviewQueueCounts,
        manifestReviewQueueCounts,
        "manifest.govGraph.reviewQueueCounts",
        "manifest.reviewQueueCounts",
        errors,
      );
    }
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

function validateManifestFileSummary(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("manifest.manifestFile must be an object");
    return;
  }
  if (value.path !== "manifest.json") {
    errors.push(`manifest.manifestFile.path must be manifest.json, found ${String(value.path)}`);
  }
  if (value.releaseAsset !== true) {
    errors.push("manifest.manifestFile.releaseAsset must be true");
  }
  if (value.checksumListedInSha256Sums !== false) {
    errors.push("manifest.manifestFile.checksumListedInSha256Sums must be false");
  }
  if (typeof value.note !== "string" || value.note.length === 0) {
    errors.push("manifest.manifestFile.note must be a non-empty string");
  }
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
      ["dcAgenciesCsv", "counts.dcAgencies", "dcAgencies"] as const,
      ["dcOfficesCsv", "counts.dcOffices", "dcOffices"] as const,
      ["dcCouncilmembersCsv", "counts.dcCouncilmembers", "dcCouncilmembers"] as const,
      ["dcCouncilCommitteesCsv", "counts.dcCouncilCommittees", "dcCouncilCommittees"] as const,
      ["dcPublicBodiesCsv", "counts.dcPublicBodies", "dcPublicBodies"] as const,
      [
        "dcPublicBodyAffiliationsCsv",
        "counts.dcPublicBodyAffiliations",
        "dcPublicBodyAffiliations",
      ] as const,
      ["dcAncsCsv", "counts.dcAncs", "dcAncs"] as const,
      ["dcSmdsCsv", "counts.dcSmds", "dcSmds"] as const,
      ["dcSmdCommissionersCsv", "counts.dcSmdCommissioners", "dcSmdCommissioners"] as const,
      ["dcWardsCsv", "counts.dcWards", "dcWards"] as const,
      ["dcCourtsCsv", "counts.dcCourts", "dcCourts"] as const,
      ["dcLegalAuthoritiesCsv", "counts.dcLegalAuthorities", "dcLegalAuthorities"] as const,
      ["dcRelationshipsCsv", "counts.dcRelationships", "dcRelationships"] as const,
      ["dcSourcesCsv", "counts.dcSources", "dcSources"] as const,
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
  validateCsvHeaderContract(outputName, outputPath, rows, errors);

  validateIntegerAgreement(
    rows.length - 1,
    expected,
    expectedLabel,
    `${outputPath} data rows`,
    errors,
  );
}

function validateCsvHeaderContract(
  outputName: string,
  outputPath: string,
  rows: string[][],
  errors: string[],
): void {
  const expectedHeaders = RELEASE_CSV_HEADER_CONTRACTS[outputName as ReleaseOutputName];
  if (!expectedHeaders) {
    return;
  }
  if (!arraysEqual(rows[0], [...expectedHeaders])) {
    errors.push(`${outputPath} headers must match the release CSV contract`);
    return;
  }
  for (const [index, row] of rows.slice(1).entries()) {
    if (row.length !== expectedHeaders.length) {
      errors.push(
        `${outputPath} row ${
          index + 2
        } has ${row.length} fields, expected ${expectedHeaders.length}`,
      );
    }
  }
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
    validateReleaseOpenReviewQueueCounts("manifest.reviewQueueCounts", reviewQueueCounts, errors);
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

function validateReleaseOpenReviewQueueCounts(
  label: string,
  counts: Record<string, number> | null,
  errors: string[],
): void {
  if (!counts) {
    return;
  }
  for (const queue of ["blocking", "actionable", "drafted"] as const) {
    if ((counts[queue] ?? 0) !== 0) {
      errors.push(
        `${label}.${queue} must be 0 for release verification, found ${counts[queue]}`,
      );
    }
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
  if (summary.jurisdiction !== "dc") {
    errors.push(`${label}.jurisdiction must be dc, found ${String(summary.jurisdiction)}`);
  }
  validateUtcIsoTimestamp(summary.exportedAt, `${label}.exportedAt`, errors);

  for (
    const field of [
      "nodeCount",
      "edgeCount",
      "excludedNodeCount",
      "excludedEdgeCount",
      "blockedReviewItemCount",
      "releaseBlockingReviewItemCount",
      "nonBlockingDeferredReviewItemCount",
      "mappedRelationCount",
    ]
  ) {
    validateNonNegativeInteger(summary[field], `${label}.${field}`, errors);
  }

  const nodeKindCounts = readCountRecordField(summary, "nodeKindCounts", label, errors);
  const nodeCategoryCounts = readCountRecordField(summary, "nodeCategoryCounts", label, errors);
  const edgeVerbCounts = readCountRecordField(summary, "edgeVerbCounts", label, errors);
  const reviewQueueCounts = readCountRecordField(summary, "reviewQueueCounts", label, errors);
  const blockedReviewCountsByCategory = readCountRecordField(
    summary,
    "blockedReviewCountsByCategory",
    label,
    errors,
  );
  validateExactCountRecordKeys(
    reviewQueueCounts,
    REVIEW_QUEUES,
    `${label}.reviewQueueCounts`,
    errors,
  );
  validateReleaseOpenReviewQueueCounts(`${label}.reviewQueueCounts`, reviewQueueCounts, errors);
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
  readCountRecordField(summary, "nonGraphLedgerEntryKinds", label, errors);
  if (
    typeof summary.nonGraphLedgerEntryNote !== "string" ||
    summary.nonGraphLedgerEntryNote.length === 0
  ) {
    errors.push(`${label}.nonGraphLedgerEntryNote must be a non-empty string`);
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
  if (typeof summary.blockedReviewItemCount === "number") {
    validateIntegerAgreement(
      summary.blockedReviewItemCount,
      summary.releaseBlockingReviewItemCount,
      `${label}.releaseBlockingReviewItemCount`,
      `${label}.blockedReviewItemCount`,
      errors,
    );
  }
  if (reviewQueueCounts) {
    validateIntegerAgreement(
      reviewQueueCounts.deferred,
      summary.nonBlockingDeferredReviewItemCount,
      `${label}.nonBlockingDeferredReviewItemCount`,
      `${label}.reviewQueueCounts.deferred`,
      errors,
    );
  }
  const reviewPosture = readRecordField(summary, "reviewPosture", label, errors);
  if (reviewPosture) {
    if (typeof summary.releaseBlockingReviewItemCount === "number") {
      validateIntegerAgreement(
        summary.releaseBlockingReviewItemCount,
        reviewPosture.releaseBlockingReviewItemCount,
        `${label}.reviewPosture.releaseBlockingReviewItemCount`,
        `${label}.releaseBlockingReviewItemCount`,
        errors,
      );
    }
    if (typeof summary.nonBlockingDeferredReviewItemCount === "number") {
      validateIntegerAgreement(
        summary.nonBlockingDeferredReviewItemCount,
        reviewPosture.nonBlockingDeferredReviewItemCount,
        `${label}.reviewPosture.nonBlockingDeferredReviewItemCount`,
        `${label}.nonBlockingDeferredReviewItemCount`,
        errors,
      );
    }
    if (typeof reviewPosture.note !== "string" || reviewPosture.note.length === 0) {
      errors.push(`${label}.reviewPosture.note must be a non-empty string`);
    }
  }
  const relationFieldDescriptions = readRecordField(
    summary,
    "relationFieldDescriptions",
    label,
    errors,
  );
  if (relationFieldDescriptions) {
    for (const field of ["relationKind", "verb"]) {
      if (
        typeof relationFieldDescriptions[field] !== "string" ||
        relationFieldDescriptions[field].length === 0
      ) {
        errors.push(`${label}.relationFieldDescriptions.${field} must be a non-empty string`);
      }
    }
  }
  const requiredDescriptionFields = {
    nodeFieldDescriptions: [
      "id",
      "ledgerId",
      "slug",
      "name",
      "category",
      "kind",
      "family",
      "officialUrl",
      "sourcePageUrl",
      "legalAuthorityIds",
      "sourceCitationCount",
      "publicStatus",
    ],
    edgeFieldDescriptions: [
      "id",
      "from",
      "to",
      "relationKind",
      "verb",
      "citations",
      "publicStatus",
    ],
    citationFieldDescriptions: ["source", "sourceRecordId", "locator", "url"],
  };
  for (const [fieldName, requiredFields] of Object.entries(requiredDescriptionFields)) {
    const descriptions = readRecordField(summary, fieldName, label, errors);
    if (!descriptions) {
      continue;
    }
    for (const field of requiredFields) {
      if (typeof descriptions[field] !== "string" || descriptions[field].length === 0) {
        errors.push(`${label}.${fieldName}.${field} must be a non-empty string`);
      }
    }
  }
  if (!Array.isArray(summary.joinRules) || summary.joinRules.length === 0) {
    errors.push(`${label}.joinRules must be a non-empty array`);
  } else {
    for (const [index, rule] of summary.joinRules.entries()) {
      if (typeof rule !== "string" || rule.length === 0) {
        errors.push(`${label}.joinRules[${index}] must be a non-empty string`);
      }
    }
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

function validateReleaseProvenance(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("manifest.provenance must be an object");
    return;
  }

  validateNullablePattern(
    value.gitHeadCommit,
    "manifest.provenance.gitHeadCommit",
    /^[0-9a-f]{40}$/,
    "a 40-character git HEAD commit hash",
    errors,
  );
  validateNullablePattern(
    value.gitHeadRef,
    "manifest.provenance.gitHeadRef",
    /^refs\/[A-Za-z0-9._\/-]+$/,
    "a git HEAD ref name",
    errors,
  );
  validateNullablePattern(
    value.gitHeadBranch,
    "manifest.provenance.gitHeadBranch",
    /^[A-Za-z0-9._\/-]+$/,
    "a git HEAD branch name",
    errors,
  );

  if (value.gitSource !== "git_metadata" && value.gitSource !== "unavailable") {
    errors.push("manifest.provenance.gitSource must be git_metadata or unavailable");
  }
  if (
    value.workingTreeStatus !== "clean" && value.workingTreeStatus !== "dirty" &&
    value.workingTreeStatus !== "unknown"
  ) {
    errors.push("manifest.provenance.workingTreeStatus must be clean, dirty, or unknown");
  }
  if (
    value.workingTreeChangedPathCount !== null &&
    (typeof value.workingTreeChangedPathCount !== "number" ||
      !Number.isInteger(value.workingTreeChangedPathCount) ||
      value.workingTreeChangedPathCount < 0)
  ) {
    errors.push(
      "manifest.provenance.workingTreeChangedPathCount must be null or a non-negative integer",
    );
  }
  if (value.workingTreeStatus === "clean" && value.workingTreeChangedPathCount !== 0) {
    errors.push(
      "manifest.provenance.workingTreeChangedPathCount must be 0 when workingTreeStatus is clean",
    );
  }
  if (value.workingTreeStatus === "dirty" && value.workingTreeChangedPathCount === 0) {
    errors.push(
      "manifest.provenance.workingTreeChangedPathCount must be positive when workingTreeStatus is dirty",
    );
  }
  if (value.workingTreeStatus === "unknown" && value.workingTreeChangedPathCount !== null) {
    errors.push(
      "manifest.provenance.workingTreeChangedPathCount must be null when workingTreeStatus is unknown",
    );
  }
  if (value.gitSource === "git_metadata" && typeof value.gitHeadCommit !== "string") {
    errors.push("manifest.provenance.gitHeadCommit is required when gitSource is git_metadata");
  }
  if (value.gitSource === "unavailable" && value.gitHeadCommit !== null) {
    errors.push("manifest.provenance.gitHeadCommit must be null when gitSource is unavailable");
  }
}

function validateNullablePattern(
  value: unknown,
  label: string,
  pattern: RegExp,
  description: string,
  errors: string[],
): void {
  if (value === null) {
    return;
  }
  if (typeof value !== "string" || !pattern.test(value)) {
    errors.push(`${label} must be null or ${description}`);
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
  provenance: ReleaseProvenance;
  entryKindCounts: Map<string, number>;
  relationKindCounts: Map<string, number>;
  relationExamples: RelationExample[];
  reviewPosture: ReviewPosture;
  outputRowCounts: Partial<Record<ReleaseOutputName, number>>;
  govGraphSummary: {
    nodeCount: number;
    nodeKindCounts: Record<string, number>;
    nodeCategoryCounts: Record<string, number>;
    edgeCount: number;
    edgeVerbCounts: Record<string, number>;
    excludedNodeCount: number;
    excludedEdgeCount: number;
    blockedReviewItemCount: number;
    releaseBlockingReviewItemCount: number;
    nonBlockingDeferredReviewItemCount: number;
    mappedRelationCount: number;
    mappedRelationCounts: Array<{
      relationKind: string;
      verb: string;
      count: number;
    }>;
  };
}): string {
  const hasCollectedEmptyAuthority = input.sourceCoverageRows.some((row) =>
    row[SOURCE_COVERAGE_COLUMN.source] === "dcgis.authorities" &&
    row[SOURCE_COVERAGE_COLUMN.collectionStatus] === "collected_empty"
  );
  return [
    "# DC Civic Ledger",
    "",
    "Download one CSV, or use SQLite/GovGraph JSON for joins.",
    "",
    `- Jurisdiction: ${input.jurisdiction}`,
    `- Exported at: ${input.exportedAt}`,
    "- Export provenance: see [manifest.json](manifest.json)",
    `- Entries / relations / citations: ${input.entryCount} / ${input.relationCount} / ${input.citationCount}`,
    `- GovGraph nodes / edges: ${input.govGraphSummary.nodeCount} / ${input.govGraphSummary.edgeCount}`,
    `- Release-blocking review items: ${input.govGraphSummary.releaseBlockingReviewItemCount}`,
    "",
    "## Start Here",
    "",
    "- Agencies and offices: `dc_agencies.csv`, `dc_offices.csv`",
    "- Elected officials: `dc_councilmembers.csv`, `dc_wards.csv`",
    "- Council committees: `dc_council_committees.csv`, `dc_council_committee_memberships.csv`",
    "- ANCs and SMDs: `dc_ancs.csv`, `dc_smds.csv`",
    "- Boards and commissions: `dc_public_bodies.csv`, `dc_public_body_affiliations.csv`",
    "- Legal authority and links: `dc_legal_authorities.csv`, `dc_relationships.csv`",
    "- Sources and caveats: `dc_sources.csv`",
    "- Bulk joins: `ledger.sqlite`",
    "- GovGraph: start with `govgraph_summary.json`, then use `govgraph_nodes.json` and `govgraph_edges.json`.",
    "",
    "## Public CSVs",
    "",
    ...releaseReadmeAssetOutputLines("public_csv", input.outputRowCounts),
    "",
    "## Machine Files",
    "",
    ...releaseReadmeOutputLines("machine_json", input.outputRowCounts),
    ...releaseReadmeOutputLines("database", input.outputRowCounts),
    "- [manifest.json](manifest.json) - file sizes, hashes, row counts, columns, and asset categories.",
    "- [SHA256SUMS](SHA256SUMS) - checksums for upload assets except `manifest.json` and `SHA256SUMS`.",
    "",
    "## Notes",
    "",
    "- Blank cells mean no current source-backed value.",
    "- Officeholder names are included for elected seats; contact details are not.",
    "- `dc_councilmembers.csv` is the 13-member elected Council roster; `dc.council` in GovGraph counts means council-type public bodies.",
    "- Ledger entries can exceed GovGraph nodes because source/audit anchor kinds listed in `govgraph_summary.json` are not graph nodes.",
    "- Legal rows use explicit D.C. Code, D.C. Law, and Mayor's Order locators.",
    "- Committee `member_count` includes chairs; Committee of the Whole has all 13 Councilmembers.",
    "- Public-body near-duplicates stay distinct unless a tracked merge or suppression says otherwise.",
    "- `manifest.json` lists upload assets, row counts, columns, and hashes.",
    "- `ledger.sqlite` includes the public tables plus audit tables; start with `release_table_catalog`.",
    ...(hasCollectedEmptyAuthority
      ? [
        "- DCGIS authorities were collected empty; this release has zero `dc.authority` rows from that source.",
      ]
      : []),
    "",
    "## Release Checks",
    "",
    `Review queue: ${input.reviewPosture.total} total; ${input.reviewPosture.queues.blocking} blocking; ${input.reviewPosture.queues.applied} applied; ${input.reviewPosture.queues.deferred} deferred.`,
    `Sources: ${input.sourceCoverageRows.length}; exported / inventory-only / collected-empty ${
      input.sourceCoverageReleaseStatusCounts.exported ?? 0
    } / ${input.sourceCoverageReleaseStatusCounts.inventory_only ?? 0} / ${
      input.sourceCoverageReleaseStatusCounts.collected_empty ?? 0
    }.`,
    "Verify downloaded assets with `sha256sum -c SHA256SUMS` or `shasum -a 256 -c SHA256SUMS`.",
    "",
  ].join("\n");
}

function releaseReadmeOutputLines(
  category: ReleaseOutputCategory,
  outputRowCounts: Partial<Record<ReleaseOutputName, number>>,
): string[] {
  return RELEASE_OUTPUT_ORDER
    .filter((outputName) => RELEASE_OUTPUT_CATALOG_METADATA[outputName].category === category)
    .map((outputName) => {
      const path = RELEASE_OUTPUT_PATHS[outputName];
      const description = RELEASE_OUTPUT_CATALOG_METADATA[outputName].description;
      return releaseReadmeOutputLine(path, description, outputRowCounts[outputName]);
    });
}

function releaseReadmeAssetOutputLines(
  category: ReleaseOutputCategory,
  outputRowCounts: Partial<Record<ReleaseOutputName, number>>,
): string[] {
  return RELEASE_OUTPUT_ORDER
    .filter((outputName) => {
      const metadata = RELEASE_OUTPUT_CATALOG_METADATA[outputName];
      return metadata.category === category && metadata.releaseAsset;
    })
    .map((outputName) => {
      const path = RELEASE_OUTPUT_PATHS[outputName];
      const description = RELEASE_OUTPUT_CATALOG_METADATA[outputName].description;
      return releaseReadmeOutputLine(path, description, outputRowCounts[outputName]);
    });
}

function releaseReadmeOutputLine(
  path: string,
  description: string,
  rowCount?: number,
): string {
  const rowLabel = typeof rowCount === "number"
    ? ` (${rowCount} row${rowCount === 1 ? "" : "s"})`
    : "";
  return `- [${path}](${path})${rowLabel} - ${description}`;
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

function reviewQueueNoteLines(): string[] {
  return [
    "  - blocking: Open items that would block state generation or current public-output release readiness.",
    "  - actionable: Open items that still need an operator decision, but do not currently block the active release path.",
    "  - drafted: A draft revision exists; validate, apply, or revise it before treating the decision as tracked.",
    "  - applied: A tracked revision or imported review decision already accounts for the item and is retained as audit evidence.",
    "  - deferred: Parked, non-blocking work outside current release scope or without public-output impact.",
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

async function buildReleaseProvenance(): Promise<ReleaseProvenance> {
  const git = await readGitMetadata(Deno.cwd());
  if (!git) {
    return {
      gitHeadCommit: null,
      gitHeadRef: null,
      gitHeadBranch: null,
      gitSource: "unavailable",
      workingTreeStatus: "unknown",
      workingTreeChangedPathCount: null,
    };
  }
  const workingTree = await readGitWorkingTreeStatus(git.workTree);

  return {
    gitHeadCommit: git.commit,
    gitHeadRef: git.ref,
    gitHeadBranch: git.branch,
    gitSource: "git_metadata",
    workingTreeStatus: workingTree.status,
    workingTreeChangedPathCount: workingTree.changedPathCount,
  };
}

async function readGitMetadata(
  startDir: string,
): Promise<
  { commit: string; ref: string | null; branch: string | null; workTree: string } | null
> {
  const git = await findGitDirectory(startDir);
  if (!git) {
    return null;
  }

  let head: string;
  try {
    head = (await Deno.readTextFile(join(git.gitDir, "HEAD"))).trim();
  } catch {
    return null;
  }

  if (/^[0-9a-f]{40}$/.test(head)) {
    return { commit: head, ref: null, branch: null, workTree: git.workTree };
  }

  const refPrefix = "ref: ";
  if (!head.startsWith(refPrefix)) {
    return null;
  }

  const ref = head.slice(refPrefix.length).trim();
  const commit = await readGitRefCommit(git.gitDir, ref);
  if (!commit) {
    return null;
  }

  const branchPrefix = "refs/heads/";
  return {
    commit,
    ref,
    branch: ref.startsWith(branchPrefix) ? ref.slice(branchPrefix.length) : null,
    workTree: git.workTree,
  };
}

async function readGitWorkingTreeStatus(
  workTree: string,
): Promise<{ status: ReleaseProvenance["workingTreeStatus"]; changedPathCount: number | null }> {
  try {
    const command = new Deno.Command("git", {
      args: ["-C", workTree, "status", "--porcelain=v1", "--untracked-files=all"],
    });
    const output = await command.output();
    if (!output.success) {
      return { status: "unknown", changedPathCount: null };
    }
    const statusText = new TextDecoder().decode(output.stdout).trim();
    if (statusText.length === 0) {
      return { status: "clean", changedPathCount: 0 };
    }
    const changedPathCount = statusText.split(/\r?\n/).filter((line) => line.length > 0).length;
    return { status: "dirty", changedPathCount };
  } catch {
    return { status: "unknown", changedPathCount: null };
  }
}

async function findGitDirectory(
  startDir: string,
): Promise<{ gitDir: string; workTree: string } | null> {
  let current = startDir;
  while (true) {
    const dotGit = join(current, ".git");
    try {
      const info = await Deno.stat(dotGit);
      if (info.isDirectory) {
        return { gitDir: dotGit, workTree: current };
      }
      if (info.isFile) {
        const gitFile = await Deno.readTextFile(dotGit);
        const prefix = "gitdir:";
        const line = gitFile.trim();
        if (line.startsWith(prefix)) {
          const rawPath = line.slice(prefix.length).trim();
          return {
            gitDir: isAbsolute(rawPath) ? rawPath : join(current, rawPath),
            workTree: current,
          };
        }
      }
    } catch {
      // Keep walking upward until the filesystem root.
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function readGitRefCommit(gitDir: string, ref: string): Promise<string | null> {
  try {
    const commit = (await Deno.readTextFile(join(gitDir, ref))).trim();
    if (/^[0-9a-f]{40}$/.test(commit)) {
      return commit;
    }
  } catch {
    // Fall through to packed refs.
  }

  try {
    const packedRefs = await Deno.readTextFile(join(gitDir, "packed-refs"));
    for (const line of packedRefs.split(/\r?\n/)) {
      if (line.startsWith("#") || line.startsWith("^") || line.trim().length === 0) {
        continue;
      }
      const [commit, packedRef] = line.trim().split(/\s+/, 2);
      if (packedRef === ref && /^[0-9a-f]{40}$/.test(commit)) {
        return commit;
      }
    }
  } catch {
    // No packed refs available.
  }

  return null;
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
      : " (source: inspect _local/ledger_citations.csv)";
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
    "  - advisory / appointing / oversight / enforcement powers: this release does not infer `advises`, `appoints`, `oversees`, `administers`, or `enforces` edges from names, membership text, or broad enabling prose.",
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
        "Source-backed relation kind; inspect _local/ledger_relations.csv and _local/ledger_citations.csv before broad use.";
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
    return "Authority source is collected-empty in this release; see _local/source_coverage.csv for the live-source caveat.";
  }

  return dcEntityKindDescription(kind) ??
    "Ledger entry kind; inspect _local/ledger_entries.csv for source-specific citations.";
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
  outputRowCounts: Partial<Record<ReleaseOutputName, number>>,
): Promise<Record<string, OutputFileMetadata>> {
  const metadata = await Promise.all(
    Object.entries(outputs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async ([outputName, outputPath]) => {
        const bytes = await Deno.readFile(join(releaseRoot, outputPath));
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const columns = RELEASE_CSV_HEADER_CONTRACTS[outputName as ReleaseOutputName];
        return [
          outputName,
          {
            path: outputPath,
            byteSize: bytes.byteLength,
            sha256: hexDigest(digest),
            ...(columns
              ? {
                rowCount: outputRowCounts[outputName as ReleaseOutputName] ?? 0,
                columnCount: columns.length,
                columns: [...columns],
              }
              : {}),
          },
        ] as const;
      }),
  );
  return Object.fromEntries(metadata);
}

function buildReleaseOutputCatalog(
  outputs: Record<string, string>,
  outputFileMetadata: Record<string, OutputFileMetadata>,
): ReleaseOutputCatalogItem[] {
  return Object.entries(outputs)
    .sort(([left], [right]) => {
      const leftMetadata = releaseOutputCatalogMetadata(left);
      const rightMetadata = releaseOutputCatalogMetadata(right);
      const leftCategoryOrder = releaseOutputCategoryOrder(leftMetadata?.category);
      const rightCategoryOrder = releaseOutputCategoryOrder(rightMetadata?.category);
      const leftOutputOrder = releaseOutputOrder(left);
      const rightOutputOrder = releaseOutputOrder(right);
      return leftCategoryOrder - rightCategoryOrder || leftOutputOrder - rightOutputOrder ||
        left.localeCompare(right);
    })
    .map(([outputName, path]) => {
      const metadata = releaseOutputCatalogMetadata(outputName);
      if (!metadata) {
        throw new Error(`missing release output catalog metadata for ${outputName}`);
      }
      const fileMetadata = outputFileMetadata[outputName];
      if (!fileMetadata) {
        throw new Error(`missing release output file metadata for ${outputName}`);
      }
      return {
        outputName,
        path,
        category: metadata.category,
        releaseAsset: metadata.releaseAsset,
        description: metadata.description,
        byteSize: fileMetadata.byteSize,
        sha256: fileMetadata.sha256,
        ...(typeof fileMetadata.rowCount === "number" ? { rowCount: fileMetadata.rowCount } : {}),
        ...(typeof fileMetadata.columnCount === "number"
          ? { columnCount: fileMetadata.columnCount }
          : {}),
        ...(Array.isArray(fileMetadata.columns) ? { columns: fileMetadata.columns } : {}),
      };
    });
}

function buildReleaseAssetIndex(outputCatalog: ReleaseOutputCatalogItem[]): ReleaseAssetIndex {
  const assetItems = outputCatalog.filter((item) => item.releaseAsset);
  const categories = assetItems.reduce<Record<string, number>>((counts, item) => {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, { machine_json: 1 });
  return {
    paths: [...assetItems.map((item) => item.path), "manifest.json"],
    outputNames: [...assetItems.map((item) => item.outputName), "manifestJson"],
    items: [
      ...assetItems.map((item) => ({
        outputName: item.outputName,
        path: item.path,
        category: item.category,
        releaseAsset: true as const,
        description: item.description,
        byteSize: item.byteSize,
        sha256: item.sha256,
        ...(typeof item.rowCount === "number" ? { rowCount: item.rowCount } : {}),
        ...(typeof item.columnCount === "number" ? { columnCount: item.columnCount } : {}),
        ...(Array.isArray(item.columns) ? { columns: item.columns } : {}),
      })),
      {
        outputName: "manifestJson",
        path: "manifest.json",
        category: "machine_json",
        releaseAsset: true,
        description: "Release manifest with file sizes, hashes, row counts, and asset categories.",
      },
    ],
    categories,
    note: "Upload these files as separate GitHub release assets.",
    count: assetItems.length + 1,
  };
}

function buildLocalOnlyOutputIndex(
  outputCatalog: ReleaseOutputCatalogItem[],
): LocalOnlyOutputIndex {
  const localOnlyItems = outputCatalog.filter((item) => !item.releaseAsset);
  const categories = localOnlyItems.reduce<Record<string, number>>((counts, item) => {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, {});
  return {
    paths: localOnlyItems.map((item) => item.path),
    outputNames: localOnlyItems.map((item) => item.outputName),
    items: localOnlyItems.map((item) => ({
      outputName: item.outputName,
      path: item.path,
      category: item.category,
      description: item.description,
      ...(typeof item.rowCount === "number" ? { rowCount: item.rowCount } : {}),
      ...(typeof item.columnCount === "number" ? { columnCount: item.columnCount } : {}),
      ...(Array.isArray(item.columns) ? { columns: item.columns } : {}),
    })),
    categories,
    note:
      "Kept under _local and bundled into ledger.sqlite for audit; do not upload as separate GitHub assets.",
    count: localOnlyItems.length,
  };
}

function buildReleaseStartHere(
  outputCatalog: ReleaseOutputCatalogItem[],
  releaseAssets: ReleaseAssetIndex,
  localOnlyOutputs: LocalOnlyOutputIndex,
): ReleaseStartHere {
  const publicCsvCount =
    outputCatalog.filter((item) => item.category === "public_csv" && item.releaseAsset).length;
  return {
    primaryReadme: "README.md",
    recommendedEntryPoints: [
      {
        label: "Download a CSV",
        path: "README.md",
        note: "Short release index with row counts and file descriptions.",
      },
      {
        label: "Check file metadata",
        path: "manifest.json",
        note: "Assets, local audit outputs, hashes, row counts, and columns.",
      },
      {
        label: "Query SQLite",
        path: "ledger.sqlite",
        note: "Open release_table_catalog first for table groups, row counts, and columns.",
      },
      {
        label: "Use graph JSON",
        path: "govgraph_summary.json",
        note: "Field descriptions and join rules for govgraph_nodes.json and govgraph_edges.json.",
      },
    ],
    releaseAssetCount: releaseAssets.count,
    publicCsvCount,
    localAuditOutputCount: localOnlyOutputs.count,
    sqliteCatalogTable: "release_table_catalog",
    govGraphSchemaFile: "govgraph_summary.json",
  };
}

function buildSqliteTableIndex(): SqliteTableIndex {
  return {
    description:
      "ledger.sqlite bundles public tables, audit tables, helper tables, and release_table_catalog.",
    metadataTables: ["release_table_catalog"],
    publicTables: RELEASE_OUTPUT_ORDER
      .filter((outputName) => {
        const metadata = RELEASE_OUTPUT_CATALOG_METADATA[outputName];
        return metadata.category === "public_csv" && metadata.releaseAsset;
      })
      .map((outputName) => csvOutputTableName(RELEASE_OUTPUT_PATHS[outputName])),
    traceabilityTables: [
      "ledger_entries",
      "ledger_relations",
      "ledger_citations",
      "source_counts",
      "source_coverage",
    ],
    compatibilityTables: RELEASE_OUTPUT_ORDER
      .filter((outputName) =>
        RELEASE_OUTPUT_CATALOG_METADATA[outputName].category === "compatibility_csv"
      )
      .map((outputName) => csvOutputTableName(RELEASE_OUTPUT_PATHS[outputName])),
    rawLedgerTables: ["entries", "relations", "citations", "sources"],
  };
}

function csvOutputTableName(path: string): string {
  const fileName = path.split(/[\\/]+/).at(-1) ?? path;
  return fileName.endsWith(".csv") ? fileName.slice(0, -".csv".length) : fileName;
}

function buildSqliteTableCatalogRows(
  outputRowCounts: Partial<Record<ReleaseOutputName, number>>,
): Array<Array<string | number | null>> {
  const metadataRows: SqliteTableCatalogRow[] = [{
    tableName: "release_table_catalog",
    tableGroup: "metadata",
    tableKind: "table",
    releasePath: "",
    isReleaseAsset: false,
    rowCount: undefined,
    columnCount: 9,
    columnsJson: JSON.stringify([
      "table_name",
      "table_group",
      "table_kind",
      "release_path",
      "is_release_asset",
      "row_count",
      "column_count",
      "columns_json",
      "description",
    ]),
    description: "SQLite table catalog with release path, public asset, row, and column metadata.",
  }];

  const outputRows = RELEASE_OUTPUT_ORDER
    .filter((outputName) => {
      const metadata = RELEASE_OUTPUT_CATALOG_METADATA[outputName];
      return metadata.category === "public_csv" || metadata.category === "traceability_csv" ||
        metadata.category === "compatibility_csv";
    })
    .map((outputName): SqliteTableCatalogRow => {
      const metadata = RELEASE_OUTPUT_CATALOG_METADATA[outputName];
      const path = RELEASE_OUTPUT_PATHS[outputName];
      return {
        tableName: csvOutputTableName(path),
        tableGroup: sqliteTableGroupForOutput(metadata.category),
        tableKind: "table",
        releasePath: path,
        isReleaseAsset: metadata.releaseAsset,
        rowCount: outputRowCounts[outputName],
        columnCount: RELEASE_CSV_HEADER_CONTRACTS[outputName]?.length,
        columnsJson: JSON.stringify(RELEASE_CSV_HEADER_CONTRACTS[outputName] ?? []),
        description: metadata.description,
      };
    });

  const rawLedgerRows: SqliteTableCatalogRow[] = [
    {
      tableName: "entries",
      tableGroup: "raw_ledger",
      tableKind: "view",
      releasePath: "",
      isReleaseAsset: false,
      rowCount: outputRowCounts.entriesCsv,
      columnCount: releaseCsvColumnCount("entriesCsv"),
      columnsJson: JSON.stringify(RELEASE_CSV_HEADER_CONTRACTS.entriesCsv ?? []),
      description: "Short alias for ledger_entries inside ledger.sqlite.",
    },
    {
      tableName: "relations",
      tableGroup: "raw_ledger",
      tableKind: "view",
      releasePath: "",
      isReleaseAsset: false,
      rowCount: outputRowCounts.relationsCsv,
      columnCount: releaseCsvColumnCount("relationsCsv"),
      columnsJson: JSON.stringify(RELEASE_CSV_HEADER_CONTRACTS.relationsCsv ?? []),
      description: "Short alias for ledger_relations inside ledger.sqlite.",
    },
    {
      tableName: "citations",
      tableGroup: "raw_ledger",
      tableKind: "view",
      releasePath: "",
      isReleaseAsset: false,
      rowCount: outputRowCounts.citationsCsv,
      columnCount: releaseCsvColumnCount("citationsCsv"),
      columnsJson: JSON.stringify(RELEASE_CSV_HEADER_CONTRACTS.citationsCsv ?? []),
      description: "Short alias for ledger_citations inside ledger.sqlite.",
    },
    {
      tableName: "sources",
      tableGroup: "raw_ledger",
      tableKind: "view",
      releasePath: "",
      isReleaseAsset: false,
      rowCount: outputRowCounts.sourcesCsv,
      columnCount: releaseCsvColumnCount("sourcesCsv"),
      columnsJson: JSON.stringify(RELEASE_CSV_HEADER_CONTRACTS.sourcesCsv ?? []),
      description: "Short alias for source_counts inside ledger.sqlite.",
    },
  ];

  const catalogRows = [...metadataRows, ...outputRows, ...rawLedgerRows];
  metadataRows[0].rowCount = catalogRows.length;
  return catalogRows.map((row) => [
    row.tableName,
    row.tableGroup,
    row.tableKind,
    row.releasePath,
    row.isReleaseAsset ? "1" : "0",
    row.rowCount ?? null,
    row.columnCount ?? null,
    row.columnsJson ?? null,
    row.description,
  ]);
}

function releaseCsvColumnCount(outputName: ReleaseOutputName): number | undefined {
  return RELEASE_CSV_HEADER_CONTRACTS[outputName]?.length;
}

function sqliteTableGroupForOutput(
  category: ReleaseOutputCategory,
): SqliteTableCatalogRow["tableGroup"] {
  if (category === "public_csv") {
    return "public";
  }
  if (category === "traceability_csv") {
    return "traceability";
  }
  if (category === "compatibility_csv") {
    return "compatibility";
  }
  throw new Error(`no SQLite table group for release output category ${category}`);
}

function buildReleaseSha256Sums(outputCatalog: ReleaseOutputCatalogItem[]): string {
  return outputCatalog
    .filter((item) => item.releaseAsset)
    .sort((left, right) =>
      releaseOutputOrder(left.outputName) - releaseOutputOrder(right.outputName)
    )
    .map((item) => `${item.sha256}  ${item.path}`)
    .join("\n") + "\n";
}

function releaseOutputCatalogMetadata(
  outputName: string,
): { category: ReleaseOutputCategory; releaseAsset: boolean; description: string } | undefined {
  return RELEASE_OUTPUT_CATALOG_METADATA[outputName as ReleaseOutputName];
}

function releaseOutputOrder(outputName: string): number {
  const index = RELEASE_OUTPUT_ORDER.indexOf(outputName as ReleaseOutputName);
  return index === -1 ? RELEASE_OUTPUT_ORDER.length : index;
}

function releaseOutputCategoryOrder(category: ReleaseOutputCategory | undefined): number {
  if (!category) {
    return RELEASE_OUTPUT_CATEGORIES.length;
  }
  return RELEASE_OUTPUT_CATEGORIES.indexOf(category);
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

function parseReleaseOutputCatalog(
  value: unknown,
  errors: string[],
): ReleaseOutputCatalogItem[] | null {
  if (!Array.isArray(value)) {
    errors.push("manifest outputCatalog must be an array");
    return null;
  }

  const catalog: ReleaseOutputCatalogItem[] = [];
  for (const [index, rawItem] of value.entries()) {
    const label = `manifest.outputCatalog[${index}]`;
    if (!isRecord(rawItem)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (typeof rawItem.outputName !== "string" || rawItem.outputName.length === 0) {
      errors.push(`${label}.outputName must be a non-empty string`);
      continue;
    }
    if (typeof rawItem.path !== "string" || rawItem.path.length === 0) {
      errors.push(`${label}.path must be a non-empty string`);
      continue;
    }
    if (
      typeof rawItem.category !== "string" ||
      !RELEASE_OUTPUT_CATEGORIES.includes(rawItem.category as ReleaseOutputCategory)
    ) {
      errors.push(
        `${label}.category must be one of ${RELEASE_OUTPUT_CATEGORIES.join(", ")}`,
      );
      continue;
    }
    if (typeof rawItem.releaseAsset !== "boolean") {
      errors.push(`${label}.releaseAsset must be a boolean`);
      continue;
    }
    if (typeof rawItem.description !== "string" || rawItem.description.length === 0) {
      errors.push(`${label}.description must be a non-empty string`);
      continue;
    }
    if (typeof rawItem.byteSize !== "number" || !Number.isInteger(rawItem.byteSize)) {
      errors.push(`${label}.byteSize must be an integer`);
      continue;
    }
    if (typeof rawItem.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(rawItem.sha256)) {
      errors.push(`${label}.sha256 must be a SHA-256 hex digest`);
      continue;
    }
    const parsedItem: ReleaseOutputCatalogItem = {
      outputName: rawItem.outputName,
      path: rawItem.path,
      category: rawItem.category as ReleaseOutputCategory,
      releaseAsset: rawItem.releaseAsset,
      description: rawItem.description,
      byteSize: rawItem.byteSize,
      sha256: rawItem.sha256,
    };
    if ("rowCount" in rawItem) {
      if (typeof rawItem.rowCount !== "number" || !Number.isInteger(rawItem.rowCount)) {
        errors.push(`${label}.rowCount must be an integer`);
        continue;
      }
      parsedItem.rowCount = rawItem.rowCount;
    }
    if ("columnCount" in rawItem) {
      if (typeof rawItem.columnCount !== "number" || !Number.isInteger(rawItem.columnCount)) {
        errors.push(`${label}.columnCount must be an integer`);
        continue;
      }
      parsedItem.columnCount = rawItem.columnCount;
    }
    if ("columns" in rawItem) {
      if (!Array.isArray(rawItem.columns)) {
        errors.push(`${label}.columns must be an array`);
        continue;
      }
      const columns: string[] = [];
      for (const [columnIndex, rawColumn] of rawItem.columns.entries()) {
        if (typeof rawColumn !== "string" || rawColumn.length === 0) {
          errors.push(`${label}.columns[${columnIndex}] must be a non-empty string`);
          continue;
        }
        columns.push(rawColumn);
      }
      parsedItem.columns = columns;
    }
    catalog.push(parsedItem);
  }
  return catalog;
}

function validateReleaseOutputCatalog(
  outputs: Record<string, string>,
  outputCatalog: ReleaseOutputCatalogItem[],
  outputFileMetadata: Record<string, OutputFileMetadata>,
  errors: string[],
): void {
  const seenOutputNames = new Set<string>();
  for (const item of outputCatalog) {
    if (seenOutputNames.has(item.outputName)) {
      errors.push(`manifest outputCatalog has duplicate outputName ${item.outputName}`);
      continue;
    }
    seenOutputNames.add(item.outputName);

    const outputPath = outputs[item.outputName];
    if (!outputPath) {
      errors.push(`manifest outputCatalog ${item.outputName} has no matching output`);
      continue;
    }
    if (outputPath !== item.path) {
      errors.push(
        `manifest outputCatalog ${item.outputName} path mismatch: expected ${outputPath}, found ${item.path}`,
      );
    }

    const expected = releaseOutputCatalogMetadata(item.outputName);
    if (!expected) {
      errors.push(`manifest outputCatalog ${item.outputName} is not a known release output`);
      continue;
    }
    if (item.category !== expected.category) {
      errors.push(
        `manifest outputCatalog ${item.outputName} category must be ${expected.category}`,
      );
    }
    if (item.releaseAsset !== expected.releaseAsset) {
      errors.push(
        `manifest outputCatalog ${item.outputName} releaseAsset must be ${expected.releaseAsset}`,
      );
    }
    if (item.description !== expected.description) {
      errors.push(`manifest outputCatalog ${item.outputName} description is stale`);
    }
    const metadata = outputFileMetadata[item.outputName];
    if (metadata) {
      if (item.byteSize !== metadata.byteSize) {
        errors.push(
          `manifest outputCatalog ${item.outputName} byteSize mismatch: expected ${metadata.byteSize}, found ${item.byteSize}`,
        );
      }
      if (item.sha256 !== metadata.sha256) {
        errors.push(`manifest outputCatalog ${item.outputName} sha256 mismatch`);
      }
      if (item.rowCount !== metadata.rowCount) {
        errors.push(
          `manifest outputCatalog ${item.outputName} rowCount mismatch: expected ${
            metadata.rowCount ?? "undefined"
          }, found ${item.rowCount ?? "undefined"}`,
        );
      }
      if (item.columnCount !== metadata.columnCount) {
        errors.push(
          `manifest outputCatalog ${item.outputName} columnCount mismatch: expected ${
            metadata.columnCount ?? "undefined"
          }, found ${item.columnCount ?? "undefined"}`,
        );
      }
      if (JSON.stringify(item.columns) !== JSON.stringify(metadata.columns)) {
        errors.push(`manifest outputCatalog ${item.outputName} columns mismatch`);
      }
    }
  }

  for (const outputName of Object.keys(outputs)) {
    if (!seenOutputNames.has(outputName)) {
      errors.push(`manifest output ${outputName} is missing outputCatalog`);
    }
  }
}

function validateReleaseAssetIndexes(
  manifest: Record<string, unknown>,
  outputCatalog: ReleaseOutputCatalogItem[],
  errors: string[],
): void {
  const expectedReleaseAssets = buildReleaseAssetIndex(outputCatalog);
  const expectedLocalOnlyOutputs = buildLocalOnlyOutputIndex(outputCatalog);
  const expectedSqliteTables = buildSqliteTableIndex();
  validateJsonEqual(
    manifest.releaseAssets,
    expectedReleaseAssets,
    "manifest.releaseAssets",
    errors,
  );
  validateJsonEqual(
    manifest.localOnlyOutputs,
    expectedLocalOnlyOutputs,
    "manifest.localOnlyOutputs",
    errors,
  );
  validateJsonEqual(
    manifest.sqliteTables,
    expectedSqliteTables,
    "manifest.sqliteTables",
    errors,
  );
}

async function validateSha256SumsContract(
  releaseRoot: string,
  outputCatalog: ReleaseOutputCatalogItem[],
  errors: string[],
): Promise<void> {
  const sha256SumsItem = outputCatalog.find((item) => item.outputName === "sha256Sums");
  if (!sha256SumsItem) {
    errors.push("manifest outputCatalog sha256Sums is required");
    return;
  }
  if (sha256SumsItem.path !== "SHA256SUMS") {
    errors.push(`SHA256SUMS output path must be SHA256SUMS, found ${sha256SumsItem.path}`);
    return;
  }

  let actualContents: string;
  try {
    actualContents = await Deno.readTextFile(join(releaseRoot, sha256SumsItem.path));
  } catch (error) {
    errors.push(`unable to read SHA256SUMS: ${(error as Error).message}`);
    return;
  }

  const expectedContents = buildReleaseSha256Sums(
    outputCatalog.filter((item) => item.outputName !== "sha256Sums"),
  );
  if (actualContents !== expectedContents) {
    const actualLineCount = countNonEmptyLines(actualContents);
    const expectedLineCount = countNonEmptyLines(expectedContents);
    errors.push(
      `SHA256SUMS must list exactly release upload assets except manifest.json and SHA256SUMS: expected ${expectedLineCount} lines, found ${actualLineCount}`,
    );
  }
}

function countNonEmptyLines(contents: string): number {
  const trimmed = contents.trimEnd();
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

function validateJsonEqual(
  actual: unknown,
  expected: unknown,
  label: string,
  errors: string[],
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${label} is stale`);
  }
}

function parseOutputFileMetadata(
  value: unknown,
  errors: string[],
): Record<string, OutputFileMetadata> | null {
  if (!isRecord(value)) {
    errors.push("manifest outputFileMetadata must be an object");
    return null;
  }

  const metadata: Record<string, OutputFileMetadata> = {};
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
    const parsedMetadata: OutputFileMetadata = {
      path: rawMetadata.path,
      byteSize: rawMetadata.byteSize,
      sha256: rawMetadata.sha256,
    };
    if ("rowCount" in rawMetadata) {
      if (typeof rawMetadata.rowCount !== "number" || !Number.isInteger(rawMetadata.rowCount)) {
        errors.push(`outputFileMetadata ${outputName}.rowCount must be an integer`);
        continue;
      }
      parsedMetadata.rowCount = rawMetadata.rowCount;
    }
    if ("columnCount" in rawMetadata) {
      if (
        typeof rawMetadata.columnCount !== "number" ||
        !Number.isInteger(rawMetadata.columnCount)
      ) {
        errors.push(`outputFileMetadata ${outputName}.columnCount must be an integer`);
        continue;
      }
      parsedMetadata.columnCount = rawMetadata.columnCount;
    }
    if ("columns" in rawMetadata) {
      if (!Array.isArray(rawMetadata.columns)) {
        errors.push(`outputFileMetadata ${outputName}.columns must be an array`);
        continue;
      }
      const columns: string[] = [];
      for (const [index, column] of rawMetadata.columns.entries()) {
        if (typeof column !== "string" || column.length === 0) {
          errors.push(
            `outputFileMetadata ${outputName}.columns[${index}] must be a non-empty string`,
          );
          continue;
        }
        columns.push(column);
      }
      if (columns.length !== rawMetadata.columns.length) {
        continue;
      }
      parsedMetadata.columns = columns;
    }
    metadata[outputName] = {
      ...parsedMetadata,
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
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, payload);
}

function escapeCsv(value: string): string {
  const safe = value ?? "";
  if (safe.includes(",") || safe.includes("\n") || safe.includes("\r") || safe.includes('"')) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}
