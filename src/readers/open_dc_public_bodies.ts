import {
  type Reader,
  type ReaderInput,
  type ReaderResult,
  type ReaderResultRecord,
  type ReaderResultSnapshot,
  type ReaderSource,
} from "./types.ts";

export interface OpenDCPublicBodiesSource extends ReaderSource {
  type: "open_dc.public_bodies";
  indexUrl: string;
  supplementalIndexUrl?: string;
}

export interface OpenDCPublicBodiesReaderOptions {
  fetcher?: (input: string) => Promise<Response>;
}

export interface OpenDCPublicBodyRecordPayload {
  name: string;
  slug: string;
  detailUrl: string;
  enablingStatute?: string;
  enablingStatuteUrl?: string;
  governingAgency?: string;
  governingAgencyAcronym?: string;
  administeringAgency?: string;
  fromSupplementalIndex: boolean;
}

const PUBLIC_BODY_LINK_RE = /<a[^>]*href="([^"]*\/public-bodies\/[^"#?]+)"[^>]*>([^<]+)<\/a>/gi;
const TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /\s+/g;

const DETAIL_FIELD_RE = /<h3[^>]*>\s*([^<]+)\s*<\/h3>\s*<p[^>]*>(.*?)<\/p>/gs;
const DETAIL_FIELD_WITH_LINK_RE =
  /<h3[^>]*>\s*([^<]+)\s*<\/h3>\s*<p[^>]*><a\s+href="([^"]+)"[^>]*>(.*?)<\/a><\/p>/gs;

const DRUPAL_FIELD_WITH_LINK_RE =
  /<div class="field-label">\s*([^<]+?):?(?:&nbsp;)?\s*<\/div>\s*<div class="field-items">\s*<div class="field-item[^"]*">\s*<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>\s*<\/div>/gs;
const DRUPAL_FIELD_RE =
  /<div class="field-label">\s*([^<]+?):?(?:&nbsp;)?\s*<\/div>\s*<div class="field-items">\s*<div class="field-item[^"]*">(.*?)<\/div>/gs;

export class OpenDCPublicBodiesReader implements Reader<OpenDCPublicBodiesSource> {
  private readonly fetcher: (input: string) => Promise<Response>;

  constructor(options: OpenDCPublicBodiesReaderOptions = {}) {
    this.fetcher = options.fetcher ?? ((input: string) => fetch(input));
  }

  async collect(input: ReaderInput<OpenDCPublicBodiesSource>): Promise<ReaderResult> {
    const indexHtml = await this.fetchHtml(input.source.id, input.source.indexUrl);
    const publicBodies = extractPublicBodyLinks(indexHtml);

    const snapshots: ReaderResultSnapshot[] = [
      {
        source: input.source.id,
        key: "index",
        payload: {
          source: input.source.id,
          url: input.source.indexUrl,
          total: publicBodies.length,
        },
      },
    ];
    const records: ReaderResultRecord[] = [];

    for (let i = 0; i < publicBodies.length; i += 1) {
      const body = publicBodies[i];
      const html = await this.fetchHtml(input.source.id, body.detailUrl);
      const snapshotKey = `page-${i}`;
      snapshots.push({
        source: input.source.id,
        key: snapshotKey,
        payload: {
          source: input.source.id,
          url: body.detailUrl,
          slug: body.slug,
        },
      });

      const detailFields = parseDetailPage(html);
      records.push({
        source: input.source.id,
        snapshotKey,
        key: body.slug,
        payload: {
          name: body.name,
          slug: body.slug,
          detailUrl: body.detailUrl,
          enablingStatute: detailFields.enablingStatute,
          enablingStatuteUrl: detailFields.enablingStatuteUrl,
          governingAgency: detailFields.governingAgency,
          governingAgencyAcronym: detailFields.governingAgencyAcronym,
          administeringAgency: detailFields.administeringAgency,
          fromSupplementalIndex: false,
        } satisfies OpenDCPublicBodyRecordPayload,
      });
      if (typeof input.limit === "number" && records.length >= input.limit) {
        break;
      }
    }

    if (input.source.supplementalIndexUrl) {
      const supplementalHtml = await this.fetchHtml(
        input.source.id,
        input.source.supplementalIndexUrl,
      );
      const supplementalBodies = extractPublicBodyLinks(supplementalHtml);
      const seenSlugs = new Set(records.map((r) => r.key));

      for (let i = 0; i < supplementalBodies.length; i += 1) {
        if (typeof input.limit === "number" && records.length >= input.limit) {
          break;
        }

        const body = supplementalBodies[i];
        if (seenSlugs.has(body.slug)) {
          continue;
        }
        seenSlugs.add(body.slug);

        const html = await this.fetchHtml(input.source.id, body.detailUrl);
        const snapshotKey = `supplemental-page-${i}`;
        snapshots.push({
          source: input.source.id,
          key: snapshotKey,
          payload: {
            source: input.source.id,
            url: body.detailUrl,
            slug: body.slug,
          },
        });

        const detailFields = parseDetailPage(html);
        records.push({
          source: input.source.id,
          snapshotKey,
          key: body.slug,
          payload: {
            name: body.name,
            slug: body.slug,
            detailUrl: body.detailUrl,
            enablingStatute: detailFields.enablingStatute,
            enablingStatuteUrl: detailFields.enablingStatuteUrl,
            governingAgency: detailFields.governingAgency,
            governingAgencyAcronym: detailFields.governingAgencyAcronym,
            administeringAgency: detailFields.administeringAgency,
            fromSupplementalIndex: true,
          } satisfies OpenDCPublicBodyRecordPayload,
        });
      }
    }

    return { snapshots, records };
  }

  private async fetchHtml(sourceId: string, url: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(url);
    } catch (error) {
      throw new Error(
        `Open DC public body request failed for ${sourceId}: ${
          error instanceof Error ? error.message : "network error"
        }`,
      );
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Open DC public body request failed for ${sourceId}: HTTP ${response.status}`,
      );
    }
    return body;
  }
}

function extractPublicBodyLinks(
  html: string,
): Array<{ name: string; slug: string; detailUrl: string }> {
  const bodies: Array<{ name: string; slug: string; detailUrl: string }> = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(PUBLIC_BODY_LINK_RE)) {
    const rawHref = match[1];
    const text = decodeHtml(stripTags(match[2]).trim());
    const detailUrl = rawHref.startsWith("http")
      ? rawHref.replace(/\/+$/, "")
      : `https://www.open-dc.gov${rawHref}`.replace(/\/+$/, "");
    const slug = extractSlugFromUrl(detailUrl);
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    bodies.push({ name: text, slug, detailUrl });
  }

  return bodies;
}

function extractSlugFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.replace(/\/+$/, "").split("/");
    return segments[segments.length - 1] || null;
  } catch {
    return null;
  }
}

const FIELD_ALIASES: Record<string, string> = {
  "enabling statute / mayoral order": "enabling statute or mayoral order",
  "governing agency / agency acronym": "governing agency or agency acronym",
  "administering agency / agency acronym": "administering agency",
};

function resolveFieldAlias(normalized: string): string {
  return FIELD_ALIASES[normalized] ?? normalized;
}

function parseDetailPage(html: string): {
  enablingStatute?: string;
  enablingStatuteUrl?: string;
  governingAgency?: string;
  governingAgencyAcronym?: string;
  administeringAgency?: string;
} {
  const fields: Record<string, { text: string; url?: string }> = {};

  function setField(fieldName: string, value: { text: string; url?: string }) {
    const normalized = resolveFieldAlias(normalizeFieldName(fieldName));
    if (!fields[normalized]) {
      fields[normalized] = value;
    }
  }

  for (const match of html.matchAll(DRUPAL_FIELD_WITH_LINK_RE)) {
    const fieldName = decodeHtml(stripTags(match[1]).trim());
    const url = match[2];
    const fieldValue = decodeHtml(stripTags(match[3]).trim());
    setField(fieldName, { text: fieldValue, url });
  }

  for (const match of html.matchAll(DRUPAL_FIELD_RE)) {
    const fieldName = decodeHtml(stripTags(match[1]).trim());
    const normalized = resolveFieldAlias(normalizeFieldName(fieldName));
    if (fields[normalized]) {
      continue;
    }
    const fieldValue = decodeHtml(stripTags(match[2]).trim());
    setField(fieldName, { text: fieldValue });
  }

  for (const match of html.matchAll(DETAIL_FIELD_WITH_LINK_RE)) {
    const fieldName = decodeHtml(stripTags(match[1]).trim());
    const url = match[2];
    const fieldValue = decodeHtml(stripTags(match[3]).trim());
    setField(fieldName, { text: fieldValue, url });
  }

  for (const match of html.matchAll(DETAIL_FIELD_RE)) {
    const fieldName = decodeHtml(stripTags(match[1]).trim());
    const normalized = resolveFieldAlias(normalizeFieldName(fieldName));
    if (fields[normalized]) {
      continue;
    }
    const fieldValue = decodeHtml(stripTags(match[2]).trim());
    setField(fieldName, { text: fieldValue });
  }

  return {
    enablingStatute: fields["enabling statute or mayoral order"]?.text,
    enablingStatuteUrl: fields["enabling statute or mayoral order"]?.url,
    governingAgency: extractAgencyName(fields["governing agency or agency acronym"]?.text),
    governingAgencyAcronym: extractAcronym(fields["governing agency or agency acronym"]?.text),
    administeringAgency: extractAgencyName(fields["administering agency"]?.text),
  };
}

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(WHITESPACE_RE, " ").trim();
}

function extractAgencyName(text?: string): string | undefined {
  if (!text) {
    return undefined;
  }
  const parenMatch = text.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    return parenMatch[1].trim();
  }
  return text;
}

function extractAcronym(text?: string): string | undefined {
  if (!text) {
    return undefined;
  }
  const parenMatch = text.match(/\(([^)]+)\)$/);
  if (parenMatch) {
    return parenMatch[1].trim();
  }
  return undefined;
}

function stripTags(value: string): string {
  return value.replace(TAG_RE, " ");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#8217;|&#039;/g, "'")
    .replace(/&#038;|&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(WHITESPACE_RE, " ")
    .trim();
}
