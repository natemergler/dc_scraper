import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import { Database } from "@db/sqlite";
import { readGitCommit } from "./git.ts";
import { Workbench } from "./workbench.ts";
import { nowIso, sha256BytesHex, type SmokeProfile } from "./domain.ts";
import { buildReleaseSummary, type ReleaseSummary } from "./release_summary.ts";
import { MANIFEST_VERSION, TOOL_VERSION } from "./version.ts";
import { containsLocalPath } from "./url_safety.ts";
import { withTransaction } from "./workbench/db.ts";

type EntityRow = ReturnType<Workbench["canonicalEntities"]>[number];
type RelationshipRow = ReturnType<Workbench["canonicalRelationships"]>[number];
type SourceRow = ReturnType<Workbench["sourceInventory"]>[number];
type DatasetRow = ReturnType<Workbench["datasets"]>[number];
type LegalRefRow = ReturnType<Workbench["legalRefs"]>[number];
type EntityLegalRefRow = ReturnType<Workbench["entityLegalRefs"]>[number];
type RelationshipLegalRefRow = ReturnType<Workbench["relationshipLegalRefs"]>[number];
type SourceArtifactRow = ReturnType<Workbench["sourceArtifacts"]>[number];

interface EntitySourceReferenceRow {
  entity_id: string;
  entity_name: string;
  source_id: string;
  source_name: string;
  source_item_label: string;
  source_field: string;
  observed_value: string;
  public_url: string;
  artifact_hash: string;
  note: string;
}

interface RelationshipSourceReferenceRow {
  relationship_id: string;
  relationship_type: string;
  from_entity_id: string;
  from_name: string;
  to_entity_id: string;
  to_name: string;
  source_id: string;
  source_name: string;
  source_item_label: string;
  source_field: string;
  observed_value: string;
  public_url: string;
  artifact_hash: string;
  note: string;
}

interface DatasetSourceReferenceRow {
  dataset_id: string;
  source_id: string;
  source_name: string;
}

export interface BuildReleaseOptions {
  sourceProfile?: SmokeProfile | "custom";
  repoRoot?: string;
  gitCommit?: string;
  toolVersion?: string;
  onProgress?: (event: ReleaseBuildProgressEvent) => void;
}

export interface ReleaseBuildProgressEvent {
  phase:
    | "prepare"
    | "read-workbench"
    | "summarize"
    | "write-files"
    | "write-sqlite"
    | "write-manifest";
  message: string;
  counts?: Partial<
    Record<"entities" | "relationships" | "sources" | "datasets" | "legalRefs", number>
  >;
  fileCount?: number;
}

export interface ReleaseFileDescription {
  name: string;
  description: string;
}

export const RELEASE_FILE_DESCRIPTIONS: readonly ReleaseFileDescription[] = [
  { name: "README.md", description: "package overview and package counts" },
  {
    name: "manifest.json",
    description: "package metadata, file hashes, and source artifact inventory",
  },
  { name: "dcgov.sqlite", description: "full queryable release database" },
  { name: "01_sources_and_portals.csv", description: "source and portal inventory" },
  { name: "02_public_datasets.csv", description: "public administrative dataset inventory" },
  { name: "03_legal_authorities.csv", description: "source-backed legal authorities" },
  { name: "entities/all_entities.csv", description: "human-readable entity directory" },
  {
    name: "entities/elected_and_seats.csv",
    description: "elected officials, public role observations, and seats",
  },
  { name: "entities/agencies_and_offices.csv", description: "agencies, offices, and departments" },
  {
    name: "entities/boards_commissions_public_bodies.csv",
    description: "public bodies, boards, and commissions",
  },
  {
    name: "entities/council_committees.csv",
    description: "council committees and related committee bodies",
  },
  { name: "entities/courts_and_legal_bodies.csv", description: "courts and legal bodies" },
  { name: "entities/wards_ancs_smds.csv", description: "wards, ANCs, and SMDs" },
  {
    name: "entities/roles_statuses_observations.csv",
    description: "role, status, and observation marker entities",
  },
  {
    name: "relationships/all_relationships.csv",
    description: "directed relationships with endpoint names",
  },
  { name: "relationships/structure_relationships.csv", description: "structure relationships" },
  {
    name: "relationships/authority_relationships.csv",
    description: "authority, oversight, appointment, and source relationships",
  },
  {
    name: "relationships/representation_membership_relationships.csv",
    description: "representation, membership, and civic role relationships",
  },
  { name: "references/entity_sources.csv", description: "entity source references" },
  { name: "references/relationship_sources.csv", description: "relationship source references" },
  {
    name: "references/entity_legal_authorities.csv",
    description: "entity-linked legal authority attachments",
  },
  {
    name: "references/relationship_legal_authorities.csv",
    description: "relationship-linked legal authority attachments",
  },
];
export const RELEASE_FILE_NAMES: readonly string[] = RELEASE_FILE_DESCRIPTIONS.map((file) =>
  file.name
);

export async function buildV2Release(
  workbench: Workbench,
  outDir: string,
  options: BuildReleaseOptions = {},
): Promise<{ outDir: string; fileNames: string[] }> {
  emitReleaseProgress(options, {
    phase: "prepare",
    message: `Preparing release directory ${outDir}`,
  });
  await resetReleaseDirectory(outDir);
  emitReleaseProgress(options, {
    phase: "read-workbench",
    message: "Reading accepted release rows",
  });
  const allEntities: EntityRow[] = workbench.canonicalEntities();
  const entities: EntityRow[] = acceptedReleaseEntities(allEntities);
  const releaseEntityIds = new Set(entities.map((row) => row.id));
  const knownEntityIds = new Set(allEntities.map((row) => row.id));
  const relationships: RelationshipRow[] = acceptedReleaseRelationships(
    workbench.canonicalRelationships(),
    releaseEntityIds,
    knownEntityIds,
  );
  const releaseRelationshipIds = new Set(relationships.map((row) => row.id));
  const sources: SourceRow[] = workbench.sourceInventory();
  const datasets: DatasetRow[] = workbench.datasets();
  const legalRefs: LegalRefRow[] = acceptedReleaseLegalRefs(workbench.legalRefs());
  const legalRefIds = new Set(legalRefs.map((row) => row.id));
  const entityLegalRefs: EntityLegalRefRow[] = acceptedReleaseLegalAttachments(
    workbench.entityLegalRefs(),
    legalRefIds,
  ).filter((row) => releaseEntityIds.has(row.entity_id));
  const relationshipLegalRefs: RelationshipLegalRefRow[] = acceptedReleaseLegalAttachments(
    workbench.relationshipLegalRefs(),
    legalRefIds,
  ).filter((row) => releaseRelationshipIds.has(row.relationship_id));
  const sourceArtifacts: SourceArtifactRow[] = workbench.sourceArtifacts();
  const entitySourceRefs = releaseEntitySourceReferences(workbench, releaseEntityIds);
  const relationshipSourceRefs = releaseRelationshipSourceReferences(
    workbench,
    releaseRelationshipIds,
  );
  const datasetSourceRefs = releaseDatasetSourceReferences(workbench);
  emitReleaseProgress(options, {
    phase: "summarize",
    message: "Building release summary",
    counts: {
      entities: entities.length,
      relationships: relationships.length,
      sources: sources.length,
      datasets: datasets.length,
      legalRefs: legalRefs.length,
    },
  });
  const summary = buildReleaseSummary(workbench, {
    entities,
    relationships,
    sources,
    datasets,
    legalRefs,
    entityLegalRefs,
    relationshipLegalRefs,
  });
  assertNoContactInfo("release_summary", JSON.stringify(summary));
  const releaseViews = buildHumanReleaseViews({
    entities,
    relationships,
    sources,
    datasets,
    legalRefs,
    entityLegalRefs,
    relationshipLegalRefs,
    entitySourceRefs,
    relationshipSourceRefs,
    datasetSourceRefs,
  });
  const files = new Map<string, string>();
  files.set(
    "01_sources_and_portals.csv",
    toCsv(
      [
        "source_id",
        "source_name",
        "source_group",
        "publisher",
        "public_url",
        "access_method",
        "capture_depth",
        "release_role",
        "dataset_count",
        "entity_count",
        "relationship_count",
        "legal_authority_count",
        "notes",
      ],
      releaseViews.sourcesAndPortals,
    ),
  );
  files.set(
    "02_public_datasets.csv",
    toCsv(
      [
        "dataset_id",
        "name",
        "dataset_group",
        "publisher",
        "source_id",
        "source_name",
        "public_url",
        "access_method",
        "capture_depth",
        "release_note",
      ],
      releaseViews.publicDatasets,
    ),
  );
  files.set(
    "03_legal_authorities.csv",
    toCsv(
      [
        "legal_authority_id",
        "authority_type",
        "law_family",
        "citation_text",
        "normalized_citation",
        "title_or_label",
        "statutory_or_administrative",
        "public_url",
        "source_id",
        "source_name",
        "attached_entity_id",
        "attached_entity_name",
        "attached_relationship_id",
        "review_status",
        "release_note",
      ],
      releaseViews.legalAuthorities,
    ),
  );
  files.set(
    "entities/all_entities.csv",
    toCsv(
      [
        "entity_id",
        "name",
        "entity_group",
        "entity_type",
        "entity_subtype",
        "description",
        "scope",
        "parent_entity_id",
        "parent_entity_name",
        "branch_or_cluster",
        "ward",
        "official_url",
        "primary_source_id",
        "primary_source_name",
        "legal_authority_count",
        "relationship_count",
        "source_count",
        "release_note",
      ],
      releaseViews.entities,
    ),
  );
  for (const view of ENTITY_GROUP_VIEWS) {
    files.set(
      `entities/${view.fileName}`,
      toCsv(
        releaseViews.entityColumns,
        releaseViews.entities.filter((row) => row.entity_group === view.group),
      ),
    );
  }
  files.set(
    "relationships/all_relationships.csv",
    toCsv(
      [
        "relationship_id",
        "relationship_group",
        "relationship_type",
        "from_entity_id",
        "from_name",
        "from_group",
        "from_type",
        "to_entity_id",
        "to_name",
        "to_group",
        "to_type",
        "source_id",
        "source_name",
        "legal_authority_id",
        "release_note",
      ],
      releaseViews.relationships,
    ),
  );
  for (const view of RELATIONSHIP_GROUP_VIEWS) {
    files.set(
      `relationships/${view.fileName}`,
      toCsv(
        releaseViews.relationshipColumns,
        releaseViews.relationships.filter((row) => row.relationship_group === view.group),
      ),
    );
  }
  files.set(
    "references/entity_sources.csv",
    toCsv(
      [
        "entity_id",
        "entity_name",
        "source_id",
        "source_name",
        "source_item_label",
        "source_field",
        "observed_value",
        "public_url",
        "artifact_hash",
        "note",
      ],
      entitySourceRefs,
    ),
  );
  files.set(
    "references/relationship_sources.csv",
    toCsv(
      [
        "relationship_id",
        "relationship_type",
        "from_entity_id",
        "from_name",
        "to_entity_id",
        "to_name",
        "source_id",
        "source_name",
        "source_item_label",
        "source_field",
        "observed_value",
        "public_url",
        "artifact_hash",
        "note",
      ],
      relationshipSourceRefs,
    ),
  );
  files.set(
    "references/entity_legal_authorities.csv",
    toCsv(
      [
        "entity_id",
        "entity_name",
        "legal_authority_id",
        "authority_type",
        "citation_text",
        "normalized_citation",
        "public_url",
        "review_status",
      ],
      releaseViews.entityLegalAuthorities,
    ),
  );
  files.set(
    "references/relationship_legal_authorities.csv",
    toCsv(
      [
        "relationship_id",
        "from_entity_id",
        "from_name",
        "relationship_type",
        "to_entity_id",
        "to_name",
        "legal_authority_id",
        "authority_type",
        "citation_text",
        "normalized_citation",
        "public_url",
        "review_status",
      ],
      releaseViews.relationshipLegalAuthorities,
    ),
  );
  assertReleaseFilesDoNotContainContactInfo(files);
  emitReleaseProgress(options, {
    phase: "write-files",
    message: "Writing CSV and JSON exports",
    fileCount: files.size,
  });
  for (const [name, content] of files) {
    await ensureDir(dirname(join(outDir, name)));
    await Deno.writeTextFile(join(outDir, name), content);
  }
  emitReleaseProgress(options, {
    phase: "write-sqlite",
    message: "Writing dcgov.sqlite",
    counts: {
      entities: entities.length,
      relationships: relationships.length,
      sources: sources.length,
      datasets: datasets.length,
      legalRefs: legalRefs.length,
    },
  });
  await buildReleaseSqlite(join(outDir, "dcgov.sqlite"), {
    entities,
    relationships,
    sources,
    datasets,
    legalRefs,
    entityLegalRefs,
    relationshipLegalRefs,
  });
  emitReleaseProgress(options, {
    phase: "write-manifest",
    message: "Writing README and manifest",
    fileCount: files.size + 3,
  });
  const readme = buildReadme(summary);
  await Deno.writeTextFile(join(outDir, "README.md"), readme);
  const generatedAt = nowIso();
  const gitCommit = options.gitCommit ?? await readGitCommit(options.repoRoot ?? Deno.cwd());
  const sourceProfile = options.sourceProfile ?? "custom";
  const toolVersion = options.toolVersion ?? TOOL_VERSION;
  const manifest = {
    manifest_version: MANIFEST_VERSION,
    release_id: buildReleaseId(generatedAt, gitCommit),
    tool_version: toolVersion,
    git_commit: gitCommit,
    source_profile: sourceProfile,
    schema_version: workbench.meta().schema.version,
    generated_at: generatedAt,
    files: await Promise.all(
      ["README.md", "dcgov.sqlite", ...files.keys()].map(async (name) => ({
        name,
        sha256: await fileSha(join(outDir, name)),
      })),
    ),
    release_summary: summary,
    source_artifacts: sourceArtifacts,
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  assertNoContactInfo("manifest.json", manifestText);
  await Deno.writeTextFile(join(outDir, "manifest.json"), manifestText);
  return {
    outDir,
    fileNames: [...Array.from(manifest.files, (file) => file.name), "manifest.json"],
  };
}

function emitReleaseProgress(
  options: BuildReleaseOptions,
  event: ReleaseBuildProgressEvent,
): void {
  options.onProgress?.(event);
}

const ENTITY_COLUMNS = [
  "entity_id",
  "name",
  "entity_group",
  "entity_type",
  "entity_subtype",
  "description",
  "scope",
  "parent_entity_id",
  "parent_entity_name",
  "branch_or_cluster",
  "ward",
  "official_url",
  "primary_source_id",
  "primary_source_name",
  "legal_authority_count",
  "relationship_count",
  "source_count",
  "release_note",
];

const RELATIONSHIP_COLUMNS = [
  "relationship_id",
  "relationship_group",
  "relationship_type",
  "from_entity_id",
  "from_name",
  "from_group",
  "from_type",
  "to_entity_id",
  "to_name",
  "to_group",
  "to_type",
  "source_id",
  "source_name",
  "legal_authority_id",
  "release_note",
];

const ENTITY_GROUP_VIEWS = [
  { group: "elected_and_seats", fileName: "elected_and_seats.csv" },
  { group: "agency_or_office", fileName: "agencies_and_offices.csv" },
  { group: "board_commission_public_body", fileName: "boards_commissions_public_bodies.csv" },
  { group: "council_committee", fileName: "council_committees.csv" },
  { group: "court_or_legal_body", fileName: "courts_and_legal_bodies.csv" },
  { group: "ward_anc_smd", fileName: "wards_ancs_smds.csv" },
  { group: "role_status_observation", fileName: "roles_statuses_observations.csv" },
] as const;

const RELATIONSHIP_GROUP_VIEWS = [
  { group: "structure", fileName: "structure_relationships.csv" },
  { group: "authority", fileName: "authority_relationships.csv" },
  {
    group: "representation_membership",
    fileName: "representation_membership_relationships.csv",
  },
] as const;

function buildHumanReleaseViews(rows: {
  entities: EntityRow[];
  relationships: RelationshipRow[];
  sources: SourceRow[];
  datasets: DatasetRow[];
  legalRefs: LegalRefRow[];
  entityLegalRefs: EntityLegalRefRow[];
  relationshipLegalRefs: RelationshipLegalRefRow[];
  entitySourceRefs: EntitySourceReferenceRow[];
  relationshipSourceRefs: RelationshipSourceReferenceRow[];
  datasetSourceRefs: DatasetSourceReferenceRow[];
}) {
  const entityById = new Map(rows.entities.map((row) => [row.id, row]));
  const sourceById = new Map(rows.sources.map((row) => [row.source_id, row]));
  const entityGroupById = new Map(rows.entities.map((row) => [row.id, entityGroup(row)]));
  const entitySourcesById = groupBy(rows.entitySourceRefs, (row) => row.entity_id);
  const relationshipSourcesById = groupBy(
    rows.relationshipSourceRefs,
    (row) => row.relationship_id,
  );
  const entityLegalRefsById = groupBy(rows.entityLegalRefs, (row) => row.entity_id);
  const relationshipLegalRefsById = groupBy(
    rows.relationshipLegalRefs,
    (row) => row.relationship_id,
  );
  const relationshipsByEntityId = new Map<string, number>();
  const parentByEntityId = new Map<string, RelationshipRow>();
  for (const relationship of rows.relationships) {
    relationshipsByEntityId.set(
      relationship.from_entity_id,
      (relationshipsByEntityId.get(relationship.from_entity_id) ?? 0) + 1,
    );
    relationshipsByEntityId.set(
      relationship.to_entity_id,
      (relationshipsByEntityId.get(relationship.to_entity_id) ?? 0) + 1,
    );
    if (
      relationship.relationship_type === "part_of" &&
      !parentByEntityId.has(relationship.from_entity_id)
    ) {
      parentByEntityId.set(relationship.from_entity_id, relationship);
    }
  }

  const entities = rows.entities.map((row) => {
    const sourceRefs = entitySourcesById.get(row.id) ?? [];
    const primarySource = sourceRefs[0];
    const parent = parentByEntityId.get(row.id);
    const parentEntity = parent ? entityById.get(parent.to_entity_id) : undefined;
    return {
      entity_id: row.id,
      name: row.name,
      entity_group: entityGroup(row),
      entity_type: row.kind,
      entity_subtype: "",
      description: "",
      scope: row.branch ?? "",
      parent_entity_id: parent?.to_entity_id ?? "",
      parent_entity_name: parentEntity?.name ?? "",
      branch_or_cluster: [row.branch, row.cluster].filter(Boolean).join(" / "),
      ward: inferWard(row),
      official_url: row.official_url ?? "",
      primary_source_id: primarySource?.source_id ?? "",
      primary_source_name: primarySource?.source_name ?? "",
      legal_authority_count: entityLegalRefsById.get(row.id)?.length ?? 0,
      relationship_count: relationshipsByEntityId.get(row.id) ?? 0,
      source_count: sourceRefs.length,
      release_note: releaseNoteForEntity(row),
    };
  });

  const relationships = rows.relationships.map((row) => {
    const from = entityById.get(row.from_entity_id);
    const to = entityById.get(row.to_entity_id);
    const sourceRef = relationshipSourcesById.get(row.id)?.[0];
    return {
      relationship_id: row.id,
      relationship_group: relationshipGroup(row.relationship_type),
      relationship_type: row.relationship_type,
      from_entity_id: row.from_entity_id,
      from_name: from?.name ?? row.from_entity_id,
      from_group: from ? entityGroupById.get(row.from_entity_id) ?? "" : "",
      from_type: from?.kind ?? "",
      to_entity_id: row.to_entity_id,
      to_name: to?.name ?? row.to_entity_id,
      to_group: to ? entityGroupById.get(row.to_entity_id) ?? "" : "",
      to_type: to?.kind ?? "",
      source_id: sourceRef?.source_id ?? "",
      source_name: sourceRef?.source_name ?? "",
      legal_authority_id: relationshipLegalRefsById.get(row.id)?.[0]?.legal_ref_id ?? "",
      release_note: releaseNoteForRelationship(from, to),
    };
  });

  const datasetSourceById = new Map(rows.datasetSourceRefs.map((row) => [row.dataset_id, row]));
  const publicDatasets = rows.datasets.map((row) => {
    const sourceRef = datasetSourceById.get(row.id);
    return {
      dataset_id: row.id,
      name: row.name,
      dataset_group: datasetGroup(row.category),
      publisher: row.owner_name ?? sourceRef?.source_name ?? "",
      source_id: sourceRef?.source_id ?? "",
      source_name: sourceRef?.source_name ?? "",
      public_url: row.official_url ?? "",
      access_method: row.access_method,
      capture_depth: row.artifact_depth,
      release_note: row.review_status === "accepted" ? "" : `review_status=${row.review_status}`,
    };
  });

  const entityAttachmentByLegalId = groupBy(rows.entityLegalRefs, (row) => row.legal_ref_id);
  const relationshipAttachmentByLegalId = groupBy(
    rows.relationshipLegalRefs,
    (row) => row.legal_ref_id,
  );
  const legalAuthorities = rows.legalRefs.map((row) => {
    const source = sourceById.get(row.source_id);
    const entityAttachment = entityAttachmentByLegalId.get(row.id)?.[0];
    const relationshipAttachment = relationshipAttachmentByLegalId.get(row.id)?.[0];
    return {
      legal_authority_id: row.id,
      authority_type: row.ref_type,
      law_family: lawFamily(row.ref_type),
      citation_text: row.citation_text,
      normalized_citation: row.normalized_citation ?? "",
      title_or_label: row.normalized_citation ?? row.citation_text,
      statutory_or_administrative: statutoryOrAdministrative(row.ref_type),
      public_url: row.url ?? "",
      source_id: row.source_id,
      source_name: source?.title ?? row.source_id,
      attached_entity_id: entityAttachment?.entity_id ?? "",
      attached_entity_name: entityAttachment?.entity_name ?? "",
      attached_relationship_id: relationshipAttachment?.relationship_id ?? "",
      review_status: row.review_status,
      release_note: "",
    };
  });

  const sourcesAndPortals = rows.sources.map((row) => ({
    source_id: row.source_id,
    source_name: row.title,
    source_group: row.kind,
    publisher: publisherFromSource(row),
    public_url: row.latest_fetched_url ?? "",
    access_method: row.access_method,
    capture_depth: row.latest_artifact_kind ?? "",
    release_role: "source_or_portal",
    dataset_count: rows.datasetSourceRefs.filter((dataset) => dataset.source_id === row.source_id)
      .length,
    entity_count: rows.entitySourceRefs.filter((ref) => ref.source_id === row.source_id).length,
    relationship_count: rows.relationshipSourceRefs.filter((ref) => ref.source_id === row.source_id)
      .length,
    legal_authority_count: rows.legalRefs.filter((ref) => ref.source_id === row.source_id).length,
    notes: row.latest_status && row.latest_status !== "success"
      ? `latest_status=${row.latest_status}`
      : "",
  }));

  return {
    entityColumns: ENTITY_COLUMNS,
    relationshipColumns: RELATIONSHIP_COLUMNS,
    entities,
    relationships,
    sourcesAndPortals,
    publicDatasets,
    legalAuthorities,
    entityLegalAuthorities: rows.entityLegalRefs.map((row) => ({
      entity_id: row.entity_id,
      entity_name: row.entity_name,
      legal_authority_id: row.legal_ref_id,
      authority_type: row.ref_type,
      citation_text: row.citation_text,
      normalized_citation: row.normalized_citation ?? "",
      public_url: row.url ?? "",
      review_status: row.review_status,
    })),
    relationshipLegalAuthorities: rows.relationshipLegalRefs.map((row) => ({
      relationship_id: row.relationship_id,
      from_entity_id: row.from_entity_id,
      from_name: row.from_entity_name,
      relationship_type: row.relationship_type,
      to_entity_id: row.to_entity_id,
      to_name: row.to_entity_name,
      legal_authority_id: row.legal_ref_id,
      authority_type: row.ref_type,
      citation_text: row.citation_text,
      normalized_citation: row.normalized_citation ?? "",
      public_url: row.url ?? "",
      review_status: row.review_status,
    })),
  };
}

function releaseEntitySourceReferences(
  workbench: Workbench,
  releaseEntityIds: ReadonlySet<string>,
): EntitySourceReferenceRow[] {
  const rows = workbench.db.prepare(
    `select
       canonical_entities.entity_id as entity_id,
       canonical_entities.name as entity_name,
       sources.source_id as source_id,
       sources.title as source_name,
       source_items.title as source_item_label,
       coalesce(entity_candidate_evidence.field_path, 'entity_candidate.name') as source_field,
       coalesce(entity_candidate_evidence.observed_value, entity_candidates.name) as observed_value,
       coalesce(entity_candidates.official_url, source_artifacts.fetched_url) as public_url,
       source_artifacts.content_hash as artifact_hash
     from canonical_entities
     join json_each(canonical_entities.merged_candidate_ids) as merged_candidate
     join entity_candidates on entity_candidates.candidate_id = merged_candidate.value
     join source_items on source_items.source_item_id = entity_candidates.source_item_id
     join sources on sources.source_id = source_items.source_id
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     left join entity_candidate_evidence
       on entity_candidate_evidence.candidate_id = entity_candidates.candidate_id
     order by canonical_entities.name, sources.title, source_items.title, source_field`,
  ).all() as Array<Omit<EntitySourceReferenceRow, "note">>;
  return rows.filter((row) => releaseEntityIds.has(row.entity_id)).map((row) => ({
    ...row,
    note: "",
  }));
}

function releaseRelationshipSourceReferences(
  workbench: Workbench,
  releaseRelationshipIds: ReadonlySet<string>,
): RelationshipSourceReferenceRow[] {
  const rows = workbench.db.prepare(
    `select
       canonical_relationships.relationship_id as relationship_id,
       canonical_relationships.relationship_type as relationship_type,
       canonical_relationships.from_entity_id as from_entity_id,
       from_entities.name as from_name,
       canonical_relationships.to_entity_id as to_entity_id,
       to_entities.name as to_name,
       sources.source_id as source_id,
       sources.title as source_name,
       source_items.title as source_item_label,
       coalesce(relationship_candidate_evidence.field_path, 'relationship_candidate.raw_value') as source_field,
       coalesce(relationship_candidate_evidence.observed_value, relationship_candidates.raw_value, relationship_candidates.to_entity_ref) as observed_value,
       source_artifacts.fetched_url as public_url,
       source_artifacts.content_hash as artifact_hash
     from canonical_relationships
     join canonical_entities as from_entities
       on from_entities.entity_id = canonical_relationships.from_entity_id
     join canonical_entities as to_entities
       on to_entities.entity_id = canonical_relationships.to_entity_id
     join resolution_events
       on resolution_events.event_id = canonical_relationships.source_event_id
     join relationship_candidates
       on relationship_candidates.relationship_candidate_id = resolution_events.subject_id
     join source_items on source_items.source_item_id = relationship_candidates.source_item_id
     join sources on sources.source_id = source_items.source_id
     join source_artifacts on source_artifacts.artifact_id = source_items.artifact_id
     left join relationship_candidate_evidence
       on relationship_candidate_evidence.relationship_candidate_id =
          relationship_candidates.relationship_candidate_id
     order by from_entities.name, canonical_relationships.relationship_type, to_entities.name, sources.title`,
  ).all() as Array<Omit<RelationshipSourceReferenceRow, "note">>;
  return rows.filter((row) => releaseRelationshipIds.has(row.relationship_id)).map((row) => ({
    ...row,
    note: "",
  }));
}

function releaseDatasetSourceReferences(workbench: Workbench): DatasetSourceReferenceRow[] {
  return workbench.db.prepare(
    `select
       datasets.dataset_id as dataset_id,
       sources.source_id as source_id,
       sources.title as source_name
     from datasets
     join source_items on source_items.source_item_id = datasets.source_item_id
     join sources on sources.source_id = source_items.source_id
     order by datasets.name`,
  ).all() as DatasetSourceReferenceRow[];
}

function entityGroup(row: EntityRow): string {
  const kind = row.kind.toLowerCase();
  if (["council_role", "seat", "elected_official", "elected", "officeholder"].includes(kind)) {
    return "elected_and_seats";
  }
  if (["agency", "office", "mayor", "council", "branch"].includes(kind)) {
    return "agency_or_office";
  }
  if (["board", "commission", "public_body", "advisory_body", "working_group"].includes(kind)) {
    return "board_commission_public_body";
  }
  if (["committee", "council_committee"].includes(kind)) return "council_committee";
  if (["court", "legal_body"].includes(kind)) return "court_or_legal_body";
  if (["ward", "anc", "smd", "district", "single_member_district"].includes(kind)) {
    return "ward_anc_smd";
  }
  return "role_status_observation";
}

function relationshipGroup(relationshipType: string): string {
  if (["part_of", "has_seat", "has_status"].includes(relationshipType)) return "structure";
  if (
    [
      "governed_by",
      "overseen_by",
      "appointed_by",
      "designated_by",
      "authorized_by",
      "published_by",
    ].includes(relationshipType)
  ) return "authority";
  if (["holds", "represents", "member_of", "chairs"].includes(relationshipType)) {
    return "representation_membership";
  }
  return "role_observation";
}

function datasetGroup(category: string): string {
  const normalized = category.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(
    /^_|_$/g,
    "",
  );
  if (normalized.includes("budget")) return "budget";
  if (normalized.includes("permit")) return "permits";
  if (normalized.includes("crime") || normalized.includes("safety")) return "crime_public_safety";
  if (normalized.includes("legislative") || normalized.includes("lims")) return "legislative";
  if (normalized.includes("procurement") || normalized.includes("contract")) return "procurement";
  if (normalized.includes("property") || normalized.includes("land")) return "property_land";
  if (normalized.includes("311") || normalized.includes("service_request")) {
    return "service_requests_311";
  }
  if (normalized.includes("election")) return "elections";
  return normalized || "general_inventory";
}

function lawFamily(refType: string): string {
  switch (refType) {
    case "dc_code":
      return "D.C. Code";
    case "dcmr":
      return "DCMR";
    case "dc_register":
      return "D.C. Register";
    case "mayors_order":
      return "Mayor's Order";
    case "dc_law":
      return "D.C. Law";
    case "dc_act":
      return "D.C. Act";
    case "dc_bill":
      return "D.C. Bill";
    case "us_code":
      return "U.S. Code";
    case "public_law":
      return "Public Law";
    case "reorganization_plan":
      return "Reorganization Plan";
    default:
      return "unknown";
  }
}

function statutoryOrAdministrative(refType: string): string {
  if (["dc_code", "dc_law", "dc_act", "us_code", "public_law"].includes(refType)) {
    return "statutory";
  }
  if (["dcmr", "dc_register", "mayors_order"].includes(refType)) return "administrative";
  if (refType === "reorganization_plan") return "organizational";
  return "unknown";
}

function publisherFromSource(row: SourceRow): string {
  if (row.source_id.startsWith("council.") || /council/i.test(row.title)) {
    return "Council of the District of Columbia";
  }
  if (row.source_id.startsWith("open_dc.")) return "Open DC";
  if (row.source_id.startsWith("dcgis.")) return "DCGIS";
  return "";
}

function inferWard(row: EntityRow): string {
  const match = `${row.id} ${row.name}`.match(/\bward[_\s-]*(\d+)\b/i);
  return match?.[1] ?? "";
}

function releaseNoteForEntity(row: EntityRow): string {
  return entityGroup(row) === "role_status_observation"
    ? "Grouped separately because this row is a role, status, or source-backed observation rather than a public body."
    : "";
}

function releaseNoteForRelationship(
  from: EntityRow | undefined,
  to: EntityRow | undefined,
): string {
  if (from && to) return "";
  return "Relationship endpoint was not present in the public entity directory.";
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    grouped.set(value, [...(grouped.get(value) ?? []), row]);
  }
  return grouped;
}

export function acceptedReleaseLegalRefs<T extends { review_status: string; ref_type: string }>(
  rows: T[],
): T[] {
  return rows.filter((row) => row.review_status === "accepted" && row.ref_type !== "unknown");
}

export function acceptedReleaseEntities<
  T extends {
    review_status: string;
    kind: string;
    name: string;
    official_url?: string | null;
  },
>(rows: T[]): T[] {
  return rows.filter((row) =>
    row.review_status === "accepted" &&
    row.kind !== "budgetary" &&
    !isOpenDcNonBodyReleaseEntity(row)
  );
}

export function acceptedReleaseRelationships<
  T extends { review_status: string; from_entity_id: string; to_entity_id: string },
>(
  rows: T[],
  releaseEntityIds: ReadonlySet<string>,
  knownEntityIds?: ReadonlySet<string>,
): T[] {
  return rows.filter((row) =>
    row.review_status === "accepted" &&
    releaseRelationshipEndpointIsEligible(row.from_entity_id, releaseEntityIds, knownEntityIds) &&
    releaseRelationshipEndpointIsEligible(row.to_entity_id, releaseEntityIds, knownEntityIds)
  );
}

function releaseRelationshipEndpointIsEligible(
  entityId: string,
  releaseEntityIds: ReadonlySet<string>,
  knownEntityIds?: ReadonlySet<string>,
): boolean {
  return releaseEntityIds.has(entityId) || !(knownEntityIds?.has(entityId) ?? true);
}

function isOpenDcNonBodyReleaseEntity(
  row: { name: string; official_url?: string | null },
): boolean {
  if (
    row.official_url?.match(
      /^https:\/\/www\.open-dc\.gov\/public-bodies\/.*(?:-recess|-duplicate)(?:[/?#]|$)/i,
    )
  ) {
    return true;
  }
  if (
    row.official_url?.match(/^https:\/\/www\.open-dc\.gov\/public-bodies\//i) &&
    /\b(?:will|shall)\s+be\b/i.test(row.name)
  ) {
    return true;
  }
  return false;
}

export function acceptedReleaseLegalAttachments<
  T extends { legal_ref_id: string; review_status: string },
>(
  rows: T[],
  acceptedLegalRefIds: ReadonlySet<string>,
): T[] {
  return rows.filter((row) =>
    row.review_status === "accepted" && acceptedLegalRefIds.has(row.legal_ref_id)
  );
}

function buildReleaseId(generatedAt: string, gitCommit: string): string {
  const timestamp = generatedAt.replaceAll(/[^0-9]/g, "").slice(0, 14);
  const shortCommit = gitCommit === "unknown" ? "unknown" : gitCommit.slice(0, 12);
  return `release.${timestamp}.${shortCommit}`;
}

async function resetReleaseDirectory(outDir: string): Promise<void> {
  await Deno.remove(outDir, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await ensureDir(outDir);
}

function assertReleaseFilesDoNotContainContactInfo(files: Map<string, string>): void {
  for (const [name, content] of files) {
    assertNoContactInfo(name, content);
  }
}

function assertNoContactInfo(name: string, content: string): void {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(content)) {
    throw new Error(`Release output contains email-shaped contact info in ${name}`);
  }
  if (/\b(?:tel:)?(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/i.test(content)) {
    throw new Error(`Release output contains phone-shaped contact info in ${name}`);
  }
  if (containsLocalPath(content)) {
    throw new Error(`Release output contains local path-shaped info in ${name}`);
  }
}

async function buildReleaseSqlite(
  path: string,
  rows: {
    entities: EntityRow[];
    relationships: RelationshipRow[];
    sources: SourceRow[];
    datasets: DatasetRow[];
    legalRefs: LegalRefRow[];
    entityLegalRefs: EntityLegalRefRow[];
    relationshipLegalRefs: RelationshipLegalRefRow[];
  },
): Promise<void> {
  await Deno.remove(path).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  const db = new Database(path);
  try {
    db.exec(`
      pragma foreign_keys = on;

      create table entities (
        id text primary key,
        name text not null,
        kind text not null,
        branch text,
        cluster text,
        official_url text,
        review_status text not null
      );

      create table relationships (
        id text primary key,
        from_entity_id text not null,
        relationship_type text not null,
        to_entity_id text not null,
        review_status text not null,
        foreign key (from_entity_id) references entities(id),
        foreign key (to_entity_id) references entities(id)
      );

      create view incoming_relationships as
        select
          relationships.to_entity_id as entity_id,
          relationships.relationship_type as relationship_type,
          relationships.from_entity_id as source_entity_id,
          entities.name as source_name,
          relationships.review_status as review_status
        from relationships
        left join entities on entities.id = relationships.from_entity_id;

      create table sources (
        source_id text primary key,
        title text not null,
        kind text not null,
        access_method text not null,
        latest_status text,
        latest_run_finished_at text,
        latest_endpoint_id text,
        latest_artifact_kind text,
        latest_fetched_url text,
        latest_content_hash text,
        latest_size_bytes integer,
        latest_observed_at text
      );

      create table datasets (
        id text primary key,
        name text not null,
        category text not null,
        owner_name text,
        access_method text not null,
        artifact_depth text not null,
        official_url text,
        review_status text not null
      );

      create table legal_refs (
        id text primary key,
        ref_type text not null,
        citation_text text not null,
        normalized_citation text,
        url text,
        source_id text not null,
        source_item_id text not null,
        source_url text,
        needs_review integer not null,
        review_status text not null
      );

      create table entity_legal_refs (
        entity_id text not null,
        entity_name text not null,
        legal_ref_id text not null,
        ref_type text not null,
        citation_text text not null,
        normalized_citation text,
        url text,
        review_status text not null,
        foreign key (entity_id) references entities(id),
        foreign key (legal_ref_id) references legal_refs(id)
      );

      create table relationship_legal_refs (
        relationship_id text not null,
        from_entity_id text not null,
        from_entity_name text not null,
        relationship_type text not null,
        to_entity_id text not null,
        to_entity_name text not null,
        legal_ref_id text not null,
        ref_type text not null,
        citation_text text not null,
        normalized_citation text,
        url text,
        review_status text not null,
        foreign key (relationship_id) references relationships(id),
        foreign key (from_entity_id) references entities(id),
        foreign key (to_entity_id) references entities(id),
        foreign key (legal_ref_id) references legal_refs(id)
      );
    `);
    withTransaction(db, () => {
      const insertEntity = db.prepare(
        "insert into entities(id, name, kind, branch, cluster, official_url, review_status) values(?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of rows.entities) {
        insertEntity.run([
          row.id,
          row.name,
          row.kind,
          row.branch ?? null,
          row.cluster ?? null,
          row.official_url ?? null,
          row.review_status,
        ]);
      }
      const insertRelationship = db.prepare(
        "insert into relationships(id, from_entity_id, relationship_type, to_entity_id, review_status) values(?, ?, ?, ?, ?)",
      );
      for (const row of rows.relationships) {
        insertRelationship.run([
          row.id,
          row.from_entity_id,
          row.relationship_type,
          row.to_entity_id,
          row.review_status,
        ]);
      }
      const insertSource = db.prepare(
        "insert into sources(source_id, title, kind, access_method, latest_status, latest_run_finished_at, latest_endpoint_id, latest_artifact_kind, latest_fetched_url, latest_content_hash, latest_size_bytes, latest_observed_at) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of rows.sources) {
        insertSource.run([
          row.source_id,
          row.title,
          row.kind,
          row.access_method,
          row.latest_status ?? null,
          row.latest_run_finished_at ?? null,
          row.latest_endpoint_id ?? null,
          row.latest_artifact_kind ?? null,
          row.latest_fetched_url ?? null,
          row.latest_content_hash ?? null,
          row.latest_size_bytes ?? null,
          row.latest_observed_at ?? null,
        ]);
      }
      const insertDataset = db.prepare(
        "insert into datasets(id, name, category, owner_name, access_method, artifact_depth, official_url, review_status) values(?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of rows.datasets) {
        insertDataset.run([
          row.id,
          row.name,
          row.category,
          row.owner_name ?? null,
          row.access_method,
          row.artifact_depth,
          row.official_url ?? null,
          row.review_status,
        ]);
      }
      const insertLegalRef = db.prepare(
        "insert into legal_refs(id, ref_type, citation_text, normalized_citation, url, source_id, source_item_id, source_url, needs_review, review_status) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of rows.legalRefs) {
        insertLegalRef.run([
          row.id,
          row.ref_type,
          row.citation_text,
          row.normalized_citation ?? null,
          row.url ?? null,
          row.source_id,
          row.source_item_id,
          row.source_url ?? null,
          row.needs_review,
          row.review_status,
        ]);
      }
      const insertEntityLegalRef = db.prepare(
        "insert into entity_legal_refs(entity_id, entity_name, legal_ref_id, ref_type, citation_text, normalized_citation, url, review_status) values(?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of rows.entityLegalRefs) {
        insertEntityLegalRef.run([
          row.entity_id,
          row.entity_name,
          row.legal_ref_id,
          row.ref_type,
          row.citation_text,
          row.normalized_citation ?? null,
          row.url ?? null,
          row.review_status,
        ]);
      }
      const insertRelationshipLegalRef = db.prepare(
        "insert into relationship_legal_refs(relationship_id, from_entity_id, from_entity_name, relationship_type, to_entity_id, to_entity_name, legal_ref_id, ref_type, citation_text, normalized_citation, url, review_status) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const row of rows.relationshipLegalRefs) {
        insertRelationshipLegalRef.run([
          row.relationship_id,
          row.from_entity_id,
          row.from_entity_name,
          row.relationship_type,
          row.to_entity_id,
          row.to_entity_name,
          row.legal_ref_id,
          row.ref_type,
          row.citation_text,
          row.normalized_citation ?? null,
          row.url ?? null,
          row.review_status,
        ]);
      }
    });
  } finally {
    db.close();
  }
}

function buildReadme(summary: ReleaseSummary): string {
  const legalByType =
    summary.legal_refs_by_type.map((item) => `${item.ref_type}=${item.count}`).join(", ") || "none";
  const releaseFiles = RELEASE_FILE_DESCRIPTIONS
    .map((file) => `- \`${file.name}\`: ${file.description}`)
    .join("\n");
  return `# DCGov Release

This release contains grouped CSV views for DC civic structure, public source and dataset inventory, legal authorities, provenance references, and a queryable SQLite database.

Files:
${releaseFiles}

## Model semantics

CSV files are human-facing grouped views; \`dcgov.sqlite\` is the full queryable package.

Public official observations are source-backed role or seat observations, not a personnel or contact directory.

\`relationships/all_relationships.csv\`: one directed fact per row, with endpoint names and groups. Incoming/backlink views are derived from that directed row.

Relationship families: structure (\`part_of\`, \`has_seat\`, \`has_status\`), authority/source (\`governed_by\`, \`overseen_by\`, \`appointed_by\`, \`designated_by\`, \`authorized_by\`, \`published_by\`), and civic role (\`holds\`, \`represents\`, \`member_of\`, \`chairs\`).

Relationship direction guide: \`part_of\` points from a component to its containing entity; \`has_seat\`/\`has_status\` point from a body, seat, or observation to the seat/status marker; authority/source types point from the civic subject to the governing, oversight, appointment, designation, legal-authority, or publication source; civic-role types point from an observation or role entity to the seat, district, body, or committee role.

DC city/county distinctions are not inferred beyond source-backed civic structure labels.

## Package counts

- entities: total=${totalReviewStatusCount(summary.entities_by_review_status)}
- relationships: total=${totalReviewStatusCount(summary.relationships_by_review_status)}
- sources: total=${summary.source_count}
- datasets: total=${summary.dataset_count}
- legal refs: total=${totalReviewStatusCount(summary.legal_refs_by_review_status)}
- legal refs by type: ${legalByType}
- entity legal refs: total=${summary.entity_legal_refs_count}
- relationship legal refs: total=${summary.relationship_legal_refs_count}
`;
}

function totalReviewStatusCount(rows: Array<{ count: number }>): number {
  return rows.reduce((total, row) => total + row.count, 0);
}

function toCsv<T extends object>(
  columns: string[],
  rows: T[],
): string {
  const header = columns.join(",");
  const lines = rows.map((row) => {
    const values = row as Record<string, unknown>;
    return columns.map((column) => escapeCsv(values[column])).join(",");
  });
  return `${[header, ...lines].join("\n")}\n`;
}

function escapeCsv(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

async function fileSha(path: string): Promise<string> {
  return `sha256:${await sha256BytesHex(await Deno.readFile(path))}`;
}
