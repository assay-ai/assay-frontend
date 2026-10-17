"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleCheck, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { useSpendPolicyQuery } from "@/components/buyer-money/use-agents";
import { useCatalogue } from "@/components/g31/use-catalogue";
import { SkeletonRows } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { parseMcpUrl, toolDisplay } from "@/features/connect/mcp-url";
import {
  updateAvailableFor,
  accessSummary,
  draftBody,
  draftChanges,
  draftFrom,
  priceText,
  restoreBody,
  toolResultLine,
  toolResultTone,
  type AccessDraft,
} from "@/features/toolsets/access-result";
import { ACCESS_LABEL, PROVIDER_LIMITS_LABEL, VERIFIED_ONLY_LABEL } from "@/features/toolsets/labels";
import { restrictToConnected, type AgentAccess, type AgentToolEffect, type AllowedToolset, type ServerInUse } from "@/services/toolsets.service";
import { cn } from "@/utils";
import { parseAmountInput, toDecimal } from "@/utils/money";
import { toast } from "@/utils/toast";

import { AlwaysLoaded } from "./always-loaded";
import { Chip } from "./toolset-bits";
import { UpdateSheet, type UpdateTarget } from "./update-sheet";
import { errorText, toolsetKeys, useAgentAccess, useAgentServers, useToolsets, useUpdateAccess } from "./use-toolsets";

/**
 * Agent › What this agent can use (design spec §7.10), next to Spending
 * limits. One form with one Save and one Cancel: nothing changes until it is
 * saved, and Save says what changed with an Undo.
 *
 *   - Everything, or Only these tool sets and tools — ticked from a list with
 *     Select all / Clear all / What it's connected to, each tool showing its
 *     combined result ("2 of 4 providers left");
 *   - Provider limits: providers to never use (one tick each), a max price,
 *     "Only verified providers";
 *   - the shortcut "Only what's connected", disabled with the reason when one
 *     of its servers is Everything.
 *
 * Per-key narrowing exists in the API only and is not shown here.
 */
export function AgentAccessCard({ agentId, agentName, highlight = false }: { agentId: string; agentName: string; highlight?: boolean }) {
  const query = useAgentAccess(agentId);
  const ref = React.useRef<HTMLElement | null>(null);
  // The deep link `/agents?agent={id}#access`: scroll once the section has its
  // content, and again after the page around it has settled.
  React.useEffect(() => {
    if (!highlight || !query.data || !ref.current) return;
    const el = ref.current;
    el.scrollIntoView({ block: "start" });
    const later = window.setTimeout(() => el.scrollIntoView({ block: "start" }), 400);
    return () => window.clearTimeout(later);
  }, [highlight, query.data]);

  return (
    <section
      ref={ref}
      id={highlight ? "access" : undefined}
      aria-label={ACCESS_LABEL}
      data-testid="agent-access"
      data-highlight={highlight || undefined}
      className={cn("flex min-w-0 scroll-mt-24 flex-col gap-3", highlight && "rounded-md outline outline-2 outline-offset-4 outline-primary-500")}
    >
      {query.isPending ? (
        <SkeletonRows rows={3} />
      ) : query.isError || !query.data ? (
        <p className="flex flex-wrap items-center gap-2 text-body-13 text-02">
          What {agentName} can use could not be loaded ({errorText(query.error)}). Its limits still apply.
          <button type="button" className="min-h-10 font-semibold text-primary-600 hover:underline tablet:min-h-0" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <AccessEditor key={`${query.data.agentId}:${query.data.policyVersion}`} access={query.data} agentName={agentName} />
      )}
    </section>
  );
}

/** Whether one of the agent's servers is Everything (`/` with no filter). */
export function connectedToEverything(servers: readonly ServerInUse[] | undefined): boolean {
  return (servers ?? []).some((s) => parseMcpUrl(s.canonicalUrl, s.canonicalUrl.replace(/^([a-z]+:\/\/[^/?#]+).*$/i, "$1"))?.choice.kind === "everything");
}

/** The tool sets and tools the agent's servers serve: the draft "What it's connected to" starts from. */
export function connectedSelection(servers: readonly ServerInUse[] | undefined, tools: readonly AgentToolEffect[]) {
  const toolsets: { toolsetId: string; viaUrlOnly: boolean }[] = [];
  const toolIds = new Set<string>();
  for (const server of servers ?? []) {
    if (server.toolsetId && !toolsets.some((t) => t.toolsetId === server.toolsetId)) toolsets.push({ toolsetId: server.toolsetId, viaUrlOnly: true });
    const origin = server.canonicalUrl.replace(/^([a-z]+:\/\/[^/?#]+).*$/i, "$1");
    const parsed = parseMcpUrl(server.canonicalUrl, origin);
    if (parsed?.choice.kind === "tools") {
      for (const name of parsed.choice.tools) {
        const tool = tools.find((t) => t.name === name || t.toolId === name);
        if (tool) toolIds.add(tool.toolId);
      }
    }
  }
  return { toolsets, toolIds: [...toolIds] };
}

export function AccessEditor({ access, agentName }: { access: AgentAccess; agentName: string }) {
  const queryClient = useQueryClient();
  const update = useUpdateAccess(access.agentId);
  const toolsets = useToolsets();
  const catalogue = useCatalogue();
  const policy = useSpendPolicyQuery();
  const servers = useAgentServers(access.agentId);
  const [draft, setDraft] = React.useState<AccessDraft>(() => draftFrom(access));
  const decimals = access.rules.maxPrice?.decimals ?? policy.data?.decimals ?? 6;
  const savedMax = access.rules.maxPrice ? toDecimal(access.rules.maxPrice).toString() : "";
  const [maxText, setMaxText] = React.useState(savedMax);
  const parsedMax = parseAmountInput(maxText, { decimals, required: false });
  const effective: AccessDraft = { ...draft, maxPrice: parsedMax.error ? draft.maxPrice : parsedMax.atomic };
  const body = draftBody(access, effective);
  const changes = draftChanges(access, effective);
  const everything = connectedToEverything(servers.data?.servers);

  const save = () => {
    if (!body || parsedMax.error) return;
    const undo = restoreBody(access);
    update.mutate(body, {
      onSuccess: () =>
        toast.success(`Saved: ${changes.join(", ")}`, {
          description: `${agentName}'s next call uses it.`,
          duration: 8000,
          action: { label: "Undo", onClick: () => update.mutate(undo, { onSuccess: () => toast.success("Undone") }) },
        }),
    });
  };
  const cancel = () => {
    setDraft(draftFrom(access));
    setMaxText(savedMax);
  };

  const onlyConnected = useMutation({
    mutationFn: () => restrictToConnected(access.agentId),
    onSuccess: (next) => {
      const undo = restoreBody(access);
      queryClient.setQueryData(toolsetKeys.access(access.agentId), next);
      void queryClient.invalidateQueries({ queryKey: ["mcp-preview", access.agentId] });
      toast.success(`${agentName} can now use only what its servers serve.`, {
        duration: 8000,
        action: { label: "Undo", onClick: () => update.mutate(undo, { onSuccess: () => toast.success("Undone") }) },
      });
    },
    onError: (error) => toast.error(errorText(error, "The change could not be saved")),
  });

  const patch = (change: Partial<AccessDraft>) => setDraft((d) => ({ ...d, ...change }));
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  const routable = access.tools.filter((t) => t.providersTotal > 0);
  const mySets = toolsets.data?.items ?? [];
  const deletedSets = access.allowedToolsets.filter((t) => t.deleted && t.own !== false);
  // Other organizations' tool sets: each locked to a version, with "Update available" when a newer one is out.
  const sharedSets = access.allowedToolsets.filter((t) => t.own === false);
  const [updating, setUpdating] = React.useState<UpdateTarget | null>(null);
  const restricted = draft.mode === "RESTRICTED";
  const excludeChanged = Boolean(body?.rules?.excludeProviderIds);
  const providers = catalogue.providers;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-body-13 text-02" data-testid="access-summary">
        {accessSummary(access)}
      </p>

      <div className="flex flex-col gap-2">
        <Segmented
          value={draft.mode}
          onValueChange={(v) =>
            patch(
              v === "RESTRICTED" && access.accessMode === "ALL"
                ? // From Everything, Only these starts empty: tick what it may use.
                  { mode: "RESTRICTED", toolIds: [], toolsets: [] }
                : { mode: v as AccessDraft["mode"] },
            )
          }
          aria-label={`What ${agentName} can use`}
          className="self-start"
        >
          <SegmentedItem value="ALL">Everything</SegmentedItem>
          <SegmentedItem value="RESTRICTED">Only these tool sets and tools</SegmentedItem>
        </Segmented>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="min-h-10 tablet:min-h-0"
            loading={onlyConnected.isPending}
            disabled={everything || Boolean(body)}
            onClick={() => onlyConnected.mutate()}
          >
            Shortcut: only what&apos;s connected
          </Button>
          {everything ? (
            <p className="flex items-start gap-1.5 text-body-xs text-02" data-testid="connected-everything-note">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              One of {agentName}&apos;s servers is Everything, so &ldquo;only what&apos;s connected&rdquo; would still mean every tool. Change that server under
              Servers in use first.
            </p>
          ) : body ? (
            <p className="text-body-xs text-03">Save or cancel your changes first.</p>
          ) : null}
        </div>
      </div>

      {restricted ? (
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-01 bg-02 p-3" data-testid="access-choices">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="pb-1 text-label-13 text-01">Tool sets</legend>
            {mySets.length === 0 && deletedSets.length === 0 && sharedSets.length === 0 ? (
              <p className="text-body-xs text-03">
                No tool sets yet.{" "}
                <Link href="/toolsets/mine" className="text-primary-600 hover:underline">
                  Create one
                </Link>
              </p>
            ) : null}
            {mySets.map((set) => {
              const chosen = draft.toolsets.find((t) => t.toolsetId === set.id);
              return (
                <div key={set.id} className="flex flex-col gap-1 rounded-md bg-01 px-2.5 py-1.5 tablet:flex-row tablet:items-center tablet:gap-3">
                  <Checkbox
                    className="min-h-10 min-w-0 flex-1 tablet:min-h-0"
                    checked={Boolean(chosen)}
                    onChange={(e) =>
                      patch({ toolsets: e.target.checked ? [...draft.toolsets, { toolsetId: set.id, viaUrlOnly: true }] : draft.toolsets.filter((t) => t.toolsetId !== set.id) })
                    }
                    label={
                      <span className="[overflow-wrap:anywhere]">
                        {set.name} <span className="text-body-xs text-03">· {set.toolCount} tools</span>
                      </span>
                    }
                  />
                  {chosen ? (
                    <Switch
                      className="min-h-10 pl-7 tablet:min-h-0 tablet:pl-0"
                      checked={chosen.viaUrlOnly}
                      onChange={(e) => patch({ toolsets: draft.toolsets.map((t) => (t.toolsetId === set.id ? { ...t, viaUrlOnly: e.target.checked } : t)) })}
                      label="Only through its own URL"
                    />
                  ) : null}
                </div>
              );
            })}
            {deletedSets.map((set) => (
              <p key={set.toolsetId} className="text-body-xs text-warning-700">
                A tool set it was allowed was deleted by its owner; its tools are no longer allowed through it.
              </p>
            ))}
            {sharedSets.map((set) => (
              <SharedSetRow
                key={set.toolsetId}
                set={set}
                checked={draft.toolsets.some((t) => t.toolsetId === set.toolsetId)}
                onToggle={(on) =>
                  patch({
                    toolsets: on
                      ? [...draft.toolsets, { toolsetId: set.toolsetId, viaUrlOnly: set.viaUrlOnly, version: set.version }]
                      : draft.toolsets.filter((t) => t.toolsetId !== set.toolsetId),
                  })
                }
                onUpdate={() => {
                  const to = updateAvailableFor(set);
                  if (!to || !set.version) return;
                  setUpdating({
                    choice: set.handle && set.slug ? { kind: "shared", handle: set.handle, slug: set.slug, version: set.version } : { kind: "toolset", slug: set.slug ?? "", version: set.version },
                    name: set.name ?? "This tool set",
                    from: set.version,
                    to,
                    access: { access, toolsetId: set.toolsetId },
                  });
                }}
              />
            ))}
            {draft.toolsets.some((t) => t.viaUrlOnly) ? (
              <p className="text-body-xs text-03">
                &ldquo;Only through its own URL&rdquo; keeps the tool set&apos;s provider rules on every call: its tools work only through that tool set&apos;s server.
              </p>
            ) : null}
          </fieldset>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="pb-1 text-label-13 text-01">Tools</legend>
            <div className="flex flex-wrap gap-x-3 text-label-13">
              <button type="button" className="min-h-10 text-primary-600 hover:underline tablet:min-h-0" onClick={() => patch({ toolIds: routable.map((t) => t.toolId) })}>
                Select all
              </button>
              <button type="button" className="min-h-10 text-primary-600 hover:underline tablet:min-h-0" onClick={() => patch({ toolIds: [], toolsets: [] })}>
                Clear all
              </button>
              {servers.data && servers.data.servers.length > 0 ? (
                <button
                  type="button"
                  className="min-h-10 text-primary-600 hover:underline tablet:min-h-0"
                  onClick={() => patch(connectedSelection(servers.data?.servers, access.tools))}
                >
                  What it&apos;s connected to
                </button>
              ) : null}
            </div>
            <ul className="flex flex-col divide-y divide-01 rounded-md bg-01" data-testid="access-tool-list">
              {access.tools.map((tool) => {
                const none = tool.providersTotal === 0;
                return (
                  <li key={tool.toolId} className="flex min-w-0 flex-col gap-0.5 px-2.5 py-1.5 tablet:flex-row tablet:items-center tablet:gap-3">
                    <Checkbox
                      className="min-h-10 min-w-[8rem] tablet:min-h-0 tablet:w-[220px] tablet:shrink-0"
                      disabled={none}
                      checked={draft.toolIds.includes(tool.toolId)}
                      onChange={(e) => patch({ toolIds: toggle(draft.toolIds, tool.toolId, e.target.checked) })}
                      label={
                        <span className="flex flex-col">
                          <span className="font-mono text-mono-12 [overflow-wrap:anywhere]">{toolDisplay(tool).name}</span>
                          {toolDisplay(tool).title ? <span className="text-body-xs text-03">{toolDisplay(tool).title}</span> : null}
                        </span>
                      }
                    />
                    <ResultText tool={tool} access={access} />
                  </li>
                );
              })}
            </ul>
          </fieldset>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-01 p-3" data-testid="provider-limits">
        <div className="flex flex-col gap-0.5">
          <span className="text-label-13 text-01">{PROVIDER_LIMITS_LABEL}</span>
          <span className="text-body-xs text-03">Apply to every call this agent makes, through any server.</span>
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="pb-1 text-label-xs text-02">Never use these providers</legend>
          <div className="grid grid-cols-1 gap-x-4 tablet:grid-cols-2">
            {providers.map((p) => (
              <Checkbox
                key={p.providerId}
                className="min-h-10 tablet:min-h-8"
                checked={draft.exclude.includes(p.providerId)}
                onChange={(e) => patch({ exclude: toggle(draft.exclude, p.providerId, e.target.checked) })}
                label={
                  <span className="[overflow-wrap:anywhere]">
                    {p.name}
                    {p.tier === "NEW" ? <span className="text-body-xs text-03"> · not verified yet</span> : null}
                  </span>
                }
              />
            ))}
          </div>
          {excludeChanged ? (
            <p className="text-body-xs text-primary-700" aria-live="polite" data-testid="exclude-pending">
              {draft.exclude.length === 0
                ? "No provider excluded"
                : `${draft.exclude.length} provider${draft.exclude.length === 1 ? "" : "s"} excluded`}{" "}
              — not saved yet: Save changes below.
            </p>
          ) : null}
        </fieldset>
        <Field
          id={`max-price-${access.agentId}`}
          label="Max price per call"
          inputMode="decimal"
          suffix="USD"
          placeholder="No limit"
          value={maxText}
          onChange={(e) => setMaxText(e.target.value)}
          error={parsedMax.error ?? undefined}
          hint={access.rules.maxPrice ? `Saved: ${priceText(access.rules.maxPrice)} a call. Empty it to remove the limit.` : "Providers that charge more are not used."}
          wrapperClassName="tablet:w-[280px]"
        />
        <Switch
          className="min-h-10 tablet:min-h-0"
          checked={draft.verified}
          onChange={(e) => patch({ verified: e.target.checked })}
          label={access.rules.minTier === "TRUSTED" && draft.verified ? "Only trusted providers (set through the API)" : VERIFIED_ONLY_LABEL}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-01 p-3">
        <AlwaysLoaded access={access} agentName={agentName} />
      </div>

      <UpdateSheet target={updating} onOpenChange={(open) => !open && setUpdating(null)} />

      {!restricted ? (
        <details className="rounded-lg border border-01 px-3 py-2.5">
          <summary className="min-h-10 cursor-pointer select-none content-center text-label-13 text-01 tablet:min-h-0">Result per tool</summary>
          <ul className="mt-2 flex flex-col gap-1" data-testid="access-results">
            {access.tools.length === 0 ? <li className="text-body-xs text-03">No tools listed yet.</li> : null}
            {access.tools.map((tool) => (
              <li key={tool.toolId} className="flex items-start gap-2">
                <ResultText tool={tool} access={access} withName />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {body || parsedMax.error ? (
        <div
          className="sticky bottom-[72px] z-10 flex flex-wrap items-center gap-2 rounded-lg border border-primary-20 bg-01 px-3 py-2.5 shadow-soft md:bottom-3"
          data-testid="access-save-bar"
          role="region"
          aria-label="Unsaved changes"
        >
          <span className="min-w-0 flex-1 text-body-13 text-01">
            {parsedMax.error ? "Fix the max price to save." : `Not saved yet: ${changes.join(", ")}.`}
            {body ? <span className="block text-body-xs text-03">The results above update after you save.</span> : null}
          </span>
          <Button size="sm" loading={update.isPending} disabled={!body || Boolean(parsedMax.error)} onClick={save}>
            Save changes
          </Button>
          <Button size="sm" variant="secondary" onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const STATUS_NOTICE: Record<string, string> = {
  DELETED: "Tool set deleted by its owner. This agent keeps the tools of the version it is locked to.",
  NOT_SHARED: "Its owner stopped sharing it. If it is allowed only through its own URL, its tools stop when that URL stops.",
  REMOVED: "This tool set was removed by Assay. It allows nothing now.",
};

/** Another organization's tool set this agent may use: its lock, its update, its state. */
function SharedSetRow({ set, checked, onToggle, onUpdate }: { set: AllowedToolset; checked: boolean; onToggle: (on: boolean) => void; onUpdate: () => void }) {
  const next = updateAvailableFor(set);
  const notice = set.status ? STATUS_NOTICE[set.status] : undefined;
  return (
    <div className="flex flex-col gap-1 rounded-md bg-01 px-2.5 py-1.5" data-testid="shared-set-row">
      <div className="flex flex-col gap-1 tablet:flex-row tablet:items-center tablet:gap-3">
        <Checkbox
          className="min-h-10 min-w-0 flex-1 tablet:min-h-0"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          label={
            <span className="[overflow-wrap:anywhere]">
              {set.name ?? "A shared tool set"}{" "}
              <span className="text-body-xs text-03">
                · {set.handle && set.slug ? `@${set.handle}/${set.slug} · ` : ""}
                {set.version ? `locked to v${set.version}` : "always latest"}
              </span>
            </span>
          }
        />
        {next ? (
          <button type="button" className="min-h-10 self-start pl-7 tablet:min-h-0 tablet:pl-0" onClick={onUpdate} data-testid="access-update">
            <Chip tone="primary">Update available: v{next}</Chip>
          </button>
        ) : null}
      </div>
      {notice ? <p className="pl-7 text-body-xs text-warning-700">{notice}</p> : null}
    </div>
  );
}

function ResultText({ tool, access, withName = false }: { tool: AgentToolEffect; access: AgentAccess; withName?: boolean }) {
  const tone = toolResultTone(tool);
  const shown = { ...tool, name: toolDisplay(tool).name };
  const line = toolResultLine(shown, access.rules);
  const text = withName ? line : line.slice(shown.name.length + 2);
  return (
    <span className={cn("flex min-w-0 items-start gap-1.5 text-body-13", tone === "blocked" ? "text-03" : tone === "warn" ? "text-warning-700" : "text-02")}>
      {tone === "blocked" ? (
        <Ban aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      ) : tone === "warn" ? (
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <CircleCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success-500" />
      )}
      <span className="min-w-0 [overflow-wrap:anywhere]">{tool.providersTotal === 0 ? `${withName ? `${shown.name}: ` : ""}no provider yet` : text}</span>
    </span>
  );
}
