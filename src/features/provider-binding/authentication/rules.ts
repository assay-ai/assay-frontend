import type { CredentialHeaderInput } from "@/interfaces/provider-bindings";

// Mirrored from the backend credential rules (credential-rules.ts). Keep in sync.
/** A name is flagged when a token (split on - and _) equals or ends with one of these. */
const SECRET_WORDS = [
  "key", "token", "secret", "password", "passwd", "auth", "authorization",
  "credential", "signature", "session", "cookie",
];
/** Short words that count only as a whole token (`sig`, not `config`). */
const SECRET_WHOLE_TOKENS = new Set(["sig"]);
/** Names that contain a secret word and are not secrets (`_` compared as `-`). */
const SECRET_NAME_ALLOW_LIST = new Set([
  "idempotency-key", "x-idempotency-key", "sort-key", "x-sort-key", "cache-key", "x-cache-key",
  "max-tokens", "keyword", "keywords",
]);

/** Whether a constant header name or query key looks like it carries a secret. */
export function looksLikeSecretName(name: string): boolean {
  const normalised = name.toLowerCase().replace(/_/g, "-");
  if (SECRET_NAME_ALLOW_LIST.has(normalised)) return false;
  return normalised
    .split("-")
    .filter((token) => token.length > 0)
    .some((token) => SECRET_WHOLE_TOKENS.has(token) || SECRET_WORDS.some((word) => token.endsWith(word)));
}
const RESERVED_HEADERS = new Set([
  "host", "content-length", "content-type", "transfer-encoding", "connection",
  "upgrade", "te", "trailer", "signature", "signature-input", "content-digest",
]);
const MAX_HEADERS = 10;
const MAX_NAME_LENGTH = 64;
const MAX_VALUE_BYTES = 4096;
/** Printable ASCII plus space and tab: what the backend accepts in a value. */
const PRINTABLE_ASCII = /^[\x20-\x7E\t]*$/;
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export const QUERY_KEY_ERROR =
  "Don't put keys in the URL. URLs are logged by proxies, CDNs and servers and leak through browser history. Add it under Authentication → API key instead.";
export const SECRET_HEADER_ERROR =
  "This looks like a secret. Mappings are stored in plain text — add it under Authentication → API key instead.";

export function isCredentialQueryKey(key: string): boolean {
  return looksLikeSecretName(key);
}

export function isSecretConstantHeader(name: string): boolean {
  return looksLikeSecretName(name);
}

export function credentialQueryKeys(endpoint: string): string[] {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const key of url.searchParams.keys()) {
    if (isCredentialQueryKey(key) && !found.includes(key)) found.push(key);
  }
  return found;
}

/**
 * "Move it to an API key header": the address without its credential-like
 * query parameters, and each one as a header to store instead. The values
 * only ever go to the write-only headers form; the address that is saved
 * never carries them.
 */
export function moveQueryKeys(endpoint: string): { endpoint: string; headers: CredentialHeaderInput[] } | null {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return null;
  }
  const headers: CredentialHeaderInput[] = [];
  for (const [key, value] of [...url.searchParams.entries()]) {
    if (!isCredentialQueryKey(key)) continue;
    if (!headers.some((header) => header.name === key)) headers.push({ name: key, value });
    url.searchParams.delete(key);
  }
  if (headers.length === 0) return null;
  // `URL` keeps a bare "?" once the last parameter is gone, and adds a "/" to
  // a bare origin: give the address back as the provider typed it.
  let text = url.href.replace(/\?$/, "");
  const typedHadPath = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+\//i.test(endpoint.trim());
  if (!typedHadPath && url.pathname === "/") text = text.replace(/\/(?=$|[?#])/, "");
  return { endpoint: text, headers };
}

function headerProblem(header: CredentialHeaderInput): string | null {
  const name = header.name.trim();
  if (name === "") return "Header name is required.";
  if (name.length > MAX_NAME_LENGTH) return `Header name is longer than ${MAX_NAME_LENGTH} characters.`;
  if (!TOKEN.test(name)) return "Header name has characters that are not allowed (no spaces or colons).";
  const lower = name.toLowerCase();
  if (RESERVED_HEADERS.has(lower) || lower.startsWith("x-assay-")) return `${name} is set by Assay and cannot be overridden.`;
  if (header.value === "") return "Header value is required.";
  if (/[\r\n]/.test(header.value)) return "Header value cannot contain line breaks.";
  if (!PRINTABLE_ASCII.test(header.value)) return "Use plain ASCII characters only.";
  if (new TextEncoder().encode(header.value).length > MAX_VALUE_BYTES) return `Header value is longer than ${MAX_VALUE_BYTES} bytes.`;
  return null;
}

/** Row index → first problem with that row. */
export function credentialHeaderProblems(headers: CredentialHeaderInput[]): Map<number, string> {
  const problems = new Map<number, string>();
  const seen = new Set<string>();
  headers.forEach((header, index) => {
    if (index >= MAX_HEADERS) {
      problems.set(index, `At most ${MAX_HEADERS} headers are allowed.`);
      return;
    }
    const problem = headerProblem(header);
    if (problem) {
      problems.set(index, problem);
      return;
    }
    const lower = header.name.trim().toLowerCase();
    if (seen.has(lower)) problems.set(index, `${header.name.trim()} is listed twice.`);
    seen.add(lower);
  });
  return problems;
}

/** "Name: value" → {name, value}; null when there is no colon. */
export function splitHeaderLine(text: string): CredentialHeaderInput | null {
  const at = text.indexOf(":");
  if (at < 0) return null;
  const name = text.slice(0, at).trim();
  const value = text.slice(at + 1).trim();
  // A pasted URL ("https://host") is not a header line.
  if (!TOKEN.test(name) || value.startsWith("//")) return null;
  return { name, value };
}

export function originOf(endpoint: string): string | null {
  try {
    return new URL(endpoint.trim()).origin;
  } catch {
    return null;
  }
}
