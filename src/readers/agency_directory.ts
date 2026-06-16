import {
  type Reader,
  type ReaderInput,
  type ReaderResult,
  type ReaderResultRecord,
  type ReaderResultSnapshot,
  type ReaderSource,
} from "./types.ts";

export interface AgencyDirectorySource extends ReaderSource {
  type: "dc.agency_directory";
  url: string;
}

export interface AgencyDirectoryReaderOptions {
  fetcher?: (input: string) => Promise<Response>;
}

export interface AgencyDirectoryRecordPayload {
  directoryName: string;
  officialUrl: string;
  subdomain: string;
  sourcePageUrl: string;
}

const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const NAME_RE = /views-field-title[\s\S]*?<b>([\s\S]*?)<\/b>/i;
const SUBDOMAIN_LINK_RE =
  /views-field-subdomain[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
const TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;

export class AgencyDirectoryReader implements Reader<AgencyDirectorySource> {
  private readonly fetcher: (input: string) => Promise<Response>;

  constructor(options: AgencyDirectoryReaderOptions = {}) {
    this.fetcher = options.fetcher ?? ((input: string) => fetch(input));
  }

  async collect(input: ReaderInput<AgencyDirectorySource>): Promise<ReaderResult> {
    const html = await this.fetchHtml(input.source.id, input.source.url);
    const rows = extractDirectoryRows(html, input.source.url);
    const snapshots: ReaderResultSnapshot[] = [{
      source: input.source.id,
      key: "index",
      payload: {
        source: input.source.id,
        url: input.source.url,
        total: rows.length,
      },
    }];
    const records: ReaderResultRecord[] = [];

    for (let index = 0; index < rows.length; index += 1) {
      if (typeof input.limit === "number" && records.length >= input.limit) {
        break;
      }

      const row = rows[index];
      records.push({
        source: input.source.id,
        snapshotKey: "index",
        key: `${slugify(row.directoryName)}:${slugify(row.subdomain)}`,
        payload: {
          directoryName: row.directoryName,
          officialUrl: row.officialUrl,
          subdomain: row.subdomain,
          sourcePageUrl: input.source.url,
        } satisfies AgencyDirectoryRecordPayload,
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
        `Agency directory request failed for ${sourceId}: ${
          error instanceof Error ? error.message : "network error"
        }`,
      );
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Agency directory request failed for ${sourceId}: HTTP ${response.status}`);
    }
    return body;
  }
}

function extractDirectoryRows(
  html: string,
  baseUrl: string,
): Array<{ directoryName: string; officialUrl: string; subdomain: string }> {
  const rows: Array<{ directoryName: string; officialUrl: string; subdomain: string }> = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(ROW_RE)) {
    const rowHtml = match[1];
    const nameMatch = NAME_RE.exec(rowHtml);
    const linkMatch = SUBDOMAIN_LINK_RE.exec(rowHtml);
    if (!nameMatch || !linkMatch) {
      continue;
    }

    const directoryName = cleanText(nameMatch[1]);
    const officialUrl = resolveUrl(baseUrl, linkMatch[1]);
    const subdomain = cleanText(linkMatch[2]);
    if (!directoryName || !officialUrl || !subdomain) {
      continue;
    }
    if (isGenericPortalUrl(officialUrl)) {
      continue;
    }

    const key = `${directoryName}\u0000${officialUrl}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push({ directoryName, officialUrl, subdomain });
  }

  return rows;
}

function resolveUrl(baseUrl: string, href: string): string | null {
  try {
    return new URL(href, baseUrl).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function isGenericPortalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === "dc.gov" || parsed.hostname === "www.dc.gov") &&
      (parsed.pathname === "" || parsed.pathname === "/")
    );
  } catch {
    return false;
  }
}

function slugify(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
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
    .replace(/&#8217;|&#039;|&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
