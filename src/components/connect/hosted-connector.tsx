"use client";

import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { Checkbox } from "@/components/ui/checkbox";
import { appName, hostedUrl, SECOND_URL_NOTE, type HostedMcpClient } from "@/features/buyer-money/mcp-config";

/** The URL without `free=1`, for "Show paid tools too". */
function paidUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("free");
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Hosted connectors (claude.ai, ChatGPT), spec 9.4: free tools only, so the
 * URL carries `?free=1` unless the person asks to see paid tools too (they
 * only explain how to pay; a hosted connector never holds a payment key).
 */
export function HostedConnector({ client, url, secondUrl = false, onCopy }: { client: HostedMcpClient; url: string; secondUrl?: boolean; onCopy?: (url: string) => void }) {
  const app = appName(client);
  const [paid, setPaid] = React.useState(false);
  const shown = paid ? paidUrl(url) : hostedUrl(url);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="hosted-connector">
      <h3 className="text-label-sm text-01">Add Assay to {app}</h3>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-body-13 text-02">
        <li>{client === "claude-ai" ? "Open Settings › Connectors › Add custom connector." : `Open ${app}'s settings, find Connectors, and add a custom connector.`}</li>
        <li className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span>Paste:</span>
            <CopyChip value={shown} display={shown} label="the URL" className="max-w-full break-all text-left" onClick={() => onCopy?.(shown)} />
          </span>
        </li>
        <li>Click Connect and approve in the window that opens.</li>
      </ol>
      <p className="text-body-xs text-03">
        {/* `{" "}`: the dev compiler drops the space after `{app}` in a text run with entities. */}
        Free tools only. {app}{" "}runs connectors from its own servers, so it can&apos;t hold a payment key. For paid tools, use Claude Code or Claude Desktop with the Assay app.
      </p>
      {secondUrl ? <p className="text-body-xs text-03" data-testid="second-url-note">{SECOND_URL_NOTE}</p> : null}
      <Checkbox checked={paid} onChange={(event) => setPaid(event.target.checked)} label="Show paid tools too (they will explain how to pay)" />
    </div>
  );
}
