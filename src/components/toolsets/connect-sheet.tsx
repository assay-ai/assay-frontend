"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CircleCheck, Copy, Info, TriangleAlert, X } from "lucide-react";
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
import { mcpHost } from "@/features/connect/mcp-endpoint";
import {
  buildMcpUrl,
  defaultDiscovery,
  isToolsetChoice,
  mcpToolName,
  parseMcpUrl,
  suggestServerName,
  toolDisplay,
  uniqueServerName,
  type ConnectChoice,
  type DiscoveryChoice,
} from "@/features/connect/mcp-url";
import { allowToolsBody, restoreBody } from "@/features/toolsets/access-result";
import { defaultEntry } from "@/features/toolsets/entry-rules";
import { ALWAYS_LATEST_LABEL, DISCOVERY_DETAILS, DISCOVERY_LABELS, DRAFT_NOTICE, HOW_AGENT_SEES_LABEL, lockLabel } from "@/features/toolsets/labels";
import { badgeLabel } from "@/features/toolsets/public";
import { copyBlocked, offersFreeOnly, overBudgetWith, previewSummary, previewWarnings, type PreviewWarning } from "@/features/toolsets/preview";
import { createCredential } from "@/services/account.service";
import type { PublicToolsetCard } from "@/services/public-toolsets.service";
import { createToolset, recordConnectUrl, type McpUrlPreview } from "@/services/toolsets.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";

import { AlwaysLoaded } from "./always-loaded";
import {
  errorText,
  toolsetKeys,
  useAgentAccess,
  useAgentServers,
  useMcpPreview,
  usePublicCategories,
  usePublicToolset,
  usePublicToolsets,
  useToolsetByToken,
  useToolsets,
  useUpdateAccess,
} from "./use-toolsets";

/**
 * The Connect sheet (design spec §7.11): one question — "What should it
 * use?" — and the result updates live under it.
 *
 *   Everything            /                     (the agent searches)
 *   One topic             /c/{category}
 *   One of my tool sets   /my/{slug}[@N]
 *   A shared tool set     /@{handle}/{slug}@N   or /u/{token}@N
 *   Only these tools      /?tools=…
 *
 * Under the question: the summary line from `POST /mcp-urls/preview` ("Your
 * agent will see 4 tools (~0.9k tokens)", or in search mode "4 tools (search)
 * — about 0.9k tokens; 37 tools reachable"; a skeleton while it loads, never
 * 0), the warnings with their fixes, the client tabs (remembered per agent)
 * and More options: the version lock, "How the agent sees tools", "Always
 * loaded" and "Only free tools". Copy or Done records the URL
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

type ChoiceKind = "everything" | "topic" | "toolset" | "shared" | "tools" | "url";

/** A shared tool set picked in the sheet: from the catalogue, or the link-only one the sheet was opened with. */
type SharedPick = { kind: "shared"; handle: string; slug: string } | { kind: "link"; token: string };

function kindOfInitial(choice: ConnectChoice | undefined): ChoiceKind {
  switch (choice?.kind) {
    case "topic":
    case "toolset":
    case "tools":
    case "everything":
      return choice.kind;
    case "shared":
    case "link":
      return "shared";
    case undefined:
      return "everything";
    default:
      return "url";
  }
}

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
  const initial = parsedInitial?.choice;
  const unreadable = Boolean(initialUrl) && !parsedInitial;
  const [kind, setKind] = React.useState<ChoiceKind>(kindOfInitial(initial));
  const [slug, setSlug] = React.useState<string | null>(initial?.kind === "toolset" ? initial.slug : null);
  const [lockMine, setLockMine] = React.useState(Boolean(initial?.kind === "toolset" && initial.version));
  const [category, setCategory] = React.useState<string | null>(initial?.kind === "topic" ? initial.category : null);
  const [shared, setShared] = React.useState<SharedPick | null>(
    initial?.kind === "shared" ? { kind: "shared", handle: initial.handle, slug: initial.slug } : initial?.kind === "link" ? { kind: "link", token: initial.token } : null,
  );
  // A shared set's lock: the version the URL named, else the latest once known; on by default except for Official sets.
  const [explicitVersion, setExplicitVersion] = React.useState<number | null>(
    initial && isToolsetChoice(initial) && initial.kind !== "toolset" ? (initial.version ?? null) : null,
  );
  const [lockShared, setLockShared] = React.useState<boolean | null>(initial && (initial.kind === "shared" || initial.kind === "link") ? Boolean(initial.version) : null);
  const [tools, setTools] = React.useState<string[]>(initial?.kind === "tools" ? initial.tools : []);
  const [free, setFree] = React.useState(parsedInitial?.options.free ?? false);
  const [discovery, setDiscovery] = React.useState<DiscoveryChoice | null>(parsedInitial?.options.discovery ?? null);
  const fixedUrl = initial && kindOfInitial(initial) === "url" ? buildMcpUrl(initial, { free: false }) : null;

  const toolsets = useToolsets();
  const sets = React.useMemo(() => toolsets.data?.items ?? [], [toolsets.data]);
  const catalogue = useCatalogue();
  const access = useAgentAccess(effectiveAgentId);
  const servers = useAgentServers(effectiveAgentId, { pollMs: waitPoll });
  const update = useUpdateAccess(effectiveAgentId);
  const categories = usePublicCategories();
  const publicSets = usePublicToolsets({ limit: 100 }, kind === "shared");
  const sharedPage = usePublicToolset(shared?.kind === "shared" ? shared.handle : null, shared?.kind === "shared" ? shared.slug : null);
  const linkPage = useToolsetByToken(shared?.kind === "link" ? shared.token : null, null);
  const sharedInfo = shared?.kind === "link" ? linkPage.data : sharedPage.data;

  // A tool set picked by default when there is one, so the choice needs no second click.
  React.useEffect(() => {
    if (kind === "toolset" && !slug && sets[0]) setSlug(sets[0].slug);
  }, [kind, slug, sets]);
  // Community and Provider sets are locked by default, so a publisher cannot change them under the agent.
  React.useEffect(() => {
    if (sharedInfo && lockShared === null) setLockShared(sharedInfo.badge !== "OFFICIAL");
  }, [sharedInfo, lockShared]);

  const mine = sets.find((set) => set.slug === slug) ?? null;
  const mineLatest = mine?.latestVersion ?? (initial?.kind === "toolset" ? (initial.version ?? null) : null);
  const sharedVersion = explicitVersion ?? sharedInfo?.version ?? null;
  const choice: ConnectChoice | null =
    kind === "everything"
      ? { kind: "everything" }
      : kind === "topic"
        ? category
          ? { kind: "topic", category }
          : null
        : kind === "toolset"
          ? slug
            ? { kind: "toolset", slug, version: lockMine && mineLatest ? mineLatest : null }
            : null
          : kind === "shared"
            ? shared
              ? { ...shared, version: lockShared !== false && sharedVersion ? sharedVersion : null }
              : null
            : kind === "tools"
              ? tools.length > 0
                ? { kind: "tools", tools }
                : null
              : fixedUrl
                ? { kind: "url", url: fixedUrl }
                : null;
  const url = choice ? buildMcpUrl(choice, { free, discovery }) : null;
  const preview = useMcpPreview(url, effectiveAgentId);
  // Unique among the agent's other servers, so two servers never share a name in one client.
  const serverName = uniqueServerName(
    choice ? suggestServerName(choice) : "assay",
    (servers.data?.servers ?? []).filter((s) => s.canonicalUrl !== preview.data?.canonicalUrl && s.canonicalUrl !== url).map((s) => s.serverName),
  );

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
      const undo = restoreBody(access.data);
      const n = warning.fix.toolIds.length;
      if (body) {
        update.mutate(body, {
          onSuccess: () =>
            toast.success(`Allowed ${n} tool${n === 1 ? "" : "s"} for ${agent?.label ?? "this agent"}`, {
              description: "The tool list is updated.",
              duration: 8000,
              action: { label: "Undo", onClick: () => update.mutate(undo, { onSuccess: () => toast.success("Undone") }) },
            }),
        });
      }
    }
  };

  const agentName = agent?.label ?? "your agent";
  // `?tools=` takes each tool's MCP name (never its display name); tools no provider serves are shown, disabled.
  const toolOptions = catalogue.tools
    .map((t) => ({ tool: t, mcp: mcpToolName(t) }))
    .filter((x): x is { tool: (typeof catalogue.tools)[number]; mcp: string } => x.mcp !== null && !tools.includes(x.mcp))
    .sort((a, b) => Number(a.tool.providerCount === 0) - Number(b.tool.providerCount === 0) || a.tool.name.localeCompare(b.tool.name))
    .map(({ tool: t, mcp }) => {
      const title = toolDisplay(t).title;
      const price =
        t.providerCount === 0
          ? "No provider yet"
          : `${t.pricingMode === "FREE" ? "Free" : `from ${formatMoney(t.fromPrice, { decimals: 4 })}`} · ${t.providerCount} provider${t.providerCount === 1 ? "" : "s"}`;
      return { id: mcp, label: mcp, disabled: t.providerCount === 0, detail: title ? `${title} · ${price}` : price };
    });
  const others = servers.data && preview.data ? overBudgetWith(preview.data, servers.data.servers) : null;
  const searching = preview.data?.discovery === "SEARCH";
  const defaultMode = choice ? (defaultDiscovery(choice) ?? "auto") : "auto";
  const modes: DiscoveryChoice[] = choice?.kind === "everything" ? ["search", "full"] : ["auto", "full", "search"];
  const mode = discovery ?? defaultMode;
  const lockable = choice && isToolsetChoice(choice);
  const lockVersion = kind === "toolset" ? mineLatest : sharedVersion;
  const locked = kind === "toolset" ? lockMine : lockShared !== false;
  const moreSummary = [
    lockable && lockVersion ? (locked ? `locked to v${lockVersion}` : kind === "toolset" ? "live Draft" : "always latest") : null,
    discovery ? DISCOVERY_LABELS[discovery].toLowerCase() : null,
    free ? "free tools only" : null,
  ].filter(Boolean);

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
              className="min-h-10 w-full rounded-md border border-02 bg-01 px-3 py-2 text-body-sm text-01"
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
          <ChoiceRow id="everything" current={kind} onPick={setKind} title="Everything" detail="Every tool on Assay, through one server. The agent searches for what it needs." />
          <ChoiceRow id="topic" current={kind} onPick={setKind} title="One topic" detail="Every tool about one thing, such as weather.">
            {kind === "topic" ? (
              categories.isPending ? (
                <Skeleton className="h-10 w-full" />
              ) : categories.isError || !categories.data?.categories.length ? (
                <p className="text-body-13 text-02">Topics could not be loaded. Pick another answer, or try again later.</p>
              ) : (
                <select
                  aria-label="Topic"
                  className="min-h-10 w-full rounded-md border border-02 bg-01 px-3 py-2 text-body-sm text-01"
                  value={category ?? ""}
                  onChange={(e) => setCategory(e.target.value || null)}
                >
                  <option value="">Pick a topic…</option>
                  {categories.data.categories
                    .filter((c) => c.tools > 0)
                    .map((c) => (
                      <option key={c.category} value={c.category}>
                        {topicLabel(c.category)} · {c.tools} tool{c.tools === 1 ? "" : "s"}
                      </option>
                    ))}
                </select>
              )
            ) : null}
          </ChoiceRow>
          <ChoiceRow id="toolset" current={kind} onPick={setKind} title="One of my tool sets" detail="Only the tools in that set, with its provider rules.">
            {kind === "toolset" ? (
              toolsets.isPending ? (
                <Skeleton className="h-10 w-full" />
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
                  className="min-h-10 w-full rounded-md border border-02 bg-01 px-3 py-2 text-body-sm text-01"
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
          <ChoiceRow id="shared" current={kind} onPick={setKind} title="A shared tool set" detail="One someone published: find it in the catalogue, or paste its link.">
            {kind === "shared" ? (
              <SharedPicker
                value={shared}
                info={sharedInfo ?? null}
                loading={(shared?.kind === "link" ? linkPage.isPending : sharedPage.isPending) && Boolean(shared)}
                cards={publicSets.data?.toolsets ?? []}
                cardsLoading={publicSets.isPending}
                onPick={(next, version) => {
                  setShared(next);
                  setExplicitVersion(version ?? null);
                  setLockShared(version ? true : null);
                }}
              />
            ) : null}
          </ChoiceRow>
          <ChoiceRow id="tools" current={kind} onPick={setKind} title="Only these tools" detail="Pick the tools; nothing else is listed.">
            {kind === "tools" ? (
              <div className="flex flex-col gap-2">
                {tools.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Chosen tools">
                    {tools.map((name) => (
                      <li key={name} className="inline-flex min-h-10 items-center gap-1 rounded-full bg-03 py-0.5 pl-2.5 pr-1 text-label-xs text-01 tablet:min-h-0">
                        <span className="font-mono [overflow-wrap:anywhere]">{name}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${name}`}
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
                {tools.length >= 2 ? (
                  <SaveAsToolset
                    tools={tools}
                    onSaved={(newSlug) => {
                      setSlug(newSlug);
                      setKind("toolset");
                    }}
                    suggest={tools.length > 10}
                  />
                ) : null}
              </div>
            ) : null}
          </ChoiceRow>
          {fixedUrl ? (
            <ChoiceRow id="url" current={kind} onPick={setKind} title="This server" detail={<span className="break-all font-mono text-mono-12">{fixedUrl}</span>} />
          ) : null}
        </fieldset>

        {/* On a phone the result comes first (spec §7.12); from tablet up it sits under the question. */}
        <div className="order-first min-w-0 tablet:order-none" data-testid="connect-result-slot">
          <ResultLine url={url} preview={preview.data} pending={preview.isPending && Boolean(url)} error={preview.isError ? preview.error : null} onRetry={() => void preview.refetch()} />
        </div>

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
                  <Link href={`/agents?agent=${encodeURIComponent(effectiveAgentId)}#access`} className="min-h-10 content-center text-label-13 font-semibold underline tablet:min-h-0">
                    What this agent can use
                  </Link>
                ) : null}
              </li>
            ))}
            {others !== null ? (
              <li className="flex flex-wrap items-center gap-2 rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700" data-testid="connect-over-budget">
                <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  With its other servers that show every tool, {agentName} would see {others} tools. Agents pick less accurately past 25.
                </span>
                <Button size="sm" variant="secondary" onClick={() => setDiscovery(choice?.kind === "everything" ? null : "search")}>
                  Let the agent search here
                </Button>
              </li>
            ) : null}
            {searching ? (
              <li className="flex items-start gap-2 rounded-lg bg-02 px-3 py-2 text-body-xs text-02" data-testid="connect-search-note">
                <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                The agent finds tools here with search_tools and runs them with call_tool. “Always allow” on call_tool in your app allows every tool this server
                can reach; this agent&apos;s limits still apply to each call.
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

        <details className="rounded-lg border border-01 bg-02 px-3 py-2.5" open={free || Boolean(discovery) || undefined} data-testid="connect-more">
          <summary className="min-h-10 cursor-pointer select-none content-center text-label-13 text-01 tablet:min-h-0">
            More options{moreSummary.length > 0 ? <span className="font-normal text-03"> · {moreSummary.join(" · ")}</span> : null}
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {lockable ? (
              <fieldset className="flex flex-col gap-1.5" data-testid="connect-lock">
                <legend className="pb-1 text-label-13 text-01">Version</legend>
                {lockVersion ? (
                  <>
                    <OptionRadio name="lock" checked={locked} onChange={() => (kind === "toolset" ? setLockMine(true) : setLockShared(true))} title={lockLabel(lockVersion)} />
                    <OptionRadio
                      name="lock"
                      checked={!locked}
                      onChange={() => (kind === "toolset" ? setLockMine(false) : setLockShared(false))}
                      title={kind === "toolset" ? "Live Draft" : ALWAYS_LATEST_LABEL}
                      detail={kind === "toolset" ? DRAFT_NOTICE : "New versions reach the agent without you checking them first."}
                    />
                  </>
                ) : (
                  <p className="text-body-xs text-03">
                    {kind === "toolset" ? "No version saved yet: the URL serves the live Draft. Share or save a version on the tool set's page to lock to it." : "Loading the versions…"}
                  </p>
                )}
              </fieldset>
            ) : null}

            <fieldset className="flex flex-col gap-1.5" data-testid="connect-discovery">
              <legend className="pb-1 text-label-13 text-01">{HOW_AGENT_SEES_LABEL}</legend>
              {modes.map((m) => (
                <OptionRadio
                  key={m}
                  name="discovery"
                  checked={mode === m}
                  onChange={() => setDiscovery(m === defaultMode ? null : m)}
                  title={`${DISCOVERY_LABELS[m]}${m === defaultMode ? " (default)" : ""}`}
                  detail={DISCOVERY_DETAILS[m]}
                />
              ))}
            </fieldset>

            {access.data ? (
              <AlwaysLoaded access={access.data} agentName={agentName} searching={preview.data ? preview.data.discovery === "SEARCH" : undefined} />
            ) : access.isPending && effectiveAgentId ? (
              <Skeleton className="h-10 w-full" />
            ) : null}

            <div className="flex flex-col gap-1">
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
          // Done records nothing: a URL is handed out only when it is copied.
          onClick={onDone}
        >
          Done
        </Button>
        {blocked ? <span className="text-body-xs text-danger-700">Nothing to copy: this agent can use none of these tools.</span> : null}
      </div>
    </>
  );
}

/** "weather" → "Weather". */
function topicLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1).replace(/-/g, " ");
}

function OptionRadio({ name, checked, onChange, title, detail }: { name: string; checked: boolean; onChange: () => void; title: string; detail?: string }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 tablet:min-h-0">
      <input type="radio" name={name} className="mt-1 accent-primary-500" checked={checked} onChange={onChange} />
      <span className="flex min-w-0 flex-col">
        <span className="text-body-13 text-01">{title}</span>
        {detail ? <span className="text-body-xs text-03">{detail}</span> : null}
      </span>
    </label>
  );
}

/** "A shared tool set": the one the sheet was opened with, or one picked from the catalogue (searchable). */
function SharedPicker({
  value,
  info,
  loading,
  cards,
  cardsLoading,
  onPick,
}: {
  value: SharedPick | null;
  info: { name: string; handle: string; slug: string; badge: string; version: number } | null;
  loading: boolean;
  cards: PublicToolsetCard[];
  cardsLoading: boolean;
  onPick: (next: SharedPick, version?: number | null) => void;
}) {
  const [pasted, setPasted] = React.useState("");
  const [pasteError, setPasteError] = React.useState<string | null>(null);
  const applyPasted = () => {
    const read = readSharedLink(pasted);
    if (!read) {
      setPasteError("We couldn't read this link. Check it, or search by name above.");
      return;
    }
    setPasteError(null);
    setPasted("");
    onPick(read.pick, read.version);
  };
  const options = cards.map((card) => ({
    id: `${card.handle}/${card.slug}`,
    label: `@${card.handle}/${card.slug}`,
    detail: `${card.name} · ${badgeLabel(card.badge)} · ${card.toolCount} tool${card.toolCount === 1 ? "" : "s"}`,
  }));
  return (
    <div className="flex flex-col gap-2">
      {value ? (
        loading ? (
          <Skeleton className="h-10 w-full" />
        ) : info ? (
          <p className="text-body-13 text-01">
            {info.name} <span className="text-03">· @{info.handle}/{info.slug} · {badgeLabel(info.badge)} · newest v{info.version}</span>
          </p>
        ) : (
          <p className="text-body-13 text-warning-700">This tool set could not be found. It may have stopped being shared.</p>
        )
      ) : null}
      {cardsLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <EntityPicker
          label={value ? "Pick another" : "Find a tool set"}
          value={null}
          placeholder="Search the catalogue's tool sets"
          options={options}
          onChange={(id) => {
            if (!id) return;
            const [handle = "", slug = ""] = id.split("/");
            onPick({ kind: "shared", handle, slug });
          }}
          inline
        />
      )}
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          applyPasted();
        }}
      >
        <label htmlFor="connect-paste-link" className="text-label-xs text-02">
          Or paste its link
        </label>
        <div className="flex gap-2">
          <input
            id="connect-paste-link"
            className="min-h-10 min-w-0 flex-1 rounded-md border border-02 bg-01 px-3 font-mono text-mono-12 text-01"
            placeholder="https://…/@name/set or /u/…"
            value={pasted}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setPasted(e.target.value);
              setPasteError(null);
            }}
          />
          <Button type="submit" size="sm" variant="secondary" className="min-h-10" disabled={!pasted.trim()}>
            Use
          </Button>
        </div>
        {pasteError ? (
          <p role="alert" className="text-body-xs text-danger-700">
            {pasteError}
          </p>
        ) : null}
      </form>
    </div>
  );
}

/**
 * A pasted tool-set link, as a full MCP URL or just its path (`/@name/set@3`,
 * `@name/set`, `/u/…`), or the web page a browser opened for it.
 */
export function readSharedLink(input: string, host: string = mcpHost()): { pick: SharedPick; version: number | null } | null {
  const raw = input.trim();
  if (!raw) return null;
  // The web page form: /toolsets/view?handle=&slug=[&v=] or #token=
  const page = /\/toolsets\/view\b(\?[^#]*)?(#.*)?$/.exec(raw);
  if (page) {
    const q = new URLSearchParams(page[1] ?? "");
    const f = new URLSearchParams((page[2] ?? "").replace(/^#/, ""));
    const v = Number(f.get("v") ?? q.get("v")) || null;
    if (f.get("token")) return readSharedLink(`/u/${f.get("token")}${v ? `@${v}` : ""}`, host);
    if (q.get("handle") && q.get("slug")) return readSharedLink(`/@${q.get("handle")}/${q.get("slug")}${v ? `@${v}` : ""}`, host);
    return null;
  }
  const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i, "") : raw.startsWith("@") ? `/${raw}` : raw;
  const parsed = parseMcpUrl(`${host}${path.startsWith("/") ? path : `/${path}`}`, host);
  const choice = parsed?.choice;
  if (choice?.kind === "shared") return { pick: { kind: "shared", handle: choice.handle, slug: choice.slug }, version: choice.version ?? null };
  if (choice?.kind === "link") return { pick: { kind: "link", token: choice.token }, version: choice.version ?? null };
  return null;
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
  onSaved,
  suggest,
}: {
  tools: string[];
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
