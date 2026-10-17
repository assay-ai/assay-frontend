"use client";

import { Pin, Plus, X } from "lucide-react";
import * as React from "react";

import { useCatalogue } from "@/components/g31/use-catalogue";
import { mcpToolName } from "@/features/connect/mcp-url";
import { MAX_ALWAYS_LOADED, pinnedToolsBody, suggestAlwaysLoaded } from "@/features/toolsets/access-result";
import { ALWAYS_LOADED_LABEL } from "@/features/toolsets/labels";
import type { AgentAccess } from "@/services/toolsets.service";
import { toast } from "@/utils/toast";

import { useUpdateAccess } from "./use-toolsets";

/**
 * "Always loaded" (design spec §7.4, §7.10): up to 5 tools pinned on every
 * server where this agent searches, so the ones it uses all the time never
 * cost a search. The agent's most-called tools are offered first; each click
 * saves at once (one PATCH), with the result in a toast.
 */
export function AlwaysLoaded({
  access,
  agentName,
  compact = false,
  searching,
}: {
  access: AgentAccess;
  agentName: string;
  compact?: boolean;
  /** In the Connect sheet: whether this server lets the agent search (pins matter only there). */
  searching?: boolean;
}) {
  const [filter, setFilter] = React.useState("");
  const catalogue = useCatalogue();
  const update = useUpdateAccess(access.agentId);
  const pinned = access.pinnedTools;
  const full = pinned.length >= MAX_ALWAYS_LOADED;
  const allowed = React.useMemo(
    () => new Set(access.tools.filter((t) => t.access !== "BLOCKED" && t.providersTotal > 0).map((t) => mcpToolName(t) ?? t.name)),
    [access.tools],
  );
  // The team's recent calls (the feed carries no agent), most used first.
  const calls = React.useMemo(
    () =>
      catalogue.calls
        .map((c) => {
          const tool = catalogue.tools.find((t) => t.toolId === c.toolId);
          return { toolName: tool ? (mcpToolName(tool) ?? tool.name) : "" };
        })
        .filter((c) => c.toolName !== ""),
    [catalogue.calls, catalogue.tools],
  );
  const suggested = suggestAlwaysLoaded(calls, pinned, allowed).slice(0, MAX_ALWAYS_LOADED - pinned.length);
  const save = (next: string[], message: string) => update.mutate(pinnedToolsBody(next), { onSuccess: () => toast.success(message) });
  const options = [...allowed]
    .filter((name) => !pinned.includes(name))
    .sort()
    .map((name) => ({ id: name, label: name }));

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="always-loaded">
      {compact ? null : <span className="text-label-13 text-01">{ALWAYS_LOADED_LABEL}</span>}
      <p className="text-body-xs text-03">
        Up to {MAX_ALWAYS_LOADED} tools {agentName} gets on every server where it searches, so it never has to look for them. This is a setting of {agentName},
        for all its servers; it does not change the URL.
      </p>
      {searching === false ? <p className="text-body-xs text-03">This server lists every tool already, so these matter on the others.</p> : null}
      {pinned.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={ALWAYS_LOADED_LABEL}>
          {pinned.map((name) => (
            <li key={name} className="inline-flex min-h-10 items-center gap-1 rounded-full bg-primary-10 py-0.5 pl-2.5 pr-1 text-label-xs text-primary-700">
              <Pin aria-hidden="true" className="size-3" />
              <span className="font-mono [overflow-wrap:anywhere]">{name}</span>
              <button
                type="button"
                aria-label={`Stop always loading ${name}`}
                className="flex size-8 items-center justify-center rounded-full hover:bg-primary-20 tablet:size-6"
                disabled={update.isPending}
                onClick={() => save(pinned.filter((p) => p !== name), `${name} is no longer always loaded`)}
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-13 text-02">None yet.</p>
      )}
      {suggested.length > 0 && !full ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-body-xs text-03">Most used:</span>
          {suggested.map((name) => (
            <button
              key={name}
              type="button"
              className="inline-flex min-h-10 items-center gap-1 rounded-full border border-02 bg-01 px-3 text-label-xs text-02 hover:text-01"
              disabled={update.isPending}
              onClick={() => save([...pinned, name], `${name} is always loaded`)}
            >
              <Plus aria-hidden="true" className="size-3" />
              <span className="font-mono">{name}</span>
            </button>
          ))}
        </div>
      ) : null}
      {full ? <p className="text-body-xs text-03">That is the most: remove one to pin another.</p> : null}
      {/* A list that stays open: tick several in a row. */}
      <div className="flex flex-col gap-1.5 rounded-md border border-02 bg-01 p-2" data-testid="always-loaded-list">
        <input
          aria-label="Find a tool to keep loaded"
          className="min-h-10 w-full rounded-md bg-02 px-3 text-body-13 text-01 outline-none placeholder:text-03"
          placeholder="Find a tool"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <ul className="flex max-h-48 flex-col overflow-y-auto">
          {options
            .filter((o) => o.label.includes(filter.trim().toLowerCase()))
            .map((o) => (
              <li key={o.id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded px-1.5 text-body-13 text-01 hover:bg-02">
                  <input
                    type="checkbox"
                    className="accent-primary-500"
                    disabled={full || update.isPending}
                    checked={false}
                    onChange={() => save([...pinned, o.id], `${o.id} is always loaded`)}
                  />
                  <span className="font-mono text-mono-12">{o.label}</span>
                </label>
              </li>
            ))}
          {options.length === 0 ? <li className="px-1.5 py-2 text-body-xs text-03">No other tool this agent can use.</li> : null}
        </ul>
      </div>
    </div>
  );
}
