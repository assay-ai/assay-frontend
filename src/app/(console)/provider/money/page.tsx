"use client";

import { DisplayAssetSelect, useDisplayAsset } from "@/components/display-asset-select";
import { useQuery } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { Download } from "lucide-react";
import * as React from "react";
import { useMemo, useState } from "react";

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
import { formatCount } from "@/features/buyer/period";
import { earnedTileSub } from "@/features/provider-earnings/earned-tile";
import type { Money, ProviderEarningsGroup, ProviderPayout } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { listProviderPayouts, payoutsInAsset } from "@/services/provider-payouts.service";
import { exportProviderCalls, getProviderEarnings } from "@/services/provider-reports.service";
import { listToolBindings } from "@/services/provider-tool-bindings.service";
import { formatMoney } from "@/utils/money";
import { labelForEndpoint } from "@/utils/provider-label";
import { toast } from "@/utils/toast";

/**
 * Earnings and payouts — route `/provider/money`.
 *
 * Page Header · four Tiles · panel "Rejected calls, itemised" · panel "Payout
 * history", straight down the frame's `Main`. The shell is the
 * `(console)` layout's.
 *
 * The batch payout writer is retired, and so is the two-step earnings
 * withdrawal that briefly replaced it. `redeem_voucher` now pays the
 * provider's own token account inside the settling transaction, so there is no
 * balance held anywhere on the provider's behalf and nothing to claim:
 * `provider_payouts` rows are frozen history, not a live feed, so this screen
 * claims no cadence anywhere — the "Payout threshold" control is gone, the
 * "Withdraw" action is gone, and the table below reads as a record of what
 * already happened, not a preview of what happens next.
 *
 * ## Two endpoints, and what each one cannot say
 *
 * `GET /providers/me/earnings` takes a required `from`/`to` and a
 * `groupBy=day|tool`, and returns the whole document — no cursor, no paging.
 * `GET /providers/me/payouts` is cursor-paged and accepts a `search` parameter
 * it **silently ignores**, so this screen offers no search box.
 *
 * It also accepts `from` and `to` and **silently ignores those too** — new,
 * and measured on the wire: `from=2020-01-01&to=2020-01-02` returns the same
 * four 2026 rows as an unfiltered call. `earnings` honours the same two
 * parameters (a 2020 window there returns zero groups), so this is one
 * resource's defect and not a house style. Every payout window on this screen
 * is therefore computed client-side, and gated on the page being complete.
 *
 * Between them they carry the four tiles and the two tables only partly:
 *
 * - **There is no accrued balance to have an endpoint.** Nothing is held for
 *   the provider between the redemption and the wallet, so the tile that once
 *   said `—` now reports `totals.earned` for the window instead. A zero
 *   "Accrued" beside a real earned figure would read as money gone missing,
 *   which is worse than either number alone.
 * - **`Reason` has no endpoint.** The frame itemises withheld money by the rule
 *   that rejected the call (`MIN_ARRAY_LENGTH`, `FRESHNESS`, …). `earnings`
 *   groups by day or by tool and nothing else; `quality.verdictMix` groups by
 *   verdict status, which is a different axis and carries no money. So the
 *   table is grouped by binding — the one axis that exists — and the Reason
 *   cell is the unknown treatment on every row.
 * - **A payout row is a ledger entry, not a batch**, and it carries `batchId`,
 *   `amount`, `chainTxRef`, `createdAt`. The frame's Period, Calls, Gross and
 *   Take columns have no field behind them and no join that would produce one:
 *   nothing links a `PAYOUT` entry to the calls it settled. Four dashed
 *   columns, left unknown rather than filled.
 * - **There is no read endpoint for the payout address** — only the
 *   challenge/prove pair that writes one. The frame does not draw the address,
 *   so nothing is missing here; it is recorded because the neighbouring
 *   screens ask.
 *
 * ## The backend defect this screen sits on top of
 *
 * `/providers/me/payouts` filters `PAYOUT` ledger entries on
 * `batch_id IS NOT NULL`, and no writer in `src/` stamps one — the only writer
 * that could refuses `PAYOUT` outright, and the ledger refuses UPDATE. The
 * seeder works around it, so rows appear here; the production path cannot
 * produce a payout row at all. Not chased, not papered over.
 *
 * ## Money
 *
 * Minor units in a string, always through `formatMoney`, never `Number(…)`.
 * `formatMoney(null)` answers `"$0.00"`, so every null goes through `money()`
 * and comes out as a dash instead.
 */

const DASH = "—";

/** `formatMoney` renders a null as `$0.00`; on this screen that is a lie. */
function money(value: Money | null | undefined, decimals = 2): string {
  if (!value) return DASH;
  return formatMoney(value, { decimals });
}

/** `[from, to)` for the current UTC calendar day. */
function todayUtc(now: Date): { from: string; to: string } {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + 86_400_000).toISOString(),
  };
}

/** `[from, to)` for the current UTC calendar month. */
function monthUtc(now: Date): { from: string; to: string } {
  const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

/**
 * `5j7s…Qm2A`, the frame's own elision for a transaction reference.
 *
 * The seeded refs are Squads proposal ids rather than signatures and are short
 * enough to print whole, so this only bites on a real one.
 */
function shortTx(ref: string | null): string {
  if (!ref) return DASH;
  if (ref.length <= 12) return ref;
  return `${ref.slice(0, 4)}…${ref.slice(-4)}`;
}

/**
 * Σ of a set of amounts, or `null` when the set is empty.
 *
 * Summed in **minor units**, which is where the wire keeps them — no division
 * to major units and back, and no `Number(…)` anywhere near an amount. An
 * empty set returns null rather than a zero because there is then no asset to
 * denominate a zero in, the same distinction `ProviderEarnings.asset` makes.
 *
 * The MVP settles in one asset. A second one would make a single total wrong
 * rather than imprecise, so a mixed set is refused instead of added up.
 */
function sumMoney(values: Money[]): Money | null {
  if (values.length === 0) return null;
  const { asset, decimals } = values[0];
  if (values.some((v) => v.asset !== asset || v.decimals !== decimals)) return null;

  const total = values.reduce((acc, v) => acc.plus(new Decimal(v.amount || "0")), new Decimal(0));
  return { amount: total.toFixed(0), asset, decimals };
}

interface WithheldRow {
  id: string;
  calls: string;
  gross: string;
  binding: string;
}

interface PayoutRow {
  id: string;
  batch: string;
  period: string;
  calls: string;
  gross: string;
  take: string;
  net: string;
  tx: string;
}

export default function ProviderMoneyPage() {
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => todayUtc(now), [now]);
  const month = useMemo(() => monthUtc(now), [now]);

  const [exporting, setExporting] = useState(false);

  /* Withheld, itemised — grouped by tool, the only axis the wire offers. */
  const earningsByTool = useQuery({
    queryKey: ["provider", "earnings", "tool", month.from, month.to],
    queryFn: () => getProviderEarnings({ ...month, groupBy: "tool" }),
  });

  /* Shared with the `(console)` rail's query key — no second round trip. */
  const bindings = useQuery({
    queryKey: ["provider", "tool-bindings", "sidebar"],
    queryFn: () => listToolBindings({ limit: 50 }),
  });

  /*
    ONE payouts query, deliberately unwindowed.

    `ListProviderPayoutsQuery` declares `from` and `to`, and the resource
    **silently ignores both** — measured: `from=2020-01-01&to=2020-01-02`
    returns the same four 2026 rows as no filter at all, as does a `to` that
    precedes every row. It is the `search` defect a second time on the same
    endpoint. Two windowed queries would therefore have produced two identical
    responses, and "Paid today" would have reported the entire payout history
    as today's — a real-looking figure with nothing behind it.

    So the window is applied here, on `createdAt`, over one page. That is only
    sound while the page is the whole set, which is why `hasMore` gates the
    two tiles below rather than being ignored.
  */
  const payouts = useQuery({
    queryKey: ["provider", "payouts", "all"],
    queryFn: () => listProviderPayouts({ limit: 100 }),
  });

  const labelByTool = useMemo(() => {
    const map = new Map<string, string>();
    for (const binding of bindings.data?.items ?? []) {
      map.set(binding.toolId, labelForEndpoint(binding.endpoint));
    }
    return map;
  }, [bindings.data]);

  const totals = earningsByTool.data?.totals;

  const withheldRows: WithheldRow[] = (earningsByTool.data?.groups ?? [])
    .filter((group: ProviderEarningsGroup) => group.withheldCalls > 0)
    .map((group) => ({
      id: group.key,
      calls: formatCount(group.withheldCalls),
      gross: money(group.withheld),
      binding: labelByTool.get(group.key) ?? DASH,
    }));

  const withheldColumns: TableColumn<WithheldRow>[] = [
    // One row per binding. The API does not split these calls by reason, so
    // there is no Reason column: the description says what the rows include.
    {
      key: "binding",
      header: "Binding",
      mono: true,
      cell: (row) => <span className="font-semibold">{row.binding}</span>,
    },
    { key: "calls", header: "Calls", width: 130, align: "end", mono: true, cell: (r) => r.calls },
    { key: "gross", header: "Not credited", width: 130, align: "end", mono: true, cell: (r) => r.gross },
  ];

  const withheldTotal = {
    label: "Total not credited",
    values: {
      calls: totals ? formatCount(totals.withheldCalls) : DASH,
      gross: money(totals?.withheld),
    } as Partial<Record<string, React.ReactNode>>,
  };

  /*
    One money figure, one asset. The earnings tiles are already the display
    asset's, so the payouts beside them — the history rows and both "Paid"
    tiles — are scoped to it too, never summed across assets.
  */
  const { current: displayAsset, isPending: assetPending } = useDisplayAsset("provider");
  const payoutItems = assetPending ? [] : payoutsInAsset(payouts.data?.items ?? [], displayAsset);

  /*
    A page that says `hasMore` is a page that cannot be summed: a window
    computed over it would silently exclude whatever is on page two. The wire
    cannot narrow the window for us (see the query above), so the honest answer
    for both money tiles is then the unknown treatment.
  */
  const payoutsComplete =
    Boolean(payouts.data) && !assetPending && !payouts.data!.pageInfo.hasMore;

  function within(payout: ProviderPayout, w: { from: string; to: string }): boolean {
    return payout.createdAt >= w.from && payout.createdAt < w.to;
  }

  const payoutRows: PayoutRow[] = payoutItems.map(
    (payout: ProviderPayout) => ({
      id: payout.id,
      /*
        The frame keys this column on a batch id, and one batch can hold two
        entries when a provider is paid in two assets. The wire's `batchId` is
        also deterministic, so the same id recurs across runs — grouping on it
        would merge two different payout runs into one row. So the table is one
        row per ledger entry, which is what the resource actually pages.
      */
      batch: payout.batchId.slice(0, 8),
      // A `PAYOUT` entry has a `createdAt` and no period. Nothing on the wire
      // says which interval of calls it settled.
      period: DASH,
      calls: DASH,
      gross: DASH,
      take: DASH,
      net: money(payout.amount),
      tx: shortTx(payout.chainTxRef),
    })
  );

  const todayItems = payoutItems.filter((p) => within(p, today));
  const monthItems = payoutItems.filter((p) => within(p, month));

  const paidToday = payoutsComplete ? sumMoney(todayItems.map((p) => p.amount)) : null;
  const paidMonth = payoutsComplete ? sumMoney(monthItems.map((p) => p.amount)) : null;

  /*
    `batchId` is deterministic and recurs across runs, so a distinct count is
    a count of distinct batch IDENTITIES in the window, not of payout runs.
    Two runs of the same batch collapse into one here — visible in the seed,
    where four entries carry two ids.
  */
  const batchesToday = new Set(todayItems.map((p) => p.batchId)).size;
  const batchesMonth = new Set(monthItems.map((p) => p.batchId)).size;

  const error = [earningsByTool.error, bindings.error, payouts.error].find(
    (e): e is ApiError => e instanceof ApiError
  );

  async function onExport() {
    setExporting(true);
    try {
      const result = await exportProviderCalls(month);
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename ?? "x402-calls.csv";
      anchor.click();
      URL.revokeObjectURL(url);

      /*
        `meta` null means the cap headers were not readable, which is "the cap
        is unknown", never "not truncated" — a provider must not be told a
        capped export is the whole answer.

        `interfaces/provider-reports.ts` says that branch is the live case,
        because the API app "enables CORS with no exposedHeaders at all". That
        is now **stale**: measured cross-origin from this page, the response
        carries `Access-Control-Expose-Headers: Content-Disposition,
        X-X402-Export-Total-Matching, X-X402-Export-Row-Count,
        X-X402-Export-Truncated`, and all three read back (148/148/false). The
        branch stays because a header can stop being exposed again.
      */
      if (result.meta?.truncated) {
        toast.warning(
          `Exported ${formatCount(result.meta.rowCount)} of ${formatCount(result.meta.totalMatching)} rows — the file is capped.`
        );
      } else if (!result.meta) {
        toast.info("Export downloaded. Whether it was capped is not visible from the browser.");
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? `${e.code} · ${e.message}` : "The export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      {/* Page Header. */}
      <header className="flex w-full items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Earnings</h1>
          <p className="font-mono text-mono-12 text-03">
            paid to your wallet as each call settles
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {/*
            This one is real: `GET /providers/me/calls/export` returns the CSV
            for the same window the tiles are measured over.
          */}
          <Button onClick={onExport} loading={exporting} icon={<Download />}>
            Export CSV
          </Button>
        </div>
      </header>

      <DisplayAssetSelect scope="provider" />

      {error ? (
        <Banner
          tone="danger"
          title="Your earnings could not be loaded"
          description={`${error.code} · ${error.message}`}
        />
      ) : null}

      {/* Tiles. */}
      <section className="grid w-full grid-cols-1 gap-3.5 mobile:grid-cols-2 tablet:grid-cols-4">
        <MetricTile
          // There is no accrued balance to report any more, and the honest
          // replacement is what was actually earned. `redeem_voucher` pays the
          // provider's own token account at the moment of redemption, so
          // nothing is ever held on the provider's behalf: an "Accrued" tile
          // here could only ever read zero, and a zero next to a real earned
          // figure reads as money that went missing.
          label="Earned this month"
          value={money(totals?.earned)}
          sub={earnedTileSub(totals, (value) => money(value))}
        />
        <MetricTile
          label="Paid today"
          value={money(paidToday)}
          sub={
            payoutsComplete
              ? `${formatCount(batchesToday)} batch${batchesToday === 1 ? "" : "es"}`
              : // Ours. More payouts exist than were read, so neither the sum
                // nor the count of the window is knowable from one page.
                "too many payouts to total here"
          }
        />
        <MetricTile
          label="Paid this month"
          value={money(paidMonth)}
          sub={
            payoutsComplete
              ? `${formatCount(batchesMonth)} batch${batchesMonth === 1 ? "" : "es"}`
              : "too many payouts to total here"
          }
        />
        <MetricTile
          // The frame names the node "Withheld this month" and labels it
          // "Not credited". The label is what ships.
          label="Not credited"
          value={money(totals?.withheld)}
          sub="rejected by our checks or failed with an error — no stake is taken yet"
          // `$danger-600` on the value. MetricTile's tone vocabulary is
          // `default | teal`, so the value node is reached the way the
          // binding-detail screen already reaches it. A known gap.
          className="[&>p:nth-child(2)]:text-danger-600"
        />
      </section>

      {/* Withheld, itemised. */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Calls not credited, by binding</PanelTitle>
            <PanelDescription>
              calls our checks rejected, and calls that failed with a system or request error ·
              the split by class is on Reconciliation · no stake is taken yet
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        {/* Body — padding [6, 10, 10, 10]. The scroll is not in the
            frame: the frame is a 1440 canvas and the console renders down to
            tablet, where the design's own fixed column widths no longer fit.
            Contained here rather than left to push the whole page sideways. */}
        <PanelBody className="overflow-x-auto px-2.5 pb-2.5 pt-1.5">
          {withheldRows.length > 0 ? (
            <Table
              className="min-w-[520px]"
              columns={withheldColumns}
              rows={withheldRows}
              total={withheldTotal}
              caption="Calls not credited, by binding"
            />
          ) : earningsByTool.isError ? (
            /* A failed read is not a zero (BUG-R2-V3-02). */
            <p className="px-3 py-6 text-body-13 text-danger-600">
              These calls could not be loaded, so this table is unknown, not empty.
            </p>
          ) : earningsByTool.isPending ? (
            <p className="px-3 py-6 font-mono text-mono-13 text-03">Loading…</p>
          ) : (
            /* Ours — the frame draws no empty state. This is also the
               `?persona=new-provider` branch: 200 with no groups, not a 404. */
            <p className="px-3 py-6 text-body-13 text-02">
              Every call this month was credited: none was rejected and none failed.
            </p>
          )}
        </PanelBody>
      </Panel>

      {/* Payout history. */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Payout history</PanelTitle>
            <PanelDescription>
              Earnings are paid to your own wallet, on chain, as each call settles, so there is
              nothing to withdraw. The rows below are earlier scheduled payouts · we do not
              claw back a payment and hold no reserve against your account.
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="overflow-x-auto px-2.5 pb-2.5 pt-1.5">
          {payoutRows.length > 0 ? (
            <Table
              className="min-w-[1100px]"
              columns={[
                {
                  key: "batch",
                  header: "Batch",
                  mono: true,
                  cell: (row: PayoutRow) => <span className="font-semibold">{row.batch}</span>,
                },
                {
                  key: "period",
                  header: "Period",
                  width: 230,
                  align: "end",
                  mono: true,
                  cell: (r: PayoutRow) => r.period,
                },
                {
                  key: "calls",
                  header: "Calls",
                  width: 130,
                  align: "end",
                  mono: true,
                  cell: (r: PayoutRow) => r.calls,
                },
                {
                  key: "gross",
                  header: "Gross",
                  width: 130,
                  align: "end",
                  mono: true,
                  cell: (r: PayoutRow) => r.gross,
                },
                {
                  key: "take",
                  header: "Take",
                  width: 130,
                  align: "end",
                  mono: true,
                  cell: (r: PayoutRow) => r.take,
                },
                {
                  key: "net",
                  header: "Net",
                  width: 130,
                  align: "end",
                  mono: true,
                  cell: (r: PayoutRow) => r.net,
                },
                {
                  key: "tx",
                  header: "Tx",
                  width: 160,
                  align: "end",
                  mono: true,
                  cell: (r: PayoutRow) => r.tx,
                },
              ]}
              rows={payoutRows}
              caption="Payout history"
            />
          ) : (
            /* Ours. Past tense and terminal: the batch writer is retired, so an
               empty table here is not "nothing has arrived yet" — it is the
               complete record, and it stays empty. Nothing replaces it: money
               reaches the provider on chain, per call, without passing through
               this platform's hands at all. */
            <p className="px-3 py-6 text-body-13 text-02">
              No scheduled payouts were ever made, and none will be — your share of every
              settled call is paid straight to your wallet when the voucher is redeemed.
            </p>
          )}
        </PanelBody>
      </Panel>

      {/*
        Ours, and it is the honest caption for four dashed columns: nothing on
        the wire links a PAYOUT ledger entry to the calls it settled, so the
        per-batch decomposition the header promises cannot be drawn yet.
      */}
      <p className="text-body-13 text-03">
        Period, Calls, Gross and Take are not available for these payouts. Use Export CSV for
        the per-call detail, which is also the per-payment detail: there is one on-chain
        payment per settled call.
      </p>
    </>
  );
}
