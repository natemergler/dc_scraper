export function containsLocalPath(content: string): boolean {
  const decoded = repeatedlyDecodeURIComponent(content).replaceAll("\\", "/");
  return /\bfile:/i.test(decoded) ||
    /\b[a-z]:\/Users\//i.test(decoded) ||
    /(^|[^a-z])\/Users\/[^"',\s]+/i.test(decoded) ||
    /(^|[^a-z])\/(?:tmp|var(?:\/home|\/tmp)?|home|root|etc|opt|mnt|Volumes|private\/(?:tmp|var|etc))\/[^"',\s]+/i
      .test(decoded);
}

export function isPublicHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = repeatedlyDecodeURIComponent(value).replaceAll("\\", "/");
  if (/^[a-z]:\//i.test(normalized) || normalized.startsWith("/") || /\bfile:/i.test(normalized)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      isPublicHostname(url.hostname);
  } catch {
    return false;
  }
}

export function toPublicHttpUrl(
  baseUrl: string,
  maybeRelative: string | undefined,
): string | undefined {
  const raw = maybeRelative?.trim();
  if (!raw || containsLocalPath(raw)) return undefined;
  let url: URL;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return undefined;
  }
  const href = url.toString();
  return isPublicHttpUrl(href) ? href : undefined;
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return false;
  }
  if (host.endsWith(".internal") || (!host.includes(".") && !host.includes(":"))) {
    return false;
  }
  if (isPrivateIpv4Host(host)) return false;
  if (isPrivateIpv6Host(host)) return false;
  return true;
}

function isPrivateIpv4Host(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

function isPrivateIpv6Host(host: string): boolean {
  if (!host.includes(":")) return false;
  return host === "::" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    host.startsWith("::ffff:") ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd");
}

function repeatedlyDecodeURIComponent(value: string): string {
  let decoded = value;
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}
