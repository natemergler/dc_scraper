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
  description?: string;
  officialUrl?: string;
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
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\(?202\)?[-. ]?)?[0-9]{3}[-. ]?[0-9]{4}/;

const VIEW_STATUTE_WITH_LINK_RE =
  /<div class="views-field[^"]*views-field-field-statute-mayors-order[^"]*"[^>]*>\s*<span class="field-content"><a\s+href="([^"]+)"[^>]*>(.*?)<\/a><\/span>\s*<\/div>/gs;
const VIEW_STATUTE_RE =
  /<div class="views-field[^"]*views-field-field-statute-mayors-order[^"]*"[^>]*>\s*<span class="field-content">(.*?)<\/span>\s*<\/div>/gs;

const DETAIL_FIELD_RE = /<h3[^>]*>\s*([^<]+)\s*<\/h3>\s*<p[^>]*>(.*?)<\/p>/gs;
const DETAIL_FIELD_WITH_LINK_RE =
  /<h3[^>]*>\s*([^<]+)\s*<\/h3>\s*<p[^>]*><a\s+href="([^"]+)"[^>]*>(.*?)<\/a><\/p>/gs;

const DRUPAL_FIELD_WITH_LINK_RE =
  /<div class="field-label">\s*([^<]+?):?(?:&nbsp;)?\s*<\/div>\s*<div class="field-items">\s*<div class="field-item[^"]*">\s*<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>\s*<\/div>/gs;
const DRUPAL_FIELD_RE =
  /<div class="field-label">\s*([^<]+?):?(?:&nbsp;)?\s*<\/div>\s*<div class="field-items">\s*<div class="field-item[^"]*">(.*?)<\/div>/gs;
const PARAGRAPH_RE = /<p[^>]*>([\s\S]*?)<\/p>/gi;

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
          description: detailFields.description,
          officialUrl: detailFields.officialUrl,
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
            description: detailFields.description,
            officialUrl: detailFields.officialUrl,
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
    const detailUrl = resolveOpenDcUrl(rawHref);
    if (!detailUrl || !isPublicBodyDetailUrl(detailUrl)) {
      continue;
    }
    const text = decodeHtml(stripTags(match[2]).trim());
    const slug = extractSlugFromUrl(detailUrl);
    if (!slug || seen.has(slug)) {
      continue;
    }
    if (isNonBodyIndexLink(text)) {
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

function isNonBodyIndexLink(name: string): boolean {
  return /\(\s*recess\s*\)/i.test(name);
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
  description?: string;
  officialUrl?: string;
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
      const sanitizedUrl = value.url ? sanitizeSourceUrl(value.url) : undefined;
      fields[normalized] = {
        text: value.text,
        ...(sanitizedUrl ? { url: sanitizedUrl } : {}),
      };
    }
  }

  for (const match of html.matchAll(VIEW_STATUTE_WITH_LINK_RE)) {
    const fieldValue = decodeHtml(stripTags(match[2]).trim());
    setField("Enabling Statute / Mayoral Order", { text: fieldValue, url: match[1] });
  }

  for (const match of html.matchAll(VIEW_STATUTE_RE)) {
    const normalized = resolveFieldAlias(normalizeFieldName("Enabling Statute / Mayoral Order"));
    if (fields[normalized]) {
      continue;
    }
    const fieldValue = decodeHtml(stripTags(match[1]).trim());
    setField("Enabling Statute / Mayoral Order", { text: fieldValue });
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

  const enablingStatuteField = fields["enabling statute or mayoral order"];
  const enablingStatute = sanitizeEnablingStatuteText(enablingStatuteField?.text);
  const paragraphBeforeMembersHtml = extractLastParagraphBeforeMembersHtml(html);
  const officialUrl = extractOfficialUrl(
    fields["public body website"]?.text,
    fields["public body website"]?.url,
  ) ?? extractOfficialUrl(fields["agency website"]?.text, fields["agency website"]?.url) ??
    extractOfficialUrlFromHtml(paragraphBeforeMembersHtml);
  const description = extractDescription(paragraphBeforeMembersHtml);

  return {
    description,
    officialUrl,
    enablingStatute,
    enablingStatuteUrl: enablingStatute ? enablingStatuteField?.url : undefined,
    governingAgency: extractAgencyName(fields["governing agency or agency acronym"]?.text),
    governingAgencyAcronym: extractAcronym(fields["governing agency or agency acronym"]?.text),
    administeringAgency: extractAgencyName(fields["administering agency"]?.text),
  };
}

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(WHITESPACE_RE, " ").trim();
}

function sanitizeSourceUrl(url: string): string | undefined {
  const decoded = decodeRepeatedly(url).toLowerCase().replace(/\\/g, "/");
  if (
    decoded.includes("file:///") ||
    decoded.includes("/users/") ||
    /^[a-z]:\//.test(decoded)
  ) {
    return undefined;
  }
  return url;
}

function sanitizeEnablingStatuteText(text?: string): string | undefined {
  if (!text) {
    return undefined;
  }
  if (/^(?:n\/?a|none)$/i.test(text.trim())) {
    return undefined;
  }
  if (/\b(?:meeting|agenda)\s*#?\d+\b/i.test(text)) {
    return undefined;
  }
  return text;
}

function extractOfficialUrl(text?: string, url?: string): string | undefined {
  const candidate = sanitizeSourceUrl(url ?? text ?? "");
  if (!candidate) {
    return undefined;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function extractOfficialUrlFromHtml(fragment?: string): string | undefined {
  if (!fragment) {
    return undefined;
  }

  const hrefMatch = fragment.match(/<a\s+href="([^"]+)"/i);
  if (hrefMatch) {
    return extractOfficialUrl(undefined, hrefMatch[1]);
  }

  const text = decodeHtml(stripTags(fragment)).replace(WHITESPACE_RE, " ").trim();
  const urlMatch = text.match(/https?:\/\/\S+/i);
  if (!urlMatch) {
    return undefined;
  }

  return extractOfficialUrl(urlMatch[0]);
}

function extractDescription(fragment?: string): string | undefined {
  if (!fragment) {
    return undefined;
  }

  return sanitizeOpenDCPublicBodyDescriptionText(
    decodeHtml(stripTags(fragment)).replace(WHITESPACE_RE, " ").trim(),
  );
}

function extractLastParagraphBeforeMembersHtml(html: string): string | undefined {
  const membersMatch = html.match(
    /(?:<h3[^>]*>\s*Members\s*<\/h3>|<div class="field-label">\s*Members:&nbsp;\s*<\/div>|<h2>\s*Meetings\s*<\/h2>)/i,
  );
  const boundaryIndex = membersMatch?.index ?? html.length;
  const relevantHtml = html.slice(0, boundaryIndex);
  const paragraphs = [...relevantHtml.matchAll(PARAGRAPH_RE)];
  if (paragraphs.length === 0) {
    return undefined;
  }
  return paragraphs.at(-1)?.[1];
}

export function sanitizeOpenDCPublicBodyDescriptionText(text?: string): string | undefined {
  if (!text) {
    return undefined;
  }

  if (
    /^this website requires a browser feature called javascript/i.test(text) ||
    /^point of contact:/i.test(text) ||
    /^public body website:/i.test(text) ||
    /^agency website:/i.test(text) ||
    /^report website problems to:/i.test(text)
  ) {
    return undefined;
  }

  const withoutContactSentences = text
    .replace(/\bAll (?:Board )?correspondence should be sent to[^.]*\.?/gi, "")
    .replace(/\bFor additional information,\s*email\s+[^.]*\.?/gi, "")
    .replace(
      /\bFor questions[^.]*\b(?:phone|fax|email|contact|\(?202\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4})[^.]*\.?/gi,
      "",
    )
    .replace(/\bThe Board can be reached by phone:[^.]*\.?/gi, "")
    .replace(/\b(?:phone|fax|email):?\s*[A-Za-z0-9._%+@() -]+\b\.?/gi, "")
    .replace(EMAIL_RE, "")
    .replace(PHONE_RE, "")
    .replace(WHITESPACE_RE, " ")
    .replace(/\s+\./g, ".")
    .replace(/(?:\.\s*){2,}/g, ". ")
    .trim();

  if (/\b(phone|fax|email|correspondence)\b/i.test(withoutContactSentences)) {
    return undefined;
  }

  const description = withoutContactSentences.replace(/\s+Learn more about [^.]+\.?$/i, "")
    .trim();
  return description.length >= 40 ? description : undefined;
}

function decodeRepeatedly(value: string): string {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        return decoded;
      }
      current = decoded;
    } catch {
      return current;
    }
  }
  return current;
}

function resolveOpenDcUrl(href: string): string | null {
  try {
    return new URL(href, "https://www.open-dc.gov").toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function isPublicBodyDetailUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    return segments.length === 2 && segments[0] === "public-bodies" && segments[1] !== "meetings";
  } catch {
    return false;
  }
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
    .replace(/&#167;|&sect;/g, "§")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(WHITESPACE_RE, " ")
    .trim();
}
