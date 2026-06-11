import {
  type Reader,
  type ReaderInput,
  type ReaderResult,
  type ReaderResultRecord,
  type ReaderResultSnapshot,
  type ReaderSource,
} from "./types.ts";

export interface DCCourtsStructureSource extends ReaderSource {
  type: "dccourts.structure";
  homeUrl: string;
  courtOfAppealsUrl: string;
  superiorCourtUrl: string;
}

export interface DCCourtsStructureReaderOptions {
  fetcher?: (input: string) => Promise<Response>;
}

export interface DCCourtsStructureRecordPayload {
  name: string;
  key: string;
  url: string;
  entryKind: "court_system" | "court" | "court_division";
  parentName?: string;
  discoveryPageUrl?: string;
  pageTitle?: string;
  heading?: string;
  summary?: string;
}

const dcCourtsRootName = "District of Columbia Courts";
const courtOfAppealsName = "Court of Appeals";
const superiorCourtName = "Superior Court";

const TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;
const TITLE_RE = /<title[^>]*>\s*([\s\S]*?)\s*<\/title>/i;
const H1_RE = /<h1[^>]*>\s*([\s\S]*?)\s*<\/h1>/i;
const PARAGRAPH_RE = /<p[^>]*>\s*([\s\S]*?)\s*<\/p>/gi;
const LINK_RE = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

export class DCCourtsStructureReader implements Reader<DCCourtsStructureSource> {
  private readonly fetcher: (input: string) => Promise<Response>;

  constructor(options: DCCourtsStructureReaderOptions = {}) {
    this.fetcher = options.fetcher ?? ((input: string) => fetch(input));
  }

  async collect(input: ReaderInput<DCCourtsStructureSource>): Promise<ReaderResult> {
    const snapshots: ReaderResultSnapshot[] = [];
    const records: ReaderResultRecord[] = [];
    const recordLimit = input.limit;

    const homeHtml = await this.fetchHtml(input.source.id, input.source.homeUrl);
    const homePage = parseInstitutionPage(homeHtml);
    snapshots.push(makeSnapshot(input.source.id, "district-of-columbia-courts", {
      url: input.source.homeUrl,
      pageTitle: homePage.pageTitle,
      heading: homePage.heading,
    }));
    pushRecord(records, recordLimit, {
      source: input.source.id,
      snapshotKey: "district-of-columbia-courts",
      key: "district-of-columbia-courts",
      payload: {
        name: dcCourtsRootName,
        key: "district-of-columbia-courts",
        url: input.source.homeUrl,
        entryKind: "court_system",
        pageTitle: homePage.pageTitle,
        heading: homePage.heading,
        summary: homePage.summary,
      } satisfies DCCourtsStructureRecordPayload,
    });

    const appealsHtml = await this.fetchHtml(input.source.id, input.source.courtOfAppealsUrl);
    const appealsPage = parseInstitutionPage(appealsHtml);
    snapshots.push(makeSnapshot(input.source.id, "court-of-appeals", {
      url: input.source.courtOfAppealsUrl,
      pageTitle: appealsPage.pageTitle,
      heading: appealsPage.heading,
    }));
    pushRecord(records, recordLimit, {
      source: input.source.id,
      snapshotKey: "court-of-appeals",
      key: "court-of-appeals",
      payload: {
        name: courtOfAppealsName,
        key: "court-of-appeals",
        url: input.source.courtOfAppealsUrl,
        entryKind: "court",
        parentName: dcCourtsRootName,
        pageTitle: appealsPage.pageTitle,
        heading: appealsPage.heading,
        summary: appealsPage.summary,
      } satisfies DCCourtsStructureRecordPayload,
    });

    const superiorHtml = await this.fetchHtml(input.source.id, input.source.superiorCourtUrl);
    const superiorPage = parseInstitutionPage(superiorHtml);
    snapshots.push(makeSnapshot(input.source.id, "superior-court", {
      url: input.source.superiorCourtUrl,
      pageTitle: superiorPage.pageTitle,
      heading: superiorPage.heading,
    }));
    pushRecord(records, recordLimit, {
      source: input.source.id,
      snapshotKey: "superior-court",
      key: "superior-court",
      payload: {
        name: superiorCourtName,
        key: "superior-court",
        url: input.source.superiorCourtUrl,
        entryKind: "court",
        parentName: dcCourtsRootName,
        pageTitle: superiorPage.pageTitle,
        heading: superiorPage.heading,
        summary: superiorPage.summary,
      } satisfies DCCourtsStructureRecordPayload,
    });

    for (
      const division of extractSuperiorCourtDivisionLinks(
        superiorHtml,
        input.source.superiorCourtUrl,
      )
    ) {
      if (typeof recordLimit === "number" && records.length >= recordLimit) {
        break;
      }
      records.push({
        source: input.source.id,
        snapshotKey: "superior-court",
        key: division.slug,
        payload: {
          name: division.name,
          key: division.slug,
          url: division.url,
          entryKind: "court_division",
          parentName: superiorCourtName,
          discoveryPageUrl: input.source.superiorCourtUrl,
        } satisfies DCCourtsStructureRecordPayload,
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
        `DC Courts structure request failed for ${sourceId}: ${
          error instanceof Error ? error.message : "network error"
        }`,
      );
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `DC Courts structure request failed for ${sourceId}: HTTP ${response.status}`,
      );
    }
    return body;
  }
}

function pushRecord(
  records: ReaderResultRecord[],
  limit: number | undefined,
  record: ReaderResultRecord,
) {
  if (typeof limit === "number" && records.length >= limit) {
    return;
  }
  records.push(record);
}

function makeSnapshot(
  source: string,
  key: string,
  payload: Record<string, unknown>,
): ReaderResultSnapshot {
  return {
    source,
    key,
    payload: {
      source,
      key,
      ...payload,
    },
  };
}

function parseInstitutionPage(html: string): {
  pageTitle?: string;
  heading?: string;
  summary?: string;
} {
  return {
    pageTitle: matchText(TITLE_RE, html),
    heading: matchText(H1_RE, html),
    summary: firstParagraphText(html),
  };
}

function extractSuperiorCourtDivisionLinks(
  html: string,
  baseUrl: string,
): Array<{ name: string; slug: string; url: string }> {
  const divisions: Array<{ name: string; slug: string; url: string }> = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(LINK_RE)) {
    const href = match[1];
    const resolved = resolveUrl(baseUrl, href);
    if (!resolved) {
      continue;
    }

    const parsed = new URL(resolved);
    const path = parsed.pathname.replace(/\/+$/, "");
    const prefix = "/superior-court/superior-court-divisions/";
    if (!path.startsWith(prefix)) {
      continue;
    }

    const slug = path.slice(prefix.length);
    if (!slug || slug.includes("/")) {
      continue;
    }

    const name = cleanText(match[2]);
    if (!name.endsWith("Division")) {
      continue;
    }

    const key = parsed.origin + path;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    divisions.push({ name, slug, url: key });
  }

  return divisions;
}

function resolveUrl(baseUrl: string, href: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function matchText(regex: RegExp, html: string): string | undefined {
  const match = regex.exec(html);
  return match ? cleanText(match[1]) : undefined;
}

function firstParagraphText(html: string): string | undefined {
  for (const match of html.matchAll(PARAGRAPH_RE)) {
    const text = cleanText(match[1]);
    if (text.length > 0) {
      return text;
    }
  }
  return undefined;
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
