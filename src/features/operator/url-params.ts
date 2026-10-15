/**
 * Link params that open something once (`?new=1`, `?rule=uphold`) go when it
 * closes, so a reload or Back does not open it again.
 *
 * This writes the address bar with `history.replaceState`, which the App
 * Router picks up (`useSearchParams` follows it) without a navigation. In the
 * static export `router.replace` to the same page with a shorter query was
 * seen to leave the URL as it was, so it is not used for this.
 *
 * The state passed is `null`, never `window.history.state`: Next's patched
 * `replaceState` treats a state carrying its own `__NA` mark as an internal
 * write and skips the router sync, so `useSearchParams` would keep the old
 * query (a tab switched in the URL but not on screen). Next copies its
 * internal state onto the new entry itself.
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
  window.history.replaceState(null, "", withoutParams(window.location.href, keys));
}

/**
 * Sets the address bar to `pathname` + `query` in place, for filters and tabs
 * kept in the URL. Same reason as `dropUrlParams`: `router.replace` to the
 * same page with a shorter (or empty) query can leave the old URL standing.
 */
export function replaceUrlQuery(pathname: string, query: string): void {
  if (typeof window === "undefined") return;
  const next = `${pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history.replaceState(null, "", next);
}
