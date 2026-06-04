import { normalizeName } from "../domain.ts";

export const DC_LAW_INDEX_URL =
  "https://raw.githubusercontent.com/DCCouncil/law-html/master/index.json";

export interface DcLawTitleMatch {
  citation: string;
  title: string;
  url: string;
}

export class DcLawTitleIndex {
  readonly #byTitle = new Map<string, DcLawTitleMatch | null>();

  static fromJsonText(text: string): DcLawTitleIndex {
    return DcLawTitleIndex.fromJson(JSON.parse(text) as unknown);
  }

  static fromJson(root: unknown): DcLawTitleIndex {
    const index = new DcLawTitleIndex();
    for (const node of lawIndexNodes(root)) {
      const citation = lawCitation(node);
      const path = lawPath(node);
      if (!citation || !path) continue;
      const title = lawTitle(node, citation);
      if (!title) continue;
      const match = {
        citation,
        title,
        url: `https://code.dccouncil.gov${path}`,
      };
      index.#addTitle(title, match);
      index.#addTitle(`District of Columbia ${title}`, match);
    }
    return index;
  }

  matchTitle(value: string): DcLawTitleMatch | undefined {
    return this.#byTitle.get(lawTitleKey(value)) ?? undefined;
  }

  #addTitle(title: string, match: DcLawTitleMatch): void {
    const key = lawTitleKey(title);
    if (!this.#byTitle.has(key)) {
      this.#byTitle.set(key, match);
      return;
    }
    const existing = this.#byTitle.get(key);
    if (existing && existing.citation === match.citation && existing.url === match.url) return;
    this.#byTitle.set(key, null);
  }
}

export function looksLikeDcLawTitle(value: string): boolean {
  const normalized = normalizeName(value);
  return /\bAct of [12][0-9]{3}\b/i.test(normalized) &&
    !/\bD\.?\s*C\.?\s+(?:Law|Act)\s+[0-9]{1,2}-[0-9]{1,4}\b/i.test(normalized);
}

function* lawIndexNodes(root: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(root)) {
    for (const item of root) yield* lawIndexNodes(item);
    return;
  }
  if (!root || typeof root !== "object") return;
  const node = root as Record<string, unknown>;
  yield node;
  const children = node.c;
  if (!Array.isArray(children)) return;
  for (const child of children) yield* lawIndexNodes(child);
}

function lawCitation(node: Record<string, unknown>): string | undefined {
  const source = maybeString(node.sc ?? node.citation);
  if (!source) return undefined;
  const match = source.match(/\bD\.?\s*C\.?\s+Law\s+([0-9]{1,2}-[0-9]{1,4})\b/i);
  return match ? `D.C. Law ${match[1]}` : undefined;
}

function lawPath(node: Record<string, unknown>): string | undefined {
  const path = maybeString(node.p ?? node.path);
  return path?.match(/^\/us\/dc\/council\/laws\/[0-9]{1,2}-[0-9]{1,4}$/) ? path : undefined;
}

function lawTitle(node: Record<string, unknown>, citation: string): string | undefined {
  const explicit = maybeString(node.heading ?? node.title);
  if (explicit) return titleWithoutCitationPrefix(explicit, citation);
  const combined = maybeString(node.t);
  if (!combined) return undefined;
  return titleWithoutCitationPrefix(combined, citation);
}

function lawTitleKey(value: string): string {
  return stripTitlePunctuation(normalizeName(value)).toLowerCase();
}

function stripTitlePunctuation(value: string): string {
  return value.replace(/\.$/, "").trim();
}

function titleWithoutCitationPrefix(value: string, citation: string): string {
  return stripTitlePunctuation(
    value.replace(new RegExp(`^${escapeRegExp(citation)}\\.?\\s*`, "i"), ""),
  );
}

function maybeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
