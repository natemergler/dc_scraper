import {
  type Reader,
  type ReaderInput,
  type ReaderResult,
  type ReaderResultRecord,
  type ReaderResultSnapshot,
  type ReaderSource,
} from "./types.ts";

export interface LegalEntrypointSeed {
  key: string;
  name: string;
  url: string;
}

export interface LegalEntrypointsSource extends ReaderSource {
  type: "legal.entrypoints";
  indexUrl: string;
  seededEntrypoints: LegalEntrypointSeed[];
}

export interface LegalEntrypointsReaderOptions {
  fetcher?: (input: string) => Promise<Response>;
}

export interface LegalEntrypointRecordPayload {
  name: string;
  key: string;
  url: string;
  fromSeed: boolean;
  indexUrl: string;
}

const TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;
const LINK_RE = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

export class LegalEntrypointsReader implements Reader<LegalEntrypointsSource> {
  private readonly fetcher: (input: string) => Promise<Response>;

  constructor(options: LegalEntrypointsReaderOptions = {}) {
    this.fetcher = options.fetcher ?? ((input: string) => fetch(input));
  }

  async collect(input: ReaderInput<LegalEntrypointsSource>): Promise<ReaderResult> {
    const html = await this.fetchHtml(input.source.id, input.source.indexUrl);
    const entries = collectLegalEntrypoints(
      html,
      input.source.indexUrl,
      input.source.seededEntrypoints,
    );
    const limitedEntries = typeof input.limit === "number"
      ? entries.slice(0, input.limit)
      : entries;

    const snapshots: ReaderResultSnapshot[] = [{
      source: input.source.id,
      key: "index",
      payload: {
        source: input.source.id,
        url: input.source.indexUrl,
        discoveredTotal: entries.length,
      },
    }];

    const records: ReaderResultRecord[] = limitedEntries.map((entry) => ({
      source: input.source.id,
      snapshotKey: "index",
      key: entry.key,
      payload: {
        name: entry.name,
        key: entry.key,
        url: entry.url,
        fromSeed: entry.fromSeed,
        indexUrl: input.source.indexUrl,
      } satisfies LegalEntrypointRecordPayload,
    }));

    return { snapshots, records };
  }

  private async fetchHtml(sourceId: string, url: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(url);
    } catch (error) {
      throw new Error(
        `Legal entrypoints request failed for ${sourceId}: ${
          error instanceof Error ? error.message : "network error"
        }`,
      );
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Legal entrypoints request failed for ${sourceId}: HTTP ${response.status}`);
    }
    return body;
  }
}

function collectLegalEntrypoints(
  html: string,
  indexUrl: string,
  seededEntrypoints: LegalEntrypointSeed[],
): Array<LegalEntrypointSeed & { fromSeed: boolean }> {
  const entries: Array<LegalEntrypointSeed & { fromSeed: boolean }> = [];
  const seenUrls = new Set<string>();
  const seenNames = new Set<string>();

  for (const seed of seededEntrypoints) {
    entries.push({ ...seed, fromSeed: true });
    seenUrls.add(normalizeUrl(seed.url));
    seenNames.add(normalizeNameKey(seed.name));
  }

  for (const match of html.matchAll(LINK_RE)) {
    const url = resolveUrl(indexUrl, match[1]);
    if (!url) {
      continue;
    }
    const name = cleanText(match[2]);
    if (!name || !isLegalEntrypoint(name, url)) {
      continue;
    }

    const normalizedUrl = normalizeUrl(url);
    const normalizedName = normalizeNameKey(name);
    if (seenUrls.has(normalizedUrl) || seenNames.has(normalizedName)) {
      continue;
    }
    seenUrls.add(normalizedUrl);
    seenNames.add(normalizedName);
    entries.push({
      key: slugify(name),
      name,
      url: normalizedUrl,
      fromSeed: false,
    });
  }

  return entries;
}

function isLegalEntrypoint(name: string, url: string): boolean {
  if (/\/services(?:\?|$)/i.test(url)) {
    return false;
  }
  return /Official Code|Mayor'?s Orders?|Laws, Regulations and Courts|DCMR|Register/i.test(name) ||
    /code\.dccouncil\.gov|dcregs\.dc\.gov|mayor\.dc\.gov\/page\/mayors-orders/i.test(url);
}

function resolveUrl(baseUrl: string, href: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.replace(/^www\./i, "");
  return parsed.toString();
}

function normalizeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
