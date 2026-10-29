"use client";

import { usePathname, useSearchParams } from "next/navigation";

const PREFIX = "/explorer/call/";

/**
 * The call id of the public explorer page. The address people share is
 * `/explorer/call/<id>`: Cloudflare Pages rewrites it to the one static page
 * `/explorer/call` (`public/_redirects`), so the id is read from the path.
 * `?id=` is accepted too, for `next dev`, which does not apply `_redirects`.
 * Returns "" when there is none.
 */
export function usePublicCallId(): string {
  const pathname = usePathname() ?? "";
  const query = useSearchParams().get("id") ?? "";
  if (pathname.startsWith(PREFIX)) {
    const segment = pathname.slice(PREFIX.length).split("/")[0] ?? "";
    try {
      return decodeURIComponent(segment);
    } catch {
      return "";
    }
  }
  return query;
}
