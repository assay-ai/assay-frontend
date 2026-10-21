/**
 * The consent request id (`rid`) on the page (spec §6.3.4, §6.5).
 *
 * The MCP host sends the browser to `/connect/authorize#request={rid}`: a
 * fragment, so the id never reaches a server log or a `Referer`. The page
 * reads it once, keeps it in `sessionStorage` (this tab only) so a sign-in
 * round trip through `/login?next=%2Fconnect%2Fauthorize` can find it again,
 * and removes it from the address bar at once. It is deleted after approve
 * or deny, or once the request is over.
 *
 * The id goes nowhere else: not into a URL the page builds, a query key,
 * analytics or a log. The only place it travels is the consent API's path.
 */

export const RID_STORAGE_KEY = "assay.oauth.rid";

/** 32 random bytes, base64url without padding. */
const RID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function storage(win: Window): Storage | null {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The request id: from the fragment (saved, then stripped from the address
 * bar), else the one this tab saved before. `null` when there is none.
 */
export function takeRequestId(win: Window = window): string | null {
  const hash = win.location.hash;
  let fromHash: string | null = null;
  if (hash && hash !== "#") {
    const value = new URLSearchParams(hash.slice(1)).get("request");
    if (value && RID_PATTERN.test(value)) fromHash = value;
    // Strip whatever fragment there was, keeping the router's history state.
    win.history.replaceState(win.history.state, "", `${win.location.pathname}${win.location.search}`);
  }

  const store = storage(win);
  if (fromHash) {
    try {
      store?.setItem(RID_STORAGE_KEY, fromHash);
    } catch {
      /* storage refused: this page view still has it */
    }
    return fromHash;
  }

  try {
    const saved = store?.getItem(RID_STORAGE_KEY) ?? null;
    return saved && RID_PATTERN.test(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Forget the saved id: after a decision, or once the request is over. */
export function forgetRequestId(win: Window = window): void {
  try {
    storage(win)?.removeItem(RID_STORAGE_KEY);
  } catch {
    /* nothing to remove */
  }
}

/**
 * Whether this tab holds a consent request id (in the fragment or saved),
 * without reading it out or touching the address bar. The sign-in guard asks
 * it: `/connect/authorize` with no request has nothing to sign in for
 * (BUG-BUY-CONNECT-02).
 */
export function hasRequestId(win: Window = window): boolean {
  try {
    const hash = win.location.hash;
    if (hash && hash !== "#" && RID_PATTERN.test(new URLSearchParams(hash.slice(1)).get("request") ?? "")) return true;
    const saved = storage(win)?.getItem(RID_STORAGE_KEY) ?? null;
    return saved !== null && RID_PATTERN.test(saved);
  } catch {
    return false;
  }
}
