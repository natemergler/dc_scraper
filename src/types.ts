export type RecordType =
  | "source"
  | "legal_material"
  | "civic_unit"
  | "relationship_type"
  | "relationship"
  | "pipeline"
  | "gap";

export type ReleaseCollection =
  | "public_sources"
  | "legal_materials"
  | "civic_units"
  | "relationship_types"
  | "relationships"
  | "update_pipelines"
  | "gaps";

export type Severity = "error" | "warning" | "info";

export interface AnyRecord {
  id: string;
  record_type: RecordType;
  name?: string;
  display_name?: string;
  status?: string;
  source_refs?: string[];
  caveats?: string[];
  release_relevant_caveats?: string[];
  [key: string]: unknown;
}

export interface LoadedRecord {
  path: string;
  relativePath: string;
  expectedRelativePath: string;
  record: AnyRecord;
}

export interface Check {
  id: string;
  kind: string;
  severity: Severity;
  message: string;
  record_id?: string;
  path?: string;
  release_relevant?: boolean;
  suppressed?: boolean;
  suppression_reason?: string;
}

export interface ChecksSummary {
  errors: number;
  warnings: number;
  info: number;
  suppressed: number;
  unsuppressed_errors: number;
}

export interface BuildReleaseOptions {
  releaseId?: string;
  blockOnErrors?: boolean;
}

export interface BuildReleaseResult {
  releaseId: string;
  releasePath: string;
  recordCounts: Record<ReleaseCollection, number>;
  checksSummary: ChecksSummary;
  files: string[];
}

export const recordFolders: Record<RecordType, string> = {
  source: "sources",
  legal_material: "legal_materials",
  civic_unit: "units",
  relationship_type: "relationship_types",
  relationship: "relationships",
  pipeline: "pipelines",
  gap: "gaps",
};

export const releaseCollections: Record<ReleaseCollection, RecordType> = {
  public_sources: "source",
  legal_materials: "legal_material",
  civic_units: "civic_unit",
  relationship_types: "relationship_type",
  relationships: "relationship",
  update_pipelines: "pipeline",
  gaps: "gap",
};

export function isRecordType(value: unknown): value is RecordType {
  return typeof value === "string" && value in recordFolders;
}
