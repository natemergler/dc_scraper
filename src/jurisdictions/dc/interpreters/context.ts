export interface DcInterpreterContext {
  agencyLookup?: Map<string, string>;
  publicBodyLookup?: Map<string, { provisionalId: string; sourceRecordId: string }>;
  councilmemberLookup?: Map<string, { provisionalId: string; sourceRecordId: string }>;
}

export function publicBodyLookupKey(kind: string, name: string): string {
  return `${kind}:${normalizeAgencyLookupKey(name)}`;
}

export function fileSafeLedgerId(input: string): string {
  return encodeURIComponent(input).replace(/~/g, "~7E").replace(/%/g, "~");
}

export function normalizeAgencyLookupKey(input: string): string {
  const lowered = input.trim().toLowerCase();
  const withAndExpansion = lowered
    .replace(/&/g, " and ")
    .replace(/\bdept\b/g, "department")
    .replace(/\bdept\./g, "department");

  const cleaned = withAndExpansion
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}
