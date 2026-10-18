/**
 * Sign-in round trips: `/login?next=<path>` returns a person to where they
 * were, and `reason=expired` tells the login screen to say why they are there.
 *
 * `next` is read from the URL, so it is untrusted: `safeNextPath` only lets
 * an in-app path through. Anything else ("//evil.example", "https://…",
 * "javascript:…") falls back to "/", which is never an open redirect.
 */

export type LoginReason = "expired";

export function loginHref(options: { next?: string | null; reason?: LoginReason } = {}): string {
  const params = new URLSearchParams();
  const next = options.next ? safeNextPath(options.next) : "/";
  if (next !== "/") params.set("next", next);
  if (options.reason) params.set("reason", options.reason);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}

/** How many times an encoded path is decoded while looking for a hidden `//` or `\`. */
const DECODE_ROUNDS = 3;

/** The path part, before any query or hash. */
function pathPart(value: string): string {
  const end = value.search(/[?#]/);
  return end === -1 ? value : value.slice(0, end);
}

/**
 * Whether a path, decoded up to {@link DECODE_ROUNDS} times, could be read by
 * a browser or a router as another origin: `//host`, `/\host`, any backslash,
 * or a control character. "/%2F%2Fevil.example" and "/%5Cevil.example" are
 * refused here, not only their plain forms.
 */
function hidesAnotherOrigin(path: string): boolean {
  let current = path;
  for (let round = 0; round <= DECODE_ROUNDS; round += 1) {
    if (/^\/[\/\\]/.test(current) || current.includes("\\") || /[\u0000-\u001f\u007f]/.test(current)) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      // A malformed escape is not a path anyone links to.
      return true;
    }
    if (decoded === current) return false;
    current = decoded;
  }
  // Still changing after every round: refuse rather than guess.
  return true;
}

/**
 * An in-app path (with its query and hash), or "/" when the value is anything
 * else. Accepted only: a same-origin relative path that starts with exactly
 * one `/`, with no whitespace, no control character and no backslash, whose
 * path part does not decode to `//…` or `/\…`. `/login` (a loop) and the
 * operator console (its own session) are refused too.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  const value = raw;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\s\u0000-\u001f\u007f\\]/.test(value)) return "/";
  if (hidesAnotherOrigin(pathPart(value))) return "/";
  try {
    const url = new URL(value, "https://assay.invalid");
    if (url.origin !== "https://assay.invalid") return "/";
    const path = url.pathname;
    if (!path.startsWith("/") || path.startsWith("//")) return "/";
    // Dot segments resolve only here ("/x/../%2f%2fevil" becomes "/%2f%2fevil"):
    // check the path returned, so the output is never one this function refuses.
    if (hidesAnotherOrigin(path)) return "/";
    if (path === "/login" || path.startsWith("/login/") || path === "/operator" || path.startsWith("/operator/")) return "/";
    return `${path}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
