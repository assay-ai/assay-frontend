"use client";

import { DisplayAssetSelect } from "@/components/display-asset-select";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useMemo } from "react";

import { Banner } from "@/components/ui/banner";
import { PageState } from "@/components/patterns/page-state";
import { useProviderToolNames } from "@/features/provider-binding/tool-name";
import { plainError } from "@/libs/plain-language";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn } from "@/components/ui/table";
import { formatCount, shortId } from "@/features/buyer/period";
import { ApiError } from "@/libs/ApiClient";
import type {
  Money,
  ProviderEarningsGroup,
  ProviderStakeRequirementItem,
  ToolBindingSummary,
} from "@/interfaces";
import { getProviderEarnings } from "@/services/provider-reports.service";
import { requirementChain } from "@/features/provider-stake/chain-stake";
import { formatMoney } from "@/utils/money";

import { wholePercents } from "./_lib/shares";
import { providerQueries } from "@/features/provider-home/queries";

/**
 * Binding portfolio.
 *
 * Page Header / Panel "All bindings" / Note, straight down the frame's `Main`.
 * The shell, its padding and its 16px gap come from the `(console)`
 * layout; nothing here draws a sidebar.
 *
 * All copy is verbatim from the design, including the subtitle's own "Phase 2 ·"
 * prefix — the design marks this as a later-phase screen. It is built anyway;
 * the words on the frame are still the words.
 *
 * ## The eight columns and where each one actually comes from
 *
 * The frame draws Binding · Tool · Mode · Price · Quality 30d · Share · Stake ·
 * Net 30d. "Stake" reads "Stake needed": it is the minimum each tool needs,
 * not what is staked (a provider with $119.95 staked read "$100.00" there). Three of them have no first-class field on any provider endpoint,
 * so they are assembled here rather than read:
 *
 * - **Stake** is `GET /providers/me/stake` → `requirement[]`, matched on
 *   `bindingId`. That list is **ACTIVE PAID/FREEMIUM bindings only**, so a
 *   PAUSED paid binding is absent from it — and absent is not zero. It renders
 *   The design's em-dash, not `$0.00`. A FREE binding needs no stake at all,
 *   which *is* a zero, and the frame's own FREE row writes `$0.00`.
 *   The total is `requirementTotal`, i.e. the **`max`** rule and not a sum —
 *   which is also why the frame's three rows read $50/$50/$0 and its total
 *   reads $50.00 rather than $100.00.
 * - **Net 30d** is `GET /providers/me/earnings?groupBy=tool` → `earned`, joined
 *   to the binding on `toolId`. `earned` is Σ provider_amount, already net of
 *   the platform fee, which is what "Net" names.
 * - **Share** is that same response's per-tool `calls` over `totals.calls` —
 *   the share of this provider's own served calls the binding carries. It is
 *   NOT a market share against other providers of the same tool; no provider
 *   endpoint exposes one. Calls on tools no longer listed here go to an
 *   "Other" row, and the shares are rounded so they add up to 100%.
 *
 * **Quality 30d has no source and renders `—` on every row.** Two independent
 * reasons, either of which alone would be enough: `/providers/me/quality` is
 * provider-wide with no per-binding breakdown, and its three rate fields
 * (`paidQualityRate`, `freeQualityRate`, `availabilityRate`) are hard-coded
 * `null` in the backend today. Deriving a rate from `withheldCalls / calls`
 * would put a real-looking number under a label that means something else, so
 * the column is left at the design's own unknown treatment — the frame already
 * writes `—` there on its FREE row.
 *
 * There is deliberately **no search box**: `ListQueryDto` accepts `search` on
 * `tool-bindings` and no service applies it, so the control would silently do
 * nothing.
 */

/** The 30 days the two "30d" columns are actually measured over, `[from, to)`. */
function last30Days(now: Date): { from: string; to: string } {
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

const DASH = "—";

interface PortfolioRow {
  id: string;
  tool: string;
  mode: string;
  price: string;
  share: string;
  stake: string;
  net: string;
}

function priceCell(binding: ToolBindingSummary): string {
  // A FREE binding has no price to state; the frame writes an em-dash, not
  // $0.0000. Four decimals is the design's per-call precision ($0.0035).
  if (binding.pricingMode === "FREE") return DASH;
  return formatMoney(binding.price, { decimals: 4 });
}

function stakeCell(
  binding: ToolBindingSummary,
  requirement: ProviderStakeRequirementItem[] | undefined,
  chainKnown: boolean,
): string {
  // FREE bindings are never listed in `requirement[]` because they require
  // nothing — that is a real zero, and the frame writes it as one.
  if (binding.pricingMode === "FREE") return "$0.00";
  if (!chainKnown) return DASH;
  const item = requirement?.find((r) => r.bindingId === binding.id);
  // Absent means "not an ACTIVE paid binding, so no requirement is computed",
  // and `minimum: null` means "priced in an asset the floor is not denominated
  // in". Neither is $0.00.
  if (!item || !item.minimum) return DASH;
  return formatMoney(item.minimum, { decimals: 2 });
}

function netCell(
  group: ProviderEarningsGroup | undefined,
  windowAsset: string | null | undefined,
): string {
  if (group?.earned) return formatMoney(group.earned, { decimals: 2 });
  // No group means the tool served nothing in the window. That is a zero — but
  // only sayable when the window matched *something*, because otherwise there
  // is no asset to denominate the zero in (`ProviderEarnings.asset` is null).
  return windowAsset ? "$0.00" : DASH;
}

export default function ProviderPortfolioPage() {
  const names = useProviderToolNames();
  const window30d = useMemo(() => last30Days(new Date()), []);

  /*
    The same query the `(console)` layout runs for the sidebar's binding rows,
    under the same key on purpose: it is the same request, and sharing the key
    means opening this screen costs no second round trip.
  */
  const bindings = useQuery(providerQueries.bindings());

  const stake = useQuery(providerQueries.stake());

  const earnings = useQuery({
    queryKey: ["provider", "earnings", "tool", window30d.from, window30d.to],
    queryFn: () => getProviderEarnings({ ...window30d, groupBy: "tool" }),
  });

  const items = bindings.data?.items ?? [];
  const groupsByTool = useMemo(() => {
    const map = new Map<string, ProviderEarningsGroup>();
    for (const group of earnings.data?.groups ?? []) map.set(group.key, group);
    return map;
  }, [earnings.data]);

  const totalCalls = earnings.data?.totals.calls ?? 0;
  /*
    Per chain, and about the chain the requirement is denominated in — the only
    one the stake cell compares against. Both flags used to be read at the top
    level of the response, where they no longer are: `undefined && undefined`
    is falsy, so every binding's stake cell had silently fallen to its unknown
    treatment for a provider whose chain had answered.
  */
  const stakeChain = requirementChain(stake.data);
  const chainKnown = Boolean(stakeChain?.hasKnownStake && stakeChain.chainReadable);

  /*
    Calls on tools that are not among the listed ones (a tool no longer
    listed, a removed draft): one "Other" row, so the shares add up to 100%.
  */
  const listedTools = new Set(items.map((binding) => binding.toolId));
  const otherGroups = (earnings.data?.groups ?? []).filter((group) => !listedTools.has(group.key));
  const otherCalls = otherGroups.reduce((sum, group) => sum + group.calls, 0);
  const otherEarned = otherGroups.reduce((sum, group) => sum + BigInt(group.earned?.amount ?? "0"), 0n);
  const otherDenom = otherGroups.find((group) => group.earned)?.earned ?? null;
  const shares = wholePercents(
    [...items.map((binding) => groupsByTool.get(binding.toolId)?.calls ?? 0), otherCalls],
    totalCalls,
  );

  const rows: PortfolioRow[] = items.map((binding, index) => {
    const group = groupsByTool.get(binding.toolId);
    return {
      id: binding.id,
      tool: names.bindingLabel(binding),
      mode: binding.pricingMode === "FREE" ? "Free" : binding.pricingMode === "FREEMIUM" ? "Free + paid" : "Paid",
      price: priceCell(binding),
      share: group && totalCalls > 0 ? `${shares[index]}%` : DASH,
      stake: stakeCell(binding, stake.data?.requirement, chainKnown),
      net: netCell(group, earnings.data?.asset),
    };
  });
  if (otherCalls > 0) {
    rows.push({
      id: "other",
      tool: `Other (${formatCount(otherGroups.length)} tool${otherGroups.length === 1 ? "" : "s"} not listed here)`,
      mode: DASH,
      price: DASH,
      share: `${shares[items.length]}%`,
      stake: DASH,
      net: otherDenom ? formatMoney({ ...otherDenom, amount: otherEarned.toString() }, { decimals: 2 }) : DASH,
    });
  }

  const columns: TableColumn<PortfolioRow>[] = [
    { key: "tool", header: "Tool", cell: (r) => <span className="font-semibold">{r.tool}</span> },
    { key: "mode", header: "How agents pay", width: 130, align: "end", cell: (r) => r.mode },
    { key: "price", header: "Price", width: 110, align: "end", mono: true, cell: (r) => r.price },
    { key: "share", header: "Share", width: 100, align: "end", mono: true, cell: (r) => r.share },
    { key: "stake", header: "Stake needed", width: 130, align: "end", mono: true, cell: (r) => r.stake },
    { key: "net", header: "Net 30d", width: 130, align: "end", mono: true, cell: (r) => r.net },
  ];

  const total = {
    label: "Total",
    values: {
      tool: `${formatCount(items.length)} tool${items.length === 1 ? "" : "s"}`,
      // The frame writes an em-dash in every total that does not add up — a
      // pricing mode, a price, an average rate and a share are four of them.
      mode: DASH,
      price: DASH,
      share: DASH,
      // `requirementTotal` is the `max` over the per-binding minima, not their
      // sum. Printing a sum here would overstate the floor on every provider
      // that runs more than one paid binding — which is this screen's subject.
      //
      // A `null` total is "nothing to stake against", NOT "$0 required" — the
      // state a provider reaches the moment their last paid binding pauses.
      // `formatMoney(null)` answers "$0.00", so it must not be reached with a
      // null; the row cells make the same distinction above.
      stake:
        chainKnown && stake.data?.requirementTotal
          ? formatMoney(stake.data.requirementTotal, { decimals: 2 })
          : DASH,
      net: earnings.data?.totals.earned
        ? formatMoney(earnings.data.totals.earned, { decimals: 2 })
        : DASH,
    } as Partial<Record<string, React.ReactNode>>,
  };

  const error = [bindings.error, stake.error, earnings.error].find(
    (e): e is ApiError => e instanceof ApiError,
  );
  const loading = bindings.isLoading;

  return (
    <>
      {/* Page Header — row, gap 16, space-between, centred. */}
      <header className="flex w-full items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Portfolio</h1>
          <p className="text-body-13 text-03">
            Every tool you list, with its price, share of your calls, stake and earnings over 30 days.
          </p>
        </div>
      </header>

      <DisplayAssetSelect scope="provider" />

      {error ? (
        <Banner
          tone="danger"
          title="The portfolio could not be loaded"
          description={plainError(error.code)}
        />
      ) : null}

      {loading ? (
        <PageState kind="loading" rows={4} label="Loading your tools" />
      ) : null}

      {!loading && !bindings.error ? (
        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>All tools</PanelTitle>
              <PanelDescription>
                your stake covers all your tools together
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          {/* Body — padding [6, 10, 10, 10]. */}
          <PanelBody className="px-2.5 pb-2.5 pt-1.5">
            {rows.length > 0 ? (
              <Table columns={columns} rows={rows} total={total} caption="All bindings" />
            ) : (
              /*
                The design draws no empty state — it has three rows and nothing
                else. This copy is OURS, not the design's. It says the one thing that is true and actionable, and
                does not promise a Clone button that cannot run.
              */
              <EmptyState
                className="m-2.5"
                icon={null}
                title="No tools yet"
                description="Publish a tool and it appears here with its price, share and earnings."
              />
            )}
          </PanelBody>
        </Panel>
      ) : null}

      {/* Note — bg-02, radius-lg, 1px border-01, gap 10, padding 15. */}
      <div className="flex w-full items-start gap-2.5 rounded-lg border border-01 bg-02 p-[15px]">
        <Info width={15} height={15} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0 text-03" />
        <p className="min-w-0 flex-1 text-body-13 text-02">
          Each tool builds its own quality record. A new tool gets a fair share of calls and every call is
          checked until it has a record of its own.
        </p>
      </div>
    </>
  );
}
