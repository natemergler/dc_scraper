export interface DcInterpreterContext {
  agencyLookup?: Map<string, string>;
  agencyIdLookup?: Map<string, string>;
  agencyNameLookup?: Map<string, string>;
  publicBodyLookup?: Map<string, { provisionalId: string; sourceRecordId: string }>;
  councilmemberLookup?: Map<string, { provisionalId: string; sourceRecordId: string }>;
}

export function publicBodyLookupKey(kind: string, name: string): string {
  return `${kind}:${normalizeAgencyLookupKey(name)}`;
}

export function fileSafeLedgerId(input: string): string {
  return encodeURIComponent(input).replace(/~/g, "~7E").replace(/%/g, "~");
}

export function civicSlug(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return normalized.length > 0 ? normalized : fileSafeLedgerId(input.toLowerCase());
}

export function dcAgencyCanonicalId(name: string): string {
  return `dc.agency:${civicSlug(name)}`;
}

export function dcAgencyReferenceId(agencyIdOrCanonicalId: string): string {
  if (agencyIdOrCanonicalId.startsWith("dc.agency:")) {
    return agencyIdOrCanonicalId;
  }
  return `dc.agency:${agencyIdOrCanonicalId}`;
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
