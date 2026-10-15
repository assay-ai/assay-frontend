"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";

/**
 * A retired URL in a static export: there is no server to answer 301, so the
 * page replaces itself with its successor on the client. The query string is
 * carried over (record ids ride in it, see `libs/routes.ts`), and `to` may add
 * or override parameters: `to="/provider/bindings/view/settings"` keeps
 * `?binding=…`; `to="/provider/penalties?tab=disputed"` adds `tab`.
 *
 * `rename` maps an old parameter to a new name (`{ id: "case" }`).
 */
export function redirectTarget(
  to: string,
  currentSearch: string,
  options: { keep?: boolean; rename?: Record<string, string> } = {},
): string {
  const { keep = true, rename = {} } = options;
  const [path, toQuery = ""] = to.split("?");
  const params = new URLSearchParams();
  if (keep) {
    new URLSearchParams(currentSearch).forEach((value, key) => {
      params.set(rename[key] ?? key, value);
    });
  }
  new URLSearchParams(toQuery).forEach((value, key) => params.set(key, value));
  const query = params.toString();
  return query ? `${path}?${query}` : path!;
}

export function ClientRedirect({
  to,
  keepQuery = true,
  rename,
}: {
  to: string;
  keepQuery?: boolean;
  rename?: Record<string, string>;
}) {
  const router = useRouter();
  React.useEffect(() => {
    router.replace(redirectTarget(to, window.location.search, { keep: keepQuery, rename }));
    // Once, on mount: this page exists only to leave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <PageState kind="loading" label="Opening the page" rows={2} />;
}
