"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download, ExternalLink, HelpCircle, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { DisplayAssetSelect, displayAssetLabel, useDisplayAsset } from "@/components/display-asset-select";
import { CopyChip } from "@/components/patterns/copy-chip";
import { UtcTime } from "@/components/patterns/utc-time";
import { MoneySplit, type MoneySplitSegment } from "@/components/patterns/money-flow";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { foldClasses, observedTakeRate, rowsInAsset, type CallRow } from "@/features/call-classes/csv";
import { classLabel, reasonLabel } from "@/features/call-classes/labels";
import { classNote, fromExport, fromLedger, takeCopy, type ReconSummary } from "@/features/call-classes/reconciliation";
import { downloadCallsCsv, useCallsExport } from "@/features/call-classes/use-calls-export";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { lossOf } from "@/features/provider-penalties/model";
import { usePenalties } from "@/features/provider-penalties/use-penalties";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";
import { isTransactionRef } from "@/features/provider-earnings/payments";
import { callsOfClass, earningsSplit, unpaidLines, type EarningsSplit, type UnpaidLine } from "@/features/provider-earnings/earned-tile";
import {
  callCount,
  notCreditedBreakdown,
  notCreditedReason,
  settlementShown,
  shownReasonAmounts,
  toolsLine,
  unpaidCallAmount,
} from "@/features/provider-earnings/not-credited";
import { useChains } from "@/hooks/useChains";
import type { Money, ProviderPayout } from "@/interfaces";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { routes } from "@/libs/routes";
import { listProviderPayouts, payoutsInAsset } from "@/services/provider-payouts.service";
import { getProviderEarnings, getProviderReconciliation } from "@/services/provider-reports.service";
import { chainIdOfAsset } from "@/utils/chain";
import { cn } from "@/utils";
import { formatMoney, toDecimal } from "@/utils/money";
import { toast } from "@/utils/toast";

/**
 * Money — "how much did I earn, and is it in my wallet?"
 *
 *  - This month: earned, as a split (in your wallet / Assay's fee / not
 *    credited). Calls that passed but paid nothing (yet): waiting on the
 *    buyer (buyer debt), overdue (not paid for 30 days) and forfeited, each
 *    named and explained, never as owed by the platform.
 *  - Recent payments: one row per payment with its transaction on the explorer:
 *    each redemption (rail B, paid from the buyer's escrow) and each payout run.
 *  - Not credited, grouped by plain reason (from the earnings report, so the
 *    summary is the sum of its reasons), with the tools it happened on.
 *  - Check against your logs: download the per-call CSV, and an "Explain a
 *    difference" drawer (what each outcome means, how to join on the call id).
 *    `/provider/money/reconciliation` opens that drawer.
 */

function monthWindow(now: Date) {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}

function amountOf(money: Money | null | undefined): number {
  return money ? toDecimal(money).toNumber() : 0;
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });

export default function ProviderMoneyPage() {
  const now = React.useMemo(() => new Date(), []);
  const month = React.useMemo(() => monthWindow(now), [now]);
  const params = useSearchParams();
  const [explainOpen, setExplainOpen] = React.useState(params.get("explain") === "1");

  const earnings = useQuery({
    queryKey: ["provider", "earnings", "tool", month.from, month.to],
    queryFn: () => getProviderEarnings({ ...month, groupBy: "tool" }),
  });
  const payouts = useQuery({
    queryKey: ["provider", "payouts", "all"],
    queryFn: () => listProviderPayouts({ limit: 100 }),
  });
  const calls = useCallsExport(month);
  const names = useProviderToolNames();
  const stake = useStakeStatus();
  const penalties = usePenalties({ withCases: "none" });
  // What executed penalties took from the stake, read from the chain (all time: the chain record has no execution date here).
  const takenByPenalties = penalties.rows
    .filter((row) => row.closedAs === "executed")
    .map((row) => lossOf(row))
    .filter((money): money is Money => money !== null);
  const takenTotal = takenByPenalties.length
    ? { ...takenByPenalties[0]!, amount: takenByPenalties.reduce((sum, m) => sum + BigInt(m.amount || "0"), 0n).toString() }
    : null;
  const { chains } = useChains();
  const { current: displayAsset, isPending: assetPending } = useDisplayAsset("provider");

  const rows = React.useMemo(() => (assetPending ? [] : rowsInAsset(calls.rows, displayAsset)), [calls.rows, assetPending, displayAsset]);
  /*
    Not credited, by reason, from the earnings report: every call of the month
    (the per-call file is capped), and a summary that is the sum of its
    reasons. Overdue and forfeited calls passed the check: they are explained
    under "Passed, but not paid", not here.
  */
  const notCredited = React.useMemo(
    () => notCreditedBreakdown(earnings.data?.totals, earnings.data?.groups),
    [earnings.data],
  );
  /* Each reason card's amount, adjusted by whole cents so the cards add up to their total on screen. */
  const reasonAmounts = React.useMemo(() => shownReasonAmounts(notCredited.reasons), [notCredited.reasons]);
  const passedUnpaidCalls = (earnings.data?.totals.uncollectedCalls ?? 0) + (earnings.data?.totals.forfeitedCalls ?? 0);
  /* The wallet figure and the fee come rounded once from cents: the same figures Home and the Explain drawer's Gross − fee = Net show. */
  const split = earningsSplit(earnings.data?.totals);
  // Normal money format; a sub-cent amount still shows its own digits (see `formatMoney`).
  const unpaid = unpaidLines(earnings.data?.totals, (value) => formatMoney(value, { decimals: 2 }));
  const monthName = MONTH.format(now);
  // The home's "Details" link lands on the block, which renders only once the month has loaded.
  const hasUnpaid = unpaid.length > 0;
  React.useEffect(() => {
    if (hasUnpaid && window.location.hash === "#passed-not-paid") {
      document.getElementById("passed-not-paid")?.scrollIntoView({ block: "start" });
    }
  }, [hasUnpaid]);

  /*
    The month's class breakdown and settlement from the ledger
    (`GET /providers/me/reconciliation`), aggregated over every call: the
    per-call CSV is capped, so its fold only stands in when this cannot be read.
  */
  const ledger = useQuery({
    queryKey: ["provider", "reconciliation", month.from, month.to, displayAsset ?? null],
    queryFn: () => getProviderReconciliation(displayAsset ? { ...month, asset: displayAsset } : month),
    enabled: explainOpen && !assetPending,
  });
  const classes = React.useMemo(() => foldClasses(rows), [rows]);
  const observedTake = React.useMemo(() => observedTakeRate(rows), [rows]);
  const recon = React.useMemo(
    () => (ledger.data ? fromLedger(ledger.data) : ledger.isError && calls.data ? fromExport(classes, observedTake) : null),
    [ledger.data, ledger.isError, calls.data, classes, observedTake],
  );
  /* The fee rate a passed-but-unpaid call's share is worked out at: the terms when read, else the one rate the paid calls realised. */
  const feeRatePercent =
    recon?.configuredRatePercent ?? (observedTake.rates.length === 1 ? Number(observedTake.rates[0]) : null);

  const payoutItems = (assetPending ? [] : payoutsInAsset(payouts.data?.items ?? [], displayAsset)).slice(0, 8);

  return (
    <>
      <header className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading-sm text-01 tablet:text-heading-md">Money</h1>
          <p className="text-body-13 text-03">Paid to your wallet, on chain, as each call settles. Nothing to withdraw.</p>
        </div>
        <Button
          variant="secondary"
          icon={<Download />}
          loading={calls.isFetching && !calls.data}
          disabled={!calls.data}
          onClick={() => {
            if (!calls.data) return;
            downloadCallsCsv(calls.data.csv, calls.data.filename, calls.meta);
            if (calls.meta && !calls.meta.truncated) {
              toast.success(`${monthName} CSV downloaded`, {
                description: `${callCount(calls.meta.rowCount)}, one row each. Check your downloads folder.`,
              });
            }
          }}
        >
          Download {monthName} CSV
        </Button>
      </header>
      {!calls.data && calls.isError ? (
        <p className="-mt-2 text-right text-body-xs text-03">The per-call file could not be prepared right now.</p>
      ) : null}

      <DisplayAssetSelect scope="provider" />

      {/* ── This month ─────────────────────────────────────────────── */}
      {earnings.isPending ? (
        <PageState kind="loading" rows={3} label="Loading this month's earnings" />
      ) : earnings.isError ? (
        <PageState kind="error" description="This month's earnings could not be loaded." onRetry={() => void earnings.refetch()} />
      ) : (
        <Panel className="w-full">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>{monthName}</PanelTitle>
              <PanelDescription>
                {callCount(earnings.data?.totals.calls ?? 0)} served this month
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="flex flex-col gap-4 p-4 tablet:p-5">
            <div className="flex flex-col gap-0.5">
              <span className="text-body-13 text-02">In your wallet this month</span>
              <span className="font-mono text-heading-md text-01">{formatMoney(split.inWallet, { decimals: 2 })}</span>
            </div>
            <MoneySplit
              segments={
                [
                  { label: "In your wallet", value: amountOf(split.inWallet), amount: formatMoney(split.inWallet, { decimals: 2 }), tone: "success" },
                  split.fee ? { label: "Assay fee", value: amountOf(split.fee), amount: formatMoney(split.fee, { decimals: 2 }), tone: "neutral" } : null,
                  split.notCredited
                    ? {
                        label: "Not credited",
                        note: `${callCount(split.notCreditedCalls)}, see below`,
                        value: amountOf(split.notCredited),
                        amount: formatMoney(split.notCredited, { decimals: 2 }),
                        tone: "danger",
                      }
                    : null,
                ].filter(Boolean) as MoneySplitSegment[]
              }
            />
            <dl className="grid grid-cols-1 gap-2 rounded-lg border border-01 bg-02 px-3.5 py-3 text-body-13 tablet:grid-cols-2 tablet:gap-4">
              <div className="flex flex-col gap-0.5">
                <dt className="text-02">Locked as stake</dt>
                <dd className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-mono-13 font-semibold text-01">
                    {stake.isLoading ? "…" : formatMoney(stake.staked, { decimals: 2 })}
                  </span>
                  <Link href={routes.stake()} className="text-body-xs text-03 underline underline-offset-2">
                    Still yours, not earnings. See Stake
                  </Link>
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-02">Taken by penalties, so far</dt>
                <dd className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-mono-13 font-semibold text-01">
                    {penalties.isLoading ? "…" : penalties.isError ? "Could not be read" : formatMoney(takenTotal, { decimals: 2 })}
                  </span>
                  <Link href={routes.penalties("closed")} className="text-body-xs text-03 underline underline-offset-2">
                    From your stake, not your earnings. See Penalties
                  </Link>
                </dd>
              </div>
            </dl>
            {/* Passed but not paid (yet): buyer debt, written off, forfeited. Never paid by the platform. */}
            {unpaid.length > 0 ? (
              <UnpaidBlock
                lines={unpaid}
                rows={calls.data ? rows : null}
                feeRatePercent={feeRatePercent}
                toolName={(id) => names.toolName(id) ?? "A tool no longer listed"}
              />
            ) : null}
          </PanelBody>
        </Panel>
      )}

      {/* ── Recent payments ───────────────────────────────────────── */}
      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Recent payments</PanelTitle>
            <PanelDescription>money sent to your wallet, each one a transaction you can check on the explorer</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-2">
          {payouts.isPending ? (
            <PageState kind="loading" rows={3} bare label="Loading payments" />
          ) : payouts.isError ? (
            <PageState kind="error" bare description="Your payments could not be loaded." onRetry={() => void payouts.refetch()} />
          ) : payoutItems.length === 0 ? (
            <PageState
              kind="empty"
              bare
              title="No payments yet"
              description="When a buyer's call to your tool is paid from their escrow, the payment shows up here with its transaction."
            />
          ) : (
            <ul className="flex flex-col">
              {payoutItems.map((payout) => (
                <PaymentRow key={payout.id} payout={payout} chains={chains} />
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>

      {/* ── Not credited ───────────────────────────────────────────── */}
      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Not credited this month</PanelTitle>
            <PanelDescription>
              {notCredited.calls > 0 ? `${callCount(notCredited.calls)} · ${formatMoney(notCredited.amount, { decimals: 2 })} · ` : ""}
              calls that earned nothing, by reason · no stake is taken for these
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="flex flex-col gap-2 p-3 tablet:p-4">
          {earnings.isPending ? (
            <PageState kind="loading" rows={2} bare label="Loading calls" />
          ) : notCredited.reasons.length > 0 ? (
            notCredited.reasons.map((bucket, index) => {
              const reason = notCreditedReason(bucket.className);
              const tools = toolsLine(bucket.toolIds, names.toolName, names.isPending);
              return (
                <div key={bucket.className} className="flex w-full flex-col gap-1 rounded-lg border border-01 bg-02 p-3.5 tablet:flex-row tablet:items-start tablet:gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-label-13 text-01">{reason.title}</p>
                    <p className="text-body-xs text-02">{reason.detail}</p>
                    {tools ? <p className="text-body-xs text-03">On {tools}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-baseline gap-3 tablet:flex-col tablet:items-end tablet:gap-0.5">
                    <span className="font-mono text-mono-sm font-semibold text-01">{formatMoney(reasonAmounts[index], { decimals: 2 })}</span>
                    <span className="text-body-xs text-03">{callCount(bucket.calls)}</span>
                  </div>
                </div>
              );
            })
          ) : !split.notCredited ? (
            <p className="px-1 py-3 text-body-13 text-02">
              {/* No calls is not "every call credited" (BUG-R17-P-02). */}
              {(earnings.data?.totals.calls ?? 0) === 0
                ? "No calls this month yet."
                : passedUnpaidCalls > 0
                  ? "No call failed this month."
                  : "Every call this month was credited."}
            </p>
          ) : (
            // A backend without the reasons: the earnings totals still say how much, per tool.
            (earnings.data?.groups ?? [])
              .filter((group) => group.withheldCalls > 0)
              .map((group) => (
                <div key={group.key} className="flex w-full items-center justify-between gap-3 rounded-lg border border-01 bg-02 p-3.5">
                  <span className="text-label-13 text-01">{names.toolName(group.key) ?? "A tool no longer listed"}</span>
                  <span className="text-body-xs text-03">
                    {callCount(group.withheldCalls)} · {formatMoney(group.withheld, { decimals: 2 })}
                  </span>
                </div>
              ))
          )}
          {passedUnpaidCalls > 0 ? (
            <p className="px-1 pt-1 text-body-xs text-03">
              Not listed here: {callCount(passedUnpaidCalls)} that passed but {passedUnpaidCalls === 1 ? "was" : "were"} not paid
              (overdue, or forfeited). See{" "}
              <a href="#passed-not-paid" className="underline underline-offset-2">
                Passed, but not paid
              </a>{" "}
              above.
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      {/* ── Check against your logs ───────────────────────────────── */}
      <Panel className="w-full">
        <PanelBody className="flex flex-col gap-3 p-4 tablet:flex-row tablet:items-center tablet:p-5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-label-13 text-01">Your logs say something different?</p>
            <p className="text-body-xs text-02">
              Every call in the CSV carries the call id we send you in the <code className="font-mono">X-Assay-Call-Id</code> header. Match it
              against your access log.
            </p>
          </div>
          <Button variant="secondary" icon={<HelpCircle />} onClick={() => setExplainOpen(true)}>
            Explain a difference
          </Button>
        </PanelBody>
      </Panel>

      <ExplainSheet
        open={explainOpen}
        onOpenChange={setExplainOpen}
        monthName={monthName}
        calls={earnings.data?.totals.calls ?? null}
        split={split}
        unpaid={unpaid}
        recon={recon}
        reconLoading={ledger.isPending && !ledger.isError}
        reconCapped={recon?.source === "export" && Boolean(calls.meta?.truncated)}
        loading={earnings.isPending}
        reasons={notCredited.reasons.map((bucket, index) => ({
          key: bucket.className,
          title: notCreditedReason(bucket.className).title,
          calls: bucket.calls,
          amount: reasonAmounts[index],
        }))}
      />
    </>
  );
}

function PaymentRow({ payout, chains }: { payout: ProviderPayout; chains: ReturnType<typeof useChains>["chains"] }) {
  const chainId = chainIdOfAsset(payout.amount.asset);
  const chain = chains.find((c) => c.chainId === chainId);
  // Only a real transaction gets a link: an unobserved redemption has no ref, and a ledger marker is not one.
  const txRef = isTransactionRef(payout.chainTxRef) ? payout.chainTxRef : null;
  const href = chain && txRef ? explorerTxUrl(chain, txRef) : null;
  return (
    <li className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-3 hover:bg-02">
      <span className="flex min-w-0 flex-1 flex-col">
        {payout.kind === "REDEMPTION" ? (
          <>
            {/* Rail B: the buyer's escrow paid this transaction on chain, for these calls. */}
            <span className="text-body-13 text-01">
              Paid for {payout.calls != null ? callCount(payout.calls) : "calls"} from the buyer&apos;s escrow
            </span>
            <span className="text-body-xs text-03">
              Sent to your wallet · <UtcTime value={payout.createdAt} />
            </span>
          </>
        ) : (
          <>
            {/* A payout run: the day of the run is what it is for. */}
            <span className="text-body-13 text-01">
              Payout for {payout.calls != null ? callCount(payout.calls) : "calls"} settled on <UtcTime value={payout.createdAt} dateOnly />
            </span>
            <span className="text-body-xs text-03">
              Sent to your wallet · <UtcTime value={payout.createdAt} />
            </span>
          </>
        )}
      </span>
      <span className="font-mono text-mono-13 font-semibold text-01">{formatMoney(payout.amount, { decimals: 2 })}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-36 items-center justify-end gap-1 text-label-xs text-primary-600 underline-offset-2 hover:underline"
        >
          View transaction <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      ) : (
        <span className="w-36 text-right text-body-xs text-03">
          {payout.kind === "REDEMPTION" || payout.chainTxRef ? "Sent on chain" : "Being sent"}
        </span>
      )}
    </li>
  );
}

/** A line's total: normal money format, a sub-cent amount still shows its own digits. */
const unpaidMoney = (value: Money | null | undefined) => formatMoney(value, { decimals: 2 });
/** One call in a drill-down: a per-call price, so up to four places ("$0.405"), trailing zeros dropped. */
const unpaidCallMoney = (value: Money | null | undefined) => formatMoney(value, { decimals: 4 });

/**
 * "Passed, but not paid": one row per way a passed call can pay the provider
 * nothing (yet), each with its amount and calls, why in one sentence, and what
 * the provider can do. The calls behind a row open from the per-call file.
 */
function UnpaidBlock({
  lines,
  rows,
  feeRatePercent,
  toolName,
}: {
  lines: readonly UnpaidLine[];
  /** The month's per-call rows in the shown asset, or null when the file is not available. */
  rows: readonly CallRow[] | null;
  /** Assay's fee in percent, when one rate is known: a call's share is worked out at it. */
  feeRatePercent: number | null;
  toolName: (toolId: string) => string;
}) {
  return (
    <section
      id="passed-not-paid"
      aria-labelledby="passed-not-paid-title"
      data-testid="provider-unpaid"
      className="flex scroll-mt-20 flex-col rounded-lg border border-01"
    >
      <div className="flex flex-col gap-0.5 border-b border-01 px-3.5 py-3">
        <h2 id="passed-not-paid-title" className="text-label-13 text-01">
          Passed, but not paid
        </h2>
        <p className="text-body-xs text-03">Not in your wallet figure. You are paid only from the buyer&apos;s escrow, never by Assay.</p>
        <p className="text-body-xs text-03" data-testid="provider-unpaid-basis">
          Amounts are your share: the listed price less Assay&apos;s {feeRatePercent != null ? `${feeRatePercent}% ` : ""}fee,
          which would come off if the payment were collected. No fee has been taken on them.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-01">
        {lines.map((line) => (
          <UnpaidRow key={line.key} line={line} rows={rows} feeRatePercent={feeRatePercent} toolName={toolName} />
        ))}
      </ul>
    </section>
  );
}

function UnpaidRow({
  line,
  rows,
  feeRatePercent,
  toolName,
}: {
  line: UnpaidLine;
  rows: readonly CallRow[] | null;
  feeRatePercent: number | null;
  toolName: (toolId: string) => string;
}) {
  const drill = rows ? callsOfClass(rows, line.className) : null;
  const ActionIcon = line.actionable ? TriangleAlert : Info;
  return (
    <li className="flex flex-col gap-1.5 px-3.5 py-3" data-testid={`provider-unpaid-${line.key}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-label-13 text-01">{line.label}</span>
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-mono-13 font-semibold text-01">{unpaidMoney(line.amount)}</span>
          <span className="text-body-xs text-03">{callCount(line.calls)}</span>
        </span>
      </div>
      <p className="text-body-xs text-02">{line.reason}</p>
      <p className={cn("flex items-start gap-1.5 text-body-xs", line.actionable ? "text-warning-700" : "text-03")}>
        <ActionIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        <span>
          {line.action}
          {line.key === "forfeited" ? (
            <>
              {" "}
              <Link href={routes.stake()} className="font-medium underline underline-offset-2">
                Check your stake
              </Link>
            </>
          ) : null}
        </span>
      </p>
      {drill && drill.total > 0 ? (
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-label-xs text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-90" />
            {drill.total === 1 ? "Show the call" : `Show the ${drill.total.toLocaleString("en-US")} calls`}
          </summary>
          <ul className="mt-2 flex flex-col divide-y divide-01 rounded-md border border-01 bg-02">
            {drill.items.map((call) => {
              const worth = unpaidCallAmount(call, feeRatePercent);
              return (
              <li key={call.callId} className="flex flex-col gap-0.5 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body-xs text-01">
                    <span className="font-medium">{toolName(call.toolId)}</span>
                    <UtcTime value={call.createdAt} className="text-03" />
                    <CopyChip value={call.callId} label="call id" />
                  </span>
                  <span className="font-mono text-mono-12 text-01">
                    {unpaidCallMoney(worth.amount)}
                    {worth.note ? <span className="ml-1 font-sans text-body-xs text-03">{worth.note}</span> : null}
                  </span>
                </div>
                {call.reason ? <span className="text-body-xs text-03">{reasonLabel(call.reason)}</span> : null}
              </li>
              );
            })}
          </ul>
          {drill.more > 0 ? (
            <p className="mt-1.5 text-body-xs text-03">
              And {callCount(drill.more)} more in this month&apos;s CSV (the <code className="font-mono">classification</code> column
              reads <code className="font-mono">{line.className}</code>).
            </p>
          ) : null}
        </details>
      ) : null}
    </li>
  );
}

function ExplainSheet({
  open,
  onOpenChange,
  monthName,
  calls,
  split,
  unpaid,
  recon,
  reconLoading,
  reconCapped,
  reasons,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monthName: string;
  calls: number | null;
  split: EarningsSplit;
  unpaid: readonly UnpaidLine[];
  recon: ReconSummary | null;
  reconLoading: boolean;
  reconCapped: boolean;
  reasons: { key: string; title: string; calls: number; amount: Money | null }[];
  loading: boolean;
}) {
  const lines: { label: string; detail?: string; amount: string }[] = [
    { label: "Paid to your wallet", amount: formatMoney(split.inWallet, { decimals: 2 }) },
    ...(split.fee ? [{ label: "Assay fee", detail: "taken from each paid call", amount: formatMoney(split.fee, { decimals: 2 }) }] : []),
    ...(split.notCredited
      ? [{ label: "Not credited", detail: callCount(split.notCreditedCalls), amount: formatMoney(split.notCredited, { decimals: 2 }) }]
      : []),
    // Passed, but not paid (yet): never part of the wallet figure, never paid by the platform.
    ...unpaid.map((line) => ({
      label: line.label,
      detail: `${callCount(line.calls)} · your share, not in your wallet`,
      amount: unpaidMoney(line.amount),
    })),
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Explain a difference</SheetTitle>
          <SheetDescription>How the calls you served in {monthName} turned into money, and how to match them to your logs.</SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-5 overflow-y-auto px-[18px] pb-6 pt-4 text-body-13 text-02">
          <section className="flex flex-col gap-2">
            <h3 className="text-label-13 text-01">
              {monthName}
              {calls !== null ? `: ${callCount(calls)} served` : ""}
            </h3>
            {loading ? (
              <PageState kind="loading" rows={3} bare label="Loading this month" />
            ) : (
              <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01">
                {lines.map((line) => (
                  <li key={line.label} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1 text-01">{line.label}</span>
                    {line.detail ? <span className="text-body-xs text-03">{line.detail}</span> : null}
                    <span className="w-20 text-right font-mono text-mono-12 text-01">{line.amount}</span>
                  </li>
                ))}
              </ul>
            )}
            {reasons.length > 0 ? (
              <>
                <p className="pt-1 text-label-xs text-02">Not credited, by reason</p>
                <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01">
                  {reasons.map((reason) => (
                    <li key={reason.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <span className="min-w-0 flex-1 text-01">{reason.title}</span>
                      <span className="text-body-xs text-03">{callCount(reason.calls)}</span>
                      <span className="w-20 text-right font-mono text-mono-12 text-01">{formatMoney(reason.amount, { decimals: 2 })}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className="text-body-xs text-03">The rest of the calls were free calls or are still being checked; they earn nothing yet.</p>
          </section>
          <ReconSection recon={recon} loading={reconLoading} capped={reconCapped} />
          <section className="flex flex-col gap-2">
            <h3 className="text-label-13 text-01">Why your count and ours can differ</h3>
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              <li>Free calls and test calls are served but earn nothing.</li>
              <li>A call whose answer fails Assay&apos;s check is not charged to the buyer, so it is not credited to you.</li>
              <li>Calls still being checked are credited when the check finishes, usually within a minute.</li>
              <li>Retries: if your API failed and Assay tried another provider, you see the request but no payment.</li>
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-label-13 text-01">Match a call</h3>
            <p>
              Download the CSV, then look up each <code className="font-mono">call_id</code> in your access log by the{" "}
              <code className="font-mono">X-Assay-Call-Id</code> request header. A call in your log but not in the CSV never reached
              settlement; a call in the CSV but not in your log never reached your API.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Every call this month by outcome, with the settlement that adds up:
 * Gross − Assay fee = Net = the total of the amounts per outcome. From the
 * ledger, which counts every call; from the per-call file only when the ledger
 * cannot be read, and then said when the file is capped. Only outcomes with
 * calls get a row; the ways a passed call can go unpaid are named once when
 * none happened, so a provider still learns they exist.
 */
/** How an empty always-explained class reads in "No calls this month were …". */
const EMPTY_CLASS_WORDS: Record<string, string> = {
  PAID_BUYER_DEBT: "waiting on the buyer",
  PAID_UNCOLLECTED: "overdue",
  PROVIDER_FORFEITED: "forfeited",
};

/** The classes that passed but paid the provider nothing (yet): no amount reached the wallet. */
const UNPAID_CLASSES: ReadonlySet<string> = new Set(["PAID_BUYER_DEBT", "PAID_UNCOLLECTED", "PROVIDER_FORFEITED"]);

function ReconSection({ recon, loading, capped }: { recon: ReconSummary | null; loading: boolean; capped: boolean }) {
  if (loading) return <PageState kind="loading" rows={3} bare label="Loading every call this month" />;
  if (!recon) return null;
  const take = takeCopy(recon);
  /* Rounded once, from cents: the shown fee and net add up to the shown gross. */
  const settlement = recon.take ? settlementShown(recon.net, recon.take) : { gross: recon.gross, fee: null, net: recon.net };
  return (
    <section className="flex flex-col gap-2" data-testid="provider-reconciliation">
      <h3 className="text-label-13 text-01">Every call, by outcome: {callCount(recon.totalCalls)}</h3>
      {capped ? (
        <p className="text-body-xs text-warning-700">
          The month&apos;s totals could not be read, so these are counted from the per-call file, which is capped: they cover
          only the calls in the file, not the whole month.
        </p>
      ) : null}
      {recon.rows.length > 0 ? (
        <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01">
          {recon.rows.map((row) => {
            const note = classNote(row.className, row.note);
            return (
              <li key={row.className} className="flex flex-col gap-0.5 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 text-01">{classLabel(row.className)}</span>
                  <span className="shrink-0 text-body-xs text-03">
                    {callCount(row.calls)} · {(row.share * 100).toFixed(1)}%
                  </span>
                  {UNPAID_CLASSES.has(row.className) ? (
                    // Nothing reached the provider yet: "$0.00" here would read as money lost. The amount is under Passed, but not paid.
                    <span className="w-20 shrink-0 text-right text-body-xs text-03">not paid</span>
                  ) : (
                    <span className="w-20 shrink-0 text-right font-mono text-mono-12 text-01">{formatMoney(row.credited, { decimals: 2 })}</span>
                  )}
                </div>
                {note ? <span className="text-body-xs text-03">{note}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {recon.emptyClasses.length > 0 ? (
        <p className="text-body-xs text-03" data-testid="provider-reconciliation-none">
          No calls this month were {recon.emptyClasses.map((name) => EMPTY_CLASS_WORDS[name] ?? classLabel(name)).join(", or ")}.
        </p>
      ) : null}
      <p className="text-body-xs text-03">
        The amounts are what reached you, after Assay&apos;s fee. Calls that passed but were not paid are not in Gross: nothing
        was collected on them (their amounts are in the table above).
      </p>
      <dl className="flex flex-col divide-y divide-01 rounded-lg border border-01">
        {[
          { label: "Gross", note: "Price of the paid calls, before Assay's fee.", amount: formatMoney(settlement.gross, { decimals: 2 }), tone: "neutral" },
          { label: take.label, note: take.note, amount: settlement.fee ? `−${formatMoney(settlement.fee, { decimals: 2 })}` : "—", tone: take.tone },
          { label: "Net", note: "Gross minus the fee: what reached your wallet.", amount: formatMoney(settlement.net, { decimals: 2 }), tone: "neutral" },
        ].map((line) => (
          <div key={line.label} className="flex items-start justify-between gap-3 px-3 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col">
              <dt className="text-01">{line.label}</dt>
              <span
                className={cn(
                  "flex items-start gap-1 text-body-xs",
                  line.tone === "warning" ? "text-warning-700" : line.tone === "success" ? "text-success-700" : "text-03",
                )}
              >
                {line.tone === "warning" ? <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" /> : null}
                {line.note}
              </span>
            </div>
            <dd className="w-20 text-right font-mono text-mono-12 text-01">{line.amount}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
