import {
  type Reader,
  type ReaderInput,
  type ReaderResult,
  type ReaderResultRecord,
  type ReaderResultSnapshot,
  type ReaderSource,
} from "./types.ts";

export interface DCCouncilmembersSource extends ReaderSource {
  type: "dccouncil.members";
  rosterUrl: string;
}

export interface DCCouncilmembersReaderOptions {
  fetcher?: (input: string) => Promise<Response>;
}

const PROFILE_LINK_RE =
  /href="(https:\/\/dccouncil\.gov\/council\/([^"#?]+)\/)"[^>]*>([^<]+)<\/a>/g;
const TAG_RE = /<[^>]+>/g;

export class DCCouncilmembersReader implements Reader<DCCouncilmembersSource> {
  private readonly fetcher: (input: string) => Promise<Response>;

  constructor(options: DCCouncilmembersReaderOptions = {}) {
    this.fetcher = options.fetcher ?? ((input: string) => fetch(input));
  }

  async collect(input: ReaderInput<DCCouncilmembersSource>): Promise<ReaderResult> {
    const response = await this.fetcher(input.source.rosterUrl);
    const html = await response.text();
    if (!response.ok) {
      throw new Error(
        `Councilmembers request failed for ${input.source.id}: HTTP ${response.status}`,
      );
    }

    const records: ReaderResultRecord[] = [];
    const snapshots: ReaderResultSnapshot[] = [{
      source: input.source.id,
      key: "page-0",
      payload: {
        source: input.source.id,
        url: input.source.rosterUrl,
      },
    }];

    const seen = new Set<string>();
    for (const match of html.matchAll(PROFILE_LINK_RE)) {
      const profileUrl = match[1];
      const profileSlug = match[2];
      const name = decodeHtml(stripTags(match[3]).trim());
      if (seen.has(profileSlug)) {
        continue;
      }
      seen.add(profileSlug);
      records.push({
        source: input.source.id,
        snapshotKey: "page-0",
        key: profileSlug,
        payload: {
          memberName: name,
          profileSlug,
          profileUrl,
        },
      });
      if (typeof input.limit === "number" && records.length >= input.limit) {
        break;
      }
    }

    return { snapshots, records };
  }
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
