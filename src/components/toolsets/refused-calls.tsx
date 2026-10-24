"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ShieldX } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ApiErrorSentence } from "@/components/patterns/api-error-sentence";
import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { includeProviderBody, maxPriceBody, verifiedOnlyBody } from "@/features/toolsets/access-result";
import { contractChipParts } from "@/features/contracts/entry-contract";
import { defaultEntry, entryChipLabel, entryInput } from "@/features/toolsets/entry-rules";
import { refusalText } from "@/features/toolsets/labels";
import { entryAfterFix, entryAlreadyFixed, isEntryFix, refusedCallView, viaText, type EntryFix, type RefusalFix } from "@/features/toolsets/refused";
import { useEntityNames } from "@/hooks/useEntityNames";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { getRefusedCall, getToolset, listRefusedCalls, replaceToolsetEntries, type RefusedCall, type ToolsetEntry, type ToolsetEntryInput, type UpdateAgentAccessBody } from "@/services/toolsets.service";
import { toast } from "@/utils/toast";

import { toolsetKeys, useAgentAccess, useToolsets, useUpdateAccess } from "./use-toolsets";

/**
 * Calls › Refused (design spec §7.10, sketch B). A refused call was never
 * charged; each one names the layer that refused it (the server it called,
 * the agent's limits, or the tool set's rules), every provider with its
 * reason, and the one-click fix. `/spend/calls?call={id}` — the link an agent's
 * error carries — opens one.
 */

export function refusedCallHref(callId: string): string {
  return routes.calls({ status: "refused", call: callId });
}

const PAGE = 50;

export function RefusedCallsList({ agentId, openCallId }: { agentId?: string | null; openCallId?: string | null }) {
  const names = useEntityNames({ kinds: ["agent"] });
  const toolsets = useToolsets();
  const query = useInfiniteQuery({
    queryKey: toolsetKeys.refused(agentId),
    queryFn: ({ pageParam }) => listRefusedCalls({ limit: PAGE, cursor: pageParam ?? undefined, agentId: agentId ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.pageInfo?.hasMore ? (last.pageInfo.nextCursor ?? null) : null),
    retry: 0,
  });
  // The open call is shown above, in full; it is not repeated in the list.
  const all = (query.data?.pages ?? []).flatMap((page) => page.items ?? []);
  const calls = all.filter((c) => c.callId !== openCallId);
  const setName = (id: string | null) => (id ? toolsets.data?.items.find((t) => t.id === id)?.name ?? null : null);

  if (query.isPending) return <PageState kind="loading" rows={4} label="Loading refused calls" />;
  if (query.isError) {
    return (
      <PageState
        kind="error"
        title="Refused calls could not be loaded"
        description={query.error instanceof ApiError ? <ApiErrorSentence error={query.error} /> : plainError("ERR_NETWORK")}
        code={query.error instanceof ApiError ? query.error.code : null}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (calls.length === 0) {
    if (all.length > 0) return null;
    return (
      <PageState
        kind="empty"
        icon={<ShieldX />}
        title="No refused calls"
        description="When a call is refused before anything is charged (a tool this agent may not use, or no provider fitting its limits), it shows here with the fix."
      />
    );
  }
  return (
    <>
      <ul className="flex w-full flex-col overflow-hidden rounded-xl border border-01 bg-01 shadow-soft" data-testid="refused-calls">
        {calls.map((call) => (
          <li key={call.callId} className="border-b border-01 last:border-b-0">
            <Link
              href={refusedCallHref(call.callId)}
              scroll={false}
              className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-mono text-mono-13 font-semibold text-01">{call.toolName ?? "A tool"}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-xs text-03">
                  <RefusedChip />
                  <UtcTime value={call.createdAt} relative />
                  <span aria-hidden="true">·</span>
                  <span>{names.name("agent", call.agentId)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{viaText(call, setName(call.toolsetId))}</span>
                </span>
                <span className="text-body-13 text-02">{refusedCallView(call).reason}</span>
              </div>
              <span className="shrink-0 font-mono text-mono-13 text-03">$0.00</span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03" />
            </Link>
          </li>
        ))}
      </ul>
      {query.hasNextPage ? (
        <Button variant="secondary" className="self-center" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          Show more refused calls
        </Button>
      ) : null}
    </>
  );
}

function RefusedChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-danger-10 px-2 py-0.5 text-label-xs text-danger-700">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-danger-500" />
      Refused · not charged
    </span>
  );
}

/** One refused call, loaded by id — the page `/spend/calls?call={id}` opens. */
export function RefusedCallPanel({ callId, onClose }: { callId: string; onClose?: () => void }) {
  const query = useQuery({ queryKey: ["refused-call", callId], retry: false, queryFn: () => getRefusedCall(callId) });
  if (query.isPending) return <PageState kind="loading" rows={3} label="Loading the refused call" />;
  if (query.isError || !query.data) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <PageState
        kind="error"
        title={notFound ? "This refused call was not found" : "The refused call could not be loaded"}
        description={notFound ? "It may belong to another account, or the link is incomplete." : query.error instanceof ApiError ? <ApiErrorSentence error={query.error} /> : plainError("ERR_NETWORK")}
        onRetry={notFound ? undefined : () => void query.refetch()}
      />
    );
  }
  return <RefusedCallCard call={query.data} onClose={onClose} />;
}

/** What a T3 fix did, said after it saved. */
function entryFixDone(fix: EntryFix, toolName: string, setName: string, entry?: ToolsetEntry): { title: string; description: string } {
  switch (fix.kind) {
    case "drop-required-field":
      return { title: `${setName} no longer requires ${fix.fields.join(", ")}`, description: remainingRules(toolName, entry) };
    case "allow-major":
      return { title: `${setName} now also uses ${fix.label.replace(/^Allow /, "")} of ${toolName}`, description: "The next call can go to providers that serve it." };
    case "move-major":
      return { title: `${setName} now uses ${fix.label.replace(/^Use /, "")} of ${toolName}`, description: "Check that your agent reads the new version's fields." };
  }
}

/**
 * Who can serve the next call after a rule was removed: the rules the entry
 * still has, and the agent's own limits, which a tool set fix never changes.
 */
export function remainingRules(toolName: string, entry: ToolsetEntry | undefined): string {
  if (!entry) return `Providers of ${toolName} that pass this agent's limits can serve the next call.`;
  const rules: string[] = [];
  if (entry.providerMode !== "BEST" || entry.minTier || entry.maxPrice) rules.push(entryChipLabel(entry).replace(/^Providers: /, ""));
  rules.push(...contractChipParts(entry, null));
  return rules.length > 0
    ? `Providers of ${toolName} that pass its other rules (${rules.join(" · ")}) and this agent's limits can serve the next call.`
    : `Providers of ${toolName} that pass this agent's limits can serve the next call.`;
}

/** The tool is no longer in the tool set; `message` is the set's name. */
export class EntryGone extends Error {}

/**
 * One T3 fix on a tool set entry: read the set, rewrite that entry, save the
 * whole list. Returns the list before (for Undo), or `before: null` when the
 * entry already reads that way (nothing was sent).
 */
export async function runEntryFix(
  fix: EntryFix,
  io: { get: typeof getToolset; replace: typeof replaceToolsetEntries } = { get: getToolset, replace: replaceToolsetEntries },
) {
  const set = await io.get(fix.toolsetId);
  const entry = set.entries.find((e) => e.toolId === fix.toolId);
  if (!entry) throw new EntryGone(set.name);
  if (entryAlreadyFixed(entry, fix)) return { set, before: null };
  const before = set.entries.map(entryInput);
  const next = await io.replace(
    set.id,
    set.entries.map((e) => (e.toolId === fix.toolId ? entryAfterFix(e, fix) : entryInput(e))),
  );
  return { set: next, before };
}

export function RefusedCallCard({ call, onClose }: { call: RefusedCall; onClose?: () => void }) {
  const view = refusedCallView(call);
  const names = useEntityNames({ kinds: ["agent"] });
  const toolsets = useToolsets();
  const queryClient = useQueryClient();
  const addToSet = useMutation({
    mutationFn: async (fix: { toolsetId: string; toolId: string }) => {
      const set = await getToolset(fix.toolsetId);
      if (set.entries.some((e) => e.toolId === fix.toolId)) return { set, before: null };
      const before = set.entries.map(entryInput);
      const next = await replaceToolsetEntries(set.id, [...before, defaultEntry(fix.toolId)]);
      return { set: next, before };
    },
    onSuccess: ({ set, before }) => {
      queryClient.setQueryData(toolsetKeys.one(set.id), set);
      void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
      setDone((d) => new Set(d).add("call"));
      toast.success(`${call.toolName ?? "The tool"} added to ${set.name}`, {
        description: "Agents connected to it can call it now.",
        duration: 8000,
        ...(before
          ? {
              action: {
                label: "Undo",
                onClick: () =>
                  void replaceToolsetEntries(set.id, before).then((back) => {
                    queryClient.setQueryData(toolsetKeys.one(set.id), back);
                    void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
                    // The fix applies again: its button comes back.
                    setDone((d) => {
                      const next = new Set(d);
                      next.delete("call");
                      return next;
                    });
                    toast.success("Undone");
                  }),
              },
            }
          : {}),
      });
    },
    onError: () => toast.error("The tool could not be added. Try again."),
  });
  const editEntry = useMutation({
    mutationFn: ({ fix }: { key: string; fix: EntryFix }) => runEntryFix(fix),
    onSuccess: ({ set, before }, { key, fix }) => {
      queryClient.setQueryData(toolsetKeys.one(set.id), set);
      void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
      setDone((d) => new Set(d).add(key));
      if (!before) {
        toast.success("Already changed", { description: `${set.name} already reads that way. The next call uses it.` });
        return;
      }
      const said = entryFixDone(fix, call.toolName ?? "the tool", set.name, set.entries.find((e) => e.toolId === fix.toolId));
      setUndos((u) => ({ ...u, [key]: { setId: set.id, before } }));
      toast.success(said.title, { description: said.description, duration: 8000, action: { label: "Undo", onClick: () => undo(key) } });
    },
    onError: (error) => {
      if (error instanceof EntryGone) {
        toast.error(`${call.toolName ?? "The tool"} is no longer in ${error.message}`, { description: "Nothing was changed." });
      } else if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        toast.error("This tool set can't be changed from here", { description: "It may have been deleted, or it belongs to another team." });
      } else {
        toast.error("The change could not be saved. Try again.");
      }
    },
  });
  const access = useAgentAccess(call.agentId);
  const update = useUpdateAccess(call.agentId);
  const setName = call.toolsetId ? toolsets.data?.items.find((t) => t.id === call.toolsetId)?.name ?? null : null;
  const [done, setDone] = React.useState<Set<string>>(new Set());
  // What each tool set fix replaced, so "Undo" stays next to "Done", not only in the toast.
  const [undos, setUndos] = React.useState<Record<string, { setId: string; before: ToolsetEntryInput[] }>>({});
  const undo = (key: string) => {
    const saved = undos[key];
    if (!saved) return;
    void replaceToolsetEntries(saved.setId, saved.before).then(
      (back) => {
        queryClient.setQueryData(toolsetKeys.one(saved.setId), back);
        void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
        setDone((d) => {
          const next = new Set(d);
          next.delete(key);
          return next;
        });
        setUndos((u) => {
          const { [key]: _gone, ...rest } = u;
          return rest;
        });
        toast.success("Undone");
      },
      () => toast.error("The change could not be undone. Open the tool set to change it back."),
    );
  };

  const apply = (key: string, fix: RefusalFix, providerName?: string) => {
    if (!access.data) return;
    let body: UpdateAgentAccessBody | null = null;
    if (fix.kind === "include-provider") body = includeProviderBody(access.data.rules, fix.providerId, providerName ?? "the provider");
    if (fix.kind === "clear-max-price") body = maxPriceBody(null);
    if (fix.kind === "allow-any-tier") body = verifiedOnlyBody(false);
    if (fix.kind === "allow-tool") {
      body =
        access.data.accessMode === "ALL"
          ? null
          : { allowedToolIds: [...new Set([...access.data.allowedToolIds, fix.toolId])], changeReason: `Allowed ${call.toolName ?? "a tool"} from a refused call` };
    }
    if (!body) {
      setDone((d) => new Set(d).add(key));
      return;
    }
    update.mutate(body, {
      onSuccess: () => {
        setDone((d) => new Set(d).add(key));
        toast.success("Fixed. The agent's next call uses the new limits.");
      },
    });
  };

  const fixButton = (key: string, fix: RefusalFix | null, providerName?: string) => {
    if (!fix) return null;
    if (fix.kind === "link") {
      return (
        <Button size="sm" variant="secondary" asChild>
          <Link href={fix.href}>{fix.label}</Link>
        </Button>
      );
    }
    if (fix.kind === "add-to-toolset") {
      if (done.has(key)) return <span className="text-label-13 text-success-700">Added</span>;
      return (
        <Button size="sm" variant="secondary" loading={addToSet.isPending} onClick={() => addToSet.mutate({ toolsetId: fix.toolsetId, toolId: fix.toolId })}>
          {fix.label}
        </Button>
      );
    }
    if (isEntryFix(fix)) {
      if (done.has(key)) {
        return (
          <span className="inline-flex items-center gap-2">
            <span className="text-label-13 text-success-700">Done</span>
            {undos[key] ? (
              <Button size="sm" variant="ghost" onClick={() => undo(key)}>
                Undo
              </Button>
            ) : null}
          </span>
        );
      }
      return (
        <Button
          size="sm"
          variant="secondary"
          loading={editEntry.isPending && editEntry.variables?.key === key}
          disabled={editEntry.isPending}
          onClick={() => editEntry.mutate({ key, fix })}
        >
          {fix.label}
        </Button>
      );
    }
    if (fix.kind === "edit-toolset") {
      return (
        <Button size="sm" variant="secondary" asChild>
          <Link href={`/toolsets/mine?id=${encodeURIComponent(fix.toolsetId)}`}>{fix.label}</Link>
        </Button>
      );
    }
    if (done.has(key)) return <span className="text-label-13 text-success-700">Done</span>;
    return (
      <Button size="sm" variant="secondary" loading={update.isPending} disabled={!access.data} onClick={() => apply(key, fix, providerName)}>
        {fix.label}
      </Button>
    );
  };

  return (
    <section
      aria-label="Refused call"
      data-testid="refused-call"
      className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-danger-20 bg-01 p-4 shadow-soft tablet:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-label-md text-01">{view.title}</h2>
          <p className="text-body-xs text-03">
            <span className="font-mono text-01">{call.toolName ?? "A tool"}</span> {viaText(call, setName)} · <UtcTime value={call.createdAt} /> ·{" "}
            {names.name("agent", call.agentId)}
          </p>
        </div>
        {onClose ? (
          <button type="button" className="text-label-13 text-02 hover:underline" onClick={onClose}>
            Back to refused calls
          </button>
        ) : null}
      </header>
      <p className="text-body-md text-01" data-testid="refused-reason">
        {view.reason}
      </p>
      <p className="text-body-13 text-02" data-testid="refused-layer">
        {view.layer}. Nothing was charged.
      </p>
      {view.providers.length > 0 ? (
        <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01" data-testid="refused-providers">
          {view.providers.map((p) => {
            const providerName = p.name ?? p.providerId;
            return (
              <li key={p.providerId} className="flex flex-col gap-2 px-3 py-2.5 tablet:flex-row tablet:items-center">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-label-13 text-01">{providerName}</span>
                  <span className="text-body-13 text-02">{p.reason}</span>
                  <span className="text-body-xs text-03">{p.source}</span>
                </div>
                <div className="flex shrink-0 flex-col items-start gap-0.5 tablet:items-end">
                  {fixButton(`p:${p.providerId}`, p.fix, providerName)}
                  {p.fix && p.fixCovers > 1 ? <span className="text-body-xs text-03">for these {p.fixCovers} providers</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {view.singleProviderNote ? <p className="text-body-13 text-02">{view.singleProviderNote}</p> : null}
      {view.note ? (
        <p className="text-body-13 text-02" data-testid="refused-note">
          {view.note}
        </p>
      ) : null}
      {view.fix ? <div className="flex flex-wrap gap-2">{fixButton("call", view.fix)}</div> : null}
    </section>
  );
}
