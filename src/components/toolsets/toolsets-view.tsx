"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Layers, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { useCatalogue } from "@/components/g31/use-catalogue";
import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { defaultEntry } from "@/features/toolsets/entry-rules";
import { shareStatus } from "@/features/toolsets/sharing";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { createToolset, type ToolsetSummary } from "@/services/toolsets.service";
import { toast } from "@/utils/toast";

import { ConnectSheet } from "./connect-sheet";
import { ShareById } from "./share-dialog";
import { Chip, statusChipTone } from "./toolset-bits";
import { errorText, toolsetKeys, useToolsets } from "./use-toolsets";

/**
 * Controls › Tool sets (`/toolsets/mine`): the account's own tool sets. Each
 * one is its own MCP server at `/my/{slug}`, serving its Draft live. Create
 * names one (the address is generated); an account with none starts from the
 * tools its agents already used. A row opens `/toolsets/mine?id=`.
 */
export function toolsetHref(id: string): string {
  return `/toolsets/mine?id=${encodeURIComponent(id)}`;
}

export function ToolsetsView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useToolsets();
  const catalogue = useCatalogue();
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [connect, setConnect] = React.useState<string | null>(null);
  const [sharing, setSharing] = React.useState<string | null>(null);
  const [slugHint, setSlugHint] = React.useState<string | null>(null);

  // "Start from tools you've used": the agents' recent calls, most used first.
  const used = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const call of catalogue.calls) counts.set(call.toolId, (counts.get(call.toolId) ?? 0) + 1);
    return [...counts.entries()]
      .filter(([id]) => catalogue.tools.some((t) => t.toolId === id))
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
      .slice(0, 20);
  }, [catalogue.calls, catalogue.tools]);

  const create = useMutation({
    mutationFn: (input: { name: string; slug?: string; toolIds?: string[] }) =>
      createToolset({ name: input.name, slug: input.slug, entries: (input.toolIds ?? []).map(defaultEntry) }),
    onSuccess: (set) => {
      void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
      toast.success(`${set.name} created`, { description: "Add tools and provider rules, then connect it." });
      router.push(toolsetHref(set.id));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "TOOLSET_SLUG_TAKEN" && typeof error.context?.suggestion === "string") {
        setSlugHint(error.context.suggestion);
      }
    },
  });

  const sets = query.data?.items ?? [];

  const createForm = (
    <form
      className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 p-4 tablet:flex-row tablet:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) create.mutate({ name: name.trim(), slug: slugHint ?? undefined });
      }}
    >
      <Field
        id="new-toolset-name"
        label="Name"
        placeholder="e.g. Research kit"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setSlugHint(null);
        }}
        hint={slugHint ? `That address is taken; it will be /my/${slugHint}.` : "Its address is made from the name."}
        error={create.isError && !slugHint ? errorText(create.error) : undefined}
        wrapperClassName="flex-1"
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
          Create
        </Button>
        <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );

  return (
    <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:gap-5 tablet:px-7 tablet:py-[22px]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Tool sets</h1>
          <p className="text-body-13 text-02">
            A tool set is its own MCP server: only its tools, with the provider rules you choose. Connect it next to Everything or instead of it.
          </p>
        </div>
        {sets.length > 0 && !creating ? (
          <Button icon={<Plus />} onClick={() => setCreating(true)}>
            New tool set
          </Button>
        ) : null}
      </header>

      {creating ? createForm : null}

      {query.isPending ? (
        <PageState kind="loading" rows={3} label="Loading your tool sets" />
      ) : query.isError ? (
        <PageState
          kind="error"
          title="Your tool sets could not be loaded"
          description={plainError(query.error instanceof ApiError ? query.error.code : "ERR_NETWORK")}
          code={query.error instanceof ApiError ? query.error.code : null}
          onRetry={() => void query.refetch()}
        />
      ) : sets.length === 0 ? (
        creating ? null : (
          <section className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-6 tablet:p-8" data-testid="toolsets-empty">
            <Layers aria-hidden="true" className="size-6 text-03" />
            <h2 className="text-label-md text-01">Start from tools you&apos;ve used</h2>
            <p className="text-body-13 text-02">
              {used.length > 0
                ? `Your agents called ${used.length} tool${used.length === 1 ? "" : "s"} recently. Put them in one tool set, then trim it and set provider rules.`
                : "No calls yet to start from. Make an empty tool set and add the tools your agent needs."}
            </p>
            <div className="flex flex-wrap gap-2">
              {used.length > 0 ? (
                <Button loading={create.isPending} onClick={() => create.mutate({ name: "Tools I use", toolIds: used })}>
                  Start from tools you&apos;ve used
                </Button>
              ) : null}
              <Button variant={used.length > 0 ? "secondary" : "primary"} onClick={() => setCreating(true)}>
                {used.length > 0 ? "Start empty" : "New tool set"}
              </Button>
            </div>
          </section>
        )
      ) : (
        <ul className="flex w-full flex-col overflow-hidden rounded-xl border border-01 bg-01 shadow-hair" data-testid="toolsets-list">
          {sets.map((set) => (
            <ToolsetRow key={set.id} set={set} onConnect={() => setConnect(set.mcpUrl)} onShare={() => setSharing(set.id)} />
          ))}
        </ul>
      )}

      <ConnectSheet open={connect !== null} onOpenChange={(open) => !open && setConnect(null)} initialUrl={connect} />
      <ShareById id={sharing} onOpenChange={(open) => !open && setSharing(null)} />
    </div>
  );
}

function ToolsetRow({ set, onConnect, onShare }: { set: ToolsetSummary; onConnect: () => void; onShare: () => void }) {
  return (
    <li className="flex w-full flex-col gap-2 border-b border-01 px-4 py-3.5 last:border-b-0 tablet:flex-row tablet:items-center tablet:px-5" data-testid="toolset-row">
      <Link href={toolsetHref(set.id)} className="flex min-w-0 flex-1 items-center gap-3 hover:underline">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-label-13 text-01">
            {set.name}
            <Chip tone={statusChipTone(shareStatus(set).tone)}>{shareStatus(set).label}</Chip>
          </span>
          <span className="break-all font-mono text-mono-xs text-03">/my/{set.slug}</span>
          <span className="text-body-xs text-03">
            {set.toolCount} tool{set.toolCount === 1 ? "" : "s"} · changed <UtcTime value={set.updatedAt} relative midSentence />
          </span>
        </div>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03 tablet:hidden" />
      </Link>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="secondary" onClick={onConnect}>
          Connect
        </Button>
        <Button size="sm" variant="secondary" onClick={onShare} disabled={set.removed} data-testid="row-share">
          Share
        </Button>
        <Button size="sm" variant="ghost" asChild className="hidden tablet:inline-flex">
          <Link href={toolsetHref(set.id)}>Edit</Link>
        </Button>
      </div>
    </li>
  );
}
