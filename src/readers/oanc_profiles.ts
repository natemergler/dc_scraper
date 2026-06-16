import {
  type Reader,
  type ReaderInput,
  type ReaderResult,
  type ReaderResultRecord,
  type ReaderResultSnapshot,
  type ReaderSource,
} from "./types.ts";

export interface OancProfilesSource extends ReaderSource {
  type: "oanc.profiles";
  indexUrl: string;
}

export interface OancProfilesReaderOptions {
  fetcher?: (input: string) => Promise<Response>;
}

export interface OancProfileRecordPayload {
  ancId: string;
  name: string;
  profileUrl: string;
  representedNeighborhoods?: string;
  wardNumbers?: string[];
}

const INDEX_TOKEN_RE =
  /<h[1-6][^>]*>\s*Ward\s+(\d+)\s*<\/h[1-6]>|<a[^>]*href="([^"]*\/anc-profile\/anc-[^"#?]+)"[^>]*>\s*ANC\s+([^<]+)\s*<\/a>/gi;
const TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;

export class OancProfilesReader implements Reader<OancProfilesSource> {
  private readonly fetcher: (input: string) => Promise<Response>;

  constructor(options: OancProfilesReaderOptions = {}) {
    this.fetcher = options.fetcher ?? ((input: string) => fetch(input));
  }

  async collect(input: ReaderInput<OancProfilesSource>): Promise<ReaderResult> {
    const indexHtml = await this.fetchHtml(input.source.id, input.source.indexUrl);
    const profileLinks = extractProfileLinks(indexHtml);
    const snapshots: ReaderResultSnapshot[] = [
      {
        source: input.source.id,
        key: "index",
        payload: {
          source: input.source.id,
          url: input.source.indexUrl,
          total: profileLinks.length,
        },
      },
    ];
    const records: ReaderResultRecord[] = [];

    for (let index = 0; index < profileLinks.length; index += 1) {
      if (typeof input.limit === "number" && records.length >= input.limit) {
        break;
      }
      const profile = profileLinks[index];
      const html = await this.fetchHtml(input.source.id, profile.profileUrl);
      const snapshotKey = `profile-${index}`;
      snapshots.push({
        source: input.source.id,
        key: snapshotKey,
        payload: {
          source: input.source.id,
          url: profile.profileUrl,
          ancId: profile.ancId,
        },
      });
      records.push({
        source: input.source.id,
        snapshotKey,
        key: profile.ancId,
        payload: {
          ancId: profile.ancId,
          name: `ANC ${profile.ancId}`,
          profileUrl: profile.profileUrl,
          representedNeighborhoods: extractRepresentedNeighborhoods(html),
          ...(profile.wardNumbers.length > 0 ? { wardNumbers: profile.wardNumbers } : {}),
        } satisfies OancProfileRecordPayload,
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
        `OANC profile request failed for ${sourceId}: ${
          error instanceof Error ? error.message : "network error"
        }`,
      );
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`OANC profile request failed for ${sourceId}: HTTP ${response.status}`);
    }
    return body;
  }
}

function extractProfileLinks(
  html: string,
): Array<{ ancId: string; profileUrl: string; wardNumbers: string[] }> {
  const byAncId = new Map<string, { profileUrl: string; wardNumbers: Set<string> }>();
  let currentWardNumber: string | null = null;

  for (const match of html.matchAll(INDEX_TOKEN_RE)) {
    if (match[1]) {
      currentWardNumber = match[1];
      continue;
    }

    const profileUrl = resolveOancUrl(match[2]);
    const ancId = normalizeAncId(match[3]);
    if (!profileUrl || !ancId) {
      continue;
    }

    let entry = byAncId.get(ancId);
    if (!entry) {
      entry = {
        profileUrl,
        wardNumbers: new Set<string>(),
      };
      byAncId.set(ancId, entry);
    }
    if (currentWardNumber) {
      entry.wardNumbers.add(currentWardNumber);
    }
  }

  return [...byAncId.entries()]
    .map(([ancId, value]) => ({
      ancId,
      profileUrl: value.profileUrl,
      wardNumbers: [...value.wardNumbers].sort(),
    }))
    .sort((left, right) => left.ancId.localeCompare(right.ancId));
}

function extractRepresentedNeighborhoods(html: string): string | undefined {
  const text = cleanText(html);
  const match = text.match(
    /Advisory Neighborhood Commission\s+([0-9A-Z/]+)\s+represents\s+(.+? neighborhoods?)\./i,
  );
  if (!match) {
    return undefined;
  }
  return match[2].trim();
}

function normalizeAncId(value: string): string | null {
  const normalized = decodeHtml(value).replace(WHITESPACE_RE, "").toUpperCase();
  return /^[0-9][0-9A-Z/]+$/.test(normalized) ? normalized : null;
}

function resolveOancUrl(href: string): string | null {
  try {
    return new URL(href, "https://oanc.dc.gov").toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
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
