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

/** An in-app path (with its query and hash), or "/" when the value is anything else. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://assay.invalid");
    if (url.origin !== "https://assay.invalid") return "/";
    if (url.pathname === "/login" || url.pathname.startsWith("/operator")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
