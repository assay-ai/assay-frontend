"use client";

import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { mcpHost } from "@/features/connect/mcp-endpoint";

import { mcpEndpointUrl } from "@/features/connect/mcp-endpoint";

import { ConnectPanel } from "./connect-panel";

/**
 * The pages a browser lands on for MCP URLs whose content arrives in a later
 * phase — a shared tool set (`/@{handle}/{slug}`, `/u/{token}`) and a public
 * name (`/@{handle}`). They exist now so the redirect never ends on a 404 page,
 * and each carries the Connect panel with the URL it stands for.
 */

const HANDLE_RE = /^[a-z][a-z0-9-]{2,23}$/;
const SLUG_RE = /^[a-z0-9-]{2,64}$/;
const TOKEN_RE = /^[a-z0-9_-]{22,64}$/i;
const VERSION_RE = /^[1-9][0-9]{0,5}$/;

/** The MCP URL a `/toolsets/view` or `/toolsets/handle` page stands for, or null when its parameters are not valid. */
export function sharedServerUrl(
  page: "view" | "handle",
  params: { handle?: string | null; slug?: string | null; token?: string | null; v?: string | null; free?: string | null },
  host: string = mcpHost(),
): string | null {
  const v = params.v && VERSION_RE.test(params.v) ? `@${params.v}` : "";
  const free = params.free === "1" ? "?free=1" : "";
  const handle = params.handle?.toLowerCase() ?? "";
  if (page === "handle") return HANDLE_RE.test(handle) ? `${host}/@${handle}${free}` : null;
  if (params.token) return TOKEN_RE.test(params.token) ? `${host}/u/${params.token}${v}${free}` : null;
  const slug = params.slug?.toLowerCase() ?? "";
  return HANDLE_RE.test(handle) && SLUG_RE.test(slug) ? `${host}/@${handle}/${slug}${v}${free}` : null;
}

export function SharedServerPage({ page }: { page: "view" | "handle" }) {
  const [url, setUrl] = React.useState<string | null | undefined>(undefined);
  const [label, setLabel] = React.useState("");
  React.useEffect(() => {
    // The unlisted token rides in the fragment, so it never reaches a server log.
    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const read = (key: string) => query.get(key) ?? fragment.get(key);
    const params = { handle: read("handle"), slug: read("slug"), token: fragment.get("token"), v: read("v"), free: read("free") };
    setUrl(sharedServerUrl(page, params));
    setLabel(page === "handle" ? `@${params.handle ?? ""}` : params.token ? "A tool set shared by link" : `@${params.handle ?? ""}/${params.slug ?? ""}`);
  }, [page]);

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-4 py-6 tablet:px-7 tablet:py-8">
      {url === undefined ? (
        <PageState kind="loading" rows={2} label="Loading" />
      ) : (
        <>
          <section className="flex flex-col gap-2 rounded-xl border border-01 bg-01 p-5 tablet:p-6" data-testid="shared-server">
            <h1 className="break-all text-heading-md text-01">{url === null ? "Not found" : label}</h1>
            <p className="text-body-13 text-02">
              {url === null
                ? "This link does not name a tool set or a public name. Check it with whoever sent it."
                : page === "handle"
                  ? "Pages for a maker's own tools are coming soon. Until then this server lists nothing, so there is nothing to connect yet."
                  : "Shared tool sets are coming soon. Until then this server lists nothing, so there is nothing to connect yet."}
            </p>
            {url ? <p className="break-all font-mono text-mono-12 text-03">{url}</p> : null}
            <Link href="/catalogue" className="min-h-10 self-start content-center text-label-13 text-primary-600 hover:underline tablet:min-h-0">
              See all tools
            </Link>
          </section>
          <ConnectPanel publicPage url={mcpEndpointUrl()} title="Meanwhile, connect Everything: every tool on Assay, through one server." />
        </>
      )}
    </div>
  );
}
