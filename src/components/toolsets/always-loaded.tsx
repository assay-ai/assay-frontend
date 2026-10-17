"use client";

import { Pin, Plus, X } from "lucide-react";
import * as React from "react";

import { useCatalogue } from "@/components/g31/use-catalogue";
import { EntityPicker } from "@/components/patterns/entity-picker";
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
export function AlwaysLoaded({ access, agentName, compact = false }: { access: AgentAccess; agentName: string; compact?: boolean }) {
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
        Up to {MAX_ALWAYS_LOADED} tools {agentName} gets on every server where it searches, so it never has to look for them.
      </p>
      {pinned.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={ALWAYS_LOADED_LABEL}>
          {pinned.map((name) => (
            <li key={name} className="inline-flex min-h-10 items-center gap-1 rounded-full bg-primary-10 py-0.5 pl-2.5 pr-1 text-label-xs text-primary-700 tablet:min-h-0">
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
              className="inline-flex min-h-10 items-center gap-1 rounded-full border border-02 bg-01 px-2.5 text-label-xs text-02 hover:text-01 tablet:min-h-0 tablet:py-0.5"
              disabled={update.isPending}
              onClick={() => save([...pinned, name], `${name} is always loaded`)}
            >
              <Plus aria-hidden="true" className="size-3" />
              <span className="font-mono">{name}</span>
            </button>
          ))}
        </div>
      ) : null}
      {full ? (
        <p className="text-body-xs text-03">That is the most: remove one to pin another.</p>
      ) : (
        <EntityPicker
          label="Add a tool"
          value={null}
          placeholder="Search tools by name"
          options={options}
          onChange={(id) => id && save([...pinned, id], `${id} is always loaded`)}
          inline
        />
      )}
    </div>
  );
}
