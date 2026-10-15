"use client";

import * as React from "react";

import { CodeBlock } from "@/components/ui/code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mcpEndpointUrl } from "@/features/connect/mcp-endpoint";
import { KEY_PLACEHOLDER, MCP_CLIENTS, mcpConfig, type McpClient } from "@/features/buyer-money/mcp-config";

/**
 * The config to paste, one tab per client. With `token` the block is ready to
 * paste; without it (the key is only shown once, at creation) it carries a
 * placeholder and says where the key goes.
 */
export function McpConfigTabs({ token, onCopy }: { token: string | null; onCopy?: () => void }) {
  const [client, setClient] = React.useState<McpClient>("claude-desktop");
  const url = mcpEndpointUrl();
  return (
    <Tabs value={client} onValueChange={(v) => setClient(v as McpClient)} className="flex w-full min-w-0 flex-col gap-3">
      <TabsList className="gap-4 overflow-x-auto">
        {MCP_CLIENTS.map((c) => (
          <TabsTrigger key={c.id} value={c.id} className="whitespace-nowrap">
            {c.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {MCP_CLIENTS.map((c) => (
        <TabsContent key={c.id} value={c.id} className="flex min-w-0 flex-col gap-2">
          <p className="text-body-xs text-03">
            Paste this into <span className="font-mono text-01">{c.file}</span>
            {c.id === "claude-desktop" ? " (Settings › Developer › Edit config), then restart Claude Desktop." : ", then reload the client."}
            {token ? null : ` Replace ${KEY_PLACEHOLDER} with your key.`}
          </p>
          <CodeBlock title={c.file} code={mcpConfig(c.id, { url, token })} onCopyCode={() => onCopy?.()} className="min-w-0" />
        </TabsContent>
      ))}
    </Tabs>
  );
}
