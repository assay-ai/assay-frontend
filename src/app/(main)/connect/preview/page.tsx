"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { useAgentsAndKeys } from "@/components/buyer-money/use-agents";
import { PageState } from "@/components/patterns/page-state";
import { ConnectPanel } from "@/components/toolsets/connect-panel";
import { ResultLine } from "@/components/toolsets/connect-sheet";
import { useMcpPreview } from "@/components/toolsets/use-toolsets";
import { parseMcpUrl } from "@/features/connect/mcp-url";
import { previewWarnings } from "@/features/toolsets/preview";

/**
 * `/connect/preview?url={MCP URL}` — where a browser lands when it opens an
 * MCP URL with `?tools=` or `?category=` (design spec §7.4): the Connect
 * panel, then the tools that URL serves this account's first agent, with
 * their prices.
 */
function Preview() {
  const url = useSearchParams().get("url");
  const data = useAgentsAndKeys();
  const agent = data.agents[0] ?? null;
  const readable = url ? parseMcpUrl(url) !== null : false;
  const preview = useMcpPreview(readable ? url : null, agent?.agentId);

  if (!url || !readable) {
    return (
      <PageState
        kind="empty"
        title="We couldn't read this URL"
        description="It is not an MCP server URL of Assay. Start a new one from Connect."
        action={{ label: "Connect", href: "/connect" }}
      />
    );
  }
  return (
    <>
      <ConnectPanel url={url} agentId={agent?.agentId ?? null} />
      <section aria-label="What it serves" className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5">
        <h2 className="text-label-md text-01">What it serves{agent?.label ? ` ${agent.label}` : ""}</h2>
        <ResultLine
          url={url}
          preview={preview.data}
          pending={preview.isPending}
          error={preview.isError ? preview.error : null}
          onRetry={() => void preview.refetch()}
        />
        {preview.data ? (
          <ul className="flex flex-col gap-1.5">
            {previewWarnings(preview.data).map((w) => (
              <li key={w.code} className="rounded-lg bg-02 px-3 py-2 text-body-13 text-02">
                {w.text}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-body-xs text-03">
          Prices are per call, under this agent&apos;s provider limits. Change them under{" "}
          <Link href={agent ? `/agents?agent=${encodeURIComponent(agent.agentId)}#access` : "/agents"} className="text-primary-600 hover:underline">
            What this agent can use
          </Link>
          .
        </p>
      </section>
    </>
  );
}

export default function ConnectPreviewPage() {
  return (
    <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:gap-5 tablet:px-7 tablet:py-[22px]">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-heading-md text-01">MCP server</h1>
      </header>
      <React.Suspense fallback={<PageState kind="loading" rows={3} label="Loading the server" />}>
        <Preview />
      </React.Suspense>
    </div>
  );
}
