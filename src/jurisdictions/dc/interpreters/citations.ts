import { type CitationValue, cite } from "../../../core/types.ts";

const LEGAL_TEXT_FIELDS = new Set<string>([
  "LEGAL_BASIS",
  "LEGAL_AUTHORITY",
  "STATUTE",
  "LEGAL_CITATION",
  "LEGAL_REFERENCE",
  "ENACTMENT",
  "CITATION",
  "LAW",
]);

const SECTION_CHARS = String.raw`[0-9A-Za-z.\-\u2013\u2014]`;

const D_C_CODE = new RegExp(
  String.raw`D\.?\s*C\.?\s*Code\s*(?:§|Sections?)?\s*[0-9]${SECTION_CHARS}*(?:\([^)]+\))*`,
  "gi",
);
const D_C_OFFICIAL_CODE = new RegExp(
  String
    .raw`D\.?\s*C\.?\s*Official\s+Code\s*(?:§|Sections?)?\s*[0-9]${SECTION_CHARS}*(?:\([^)]+\))*`,
  "gi",
);
const D_C_MUNICIPAL_REGS = new RegExp(
  String
    .raw`D\.?\s*C\.?\s*Municipal\s+Regulations\s*(?:§|Sections?)?\s*[0-9]${SECTION_CHARS}*(?:\([^)]+\))*`,
  "gi",
);
const D_C_SECTION_LIST =
  /D\.?\s*C\.?\s*(?:Official\s+Code|Code|Municipal\s+Regulations)\s*§{2}\s*[0-9][0-9A-Za-z.\-\u2013\u2014\s,()]+/gi;
const D_C_NO_SECTION_LIST =
  /D\.?\s*C\.?\s*(?:Official\s+Code|Code|Municipal\s+Regulations)\s*(?!§)\s*[0-9][^!?]*/gi;
const D_C_SINGLE_RANGE =
  /D\.?\s*C\.?\s*(?:Official\s+Code|Code|Municipal\s+Regulations)\s*(?:§|Sections?)?\s*[0-9][0-9A-Za-z.\-\u2013\u2014]+(?:\([^)]+\))*(?:\s*(?:[\u2013\u2014]|-(?=[0-9])|\s+(?:to|through)\s+)[0-9][0-9A-Za-z.\-\u2013\u2014]+(?:\([^)]+\))*)/gi;
const CFR_PATTERN = /\b\d+\s*CFR\s*§?\s*[0-9][0-9A-Za-z.\-]*(?:\([^)]+\))*(?!\()/gi;
const CFR_SINGLE_RANGE =
  /\b\d+\s*CFR\s*§?\s*[0-9]+(?:\.[0-9]+)*(?:\([^)]+\))*\s*(?:[\u2013\u2014]|-(?=[0-9])|\s+(?:to|through)\s+)[0-9]+(?:\.[0-9]+)*(?:\([^)]+\))*\b/gi;
const CFR_SECTION_LIST = /\b\d+\s*CFR\s*§{2}\s*[0-9][0-9A-Za-z.\-\s,()]+/gi;
// Match CFR citations without § that contain one or more section items.
const CFR_NO_SECTION_LIST = /\b\d+\s*CFR\s*(?!§)\s*[0-9][^!?]*/gi;
const USC_PATTERN = /\b\d+\s*U\.?S\.?C\.?\s*§?\s*[0-9]+[0-9A-Za-z.\-]*(?:\([^)]+\))*/gi;
const US_CODE_PATTERN = /\b\d+\s*U\.?S\.?\s*Code\s*§?\s*[0-9]+[0-9A-Za-z.\-]*(?:\([^)]+\))*/gi;
const MAYORS_ORDER_PATTERN = /\bMayor(?:'|’)?s\s+Order\s+\d{4}-\d{1,4}\b/gi;
const USC_SINGLE_RANGE =
  /\b\d+\s*U\.?S\.?C\.?\s*§?\s*[0-9]+(?:\.[0-9]+)*(?:\([^)]+\))*\s*(?:[\u2013\u2014]|-(?=[0-9])|\s+(?:to|through)\s+)[0-9]+(?:\.[0-9]+)*(?:\([^)]+\))*\b/gi;
const USC_SECTION_LIST = /\b\d+\s*U\.?S\.?C\.?\s*§{2}\s*[0-9][0-9A-Za-z.\-\s,()]+/gi;
// Match U.S.C. citations without § that contain one or more section items.
const USC_NO_SECTION_LIST = /\b\d+\s*U\.?S\.?C\.?\s*(?!§)\s*[0-9][^!?]*/gi;

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeKey(key: string): string {
  return key.trim().toUpperCase().replace(/\s+/g, "_");
}

function extractFromPattern(text: string, pattern: RegExp): string[] {
  const results: string[] = [];
  const normalized = text.replace(/\s+/g, " ").trim();
  const matches = normalized.match(pattern);
  if (!matches) {
    return [];
  }
  for (const match of matches) {
    const normalizedMatch = match
      .replace(/\s+/g, " ")
      .trim()
      .replace(/(?<=[0-9])[\u2013\u2014](?=[0-9])/g, "-")
      .replace(/[.,;:]+$/g, "");
    if (normalizedMatch.length > 0) {
      results.push(normalizedMatch);
    }
  }
  return results;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function expandCitationRange(locator: string): string[] {
  const dcRangeMatch = expandDCCitationRange(locator);
  if (dcRangeMatch) {
    return dcRangeMatch;
  }

  const uscRangeMatch = locator.match(
    /^(\d+)\s*U\.?S\.?C\.?\s*§?\s*([0-9]+(?:\.[0-9]+)*(?:\([^)]+\))*)(?:[\u2013\u2014]|-(?=[0-9])|\s+(?:to|through)\s+)([0-9]+(?:\.[0-9]+)*(?:\([^)]+\))*)$/i,
  );
  if (uscRangeMatch) {
    return [
      `${uscRangeMatch[1]} U.S.C. § ${uscRangeMatch[2].trim()}`,
      `${uscRangeMatch[1]} U.S.C. § ${uscRangeMatch[3].trim()}`,
    ];
  }

  const cfrRangeMatch = locator.match(
    /^(\d+)\s*CFR\s*§?\s*([0-9]+(?:\.[0-9]+)*(?:\([^)]+\))*)(?:[\u2013\u2014]|-(?=[0-9])|\s+(?:to|through)\s+)([0-9]+(?:\.[0-9]+)*(?:\([^)]+\))*)$/i,
  );
  if (cfrRangeMatch) {
    return [
      `${cfrRangeMatch[1]} CFR ${cfrRangeMatch[2].trim()}`,
      `${cfrRangeMatch[1]} CFR ${cfrRangeMatch[3].trim()}`,
    ];
  }

  return [locator];
}

function expandDCCitationRange(locator: string): string[] | null {
  const spacedRangeMatch = locator.match(
    /^(D\.\s*C\.\s*(?:Official\s+Code|Code|Municipal\s+Regulations))\s*([0-9][0-9A-Za-z.\-]+(?:\([^)]+\))*)\s*(?:[\u2013\u2014]|-(?=\s+)|\s+(?:to|through)\s+)\s*([0-9][0-9A-Za-z.\-]+(?:\([^)]+\))*)$/i,
  );
  if (spacedRangeMatch && spacedRangeMatch[2] && spacedRangeMatch[3]) {
    const prefix = spacedRangeMatch[1].replace(/\s+/g, " ").trim();
    return [
      `${prefix} § ${spacedRangeMatch[2].trim()}`,
      `${prefix} § ${spacedRangeMatch[3].trim()}`,
    ];
  }

  const compactRangeMatch = locator.match(
    /^(D\.\s*C\.\s*(?:Official\s+Code|Code|Municipal\s+Regulations))\s*([0-9]+-[0-9][0-9A-Za-z.\-]*?(?:\([^)]+\))*)\s*-\s*([0-9]+-[0-9][0-9A-Za-z.\-]*?(?:\([^)]+\))*)$/i,
  );
  if (compactRangeMatch) {
    const leftPrefix = compactRangeMatch[2]?.split("-")[0];
    const rightPrefix = compactRangeMatch[3]?.split("-")[0];
    if (!leftPrefix || !rightPrefix || leftPrefix !== rightPrefix) {
      return null;
    }
    const prefix = compactRangeMatch[1].replace(/\s+/g, " ").trim();
    return [
      `${prefix} § ${compactRangeMatch[2].trim()}`,
      `${prefix} § ${compactRangeMatch[3].trim()}`,
    ];
  }

  return null;
}

function normalizeSingleCitation(locator: string): string[] {
  const mayorOrderMatch = locator.match(
    /^Mayor(?:'|’)?s\s+Order\s+(\d{4}-\d{1,4})$/i,
  );
  if (mayorOrderMatch) {
    return [`Mayor's Order ${mayorOrderMatch[1]}`];
  }

  const usCodeMatch = locator.match(
    /^([0-9]+)\s*U\.?S\.?\s*Code\s*§?\s*([0-9][0-9A-Za-z.\-]*(?:\([^)]+\))*)$/i,
  );
  if (usCodeMatch) {
    return [`${usCodeMatch[1]} U.S.C. § ${usCodeMatch[2].trim()}`];
  }

  if (locator.includes("§")) {
    return [locator];
  }

  const dcRangeMatch = locator.match(
    /^(D\.?\s*C\.?\s*(?:Official\s+Code|Code|Municipal\s+Regulations))\s*(?:§|Sections?)?\s*([0-9][0-9A-Za-z.\-]+(?:\([^)]+\))*)\s+(?:to|through)\s+([0-9][0-9A-Za-z.\-]+(?:\([^)]+\))*)$/i,
  );
  if (dcRangeMatch && dcRangeMatch[1] && dcRangeMatch[2] && dcRangeMatch[3]) {
    const prefix = dcRangeMatch[1].replace(/\s+/g, " ").trim();
    return [
      `${prefix} § ${dcRangeMatch[2].trim()}`,
      `${prefix} § ${dcRangeMatch[3].trim()}`,
    ];
  }

  const rangeExpanded = expandCitationRange(locator);
  if (rangeExpanded.length > 1 || rangeExpanded[0] !== locator) {
    return rangeExpanded;
  }

  const dcMatch = locator.match(
    /^(D\.?\s*C\.?\s*(?:Official\s+Code|Code|Municipal\s+Regulations))\s*(?:§|Sections?)?\s*([0-9][0-9A-Za-z.\-]*(?:\([^)]+\))*)$/i,
  );
  if (dcMatch) {
    return [`${dcMatch[1].replace(/\s+/g, " ").trim()} § ${dcMatch[2].trim()}`];
  }

  const uscMatch = locator.match(
    /^([0-9]+)\s*U\.?S\.?C\.?\s*([0-9][0-9A-Za-z.\-]*(?:\([^)]+\))*)$/i,
  );
  if (uscMatch) {
    return [`${uscMatch[1]} U.S.C. § ${uscMatch[2].trim()}`];
  }

  return [locator];
}
function parseDCCitationSectionList(rawPrefix: string, sectionList: string): string[] {
  return parseCitationSectionListPieces(
    sectionList,
    (section) => `${rawPrefix} § ${section}`,
  );
}

function parseCitationSectionListPieces(
  sectionList: string,
  formatSection: (section: string) => string,
): string[] {
  const sections: string[] = [];
  const cleanedSections = sectionList
    .replace(/;/g, ",")
    .replace(/\band\b/gi, ",")
    .replace(/\s+and\s+/gi, ",");
  const pieces = cleanedSections
    .split(",")
    .map((piece) => piece.trim().replace(/\s+/g, " "))
    .map((piece) => piece.replace(/[.,;:]+$/g, ""))
    .filter((piece) => piece.length > 0);

  let lastBaseSection: string | null = null;
  for (const piece of pieces) {
    const normalizedPiece = piece.replace(/\s+/g, " ");
    const shorthandMatch = normalizedPiece.match(/^\(([^)]+)\)$/);
    if (shorthandMatch && shorthandMatch[1] && lastBaseSection) {
      sections.push(formatSection(`${lastBaseSection}(${shorthandMatch[1].trim()})`));
      continue;
    }

    const dashRangeMatch = normalizedPiece.match(
      /^([0-9][0-9A-Za-z.\-]*)\s*[–—]\s*([0-9][0-9A-Za-z.\-]*)$/i,
    );
    if (dashRangeMatch && dashRangeMatch[1] && dashRangeMatch[2]) {
      sections.push(formatSection(dashRangeMatch[1].trim()));
      sections.push(formatSection(dashRangeMatch[2].trim()));
      lastBaseSection = dashRangeMatch[2].trim();
      continue;
    }

    const toRangeMatch = normalizedPiece.match(
      /^([0-9][0-9A-Za-z.\-]*)\s+-\s+([0-9][0-9A-Za-z.\-]*)$/i,
    );
    if (toRangeMatch && toRangeMatch[1] && toRangeMatch[2]) {
      sections.push(formatSection(toRangeMatch[1].trim()));
      sections.push(formatSection(toRangeMatch[2].trim()));
      lastBaseSection = toRangeMatch[2].trim();
      continue;
    }

    const throughRangeMatch = normalizedPiece.match(
      /^([0-9][0-9A-Za-z.\-]*)\s+(?:to|through)\s+([0-9][0-9A-Za-z.\-]*)$/i,
    );
    if (throughRangeMatch && throughRangeMatch[1] && throughRangeMatch[2]) {
      sections.push(formatSection(throughRangeMatch[1].trim()));
      sections.push(formatSection(throughRangeMatch[2].trim()));
      lastBaseSection = throughRangeMatch[2].trim();
      continue;
    }

    if (/^[0-9][0-9A-Za-z.\-]*?(?:\([^)]+\))*$/i.test(normalizedPiece)) {
      sections.push(formatSection(normalizedPiece));
      lastBaseSection = normalizedPiece.replace(/\([^)]+\)$/, "").trim();
    }
  }

  return sections;
}

function extractDCCitationSectionList(match: string): string[] {
  const normalized = match.replace(/\s+/g, " ").trim();
  const listMatch = normalized.match(
    /^(\D*D\.?\s*C\.?\s*(?:Official\s+Code|Code|Municipal\s+Regulations))\s*§{2}\s*(.+)$/i,
  );
  if (!listMatch) {
    return [normalized];
  }
  return parseDCCitationSectionList(
    listMatch[1].replace(/\s+/g, " ").trim(),
    listMatch[2],
  );
}

function extractDCCitationSectionListWithoutSymbol(match: string): string[] {
  const normalized = match.replace(/\s+/g, " ").trim();
  const segments = normalized.split(
    /(?=D\.?\s*C\.?\s*(?:Official\s+Code|Code|Municipal\s+Regulations))/gi,
  );
  const sections: string[] = [];
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    const listMatch = trimmed.match(
      /^(\D*D\.?\s*C\.?\s*(?:Official\s+Code|Code|Municipal\s+Regulations))\s+(.+)$/i,
    );
    if (!listMatch) {
      continue;
    }
    const sectionList = listMatch[2];
    if (!/[,;]|\band\b/i.test(sectionList)) {
      continue;
    }
    sections.push(
      ...parseDCCitationSectionList(
        listMatch[1].replace(/\s+/g, " ").trim(),
        sectionList,
      ),
    );
  }

  return sections;
}

function extractUSCSectionList(match: string): string[] {
  const normalized = match.replace(/\s+/g, " ").trim();
  const listMatch = normalized.match(
    /^(\d+)\s*U\.?S\.?C\.?\s*§{2}\s*(.+)$/i,
  );
  if (!listMatch || !listMatch[1] || !listMatch[2]) {
    return [normalized];
  }
  const title = listMatch[1];
  return parseCitationSectionListPieces(
    listMatch[2],
    (section) => `${title} U.S.C. § ${section}`,
  );
}

function extractUSCSectionListWithoutSymbol(match: string): string[] {
  return extractNoSymbolCitationSectionList(
    match,
    /(?=\b\d+\s*U\.?S\.?C\.?\s*)/gi,
    /^(\d+)\s*U\.?S\.?C\.?\s+(.+)$/i,
    (title) => (section) => `${title} U.S.C. § ${section}`,
  );
}

function extractCFRSectionList(match: string): string[] {
  const normalized = match.replace(/\s+/g, " ").trim();
  const listMatch = normalized.match(
    /^(\d+)\s*CFR\s*§{2}\s*(.+)$/i,
  );
  if (!listMatch || !listMatch[1] || !listMatch[2]) {
    return [normalized];
  }
  const title = listMatch[1];
  return parseCitationSectionListPieces(
    listMatch[2],
    (section) => `${title} CFR ${section}`,
  );
}

function extractCFRSectionListWithoutSymbol(match: string): string[] {
  return extractNoSymbolCitationSectionList(
    match,
    /(?=\b\d+\s*CFR\s*)/gi,
    /^(\d+)\s*CFR\s+(.+)$/i,
    (title) => (section) => `${title} CFR ${section}`,
  );
}

function extractNoSymbolCitationSectionList(
  match: string,
  splitByPrefix: RegExp,
  listMatchPattern: RegExp,
  formatByTitle: (title: string) => (section: string) => string,
): string[] {
  const normalized = match.replace(/\s+/g, " ").trim();
  const sections: string[] = [];
  const segments = normalized.split(splitByPrefix);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }

    const listMatch = trimmed.match(listMatchPattern);
    if (!listMatch || !listMatch[1] || !listMatch[2]) {
      continue;
    }

    const title = listMatch[1];
    const sectionList = listMatch[2];
    if (!/[,;]|\band\b/i.test(sectionList)) {
      continue;
    }

    sections.push(
      ...parseCitationSectionListPieces(sectionList, formatByTitle(title)),
    );
  }

  return sections;
}

function mergeUniqueCitationValues(values: CitationValue[]): CitationValue[] {
  const seen = new Set<string>();
  const out: CitationValue[] = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

export function parseLegalCitationLocators(payload: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const locators: string[] = [];
  for (const [rawKey, value] of Object.entries(payload)) {
    const key = normalizeKey(rawKey);
    if (!LEGAL_TEXT_FIELDS.has(key)) {
      continue;
    }
    const text = asString(value);
    if (!text) {
      continue;
    }
    const matches = [
      ...extractFromPattern(text, D_C_SECTION_LIST)
        .flatMap((match) => extractDCCitationSectionList(match)),
      ...extractFromPattern(text, D_C_NO_SECTION_LIST)
        .flatMap((match) => extractDCCitationSectionListWithoutSymbol(match)),
      ...extractFromPattern(text, USC_NO_SECTION_LIST)
        .flatMap((match) => extractUSCSectionListWithoutSymbol(match)),
      ...extractFromPattern(text, USC_SECTION_LIST)
        .flatMap((match) => extractUSCSectionList(match)),
      ...extractFromPattern(text, CFR_NO_SECTION_LIST)
        .flatMap((match) => extractCFRSectionListWithoutSymbol(match)),
      ...extractFromPattern(text, CFR_SECTION_LIST)
        .flatMap((match) => extractCFRSectionList(match)),
      ...extractFromPattern(text, D_C_SINGLE_RANGE),
      ...extractFromPattern(text, D_C_OFFICIAL_CODE),
      ...extractFromPattern(text, D_C_CODE),
      ...extractFromPattern(text, D_C_MUNICIPAL_REGS),
      ...extractFromPattern(text, CFR_SINGLE_RANGE),
      ...extractFromPattern(text, USC_SINGLE_RANGE),
      ...extractFromPattern(text, CFR_PATTERN),
      ...extractFromPattern(text, USC_PATTERN),
      ...extractFromPattern(text, US_CODE_PATTERN),
      ...extractFromPattern(text, MAYORS_ORDER_PATTERN),
    ];
    for (const match of matches) {
      const normalizedLocators = normalizeSingleCitation(match);
      for (const normalizedLocator of normalizedLocators) {
        if (!seen.has(normalizedLocator)) {
          seen.add(normalizedLocator);
          locators.push(normalizedLocator);
        }
      }
    }
  }
  return uniqueSorted(locators);
}

export function collectRecordCitations(
  source: string,
  sourceRecordId: string,
  payload: Record<string, unknown>,
): CitationValue[] {
  const citations = [
    cite(source, sourceRecordId),
    ...parseLegalCitationLocators(payload).map((locator) =>
      cite(source, sourceRecordId, { locator })
    ),
  ];
  return mergeUniqueCitationValues(citations);
}
