import {
  type Reader,
  type ReaderInput,
  type ReaderResult,
  type ReaderResultRecord,
  type ReaderResultSnapshot,
  type ReaderSource,
} from "./types.ts";

export interface BegaStructurePage {
  key: string;
  name: string;
  url: string;
  entryKind: "agency" | "office";
  parentName?: string;
}

export interface BegaStructureSource extends ReaderSource {
  type: "bega.structure";
  pages: BegaStructurePage[];
}

export interface BegaStructureReaderOptions {
  fetcher?: (input: string) => Promise<Response>;
}

export interface BegaStructureRecordPayload {
  name: string;
  key: string;
  url: string;
  entryKind: "agency" | "office";
  parentName?: string;
  pageTitle?: string;
  heading?: string;
  summary?: string;
}

const TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;
const TITLE_RE = /<title[^>]*>\s*([\s\S]*?)\s*<\/title>/i;
const H1_RE = /<h1[^>]*>\s*([\s\S]*?)\s*<\/h1>/i;
const PARAGRAPH_RE = /<p[^>]*>\s*([\s\S]*?)\s*<\/p>/gi;

export class BegaStructureReader implements Reader<BegaStructureSource> {
  private readonly fetcher: (input: string) => Promise<Response>;

  constructor(options: BegaStructureReaderOptions = {}) {
    this.fetcher = options.fetcher ?? ((input: string) => fetch(input));
  }

  async collect(input: ReaderInput<BegaStructureSource>): Promise<ReaderResult> {
    const snapshots: ReaderResultSnapshot[] = [];
    const records: ReaderResultRecord[] = [];
    const pages = typeof input.limit === "number"
      ? input.source.pages.slice(0, input.limit)
      : input.source.pages;

    for (const page of pages) {
      const html = await this.fetchHtml(input.source.id, page.url);
      const parsed = parseInstitutionPage(html);

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

      records.push({
        source: input.source.id,
        snapshotKey: page.key,
        key: page.key,
        payload: {
          name: page.name,
          key: page.key,
          url: page.url,
          entryKind: page.entryKind,
          parentName: page.parentName,
          pageTitle: parsed.pageTitle,
          heading: parsed.heading,
          summary: parsed.summary,
        } satisfies BegaStructureRecordPayload,
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
        `BEGA structure request failed for ${sourceId}: ${
          error instanceof Error ? error.message : "network error"
        }`,
      );
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`BEGA structure request failed for ${sourceId}: HTTP ${response.status}`);
    }
    return body;
  }
}

function parseInstitutionPage(html: string): {
  pageTitle?: string;
  heading?: string;
  summary?: string;
} {
  const pageTitle = matchText(TITLE_RE, html);
  const browserShell = isBrowserRequirementText(cleanText(html));
  const heading = matchText(H1_RE, html);
  const summary = firstParagraphText(html);

  return {
    pageTitle,
    heading: browserShell || isBrowserRequirementText(heading) ? undefined : heading,
    summary: browserShell || isBrowserRequirementText(summary) ? undefined : summary,
  };
}

function matchText(regex: RegExp, html: string): string | undefined {
  const match = regex.exec(html);
  return match ? cleanText(match[1]) : undefined;
}

function firstParagraphText(html: string): string | undefined {
  for (const match of html.matchAll(PARAGRAPH_RE)) {
    const text = cleanText(match[1]);
    if (text.length > 0 && !isBrowserRequirementText(text)) {
      return text;
    }
  }
  return undefined;
}

function isBrowserRequirementText(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase().replace(WHITESPACE_RE, " ").trim();
  return normalized.includes("javascript") ||
    normalized.includes("you need to change a setting in your web browser") ||
    normalized.includes("this website requires a browser feature called javascript") ||
    normalized.includes("how to enable javascript in your browser");
}

function cleanText(value: string): string {
  return decodeHtml(value.replace(TAG_RE, " "))
    .replace(WHITESPACE_RE, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
