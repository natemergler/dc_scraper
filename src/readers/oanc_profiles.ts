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
  officialUrl?: string;
  representedNeighborhoods?: string;
  wardNumbers?: string[];
  commissioners?: OancCommissionerRecordPayload[];
  pageLastModified?: string;
}

export interface OancCommissionerRecordPayload {
  smdId: string;
  name: string;
  officerRole?: string;
}

const INDEX_TOKEN_RE = /<h[1-6][^>]*>\s*Ward\s+(\d+)\s*<\/h[1-6]>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const ANC_LABEL_TITLE_RE = /title=(?:"|')\s*ANC\s+([^"']+)(?:"|')/i;
const ANC_LABEL_TEXT_RE = /\bANC\s+([0-9][0-9A-Z/]+)\b/i;
const HREF_RE = /\bhref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;
const WEBSITE_LINK_RE = /Website:\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/i;
const WEBSITE_TEXT_RE = /Website:\s*(https?:\/\/[^\s<]+)/i;
const COMMISSIONERS_HEADING_RE = />\s*Commissioners\s*</i;
const TABLE_RE = /<table[^>]*>([\s\S]*?)<\/table>/i;
const ROW_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_RE = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
const EMPHASIS_RE = /<em[^>]*>([\s\S]*?)<\/em>/gi;

export class OancProfilesReader implements Reader<OancProfilesSource> {
  private readonly fetcher: (input: string) => Promise<Response>;

  constructor(options: OancProfilesReaderOptions = {}) {
    this.fetcher = options.fetcher ?? ((input: string) => fetch(input));
  }

  async collect(input: ReaderInput<OancProfilesSource>): Promise<ReaderResult> {
    const indexPage = await this.fetchPage(input.source.id, input.source.indexUrl);
    const profileLinks = extractProfileLinks(indexPage.html);
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
      const page = await this.fetchPage(input.source.id, profile.profileUrl);
      const snapshotKey = `profile-${index}`;
      snapshots.push({
        source: input.source.id,
        key: snapshotKey,
        payload: {
          source: input.source.id,
          url: profile.profileUrl,
          ancId: profile.ancId,
          ...(page.lastModified ? { lastModified: page.lastModified } : {}),
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
          officialUrl: extractOfficialUrl(page.html, profile.profileUrl),
          representedNeighborhoods: extractRepresentedNeighborhoods(page.html),
          commissioners: extractCommissioners(page.html),
          ...(page.lastModified ? { pageLastModified: page.lastModified } : {}),
          ...(profile.wardNumbers.length > 0 ? { wardNumbers: profile.wardNumbers } : {}),
        } satisfies OancProfileRecordPayload,
      });
    }

    return { snapshots, records };
  }

  private async fetchPage(
    sourceId: string,
    url: string,
  ): Promise<{ html: string; lastModified?: string }> {
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
    return {
      html: body,
      lastModified: normalizeTimestamp(response.headers.get("last-modified")),
    };
  }
}

function extractProfileLinks(
  html: string,
): Array<{ ancId: string; profileUrl: string; wardNumbers: string[] }> {
  const byAncId = new Map<string, { profileUrl: string; wardNumbers: Set<string> }>();
  const wardNumbersByAncId = new Map<string, Set<string>>();
  let currentWardNumber: string | null = null;

  for (const match of html.matchAll(INDEX_TOKEN_RE)) {
    if (match[1]) {
      currentWardNumber = match[1];
      continue;
    }

    const anchorAttributes = match[2] ?? "";
    const anchorBody = match[3] ?? "";
    const contextStart = match.index ?? 0;
    const context = html.slice(contextStart, contextStart + 700);
    const ancId = normalizeAncId(
      extractAncLabel(`${anchorAttributes}>${anchorBody}`) ?? extractAncLabel(context) ?? "",
    );
    if (!ancId) {
      continue;
    }

    if (currentWardNumber) {
      let wardNumbers = wardNumbersByAncId.get(ancId);
      if (!wardNumbers) {
        wardNumbers = new Set<string>();
        wardNumbersByAncId.set(ancId, wardNumbers);
      }
      wardNumbers.add(currentWardNumber);
      byAncId.get(ancId)?.wardNumbers.add(currentWardNumber);
    }

    const href = extractHref(anchorAttributes);
    const profileUrl = href && href.includes("/anc-profile/anc-") ? resolveOancUrl(href) : null;
    if (!profileUrl) {
      continue;
    }

    let entry = byAncId.get(ancId);
    if (!entry) {
      entry = {
        profileUrl,
        wardNumbers: new Set(wardNumbersByAncId.get(ancId) ?? []),
      };
      byAncId.set(ancId, entry);
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

function extractHref(html: string): string | null {
  const match = html.match(HREF_RE);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function extractAncLabel(html: string): string | null {
  const titleMatch = html.match(ANC_LABEL_TITLE_RE);
  if (titleMatch) {
    return titleMatch[1];
  }

  const textMatch = cleanText(html).match(ANC_LABEL_TEXT_RE);
  return textMatch?.[1] ?? null;
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

function extractOfficialUrl(html: string, profileUrl: string): string | undefined {
  const linked = html.match(WEBSITE_LINK_RE);
  if (linked) {
    return resolveAbsoluteHttpUrl(profileUrl, linked[1]);
  }

  const plainText = html.match(WEBSITE_TEXT_RE);
  if (plainText) {
    return resolveAbsoluteHttpUrl(profileUrl, plainText[1]);
  }

  return undefined;
}

function extractCommissioners(html: string): OancCommissionerRecordPayload[] | undefined {
  const table = extractCommissionersTable(html);
  if (!table) {
    return undefined;
  }

  const commissioners = [...table.matchAll(ROW_RE)].flatMap((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(CELL_RE)].map((cellMatch) => cellMatch[1]);
    if (cells.length < 2) {
      return [];
    }

    const smdId = normalizeCommissionerSmdId(cells[0]);
    const officerRole = extractOfficerRole(cells[1]);
    const name = cleanText(cells[1].replace(EMPHASIS_RE, " "));
    if (!smdId || !name || /^smd$/i.test(smdId)) {
      return [];
    }

    return [{
      smdId,
      name,
      ...(officerRole ? { officerRole } : {}),
    }];
  });

  return commissioners.length > 0 ? commissioners : undefined;
}

function extractCommissionersTable(html: string): string | undefined {
  const headingMatch = html.match(COMMISSIONERS_HEADING_RE);
  if (!headingMatch || headingMatch.index === undefined) {
    return undefined;
  }

  const tail = html.slice(headingMatch.index);
  const tableMatch = tail.match(TABLE_RE);
  return tableMatch?.[1];
}

function normalizeCommissionerSmdId(html: string): string | undefined {
  const smdId = cleanText(html).toUpperCase();
  return /^[0-9][0-9A-Z/]+$/.test(smdId) ? smdId : undefined;
}

function extractOfficerRole(html: string): string | undefined {
  const roles = [...html.matchAll(EMPHASIS_RE)]
    .map((match) => cleanText(match[1]))
    .filter((role) => role.length > 0);
  if (roles.length === 0) {
    return undefined;
  }
  return [...new Set(roles)].join("; ");
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

function resolveAbsoluteHttpUrl(baseUrl: string, href: string): string | undefined {
  try {
    const url = new URL(href, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeTimestamp(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    return undefined;
  }
  return timestamp.toISOString();
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
