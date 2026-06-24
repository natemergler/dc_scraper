import {
  type Reader,
  type ReaderInput,
  type ReaderResult,
  type ReaderResultRecord,
  type ReaderResultSnapshot,
  type ReaderSource,
} from "./types.ts";

export interface DCCouncilCommitteePagesSource extends ReaderSource {
  type: "dccouncil.committees";
  indexUrl: string;
}

export interface DCCouncilCommitteePagesReaderOptions {
  fetcher?: (input: string) => Promise<Response>;
}

export interface DCCouncilCommitteeRecordPayload {
  committeeName: string;
  committeeSlug: string;
  committeeType: "committee" | "subcommittee";
  committeeUrl: string;
  chairpersonName: string | null;
  chairpersonUrl: string | null;
  councilmembers: Array<{
    name: string;
    url: string;
  }>;
}

const COMMITTEE_LINK_RE =
  /href="(https:\/\/dccouncil\.gov\/committees\/([^"#?]+)\/)"[^>]*>([^<]+)<\/a>/g;
const TAG_RE = /<[^>]+>/g;

export class DCCouncilCommitteePagesReader implements Reader<DCCouncilCommitteePagesSource> {
  private readonly fetcher: (input: string) => Promise<Response>;

  constructor(options: DCCouncilCommitteePagesReaderOptions = {}) {
    this.fetcher = options.fetcher ?? ((input: string) => fetch(input));
  }

  async collect(input: ReaderInput<DCCouncilCommitteePagesSource>): Promise<ReaderResult> {
    const indexHtml = await this.fetchHtml(input.source.id, input.source.indexUrl);
    const committees = extractCommitteeLinks(indexHtml, input.limit);

    const snapshots: ReaderResultSnapshot[] = [
      {
        source: input.source.id,
        key: "index",
        payload: {
          source: input.source.id,
          url: input.source.indexUrl,
          total: committees.length,
        },
      },
    ];
    const records: ReaderResultRecord[] = [];

    for (let i = 0; i < committees.length; i += 1) {
      const committee = committees[i];
      const html = await this.fetchHtml(input.source.id, committee.url);
      const snapshotKey = `page-${i}`;
      snapshots.push({
        source: input.source.id,
        key: snapshotKey,
        payload: {
          source: input.source.id,
          url: committee.url,
          slug: committee.slug,
          committeeType: committee.type,
        },
      });

      records.push({
        source: input.source.id,
        snapshotKey,
        key: committee.slug,
        payload: {
          committeeName: extractTitle(html) ?? committee.name,
          committeeSlug: committee.slug,
          committeeType: committee.type,
          committeeUrl: committee.url,
          chairpersonName: extractChairpersonName(html),
          chairpersonUrl: extractChairpersonUrl(html),
          councilmembers: extractCouncilmembers(html),
        } satisfies DCCouncilCommitteeRecordPayload,
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
        `Council committee request failed for ${sourceId}: ${
          error instanceof Error ? error.message : "network error"
        }`,
      );
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Council committee request failed for ${sourceId}: HTTP ${response.status}`);
    }
    return body;
  }
}

function extractCommitteeLinks(
  html: string,
  limit?: number,
): Array<{ name: string; slug: string; type: "committee" | "subcommittee"; url: string }> {
  const committees: Array<
    { name: string; slug: string; type: "committee" | "subcommittee"; url: string }
  > = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(COMMITTEE_LINK_RE)) {
    const url = match[1];
    const slug = match[2];
    const name = decodeHtml(stripTags(match[3]).trim());
    if (seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    committees.push({
      name,
      slug,
      type: slug.startsWith("sub") ? "subcommittee" : "committee",
      url,
    });
    if (typeof limit === "number" && committees.length >= limit) {
      break;
    }
  }

  return committees;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<h1>(.*?)<\/h1>/s);
  return match ? decodeHtml(stripTags(match[1]).trim()) : null;
}

function extractChairpersonName(html: string): string | null {
  const block = extractCouncilmembersBlock(html);
  if (!block) {
    return null;
  }
  const match = block.match(/<h4>\s*Chairperson\s*<\/h4>\s*<p>\s*<a [^>]*>(.*?)<\/a>/s);
  return match ? decodeHtml(stripTags(match[1]).trim()) : null;
}

function extractChairpersonUrl(html: string): string | null {
  const block = extractCouncilmembersBlock(html);
  if (!block) {
    return null;
  }
  const match = block.match(/<h4>\s*Chairperson\s*<\/h4>\s*<p>\s*<a href="([^"]+)"/s);
  return match ? match[1] : null;
}

function extractCouncilmembers(html: string): Array<{ name: string; url: string }> {
  const block = extractCouncilmembersBlock(html);
  if (!block) {
    return [];
  }
  const membersMatch = block.match(
    /<h4>\s*Councilmembers\s*<\/h4>\s*<ul[^>]*>(.*?)<\/ul>/s,
  );
  if (!membersMatch) {
    return [];
  }

  const members: Array<{ name: string; url: string }> = [];
  const memberRe = /<a href="([^"]+)"[^>]*>(.*?)<\/a>/g;
  for (const match of membersMatch[1].matchAll(memberRe)) {
    members.push({
      url: match[1],
      name: decodeHtml(stripTags(match[2]).trim()),
    });
  }
  return members;
}

function extractCouncilmembersBlock(html: string): string | null {
  const match = html.match(/<h2>\s*Councilmembers\s*<\/h2>(.*?)<h2>/s);
  return match ? match[1] : null;
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
    .replace(/\s+/g, " ")
    .trim();
}
