"use client";

import * as React from "react";

/**
 * The pages `public/_headers` gives the strict policy (spec R-WEB-2, R-WEB-4):
 * `/connect/*` and `/agents/enable-paid` (`scripts/csp-policy.js` `STRICT_PATHS`).
 *
 * A Content-Security-Policy belongs to the document, and a client-side
 * navigation keeps the document. So moving into or out of these pages is a
 * full page load: entering, so the page gets its own strict headers; leaving,
 * so the rest of the app (sign-in included, whose captcha the strict policy
 * refuses) does not run under them.
 */
export function isStrictPagePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.split(/[?#]/)[0]!.replace(/\/+$/, "");
  return /^\/connect\/[^/]+/.test(path) || path === "/agents/enable-paid";
}

/** A full page load of an in-app path. */
export function loadPage(href: string): void {
  window.location.assign(href);
}

/** The two router methods `appNavigate` uses (Next's `useRouter()`). */
export interface AppRouter {
  push: (href: string) => void;
  replace: (href: string) => void;
}

/**
 * The shell's programmatic navigation (sign out, alerts, search, the 401
 * handler): a full page load when leaving a strict page, else the router's
 * client-side navigation as before. `pathname` defaults to the current one.
 */
export function appNavigate(
  router: AppRouter,
  href: string,
  options: { replace?: boolean; pathname?: string | null; load?: (href: string) => void } = {},
): void {
  const from = options.pathname ?? (typeof window === "undefined" ? null : window.location.pathname);
  if (isStrictPagePath(from)) (options.load ?? loadPage)(href);
  else if (options.replace) router.replace(href);
  else router.push(href);
}

/**
 * On a strict page: every plain left click on a same-origin link loads the
 * target as a new document instead of a client-side navigation. Links that
 * open elsewhere (another origin, a new tab, a download) are left alone.
 */
export function useFullLoadLinks(load: (href: string) => void = loadPage): void {
  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      event.stopPropagation();
      load(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [load]);
}
