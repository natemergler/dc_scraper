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

export function fieldEvidence(path: string, value: unknown) {
  return { fieldPath: path, observedValue: String(value ?? "") };
}

export function buildCandidateReviewItem(
  subjectId: string,
  reason: string,
  defaultAction = "accept",
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
    details: {},
  };
}

export function captureSingle(text: string, pattern: RegExp, group = 1): string | undefined {
  const match = text.match(pattern);
  return match?.[group];
}

export function toAbsoluteUrl(baseUrl: string, maybeRelative: string): string {
  return new URL(maybeRelative, baseUrl).toString();
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
