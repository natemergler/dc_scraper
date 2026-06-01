import {
  type ArtifactCaptureInput,
  buildEntityId,
  buildReviewItemId,
  type ConnectorResult,
  decodeHtmlEntities,
  normalizeName,
  type SourceDefinition,
} from "../domain.ts";

export type { ConnectorResult } from "../domain.ts";

export interface ConnectorFetchResponse {
  status: number;
  text(): Promise<string>;
  json<T>(): Promise<T>;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<ConnectorFetchResponse>;

export interface ConnectorContext {
  fetcher: Fetcher;
  limit?: number;
}

export interface SourceConnector {
  sourceId: string;
  source: SourceDefinition;
  run(context: ConnectorContext): Promise<ConnectorResult>;
}

export function defaultFetcher(
  url: string,
  init?: RequestInit,
): Promise<ConnectorFetchResponse> {
  return fetch(url, init) as Promise<ConnectorFetchResponse>;
}

export function artifact(
  kind: ArtifactCaptureInput["kind"],
  extension: string,
  fetchedUrl: string,
  contentText: string,
): ArtifactCaptureInput {
  return { kind, extension, fetchedUrl, contentText };
}

export function fieldEvidence(path: string, value: unknown, artifactIndex?: number) {
  return {
    fieldPath: path,
    observedValue: String(value ?? ""),
    ...(artifactIndex === undefined ? {} : { artifactIndex }),
  };
}

export function buildCandidateReviewItem(
  subjectId: string,
  reason: string,
  defaultAction = "accept",
  details: Record<string, unknown> = {},
): {
  reviewItemId: string;
  itemType: "entity_candidate" | "relationship_candidate";
  subjectId: string;
  reason: string;
  defaultAction: string;
  details: Record<string, unknown>;
} {
  return {
    reviewItemId: buildReviewItemId(subjectId, reason),
    itemType: subjectId.startsWith("relationship.") ? "relationship_candidate" : "entity_candidate",
    subjectId,
    reason,
    defaultAction,
    details,
  };
}

export function captureSingle(text: string, pattern: RegExp, group = 1): string | undefined {
  const match = text.match(pattern);
  return match?.[group];
}

export function toAbsoluteUrl(baseUrl: string, maybeRelative: string): string {
  return new URL(maybeRelative, baseUrl).toString();
}

export function buildKnownEntityRef(name: string): string {
  return knownEntityRefs.get(entityAliasKey(name)) ?? buildEntityId(name);
}

export function toPublicHttpUrl(
  baseUrl: string,
  maybeRelative: string | undefined,
): string | undefined {
  const raw = maybeRelative?.trim();
  if (!raw || looksLikeLocalPath(raw)) return undefined;
  let url: URL;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const href = url.toString();
  return looksLikeLocalPath(href) ? undefined : href;
}

export function extractFirstUrl(input: string): string | undefined {
  return input.match(/https?:\/\/\S+/)?.[0];
}

export function maybeString(value: unknown): string | undefined {
  const text = typeof value === "string"
    ? normalizeName(decodeHtmlEntities(value))
    : String(value ?? "").trim();
  return text ? text : undefined;
}

function looksLikeLocalPath(value: string): boolean {
  const decoded = repeatedlyDecodeURIComponent(value).replaceAll("\\", "/");
  return /(^|\/)file:/i.test(decoded) ||
    /^[a-z]:\//i.test(decoded) ||
    /(^|\/)Users\/[^/]+/i.test(decoded) ||
    /(^|\/)home\/[^/]+/i.test(decoded);
}

function repeatedlyDecodeURIComponent(value: string): string {
  let decoded = value;
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function entityAliasKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

const knownEntityRefs = new Map<string, string>([
  [
    "alcoholic beverages and cannabis administration",
    "dc.alcoholic_beverage_and_cannabis_administration",
  ],
  ["council", "dc.council_of_the_district_of_columbia"],
  ["council of the district of columbia", "dc.council_of_the_district_of_columbia"],
  ["department of employment services (does)", "dc.department_of_employment_services"],
  ["department of health", "dc.dc_health"],
  ["department of health (doh)", "dc.dc_health"],
  ["deputy mayor for education", "dc.office_of_the_deputy_mayor_for_education"],
  [
    "deputy mayor for health and human services",
    "dc.office_of_the_deputy_mayor_for_health_and_human_services",
  ],
  [
    "deputy mayor for planning and economic development",
    "dc.office_of_the_deputy_mayor_for_planning_and_economic_development",
  ],
  [
    "deputy mayor for public safety and justice",
    "dc.office_of_the_deputy_mayor_for_public_safety_and_justice",
  ],
  ["dlcp/opl", "dc.department_of_licensing_and_consumer_protection"],
  ["does", "dc.department_of_employment_services"],
  ["doh", "dc.dc_health"],
]);
