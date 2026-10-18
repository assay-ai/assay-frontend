"use client";

import { DisplayAssetSelect, useDisplayAssetPick } from "@/components/display-asset-select";
import { ChartNoAxesColumn, ChevronRight, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { WalletSetupBanner } from "@/components/auth/wallet-setup-banner";
import { ALERT_ICON, presentAlert, useAlertLimitContext, useMarkAlertsRead } from "@/components/layout/alert-entry";
import { AgentHealthList } from "@/components/buyer-money/agent-health";
import { GetStarted, useGetStartedShown } from "@/components/buyer-money/get-started";
import { useFreeOnlyChain } from "@/components/buyer-money/use-buyer-money";
import { Button } from "@/components/ui/button";
import { EntityName } from "@/components/patterns/entity-name";
import { UtcTime } from "@/components/patterns/utc-time";
import { PageState, Skeleton, SkeletonRows } from "@/components/patterns/page-state";
import { StatusChip } from "@/components/patterns/status-chip";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { MetricTile } from "@/components/ui/metric-tile";
import { capSeries, StackedBarChart, type ChartSeries } from "@/components/ui/stacked-bar-chart";
import {
  axisLabel,
  formatAge,
  formatCount,
  isZeroMoney,
  monthPeriod,
  sharePercent,
  trendIsUp,
  trendLabel,
} from "@/features/buyer/period";
import { callPaymentNote, heldCallsText } from "@/features/buyer-debt/debt-copy";
import { OwedRowAction } from "@/features/buyer-debt/owed-row-action";
import { useOwedIntentIds } from "@/features/buyer-debt/use-owed-intent-ids";
import { isWalletNotLinked } from "@/features/auth/wallet-link";
import { attentionRows } from "@/features/buyer/alert-model";
import { callOutcome } from "@/features/buyer/call-outcome";
import { absentBalanceTile, overviewBalance, singleBalanceSub } from "@/features/buyer/overview-balance";
import { ATTENTION_SHOWN, useOverview } from "@/features/buyer/use-overview";
import type { FullBalance } from "@/features/g30/balance";
import { useChainName } from "@/hooks/useChainName";
import { useEntityNames } from "@/hooks/useEntityNames";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { formatMoney, notCharged, toDecimal } from "@/utils/money";
import { toast } from "@/utils/toast";

/**
 * Overview (desktop design, with tablet 834 and mobile 390 variants).
 *
 * The daily glance: balance, what today cost, what was NOT charged, and what
 * needs a decision. Two panels the design draws are not here and one panel the
 * design does not draw is — both are deliberate:
 * "Free quota" has no endpoint to read a quota or a ceiling from, and "Recent
 * calls" is required by this goal and has nowhere else on the screen to live.
 *
 * The header says the figures update every 30s, so they do — that sentence is
 * a promise, not decoration.
 */

const REFRESH_MS = 30_000;

function HoldFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <p className="text-body-13 text-03">{label}</p>
      <p className="truncate font-mono text-mono-xl text-01">{value}</p>
    </div>
  );
}

export default function OverviewPage() {
  const anchor = useMemo(() => new Date(), []);
  const assetPick = useDisplayAssetPick();
  const { data, loading, error, reload } = useOverview(anchor, assetPick);
  const names = useEntityNames({ kinds: ["tool"] });
  const chainName = useChainName();
  // While Get started is on screen its step is the next thing to do, so the
  // header's "Add funds" steps back to a secondary button.
  const gettingStarted = useGetStartedShown();
  // Free calls only on this chain: no deposit is possible, so no "Add funds".
  const freeOnly = useFreeOnlyChain();
  // The month is a fact about the calendar, not about the response, so the
  // tile labels stay correct even when every request failed.
  const monthLabel = useMemo(() => monthPeriod(anchor).label, [anchor]);

  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  /*
    Was `data?.balance ?? null`, fed by `balances.balances?.[0]` — the tile that
    answered "how much money do I have" with one chain's figure and no sign the
    other existed.

    The tile has one slot and there is no honest single number across two
    chains, so on two it stops being a figure and becomes a count plus a route
    to Funding, where the per-chain cards are. `balance` stays non-null ONLY in
    the single case; every consumer below already guards on it, so the multiple
    case degrades to the same shape as "could not read" for the held/scale
    lines rather than inventing a combined figure.
  */
  const balanceState = useMemo(
    // Memoized so the React Compiler can still prove the `ticks` useMemo below:
    // a freshly constructed object each render reads to it as a value that may
    // be mutated later, and `decimals`/`asset` hang off this one.
    () => overviewBalance((data?.balances ?? []) as readonly FullBalance[]),
    [data?.balances],
  );
  const balance = balanceState.kind === "single" ? balanceState.balance : null;
  const openHolds = (data?.holds ?? []).filter((h) => h.status === "OPEN");
  const owedIntentIds = useOwedIntentIds();
  const oldestHold = openHolds.reduce((max, h) => Math.max(max, h.ageSeconds), 0);

  // Needs attention: unread alerts, the same alert raised twice in a minute
  // as one, and an alert whose cause has cleared (free calls reset, balance
  // back above its line) left out. Leaving one out is display only: it stays
  // unread and is still in the bell and "See all alerts". Dismiss marks every
  // copy read; a copy whose request failed comes back.
  const limits = useAlertLimitContext();
  const markRead = useMarkAlertsRead();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const attention = useMemo(
    () =>
      attentionRows(data?.notifications ?? [], {
        // The page's opening time: a reset after it shows the alert until the next visit (never the reverse).
        now: anchor.getTime(),
        balances: data ? (data.balances as readonly FullBalance[]) : null,
        dismissed,
        complete: data?.notificationsComplete ?? false,
        shown: ATTENTION_SHOWN,
      }),
    [anchor, data, dismissed],
  );
  const notifications = attention.shown;
  // "Nothing needs your attention" only when the unread list was read to its end and nothing is left.
  const nothingNeedsYou = notifications.length === 0 && !attention.more;
  const dismiss = (group: (typeof notifications)[number]) => {
    setDismissed((prev) => new Set([...prev, ...group.ids]));
    markRead.mutate(group.ids, {
      onSuccess: (failed) => {
        if (failed.length === 0) return;
        setDismissed((prev) => new Set([...prev].filter((id) => !failed.includes(id))));
        toast.error("It could not be dismissed. Try again in a moment.");
      },
      onError: () => {
        setDismissed((prev) => new Set([...prev].filter((id) => !group.ids.includes(id))));
        toast.error("It could not be dismissed. Try again in a moment.");
      },
    });
  };

  const withheldAmount = data?.withheld?.withheld.amount ?? null;
  const withheldCalls = data?.withheld?.withheld.calls ?? 0;
  const withheldShare = sharePercent(withheldAmount, data?.monthListed ?? null);
  const nothingWithheld = isZeroMoney(withheldAmount);

  const trend = trendLabel(data?.todayCharged ?? null, data?.yesterdayCharged ?? null, "vs yesterday");
  const trendUp = trendIsUp(data?.todayCharged ?? null, data?.yesterdayCharged ?? null);

  const { series, bars, scaleMax } = useMemo(() => {
    const tools = data?.chartTools ?? [];
    const rawSeries: ChartSeries[] = tools.map((id, i) => ({
      key: id,
      label: names.name("tool", id),
      tone: ((i % 6) + 1) as ChartSeries["tone"],
    }));
    const rawBars = (data?.chart ?? []).map((d) => ({ label: axisLabel(d.key), values: d.byTool }));
    const capped = capSeries(rawSeries, rawBars, 3);
    const max = Math.max(
      0,
      ...capped.bars.map((b) => Object.values(b.values).reduce((a, v) => a + v, 0)),
    );
    return { ...capped, scaleMax: max };
  }, [data?.chart, data?.chartTools, names]);

  // A new or quiet account: no spend in the chart, nothing on hold, no calls.
  // The three empty panels fold into one line instead of three "nothing yet"s.
  const nothingYet = Boolean(data) && scaleMax === 0 && openHolds.length === 0 && (data?.recentCalls.length ?? 0) === 0;
  // "Explore spend" waits for something to explore.
  const hasSpend =
    Boolean(data) &&
    (scaleMax > 0 || !isZeroMoney(data?.monthListed ?? null) || (data?.recentCalls ?? []).some((call) => !isZeroMoney(call.charged)));

  const decimals = balance?.decimals ?? 6;
  const asset = balance?.asset ?? "";
  const ticks = useMemo(() => {
    if (scaleMax <= 0) return [];
    return [1, 2 / 3, 1 / 3, 0].map((f) =>
      formatMoney(
        { amount: String(Math.round(scaleMax * f * 10 ** decimals)), asset, decimals },
        { decimals: 2 },
      ),
    );
  }, [scaleMax, decimals, asset]);

  return (
    <div className="flex w-full flex-col gap-3.5 bg-02 px-4 py-4 tablet:gap-4 tablet:p-6 desktop:gap-5 desktop:px-7 desktop:py-6">
      <header className="flex w-full flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Overview</h1>
          <p className="text-body-13 text-03">Your money, today&apos;s spend and anything that needs you. Updates every 30 seconds.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {hasSpend ? (
            <Button variant="secondary" asChild>
              <Link href="/spend">
                <ChartNoAxesColumn className="size-[15px]" />
                Explore spend
              </Link>
            </Button>
          ) : null}
          {freeOnly.freeOnly ? (
            <span
              data-testid="overview-free-only"
              className="inline-flex items-center rounded-full bg-teal-10 px-3 py-1.5 text-label-13 text-teal-700"
            >
              Free calls only on {freeOnly.chainName ?? "this chain"}
            </span>
          ) : (
            <Button variant={gettingStarted ? "secondary" : "primary"} asChild>
              <Link href="/funding?action=deposit">
                <Plus className="size-[15px]" />
                Add funds
              </Link>
            </Button>
          )}
        </div>
      </header>

      <DisplayAssetSelect live />

      {/* Get started (until the first paid call is possible) and each agent's health: owned by buyer-money. */}
      <GetStarted placement="overview" />
      <AgentHealthList />

      {/* A brand-new account's first requests fail for one specific, temporary
          reason — Privy records the wallet after issuing the token — and that
          is not a fault to report in red. See `features/auth/wallet-link.ts`. */}
      {isWalletNotLinked(error) ? <WalletSetupBanner onLinked={reload} /> : null}

      {error && !isWalletNotLinked(error) ? (
        <PageState
          kind="error"
          title="The overview could not be loaded"
          description={plainError(error.code)}
          onRetry={reload}
          code={error.code}
          details={error.message}
        />
      ) : null}

      {loading && !data ? <OverviewSkeleton /> : null}

      {/* Foundations > Breakpoints, row "Metric tiles": 1 column at 390 with the
          two HEADLINE figures — balance and not charged — full width and the
          secondary pair 2-across; 2 columns at 834; 4 at 1440. */}
      {loading && !data ? null : (
      <>
      <section className="grid w-full grid-cols-2 gap-3 tablet:grid-cols-2 tablet:gap-3.5 desktop:grid-cols-3 desktop:gap-4">
        <MetricTile
          className="order-1 col-span-2 tablet:col-span-1"
          label="Balance"
          // An em-dash only when the balance could not be read: a zero balance
          // and an unread one are different facts. An account with no balance
          // yet (nothing deposited) has $0.00.
          value={
            balanceState.kind === "single"
              ? formatMoney(balanceState.balance.available)
              : balanceState.kind === "multiple"
                ? `${balanceState.chainCount} chains`
                : absentBalanceTile(Boolean(data), freeOnly).value
          }
          sub={
            balanceState.kind === "single"
              ? singleBalanceSub(balanceState.balance)
              : balanceState.kind === "multiple"
                ? ((data?.balances ?? []) as readonly FullBalance[])
                    .map((b) => `${formatMoney(b.available)} on ${chainName(b.chainId)}`)
                    .join(" · ")
                : absentBalanceTile(Boolean(data), freeOnly).sub
          }
          meta={
            balance
              ? `${formatMoney(balance.held)} held · ${heldCallsText(
                  openHolds.map((h) => h.intentId),
                  owedIntentIds,
                  { short: true },
                )}`
              : undefined
          }
        />

        <MetricTile
          className="order-2 col-span-2 tablet:col-span-1 desktop:order-3"
          tone="teal"
          label={`Not charged · ${monthLabel}`}
          // A real zero is "$0.00"; "—" is kept for a figure that could not be read.
          value={!data ? "—" : nothingWithheld ? formatMoney(null) : formatMoney(withheldAmount)}
          sub={
            !data
              ? "not available"
              : nothingWithheld
                ? isZeroMoney(data.monthListed)
                  ? "no paid calls yet this month"
                  : "every paid call passed its check"
                : `${formatCount(withheldCalls)} ${withheldCalls === 1 ? "call" : "calls"}`
          }
          meta={
            nothingWithheld
              ? "A call whose result fails its check is not charged: the hold is released, so your balance never moves. This is where you see it."
              : `${withheldShare ?? "—"} of ${formatMoney(data?.monthListed ?? null)} listed this month`
          }
        />

        <MetricTile
          // Alone on its row below desktop width, so it takes the whole row.
          className="order-3 col-span-2 desktop:order-2 desktop:col-span-1"
          label="Spent today"
          value={data ? formatMoney(data.todayCharged) : "—"}
          sub={
            data
              ? // The UTC day, the one the rows below call "Today": say so.
                // The count is the charged calls, the same calls as the amount; an owed one is named apart.
                `${formatCount(data.todayCalls)} ${data.todayCalls === 1 ? "call" : "calls"} since 00:00 UTC${
                  data.todayOwed
                    ? ` · ${data.todayOwedCalls > 0 ? `${formatCount(data.todayOwedCalls)} owed` : "owed"} (${formatMoney(data.todayOwed)}), not collected`
                    : ""
                }`
              : "not available"
          }
          meta={trend ?? undefined}
          metaTone={trendUp ? "warning" : "default"}
        />

        {/* "Compensation received" is not drawn: no endpoint reports a buyer's
            share of a penalty yet, and a tile that can only say "—" is noise. */}
      </section>

      {nothingYet ? (
        <Panel className="w-full" data-testid="overview-nothing-yet">
          <PanelBody className="flex-row flex-wrap items-center gap-3 px-4 py-4 tablet:px-5">
            <p className="min-w-0 flex-1 text-body-13 text-02">
              <span className="text-label-13 text-01">No calls yet.</span> Spend, money on hold and recent calls appear here
              after your agent&apos;s first call. {nothingNeedsYou ? "Nothing needs your attention." : null}
            </p>
            {/* An empty call list helps nobody: the way to a first call is Get started's step 2. */}
            <Button variant="ghost" size="sm" asChild>
              <Link href="/onboarding?step=call">Make a first call</Link>
            </Button>
          </PanelBody>
        </Panel>
      ) : null}

      <section className={nothingYet && nothingNeedsYou ? "hidden" : "flex w-full flex-col gap-3.5 desktop:flex-row desktop:gap-4"}>
        <Panel className={nothingYet ? "hidden" : "order-2 min-w-0 flex-1 tablet:order-1"}>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Spend, last 7 days</PanelTitle>
              <PanelDescription>Grouped by tool · charged amounts, holds excluded</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="p-4 tablet:p-[18px] desktop:p-5">
            {scaleMax > 0 ? (
              <StackedBarChart
                caption="Charged spend per day, grouped by tool"
                series={series}
                bars={bars}
                ticks={ticks}
                scaleMax={scaleMax}
              />
            ) : (
              <EmptyState
                className="max-w-none border-0 bg-transparent p-0"
                title="No spend in the last 7 days"
                description="Charged amounts appear here as calls settle. Holds are excluded — a hold is reserved, not spent."
              />
            )}
          </PanelBody>
        </Panel>

        <Panel className="order-1 tablet:order-2 desktop:w-[440px] desktop:shrink-0">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Needs attention</PanelTitle>
              <PanelDescription>
                {attention.countLabel}
              </PanelDescription>
            </PanelTitles>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/alerts?view=recent">See all alerts</Link>
            </Button>
          </PanelHeader>
          <PanelBody>
            {nothingNeedsYou ? (
              <p className="px-5 py-4 text-body-sm text-02">Nothing needs your attention.</p>
            ) : notifications.length === 0 ? (
              <MoreAlerts />
            ) : (
              notifications.map((group, i) => {
                const { note } = group;
                const { title, action } = presentAlert(note, limits);
                return (
                  <div
                    key={note.id}
                    className={
                      i === 0
                        ? "flex w-full items-center gap-3 px-4 py-3 tablet:px-5"
                        : "flex w-full items-center gap-3 border-t border-01 px-4 py-3 tablet:px-5"
                    }
                  >
                    <span className="shrink-0">{ALERT_ICON[note.severity] ?? ALERT_ICON.INFO}</span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p className="text-body-sm text-01">{title}</p>
                      <p className="text-body-xs text-03">
                        <UtcTime value={note.createdAt} />
                      </p>
                    </div>
                    {action ? (
                      <Button variant="secondary" size="sm" className="shrink-0" asChild>
                        <Link href={action.href}>{action.label}</Link>
                      </Button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => dismiss(group)}
                      aria-label={`Dismiss: ${title}`}
                      title="Dismiss (mark read)"
                      className="flex size-8 shrink-0 items-center justify-center rounded-md text-03 transition-colors hover:bg-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                );
              })
            )}
            {notifications.length > 0 && attention.more ? <MoreAlerts /> : null}
          </PanelBody>
        </Panel>
      </section>

      {/* items-start: the design's bottom row holds two SHORT panels, so a
          stretched Open-holds card next to a tall Recent-calls list would read
          as a panel that failed to load rather than one that is simply small. */}
      {nothingYet ? null : (
      <section className="flex w-full flex-col gap-3.5 desktop:flex-row desktop:items-start desktop:gap-4">
        <Panel className="min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Open holds</PanelTitle>
              <PanelDescription>
                {openHolds.some((h) => owedIntentIds.has(h.intentId))
                  ? "Reserved, not spent — unpaid calls stay held until they are collected"
                  : "Reserved, not spent — released or charged within 24h"}
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="flex-row items-center gap-4 p-4 tablet:p-[18px] desktop:gap-6 desktop:p-5">
            <HoldFigure label="Calls" value={data ? formatCount(openHolds.length) : "—"} />
            <HoldFigure label="Amount" value={balance ? formatMoney(balance.held) : "—"} />
            <HoldFigure
              label="Oldest"
              value={openHolds.length > 0 ? formatAge(oldestHold) : "—"}
            />
            <Button variant="secondary" size="sm" className="shrink-0" asChild>
              <Link href={routes.calls()}>See calls</Link>
            </Button>
          </PanelBody>
        </Panel>

        <Panel className="min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Recent calls</PanelTitle>
              <PanelDescription>Open a call to see why it was or was not charged</PanelDescription>
            </PanelTitles>
            <Button variant="ghost" size="sm" asChild>
              <Link href={routes.calls()}>See all</Link>
            </Button>
          </PanelHeader>
          <PanelBody>
            {(data?.recentCalls.length ?? 0) === 0 ? (
              <EmptyState
                className="max-w-none border-0 bg-transparent px-5 py-4"
                title="No calls yet"
                description="When your agent calls a tool, each call shows here with what it cost."
              />
            ) : (
              <ul className="flex flex-col">
                {data?.recentCalls.map((call) => {
                  const outcome = callOutcome(call);
                  const uncharged = notCharged(call.price, call.charged);
                  // Buyer debt or a forfeited payment: say why, beside the verdict.
                  const paymentNote = callPaymentNote(call);
                  return (
                    <li key={call.intentId} className="border-b border-01 last:border-b-0">
                      <Link
                        href={routes.receipt(call.intentId)}
                        className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 tablet:px-5"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="truncate font-mono text-mono-13 font-semibold text-01">
                            <EntityName kind="tool" id={call.toolId} copyable={false} />
                          </span>
                          <span className="flex flex-wrap items-center gap-2 text-body-xs text-03">
                            <StatusChip status={outcome} />
                            <span>
                              {outcome === "checking" ? "started " : null}
                              <UtcTime value={call.createdAt} relative />
                            </span>
                          </span>
                          {paymentNote && outcome !== "owed" ? (
                            <span className="text-body-xs text-03">{paymentNote}</span>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="font-mono text-mono-13 font-semibold text-01">
                            {outcome === "free"
                              ? "Free"
                              : outcome === "checking"
                                ? `${formatMoney(call.price, { decimals: 4 })} held`
                                : outcome === "owed"
                                  ? `${formatMoney(call.price, { decimals: 4 })} owed`
                                  : formatMoney(call.charged, { decimals: 4 })}
                          </span>
                          {toDecimal(uncharged).gt(0) && outcome !== "checking" && outcome !== "owed" ? (
                            <span className="font-mono text-mono-xs text-teal-600">
                              {formatMoney(uncharged, { decimals: 4 })} not charged
                            </span>
                          ) : null}
                        </div>
                        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03" />
                      </Link>
                      {/* Owed: what it stops and the way out, beside the row's link. */}
                      {outcome === "owed" ? <OwedRowAction intentId={call.intentId} debt={call.debt} /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </PanelBody>
        </Panel>
      </section>
      )}
      </>
      )}
    </div>
  );
}

/** Needs attention when there is more than it shows (or than one load read). */
function MoreAlerts() {
  return (
    <p className="border-t border-01 px-4 py-3 text-body-13 text-02 first:border-t-0 tablet:px-5" data-testid="attention-more">
      More unread alerts:{" "}
      <Link href="/alerts?view=recent" className="font-semibold text-primary-600 hover:underline">
        See all
      </Link>
    </p>
  );
}

/**
 * The page's shape while the first figures load: grey blocks where the tiles,
 * the panels and the call list will be, instead of tiles reading "—, not
 * available" (which says the figures could not be read, not that they are on
 * their way).
 */
function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading your account" className="flex w-full flex-col gap-3.5 tablet:gap-4 desktop:gap-5">
      <div className="grid w-full grid-cols-2 gap-3 tablet:gap-3.5 desktop:grid-cols-3 desktop:gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={
              i < 2
                ? "col-span-2 flex flex-col gap-2.5 rounded-xl border border-01 bg-01 p-4 tablet:col-span-1 tablet:p-5"
                : "col-span-2 flex flex-col gap-2.5 rounded-xl border border-01 bg-01 p-4 tablet:col-span-1 tablet:p-5 desktop:col-span-1"
            }
          >
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
      <div className="flex w-full flex-col gap-3.5 desktop:flex-row desktop:gap-4">
        <div className="min-w-0 flex-1 rounded-xl border border-01 bg-01 p-5">
          <Skeleton className="mb-4 h-4 w-40" />
          <Skeleton className="h-40 w-full" />
        </div>
        <div className="rounded-xl border border-01 bg-01 px-5 py-3 desktop:w-[440px] desktop:shrink-0">
          <SkeletonRows rows={3} />
        </div>
      </div>
    </div>
  );
}
