"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Search } from "@/components/ui/search";
import { chainBalances, type FullBalance } from "@/features/g30/balance";
import { useChains } from "@/hooks/useChains";
import type { Chain } from "@/interfaces/chain";
import { ApiError } from "@/libs/ApiClient";
import { getBalances } from "@/services";
import { chainDisplayName } from "@/services/chains.service";
import { formatMoney, differs, notCharged } from "@/utils/money";

import { MicroLabel, PageHeader } from "./chrome";
import { ExploreNav } from "./explore-nav";
import { formatPrice, formatQuote } from "./format";
import { settlementReach } from "./settlement-reach";
import { useCatalogue, type ToolRow } from "./use-catalogue";
import { shortToolId } from "./use-tool-names";

/**
 * Tools.
 *
 * The design's footer states the rule this screen lives under as *"enforced
 * at the signer"*. **That sentence is not true yet and must not be repeated
 * here.** There is no signer yet: embedded wallets and session signers are
 * not built. An allowlist violation is refused by the gateway —
 * `SpendPolicyEnforcementService` on the `tools/call` path, answering
 * `MCP_TOOL_NOT_ALLOWED` (403) — which is a real control, but it is our
 * software, so a bug in our software can defeat it. Saying otherwise would be
 * the strongest claim in the product made falsely.
 *
 * **The allowlist now has a field to write to, and it is not on this screen.**
 * `allowedTools` is on `SpendPolicyDto` and `PATCH /spend-policy`; the
 * Limits screen (`/limits`) owns that write, including the
 * three-state meaning `null` (every tool) / a list / `[]` (no tool). This
 * screen still has no tools resource of its own — no name, description, free
 * quota or upstream — so it does not draw the design's per-row Allow toggle:
 * one screen writes the allowlist, and it is the one that can show all three
 * states at once.
 *
 * What is real is the traffic: every tool this organization has actually
 * called, its listed price, its quality measured through `presentVerdict()`,
 * and — per Foundations rule 01 — **listed and charged as two figures, always
 * both, even when they are equal**, with the difference shown as an amount
 * and never as a badge.
 */

/**
 * A tool's market depth: how many providers you could be routed to.
 *
 * This column replaced a per-tool quality rate. Quality is measured **per
 * provider** — it is a provider's closed SLA windows that decide their strikes
 * — so a per-tool rate could only ever have been either the caller's own
 * traffic (which is what made this screen empty for a new account) or an
 * average that hid the good provider behind the bad one. Depth is the honest
 * per-tool number: it says what happens when one provider fails, which is the
 * question routing actually answers.
 */
function ProviderCountCell({ tool }: { tool: ToolRow }) {
  if (tool.providerCount === 0) {
    return <span className="font-mono text-mono-12 text-03">none</span>;
  }

  return (
    <span className="font-mono text-mono-12 font-semibold text-01">
      {tool.providerCount} {tool.providerCount === 1 ? "provider" : "providers"}
    </span>
  );
}

/**
 * A tool the buyer's chains cannot reach is marked "Settles on <chain> — you
 * have no funds there" with a link to fund it, rather than hidden. Hiding it
 * makes the platform look like it lacks the tool.
 *
 * The row is **not** dimmed, not disabled and not filtered out. And it renders
 * nothing at all for `unknown` — which is every row on this deployment, because
 * `GET /catalogue/tools` carries no `settlementChains`. A caveat drawn on every
 * row is a caveat nobody reads.
 *
 * Exported for its own DOM test. `ToolsView` cannot be rendered by one — it
 * reads React Query and Privy — and a one-token mutation on a
 * list branch once deleted a money row from a shipped page while every test,
 * `tsc` and the build stayed green.
 */
export function SettlesElsewhere({
  tool,
  buyerChains,
  chains,
}: {
  tool: ToolRow;
  buyerChains: readonly string[];
  chains: readonly Chain[];
}) {
  const reach = settlementReach(tool.settlementChains, buyerChains);
  if (reach.kind !== "unreachable") return null;

  return (
    <p data-testid="settles-elsewhere" className="text-body-xs text-warning-600">
      Settles on {reach.toolChains.map((chain) => chainDisplayName(chains, chain)).join(", ")} — you
      have no funds there.{" "}
      <Link href="/funding/deposit" className="underline">
        Add funds on that chain
      </Link>
    </p>
  );
}

export function ToolsView() {
  const { tools, isPending, isError, error } = useCatalogue();
  const [query, setQuery] = React.useState("");

  /*
    The buyer's chains, read off their balances — one entry per chain they hold
    money on, never `balances[0]`. Empty while loading, on error, and for a
    buyer with no balance at all; `settlementReach` answers `unknown` for all
    three rather than marking every tool unpayable, because a shop that looks
    empty when one request failed is worse than one that says nothing.
  */
  const balancesQuery = useQuery<{ balances: FullBalance[] }, ApiError>({
    queryKey: ["balances"],
    queryFn: () => getBalances() as Promise<{ balances: FullBalance[] }>,
    retry: 0,
    networkMode: "always" as const,
  });
  const buyerChains = React.useMemo(
    () => chainBalances(balancesQuery.data?.balances).map((row) => row.chainId),
    [balancesQuery.data],
  );
  const { chains } = useChains();

  /**
   * Search matches the name **and** the id. Dropping the id would break the
   * one thing it was good for: pasting a uuid out of a receipt or a log line
   * and finding the row it belongs to.
   */
  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tools;
    return tools.filter(
      (tool) =>
        tool.toolId.toLowerCase().includes(needle) ||
        tool.name.toLowerCase().includes(needle) ||
        tool.description.toLowerCase().includes(needle)
    );
  }, [tools, query]);

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-4 tablet:gap-4 tablet:px-7 tablet:py-5">
      <ExploreNav />

      <PageHeader
        title="Tools"
        subtitle={`${tools.length} tools · every tool a provider serves right now, priced by the router · the allowlist is written on Limits`}
        actions={
          <Search
            wrapperClassName="w-full tablet:w-[260px]"
            placeholder="Search tools…"
            aria-label="Search tools"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        }
      />

      <div className="flex w-full items-start gap-2.5 rounded-lg border border-01 bg-01 px-4 py-3">
        <Building2 aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-03" />
        <p className="text-body-13 text-02">
          Every tool here is served by providers who have staked against it. <b>From</b> is the
          cheapest listed provider. <b>Quote</b> is what a call is held for: the dearest provider
          the router can use right now, so it reads &ldquo;up to&rdquo; when more than one could
          serve. You are charged the price of the provider that serves the call and the rest of
          the hold comes back. A listed provider the router cannot use right now is not in the
          quote. The last two columns are your own spend, and are empty until you call the tool.
        </p>
      </div>

      {isPending ? (
        <p className="font-mono text-mono-13 text-03">Loading tools…</p>
      ) : isError ? (
        <p className="text-body-13 text-danger-600">
          Tools could not be read: {error instanceof ApiError ? error.message : "the request failed"}.
        </p>
      ) : visible.length === 0 ? (
        <EmptyState
          title={query.trim() ? "No tool matches that search" : "No tool is being served yet"}
          description={
            query.trim()
              ? `${tools.length} tool${tools.length === 1 ? " is" : "s are"} listed. Search matches a tool's name, id and description.`
              : "This list is the whole platform, not your own traffic. A tool appears the moment a provider publishes an active binding for it."
          }
        />
      ) : (
        <>
          {/* Table, tablet and up. */}
          <div className="hidden w-full overflow-hidden rounded-xl border border-01 bg-01 tablet:block">
            <div className="w-full overflow-x-auto">
              <div className="min-w-[860px]">
                <div className="flex items-center gap-3 border-b border-01 bg-02 px-[18px] py-3">
                  <div className="min-w-0 flex-1">
                    <MicroLabel>Tool</MicroLabel>
                  </div>
                  <div className="w-[140px]">
                    <MicroLabel>Served by</MicroLabel>
                  </div>
                  <div className="w-[100px] text-right">
                    <MicroLabel>From</MicroLabel>
                  </div>
                  <div className="w-[100px] text-right">
                    <MicroLabel>Quote</MicroLabel>
                  </div>
                  <div className="w-[110px] text-right">
                    <MicroLabel>Your spend</MicroLabel>
                  </div>
                  <div className="w-[120px] text-right">
                    <MicroLabel className="text-teal-600">Not charged</MicroLabel>
                  </div>
                </div>

                {visible.map((tool) => (
                  <div
                    key={tool.toolId}
                    className="flex items-center gap-3 border-b border-01 px-[18px] py-3 last:border-b-0"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-mono text-mono-13 font-semibold text-01">
                        {tool.name}
                      </span>
                      <span className="truncate text-body-xs text-03" title={tool.toolId}>
                        {shortToolId(tool.toolId)}
                        {tool.yourCalls > 0
                          ? ` · ${tool.yourCalls} ${tool.yourCalls === 1 ? "call" : "calls"} from you`
                          : ""}
                        {tool.routable ? "" : ` · ${tool.unroutableReason ?? "not routable"}`}
                      </span>
                      <SettlesElsewhere tool={tool} buyerChains={buyerChains} chains={chains} />
                    </div>
                    <div className="w-[140px] min-w-0">
                      <ProviderCountCell tool={tool} />
                    </div>
                    <div className="w-[100px] text-right font-mono text-mono-12 text-01">
                      {formatPrice(tool.fromPrice)}
                    </div>
                    <div className="w-[100px] text-right font-mono text-mono-12 text-01">
                      {formatQuote(tool.price, tool.routableBindings, tool.pricingMode)}
                    </div>
                    <div className="w-[110px] text-right font-mono text-mono-12 text-01">
                      {formatMoney(tool.charged, { decimals: 4 })}
                    </div>
                    <div className="w-[120px] text-right font-mono text-mono-12 text-teal-600">
                      {tool.listed && tool.charged
                        ? formatMoney(notCharged(tool.listed, tool.charged), { decimals: 4 })
                        : "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Cards, mobile. Foundations "Breakpoints": row becomes a card. */}
          <div className="flex w-full flex-col gap-3 tablet:hidden">
            {visible.map((tool) => (
              <div key={tool.toolId} className="flex w-full flex-col gap-3 rounded-lg border border-01 bg-01 p-4">
                <div className="flex w-full items-center gap-2.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-mono text-mono-sm font-semibold text-01">
                      {tool.name}
                    </span>
                    <span className="truncate font-mono text-mono-xs text-03" title={tool.toolId}>
                      {shortToolId(tool.toolId)} · {tool.providerCount}{" "}
                      {tool.providerCount === 1 ? "provider" : "providers"}
                      {tool.yourCalls > 0 ? ` · ${tool.yourCalls} from you` : ""}
                    </span>
                    <SettlesElsewhere tool={tool} buyerChains={buyerChains} chains={chains} />
                  </div>
                </div>
                <div className="flex w-full gap-2.5">
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="text-body-xs text-03">Listed</span>
                    <span className="truncate font-mono text-mono-md font-semibold text-01">
                      {formatMoney(tool.listed, { decimals: 4 })}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="text-body-xs text-03">Charged</span>
                    <span className="truncate font-mono text-mono-md font-semibold text-01">
                      {formatMoney(tool.charged, { decimals: 4 })}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="text-body-xs text-03">Not charged</span>
                    <span className="truncate font-mono text-mono-md font-semibold text-teal-600">
                      {tool.listed && tool.charged
                        ? formatMoney(notCharged(tool.listed, tool.charged), { decimals: 4 })
                        : "—"}
                    </span>
                  </div>
                </div>
                <div className="flex w-full items-center justify-between gap-2.5 border-t border-01 pt-2.5">
                  <span className="font-mono text-mono-xs text-03">
                    from {formatPrice(tool.fromPrice)} · quote{" "}
                    {formatQuote(tool.price, tool.routableBindings, tool.pricingMode)}
                    {tool.listed && tool.charged && differs(tool.listed, tool.charged)
                      ? " · some calls were not charged"
                      : ""}
                  </span>
                  <ProviderCountCell tool={tool} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex w-full flex-col items-start gap-2.5 rounded-lg border border-primary-20 bg-primary-10 px-4 py-3 tablet:flex-row tablet:items-center">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-primary-600" />
        <p className="flex-1 text-body-13 text-primary-700">
          The allowlist is enforced by the gateway, on the way into a paid call — a tool outside it is refused before any money moves. It is our software doing the
          refusing, not a signer, so treat it as a control and not as a guarantee. The list itself
          lives on the spend policy and is edited on Limits; this screen shows every tool a
          provider serves right now, whether or not you have called it. A tool no provider serves
          yet is not listed.
        </p>
        <Button variant="secondary" size="sm" asChild>
          <Link href="/limits">Open Limits</Link>
        </Button>
      </div>
    </div>
  );
}
