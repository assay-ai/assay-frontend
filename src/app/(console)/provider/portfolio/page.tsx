"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, Info } from "lucide-react";
import { useMemo } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
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
import { getProviderStake } from "@/services/provider-stake.service";
import { listToolBindings } from "@/services/provider-tool-bindings.service";
import { formatMoney } from "@/utils/money";
import { labelForEndpoint } from "@/utils/provider-label";

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
 * Net 30d. Three of them have no first-class field on any provider endpoint,
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
 *   endpoint exposes one.
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
  binding: string;
  tool: string;
  mode: string;
  price: string;
  quality: string;
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

function shareCell(group: ProviderEarningsGroup | undefined, totalCalls: number): string {
  if (!group || totalCalls <= 0) return DASH;
  return `${Math.round((group.calls / totalCalls) * 100)}%`;
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
  const window30d = useMemo(() => last30Days(new Date()), []);

  /*
    The same query the `(console)` layout runs for the sidebar's binding rows,
    under the same key on purpose: it is the same request, and sharing the key
    means opening this screen costs no second round trip.
  */
  const bindings = useQuery({
    queryKey: ["provider", "tool-bindings", "sidebar"],
    queryFn: () => listToolBindings({ limit: 50 }),
  });

  const stake = useQuery({
    queryKey: ["provider", "stake"],
    queryFn: getProviderStake,
  });

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

  const rows: PortfolioRow[] = items.map((binding) => {
    const group = groupsByTool.get(binding.toolId);
    return {
      id: binding.id,
      binding: shortId(binding.id),
      tool: labelForEndpoint(binding.endpoint),
      mode: binding.pricingMode,
      price: priceCell(binding),
      // See the file docstring: no per-binding quality exists to read.
      quality: DASH,
      share: shareCell(group, totalCalls),
      stake: stakeCell(binding, stake.data?.requirement, chainKnown),
      net: netCell(group, earnings.data?.asset),
    };
  });

  const columns: TableColumn<PortfolioRow>[] = [
    {
      key: "binding",
      header: "Binding",
      mono: true,
      // The frame sets the identity cell at weight 600 while every other cell
      // is normal; Table has no per-column weight, so it rides on the value.
      cell: (row) => <span className="font-semibold">{row.binding}</span>,
    },
    { key: "tool", header: "Tool", width: 180, align: "end", mono: true, cell: (r) => r.tool },
    { key: "mode", header: "Mode", width: 110, align: "end", mono: true, cell: (r) => r.mode },
    { key: "price", header: "Price", width: 110, align: "end", mono: true, cell: (r) => r.price },
    {
      key: "quality",
      header: "Quality 30d",
      width: 130,
      align: "end",
      mono: true,
      cell: (r) => r.quality,
    },
    { key: "share", header: "Share", width: 100, align: "end", mono: true, cell: (r) => r.share },
    { key: "stake", header: "Stake", width: 110, align: "end", mono: true, cell: (r) => r.stake },
    { key: "net", header: "Net 30d", width: 130, align: "end", mono: true, cell: (r) => r.net },
  ];

  const total = {
    label: "Total",
    values: {
      tool: `${formatCount(items.length)} binding${items.length === 1 ? "" : "s"}`,
      // The frame writes an em-dash in every total that does not add up — a
      // pricing mode, a price, an average rate and a share are four of them.
      mode: DASH,
      price: DASH,
      quality: DASH,
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
          {/*
            DELIBERATE, RULED EXCEPTION to the verbatim-copy rule — the first
            one in this project. The design writes this subtitle
            as "Phase 2 · clone a working binding rather than authoring the
            next one from scratch"; the `Phase 2 · ` prefix is dropped here on
            purpose. It is a roadmap note addressed to whoever plans the
            product, not a sentence addressed to a provider, and shipping it
            would put internal scheduling on a screen a customer reads. The
            rest of the string is the design's, word for word.

            This is a decision, not a transcription slip. Do not restore the
            prefix to "match the design".
          */}
          <p className="font-mono text-mono-12 text-03">
            clone a working binding rather than authoring the next one from scratch
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {/*
            Drawn enabled on the frame, rendered disabled here. Cloning needs a
            target tool, and there is no tool-catalogue endpoint to pick one
            from — nor any clone route. A control that silently does nothing is
            worse than one that says it cannot.
          */}
          <Button disabled icon={<Copy />}>
            Clone binding
          </Button>
        </div>
      </header>

      {error ? (
        <Banner
          tone="danger"
          title="The portfolio could not be loaded"
          description={`${error.code} · ${error.message}`}
        />
      ) : null}

      {loading ? (
        <p role="status" aria-live="polite" className="text-body-md text-02">
          Loading your bindings…
        </p>
      ) : null}

      {!loading && !bindings.error ? (
        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>All bindings</PanelTitle>
              <PanelDescription>
                exposure is per provider, not per binding — adding one changes the whole picture
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
                title="No bindings yet"
                description="Publish a binding and it appears here with its price, share and net."
              />
            )}
          </PanelBody>
        </Panel>
      ) : null}

      {/* Note — bg-02, radius-lg, 1px border-01, gap 10, padding 15. */}
      <div className="flex w-full items-start gap-2.5 rounded-lg border border-01 bg-02 p-[15px]">
        <Info width={15} height={15} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0 text-03" />
        <p className="min-w-0 flex-1 text-body-13 text-02">
          Cloning bnd_7QK for a second tool re-uses its mapping shape and constraints but not its
          quality record. A new binding starts on the exploration floor and is sampled at 100% until
          it has a record of its own.
        </p>
      </div>
    </>
  );
}
