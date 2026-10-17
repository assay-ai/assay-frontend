"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Info, Trash2, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { useSpendPolicyQuery } from "@/components/buyer-money/use-agents";
import { useCatalogue, type ProviderRow } from "@/components/g31/use-catalogue";
import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { EntityPicker } from "@/components/patterns/entity-picker";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { buildMcpUrl } from "@/features/connect/mcp-url";
import { defaultEntry, entryChipLabel, entryInput, entryProblem, providersLeft } from "@/features/toolsets/entry-rules";
import { DRAFT_NOTICE, ON_EMPTY_LABELS, PROVIDER_MODE_LABELS, VERIFIED_ONLY_LABEL } from "@/features/toolsets/labels";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import {
  deleteToolset,
  replaceToolsetEntries,
  updateToolset,
  type OnEmpty,
  type ProviderMode,
  type Toolset,
  type ToolsetEntryInput,
} from "@/services/toolsets.service";
import { cn } from "@/utils";
import { parseAmountInput, toDecimal } from "@/utils/money";
import { toast } from "@/utils/toast";

import { ConnectPanel } from "./connect-panel";
import { errorText, toolsetKeys, useToolset, useToolsets } from "./use-toolsets";

/**
 * One tool set (`/toolsets/mine?id=` — or `?slug=`, the page `/my/{slug}`
 * opens in a browser): Connect at the top, then its name and its Draft. The
 * Draft is what `/my/{slug}` serves, live: every save reaches the agents
 * connected to it at once, and the editor says so.
 *
 * Each row: the tool, and its provider rule behind one chip — "Providers:
 * Any (Assay picks) ▾" — with Only these / All except, Only verified
 * providers, a max price, and what happens when no provider fits.
 */
export function ToolsetPage({ id, slug, free }: { id: string | null; slug: string | null; free?: boolean }) {
  const list = useToolsets();
  const resolvedId = id ?? (slug ? list.data?.items.find((t) => t.slug === slug)?.id ?? null : null);
  const query = useToolset(resolvedId);

  const frame = (children: React.ReactNode) => (
    <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:gap-5 tablet:px-7 tablet:py-[22px]">
      <Link href="/toolsets/mine" className="self-start text-label-13 text-02 hover:underline">
        ← Tool sets
      </Link>
      {children}
    </div>
  );

  if (!id && slug && list.isPending) return frame(<PageState kind="loading" rows={4} label="Loading the tool set" />);
  if (!resolvedId) {
    return frame(
      <PageState
        kind="empty"
        title="Not found"
        description="No tool set of yours has this address. It may have been deleted, or it belongs to another account."
        action={{ label: "Your tool sets", href: "/toolsets/mine" }}
      />,
    );
  }
  if (query.isPending) return frame(<PageState kind="loading" rows={4} label="Loading the tool set" />);
  if (query.isError || !query.data) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return frame(
      <PageState
        kind={notFound ? "empty" : "error"}
        title={notFound ? "Not found" : "This tool set could not be loaded"}
        description={notFound ? "No tool set of yours has this address." : plainError(query.error instanceof ApiError ? query.error.code : "ERR_NETWORK")}
        {...(notFound ? { action: { label: "Your tool sets", href: "/toolsets/mine" } } : { onRetry: () => void query.refetch() })}
      />,
    );
  }
  const set = query.data;
  return frame(
    <>
      <ConnectPanel
        compact
        url={buildMcpUrl({ kind: "toolset", slug: set.slug }, { free: Boolean(free) })}
        title={`Connect ${set.name}`}
        detail="Its own MCP server: only these tools, with these provider rules."
      />
      <ToolsetHeader set={set} />
      <EntriesEditor set={set} />
    </>,
  );
}

function ToolsetHeader({ set }: { set: Toolset }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(set.name);
  const [deleting, setDeleting] = React.useState(false);
  const rename = useMutation({
    mutationFn: () => updateToolset(set.id, { name: name.trim() }),
    onSuccess: (next) => {
      queryClient.setQueryData(toolsetKeys.one(set.id), next);
      void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
      setRenaming(false);
      toast.success("Renamed");
    },
  });
  return (
    <header className="flex flex-col gap-2">
      {renaming ? (
        <form
          className="flex flex-col gap-2 tablet:flex-row tablet:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== set.name) rename.mutate();
            else setRenaming(false);
          }}
        >
          <Field
            id="rename-toolset"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint={`Its address does not change: /my/${set.slug}`}
            error={rename.isError ? errorText(rename.error) : undefined}
            wrapperClassName="tablet:w-[360px]"
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={rename.isPending}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-heading-md text-01">{set.name}</h1>
          <button type="button" className="min-h-10 px-1 text-label-13 text-primary-600 hover:underline tablet:min-h-0" onClick={() => setRenaming(true)}>
            Rename
          </button>
          <button type="button" className="inline-flex min-h-10 items-center gap-1 px-1 text-label-13 text-danger-600 hover:underline tablet:min-h-0" onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden="true" className="size-3.5" />
            Delete
          </button>
        </div>
      )}
      <p className="text-body-xs text-03">
        Only my team · <span className="break-all font-mono">/my/{set.slug}</span> · {set.toolCount} tool{set.toolCount === 1 ? "" : "s"}
      </p>
      <ConfirmSheet
        open={deleting}
        onOpenChange={setDeleting}
        tone="danger"
        title={`Delete ${set.name}?`}
        description={`Its server stops working at once: agents connected to /my/${set.slug} can no longer call its tools. Agents allowed to use it lose those tools too.`}
        changes={[{ label: `/my/${set.slug}`, before: "Serves", after: "Stopped" }]}
        confirmLabel="Delete tool set"
        onConfirm={async () => {
          await deleteToolset(set.id);
          void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
          void queryClient.invalidateQueries({ queryKey: ["agent-access"] });
          toast.success(`${set.name} deleted`);
          router.push("/toolsets/mine");
        }}
        describeError={(error) => errorText(error, "The tool set could not be deleted")}
      />
    </header>
  );
}

type Row = ToolsetEntryInput & { toolName: string; decimals?: number };

function rowsOf(set: Toolset): Row[] {
  return set.entries.map((e) => ({ ...entryInput(e), toolName: e.toolName, decimals: e.maxPrice?.decimals }));
}

function EntriesEditor({ set }: { set: Toolset }) {
  const queryClient = useQueryClient();
  const catalogue = useCatalogue();
  const policy = useSpendPolicyQuery();
  const [open, setOpen] = React.useState<string | null>(null);
  const rows = rowsOf(set);
  const save = useMutation({
    mutationFn: (next: Row[]) => replaceToolsetEntries(set.id, next.map(({ toolName: _n, decimals: _d, ...e }) => e)),
    onSuccess: (next) => {
      queryClient.setQueryData(toolsetKeys.one(set.id), next);
      void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["mcp-preview"] });
    },
    onError: (error) => toast.error(errorText(error, "The change could not be saved")),
  });

  const asset = policy.data?.asset ?? catalogue.tools.find((t) => t.price)?.price?.asset ?? "";
  const decimals = policy.data?.decimals ?? 6;
  const serving = (toolId: string) => catalogue.providers.filter((p) => p.toolIds.includes(toolId));

  return (
    <section aria-label="Tools in this set" className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5" data-testid="toolset-entries">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-label-md text-01">Tools</h2>
        <span className="text-body-xs text-03" aria-live="polite">
          {save.isPending ? "Saving…" : save.isSuccess ? "Saved" : null}
        </span>
      </div>
      <p className="flex items-start gap-2 rounded-lg bg-primary-10 px-3 py-2 text-body-13 text-primary-700" data-testid="draft-notice">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {DRAFT_NOTICE} Agents connected to /my/{set.slug} see each saved change on their next call; some apps list tools again only after a restart.
      </p>

      {rows.length === 0 ? (
        <p className="text-body-13 text-02">No tools yet. Add the first one below.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01">
          {rows.map((row, index) => (
            <EntryRow
              key={row.toolId}
              row={row}
              decimals={row.decimals ?? decimals}
              asset={asset}
              providers={serving(row.toolId)}
              open={open === row.toolId}
              onToggle={() => setOpen(open === row.toolId ? null : row.toolId)}
              onApply={(next) => {
                save.mutate(rows.map((r, i) => (i === index ? { ...next, toolName: r.toolName } : r)), { onSuccess: () => setOpen(null) });
              }}
              onRemove={() => save.mutate(rows.filter((_, i) => i !== index))}
              saving={save.isPending}
            />
          ))}
        </ul>
      )}

      <EntityPicker
        label="Add a tool"
        value={null}
        placeholder="Search tools by name"
        options={catalogue.tools
          .filter((t) => !rows.some((r) => r.toolId === t.toolId))
          .sort((a, b) => Number(a.providerCount === 0) - Number(b.providerCount === 0) || a.name.localeCompare(b.name))
          .map((t) => ({
            id: t.toolId,
            label: t.name,
            disabled: t.providerCount === 0,
            detail: t.providerCount === 0 ? "No provider yet" : `${t.providerCount} provider${t.providerCount === 1 ? "" : "s"}`,
          }))}
        onChange={(id, option) => id && save.mutate([...rows, { ...defaultEntry(id), toolName: option?.label ?? id }])}
        className="tablet:w-[360px]"
      />
    </section>
  );
}

function EntryRow({
  row,
  decimals,
  asset,
  providers,
  open,
  onToggle,
  onApply,
  onRemove,
  saving,
}: {
  row: Row;
  decimals: number;
  asset: string;
  providers: ProviderRow[];
  open: boolean;
  onToggle: () => void;
  onApply: (next: ToolsetEntryInput) => void;
  onRemove: () => void;
  saving: boolean;
}) {
  const left = providersLeft(row, providers.map((p) => p.providerId));
  const chip = `${entryChipLabel({ ...row, maxPrice: row.maxPrice ? { ...row.maxPrice, decimals } : null }, decimals)}${
    row.onEmpty === "FALLBACK_BEST" && row.providerMode !== "BEST" ? " · if none fits, Assay picks" : ""
  }`;
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5" data-testid="entry-row">
      <div className="flex flex-col gap-1.5 tablet:flex-row tablet:flex-wrap tablet:items-center tablet:gap-x-3">
        <div className="flex min-w-0 items-start gap-2 tablet:flex-1">
          <span className="min-w-[8rem] flex-1 font-mono text-mono-13 text-01 [overflow-wrap:anywhere]">{row.toolName}</span>
          <button
            type="button"
            aria-label={`Remove ${row.toolName}`}
            className="-my-1.5 flex size-10 shrink-0 items-center justify-center rounded-full text-03 hover:bg-02 hover:text-01 tablet:hidden"
            onClick={onRemove}
            disabled={saving}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {providers.length === 0 ? (
            <span className="rounded-full bg-warning-10 px-2 py-0.5 text-label-xs text-warning-700">No provider yet</span>
          ) : left === 1 ? (
            <span className="rounded-full bg-warning-10 px-2 py-0.5 text-label-xs text-warning-700">No backup provider</span>
          ) : left === 0 ? (
            <span className="rounded-full bg-danger-10 px-2 py-0.5 text-label-xs text-danger-700">No provider fits</span>
          ) : null}
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className={cn(
              "inline-flex min-h-10 items-center gap-1 rounded-full border px-3 py-1 text-left text-label-xs transition-colors tablet:min-h-0",
              open ? "border-primary-500 bg-primary-10 text-primary-700" : "border-02 bg-01 text-02 hover:text-01",
            )}
          >
            {chip}
            <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
          </button>
          <button
            type="button"
            aria-label={`Remove ${row.toolName}`}
            className="hidden size-8 items-center justify-center rounded-full text-03 hover:bg-02 hover:text-01 tablet:flex"
            onClick={onRemove}
            disabled={saving}
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      </div>
      {open ? <RuleEditor row={row} decimals={decimals} asset={asset} providers={providers} onApply={onApply} onCancel={onToggle} saving={saving} /> : null}
    </li>
  );
}

function RuleEditor({
  row,
  decimals,
  asset,
  providers,
  onApply,
  onCancel,
  saving,
}: {
  row: Row;
  decimals: number;
  asset: string;
  providers: ProviderRow[];
  onApply: (next: ToolsetEntryInput) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [mode, setMode] = React.useState<ProviderMode>(row.providerMode);
  const [ids, setIds] = React.useState<string[]>(row.providerIds);
  const [verified, setVerified] = React.useState(row.minTier !== null);
  const [max, setMax] = React.useState(row.maxPrice ? toDecimal({ ...row.maxPrice, decimals }).toString() : "");
  const [onEmpty, setOnEmpty] = React.useState<OnEmpty>(row.onEmpty);
  const [tried, setTried] = React.useState(false);
  const parsed = parseAmountInput(max, { decimals, required: false });
  const problem = entryProblem({ providerMode: mode, providerIds: ids });
  const left = providersLeft({ providerMode: mode, providerIds: ids }, providers.map((p) => p.providerId));

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-02 p-3" data-testid="rule-editor">
      <div className="flex flex-col gap-1.5">
        <span className="text-label-xs text-02">Providers</span>
        <Segmented
          value={mode}
          onValueChange={(v) => {
            // Only these and All except mean opposite things: the ticks start again.
            if (v !== mode) setIds([]);
            setMode(v as ProviderMode);
            setTried(false);
          }}
          aria-label="Which providers"
        >
          {(Object.keys(PROVIDER_MODE_LABELS) as ProviderMode[]).map((m) => (
            <SegmentedItem key={m} value={m}>
              {PROVIDER_MODE_LABELS[m]}
            </SegmentedItem>
          ))}
        </Segmented>
      </div>
      {mode !== "BEST" ? (
        providers.length === 0 ? (
          <p className="text-body-xs text-03">No provider serves this tool yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5" aria-label={mode === "ONLY" ? "Use only these providers" : "Never use these providers"}>
            {providers.map((p) => (
              <li key={p.providerId}>
                <Checkbox
                  className="min-h-10 tablet:min-h-8"
                  checked={ids.includes(p.providerId)}
                  onChange={(e) => setIds(e.target.checked ? [...ids, p.providerId] : ids.filter((x) => x !== p.providerId))}
                  label={`${p.name}${p.tier === "NEW" ? " · not verified yet" : ""}`}
                />
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="text-body-xs text-03">Assay picks the best provider for each call, from all {providers.length} that serve it.</p>
      )}
      <Switch checked={verified} onChange={(e) => setVerified(e.target.checked)} label={VERIFIED_ONLY_LABEL} />
      <Field
        id={`entry-max-${row.toolId}`}
        label="Max price per call"
        inputMode="decimal"
        suffix="USD"
        placeholder="No limit"
        value={max}
        onChange={(e) => setMax(e.target.value)}
        error={parsed.error ?? undefined}
        wrapperClassName="tablet:w-[220px]"
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-label-xs text-02">If no provider fits</span>
        <Segmented value={onEmpty} onValueChange={(v) => setOnEmpty(v as OnEmpty)} aria-label="If no provider fits">
          {(Object.keys(ON_EMPTY_LABELS) as OnEmpty[]).map((o) => (
            <SegmentedItem key={o} value={o}>
              {ON_EMPTY_LABELS[o]}
            </SegmentedItem>
          ))}
        </Segmented>
        <p className="text-body-xs text-03">
          {onEmpty === "FAIL"
            ? "The call is refused and not charged; the agent is told why."
            : "Assay ignores this row's provider choice and picks the best one. The agent's own limits still apply."}
        </p>
      </div>
      {mode !== "BEST" && providers.length > 0 && left <= 1 && !problem ? (
        <p className="flex items-center gap-1.5 text-body-xs text-warning-700">
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          {left === 0 ? "No provider is left: every call will be refused." : "One provider left: no backup if it is down."}
        </p>
      ) : null}
      {problem && tried ? <p className="text-body-xs text-danger-700">{problem}</p> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          loading={saving}
          disabled={Boolean(parsed.error)}
          onClick={() => {
            if (problem) {
              setTried(true);
              return;
            }
            onApply({
              toolId: row.toolId,
              providerMode: mode,
              providerIds: mode === "BEST" ? [] : ids,
              minTier: verified ? (row.minTier === "TRUSTED" ? "TRUSTED" : "ESTABLISHED") : null,
              maxPrice: parsed.atomic && asset ? { amount: parsed.atomic, asset } : null,
              minQuality: row.minQuality,
              onEmpty,
            });
          }}
        >
          Apply
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
