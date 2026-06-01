import {
  type ArtifactCaptureInput,
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
