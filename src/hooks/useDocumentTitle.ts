"use client";

import * as React from "react";

/**
 * Names a record page in the browser tab: `"<name> — Assay"`-style titles for
 * pages a static export cannot give per-record metadata (the tool page, the
 * public provider page).
 *
 * Setting `document.title` once in an effect is not enough: on a client
 * navigation the router writes the route's metadata title (the parent
 * layout's, e.g. "Explorer: tools and prices — Assay") after the page's
 * effects have run, so the tab kept the generic title. While the page is
 * mounted this watches `<head>` and puts the record's title back whenever
 * something else replaces it. `null` (still loading) leaves the title alone.
 */
export function useDocumentTitle(title: string | null): void {
  React.useEffect(() => {
    if (!title || typeof document === "undefined") return;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}
