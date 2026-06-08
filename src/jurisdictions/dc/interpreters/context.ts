export interface DcInterpreterContext {
  agencyLookup?: Map<string, string>;
}

export function fileSafeLedgerId(input: string): string {
  return encodeURIComponent(input).replace(/%/g, "~");
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
