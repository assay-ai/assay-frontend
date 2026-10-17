"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { isMcpClient } from "@/features/buyer-money/mcp-config";
import { serverLabel } from "@/features/toolsets/servers";
import { recordConnectUrl, type ServerInUse } from "@/services/toolsets.service";

import { CopyLine } from "./toolset-bits";
import { toolsetKeys } from "./use-toolsets";

/**
 * "Switch it to search" (design spec §7.10, over budget): one decisive step.
 * The server's own URL in search mode is ready to copy; copying hands it out
 * (and only then does Servers in use show it, waiting for the first call).
 * The person then replaces the old URL in their app, under the same name.
 */
export function SwitchToSearchSheet({ agentId, server, onOpenChange }: { agentId: string; server: ServerInUse | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => setCopied(false), [server?.canonicalUrl]);
  const label = server ? serverLabel(server).title : "";
  const handOut = async () => {
    if (!server?.searchUrl) return;
    setCopied(true);
    try {
      await recordConnectUrl(agentId, {
        url: server.searchUrl,
        ...(server.serverName ? { serverName: server.serverName } : {}),
        ...(isMcpClient(server.client) ? { client: server.client } : {}),
      });
    } catch {
      // Bookkeeping only: the URL is copied either way.
    }
    void queryClient.invalidateQueries({ queryKey: toolsetKeys.servers(agentId) });
  };
  return (
    <Sheet open={server !== null} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[560px]">
        {server ? (
          <>
            <SheetHeader>
              <SheetTitle>Switch “{label}” to search</SheetTitle>
              <SheetDescription>
                Today your app lists all {server.toolCount ?? ""} tools of this server to the agent. With the new URL it lists the always-loaded tools and three
                search tools, and finds the rest when it needs them.
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-3 px-[18px] pb-5 pt-3" data-testid="switch-sheet">
              <span className="text-label-13 text-01">1. Copy the new URL</span>
              <CopyLine value={server.searchUrl ?? ""} label="Copy new URL" onCopied={() => void handOut()} testId="switch-copy" />
              <span className="text-label-13 text-01">2. Replace the old one in your app</span>
              <p className="text-body-13 text-02">
                {server.serverName ? (
                  <>
                    In your app, open the server named <span className="font-mono text-01">{server.serverName}</span> and paste the new URL over{" "}
                  </>
                ) : (
                  <>In your app, paste the new URL over </>
                )}
                <span className="break-all font-mono text-01">{server.canonicalUrl}</span>. Keep the same key.
              </p>
              {copied ? (
                <p className="text-body-13 text-success-700" aria-live="polite" data-testid="switch-done">
                  Copied. Servers in use now waits for the first call through the new URL.
                </p>
              ) : null}
              <Button variant="secondary" className="self-start" onClick={() => onOpenChange(false)}>
                {copied ? "Done" : "Cancel"}
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
