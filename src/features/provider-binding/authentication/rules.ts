import type { CredentialHeaderInput } from "@/interfaces/provider-bindings";

// Mirrored from the backend (plan A Global Constraints). Keep in sync.
const CREDENTIAL_QUERY_KEYS = new Set([
  "key", "api_key", "apikey", "token", "access_token", "auth_token",
  "secret", "client_secret", "password", "auth", "signature", "sig",
]);
const SECRET_CONSTANT_HEADERS = new Set([
  "authorization", "proxy-authorization", "cookie", "x-api-key",
  "api-key", "x-auth-token", "x-access-token",
]);
const RESERVED_HEADERS = new Set([
  "host", "content-length", "content-type", "transfer-encoding", "connection",
  "upgrade", "te", "trailer", "signature", "signature-input", "content-digest",
]);
const MAX_HEADERS = 10;
const MAX_NAME_LENGTH = 64;
const MAX_VALUE_BYTES = 4096;
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export const QUERY_KEY_ERROR =
  "Don't put keys in the URL. URLs are logged by proxies, CDNs and servers and leak through browser history. Add it under Authentication → API key instead.";
export const SECRET_HEADER_ERROR =
  "This looks like a secret. Mappings are stored in plain text — add it under Authentication → API key instead.";

export function isCredentialQueryKey(key: string): boolean {
  return CREDENTIAL_QUERY_KEYS.has(key.trim().toLowerCase().replace(/-/g, "_"));
}

export function isSecretConstantHeader(name: string): boolean {
  return SECRET_CONSTANT_HEADERS.has(name.trim().toLowerCase());
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

function headerProblem(header: CredentialHeaderInput): string | null {
  const name = header.name.trim();
  if (name === "") return "Header name is required.";
  if (name.length > MAX_NAME_LENGTH) return `Header name is longer than ${MAX_NAME_LENGTH} characters.`;
  if (!TOKEN.test(name)) return "Header name has characters that are not allowed (no spaces or colons).";
  const lower = name.toLowerCase();
  if (RESERVED_HEADERS.has(lower) || lower.startsWith("x-assay-")) return `${name} is set by Assay and cannot be overridden.`;
  if (/[\r\n]/.test(header.value)) return "Header value cannot contain line breaks.";
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
  return { name: text.slice(0, at).trim(), value: text.slice(at + 1).trim() };
}

export function originOf(endpoint: string): string | null {
  try {
    return new URL(endpoint.trim()).origin;
  } catch {
    return null;
  }
}
