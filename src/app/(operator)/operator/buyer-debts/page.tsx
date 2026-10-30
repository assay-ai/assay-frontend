"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Banknote, Check, Clock, History, Undo2, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { CopyChip } from "@/components/patterns/copy-chip";
import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Chip } from "@/components/toolsets/toolset-bits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { shortRef } from "@/features/call-disputes/model";
import { walletLabel } from "@/features/operator/block-targets";
import {
  activeFilterCount,
  assetShort,
  BUYER_DEBT_VOID_ACTION,
  BUYER_DEBT_VOID_CODE,
  countText,
  DEBT_PAGE_SIZE,
  debtAmountText,
  debtQuery,
  type DebtFilters,
  type DebtSelection,
  EMPTY_DEBT_FILTERS,
  EMPTY_SELECTION,
  filterErrors,
  matchingAsset,
  mayReadBuyerDebts,
  mayVoidBuyerDebts,
  pageSelectState,
  reasonError,
  selectBlockedBecause,
  selectionMoney,
  toggleRows,
  totalText,
  VOID_CONSEQUENCES,
  VOID_MAX_IDS,
  VOID_REASON_MAX,
  VOID_REASON_MIN,
  VOID_TICKET_MAX,
  voidRequestError,
} from "@/features/operator/buyer-debts";
import { chainDisplayName } from "@/features/operator/call-summary";
import { eligibleApprovers } from "@/features/operator/inbox";
import { listLoadError } from "@/features/operator/operator-errors";
import { OperatorCasesTabs } from "@/features/operator/provider-tool-ui";
import { operatorQueries } from "@/features/operator/queries";
import { ResultCard } from "@/features/operator/result-card";
import { useOperatorSession } from "@/features/operator/session-context";
import { OPERATOR_SHEET_BUTTONS, OPERATOR_SHEET_FOOTER } from "@/features/operator/sheet-footer";
import { approvalHref, approverPhrase, sentForApproval } from "@/features/operator/two-person";
import { useOperatorDirectory, useProviderNames } from "@/features/operator/use-operator-lookups";
import { WhatHappens } from "@/features/operator/what-happens";
import { WhyNot } from "@/features/operator/why-not";
import { ApiError } from "@/libs/ApiClient";
import { listOperatorBuyerDebts, requestBuyerDebtVoid, type OperatorBuyerDebt } from "@/services/operator-buyer-debts.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

/**
 * Buyer debts, route `/operator/buyer-debts` (a tab of Penalties).
 *
 * A buyer debt is a served call whose voucher lapsed: the buyer owes it, and
 * its paid calls are refused until it is settled. When the platform caused
 * the lapse (the redeemer ran out of gas, the chain could not be reached),
 * Treasury or a Lead adjudicator selects those debts and asks for a void
 * (`M-1`); a second one approves it in Approvals. A void releases the hold and
 * the buyer is not charged, the provider is NOT paid, and it cannot be undone.
 *
 * Readable by Treasury, Lead adjudicators, Adjudicators and Support (SRE). One
 * request covers one asset and at most 500 debts. "Suggested platform cause"
 * is the server's label from the recorded refusal; it decides nothing.
 */

type Row = OperatorBuyerDebt;

function BuyerDebtsScreen() {
  const me = useOperatorSession();
  const canRead = mayReadBuyerDebts(me.roles);
  const canVoid = mayVoidBuyerDebts(me.roles);
  const providers = useProviderNames();
  const directory = useOperatorDirectory();

  const [filters, setFilters] = React.useState<DebtFilters>(EMPTY_DEBT_FILTERS);
  const [selection, setSelection] = React.useState<DebtSelection>(EMPTY_SELECTION);
  const [invalidIds, setInvalidIds] = React.useState<ReadonlySet<string>>(new Set());
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [result, setResult] = React.useState<React.ReactNode>(null);
  const [selectingAll, setSelectingAll] = React.useState(false);
  const [selectAllError, setSelectAllError] = React.useState<string | null>(null);
  // Every row seen, by id: a selection outlives a filter change and a page.
  const known = React.useRef(new Map<string, Row>());

  const list = useInfiniteQuery({
    queryKey: ["operator", "buyer-debts", "list", debtQuery(filters)],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listOperatorBuyerDebts(debtQuery(filters, pageParam)),
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
    enabled: canRead,
    retry: 0,
  });
  const rows = React.useMemo(() => (list.data?.pages ?? []).flatMap((page) => page.items), [list.data]);
  React.useEffect(() => {
    for (const row of rows) known.current.set(row.intentId, row);
  }, [rows]);
  const totals = list.data?.pages[0]?.totals ?? null;

  // Void requests already waiting for a second operator — the same query as the badge.
  const pending = useQuery({ ...operatorQueries.pendingApprovals(), enabled: canRead, refetchInterval: 30_000, retry: 0 });
  const waiting = (pending.data?.items ?? []).filter((approval) => approval.action === BUYER_DEBT_VOID_ACTION && approval.status === "PENDING");

  const toggle = (picked: readonly Row[], on: boolean) => {
    for (const row of picked) known.current.set(row.intentId, row);
    setSelection((current) => toggleRows(current, picked, on, known.current));
  };
  const clearSelection = () => {
    setSelection(EMPTY_SELECTION);
    setInvalidIds(new Set());
  };
  const dropInvalid = () => {
    setSelection((current) => toggleRows(current, [...invalidIds].map((id) => known.current.get(id)).filter((row): row is Row => Boolean(row)), false, known.current));
    setInvalidIds(new Set());
  };

  // "Select all matching": every debt the filters match, up to 500, when they are all of one asset.
  const single = totals ? matchingAsset(totals.byAsset) : null;
  const selectAllMatching = async () => {
    setSelectingAll(true);
    setSelectAllError(null);
    try {
      const all: Row[] = [];
      let cursor: string | undefined;
      do {
        const page = await listOperatorBuyerDebts(debtQuery(filters, cursor, DEBT_PAGE_SIZE));
        all.push(...page.items);
        cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
      } while (cursor && all.length < VOID_MAX_IDS);
      for (const row of all) known.current.set(row.intentId, row);
      setSelection(toggleRows(EMPTY_SELECTION, all.slice(0, VOID_MAX_IDS), true, known.current));
      setInvalidIds(new Set());
    } catch (error) {
      setSelectAllError(listLoadError(error, "The matching debts"));
    } finally {
      setSelectingAll(false);
    }
  };

  if (!canRead) {
    return (
      <>
        <OperatorCasesTabs />
        <PageState
          kind="blocked"
          title="Buyer debts are for Treasury, adjudicators and Support"
          description="This list shows what buyers owe for calls whose payment lapsed. Ask an operator with one of those roles."
        />
      </>
    );
  }

  const total = selectionMoney(selection);
  const pageState = pageSelectState(selection, rows);
  const mixedOnPage = canVoid && rows.some((row) => selectBlockedBecause(selection, row) !== null && !selection.ids.includes(row.intentId));
  const approvers = directory.isPending ? undefined : eligibleApprovers(BUYER_DEBT_VOID_CODE, directory.operators, me.id);

  return (
    <>
      <OperatorCasesTabs />
      <header className="flex w-full flex-col gap-0.5">
        <h1 className="text-heading-md text-01">Buyer debts</h1>
        <p className="text-body-13 text-03">
          Calls that were served but whose payment lapsed. The buyer owes them, and its paid calls are refused until they are settled.
        </p>
      </header>

      {canVoid ? (
        <p className="text-body-13 text-02">
          If the platform caused a lapse (for example the redeemer ran out of gas), select those debts and request a void. A second operator approves it.
        </p>
      ) : (
        <WhyNot action="voidDebts" me={me} ask="Can you look at these buyer debts on Assay? Some may need a void, and my role cannot ask for one." />
      )}

      {result ? <div className="w-full">{result}</div> : null}

      {waiting.length > 0 ? (
        <p role="status" className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-01 bg-01 px-3.5 py-2.5 text-body-13 text-02">
          <Clock aria-hidden="true" className="size-4 shrink-0 text-03" />
          {waiting.length === 1 ? "1 void request is" : `${waiting.length} void requests are`} waiting for a second operator.
          <Link href={waiting.length === 1 ? approvalHref(waiting[0]!.id) : "/operator/approvals"} className="hit-area text-label-13 text-primary-600 hover:underline">
            {waiting.length === 1 ? "Open the request" : "Open Approvals"}
          </Link>
        </p>
      ) : null}

      <FiltersBar filters={filters} onChange={setFilters} />

      {totals ? <TotalsBar totals={totals} /> : null}

      {list.isLoading ? (
        <PageState kind="loading" rows={5} label="Loading buyer debts" />
      ) : list.isError ? (
        <PageState
          kind="error"
          description={listLoadError(list.error, "The buyer debts")}
          onRetry={() => void list.refetch()}
          code={list.error instanceof ApiError ? list.error.code : null}
        />
      ) : rows.length === 0 ? (
        <PageState
          kind="empty"
          title={activeFilterCount(filters) > 0 ? "No debt matches" : "No open buyer debts"}
          description={activeFilterCount(filters) > 0 ? "Clear a filter, or widen the dates." : "Every served call has been paid for, or voided."}
          action={activeFilterCount(filters) > 0 ? { label: "Clear filters", onClick: () => setFilters(EMPTY_DEBT_FILTERS) } : undefined}
        />
      ) : (
        <>
          {canVoid && single && single.count > rows.length ? (
            <div className="flex w-full flex-wrap items-center gap-2 text-body-13 text-02">
              <Button variant="secondary" size="sm" className="touch-target" loading={selectingAll} onClick={() => void selectAllMatching()}>
                Select all {Math.min(single.count, VOID_MAX_IDS).toLocaleString("en-US")} matching
                {single.count > VOID_MAX_IDS ? ` (of ${single.count.toLocaleString("en-US")})` : ""}
              </Button>
              {single.count > VOID_MAX_IDS ? <span className="text-03">One void covers at most {VOID_MAX_IDS}; the first {VOID_MAX_IDS} in this order are picked.</span> : null}
              {selectAllError ? (
                <span role="alert" className="text-danger-600">
                  {selectAllError}
                </span>
              ) : null}
            </div>
          ) : null}
          {mixedOnPage ? (
            <p className="text-body-xs text-03">
              One void covers one asset{selection.assetId ? ` (${assetShort(selection.assetId)} for this selection)` : ""}: rows of another asset cannot be added until you clear the selection.
            </p>
          ) : null}
          <DebtTable
            rows={rows}
            canVoid={canVoid}
            selection={selection}
            invalidIds={invalidIds}
            pageState={pageState}
            onToggle={toggle}
            providerName={(id) => (id ? (providers.lookup(id) ?? `Provider ${shortRef(id)}`) : "Unknown provider")}
          />
        </>
      )}

      {list.hasNextPage ? (
        <Button variant="secondary" className="self-start" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          Load more
        </Button>
      ) : null}

      {canVoid && selection.ids.length > 0 ? (
        <div
          role="region"
          aria-label="Selection"
          className="sticky bottom-0 z-10 flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-02 bg-01 px-4 py-3 shadow-sm"
        >
          <p className="text-label-13 text-01" aria-live="polite">
            {countText(selection.ids.length)} selected{total ? ` · ${formatMoney(total, { decimals: 4 })}` : ""}
            {selection.assetId ? <span className="text-body-xs text-03"> · {assetShort(selection.assetId)}</span> : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" className="touch-target" onClick={clearSelection}>
              Clear
            </Button>
            <Button size="sm" data-primary="" className="touch-target" onClick={() => setSheetOpen(true)}>
              Request void
            </Button>
          </div>
        </div>
      ) : null}

      {canVoid ? (
        <RequestVoidSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          selection={selection}
          invalidIds={invalidIds}
          onInvalid={setInvalidIds}
          onDropInvalid={dropInvalid}
          approvers={approvers}
          onQueued={(node) => {
            setResult(node);
            clearSelection();
          }}
          onDismissResult={() => setResult(null)}
        />
      ) : null}
    </>
  );
}

// ── Filters ─────────────────────────────────────────────────────────────────

const INPUT = "min-h-10 w-full min-w-0 rounded-md border border-02 bg-01 px-3 text-body-13 text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

function FilterField({ label, error, children }: { label: string; error?: string; children: React.ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }> }) {
  const id = React.useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-label-13 text-02">
        {label}
      </label>
      {React.cloneElement(children, { id, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : undefined })}
      {error ? (
        <span id={`${id}-error`} className="text-body-xs text-danger-600">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The filters: "Suggested platform cause" and the sort apply at once; the
 * rest are typed into a draft and applied together (Enter or Apply), so the
 * list is not re-read on every keystroke.
 */
function FiltersBar({ filters, onChange }: { filters: DebtFilters; onChange: (next: DebtFilters) => void }) {
  const [draft, setDraft] = React.useState<DebtFilters>(filters);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => setDraft(filters), [filters]);
  const errors = filterErrors(draft);
  const set = (patch: Partial<DebtFilters>) => setDraft((current) => ({ ...current, ...patch }));
  const count = activeFilterCount({ ...filters, suggestedOnly: false });
  const panelId = React.useId();

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    if (Object.keys(errors).length > 0) return;
    onChange({ ...draft, suggestedOnly: filters.suggestedOnly, sort: filters.sort, order: filters.order });
  };

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div className="flex w-full flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={filters.suggestedOnly}
          onClick={() => onChange({ ...filters, suggestedOnly: !filters.suggestedOnly })}
          className={cn(
            "min-h-10 rounded-full border px-3 text-label-13",
            filters.suggestedOnly ? "border-primary-500 bg-primary-10 text-primary-700" : "border-02 bg-01 text-02 hover:text-01",
          )}
        >
          {filters.suggestedOnly ? <Check aria-hidden="true" className="mr-1 inline size-3.5" /> : null}
          Suggested only
        </button>
        <label className="flex items-center gap-2 text-body-13 text-02">
          <span className="sr-only">Sort by</span>
          <select
            value={`${filters.sort}:${filters.order}`}
            onChange={(event) => {
              const [sort, order] = event.target.value.split(":") as [DebtFilters["sort"], DebtFilters["order"]];
              onChange({ ...filters, sort, order });
            }}
            className="min-h-10 rounded-md border border-02 bg-01 px-2.5 text-body-13 text-01"
          >
            <option value="lapsedAt:desc">Lapsed, newest first</option>
            <option value="lapsedAt:asc">Lapsed, oldest first</option>
            <option value="createdAt:desc">Called, newest first</option>
            <option value="createdAt:asc">Called, oldest first</option>
          </select>
        </label>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="touch-target rounded-md px-2 text-label-13 text-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          Filters{count > 0 ? <span className="tabular-nums text-03"> · {count}</span> : null}
        </button>
        {count > 0 ? (
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_DEBT_FILTERS, suggestedOnly: filters.suggestedOnly, sort: filters.sort, order: filters.order })}
            className="hit-area text-label-13 text-primary-600 hover:underline"
          >
            Clear filters
          </button>
        ) : null}
      </div>
      {open ? (
        <form id={panelId} onSubmit={apply} aria-label="Filters" className="grid w-full grid-cols-1 gap-3 rounded-xl border border-01 bg-01 p-4 tablet:grid-cols-3">
          <FilterField label="Lapsed from (UTC)" error={errors.from}>
            <input type="date" value={draft.from} onChange={(e) => set({ from: e.target.value })} className={INPUT} />
          </FilterField>
          <FilterField label="Lapsed to (UTC, inclusive)" error={errors.to}>
            <input type="date" value={draft.to} onChange={(e) => set({ to: e.target.value })} className={INPUT} />
          </FilterField>
          <FilterField label="Cause (last refusal, exact)">
            <input value={draft.lastError} placeholder="VoucherExpired" maxLength={256} onChange={(e) => set({ lastError: e.target.value })} className={cn(INPUT, "font-mono")} />
          </FilterField>
          <FilterField label="Buyer organization id" error={errors.buyerOrganizationId}>
            <input value={draft.buyerOrganizationId} onChange={(e) => set({ buyerOrganizationId: e.target.value })} className={cn(INPUT, "font-mono")} />
          </FilterField>
          <FilterField label="Paying wallet (CAIP-10)">
            <input value={draft.payerAccount} maxLength={256} placeholder="eip155:46630:0x…" onChange={(e) => set({ payerAccount: e.target.value })} className={cn(INPUT, "font-mono")} />
          </FilterField>
          <FilterField label="Provider id" error={errors.providerId}>
            <input value={draft.providerId} onChange={(e) => set({ providerId: e.target.value })} className={cn(INPUT, "font-mono")} />
          </FilterField>
          <FilterField label="Chain (CAIP-2)">
            <input value={draft.chainId} maxLength={128} placeholder="eip155:46630" onChange={(e) => set({ chainId: e.target.value })} className={cn(INPUT, "font-mono")} />
          </FilterField>
          <FilterField label="Asset (CAIP-19)">
            <input value={draft.assetId} maxLength={256} onChange={(e) => set({ assetId: e.target.value })} className={cn(INPUT, "font-mono")} />
          </FilterField>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm" className="touch-target" disabled={Object.keys(errors).length > 0}>
              Apply
            </Button>
            <Button type="button" variant="secondary" size="sm" className="touch-target" onClick={() => setDraft(filters)}>
              Reset
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

// ── Totals ──────────────────────────────────────────────────────────────────

function TotalsBar({ totals }: { totals: { count: number; byAsset: { assetId: string; decimals: number; count: number; amount: string }[] } }) {
  if (totals.byAsset.length === 0) return null;
  const several = totals.byAsset.length > 1;
  return (
    <section aria-label="Totals" className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-02 px-3.5 py-2.5" data-testid="debt-totals">
      <span className="text-label-13 text-02">Matching: {countText(totals.count)}</span>
      {totals.byAsset.map((total) => (
        <span key={`${total.assetId}|${total.decimals}`} className="text-body-13 tabular-nums text-01">
          {totalText(total)}
          {several ? <span className="text-03"> in {assetShort(total.assetId)}</span> : null}
        </span>
      ))}
      {several ? <span className="text-body-xs text-03">Amounts of different assets are not added. One void covers one asset.</span> : null}
    </section>
  );
}

// ── Table ───────────────────────────────────────────────────────────────────

function DebtTable({
  rows,
  canVoid,
  selection,
  invalidIds,
  pageState,
  onToggle,
  providerName,
}: {
  rows: readonly Row[];
  canVoid: boolean;
  selection: DebtSelection;
  invalidIds: ReadonlySet<string>;
  pageState: ReturnType<typeof pageSelectState<Row>>;
  onToggle: (rows: readonly Row[], on: boolean) => void;
  providerName: (id: string | null) => string;
}) {
  const headerBox = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = pageState.some;
  }, [pageState.some]);
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-01 bg-01">
      <table className="w-full min-w-[720px] border-collapse text-left" data-testid="debt-table">
        <caption className="sr-only">Open buyer debts{canVoid ? ", with a checkbox per row to select it for a void" : ""}</caption>
        <thead>
          <tr className="border-b border-01 text-label-13 text-03">
            {canVoid ? (
              <th scope="col" className="w-10 px-4 py-2">
                <Checkbox
                  ref={headerBox}
                  aria-label="Select all on this page"
                  checked={pageState.all}
                  disabled={pageState.selectable.length === 0}
                  onChange={(event) => onToggle(pageState.selectable, event.target.checked)}
                />
              </th>
            ) : null}
            <th scope="col" className="px-3 py-2 font-normal">
              Amount
            </th>
            <th scope="col" className="px-3 py-2 font-normal">
              Buyer
            </th>
            <th scope="col" className="px-3 py-2 font-normal">
              Provider
            </th>
            <th scope="col" className="px-3 py-2 font-normal">
              Lapsed
            </th>
            <th scope="col" className="px-3 py-2 font-normal">
              Cause
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-01">
          {rows.map((row) => {
            const selected = selection.ids.includes(row.intentId);
            const blocked = canVoid ? selectBlockedBecause(selection, row) : null;
            const invalid = invalidIds.has(row.intentId);
            return (
              <tr
                key={row.intentId}
                data-invalid={invalid ? "" : undefined}
                aria-invalid={invalid || undefined}
                className={cn("align-top text-body-13 text-02", selected && "bg-primary-10", invalid && "bg-danger-10")}
              >
                {canVoid ? (
                  <td className="px-4 py-3">
                    <Checkbox
                      aria-label={`Select the ${debtAmountText(row)} debt of buyer ${shortRef(row.buyerOrganizationId)}`}
                      title={blocked ?? undefined}
                      checked={selected}
                      disabled={blocked !== null}
                      onChange={(event) => onToggle([row], event.target.checked)}
                    />
                  </td>
                ) : null}
                <td className="px-3 py-3">
                  <span className="flex flex-col gap-1">
                    <span className="font-mono text-mono-13 text-01">{debtAmountText(row)}</span>
                    <span className="flex flex-wrap gap-1">
                      {row.suggestedPlatformCause ? <Chip tone="primary">Suggested platform cause</Chip> : null}
                      {row.writtenOff ? <Chip>Written off</Chip> : null}
                      {invalid ? <Chip tone="danger">No longer open</Chip> : null}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-01">Buyer {shortRef(row.buyerOrganizationId)}</span>
                    <span className="text-body-xs text-03">{walletLabel(row.payerAccount)}</span>
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-01">{providerName(row.providerId)}</span>
                    <span className="text-body-xs text-03">{chainDisplayName(row.chainId)}</span>
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className="flex flex-col gap-0.5">
                    <UtcTime value={row.lapsedAt} />
                    <span className="text-body-xs text-03">
                      called <UtcTime value={row.createdAt} dateOnly />
                    </span>
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className="flex flex-col items-start gap-1">
                    <span className="font-mono text-mono-12 text-02 [overflow-wrap:anywhere]">{row.lastError ?? "—"}</span>
                    <CopyChip value={row.intentId} label="intent id" />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Request a void (M-1) ────────────────────────────────────────────────────

function RequestVoidSheet({
  open,
  onOpenChange,
  selection,
  invalidIds,
  onInvalid,
  onDropInvalid,
  approvers,
  onQueued,
  onDismissResult,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: DebtSelection;
  invalidIds: ReadonlySet<string>;
  onInvalid: (ids: ReadonlySet<string>) => void;
  onDropInvalid: () => void;
  approvers: string[] | undefined;
  onQueued: (node: React.ReactNode) => void;
  onDismissResult: () => void;
}) {
  const queryClient = useQueryClient();
  const me = useOperatorSession();
  const needs = approverPhrase(BUYER_DEBT_VOID_CODE, me.roles);
  const [reason, setReason] = React.useState("");
  const [ticket, setTicket] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const total = selectionMoney(selection);
  const totalLabel = total ? formatMoney(total, { decimals: 4 }) : "";
  const debtsLabel = countText(selection.ids.length).replace(/debts?$/, "buyer $&");
  const what = `Voiding ${debtsLabel} (${totalLabel})`;

  const request = useMutation({
    mutationFn: () =>
      requestBuyerDebtVoid({ intentIds: [...selection.ids], reason: reason.trim(), ...(ticket.trim() ? { ticketRef: ticket.trim() } : {}) }),
    onSuccess: (answer) => {
      void queryClient.invalidateQueries({ queryKey: ["operator", "approvals"] });
      if (answer.kind !== "queued") return;
      const sent = sentForApproval(what, approvers, needs, answer.approval.expiresAt);
      const link = approvalHref(answer.approval.approvalId);
      onQueued(
        <div className="flex w-full flex-col gap-2">
          <ResultCard
            tone="queued"
            title="Waiting for a second operator"
            next={`${sent.title}. ${sent.next} Until then the buyers still owe these debts.`}
            link={{ label: "Open the request", href: link }}
            onDismiss={onDismissResult}
          />
          <ApprovalFooter needs={needs} approvers={approvers} link={link} expiresAt={answer.approval.expiresAt} />
        </div>,
      );
      setReason("");
      setTicket("");
      setTouched(false);
      onOpenChange(false);
    },
    onError: (error) => {
      const { invalidIds: ids } = voidRequestError(error);
      if (ids.length > 0) onInvalid(new Set(ids));
    },
  });
  const { reset } = request;
  React.useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const reasonProblem = reasonError(reason);
  const failure = request.error ? voidRequestError(request.error) : null;
  const stillInvalid = [...invalidIds].filter((id) => selection.ids.includes(id));

  const submit = () => {
    setTouched(true);
    if (reasonProblem || selection.ids.length === 0 || stillInvalid.length > 0) return;
    request.mutate();
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (!next && request.isPending ? undefined : onOpenChange(next))}>
      <SheetContent showCloseButton={!request.isPending}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">
            Void {debtsLabel} ({totalLabel})?
          </SheetTitle>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-3">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-body-13">
            <dt className="text-02">Debts</dt>
            <dd className="tabular-nums text-01">{selection.ids.length}</dd>
            <dt className="text-02">Total</dt>
            <dd className="tabular-nums text-01">{totalLabel}</dd>
            <dt className="text-02">Asset</dt>
            <dd className="font-mono text-mono-12 text-01 [overflow-wrap:anywhere]">{selection.assetId}</dd>
          </dl>
          <WhatHappens
            lines={[
              { icon: Undo2, text: VOID_CONSEQUENCES.buyer },
              { icon: Banknote, text: VOID_CONSEQUENCES.provider, tone: "warning" },
              { icon: Check, text: VOID_CONSEQUENCES.hold },
              { icon: Ban, text: VOID_CONSEQUENCES.final, tone: "warning" },
              { icon: History, text: VOID_CONSEQUENCES.when },
              { icon: Users, text: VOID_CONSEQUENCES.two },
            ]}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-label-13 text-01">Why the platform caused these debts</span>
            <textarea
              value={reason}
              maxLength={VOID_REASON_MAX}
              rows={4}
              required
              aria-invalid={touched && reasonProblem ? true : undefined}
              placeholder="What failed on our side, when, and how you checked it."
              onChange={(event) => setReason(event.target.value)}
              onBlur={() => setTouched(true)}
              className="rounded-md border border-02 bg-01 px-3 py-2 text-body-13 text-01"
            />
            <span className={cn("text-body-xs", touched && reasonProblem ? "text-danger-600" : "text-03")}>
              {touched && reasonProblem ? reasonProblem : `${reason.trim().length} / ${VOID_REASON_MIN} minimum. Kept in the audit log.`}
            </span>
          </label>
          <label className="flex flex-col gap-1.5 tablet:max-w-[320px]">
            <span className="text-label-13 text-01">Ticket or incident (optional)</span>
            <input
              value={ticket}
              maxLength={VOID_TICKET_MAX}
              onChange={(event) => setTicket(event.target.value)}
              className="min-h-10 rounded-md border border-02 bg-01 px-3 font-mono text-mono-12 text-01"
            />
          </label>
          {stillInvalid.length > 0 ? (
            <div role="alert" className="flex w-full flex-col gap-2 rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-2.5 text-body-13 text-danger-700">
              <p>{failure?.message ?? `${stillInvalid.length} selected debts are no longer open.`}</p>
              <ul className="flex flex-wrap gap-1.5" aria-label="Debts no longer open">
                {stillInvalid.map((id) => (
                  <li key={id}>
                    <CopyChip value={id} label="intent id" />
                  </li>
                ))}
              </ul>
              <Button variant="secondary" size="sm" className="touch-target self-start" onClick={onDropInvalid}>
                Leave {stillInvalid.length === 1 ? "it" : "them"} out
              </Button>
            </div>
          ) : failure ? (
            <p role="alert" className="rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-2.5 text-body-13 text-danger-700">
              {failure.message}
            </p>
          ) : null}
          <ApprovalFooter needs={needs} approvers={approvers} />
        </div>
        <SheetFooter className={OPERATOR_SHEET_FOOTER}>
          <div className={OPERATOR_SHEET_BUTTONS}>
            <SheetClose asChild>
              <Button variant="secondary" disabled={request.isPending}>
                Keep the debts
              </Button>
            </SheetClose>
            <Button variant="danger" loading={request.isPending} disabled={selection.ids.length === 0 || stillInvalid.length > 0} onClick={submit}>
              Send for approval
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default function BuyerDebtsPage() {
  return (
    <React.Suspense fallback={null}>
      <BuyerDebtsScreen />
    </React.Suspense>
  );
}
