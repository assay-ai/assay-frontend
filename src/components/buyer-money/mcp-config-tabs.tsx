"use client";

import * as React from "react";

import { KeyRound } from "lucide-react";

import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { CopyChip } from "@/components/patterns/copy-chip";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { ClientPicker } from "@/components/connect/client-picker";
import { HostedConnector } from "@/components/connect/hosted-connector";
import { toast } from "@/utils/toast";
import { mcpEndpointUrl } from "@/features/connect/mcp-endpoint";
import {
  FREE_EXAMPLE_PROMPT,
  MCP_CLIENTS,
  appName,
  assistantName,
  restartNote,
  addOneLiner,
  apiKeyConfig,
  deeplink,
  installCommand,
  installText,
  isLocalClient,
  keyPlaceholder,
  NO_COMMAND_TEXT,
  SECOND_URL_NOTE,
  pasteHint,
  tryBuild,
  remoteInstall,
  type LocalMcpClient,
  type McpClient,
} from "@/features/buyer-money/mcp-config";

/** Docs for wiring a remote MCP server into code, shown under "Other". */
const OTHER_CLIENT_DOCS = [
  { label: "Claude API", href: "https://docs.claude.com/en/docs/agents-and-tools/mcp-connector" },
  { label: "OpenAI Agents SDK", href: "https://openai.github.io/openai-agents-python/mcp/" },
  { label: "LangChain", href: "https://github.com/langchain-ai/langchain-mcp-adapters" },
];

/** Why Copy is off while the block holds a placeholder instead of a key. */
export const TEMPLATE_COPY_REASON = "This config has a placeholder, not your key. Create a key above first.";

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
  guide = false,
  nameRefused = false,
  secondUrl = false,
  onClientChange,
  onCopy,
  onCreateKey,
  creatingKey = false,
  createKeyError,
  agentName,
}: {
  token: string | null;
  keyPrefix?: string | null;
  url?: string;
  serverName?: string;
  client?: McpClient;
  /** Show "What happens next" and the free example prompt under the action (the Connect page). */
  guide?: boolean;
  /** The typed server name is refused: no command, deeplink or config is shown. */
  nameRefused?: boolean;
  /** The agent already has another server: a remote-only install signs in again (R-UI-11). */
  secondUrl?: boolean;
  onClientChange?: (client: McpClient) => void;
  onCopy?: (client: McpClient) => void;
  /** Creates a key here and fills it in ("Use an API key instead", R-UI-8); shown first under My own code while there is no full key. */
  onCreateKey?: () => void;
  creatingKey?: boolean;
  createKeyError?: string | null;
  /** Named in the confirm before a key is created. */
  agentName?: string | null;
}) {
  // A live key is made only after the confirm says so; Cancel makes nothing.
  const [confirmCreate, setConfirmCreate] = React.useState(false);
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
          <Button type="button" icon={<KeyRound />} className="self-start" loading={creatingKey} onClick={() => setConfirmCreate(true)}>
            Use an API key instead
          </Button>
          <p className="text-body-xs text-03">A key is shown in full only once, when it is made. This makes a new one and puts it in the config below.</p>
          {createKeyError ? <p className="text-body-xs text-danger-700">{createKeyError}</p> : null}
          <CreateKeyConfirm
            open={confirmCreate}
            onOpenChange={setConfirmCreate}
            agentName={agentName}
            onCreate={onCreateKey}
          />
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
      <ClientPicker value={client} onChange={setClient} />
      <div className="flex min-w-0 flex-col gap-2" data-testid={`client-panel-${client}`}>
        {client === "other" ? (
          <>
            <p className="text-body-xs text-03">
              {pasteHint("other")}
              {token
                ? null
                : keyPrefix
                  ? ` Replace ${placeholder} with your full key (it starts ${keyPrefix.replace(/[.…]+$/, "")}).`
                  : ` Replace ${placeholder} with your key.`}
            </p>
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
            <CodeBlock
              title="mcp.json"
              code={nameRefused ? NO_COMMAND_TEXT : apiKeyConfig({ url, token, keyPrefix, serverName })}
              onCopyCode={() => onCopy?.("other")}
              copyDisabledReason={nameRefused ? NO_COMMAND_TEXT : token ? null : TEMPLATE_COPY_REASON}
              wrap
              className="min-w-0"
            />
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
          </>
        ) : isLocalClient(client) ? (
          <LocalInstall client={client} file={MCP_CLIENTS.find((c) => c.id === client)?.file ?? "Terminal"} url={url} name={name} refused={nameRefused} secondUrl={secondUrl} onCopy={() => onCopy?.(client)} />
        ) : (
          <HostedConnector client={client} url={url} secondUrl={secondUrl} onCopy={() => onCopy?.(client)} />
        )}
        {guide && client !== "other" ? <NextSteps client={client} /> : null}
      </div>
    </div>
  );
}

/** The paid-capable install: a button for Cursor and VS Code (config under it), the command otherwise. */
function LocalInstall({ client, file, url, name, refused, secondUrl, onCopy }: { client: LocalMcpClient; file: string; url: string; name: string; refused: boolean; secondUrl: boolean; onCopy: () => void }) {
  const input = { url, name };
  const app = appName(client);
  const link = refused ? null : tryBuild(() => deeplink(client, input));
  const remote = refused ? null : tryBuild(() => remoteInstall(client, input));
  const command = refused ? null : tryBuild(() => installText(installCommand(client, input)));
  const addLine = refused ? null : tryBuild(() => addOneLiner(url, client));
  const [showConfig, setShowConfig] = React.useState(false);
  const root = (() => {
    try {
      return new URL(url).pathname === "/" && !new URL(url).search;
    } catch {
      return true;
    }
  })();
  const button = client === "cursor" || client === "vscode";
  const intro = button ? null : client === "claude-desktop" ? "Paste into claude_desktop_config.json (Settings › Developer › Edit config), then restart." : "Run this in a terminal:";
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-label-sm text-01">Add Assay to {app}</h3>
      {button && link ? (
        <div className="flex flex-col items-start gap-1">
          <Button asChild className="min-h-10">
            <a href={link} data-testid="install-deeplink" onClick={onCopy}>
              Add to {app}
            </a>
          </Button>
          <button type="button" className="min-h-10 text-label-13 font-semibold text-primary-600 hover:underline" data-testid="copy-config-instead" onClick={() => setShowConfig((v) => !v)}>
            Copy the config instead
          </button>
        </div>
      ) : null}
      {intro ? <p className="text-body-13 text-02">{intro}</p> : null}
      {!button || showConfig || !link ? (
        <CodeBlock title={file} code={command ?? NO_COMMAND_TEXT} copyDisabledReason={command ? null : NO_COMMAND_TEXT} onCopyCode={onCopy} wrap className="min-w-0" />
      ) : null}
      <p className="text-body-xs text-03">Needs Node.js 20 or later.</p>
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
          {secondUrl ? <p className="text-body-xs text-03" data-testid="second-url-note">{SECOND_URL_NOTE}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** "What happens next" and the free example prompt (spec 9.2): nothing here asks for money. */
function NextSteps({ client }: { client: McpClient }) {
  const app = appName(client);
  const assistant = assistantName(client);
  const restart = restartNote(client);
  const hosted = client === "claude-ai" || client === "chatgpt";
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="next-steps">
      {hosted ? null : (
        <>
          <h3 className="text-label-sm text-01">What happens next</h3>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-body-13 text-02">
            <li>
              {/* `{" "}`: the dev compiler drops the space after `{assistant}` in a text run with entities. */}
              Start {app}. In the tool list you&apos;ll see &quot;assay_sign_in&quot;. Ask {assistant}{" "}to &quot;sign in to Assay&quot;, approve in the browser, and Assay&apos;s tools appear.
              {restart ? ` ${restart}` : null}
            </li>
            <li>Paid tools ask once to turn on paid calls. That takes a minute.</li>
          </ol>
        </>
      )}
      <p className="text-label-13 text-01">Try it — ask {assistant}:</p>
      <p className="rounded-lg border border-01 bg-02 px-3 py-2 text-body-13 text-01" data-testid="free-example-prompt">
        &quot;{FREE_EXAMPLE_PROMPT}&quot;
      </p>
    </div>
  );
}

/** The confirm before "Use an API key instead" creates a live key. */
export function createKeyConfirmTitle(agentName?: string | null): string {
  return `Create an API key for ${agentName?.trim() || "this agent"}?`;
}
export const CREATE_KEY_CONFIRM_TEXT = "It can call tools with this agent's limits; you see it once.";

function CreateKeyConfirm({
  open,
  onOpenChange,
  agentName,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName?: string | null;
  onCreate: () => void;
}) {
  return (
    <ConfirmSheet
      open={open}
      onOpenChange={onOpenChange}
      tone="primary"
      title={createKeyConfirmTitle(agentName)}
      description={CREATE_KEY_CONFIRM_TEXT}
      confirmLabel="Create"
      onConfirm={onCreate}
    />
  );
}
