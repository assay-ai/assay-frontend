"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CircleCheck, Copy, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { McpConfigTabs } from "@/components/buyer-money/mcp-config-tabs";
import { useAgentsAndKeys, type KeyRow } from "@/components/buyer-money/use-agents";
import { useCatalogue } from "@/components/g31/use-catalogue";
import { EntityPicker } from "@/components/patterns/entity-picker";
import { Skeleton } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { isMcpClient, keyMode, mcpConfig, type McpClient } from "@/features/buyer-money/mcp-config";
import { buildMcpUrl, mcpToolName, parseMcpUrl, suggestServerName, type ConnectChoice } from "@/features/connect/mcp-url";
import { allowToolsBody } from "@/features/toolsets/access-result";
import { defaultEntry } from "@/features/toolsets/entry-rules";
import { copyBlocked, offersFreeOnly, overBudgetWith, previewSummary, previewWarnings, type PreviewWarning } from "@/features/toolsets/preview";
import { createCredential } from "@/services/account.service";
import { createToolset, recordConnectUrl, type McpUrlPreview } from "@/services/toolsets.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";

import { errorText, toolsetKeys, useAgentAccess, useAgentServers, useMcpPreview, useToolsets, useUpdateAccess } from "./use-toolsets";

/**
 * The Connect sheet (design spec §7.11, the T1 part): one question — "What
 * should it use?" — and the result updates live under it.
 *
 *   Everything            /
 *   One of my tool sets   /my/{slug}
 *   Only these tools      /?tools=…
 *
 * Under the question: the summary line from `POST /mcp-urls/preview` ("Your
 * agent will see 4 tools (~0.9k tokens)"; a skeleton while it loads, never
 * 0), the warnings with their fixes, the client tabs (remembered per agent)
 * and More options with "Only free tools". Copy or Done records the URL
 * (`POST /agents/:id/connect-urls`) and the sheet waits for the first call.
 *
 * On a phone the result comes first and Copy sticks to the bottom; URLs
 * wrap (`break-all`) and snippets scroll sideways.
 */

const CLIENT_KEY = "assay.connect.client.";
const POLL_MS = 5_000;

function readClient(agentId: string): McpClient | null {
  try {
    const v = window.localStorage.getItem(CLIENT_KEY + agentId);
    return isMcpClient(v) ? v : null;
  } catch {
    return null;
  }
}

function writeClient(agentId: string, client: McpClient) {
  try {
    window.localStorage.setItem(CLIENT_KEY + agentId, client);
  } catch {
    // Not remembered; the server keeps the client of every URL it hands out.
  }
}

export interface ConnectSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The agent to connect; the first agent when omitted (a picker shows when there are several). */
  agentId?: string | null;
  /** Prefill: the page's own server URL, or a row's URL on "Change". */
  initialUrl?: string | null;
  /** "Change" on a server row: the result is a new URL, and the old one must be replaced. */
  changing?: boolean;
}

export function ConnectSheet({ open, onOpenChange, agentId: agentProp, initialUrl, changing }: ConnectSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[640px]">
        {open ? <ConnectBody agentProp={agentProp ?? null} initialUrl={initialUrl ?? null} changing={Boolean(changing)} onDone={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

type ChoiceKind = ConnectChoice["kind"];

function ConnectBody({
  agentProp,
  initialUrl,
  changing,
  onDone,
}: {
  agentProp: string | null;
  initialUrl: string | null;
  changing: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [waitPoll, setWaitPoll] = React.useState<number | false>(false);
  const data = useAgentsAndKeys();
  const [agentId, setAgentId] = React.useState<string | null>(agentProp);
  const agent = data.agents.find((a) => a.agentId === agentId) ?? data.agents[0] ?? null;
  const effectiveAgentId = agent?.agentId ?? null;

  const parsedInitial = React.useMemo(() => (initialUrl ? parseMcpUrl(initialUrl) : null), [initialUrl]);
  const unreadable = Boolean(initialUrl) && !parsedInitial;
  const [kind, setKind] = React.useState<ChoiceKind>(parsedInitial?.choice.kind ?? "everything");
  const [slug, setSlug] = React.useState<string | null>(parsedInitial?.choice.kind === "toolset" ? parsedInitial.choice.slug : null);
  const [tools, setTools] = React.useState<string[]>(parsedInitial?.choice.kind === "tools" ? parsedInitial.choice.tools : []);
  const [free, setFree] = React.useState(parsedInitial?.options.free ?? false);
  const fixedUrl = parsedInitial?.choice.kind === "url" ? parsedInitial.choice.url : null;

  const toolsets = useToolsets();
  const sets = React.useMemo(() => toolsets.data?.items ?? [], [toolsets.data]);
  const catalogue = useCatalogue();
  const access = useAgentAccess(effectiveAgentId);
  const servers = useAgentServers(effectiveAgentId, { pollMs: waitPoll });
  const update = useUpdateAccess(effectiveAgentId);

  // A tool set picked by default when there is one, so the choice needs no second click.
  React.useEffect(() => {
    if (kind === "toolset" && !slug && sets[0]) setSlug(sets[0].slug);
  }, [kind, slug, sets]);

  const choice: ConnectChoice | null =
    kind === "everything"
      ? { kind: "everything" }
      : kind === "toolset"
        ? slug
          ? { kind: "toolset", slug }
          : null
        : kind === "tools"
          ? tools.length > 0
            ? { kind: "tools", tools }
            : null
          : fixedUrl
            ? { kind: "url", url: fixedUrl }
            : null;
  const url = choice ? buildMcpUrl(choice, { free }) : null;
  const preview = useMcpPreview(url, effectiveAgentId);
  const serverName = choice ? suggestServerName(choice) : "assay";

  // The key: the full one only when it was created here; otherwise its prefix.
  const liveKeys: KeyRow[] = (effectiveAgentId ? data.keys[effectiveAgentId] ?? [] : []).filter((k) => !k.revokedAt);
  const [created, setCreated] = React.useState<{ token: string; prefix: string } | null>(null);
  const keyPrefix = created?.prefix ?? liveKeys[0]?.prefix ?? null;
  const createKey = useMutation({
    mutationFn: () => createCredential(effectiveAgentId!, { name: "My agent", scopes: ["tools:call"] }) as Promise<{ token: string; prefix: string }>,
    onSuccess: (key) => {
      setCreated({ token: key.token, prefix: key.prefix });
      void queryClient.invalidateQueries({ queryKey: ["agent-keys"] });
    },
  });

  // The client tab, remembered per agent (this browser first, else the server's last hand-out).
  const [client, setClient] = React.useState<McpClient>("claude-code");
  React.useEffect(() => {
    if (!effectiveAgentId) return;
    const remembered = readClient(effectiveAgentId) ?? (servers.data?.servers.map((s) => s.client).find(isMcpClient) ?? null);
    if (remembered) setClient(remembered);
  }, [effectiveAgentId, servers.data]);

  const [recorded, setRecorded] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);
  const record = useMutation({
    mutationFn: () => recordConnectUrl(effectiveAgentId!, { url: url!, serverName, client }),
    onSuccess: (row) => {
      setRecorded(row?.canonicalUrl ?? preview.data?.canonicalUrl ?? url);
      void queryClient.invalidateQueries({ queryKey: toolsetKeys.servers(effectiveAgentId!) });
    },
  });
  const recordedRow = servers.data?.servers.find((s) => s.canonicalUrl === recorded) ?? null;
  const firstCallSeen = Boolean(recordedRow && (recordedRow.firstCallAt || recordedRow.lastCallAt));
  React.useEffect(() => setWaitPoll(recorded && !firstCallSeen ? POLL_MS : false), [recorded, firstCallSeen]);
  // A new answer is a new URL: it has not been handed out yet.
  React.useEffect(() => setRecorded(null), [url]);

  const blocked = copyBlocked(preview.data);
  const snippet = url ? mcpConfig(client, { url, token: created?.token ?? null, keyPrefix, serverName }) : "";

  const handOut = () => {
    if (!url || !effectiveAgentId || record.isPending || recorded) return;
    record.mutate();
  };
  const copy = async () => {
    if (!url || blocked) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
    } catch {
      toast.error("Copy did not work here: select the text and copy it.");
    }
    handOut();
  };

  const setClientRemembered = (next: McpClient) => {
    setClient(next);
    if (effectiveAgentId) writeClient(effectiveAgentId, next);
  };

  const fixWarning = (warning: PreviewWarning) => {
    if (!warning.fix || !access.data || !effectiveAgentId) return;
    if (warning.fix.kind === "allow-tools") {
      const body = allowToolsBody(access.data, warning.fix.toolIds, warning.fix.toolNames);
      if (body) update.mutate(body, { onSuccess: () => toast.success("Allowed. The tool list is updated.") });
    }
  };

  const agentName = agent?.label ?? "your agent";
  // `?tools=` takes each tool's MCP name (never its display name); tools no provider serves are shown, disabled.
  const nameOf = (mcpName: string) => catalogue.tools.find((t) => mcpToolName(t) === mcpName)?.name ?? mcpName;
  const toolOptions = catalogue.tools
    .map((t) => ({ tool: t, mcp: mcpToolName(t) }))
    .filter((x): x is { tool: (typeof catalogue.tools)[number]; mcp: string } => x.mcp !== null && !tools.includes(x.mcp))
    .sort((a, b) => Number(a.tool.providerCount === 0) - Number(b.tool.providerCount === 0) || a.tool.name.localeCompare(b.tool.name))
    .map(({ tool: t, mcp }) => ({
      id: mcp,
      label: t.name,
      disabled: t.providerCount === 0,
      detail:
        t.providerCount === 0
          ? "No provider yet"
          : `${t.pricingMode === "FREE" ? "Free" : `from ${formatMoney(t.fromPrice, { decimals: 4 })}`} · ${t.providerCount} provider${t.providerCount === 1 ? "" : "s"}`,
    }));
  const others = servers.data && preview.data ? overBudgetWith(preview.data, servers.data.servers) : null;

  return (
    <>
      <SheetHeader>
        <SheetTitle>Connect “{agentName}”</SheetTitle>
        <SheetDescription>{changing ? "Pick again; the result is a new URL. Replace the old URL in your app." : "One question, then copy."}</SheetDescription>
      </SheetHeader>

      <div className="flex w-full min-w-0 flex-col gap-4 px-[18px] pb-4 pt-3">
        {data.agents.length > 1 ? (
          <label className="flex w-full flex-col gap-1.5">
            <span className="text-label-13 text-01">Agent</span>
            <select
              className="w-full rounded-md border border-02 bg-01 px-3 py-2 text-body-sm text-01"
              value={effectiveAgentId ?? ""}
              onChange={(e) => setAgentId(e.target.value)}
            >
              {data.agents.map((a) => (
                <option key={a.agentId} value={a.agentId}>
                  {a.label ?? "Agent"}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {unreadable ? (
          <p role="alert" className="rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700">
            We couldn&apos;t read this URL. Start a new one below.
          </p>
        ) : null}

        <fieldset className="flex flex-col gap-2" data-testid="connect-question">
          <legend className="pb-1 text-label-sm text-01">What should it use?</legend>
          <ChoiceRow id="everything" current={kind} onPick={setKind} title="Everything" detail="Every tool on Assay, through one server." />
          <ChoiceRow
            id="toolset"
            current={kind}
            onPick={setKind}
            title="One of my tool sets"
            detail="Only the tools in that set, with its provider rules."
          >
            {kind === "toolset" ? (
              toolsets.isPending ? (
                <Skeleton className="h-9 w-full" />
              ) : sets.length === 0 ? (
                <p className="text-body-13 text-02">
                  You have no tool sets yet.{" "}
                  <Link href="/toolsets/mine" className="font-semibold text-primary-600 hover:underline">
                    Create one
                  </Link>
                </p>
              ) : (
                <select
                  aria-label="Tool set"
                  className="w-full rounded-md border border-02 bg-01 px-3 py-2 text-body-sm text-01"
                  value={slug ?? ""}
                  onChange={(e) => setSlug(e.target.value)}
                >
                  {sets.map((set) => (
                    <option key={set.id} value={set.slug}>
                      {set.name} · {set.toolCount} tool{set.toolCount === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              )
            ) : null}
          </ChoiceRow>
          <ChoiceRow id="tools" current={kind} onPick={setKind} title="Only these tools" detail="Pick the tools; nothing else is listed.">
            {kind === "tools" ? (
              <div className="flex flex-col gap-2">
                {tools.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Chosen tools">
                    {tools.map((name) => (
                      <li key={name} className="inline-flex min-h-10 items-center gap-1 rounded-full bg-03 py-0.5 pl-2.5 pr-1 text-label-xs text-01 tablet:min-h-0">
                        <span className="[overflow-wrap:anywhere]">{nameOf(name)}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${nameOf(name)}`}
                          className="flex size-8 items-center justify-center rounded-full text-03 hover:bg-02 hover:text-01 tablet:size-6"
                          onClick={() => setTools(tools.filter((t) => t !== name))}
                        >
                          <X aria-hidden="true" className="size-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <EntityPicker
                  label="Add a tool"
                  value={null}
                  placeholder="Search tools by name"
                  options={toolOptions}
                  onChange={(id) => id && setTools([...tools, id])}
                  inline
                />
                {tools.length >= 2 ? <SaveAsToolset tools={tools} nameOf={nameOf} onSaved={(newSlug) => { setSlug(newSlug); setKind("toolset"); }} suggest={tools.length > 10} /> : null}
              </div>
            ) : null}
          </ChoiceRow>
          {fixedUrl ? (
            <ChoiceRow id="url" current={kind} onPick={setKind} title="This server" detail={<span className="break-all font-mono text-mono-12">{fixedUrl}</span>} />
          ) : null}
        </fieldset>

        <ResultLine url={url} preview={preview.data} pending={preview.isPending && Boolean(url)} error={preview.isError ? preview.error : null} onRetry={() => void preview.refetch()} />

        {preview.data ? (
          <ul className="flex flex-col gap-1.5" data-testid="connect-warnings">
            {previewWarnings(preview.data).map((warning) => (
              <li
                key={warning.code}
                className={cn(
                  "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-body-13",
                  warning.tone === "danger" ? "bg-danger-10 text-danger-700" : warning.tone === "warning" ? "bg-warning-10 text-warning-700" : "bg-02 text-02",
                )}
              >
                <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{warning.text}</span>
                {warning.fix?.kind === "allow-tools" && access.data?.accessMode === "RESTRICTED" ? (
                  <Button size="sm" variant="secondary" loading={update.isPending} onClick={() => fixWarning(warning)}>
                    Allow them
                  </Button>
                ) : warning.fix && effectiveAgentId ? (
                  <Link href={`/agents?agent=${encodeURIComponent(effectiveAgentId)}#access`} className="text-label-13 font-semibold underline">
                    What this agent can use
                  </Link>
                ) : null}
              </li>
            ))}
            {others !== null ? (
              <li className="flex items-center gap-2 rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700" data-testid="connect-over-budget">
                <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                With its other servers, {agentName} would see {others} tools. Agents pick less accurately past 25: connect a tool set or only the tools it needs.
              </li>
            ) : null}
          </ul>
        ) : null}

        {url && !blocked ? (
          <div className="flex min-w-0 flex-col gap-2">
            <KeyLine
              prefix={keyPrefix}
              full={Boolean(created)}
              creating={createKey.isPending}
              onCreate={effectiveAgentId ? () => createKey.mutate() : undefined}
            />
            <McpConfigTabs
              token={created?.token ?? null}
              keyPrefix={keyPrefix}
              url={url}
              serverName={serverName}
              client={client}
              onClientChange={setClientRemembered}
              onCopy={() => handOut()}
            />
          </div>
        ) : null}

        <details className="rounded-lg border border-01 bg-02 px-3 py-2.5" open={free || undefined}>
          <summary className="cursor-pointer select-none text-label-13 text-01">More options</summary>
          <div className="mt-3 flex flex-col gap-1">
            <Switch
              className="min-h-10 tablet:min-h-0"
              checked={free}
              disabled={!free && !offersFreeOnly(preview.data)}
              onChange={(e) => setFree(e.target.checked)}
              label="Only free tools"
            />
            <p className="text-body-xs text-03">
              {free || offersFreeOnly(preview.data)
                ? "Lists only tools with free calls. Calls through this URL are never charged; past the free calls they are refused."
                : "Not available here: none of these tools has free calls."}
            </p>
          </div>
        </details>

        {recorded ? (
          firstCallSeen ? (
            <p className="flex items-center gap-2 text-body-13 text-success-700" data-testid="connect-first-call">
              <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success-500" />
              The first call arrived through this URL.
            </p>
          ) : (
            <p className="flex items-center gap-2 text-body-13 text-02" aria-live="polite" data-testid="connect-waiting">
              <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-primary-500 motion-reduce:animate-none" />
              Waiting for the first call… (updates by itself)
            </p>
          )
        ) : null}
      </div>

      <div className="sticky bottom-0 z-10 flex w-full flex-wrap items-center gap-2 border-t border-01 bg-01 px-[18px] py-3">
        <Button type="button" icon={copied ? <Check /> : <Copy />} onClick={() => void copy()} disabled={!url || blocked} data-testid="connect-copy" aria-live="polite">
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            handOut();
            onDone();
          }}
        >
          Done
        </Button>
        {blocked ? <span className="text-body-xs text-danger-700">Nothing to copy: this agent can use none of these tools.</span> : null}
      </div>
    </>
  );
}

function ChoiceRow({
  id,
  current,
  onPick,
  title,
  detail,
  children,
}: {
  id: ChoiceKind;
  current: ChoiceKind;
  onPick: (id: ChoiceKind) => void;
  title: string;
  detail: React.ReactNode;
  children?: React.ReactNode;
}) {
  const checked = current === id;
  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border px-3 py-2.5", checked ? "border-primary-500 bg-primary-10" : "border-02 bg-01")}>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="radio" name="connect-choice" className="mt-1 accent-primary-500" checked={checked} onChange={() => onPick(id)} />
        <span className="flex min-w-0 flex-col">
          <span className="text-label-13 text-01">{title}</span>
          <span className="text-body-xs text-02">{detail}</span>
        </span>
      </label>
      {children ? <div className="pl-6">{children}</div> : null}
    </div>
  );
}

/** "Your agent will see 4 tools (~0.9k tokens)", with the list behind it; a skeleton while it loads, never 0. */
export function ResultLine({
  url,
  preview,
  pending,
  error,
  onRetry,
}: {
  url: string | null;
  preview: McpUrlPreview | undefined;
  pending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (!url) {
    return <p className="text-body-13 text-03">Pick what it should use to see the result.</p>;
  }
  return (
    <section aria-label="Result" className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-01 bg-02 p-3" data-testid="connect-result">
      <p className="break-all font-mono text-mono-12 text-02">{url}</p>
      {pending ? (
        <p className="flex items-center gap-2 text-label-13 text-02" data-testid="connect-result-loading">
          Your agent will see <Skeleton className="inline-block h-4 w-16" /> tools (~ tokens)
        </p>
      ) : error ? (
        <p className="flex flex-wrap items-center gap-2 text-body-13 text-02" role="alert">
          Couldn&apos;t load the tool list: {errorText(error, "try again").replace(/\.$/, "")}.
          <button type="button" className="font-semibold text-primary-600 hover:underline" onClick={onRetry}>
            Retry
          </button>
          <span className="text-body-xs text-03">Copy still works.</span>
        </p>
      ) : preview ? (
        <details>
          <summary className="cursor-pointer select-none text-label-13 text-01">{previewSummary(preview)}</summary>
          <p className="mt-1 text-body-xs text-03">Tokens: what this tool list costs your agent&apos;s model on each request, estimated.</p>
          <ul className="mt-2 flex flex-col divide-y divide-01">
            {preview.tools
              .filter((t) => t.listed)
              .map((tool) => (
                <li key={tool.toolId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5">
                  <span className="break-all font-mono text-mono-12 text-01">{tool.name}</span>
                  <span className="text-body-xs text-03">
                    {tool.price ?? "No provider fits"} · {tool.providerCount} provider{tool.providerCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function KeyLine({ prefix, full, creating, onCreate }: { prefix: string | null; full: boolean; creating: boolean; onCreate?: () => void }) {
  if (!prefix) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-body-13 text-02">
        This agent has no key yet.
        {onCreate ? (
          <Button size="sm" type="button" loading={creating} onClick={onCreate}>
            Create a key
          </Button>
        ) : null}
      </p>
    );
  }
  const mode = keyMode(prefix);
  const name = prefix.replace(/[.…]+$/, "");
  return (
    <p className="text-body-xs text-03" data-testid="connect-key-line">
      Uses {mode ?? "the"} key <span className="font-mono text-01">{name}…</span>
      {full ? (
        <span className="text-warning-700"> · shown in full once: copy it now.</span>
      ) : onCreate ? (
        <>
          {" "}
          · the full key was shown once, when it was made.{" "}
          <button type="button" className="font-semibold text-primary-600 hover:underline" disabled={creating} onClick={onCreate}>
            Create a new key
          </button>
        </>
      ) : null}
    </p>
  );
}

/** "Only these tools" → a tool set, name only (the slug is generated). */
function SaveAsToolset({
  tools,
  nameOf,
  onSaved,
  suggest,
}: {
  tools: string[];
  nameOf: (mcpName: string) => string;
  onSaved: (slug: string) => void;
  suggest: boolean;
}) {
  const queryClient = useQueryClient();
  const catalogue = useCatalogue();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(`My ${tools.length} tools`);
  const save = useMutation({
    mutationFn: () =>
      createToolset({
        name: name.trim(),
        entries: tools
          .map((mcpName) => catalogue.tools.find((t) => mcpToolName(t) === mcpName)?.toolId)
          .filter((id): id is string => Boolean(id))
          .map(defaultEntry),
      }),
    onSuccess: (set) => {
      void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
      toast.success(`Saved as the tool set ${set.name}`);
      onSaved(set.slug);
    },
  });
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        {suggest ? `Save these ${tools.length} tools as a tool set` : "Save as tool set"}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2 tablet:flex-row tablet:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) save.mutate();
      }}
    >
      <Field
        id="save-as-toolset"
        label="Tool set name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={save.isError ? errorText(save.error) : undefined}
        wrapperClassName="flex-1"
      />
      <Button type="submit" size="sm" loading={save.isPending} disabled={!name.trim()}>
        Save
      </Button>
    </form>
  );
}
