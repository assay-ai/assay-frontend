"use client";

import * as React from "react";

import { KeyRound } from "lucide-react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mcpEndpointUrl } from "@/features/connect/mcp-endpoint";
import { MCP_CLIENTS, keyPlaceholder, mcpConfig, pasteHint, type McpClient } from "@/features/buyer-money/mcp-config";

/** Docs for wiring a remote MCP server into code, shown under "Other". */
const OTHER_CLIENT_DOCS = [
  { label: "Claude API", href: "https://docs.claude.com/en/docs/agents-and-tools/mcp-connector" },
  { label: "OpenAI Agents SDK", href: "https://openai.github.io/openai-agents-python/mcp/" },
  { label: "LangChain", href: "https://github.com/langchain-ai/langchain-mcp-adapters" },
];

/** Why Copy is off while the block holds a placeholder instead of a key. */
export const TEMPLATE_COPY_REASON = "This config has a placeholder, not your key. Create a key and fill it in first.";

/**
 * The config to paste, one tab per client. With `token` the block is ready to
 * paste; without it (the key is only shown once, at creation) it carries a
 * placeholder and says where the key goes. `keyPrefix` names the key that
 * goes there, so a person who has one never meets a bare placeholder.
 *
 * Copy is off while the block holds a placeholder: a copied template fails
 * in the client with nothing on screen to say why. `onCreateKey` puts "Create
 * a key and fill it in" first, so the next click gives a ready config. The
 * URL alone (under Other) stays copyable for a person who has their key.
 *
 * Blocks wrap rather than scroll, so a phone shows the whole command.
 *
 * `url` defaults to the MCP host root (`/`, everything); the Connect sheet
 * passes the URL its answer built, the server name it suggests, and controls
 * the tab so it can be remembered per agent.
 */
export function McpConfigTabs({
  token,
  keyPrefix,
  url: urlProp,
  serverName,
  client: clientProp,
  onClientChange,
  onCopy,
  onCreateKey,
  creatingKey = false,
  createKeyError,
}: {
  token: string | null;
  keyPrefix?: string | null;
  url?: string;
  serverName?: string;
  client?: McpClient;
  onClientChange?: (client: McpClient) => void;
  onCopy?: (client: McpClient) => void;
  /** Creates a key here and fills it in; shown first while there is no full key. */
  onCreateKey?: () => void;
  creatingKey?: boolean;
  createKeyError?: string | null;
}) {
  const placeholder = keyPlaceholder(keyPrefix);
  const [own, setOwn] = React.useState<McpClient>(clientProp ?? "claude-code");
  const client = clientProp ?? own;
  const url = urlProp ?? mcpEndpointUrl();
  const setClient = (next: McpClient) => {
    setOwn(next);
    onClientChange?.(next);
  };
  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {!token && onCreateKey ? (
        <div className="flex flex-col gap-1.5" data-testid="create-and-fill">
          <Button type="button" icon={<KeyRound />} className="self-start" loading={creatingKey} onClick={onCreateKey}>
            Create a key and fill it in
          </Button>
          <p className="text-body-xs text-03">A key is shown in full only once, when it is made. This makes a new one and puts it in the config below.</p>
          {createKeyError ? <p className="text-body-xs text-danger-700">{createKeyError}</p> : null}
        </div>
      ) : null}
      <Tabs value={client} onValueChange={(v) => setClient(v as McpClient)} className="flex w-full min-w-0 flex-col gap-3">
        <TabsList className="flex-wrap gap-x-4 gap-y-1">
          {MCP_CLIENTS.map((c) => (
            <TabsTrigger key={c.id} value={c.id} className="min-h-10 whitespace-nowrap">
              {c.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {MCP_CLIENTS.map((c) => (
          <TabsContent key={c.id} value={c.id} className="flex min-w-0 flex-col gap-2">
            <p className="text-body-xs text-03">
              {pasteHint(c.id)}
              {token
                ? null
                : keyPrefix
                  ? ` Replace ${placeholder} with your full key (it starts ${keyPrefix.replace(/[.…]+$/, "")}).`
                  : ` Replace ${placeholder} with your key.`}
            </p>
            {c.id === "other" ? (
              <dl className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-01 bg-02 px-3 py-2.5 text-body-xs">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <dt className="text-03">URL</dt>
                  <dd className="min-w-0 flex-1">
                    <CopyChip value={url} display={url} label="the URL" className="max-w-full break-all text-left" />
                  </dd>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <dt className="text-03">Header</dt>
                  <dd className="min-w-0 flex-1 break-all font-mono text-mono-12 text-01">Authorization: Bearer {token ?? placeholder}</dd>
                </div>
              </dl>
            ) : null}
            <CodeBlock
              title={c.file}
              code={mcpConfig(c.id, { url, token, keyPrefix, serverName })}
              onCopyCode={() => onCopy?.(c.id)}
              copyDisabledReason={token ? null : TEMPLATE_COPY_REASON}
              wrap
              className="min-w-0"
            />
            {c.id === "other" ? (
              <p className="text-body-xs text-03">
                In code:{" "}
                {OTHER_CLIENT_DOCS.map((doc, i) => (
                  <React.Fragment key={doc.href}>
                    {i > 0 ? " · " : null}
                    <a href={doc.href} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
                      {doc.label}
                    </a>
                  </React.Fragment>
                ))}
              </p>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
