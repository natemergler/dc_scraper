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
  pageTitle?: string;
  heading?: string;
}

const TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;
const TITLE_RE = /<title[^>]*>\s*([\s\S]*?)\s*<\/title>/i;
const H1_RE = /<h1[^>]*>\s*([\s\S]*?)\s*<\/h1>/i;

export class MayorExecutiveStructureReader implements Reader<MayorExecutiveStructureSource> {
  private readonly fetcher: (input: string) => Promise<Response>;

  constructor(options: MayorExecutiveStructureReaderOptions = {}) {
    this.fetcher = options.fetcher ?? ((input: string) => fetch(input));
  }

  async collect(input: ReaderInput<MayorExecutiveStructureSource>): Promise<ReaderResult> {
    const snapshots: ReaderResultSnapshot[] = [];
    const pageEvidence = new Map<string, { url: string; pageTitle?: string; heading?: string }>();

    for (const page of input.source.pages) {
      const html = await this.fetchHtml(input.source.id, page.url);
      const parsed = parseEvidencePage(html);
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
    }

    const entries = typeof input.limit === "number"
      ? input.source.entries.slice(0, input.limit)
      : input.source.entries;
    const records: ReaderResultRecord[] = [];
    for (const entry of entries) {
      const evidence = pageEvidence.get(entry.pageKey);
      records.push({
        source: input.source.id,
        snapshotKey: entry.pageKey,
        key: entry.key,
        payload: {
          ...entry,
          sourceUrl: evidence?.url ?? "",
          pageTitle: evidence?.pageTitle,
          heading: evidence?.heading,
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

function parseEvidencePage(html: string): {
  pageTitle?: string;
  heading?: string;
} {
  return {
    pageTitle: matchText(TITLE_RE, html),
    heading: matchText(H1_RE, html),
  };
}

function matchText(regex: RegExp, html: string): string | undefined {
  const match = regex.exec(html);
  return match ? cleanText(match[1]) : undefined;
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
    .replace(/&#8217;|&#039;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
