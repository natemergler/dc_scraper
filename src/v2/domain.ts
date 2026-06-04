export type ArtifactKind =
  | "page"
  | "schema"
  | "sample"
  | "rows"
  | "documents"
  | "text"
  | "json";

export type ReviewItemType =
  | "entity_candidate"
  | "relationship_candidate"
  | "legal_ref"
  | "dataset"
  | "source_status"
  | "placeholder_entity";

export type SourceTier = "tier0" | "tier1" | "tier2" | "tier3";
export type SourceReleaseRole =
  | "structure"
  | "public_body"
  | "legal"
  | "appointments"
  | "inventory";
export type SmokeProfile = "structure" | "tier0" | "inventory";

export type ReviewStatus = "open" | "resolved" | "deferred";
export type CandidateStatus = "pending" | "accepted" | "rejected";
export type RelationshipType =
  | "part_of"
  | "has_seat"
  | "has_status"
  | "governed_by"
  | "overseen_by"
  | "appointed_by"
  | "designated_by"
  | "authorized_by"
  | "published_by"
  | "holds"
  | "represents"
  | "member_of"
  | "chairs";

export interface WorkbenchMeta {
  dbPath: string;
  schemaVersion: number;
  schemaMarkers: Array<{ version: number; name: string; appliedAt: string }>;
}

export interface SourceDefinition {
  sourceId: string;
  title: string;
  kind: string;
  accessMethod: string;
  baseUrl: string;
  notes?: string;
  tier?: SourceTier;
  releaseRole?: SourceReleaseRole;
  smokeProfiles?: SmokeProfile[];
  privacyNotes?: string[];
}

export interface SourceEndpointDefinition {
  endpointId: string;
  sourceId: string;
  title: string;
  kind: string;
  url: string;
  method: string;
  captureMode: string;
}

export interface SourceFieldInput {
  fieldName: string;
  fieldType: string;
  fieldLabel?: string;
  ordinal: number;
  artifactIndex?: number;
}

export interface SourceItemInput {
  itemKey: string;
  itemType: string;
  title: string;
  body: Record<string, unknown>;
  artifactIndex?: number;
}

export interface EvidenceInput {
  fieldPath: string;
  observedValue: string;
  artifactIndex?: number;
}

export interface EntityCandidateInput {
  candidateId: string;
  sourceItemKey: string;
  proposedEntityId: string;
  name: string;
  kind: string;
  rawKind?: string;
  branch?: string;
  cluster?: string;
  officialUrl?: string;
  confidence?: number;
  duplicateHint?: string;
  safeToAutoAccept?: boolean;
  evidence: EvidenceInput[];
}

export interface RelationshipCandidateInput {
  relationshipCandidateId: string;
  sourceItemKey: string;
  fromEntityRef: string;
  toEntityRef: string;
  fromEntityName?: string;
  toEntityName?: string;
  toEntitySafeToAutoAccept?: boolean;
  relationshipType: RelationshipType;
  rawValue?: string;
  needsReview?: boolean;
  evidence: EvidenceInput[];
}

export interface LegalRefInput {
  legalRefId: string;
  sourceItemKey: string;
  refType: string;
  citationText: string;
  normalizedCitation?: string;
  url?: string;
  needsReview?: boolean;
  evidence: EvidenceInput[];
  attachEntityRef?: string;
  attachRelationshipRef?: string;
}

export interface DatasetInput {
  datasetId: string;
  sourceItemKey: string;
  name: string;
  category: string;
  ownerName?: string;
  accessMethod: string;
  artifactDepth: string;
  officialUrl?: string;
  evidence: EvidenceInput[];
}

export interface ReviewItemInput {
  reviewItemId: string;
  itemType: ReviewItemType;
  subjectId: string;
  reason: string;
  defaultAction: string;
  details: Record<string, unknown>;
}

export interface ParsedEndpointOutput {
  fields?: SourceFieldInput[];
  items?: SourceItemInput[];
  entityCandidates?: EntityCandidateInput[];
  relationshipCandidates?: RelationshipCandidateInput[];
  legalRefs?: LegalRefInput[];
  datasets?: DatasetInput[];
  reviewItems?: ReviewItemInput[];
}

export interface ArtifactCaptureInput {
  kind: ArtifactKind;
  extension: string;
  contentText: string;
  fetchedUrl: string;
}

export interface ConnectorEndpointResult {
  endpoint: SourceEndpointDefinition;
  status: "success" | "failed";
  errorText?: string;
  artifacts: ArtifactCaptureInput[];
  parsed?: ParsedEndpointOutput;
}

export interface ConnectorResult {
  source: SourceDefinition;
  endpointResults: ConnectorEndpointResult[];
}

export interface ResolutionEventInput {
  eventType:
    | "accept_entity_candidate"
    | "reject_entity_candidate"
    | "merge_entity_candidates"
    | "set_entity_fields"
    | "accept_relationship_candidate"
    | "reject_relationship_candidate"
    | "accept_legal_ref"
    | "reject_legal_ref"
    | "defer_review_item"
    | "reopen_review_item";
  subjectId: string;
  payload: Record<string, unknown>;
}

export interface ReviewItemRecord {
  reviewItemId: string;
  itemType: ReviewItemType;
  subjectId: string;
  reason: string;
  defaultAction: string;
  status: ReviewStatus;
  details: Record<string, unknown>;
}

export interface EntitySearchResult {
  entityId: string;
  name: string;
  kind: string;
  reviewStatus: string;
  isPlaceholder?: number;
}

export interface EntityView {
  entityId: string;
  name: string;
  kind: string;
  branch?: string;
  cluster?: string;
  officialUrl?: string;
  reviewStatus: string;
  isPlaceholder?: number;
  placeholderReason?: string;
  evidence: Array<{
    fieldPath: string;
    observedValue: string;
    sourceId: string;
    sourceItemId: string;
    artifactPath: string;
  }>;
  outgoing: Array<{ relationshipType: string; targetEntityId: string; targetName: string }>;
  incoming: Array<{ relationshipType: string; sourceEntityId: string; sourceName: string }>;
  reviewItems: ReviewItemRecord[];
  legalRefs: Array<{ citationText: string; normalizedCitation?: string; refType: string }>;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/&/g, " and ")
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .replaceAll(/_+/g, "_");
}

export function normalizeName(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

export function buildEntityId(name: string, prefix = "dc"): string {
  return `${prefix}.${slugify(name)}`;
}

export function buildCandidateId(sourceId: string, rawKey: string): string {
  return `candidate.${sourceId}.${slugify(rawKey)}`;
}

export function buildRelationshipCandidateId(sourceId: string, rawKey: string): string {
  return `relationship.${sourceId}.${slugify(rawKey)}`;
}

export function buildLegalRefId(sourceId: string, rawKey: string): string {
  return `legal.${sourceId}.${slugify(rawKey)}`;
}

export function buildDatasetId(sourceId: string, rawKey: string): string {
  return `dataset.${sourceId}.${slugify(rawKey)}`;
}

export function buildReviewItemId(subjectId: string, suffix: string): string {
  return `review.${slugify(subjectId)}.${slugify(suffix)}`;
}

export function detectEntityKind(rawKind?: string, name?: string): string {
  const value = `${rawKind ?? ""} ${name ?? ""}`.toLowerCase();
  if (value.includes("committee")) return "committee";
  if (value.includes("board")) return "board";
  if (value.includes("commission")) return "commission";
  if (value.includes("task force")) return "task_force";
  if (value.includes("council")) return "council";
  if (value.includes("office")) return "office";
  if (value.includes("agency")) return "agency";
  return rawKind ? slugify(rawKind) : "public_body";
}

export function parseLegalReference(
  input: string,
  url?: string,
): { refType: string; citationText: string; normalizedCitation?: string; needsReview: boolean } {
  const text = normalizeName(stripHtml(input));
  const dcCodeMatch = text.match(
    /(?:D\.?\s*C\.?\s*(?:Official\s+)?Code\s*(?:§|section)?|§)\s*([0-9]+[-–—][0-9A-Za-z.\-–—]+(?:\([^)]+\))*)/i,
  );
  if (dcCodeMatch) {
    return {
      refType: "dc_code",
      citationText: text,
      normalizedCitation: `D.C. Code ${normalizeCodeSection(dcCodeMatch[1])}`,
      needsReview: false,
    };
  }
  const dcmrMatch = text.match(
    /(\d+)\s*D\.?\s*C\.?\s*M\.?\s*R\.?\s*(?:§|section)?\s*([0-9A-Za-z.\-]+)/i,
  );
  if (dcmrMatch) {
    return {
      refType: "dcmr",
      citationText: text,
      normalizedCitation: `${dcmrMatch[1]} DCMR ${dcmrMatch[2]}`,
      needsReview: false,
    };
  }
  const mayorMatch = text.match(/Mayor['’]?s?\s+Order\s+([0-9]{4}-[0-9]{2,3})/i);
  if (mayorMatch) {
    return {
      refType: "mayors_order",
      citationText: text,
      normalizedCitation: `Mayor's Order ${mayorMatch[1]}`,
      needsReview: false,
    };
  }
  const dcLawMatch = text.match(/D\.?\s*C\.?\s+Law\s+([0-9]{1,2}-[0-9]{1,4})/i);
  if (dcLawMatch) {
    return {
      refType: "dc_law",
      citationText: text,
      normalizedCitation: `D.C. Law ${dcLawMatch[1]}`,
      needsReview: false,
    };
  }
  const dcActMatch = text.match(/D\.?\s*C\.?\s+Act\s+([0-9]{1,2}-[0-9]{1,4})/i);
  if (dcActMatch) {
    return {
      refType: "dc_act",
      citationText: text,
      normalizedCitation: `D.C. Act ${dcActMatch[1]}`,
      needsReview: false,
    };
  }
  const publicLawMatch = text.match(/Public\s+Law\s+([0-9]{1,3}-[0-9]{1,4})/i);
  if (publicLawMatch) {
    return {
      refType: "public_law",
      citationText: text,
      normalizedCitation: `Public Law ${publicLawMatch[1]}`,
      needsReview: false,
    };
  }
  const reorganizationPlanMatch = text.match(/\b([12][0-9]{3})\s+Plan\s+([0-9]+)\b/i);
  if (reorganizationPlanMatch && !text.includes(";")) {
    return {
      refType: "reorganization_plan",
      citationText: text,
      normalizedCitation: `Reorganization Plan No. ${reorganizationPlanMatch[2]} of ${
        reorganizationPlanMatch[1]
      }`,
      needsReview: false,
    };
  }
  const registerDetailMatch = text.match(/(\d+)\s*D\.?\s*C\.?\s+Register\s+([0-9A-Za-z.\-]+)/i);
  if (registerDetailMatch) {
    return {
      refType: "dc_register",
      citationText: text,
      normalizedCitation: `${registerDetailMatch[1]} D.C. Register ${registerDetailMatch[2]}`,
      needsReview: false,
    };
  }
  if (/Mayor['’]?s?\s+Orders?/i.test(text) || url?.includes("mayor.dc.gov/page/mayors-orders")) {
    return {
      refType: "mayors_order",
      citationText: text,
      normalizedCitation: "Mayor's Orders",
      needsReview: false,
    };
  }
  const registerMatch = text.match(/D\.?\s*C\.?\s+Register|DCMR|Municipal\s+Regulations/i);
  if (registerMatch || url?.includes("dcregs.dc.gov")) {
    const namesDcmr = /DCMR|Municipal\s+Regulations/i.test(text);
    return {
      refType: "dc_register",
      citationText: text,
      normalizedCitation: namesDcmr ? "DCMR and D.C. Register" : "D.C. Register",
      needsReview: false,
    };
  }
  const bareCodeMatch = text.match(/^([0-9]+[-–—][0-9A-Za-z.\-–—]+(?:\([^)]+\))*)\b/i);
  if (bareCodeMatch) {
    return {
      refType: "dc_code",
      citationText: text,
      normalizedCitation: `D.C. Code ${normalizeCodeSection(bareCodeMatch[1])}`,
      needsReview: false,
    };
  }
  if (
    /(?:D\.?\s*C\.?|District\s+of\s+Columbia)\s*(?:Official\s+)?Code/i.test(text) ||
    url?.includes("code.dccouncil") ||
    url?.includes("dccode.org")
  ) {
    return {
      refType: "dc_code",
      citationText: text,
      normalizedCitation: "D.C. Official Code",
      needsReview: false,
    };
  }
  return {
    refType: "unknown",
    citationText: text,
    normalizedCitation: undefined,
    needsReview: true,
  };
}

function normalizeCodeSection(value: string): string {
  return value.replaceAll(/[–—]/g, "-");
}

export function inverseRelationshipType(type: string): string {
  switch (type) {
    case "part_of":
      return "has_part";
    case "has_seat":
      return "seat_on";
    case "has_status":
      return "status_of";
    case "governed_by":
      return "governs";
    case "overseen_by":
      return "oversees";
    case "appointed_by":
      return "appoints";
    case "designated_by":
      return "designates";
    case "authorized_by":
      return "authorizes";
    case "published_by":
      return "publishes";
    case "holds":
      return "held_by";
    case "represents":
      return "represented_by";
    case "member_of":
      return "has_member";
    case "chairs":
      return "chaired_by";
    default:
      return `incoming:${type}`;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function sha256Hex(content: string): Promise<string> {
  return sha256BytesHex(new TextEncoder().encode(content));
}

export async function sha256BytesHex(bytes: Uint8Array): Promise<string> {
  const stableBytes = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes.buffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replaceAll(/<[^>]+>/g, " "));
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&rsquo;", "'")
    .replaceAll("&ndash;", "-")
    .replaceAll("&mdash;", "-")
    .replaceAll("&sect;", "§")
    .replaceAll(/&#([0-9]+);/g, (_, digits) => String.fromCharCode(Number(digits)));
}

export function compactDatePart(value = new Date()): string {
  return value.toISOString().slice(0, 10);
}
