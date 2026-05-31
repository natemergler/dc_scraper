export function toCsv(records: Record<string, unknown>[]): string {
  const fields = Array.from(new Set(records.flatMap((record) => Object.keys(record)))).sort();
  if (fields.length === 0) return "";
  const lines = [fields.map(csvEscape).join(",")];
  for (const record of records) {
    lines.push(fields.map((field) => csvEscape(flattenValue(record[field]))).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function flattenValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
