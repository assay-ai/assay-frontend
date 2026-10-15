/**
 * Link params that open something once (`?new=1`, `?rule=uphold`) go when it
 * closes, so a reload or Back does not open it again.
 *
 * This writes the address bar with `history.replaceState`, which the App
 * Router picks up (`useSearchParams` follows it) without a navigation. In the
 * static export `router.replace` to the same page with a shorter query was
 * seen to leave the URL as it was, so it is not used for this.
 */

/** `href` without `keys`, as a path + query + hash. Pure. */
export function withoutParams(href: string, keys: readonly string[]): string {
  const url = new URL(href, "http://localhost");
  for (const key of keys) url.searchParams.delete(key);
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

/** Drops `keys` from the current URL, in place. A no-op when none is there. */
export function dropUrlParams(keys: readonly string[]): void {
  if (typeof window === "undefined") return;
  const current = new URL(window.location.href);
  if (!keys.some((key) => current.searchParams.has(key))) return;
  window.history.replaceState(window.history.state, "", withoutParams(window.location.href, keys));
}
