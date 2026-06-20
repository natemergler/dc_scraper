import {
  type Reader,
  type ReaderInput,
  type ReaderResult,
  type ReaderResultRecord,
  type ReaderResultSnapshot,
  type ReaderSource,
} from "./types.ts";

export interface MayorExecutiveStructurePage {
  key: string;
  url: string;
}

export interface MayorExecutiveStructureEntry {
  key: string;
  name: string;
  pageKey: string;
  entryKind: "office" | "agency_ref";
  parentKey?: string;
  relationKind?: "part_of" | "reports_to";
  description?: string;
}

export interface MayorExecutiveStructureSource extends ReaderSource {
  type: "mayor.executive_structure";
  pages: MayorExecutiveStructurePage[];
  entries: MayorExecutiveStructureEntry[];
}

export interface MayorExecutiveStructureReaderOptions {
  fetcher?: (input: string) => Promise<Response>;
}

export interface MayorExecutiveStructureRecordPayload extends MayorExecutiveStructureEntry {
  sourceUrl: string;
  sourcePageUrls?: string[];
  pageTitle?: string;
  heading?: string;
  description?: string;
  officialUrl?: string;
}

const TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;
const TITLE_RE = /<title[^>]*>\s*([\s\S]*?)\s*<\/title>/i;
const H1_RE = /<h1[^>]*>\s*([\s\S]*?)\s*<\/h1>/i;
const BODY_FIELD_RE =
  /field-name-body[\s\S]*?<div class="field-item even" property="content:encoded">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i;
const LIST_OR_PARAGRAPH_RE = /<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const BREAK_RE = /<br\s*\/?>/gi;
const NESTED_LIST_RE = /<ul[\s\S]*$/i;
const HREF_RE = /<a\s+[^>]*href="([^"]+)"/gi;

interface PageEntryEvidence {
  description?: string;
  officialUrl?: string;
  sourcePageUrls: string[];
}

interface PageEvidence {
  pageTitle?: string;
  heading?: string;
  entryEvidenceByKey: Map<string, PageEntryEvidence>;
}

interface MatchCandidate {
  key: string;
  labels: string[];
  normalizedLabels: string[];
}

export class MayorExecutiveStructureReader implements Reader<MayorExecutiveStructureSource> {
  private readonly fetcher: (input: string) => Promise<Response>;

  constructor(options: MayorExecutiveStructureReaderOptions = {}) {
    this.fetcher = options.fetcher ?? ((input: string) => fetch(input));
  }

  async collect(input: ReaderInput<MayorExecutiveStructureSource>): Promise<ReaderResult> {
    const snapshots: ReaderResultSnapshot[] = [];
    const pageEvidence = new Map<string, { url: string; pageTitle?: string; heading?: string }>();
    const entryEvidenceByKey = new Map<string, PageEntryEvidence>();

    for (const page of input.source.pages) {
      const html = await this.fetchHtml(input.source.id, page.url);
      const parsed = parseEvidencePage(html, page.url, input.source.entries);
      snapshots.push({
        source: input.source.id,
        key: page.key,
        payload: {
          source: input.source.id,
          url: page.url,
          key: page.key,
          pageTitle: parsed.pageTitle,
          heading: parsed.heading,
        },
      });
      pageEvidence.set(page.key, {
        url: page.url,
        pageTitle: parsed.pageTitle,
        heading: parsed.heading,
      });
      for (const [entryKey, evidence] of parsed.entryEvidenceByKey) {
        mergeEntryEvidence(entryEvidenceByKey, entryKey, evidence);
      }
    }

    const entries = typeof input.limit === "number"
      ? input.source.entries.slice(0, input.limit)
      : input.source.entries;
    const records: ReaderResultRecord[] = [];
    for (const entry of entries) {
      const pageInfo = pageEvidence.get(entry.pageKey);
      const evidence = entryEvidenceByKey.get(entry.key);
      const sourcePageUrls = uniqueStrings([
        pageInfo?.url,
        ...(evidence?.sourcePageUrls ?? []),
      ]);
      records.push({
        source: input.source.id,
        snapshotKey: entry.pageKey,
        key: entry.key,
        payload: {
          ...entry,
          sourceUrl: pageInfo?.url ?? "",
          sourcePageUrls: sourcePageUrls.length > 1 ? sourcePageUrls : undefined,
          pageTitle: pageInfo?.pageTitle,
          heading: pageInfo?.heading,
          description: evidence?.description,
          officialUrl: evidence?.officialUrl,
        } satisfies MayorExecutiveStructureRecordPayload,
      });
    }

    return { snapshots, records };
  }

  private async fetchHtml(sourceId: string, url: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(url);
    } catch (error) {
      throw new Error(
        `Mayor executive structure request failed for ${sourceId}: ${
          error instanceof Error ? error.message : "network error"
        }`,
      );
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Mayor executive structure request failed for ${sourceId}: HTTP ${response.status}`,
      );
    }
    return body;
  }
}

function parseEvidencePage(
  html: string,
  pageUrl: string,
  entries: MayorExecutiveStructureEntry[],
): PageEvidence {
  const officeCandidates = buildMatchCandidates(entries);
  const entryEvidenceByKey = new Map<string, PageEntryEvidence>();
  const bodyHtml = extractBodyFieldHtml(html);

  if (bodyHtml) {
    for (const fragment of extractEvidenceFragments(bodyHtml)) {
      const match = findMatchCandidate(fragment.text, officeCandidates);
      if (!match) {
        continue;
      }

      const description = extractDescription(fragment.text, match.labels);
      const officialUrl = extractOfficialUrl(fragment.html, pageUrl);
      if (!description && !officialUrl) {
        continue;
      }

      mergeEntryEvidence(entryEvidenceByKey, match.key, {
        description,
        officialUrl,
        sourcePageUrls: [pageUrl],
      });
    }
  }

  return {
    pageTitle: matchText(TITLE_RE, html),
    heading: matchText(H1_RE, html),
    entryEvidenceByKey,
  };
}

function matchText(regex: RegExp, html: string): string | undefined {
  const match = regex.exec(html);
  return match ? cleanText(match[1]) : undefined;
}

function extractBodyFieldHtml(html: string): string | undefined {
  const match = html.match(BODY_FIELD_RE);
  return match?.[1];
}

function extractEvidenceFragments(bodyHtml: string): Array<{ html: string; text: string }> {
  const matches = [...bodyHtml.matchAll(LIST_OR_PARAGRAPH_RE)];
  return matches.map((match) => {
    const html = stripNestedLists(match[2]);
    return {
      html,
      text: cleanText(html),
    };
  }).filter((fragment) => fragment.text.length > 0);
}

function stripNestedLists(html: string): string {
  return html.replace(NESTED_LIST_RE, "");
}

function buildMatchCandidates(entries: MayorExecutiveStructureEntry[]): MatchCandidate[] {
  return entries
    .filter((entry) => entry.entryKind === "office")
    .map((entry) => {
      const labels = buildMatchLabels(entry.name);
      return {
        key: entry.key,
        labels,
        normalizedLabels: labels.map(normalizeForMatch),
      };
    })
    .sort((left, right) => {
      const leftLength = Math.max(...left.normalizedLabels.map((label) => label.length));
      const rightLength = Math.max(...right.normalizedLabels.map((label) => label.length));
      return rightLength - leftLength;
    });
}

function buildMatchLabels(name: string): string[] {
  const labels = [name];
  if (name.startsWith("Mayor's ")) {
    labels.push(name.replace(/^Mayor's\s+/, ""));
  }
  return uniqueStrings(labels);
}

function findMatchCandidate(
  text: string,
  candidates: MatchCandidate[],
): MatchCandidate | undefined {
  const normalizedText = normalizeForMatch(text);
  return candidates.find((candidate) =>
    candidate.normalizedLabels.some((label) => label.length > 0 && normalizedText.startsWith(label))
  );
}

function extractDescription(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const remainder = stripLeadingLabel(text, label);
    if (remainder === null) {
      continue;
    }

    const description = sanitizeDescription(remainder);
    if (description) {
      return description;
    }
  }

  return undefined;
}

function stripLeadingLabel(text: string, label: string): string | null {
  const normalizedLabel = escapeRegex(label).replaceAll("'", "['’]");
  const match = text.match(new RegExp(`^${normalizedLabel}(?:\\s*\\([^)]*\\))?`, "i"));
  if (!match) {
    return null;
  }

  return text.slice(match[0].length)
    .replace(/^[\s:>\-]+/, "")
    .trim();
}

function sanitizeDescription(text: string): string | undefined {
  const description = text
    .replace(/^https?:\/\/\S+\s*/i, "")
    .replace(/^[a-z0-9.-]+\.dc\.gov\/?\s*/i, "")
    .replace(WHITESPACE_RE, " ")
    .trim();

  if (
    description.length < 40 ||
    /^[a-z0-9.-]+\.dc\.gov\/?$/i.test(description)
  ) {
    return undefined;
  }

  return description;
}

function extractOfficialUrl(fragmentHtml: string, pageUrl: string): string | undefined {
  for (const match of fragmentHtml.matchAll(HREF_RE)) {
    const resolved = resolveUrl(pageUrl, match[1]);
    if (!resolved || !isOfficialUrlCandidate(resolved)) {
      continue;
    }
    return resolved;
  }

  return undefined;
}

function resolveUrl(baseUrl: string, href: string): string | undefined {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function isOfficialUrlCandidate(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }
  if (/\/sites\/default\/files\//i.test(url)) {
    return false;
  }
  if (/\.(pdf|docx?|xlsx?|pptx?)(?:$|[?#])/i.test(url)) {
    return false;
  }
  return true;
}

function mergeEntryEvidence(
  target: Map<string, PageEntryEvidence>,
  entryKey: string,
  next: PageEntryEvidence,
): void {
  const current = target.get(entryKey);
  target.set(entryKey, {
    description: choosePreferredText(current?.description, next.description),
    officialUrl: current?.officialUrl ?? next.officialUrl,
    sourcePageUrls: uniqueStrings([
      ...(current?.sourcePageUrls ?? []),
      ...next.sourcePageUrls,
    ]),
  });
}

function choosePreferredText(current?: string, next?: string): string | undefined {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return next.length > current.length ? next : current;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function cleanText(value: string): string {
  return decodeHtml(value.replace(BREAK_RE, " ").replace(TAG_RE, " "))
    .replace(WHITESPACE_RE, " ")
    .trim();
}

function normalizeForMatch(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "'")
    .replace(/&#8217;|&#039;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
