"use client";

import * as React from "react";

import { KeyRound } from "lucide-react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/utils/toast";
import { mcpEndpointUrl } from "@/features/connect/mcp-endpoint";
import {
  MCP_CLIENTS,
  addOneLiner,
  apiKeyConfig,
  deeplink,
  hostedUrl,
  installCommand,
  installText,
  isLocalClient,
  keyPlaceholder,
  NO_COMMAND_TEXT,
  pasteHint,
  tryBuild,
  remoteInstall,
  type McpClient,
} from "@/features/buyer-money/mcp-config";

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
 * a key and fill it in" first, so the next click gives a ready config. "Copy
 * the URL only" stays for a person who has their key: it copies the URL (no
 * key) and counts as handing it out (`onCopy`), so Servers in use and "Is it
 * working?" still follow it.
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
  const name = serverName?.trim() || "assay";
  // Only "My own code" carries a key; the proxy signs in and signs payments itself.
  const needsKey = client === "other";
  const copyUrlOnly = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URL copied. Your client also needs the header with your key.");
    } catch {
      toast.error("Copy did not work here: select the text and copy it.");
      return;
    }
    onCopy?.(client);
  };
  const setClient = (next: McpClient) => {
    setOwn(next);
    onClientChange?.(next);
  };
  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {needsKey && !token && onCreateKey ? (
        <div className="flex flex-col gap-1.5" data-testid="create-and-fill">
          <Button type="button" icon={<KeyRound />} className="self-start" loading={creatingKey} onClick={onCreateKey}>
            Create a key and fill it in
          </Button>
          <p className="text-body-xs text-03">A key is shown in full only once, when it is made. This makes a new one and puts it in the config below.</p>
          {createKeyError ? <p className="text-body-xs text-danger-700">{createKeyError}</p> : null}
        </div>
      ) : null}
      {needsKey && !token ? (
        <button
          type="button"
          className="min-h-10 self-start text-label-13 font-semibold text-primary-600 hover:underline"
          onClick={() => void copyUrlOnly()}
          data-testid="copy-url-only"
        >
          Have your key? Copy the URL only
        </button>
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
              {c.id !== "other" || token
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
            {isLocalClient(c.id) ? (
              <LocalInstall client={c.id} file={c.file} url={url} name={name} onCopy={() => onCopy?.(c.id)} />
            ) : c.id === "other" ? (
              <CodeBlock
                title={c.file}
                code={apiKeyConfig({ url, token, keyPrefix, serverName })}
                onCopyCode={() => onCopy?.(c.id)}
                copyDisabledReason={token ? null : TEMPLATE_COPY_REASON}
                wrap
                className="min-w-0"
              />
            ) : (
              <CopyChip value={hostedUrl(url)} display={hostedUrl(url)} label="the URL" className="max-w-full break-all text-left" />
            )}
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

/** The paid-capable install, its one-click link where there is one, and the free-only remote alternative. */
function LocalInstall({ client, file, url, name, onCopy }: { client: Exclude<McpClient, "claude-ai" | "chatgpt" | "other">; file: string; url: string; name: string; onCopy: () => void }) {
  const input = { url, name };
  const link = tryBuild(() => deeplink(client, input));
  const remote = tryBuild(() => remoteInstall(client, input));
  const command = tryBuild(() => installText(installCommand(client, input)));
  const addLine = tryBuild(() => addOneLiner(url, client));
  const root = (() => {
    try {
      return new URL(url).pathname === "/" && !new URL(url).search;
    } catch {
      return true;
    }
  })();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {link ? (
        <a href={link} className="min-h-10 self-start text-label-13 font-semibold text-primary-600 hover:underline" data-testid="install-deeplink" onClick={onCopy}>
          Install in {client === "cursor" ? "Cursor" : "VS Code"}
        </a>
      ) : null}
      <CodeBlock title={file} code={command ?? NO_COMMAND_TEXT} copyDisabledReason={command ? null : NO_COMMAND_TEXT} onCopyCode={onCopy} wrap className="min-w-0" />
      {root || !addLine ? null : (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-body-xs text-03">Or let it also allow this URL for paid calls:</p>
          <CodeBlock title="Terminal" code={addLine} onCopyCode={onCopy} wrap className="min-w-0" />
        </div>
      )}
      {remote ? (
        <div className="flex min-w-0 flex-col gap-1" data-testid="remote-alternative">
          <p className="text-body-xs text-03">Free tools only, with no install:</p>
          <CodeBlock title="Free only" code={installText(remote)} onCopyCode={onCopy} wrap className="min-w-0" />
        </div>
      ) : null}
    </div>
  );
}
