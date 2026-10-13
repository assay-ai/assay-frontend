"use client";

import { DisplayAssetSelect, useDisplayAsset } from "@/components/display-asset-select";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Gauge, Inbox, Landmark, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { MetricTile } from "@/components/ui/metric-tile";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn } from "@/components/ui/table";
import { formatCount, sumMoney } from "@/features/buyer/period";
import { ApiError } from "@/libs/ApiClient";
import type {
  Money,
  ProviderEarnings,
  ProviderEarningsGroup,
  ProviderPayout,
  SlaWindow,
  ToolBindingDetail,
  ToolBindingSummary,
} from "@/interfaces";
import { getUnreadCount } from "@/services/account.service";
import { listProviderPayouts, payoutsInAsset } from "@/services/provider-payouts.service";
import { getProviderRegistration } from "@/services/provider-registration.service";
import { getProviderEarnings } from "@/services/provider-reports.service";
import { listSlaWindows } from "@/services/provider-sla-windows.service";
import { requirementChain } from "@/features/provider-stake/chain-stake";
import { getProviderStake } from "@/services/provider-stake.service";
import { getToolBinding, listToolBindings } from "@/services/provider-tool-bindings.service";
import { toDecimal, formatMoney } from "@/utils/money";
import { labelForEndpoint } from "@/utils/provider-label";

/**
 * Provider home — desktop (1440) and tablet (834) designs. One page, two compositions; the shell, its padding and its 16px gap
 * come from the `(console)` layout.
 *
 * ## Two layouts, one breakpoint, chosen to match the sidebar
 *
 * The tablet design uses the sidebar at `width 64` — the icon rail — and `sidebar.tsx`
 * switches 64 → 248 at `desktop` (1440). So this page switches its own
 * composition on exactly the same class: **stacked binding cards + three
 * metric tiles below `desktop`, the eight-column table + the two-panel row at
 * `desktop` and up.** Splitting anywhere else would put the rail and the body
 * on different stories about how wide the window is.
 *
 * The tablet frame also drops two regions the 1440 frame draws — "Paid this
 * month" and the whole "Needs attention" panel — and replaces the two header
 * buttons with a single compact Inbox count. Both are reproduced.
 *
 * ## Which figures are real, and which are `—` by construction
 *
 * The backend hard-codes `paidQualityRate`, `freeQualityRate`,
 * `availabilityRate`, `p50LatencyMs` and `p95LatencyMs` to `null` — on
 * `/providers/me/quality`, on `/providers/me/traffic` and on the
 * `/providers/me` stats snapshot alike. There is no fetch to fix. So:
 *
 * - **quality** renders `—` on every row. Twice over, in fact: the rate is
 *   null *and* `/quality` has no per-binding breakdown. `verdictMix` IS real,
 *   but it is provider-wide, and putting a provider-wide 86% PASS share on a
 *   binding that has served nothing would read as that binding's own quality.
 *   That is a lie, so it is not rendered.
 * - **latency** renders the declared ceiling and an unknown observed value —
 *   `—/10000ms`. `timeoutMs` is real and per binding; the observed p50 is
 *   null and provider-wide.
 * - **window** renders `—` on every row. The backend now makes a window a
 *   real, per-**binding** row (`sla_windows.binding_id`), which reverses the
 *   old constraint here — a per-binding window is now possible — but this
 *   page still does not fetch one per row: doing so needs an N+1 `?bindingId=`
 *   fetch on top of the N+1 `tool-binding` detail fetch this page already
 *   makes, and is deferred rather than added silently. The design's own panel
 *   subtitle — kept verbatim below — calls this column "the sufficiency gate
 *   on ordinary days".
 *
 *   The single most-recently-opened window across every binding this
 *   provider owns is still shown, once, in "Needs attention" — labelled with
 *   the binding it actually belongs to, not the provider as a whole. Before
 *   per-binding windows, a window WAS provider-wide and this label said so; that is no
 *   longer true and the label no longer claims it.
 * - **calls 24h**, **share** and **today** come from
 *   `/providers/me/earnings?groupBy=tool`, which is the only per-tool report
 *   the API has. `/traffic` and `/quality` take `from`/`to` and nothing else.
 *
 * **share is share of this provider's own served calls**, not market share.
 * The frame's two rows read 42% and 60%, which sum to 102% and therefore
 * cannot be shares of one provider's traffic — they read as market share
 * against other providers of the same tool, and no endpoint exposes that.
 * The portfolio screen hit the identical ambiguity and resolved it the same way; keeping the
 * two screens consistent matters more than either guess.
 *
 * ## Why each binding is fetched a second time
 *
 * `ToolBindingSummary` (the list shape) carries no `timeoutMs` and no
 * `slaFailureRate`; only `GET .../tool-bindings/{id}` does. Both are needed —
 * the first for the latency column, the second for the declared rate the
 * window card compares against — so the detail route is fetched per binding.
 * That is N+1 on a landing page, and it is bounded by the number of bindings
 * a provider has (one per tool, by construction).
 */

/** Em dash for a value with no honest source. Never a synthetic zero. */
const DASH = "—";

/**
 * The per-window penalty ceiling, transcribed from the design for the same
 * reason. The design's Note and its stake card both write `$5.00`; nothing on the
 * wire carries it. The per-window cap is described elsewhere as
 * `max($5, 100 × price)`; this screen follows the design's fixed figure.
 */
const PENALTY_CEILING_MAJOR = 5;

/** `[from, to)` for the trailing 24 hours. */
function last24Hours(now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - 86_400_000).toISOString(),
    to: new Date(now.getTime() + 60_000).toISOString(),
  };
}

/** `[from, to)` for the current UTC calendar day — the design's "today". */
function todayUtc(now: Date): { from: string; to: string } {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + 86_400_000).toISOString(),
  };
}

/** `[from, to)` for the current UTC calendar month. */
function thisMonthUtc(now: Date): { from: string; to: string } {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}

function groupsByTool(earnings: ProviderEarnings | undefined): Map<string, ProviderEarningsGroup> {
  const map = new Map<string, ProviderEarningsGroup>();
  for (const group of earnings?.groups ?? []) map.set(group.key, group);
  return map;
}

/** True when a payout entry's `createdAt` falls in `[from, to)`. */
function within(payout: ProviderPayout, window: { from: string; to: string }): boolean {
  return payout.createdAt >= window.from && payout.createdAt < window.to;
}

/** Σ of a payout page's amounts, or `null` when the page is empty. */
function sumPayouts(payouts: ProviderPayout[]): Money | null {
  return sumMoney(
    payouts.map((payout) => payout.amount),
    null,
  );
}

/** `0.02` → `"2.00%"`. */
function ratePercent(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

interface BindingRow {
  id: string;
  summary: ToolBindingSummary;
  detail: ToolBindingDetail | undefined;
  name: string;
  calls24h: number | null;
  today: string;
  share: string;
  latency: string;
}

/** One "Needs attention" item — an icon, two lines, and nothing else. */
interface AttentionItem {
  id: string;
  icon: React.ReactNode;
  /** `A` in the frame — sans 13.5. */
  headline: string;
  /** `B` in the frame — mono 11.5, `$text-03`. */
  detail: string;
  title?: string;
}

export default function ProviderHomePage() {
  const now = useMemo(() => new Date(), []);
  const window24h = useMemo(() => last24Hours(now), [now]);
  const windowToday = useMemo(() => todayUtc(now), [now]);
  const windowMonth = useMemo(() => thisMonthUtc(now), [now]);

  /* Same key the `(console)` layout uses for the rail — same request. */
  const bindings = useQuery({
    queryKey: ["provider", "tool-bindings", "sidebar"],
    queryFn: () => listToolBindings({ limit: 50 }),
  });

  const registration = useQuery({
    queryKey: ["provider", "registration"],
    queryFn: getProviderRegistration,
    /*
      An org that has not registered gets a 404 here (unlike `tool-bindings`,
      `stake` and `earnings`, which answer 200 with empty results). The page
      falls back to the endpoint host for its title rather than retrying.
    */
    retry: false,
  });

  const stake = useQuery({ queryKey: ["provider", "stake"], queryFn: getProviderStake });

  /*
    The tablet frame's header button carries a number (the Button label is
    overridden to "2"). That number is the INBOX's, not this page's — the
    button opens `/provider/inbox`. It is therefore the unread notification
    count, which is `0` and will stay `0` until something writes the
    `notifications` table; see the inbox page. Wiring it to the "needs attention" count
    would put this page's own figure on a control that opens another page.
  */
  const unread = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: getUnreadCount,
  });

  const slaWindows = useQuery({
    queryKey: ["provider", "sla-windows", "latest"],
    queryFn: () => listSlaWindows({ limit: 1 }),
  });

  const earnings24h = useQuery({
    queryKey: ["provider", "earnings", "tool", window24h.from, window24h.to],
    queryFn: () => getProviderEarnings({ ...window24h, groupBy: "tool" }),
  });

  const earningsToday = useQuery({
    queryKey: ["provider", "earnings", "tool", windowToday.from, windowToday.to],
    queryFn: () => getProviderEarnings({ ...windowToday, groupBy: "tool" }),
  });

  const earningsMonth = useQuery({
    queryKey: ["provider", "earnings", "tool", windowMonth.from, windowMonth.to],
    queryFn: () => getProviderEarnings({ ...windowMonth, groupBy: "tool" }),
  });

  /*
    ONE request, and no `from`/`to` on it. **`GET /providers/me/payouts`
    accepts both and silently ignores them** — measured on the wire: a
    one-hour window returns the same four rows as a whole day, and as no
    window at all. Passing them would put "Paid today" over an all-time total
    and label it today's. So the page fetches the newest page and buckets it
    here, where the filter demonstrably happens. A backend defect in the
    same family as the `search` parameter this resource also ignores.
  */
  const payouts = useQuery({
    queryKey: ["provider", "payouts", "recent"],
    queryFn: () => listProviderPayouts({ limit: 100 }),
  });

  const items = useMemo(() => bindings.data?.items ?? [], [bindings.data]);

  /* See the docstring — `timeoutMs` and `slaFailureRate` are detail-only. */
  const details = useQueries({
    queries: items.map((binding) => ({
      queryKey: ["provider", "tool-binding", binding.id],
      queryFn: () => getToolBinding(binding.id),
    })),
  });

  const byTool24h = useMemo(() => groupsByTool(earnings24h.data), [earnings24h.data]);
  const byToolToday = useMemo(() => groupsByTool(earningsToday.data), [earningsToday.data]);

  const totalCalls24h = earnings24h.data?.totals.calls ?? 0;
  const todayAsset = earningsToday.data?.asset ?? null;

  const rows: BindingRow[] = items.map((summary, i) => {
    const detail = details[i]?.data;
    const group24h = byTool24h.get(summary.toolId);
    const groupToday = byToolToday.get(summary.toolId);

    return {
      id: summary.id,
      summary,
      detail,
      name: labelForEndpoint(summary.endpoint),
      calls24h: earnings24h.data ? (group24h?.calls ?? 0) : null,
      // A tool that served nothing today earned zero — but only sayable when
      // the window matched something, or there is no asset to denominate it.
      today: groupToday?.earned
        ? formatMoney(groupToday.earned, { decimals: 2 })
        : todayAsset
          ? "$0.00"
          : DASH,
      share:
        totalCalls24h > 0 && group24h
          ? `${Math.round((group24h.calls / totalCalls24h) * 100)}%`
          : DASH,
      // Observed p50 is hard-coded null; the declared timeout is real.
      latency: detail ? `${DASH}/${detail.timeoutMs}ms` : DASH,
    };
  });

  // ── Header figures ────────────────────────────────────────────────────────

  /*
    The stake is per chain; `headroom` and `requirementTotal` are not — they
    are denominated in the stake floor's one asset, so the only chain they may
    be shown beside is that asset's own. `requirementChain` derives it and
    answers `null` rather than picking a row. These two lines used to read
    `stake.data.hasKnownStake` and `stake.data.staked` at the top level, where
    the backend had already stopped putting them: both were `undefined`, so
    `staked` was always null and this header printed a dash at a provider with
    a real, readable stake.
  */
  const stakeChain = requirementChain(stake.data);
  const staked = stakeChain?.hasKnownStake ? stakeChain.staked : null;
  const headroom = stakeChain?.hasKnownStake ? stake.data?.headroom ?? null : null;
  const requirementTotal = stake.data?.requirementTotal ?? null;

  /*
    "A single $5.00 penalty would drop you below the minimum" is only true when
    the headroom is smaller than that penalty. Below that, both the page-level
    Note and the stake card in "Needs attention" fire; above it, neither does.
    The frame draws them unconditionally because the frame draws a provider at
    $0.00 headroom.
  */
  const headroomIsThin =
    headroom !== null && toDecimal(headroom).lessThan(PENALTY_CEILING_MAJOR);

  const latestWindow: SlaWindow | undefined = slaWindows.data?.items[0];
  const liveWindow = latestWindow?.status === "OPEN" ? latestWindow : undefined;

  /*
    A window is a property of a BINDING (`liveWindow.bindingId`),
    not of the provider — the fold this used to guard against ("the two only
    line up when every active binding declares the same rate") no longer
    applies, because there is exactly one binding this window can belong to.
    So the declared rate compared against is that binding's own, read straight
    off its detail fetch, not a set-of-one heuristic over every binding.
  */
  const liveWindowBindingIndex = liveWindow
    ? items.findIndex((summary) => summary.id === liveWindow.bindingId)
    : -1;
  const declaredRate =
    liveWindowBindingIndex >= 0 ? (details[liveWindowBindingIndex]?.data?.slaFailureRate ?? null) : null;

  const attention: AttentionItem[] = [];

  if (liveWindow) {
    const observed =
      liveWindow.observedFailureRate === null ? null : ratePercent(liveWindow.observedFailureRate);
    const sufficient = liveWindow.verifiedCalls >= liveWindow.minVerifiedCalls;
    const clauses = [
      sufficient ? null : "not slashable yet",
      observed === null ? null : `observed ${observed}`,
      declaredRate === null ? null : `against your declared ${ratePercent(declaredRate)}`,
    ].filter((clause): clause is string => clause !== null);

    attention.push({
      id: liveWindow.windowId,
      icon: <Gauge width={16} height={16} strokeWidth={1.5} className="text-primary-500" />,
      // Before per-binding windows, a window was provider-wide and this line said so. It is
      // now this ONE binding's window (`liveWindow.toolId`), so it is named.
      headline: `${liveWindow.toolId} window at ${formatCount(liveWindow.verifiedCalls)} of ${formatCount(
        liveWindow.minVerifiedCalls,
      )} verified calls`,
      detail: clauses.join(" · "),
      title: `${liveWindow.label} · ${liveWindow.totalCalls} calls, ${liveWindow.verifiedCalls} verified, ${liveWindow.failedCalls} failed`,
    });
  }

  if (headroomIsThin && headroom) {
    attention.push({
      id: "stake-headroom",
      icon: <Landmark width={16} height={16} strokeWidth={1.5} className="text-warning-500" />,
      headline: `Stake headroom is ${formatMoney(headroom, { decimals: 2 })}`,
      detail: `a $${PENALTY_CEILING_MAJOR.toFixed(2)} penalty would start a 7-day grace period`,
    });
  }

  const headerFacts = [
    staked ? `stake ${formatMoney(staked, { decimals: 2 })}` : `stake ${DASH}`,
    headroom ? `headroom ${formatMoney(headroom, { decimals: 2 })}` : `headroom ${DASH}`,
    `${formatCount(attention.length)} item${attention.length === 1 ? "" : "s"} need${
      attention.length === 1 ? "s" : ""
    } attention`,
  ].join(" · ");

  /*
    The design shows a domain (`provider.example`). `legalName` is the
    provider's own identity field on the wire and is what a home page names;
    the registered endpoint's host stands in when registration 404s, and the
    first binding's host when even that is missing.
  */
  const registeredEndpoint = registration.data?.registration.endpoint ?? null;
  const title =
    registration.data?.registration.legalName ??
    (registeredEndpoint ? labelForEndpoint(registeredEndpoint) : null) ??
    (items[0] ? labelForEndpoint(items[0].endpoint) : "Provider");

  // ── Earnings panel ────────────────────────────────────────────────────────

  // One money figure, one asset: only the display asset's payouts are counted.
  const { current: displayAsset, isPending: assetPending } = useDisplayAsset("provider");
  const allPayouts = payouts.data?.items ?? [];
  const payoutRows = assetPending ? [] : payoutsInAsset(allPayouts, displayAsset);
  const todayPayouts = payoutRows.filter((p) => within(p, windowToday));
  const monthPayouts = payoutRows.filter((p) => within(p, windowMonth));

  /*
    Rows arrive newest first, so a bucket is complete only when the page
    reaches back past its lower bound. If the page was capped while still
    inside the bucket, the sum would be a floor wearing the shape of a total —
    which is what `—` is for.
  */
  const oldestOnPage = allPayouts.length > 0 ? allPayouts[allPayouts.length - 1].createdAt : null;
  const pageCovers = (window: { from: string }) =>
    !assetPending &&
    (!payouts.data?.pageInfo.hasMore || (oldestOnPage !== null && oldestOnPage < window.from));

  const paidToday = pageCovers(windowToday) ? sumPayouts(todayPayouts) : null;
  const paidMonth = pageCovers(windowMonth) ? sumPayouts(monthPayouts) : null;
  const withheldMonth = earningsMonth.data?.totals.withheld ?? null;

  const columns: TableColumn<BindingRow>[] = [
    {
      key: "binding",
      header: "binding",
      mono: true,
      // The frame writes the identity cell at 600 and every other cell at
      // normal weight; Table has no per-column weight, so it rides the value.
      cell: (row) => <span className="font-semibold">{row.name}</span>,
    },
    {
      key: "status",
      header: "status",
      width: 90,
      align: "start",
      cell: (row) => <StatusBadge status={row.summary.status} />,
    },
    {
      key: "calls",
      header: "calls 24h",
      width: 90,
      align: "end",
      mono: true,
      cell: (row) => (row.calls24h === null ? DASH : formatCount(row.calls24h)),
    },
    {
      key: "quality",
      header: "quality",
      width: 80,
      align: "end",
      mono: true,
      cell: () => (
        <span title="Quality per binding is not available yet.">
          {DASH}
        </span>
      ),
    },
    {
      key: "window",
      header: "window",
      width: 270,
      align: "end",
      mono: true,
      noTruncate: true,
      cell: () => (
        <span title="SLA windows are per binding now, but this row is not fetched per binding (N+1 on top of the existing N+1); the most recent window across any binding is in Needs attention.">
          {DASH}
        </span>
      ),
    },
    {
      key: "latency",
      header: "latency",
      width: 110,
      align: "end",
      mono: true,
      cell: (row) => (
        <span title="Observed latency is not available yet; the second figure is the binding's declared timeout.">
          {row.latency}
        </span>
      ),
    },
    { key: "share", header: "share", width: 70, align: "end", mono: true, cell: (r) => r.share },
    { key: "today", header: "today", width: 90, align: "end", mono: true, cell: (r) => r.today },
  ];

  const error = [
    bindings.error,
    stake.error,
    earnings24h.error,
    earningsToday.error,
    earningsMonth.error,
    slaWindows.error,
    payouts.error,
  ].find((e): e is ApiError => e instanceof ApiError);

  return (
    <>
      {/* Page Header. */}
      <header className="flex w-full items-center justify-between gap-3 desktop:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-heading-sm text-01 desktop:text-heading-md">{title}</h1>
          <p className="truncate font-mono text-mono-xs text-03 desktop:text-mono-12">
            {headerFacts}
          </p>
        </div>

        {/* 834 draws one compact Inbox button carrying the count; 1440 draws
            Inbox + New binding. */}
        <div className="flex shrink-0 items-center gap-2.5">
          <Button variant="secondary" icon={<Inbox />} asChild>
            <Link href="/provider/inbox">
              <span className="hidden desktop:inline">Inbox</span>
              <span className="desktop:hidden">{formatCount(unread.data?.count ?? 0)}</span>
            </Link>
          </Button>
          {/* `asChild` means Button's own `icon` prop is dropped by Radix Slot,
              so the icon rides inside the Link. */}
          <Button className="hidden desktop:inline-flex" asChild>
            <Link href="/provider/bindings/new">
              <Plus aria-hidden="true" />
              New binding
            </Link>
          </Button>
        </div>
      </header>

      <DisplayAssetSelect scope="provider" />

      {error ? (
        <Banner
          tone="danger"
          title="Your home page could not be loaded"
          description={`${error.code} · ${error.message}`}
        />
      ) : null}

      {/* Note. Conditional — see `headroomIsThin`. */}
      {headroomIsThin && headroom ? (
        <div className="flex w-full items-start gap-2.5 rounded-lg border border-warning-20 bg-warning-10 p-3.5 desktop:p-[15px]">
          <TriangleAlert
            width={15}
            height={15}
            strokeWidth={1.5}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-warning-600"
          />
          <p className="min-w-0 flex-1 text-body-xs leading-[1.6] text-warning-700 desktop:text-body-13">
            Stake headroom is {formatMoney(headroom, { decimals: 2 })}. A single $
            {PENALTY_CEILING_MAJOR.toFixed(2)} penalty would drop you below the{" "}
            {requirementTotal ? formatMoney(requirementTotal, { decimals: 2 }) : DASH} minimum and
            start a 7-day grace period. Routing would continue throughout.
          </p>
        </div>
      ) : null}

      {/* ── Below desktop: the design's stacked cards ─────────────────────────── */}
      <section className="flex w-full flex-col gap-2.5 desktop:hidden">
        <p className="font-mono text-mono-2xs tracking-[1.2px] text-03">BINDINGS</p>
        {rows.length > 0 ? (
          rows.map((row) => <BindingCard key={row.id} row={row} />)
        ) : (
          <EmptyBindings />
        )}
      </section>

      {/* ── desktop: the design's Bindings panel ──────────────────────────────── */}
      <Panel className="hidden desktop:flex">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Bindings</PanelTitle>
            {/*
              Verbatim from `zvpXC/jCszO`. It describes the `window` column,
              which this build renders as `—` on every row because SLA windows
              are provider-wide. Design copy is kept as drawn despite the
              mismatch.
            */}
            <PanelDescription>
              one row per binding — open one for its live SLA window and verdicts
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        {/* Body — padding [6, 10, 10, 10]. */}
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          {rows.length > 0 ? (
            <Table columns={columns} rows={rows} caption="Bindings" />
          ) : (
            <EmptyBindings className="m-2.5" />
          )}
        </PanelBody>
      </Panel>

      {/* ── Below desktop: the design's three tiles ───────────────────────────── */}
      <section className="flex w-full flex-col gap-2.5 desktop:hidden">
        <p className="font-mono text-mono-2xs tracking-[1.2px] text-03">EARNINGS</p>
        <div className="flex w-full flex-col gap-3 tablet:flex-row">
          <MetricTile
            className="p-4"
            label="Pending"
            // No endpoint exposes accrued-but-unpaid provider earnings, and
            // none exposes the payout schedule either, so the frame's "next
            // batch in 22m" has no source. `earned − paid` is a different
            // quantity wearing this one's shape.
            value={DASH}
            sub="not available yet"
          />
          <MetricTile
            className="p-4"
            label="Paid today"
            value={paidToday ? formatMoney(paidToday, { decimals: 2 }) : DASH}
            sub={`${formatCount(todayPayouts.length)} payment${todayPayouts.length === 1 ? "" : "s"}`}
          />
          <MetricTile
            className="p-4"
            label="Not credited this month"
            value={withheldMonth ? formatMoney(withheldMonth, { decimals: 2 }) : DASH}
            sub="rejected or failed calls"
          />
        </div>
      </section>

      {/* ── desktop: Earnings + Needs attention ────────────────────────────── */}
      {/*
        `items-start`, not the flex default. The frame's Row leaves
        `alignItems` unset, which in Pencil means `start`, and the two panels
        it holds are genuinely different heights (604x314 and 520x268).
        Stretching them to match would invent a tall empty panel on whichever
        side has fewer items — which, with one attention item, is this one.
      */}
      <div className="hidden w-full items-start gap-4 desktop:flex">
        <Panel className="min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Earnings</PanelTitle>
              <PanelDescription>paid on-chain as calls settle</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          {/* Body — padding [8, 20, 18, 20]. */}
          <PanelBody className="px-5 pb-[18px] pt-2">
            <EarningsRow
              label="Pending"
              sub="not available yet"
              value={DASH}
              title="Earnings are paid as each call settles, so a pending balance is not shown."
            />
            <EarningsRow
              label="Paid today"
              sub={`${formatCount(todayPayouts.length)} payment${todayPayouts.length === 1 ? "" : "s"}`}
              value={paidToday ? formatMoney(paidToday, { decimals: 2 }) : DASH}
            />
            <EarningsRow
              label="Paid this month"
              sub={`${formatCount(monthPayouts.length)} payment${monthPayouts.length === 1 ? "" : "s"}`}
              value={paidMonth ? formatMoney(paidMonth, { decimals: 2 }) : DASH}
            />
            <EarningsRow
              label="Not credited this month"
              // Verbatim from the design. It names a classification and a verdict
              // as a mechanism — "money withheld because DATA_RESULT reached
              // FAIL" — rather than reporting one call's verdict, which is what
              // Foundations rule 03 forbids.
              sub="calls rejected by our checks or failed with an error · see Earnings"
              value={withheldMonth ? formatMoney(withheldMonth, { decimals: 2 }) : DASH}
              danger
            />
          </PanelBody>
        </Panel>

        <Panel className="w-[520px] shrink-0">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Needs attention</PanelTitle>
              <PanelDescription>only items with a deadline or a decision</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          {/* Body — gap 12, padding 20. */}
          <PanelBody className="gap-3 p-5">
            {attention.length > 0 ? (
              attention.map((item) => (
                <div
                  key={item.id}
                  title={item.title}
                  className="flex w-full items-center gap-[11px] rounded-lg border border-01 bg-02 p-3.5"
                >
                  <span aria-hidden="true" className="shrink-0">
                    {item.icon}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="text-body-13 leading-[1.4] text-01">{item.headline}</p>
                    <p className="font-mono text-mono-xs leading-[1.4] text-03">{item.detail}</p>
                  </div>
                </div>
              ))
            ) : (
              /* The design draws no empty state here — its provider has two
                 items. This copy is not from the design. */
              <p className="text-body-13 text-02">
                Nothing needs a decision right now. Items with a deadline appear here and in the
                inbox.
              </p>
            )}
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}

/**
 * `PAUSED` is not in `badge.tsx`'s eleven-variant vocabulary, and the component
 * deliberately has no `label` prop. The design's paused pill is the
 * `not-sampled` variant's exact geometry — `$bg-03`, `$text-02`, dot disabled —
 * with different text, so that geometry is reproduced here rather than a
 * shared file being edited.
 */
function StatusBadge({ status }: { status: ToolBindingSummary["status"] }) {
  if (status === "ACTIVE") return <Badge variant="active" />;
  return (
    <span className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-full bg-03 px-[9px] py-1 font-mono text-mono-xs font-semibold tracking-[0.6px] text-02">
      {status}
    </span>
  );
}

/** One row of the desktop Earnings panel. */
function EarningsRow({
  label,
  sub,
  value,
  danger,
  title,
}: {
  label: string;
  sub: string;
  value: string;
  danger?: boolean;
  title?: string;
}) {
  return (
    <div className="flex w-full items-center gap-4 py-2.5" title={title}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-body-13 text-01">{label}</p>
        <p className="truncate text-body-xs text-03">{sub}</p>
      </div>
      <p
        className={`shrink-0 font-mono text-mono-sm font-semibold ${
          danger ? "text-danger-600" : "text-01"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** One binding card below `desktop`. */
function BindingCard({ row }: { row: BindingRow }) {
  const cells: { key: string; value: string }[] = [
    { key: "calls 24h", value: row.calls24h === null ? DASH : formatCount(row.calls24h) },
    { key: "quality", value: DASH },
    { key: "latency", value: row.latency },
    { key: "share", value: row.share },
  ];

  return (
    <Link
      href={`/provider/bindings/${row.id}`}
      className="flex w-full flex-col gap-3 rounded-lg border border-01 bg-01 p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <div className="flex w-full items-center gap-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-mono-sm font-semibold text-01">
          {row.name}
        </span>
        <StatusBadge status={row.summary.status} />
        <span className="shrink-0 font-mono text-mono-sm font-semibold text-01">{row.today}</span>
      </div>

      <div className="flex w-full gap-3">
        {cells.map((cell) => (
          <div key={cell.key} className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-body-xs text-03">{cell.key}</span>
            <span className="truncate font-mono text-mono-13 font-semibold text-01">
              {cell.value}
            </span>
          </div>
        ))}
      </div>

      {/* The window line. Provider-wide, so no per-binding figure
          exists to put here; see the file docstring. */}
      <span className="w-full font-mono text-mono-xs text-02">window {DASH}</span>
    </Link>
  );
}

/** Neither design draws one; a provider with no bindings reaches it. */
function EmptyBindings({ className }: { className?: string }) {
  return (
    <div className={`w-full rounded-lg border border-01 bg-02 p-5 ${className ?? ""}`}>
      <p className="text-label-md text-01">No bindings yet</p>
      <p className="mt-1 text-body-13 text-02">
        A binding is your implementation of one tool. Publish one and it appears here with its
        traffic, its window and what it earned today.
      </p>
    </div>
  );
}
