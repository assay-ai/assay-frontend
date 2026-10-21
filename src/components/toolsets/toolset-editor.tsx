"use client";

import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Info, Share2, Trash2, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { useSpendPolicyQuery } from "@/components/buyer-money/use-agents";
import { useToolVersions } from "@/components/contracts/use-tool-versions";
import { ServingChip } from "@/components/g31/providers-view";
import { useCatalogue, type ProviderRow } from "@/components/g31/use-catalogue";
import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { EntityPicker } from "@/components/patterns/entity-picker";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { buildMcpUrl, toolDisplay } from "@/features/connect/mcp-url";
import {
  contractChipParts,
  currentMajorOf,
  entryContractWarning,
  entryMajors,
  majorChoiceLabel,
  majorChoices,
  majorsChipText,
  mustReturnEffect,
  optionalOutputsFor,
  unknownRequiredFields, MANY_VERSIONS_HINT } from "@/features/contracts/entry-contract";
import { formatVersionRange } from "@/features/contracts/semver";
import { fieldList } from "@/features/contracts/text";
import type { ToolVersionBrief } from "@/interfaces/contracts";
import { defaultEntry, entryChipLabel, entryInput, entryProblem, providersLeft } from "@/features/toolsets/entry-rules";
import {
  DRAFT_NOTICE,
  draftToolCountText,
  ON_EMPTY_LABELS,
  PROVIDER_MODE_LABELS,
  TAKEN_DOWN_LABEL,
  TAKEN_DOWN_NOTE,
  takenDownToolIds,
  VERIFIED_ONLY_LABEL,
} from "@/features/toolsets/labels";
import { nothingRunsWarning, type ProviderOffer } from "@/features/toolsets/provider-fit";
import { shareStatus, sharedPage } from "@/features/toolsets/sharing";
import { failRateShort, formatCallPrice } from "@/features/explorer/explorer-text";
import { useChainName } from "@/hooks/useChainName";
import { getCatalogueProvider } from "@/services/catalogue.service";
import { ApiError } from "@/libs/ApiClient";
import { plainApiError, plainError } from "@/libs/plain-language";
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
import { rangeText } from "@/features/contracts/semver";
import { toast } from "@/utils/toast";

import { ConnectPanel } from "./connect-panel";
import { ShareDialog } from "./share-dialog";
import { Chip, makerOf, statusChipTone } from "./toolset-bits";
import { PublisherStats, VersionHistory } from "./toolset-versions";
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
export function ToolsetPage({ id, slug, free, version }: { id: string | null; slug: string | null; free?: boolean; version?: number | null }) {
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
        description={notFound ? "No tool set of yours has this address." : query.error instanceof ApiError ? plainApiError(query.error) : plainError("ERR_NETWORK")}
        {...(notFound ? { action: { label: "Your tool sets", href: "/toolsets/mine" } } : { onRetry: () => void query.refetch() })}
      />,
    );
  }
  const set = query.data;
  return frame(
    <>
      <ConnectPanel
        compact
        copyable
        connectLabel="Use this tool set"
        url={buildMcpUrl({ kind: "toolset", slug: set.slug, version: version ?? null }, { free: Boolean(free) })}
        title={`Connect ${set.name}`}
        detail={version ? `Locked to v${version}: only these tools, with these provider rules.` : "Its own MCP server: only these tools, with these provider rules."}
      />
      <ToolsetHeader set={set} />
      <EntriesEditor set={set} />
      <VersionHistory set={set} />
      <PublisherStats set={set} />
    </>,
  );
}

function ToolsetHeader({ set }: { set: Toolset }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(set.name);
  const [deleting, setDeleting] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const status = shareStatus(set);
  const page = sharedPage(set);
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
          <Button size="sm" icon={<Share2 />} className="min-h-10" onClick={() => setSharing(true)} disabled={set.removed} data-testid="open-share">
            Share
          </Button>
          <button type="button" className="min-h-10 px-1 text-label-13 text-primary-600 hover:underline" onClick={() => setRenaming(true)}>
            Rename
          </button>
          <button type="button" className="inline-flex min-h-10 items-center gap-1 px-1 text-label-13 text-danger-600 hover:underline" onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden="true" className="size-3.5" />
            Delete
          </button>
        </div>
      )}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-xs text-03" data-testid="share-status">
        <Chip tone={statusChipTone(status.tone)}>{status.label}</Chip>
        <span className="break-all font-mono">/my/{set.slug}</span>
        <span>
          · {draftToolCountText(set.toolCount, set.entries)}
        </span>
        {page ? (
          <Link href={page} className="min-h-10 content-center text-primary-600 hover:underline">
            Its public page
          </Link>
        ) : null}
      </p>
      {status.notice ? (
        <p role="status" className={cn("rounded-lg px-3 py-2 text-body-13", status.tone === "danger" ? "bg-danger-10 text-danger-700" : "bg-warning-10 text-warning-700")} data-testid="share-notice">
          {status.notice}
        </p>
      ) : null}
      {set.forkedFrom ? (
        <p className="text-body-xs text-03">Your own version of another tool set{set.forkedFrom.version ? ` (from its v${set.forkedFrom.version})` : ""}. It gets no updates from the original.</p>
      ) : null}
      <ShareDialog set={set} open={sharing} onOpenChange={setSharing} />
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
  // Read only: `takenDown` is never part of a saved row.
  const takenDown = takenDownToolIds(set.entries);
  const save = useMutation({
    mutationFn: (next: Row[]) => replaceToolsetEntries(set.id, next.map(({ toolName: _n, decimals: _d, ...e }) => e)),
    onSuccess: (next) => {
      queryClient.setQueryData(toolsetKeys.one(set.id), next);
      void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
      void queryClient.invalidateQueries({ queryKey: ["mcp-preview"] });
    },
    onError: (error) => toast.error(errorText(error, "The change could not be saved")),
  });

  // The rows before the last saved change, so it can be undone from the header (and the toast).
  const [undoRows, setUndoRows] = React.useState<Row[] | null>(null);
  const change = (next: Row[], what: string, onDone?: () => void) => {
    const before = rows;
    save.mutate(next, {
      onSuccess: () => {
        setUndoRows(before);
        onDone?.();
        toast.success(what, { duration: 6000, action: { label: "Undo", onClick: () => undoLast(before) } });
      },
    });
  };
  const undoLast = (before: Row[] | null = undoRows) => {
    if (!before) return;
    save.mutate(before, { onSuccess: () => setUndoRows(null) });
  };

  const asset = policy.data?.asset ?? catalogue.tools.find((t) => t.price)?.price?.asset ?? "";
  const decimals = policy.data?.decimals ?? 6;
  const serving = (toolId: string) => catalogue.providers.filter((p) => p.toolIds.includes(toolId));

  return (
    <section aria-label="Tools in this set" className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5" data-testid="toolset-entries">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-label-md text-01">
          Tools
          <Chip tone="primary">Draft</Chip>
        </h2>
        <span className="text-body-xs text-03" aria-live="polite">
          {save.isPending ? "Saving…" : save.isSuccess ? "Saved" : null}
          {!save.isPending && undoRows ? (
            <Button size="sm" variant="ghost" className="ml-1" onClick={() => undoLast()}>
              Undo
            </Button>
          ) : null}
        </span>
      </div>
      <p className="flex items-start gap-2 rounded-lg bg-primary-10 px-3 py-2 text-body-13 text-primary-700" data-testid="draft-notice">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        This is the Draft: what /my/{set.slug} serves now. {DRAFT_NOTICE} Agents connected to it see each saved change on their next
        call; some apps list tools again only after a restart.
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
              takenDown={takenDown.has(row.toolId)}
              versions={catalogue.tools.find((t) => t.toolId === row.toolId)?.versions ?? []}
              open={open === row.toolId}
              onToggle={() => setOpen(open === row.toolId ? null : row.toolId)}
              onApply={(next) => {
                change(rows.map((r, i) => (i === index ? { ...next, toolName: r.toolName } : r)), `${row.toolName}: rules saved`, () => setOpen(null));
              }}
              onRange={(range) =>
                change(rows.map((r, i) => (i === index ? { ...r, toolVersionRange: range } : r)), `${row.toolName} now also uses ${rangeText(range)}`)
              }
              onRemove={() => save.mutate(rows.filter((_, i) => i !== index))}
              saving={save.isPending}
            />
          ))}
        </ul>
      )}

      {save.isError ? (
        <p className="flex items-start gap-1.5 text-body-13 text-danger-700" data-testid="entries-save-error">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {save.error instanceof ApiError && save.error.code === "TOOLSET_INVALID"
            ? "This change could not be saved: the tool set does not accept this rule."
            : errorText(save.error, "The change could not be saved")}
        </p>
      ) : null}

      <EntityPicker
        label="Add a tool"
        value={null}
        placeholder="Search tools by name"
        options={catalogue.tools
          .filter((t) => !rows.some((r) => r.toolId === t.toolId))
          .sort((a, b) => Number(a.providerCount === 0) - Number(b.providerCount === 0) || toolDisplay(a).name.localeCompare(toolDisplay(b).name))
          .map((t) => {
            const shown = toolDisplay(t);
            const providers = t.providerCount === 0 ? "No provider yet" : `${t.providerCount} provider${t.providerCount === 1 ? "" : "s"}`;
            return { id: t.toolId, label: shown.name, disabled: t.providerCount === 0, detail: shown.title ? `${shown.title} · ${providers}` : providers };
          })}
        onChange={(id, option) => id && save.mutate([...rows, { ...defaultEntry(id), toolName: option?.label ?? id }])}
        className="tablet:w-[360px]"
      />
    </section>
  );
}

export function EntryRow({
  row,
  decimals,
  asset,
  providers,
  takenDown = false,
  versions,
  open,
  onToggle,
  onApply,
  onRange,
  onRemove,
  saving,
}: {
  row: Row;
  decimals: number;
  asset: string;
  providers: ProviderRow[];
  /** Assay took the tool down: say so instead of "No provider yet" (BUG-X-05). */
  takenDown?: boolean;
  /** The tool's published versions, from the catalogue card (T3); empty when the card is not at hand. */
  versions: readonly ToolVersionBrief[];
  open: boolean;
  onToggle: () => void;
  onApply: (next: ToolsetEntryInput) => void;
  /** One-click "Allow v2" from the row's warning. */
  onRange: (range: string) => void;
  onRemove: () => void;
  saving: boolean;
}) {
  const left = providersLeft(row, providers.map((p) => p.providerId));
  const contract = contractChipParts(row, currentMajorOf(versions));
  const chip = `${entryChipLabel({ ...row, maxPrice: row.maxPrice ? { ...row.maxPrice, decimals } : null }, decimals)}${
    row.onEmpty === "FALLBACK_BEST" && row.providerMode !== "BEST" ? " · if none fits, Assay picks" : ""
  }${contract.length > 0 ? ` · ${contract.join(" · ")}` : ""}`;
  const warning = entryContractWarning(row.toolVersionRange, versions);
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5" data-testid="entry-row">
      <div className="flex flex-col gap-1.5 tablet:flex-row tablet:flex-wrap tablet:items-center tablet:gap-x-3">
        <div className="flex min-w-0 items-start gap-2 tablet:flex-1">
          <span className="flex min-w-[8rem] flex-1 flex-col">
            <span className="font-mono text-mono-13 text-01 [overflow-wrap:anywhere]">{toolDisplay({ name: row.toolName, toolId: row.toolId }).name}</span>
            {toolDisplay({ name: row.toolName, toolId: row.toolId }).title ? (
              <span className="text-body-xs text-03">{toolDisplay({ name: row.toolName, toolId: row.toolId }).title}</span>
            ) : null}
          </span>
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
          {takenDown ? (
            <span className="rounded-full bg-danger-10 px-2 py-0.5 text-label-xs text-danger-700" data-testid="entry-taken-down">
              {TAKEN_DOWN_LABEL}
            </span>
          ) : providers.length === 0 ? (
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
              "inline-flex min-h-10 items-center gap-1 rounded-full border px-3 py-1 text-left text-label-xs transition-colors",
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
      {takenDown ? (
        <p role="status" className="rounded-lg bg-danger-10 px-3 py-2 text-body-13 text-danger-700" data-testid="entry-taken-down-note">
          {TAKEN_DOWN_NOTE}
        </p>
      ) : null}
      {warning ? (
        <p
          role="status"
          className={cn(
            "flex flex-col gap-1.5 rounded-lg px-3 py-2 text-body-13 tablet:flex-row tablet:items-center tablet:justify-between",
            warning.tone === "danger" ? "bg-danger-10 text-danger-700" : "bg-warning-10 text-warning-700",
          )}
          data-testid="entry-contract-warning"
        >
          <span className="flex items-start gap-1.5">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {warning.text}
          </span>
          {warning.fix ? (
            <Button size="sm" variant="secondary" className="min-h-10 self-start" loading={saving} onClick={() => onRange(warning.fix!.range)}>
              {warning.fix.label}
            </Button>
          ) : null}
        </p>
      ) : null}
      {open ? (
        <RuleEditor row={row} decimals={decimals} asset={asset} providers={providers} versions={versions} onApply={onApply} onCancel={onToggle} saving={saving} />
      ) : null}
    </li>
  );
}

export function RuleEditor({
  row,
  decimals,
  asset,
  providers,
  versions,
  onApply,
  onCancel,
  saving,
}: {
  row: Row;
  decimals: number;
  asset: string;
  providers: ProviderRow[];
  versions: readonly ToolVersionBrief[];
  onApply: (next: ToolsetEntryInput) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const contract = useToolVersions(row.toolId);
  const full = React.useMemo(() => contract.data?.versions ?? [], [contract.data]);
  const known = full.length > 0 ? full : versions;
  const [majors, setMajors] = React.useState<number[]>(() => entryMajors(row.toolVersionRange, versions));
  const [required, setRequired] = React.useState<string[]>(row.requireOutputFields ?? []);
  // Without the catalogue card's versions, take the range from the full list once it lands.
  React.useEffect(() => {
    if (majors.length === 0 && full.length > 0) setMajors(entryMajors(row.toolVersionRange, full));
  }, [full, majors.length, row.toolVersionRange]);
  const choices = majorChoices(known);
  const offered = optionalOutputsFor(full, majors);
  const missing = contract.isSuccess ? unknownRequiredFields(required, offered) : [];
  const contractProblem =
    choices.length > 0 && majors.length === 0
      ? "Pick at least one version."
      : missing.length > 0
        ? `${majorsChipText(majors).replace(/ only$/, "")} doesn't return ${fieldList(missing)}, so no provider could serve these calls. Untick it, or allow a version that has it.`
        : null;
  // `{maker}__{tool}`: a provider tool. The server accepts only "Any" for it.
  const providerTool = makerOf(row.toolName) !== null;
  const [mode, setMode] = React.useState<ProviderMode>(providerTool ? "BEST" : row.providerMode);
  const [ids, setIds] = React.useState<string[]>(row.providerIds);
  const [verified, setVerified] = React.useState(row.minTier !== null);
  const [max, setMax] = React.useState(row.maxPrice ? toDecimal({ ...row.maxPrice, decimals }).toString() : "");
  const [onEmpty, setOnEmpty] = React.useState<OnEmpty>(row.onEmpty);
  const [tried, setTried] = React.useState(false);
  const parsed = parseAmountInput(max, { decimals, required: false });
  const problem = entryProblem({ providerMode: mode, providerIds: ids }) ?? contractProblem;
  const left = providersLeft({ providerMode: mode, providerIds: ids }, providers.map((p) => p.providerId));
  const offers = useProviderOffers(row.toolId, providers);
  const chainName = useChainName();
  // Advisory: the server's routing rules still decide every call.
  const nothingRuns = nothingRunsWarning(
    {
      providerMode: mode,
      providerIds: ids,
      // The same tier and asset Apply saves below.
      minTier: verified ? (row.minTier === "TRUSTED" ? "TRUSTED" : "ESTABLISHED") : null,
      maxPriceAtomic: parsed.atomic ?? null,
      maxPriceAsset: asset || null,
      onEmpty,
    },
    offers,
    row.toolName,
  );
  // Apply asks twice when the rule would leave you nothing that runs; a
  // changed rule (a different warning) asks again.
  const [warnedFor, setWarnedFor] = React.useState<string | null>(null);
  const warned = nothingRuns !== null && warnedFor === nothingRuns;

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-02 p-3" data-testid="rule-editor">
      <div className="flex flex-col gap-1.5">
        <span className="text-label-xs text-02">Providers</span>
        {providerTool ? (
          // One maker's own tool has one provider, which the server only accepts as "Any".
          <p className="text-body-xs text-03" data-testid="provider-tool-note">
            One maker&apos;s own tool: it has one provider, so there is nothing to choose.
          </p>
        ) : (
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
        )}
      </div>
      {mode !== "BEST" ? (
        providers.length === 0 ? (
          <p className="text-body-xs text-03">No provider serves this tool yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5" aria-label={mode === "ONLY" ? "Use only these providers" : "Never use these providers"}>
            {providers.map((p, index) => (
              <li key={p.providerId} data-testid="provider-option">
                <Checkbox
                  className="min-h-10"
                  checked={ids.includes(p.providerId)}
                  onChange={(e) => setIds(e.target.checked ? [...ids, p.providerId] : ids.filter((x) => x !== p.providerId))}
                  label={<ProviderOfferLabel provider={p} offer={offers[index]} chainName={chainName} />}
                />
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-body-xs text-03">Assay picks the best provider for each call, from all {providers.length} that serve it.</p>
          {providers.length > 0 ? (
            <ul className="flex flex-col gap-1.5" aria-label="Providers of this tool">
              {providers.map((p, index) => (
                <li key={p.providerId} data-testid="provider-option" className="flex min-h-10 items-center">
                  <ProviderOfferLabel provider={p} offer={offers[index]} chainName={chainName} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
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
            : "Assay ignores this row's provider choice and picks the best one. Must return, the tool version and the agent's own limits still apply."}
        </p>
      </div>
      <MustReturnPicker
        loading={contract.isPending}
        failed={contract.isError}
        onRetry={() => void contract.refetch()}
        offered={offered}
        required={required}
        onChange={(next) => {
          setRequired(next);
          setTried(false);
        }}
      />
      {choices.length > 0 ? (
        <details className="rounded-lg border border-01 bg-01 px-3" data-testid="contract-version" open={majors.some((m) => choices.find((c) => c.major === m)?.status !== "ACTIVE")}>
          <summary className="cursor-pointer text-label-xs text-02">Advanced · Contract version: {majorsChipText(majors) || "not set"}</summary>
          <div className="flex flex-col gap-2 pb-3">
            <p className="text-body-xs text-03">
              Which version of this tool&apos;s inputs and outputs your agents get. A new first number (v1 → v2) means fields were renamed
              or removed, so an agent built for one may break on the other. Keep the current one unless your agent needs an older one.
            </p>
            {majors.length > 1 ? <p className="text-body-xs text-02">{MANY_VERSIONS_HINT}</p> : null}
            <ul className="flex flex-col gap-1" aria-label="Contract versions this tool set uses">
              {choices.map((c) => {
                const on = majors.includes(c.major);
                return (
                  <li key={c.major}>
                    <Checkbox
                      className="min-h-10"
                      checked={on}
                      disabled={c.status === "RETIRED" && !on}
                      onChange={(e) => {
                        setMajors(e.target.checked ? [...majors, c.major].sort((a, b) => a - b) : majors.filter((m) => m !== c.major));
                        setTried(false);
                      }}
                      label={majorChoiceLabel(c)}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        </details>
      ) : null}
      {mode !== "BEST" && providers.length > 0 && left <= 1 && !problem && !nothingRuns ? (
        <p className="flex items-center gap-1.5 text-body-xs text-warning-700">
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          {left === 0 ? "No provider is left: every call will be refused." : "One provider left: no backup if it is down."}
        </p>
      ) : null}
      {nothingRuns && !problem ? (
        <p
          role={warned ? "alert" : "status"}
          className={cn("flex items-start gap-1.5 rounded-lg px-3 py-2 text-body-13", warned ? "bg-danger-10 text-danger-700" : "bg-warning-10 text-warning-700")}
          data-testid="nothing-runs-warning"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {nothingRuns}
            {warned ? " Apply anyway?" : ""}
          </span>
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
            if (nothingRuns && !warned) {
              setWarnedFor(nothingRuns);
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
              ...(majors.length > 0 ? { toolVersionRange: formatVersionRange(majors) } : row.toolVersionRange ? { toolVersionRange: row.toolVersionRange } : {}),
              requireOutputFields: required,
            });
          }}
        >
          {nothingRuns && warned ? "Apply anyway" : "Apply"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Each provider's own listing of this tool (price, chains, whether it serves
 * you), read from its catalogue page: the same cached query Explore uses.
 * A row whose page has not loaded yet has no status, and is never counted
 * against the rule.
 */
function useProviderOffers(toolId: string, providers: readonly ProviderRow[]): ProviderOffer[] {
  const details = useQueries({
    queries: providers.map((p) => ({
      queryKey: ["catalogue", "provider", p.providerId],
      queryFn: () => getCatalogueProvider(p.providerId),
      retry: false,
      staleTime: 60_000,
    })),
  });
  return providers.map((p, index) => {
    const listing = details[index]?.data?.tools.find((t) => t.toolId === toolId);
    return {
      providerId: p.providerId,
      name: p.name,
      tier: p.tier,
      price: listing?.price ?? null,
      chains: listing?.chains,
      servesYou: listing?.servesYou,
      notServedReason: listing?.notServedReason,
    };
  });
}

/** "Open-Meteo Demo BV · $0.25 · Solana devnet · 5% failed  [Doesn't take payment on your chain]". */
function ProviderOfferLabel({ provider, offer, chainName }: { provider: ProviderRow; offer: ProviderOffer | undefined; chainName: (chainId: string) => string }) {
  const facts = [
    offer?.price ? formatCallPrice(offer.price) : null,
    offer?.chains && offer.chains.length > 0 ? offer.chains.map(chainName).join(", ") : null,
    failRateShort(provider),
  ].filter(Boolean);
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <span>
          {provider.name}
          {provider.tier === "NEW" ? " · not verified yet" : ""}
        </span>
        {offer ? <ServingChip fit={offer} /> : null}
      </span>
      <span className="text-body-xs text-03" data-testid="provider-facts">
        {facts.join(" · ")}
      </span>
    </span>
  );
}

/**
 * "Must return" (design spec §6.3): the extra fields this tool's versions
 * offer, ticked to send calls only to providers that return them. Hidden
 * when the tool has none (and nothing is required).
 */
function MustReturnPicker({
  loading,
  failed,
  onRetry,
  offered,
  required,
  onChange,
}: {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  offered: readonly string[];
  required: readonly string[];
  onChange: (next: string[]) => void;
}) {
  if (loading) return <p className="text-body-xs text-03" role="status">Loading this tool&apos;s extra fields…</p>;
  if (failed) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-body-xs text-danger-700">
        Couldn&apos;t load this tool&apos;s extra fields.
        <button type="button" className="min-h-10 text-label-13 text-primary-600 hover:underline" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  }
  const fields = [...new Set([...offered, ...required])];
  if (fields.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="must-return">
      <span className="text-label-xs text-02">Must return</span>
      <ul className="flex flex-wrap gap-x-4" aria-label="Must return">
        {fields.map((field) => (
          <li key={field}>
            <Checkbox
              className="min-h-10"
              checked={required.includes(field)}
              onChange={(e) => onChange(e.target.checked ? [...required, field] : required.filter((f) => f !== field))}
              label={<span className="font-mono text-mono-13">{field}</span>}
            />
          </li>
        ))}
      </ul>
      <p className="text-body-xs text-03">Extra fields not every provider returns. {mustReturnEffect(required)}</p>
    </div>
  );
}
