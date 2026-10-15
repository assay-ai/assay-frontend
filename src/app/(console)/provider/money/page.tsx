"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, HelpCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { DisplayAssetSelect, useDisplayAsset } from "@/components/display-asset-select";
import { LocalTime } from "@/components/patterns/local-time";
import { MoneySplit, type MoneySplitSegment } from "@/components/patterns/money-flow";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { foldClasses, foldNotCredited, rowsInAsset } from "@/features/call-classes/csv";
import { classLabel } from "@/features/call-classes/labels";
import { downloadCallsCsv, useCallsExport } from "@/features/call-classes/use-calls-export";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { earningsSplit } from "@/features/provider-earnings/earned-tile";
import { notCreditedReason } from "@/features/provider-earnings/not-credited";
import { useChains } from "@/hooks/useChains";
import type { Money, ProviderPayout } from "@/interfaces";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { listProviderPayouts, payoutsInAsset } from "@/services/provider-payouts.service";
import { getProviderEarnings } from "@/services/provider-reports.service";
import { chainIdOfAsset } from "@/utils/chain";
import { formatMoney, toDecimal } from "@/utils/money";

/**
 * Money — "how much did I earn, and is it in my wallet?"
 *
 *  - This month: earned, as a split (in your wallet / Assay's fee / not
 *    credited). An amount that could not be collected from a buyer is named,
 *    never shown as "owed": nothing pays it out yet (business #13).
 *  - Recent payments: one row per payment with its transaction on the explorer.
 *  - Not credited, grouped by plain reason (from the per-call export), with
 *    the tools it happened on.
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
  const { chains } = useChains();
  const { current: displayAsset, isPending: assetPending } = useDisplayAsset("provider");

  const rows = React.useMemo(() => (assetPending ? [] : rowsInAsset(calls.rows, displayAsset)), [calls.rows, assetPending, displayAsset]);
  const notCredited = React.useMemo(() => foldNotCredited(rows), [rows]);
  const split = earningsSplit(earnings.data?.totals);
  const monthName = MONTH.format(now);

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
          onClick={() => calls.data && downloadCallsCsv(calls.data.csv, calls.data.filename, calls.meta)}
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
                {(earnings.data?.totals.calls ?? 0).toLocaleString("en-US")} calls served this month
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
                        note: `${split.notCreditedCalls} call${split.notCreditedCalls === 1 ? "" : "s"}, see below`,
                        value: amountOf(split.notCredited),
                        amount: formatMoney(split.notCredited, { decimals: 2 }),
                        tone: "danger",
                      }
                    : null,
                ].filter(Boolean) as MoneySplitSegment[]
              }
            />
            {split.uncollected ? (
              <p className="text-body-xs text-03">
                {formatMoney(split.uncollected, { decimals: 2 })} for {split.uncollectedCalls} call
                {split.uncollectedCalls === 1 ? "" : "s"} could not be collected from the buyer, so it is not in your wallet and not
                counted above.
              </p>
            ) : null}
          </PanelBody>
        </Panel>
      )}

      {/* ── Recent payments ───────────────────────────────────────── */}
      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Recent payments</PanelTitle>
            <PanelDescription>each one is a transaction you can check on the explorer</PanelDescription>
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
              description="When a buyer's call to your tool settles, the payment shows up here with its transaction."
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
            <PanelDescription>calls that earned nothing, by reason · no stake is taken for these</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="flex flex-col gap-2 p-3 tablet:p-4">
          {calls.isPending ? (
            <PageState kind="loading" rows={2} bare label="Loading calls" />
          ) : calls.data && notCredited.buckets.length > 0 ? (
            notCredited.buckets.map((bucket) => {
              const reason = notCreditedReason(bucket.className);
              const tools = [...new Set(rows.filter((r) => r.classification === bucket.className).map((r) => r.toolId))];
              return (
                <div key={bucket.className} className="flex w-full flex-col gap-1 rounded-lg border border-01 bg-02 p-3.5 tablet:flex-row tablet:items-start tablet:gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="text-label-13 text-01">{reason.title}</p>
                    <p className="text-body-xs text-02">{reason.detail}</p>
                    {tools.length > 0 ? (
                      <p className="text-body-xs text-03">On {tools.map((tool) => names.toolName(tool) ?? "a tool").join(", ")}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-baseline gap-3 tablet:flex-col tablet:items-end tablet:gap-0.5">
                    <span className="font-mono text-mono-sm font-semibold text-01">{formatMoney(bucket.notCredited, { decimals: 2 })}</span>
                    <span className="text-body-xs text-03">
                      {bucket.calls} call{bucket.calls === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              );
            })
          ) : calls.data || !split.notCredited ? (
            <p className="px-1 py-3 text-body-13 text-02">Every call this month was credited.</p>
          ) : (
            // The per-call file is unavailable: the earnings totals still say how much, per tool.
            (earnings.data?.groups ?? [])
              .filter((group) => group.withheldCalls > 0)
              .map((group) => (
                <div key={group.key} className="flex w-full items-center justify-between gap-3 rounded-lg border border-01 bg-02 p-3.5">
                  <span className="text-label-13 text-01">{names.toolName(group.key) ?? "A tool"}</span>
                  <span className="text-body-xs text-03">
                    {group.withheldCalls} calls · {formatMoney(group.withheld, { decimals: 2 })}
                  </span>
                </div>
              ))
          )}
        </PanelBody>
      </Panel>

      {/* ── Check against your logs ───────────────────────────────── */}
      <Panel className="w-full">
        <PanelBody className="flex flex-col gap-3 p-4 tablet:flex-row tablet:items-center tablet:p-5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-label-13 text-01">Your logs say something different?</p>
            <p className="text-body-xs text-02">
              Every call in the CSV carries the call id we send you in the <code className="font-mono">X-X402-Call-Id</code> header. Match it
              against your access log.
            </p>
          </div>
          <Button variant="secondary" icon={<HelpCircle />} onClick={() => setExplainOpen(true)}>
            Explain a difference
          </Button>
        </PanelBody>
      </Panel>

      <ExplainSheet open={explainOpen} onOpenChange={setExplainOpen} rows={rows} loading={calls.isPending} />
    </>
  );
}

function PaymentRow({ payout, chains }: { payout: ProviderPayout; chains: ReturnType<typeof useChains>["chains"] }) {
  const chainId = chainIdOfAsset(payout.amount.asset);
  const chain = chains.find((c) => c.chainId === chainId);
  const href = chain && payout.chainTxRef ? explorerTxUrl(chain, payout.chainTxRef) : null;
  return (
    <li className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-3 hover:bg-02">
      <LocalTime value={payout.createdAt} className="min-w-0 flex-1 text-body-13 text-02" />
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
        <span className="w-36 text-right text-body-xs text-03">{payout.chainTxRef ? "On chain" : "Being sent"}</span>
      )}
    </li>
  );
}

function ExplainSheet({
  open,
  onOpenChange,
  rows,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: ReturnType<typeof rowsInAsset>;
  loading: boolean;
}) {
  const table = foldClasses(rows);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Explain a difference</SheetTitle>
          <SheetDescription>How the calls you served this month turned into money, and how to match them to your logs.</SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-5 overflow-y-auto px-[18px] pb-6 pt-4 text-body-13 text-02">
          <section className="flex flex-col gap-2">
            <h3 className="text-label-13 text-01">Your calls this month, by outcome</h3>
            {loading ? (
              <PageState kind="loading" rows={3} bare label="Loading calls" />
            ) : table.buckets.length === 0 ? (
              <p>No calls this month yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01">
                {table.buckets.map((bucket) => (
                  <li key={bucket.className} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1 text-01">{classLabel(bucket.className)}</span>
                    <span className="text-body-xs text-03">{bucket.calls} calls</span>
                    <span className="w-20 text-right font-mono text-mono-12 text-01">
                      {bucket.credited ? formatMoney(bucket.credited, { decimals: 2 }) : "$0.00"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
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
              <code className="font-mono">X-X402-Call-Id</code> request header. A call in your log but not in the CSV never reached
              settlement; a call in the CSV but not in your log never reached your API.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
