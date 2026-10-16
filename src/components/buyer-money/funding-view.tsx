"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpFromLine, ExternalLink, Info, Plus, RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { formatLimit } from "@/components/g31/format";
import { CapMeter } from "@/components/patterns/cap-meter";
import { LocalTime } from "@/components/patterns/local-time";
import { MoneyFlow, MoneySplit } from "@/components/patterns/money-flow";
import { PageState, Skeleton, SkeletonRows } from "@/components/patterns/page-state";
import { StatusChip, type StatusChipKey } from "@/components/patterns/status-chip";
import { StatusTimeline } from "@/components/patterns/status-timeline";
import { TestnetChip } from "@/components/patterns/testnet-chip";
import { Term } from "@/components/patterns/term";
import { Button } from "@/components/ui/button";
import { windowRefillAt } from "@/features/buyer-money/refill";
import { isLowBalance, runwayDays, runwayLine } from "@/features/buyer-money/runway";
import { chainBalances } from "@/features/g30/balance";
import { chargedFromTotals } from "@/features/g30/spend-buckets";
import { useCountdown } from "@/hooks/useCountdown";
import { useSearchParam } from "@/hooks/useSearchParam";
import type { Money } from "@/interfaces";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { shortAddress } from "@/libs/chains/format";
import { freeCallsOnlyText, freeOnlyCeilingText, servesPaidCalls } from "@/libs/chains/paid-rails";
import { plainError } from "@/libs/plain-language";
import { assetName, chainDisplayName, findChain } from "@/services/chains.service";
import { listDeposits, type Deposit } from "@/services/funding.service";
import { getReceiptsSummary } from "@/services/receipts.service";
import { cn } from "@/utils";
import { formatMoney, toDecimal } from "@/utils/money";

import { CapsSheet } from "./caps-sheet";
import { DepositSheet } from "./deposit-sheet";
import { PendingTxList } from "./pending-tx-list";
import { useBuyerMoney } from "./use-buyer-money";
import { ClaimSheet, WithdrawSheet } from "./withdraw-sheets";

/**
 * Money › Funding: how much the agents can spend, where it sits, and the four
 * things a buyer does with it — add, cap, withdraw, claim — each in a drawer
 * opened from here. Deep links (`/funding?action=deposit|withdraw|caps|claim`)
 * open the same drawers; the old routes redirect to them.
 */
export type MoneyAction = "deposit" | "withdraw" | "cancel-withdraw" | "caps" | "claim";
const ACTIONS: readonly MoneyAction[] = ["deposit", "withdraw", "cancel-withdraw", "caps", "claim"];

const DEPOSIT_STATUS: Record<Deposit["status"], { label: string; tone: string }> = {
  CREATED: { label: "Waiting for the transfer", tone: "text-03" },
  SETTLING: { label: "Confirming on chain", tone: "text-warning-700" },
  SETTLED: { label: "Credited", tone: "text-success-700" },
  FAILED: { label: "Failed", tone: "text-danger-600" },
  EXPIRED: { label: "Expired, nothing taken", tone: "text-03" },
};

function positive(money: Money | null | undefined): boolean {
  return Boolean(money && BigInt(money.amount || "0") > 0n);
}

/** The drawers, so Overview and Get started can open them too. */
export function MoneyDrawers({
  action,
  onAction,
}: {
  action: MoneyAction | null;
  onAction: (next: MoneyAction | null) => void;
}) {
  const close = (open: boolean) => {
    if (!open) onAction(null);
  };
  return (
    <>
      <DepositSheet open={action === "deposit"} onOpenChange={close} onSetCaps={() => onAction("caps")} />
      <CapsSheet open={action === "caps"} onOpenChange={close} />
      <WithdrawSheet open={action === "withdraw"} onOpenChange={close} />
      <WithdrawSheet open={action === "cancel-withdraw"} onOpenChange={close} mode="cancel" />
      <ClaimSheet open={action === "claim"} onOpenChange={close} />
    </>
  );
}

function weekBounds(): { from: string; to: string } {
  const to = new Date();
  return { from: new Date(to.getTime() - 7 * 86_400_000).toISOString(), to: to.toISOString() };
}

export function FundingView() {
  const router = useRouter();
  const pathname = usePathname();
  const requested = useSearchParam("action");
  // Statements is its own page; an old `?tab=statements` link goes there.
  const tab = useSearchParam("tab");
  React.useEffect(() => {
    if (tab === "statements") router.replace("/statements");
  }, [tab, router]);
  const [action, setAction] = React.useState<MoneyAction | null>(null);
  const [seenRequest, setSeenRequest] = React.useState("");
  if (requested !== seenRequest) {
    setSeenRequest(requested);
    if ((ACTIONS as readonly string[]).includes(requested)) setAction(requested as MoneyAction);
  }
  const onAction = (next: MoneyAction | null) => {
    setAction(next);
    if (next === null && requested) router.replace(pathname);
  };

  const money = useBuyerMoney();
  const { escrow, escrowQuery, balancesQuery, chains } = money;
  const balances = chainBalances(balancesQuery.data?.balances);

  const week = React.useMemo(() => weekBounds(), []);
  const weekSpend = useQuery({
    queryKey: ["receipts-summary", "week", week.from.slice(0, 13)],
    queryFn: () => getReceiptsSummary({ from: week.from, to: week.to, groupBy: "tool" }),
    retry: 0,
  });
  // "Spent" is charged only, the same figure as Spend's headline (P2-3).
  const charged7d = chargedFromTotals(
    (weekSpend.data as { totals?: { chargedTotal?: Money; owedTotal?: Money } } | undefined)?.totals,
  );

  // No escrow yet means nothing to spend: never fall back to a ledger figure,
  // or a brand-new account reads as funded.
  const noEscrow = escrow !== null && escrow.exists === false;
  const spendable = noEscrow
    ? null
    : (escrow?.spendable ?? (balances.length === 1 ? balances[0]!.available : null));
  const runway = noEscrow ? null : runwayLine(runwayDays(spendable, charged7d));
  const withdrawalPending = positive(escrow?.withdrawRequested);
  const { hasPassed: matured } = useCountdown(escrow?.withdrawAvailableAt);
  const unreadable = escrowQuery.isError || (escrow !== null && !escrow.chainReadable);
  // Solana serves free calls only (paid rails off): no deposit is offered there; withdrawing still works.
  const freeOnly = money.chainId !== null && !servesPaidCalls(money.chainId);

  return (
    <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:gap-5 tablet:px-7 tablet:py-[22px]">
      <h1 className="sr-only">Funding</h1>
      <PendingTxList />

      {unreadable ? (
        <div role="alert" className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-warning-20 bg-warning-10 px-4 py-3">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-warning-600" />
          <p className="min-w-0 flex-1 text-body-13 text-warning-700">
            {escrowQuery.isError
              ? plainError(escrowQuery.error?.code)
              : `We couldn't read ${money.chainName ?? "the chain"} just now, so on-chain figures are missing (not zero).`}
          </p>
          <Button size="sm" variant="secondary" icon={<RotateCw />} type="button" onClick={() => void escrowQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      {/* Hero: the one number, and the two things to do with it. */}
      <section aria-label="Spendable balance" className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 p-5 shadow-soft tablet:flex-row tablet:items-end tablet:justify-between tablet:p-6">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-body-13 text-02">
            {noEscrow
              ? "No money added yet"
              : freeOnly
                ? "In your escrow: not spent on calls on this chain; you can withdraw it"
                : "Available now: your agents can spend it, or you can withdraw it"}
            <TestnetChip chain={money.chain} />
          </span>
          {escrowQuery.isPending ? (
            <Skeleton className="h-10 w-44" />
          ) : (
            <span className="font-mono text-[34px] font-semibold leading-tight tracking-[-0.02em] text-01" data-testid="funding-spendable">
              {noEscrow ? "$0.00" : spendable ? formatMoney(spendable) : "—"}
            </span>
          )}
          {noEscrow ? (
            <span className="text-body-13 text-02">
              Add funds to let your agent pay; free calls already work. Your first deposit opens your escrow.
            </span>
          ) : (
            <span className="text-body-xs text-03">
              {money.symbol} on {money.chainName ?? "your chain"}
              {escrow?.openHolds && positive(escrow.openHolds)
                ? ` · ${formatLimit(escrow.openHolds)} more is held by calls being checked; it comes back or goes to providers within minutes`
                : ""}
            </span>
          )}
          {/* No runway on a free-only chain: nothing is spent from the escrow there. */}
          {runway && !freeOnly ? <span className="text-body-13 text-02">{runway}</span> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2.5">
          {escrow?.exists ? (
            <Button variant="secondary" icon={<ArrowUpFromLine />} type="button" onClick={() => onAction("withdraw")}>
              Withdraw
            </Button>
          ) : null}
          {freeOnly ? null : (
            <Button icon={<Plus />} type="button" onClick={() => onAction("deposit")}>
              Add funds
            </Button>
          )}
        </div>
      </section>

      {freeOnly ? (
        <div
          className="flex w-full items-start gap-3 rounded-lg border border-warning-20 bg-warning-10 px-4 py-3"
          data-testid="escrow-free-calls-only"
        >
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-600" />
          <p className="min-w-0 flex-1 text-body-13 text-warning-700">
            {freeCallsOnlyText(money.chainName ?? "This chain")} You can still withdraw what it holds.
          </p>
        </div>
      ) : null}

      {spendable && isLowBalance(spendable) && !withdrawalPending && !freeOnly ? (
        <div className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-warning-20 bg-warning-10 px-4 py-3">
          <p className="min-w-0 flex-1 text-body-13 text-warning-700">
            Your balance is below $5.00. Paid calls are refused once it runs out; free calls keep working.
          </p>
          <Button size="sm" type="button" onClick={() => onAction("deposit")}>
            Add funds
          </Button>
        </div>
      ) : null}

      <p className="text-body-13 text-02">
        Your money sits in your <Term k="escrow" inline>escrow</Term>, a contract on {money.chainName ?? "the chain"} that only your
        wallet can withdraw from. Each paid call holds its price there until the result passes its check; only then is the
        provider paid.
      </p>

      {/* The escrow card. */}
      {escrowQuery.isPending ? (
        <div className="rounded-xl border border-01 bg-01 p-5">
          <SkeletonRows rows={4} />
        </div>
      ) : noEscrow ? null : escrow ? (
        <EscrowCard
          money={money}
          matured={matured}
          withdrawalPending={withdrawalPending}
          freeOnly={freeOnly}
          onAction={onAction}
        />
      ) : null}

      {balances.length > 1 ? <AccountBalances balances={balances} chains={chains} /> : null}

      <DepositsList />

      <MoneyDrawers action={action} onAction={onAction} />
    </div>
  );
}

function EscrowCard({
  money,
  matured,
  withdrawalPending,
  freeOnly,
  onAction,
}: {
  money: ReturnType<typeof useBuyerMoney>;
  matured: boolean;
  withdrawalPending: boolean;
  /** A free-calls-only chain: no account ceiling or 24-hour meter, nothing is spent there. */
  freeOnly: boolean;
  onAction: (next: MoneyAction) => void;
}) {
  const escrow = money.escrow!;
  const status: StatusChipKey = withdrawalPending
    ? matured
      ? "claimable"
      : "withdrawal-pending"
    : freeOnly
      ? "ready"
      : money.capsSet
        ? "paying"
        : "caps-not-set";
  const balance = escrow.balance;
  const held = escrow.openHolds;
  const requested = escrow.withdrawRequested;
  const free = escrow.spendable;
  const refillsAt = windowRefillAt(escrow.windowStartedAt, escrow.windowSeconds);

  return (
    <section aria-label="Escrow" className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5">
      <header className="flex w-full flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-label-md text-01">Escrow on {money.chainName ?? "your chain"}</h2>
          <span className="text-body-xs text-03">
            {balance ? `${formatLimit(balance)} ${money.symbol}` : "Balance unknown"}
            {money.ownerShort ? ` · owned by your wallet ${money.ownerShort}` : ""}
          </span>
        </div>
        <StatusChip status={status} />
      </header>

      <MoneyFlow
        nodes={[
          { label: "Your wallet", note: "deposits" },
          { label: "Escrow", amount: balance ? formatLimit(balance) : "—", tone: "primary" },
          { label: "Providers", note: "paid per checked call" },
        ]}
      />
      {balance && positive(balance) ? (
        <MoneySplit
          segments={[
            { label: "Available", value: free ? toDecimal(free).toNumber() : 0, amount: formatLimit(free), tone: "primary" },
            { label: "Held by calls in flight", value: held ? toDecimal(held).toNumber() : 0, amount: formatLimit(held), tone: "warning" },
            ...(withdrawalPending && requested
              ? [{ label: "Asked to withdraw", value: toDecimal(requested).toNumber(), amount: formatLimit(requested), tone: "neutral" as const }]
              : []),
          ]}
          showPercent={false}
        />
      ) : null}

      {/* Account ceiling: nothing to count on a free-calls-only chain (B4/B5). */}
      {freeOnly ? (
        <div className="flex w-full flex-col gap-1 rounded-lg border border-01 bg-02 p-3.5" data-testid="ceiling-free-only">
          <span className="text-label-13 text-01">Account ceiling (on chain)</span>
          <p className="text-body-xs text-03">{freeOnlyCeilingText(money.chainName ?? "this chain")}</p>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-02 p-3.5">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-label-13 text-01">Account ceiling (on chain)</span>
            <Button size="sm" variant={money.capsSet ? "secondary" : "primary"} type="button" onClick={() => onAction("caps")}>
              {money.capsSet ? "Change account ceiling" : "Set account ceiling"}
            </Button>
          </div>
          {money.capsSet ? (
            <>
              <p className="text-body-xs text-03">
                Up to {formatLimit(escrow.maxVoucherAmount)} a call, for all your agents together. Each agent&apos;s own
                spending limits sit under it:{" "}
                <Link href="/limits" className="font-semibold text-primary-600 hover:underline">
                  Spending limits
                </Link>
                .
              </p>
              <CapMeter
                label="Spent from your escrow in the last 24 hours, all agents"
                used={escrow.spentInWindow ?? { amount: "0", asset: "", decimals: money.decimals }}
                limit={escrow.maxPerWindow}
                refillsAt={refillsAt}
                refillHint="your time; 24 h after the first payment in the window"
              />
            </>
          ) : (
            <p className="text-body-13 text-warning-700">
              Paid calls are refused until you set it. It takes one free signature.
            </p>
          )}
        </div>
      )}

      {/* Withdrawal in progress. */}
      {withdrawalPending && requested ? (
        <div className="flex w-full flex-col gap-3 rounded-lg border border-primary-20 bg-primary-5 p-3.5">
          <p className="text-body-13 text-01">
            Withdrawal of up to {formatLimit(requested)}. Your agents cannot pay until you claim or cancel it.
          </p>
          <StatusTimeline
            label="Withdrawal"
            orientation="auto"
            steps={[
              { id: "request", label: "Requested", state: "done" },
              {
                id: "wait",
                label: matured ? "Ready" : "Wait ~1 hour",
                state: matured ? "done" : "current",
                date: escrow.withdrawAvailableAt,
                countdown: !matured,
              },
              { id: "claim", label: "Claim (you pay gas)", state: matured ? "current" : "upcoming" },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            {matured ? (
              <Button type="button" onClick={() => onAction("claim")}>
                Claim {formatLimit(requested)}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => onAction("cancel-withdraw")}>
              Cancel request
            </Button>
          </div>
        </div>
      ) : null}

      {escrow.observedAt ? (
        <p className="text-body-xs text-03">
          Read from the chain <LocalTime value={escrow.observedAt} />.
        </p>
      ) : null}
    </section>
  );
}

export function AccountBalances({
  balances,
  chains,
}: {
  balances: readonly ReturnType<typeof chainBalances>[number][];
  chains: ReturnType<typeof useBuyerMoney>["chains"];
}) {
  return (
    <section aria-label="Balances by account" className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 p-4 tablet:p-5">
      <h2 className="text-label-md text-01">Platform balance by account</h2>
      <p className="text-body-xs text-03">Each account and chain is spent separately; they are never added together.</p>
      <ul className="flex flex-col divide-y divide-01">
        {balances.map((row) => (
          <li key={`${row.accountId}|${row.asset}`} className="flex items-baseline justify-between gap-3 py-2">
            <span className="min-w-0 truncate text-body-13 text-02">
              {chainDisplayName(chains, row.chainId)} · {assetName(chains, row.asset)} ·{" "}
              {shortAddress(row.chainId, row.accountId.split(":").slice(2).join(":"))}
              {servesPaidCalls(row.chainId) ? null : " · free calls only here, so it is not spent on calls"}
            </span>
            <span className="shrink-0 font-mono text-mono-13 text-01">{formatMoney(row.available)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DepositsList() {
  const { chains } = useBuyerMoney();
  const [all, setAll] = React.useState(false);
  const deposits = useQuery({
    queryKey: ["deposits"],
    queryFn: () => listDeposits({ limit: 25 }),
    retry: 0,
    networkMode: "always" as const,
  });
  const items = deposits.data?.items ?? [];
  const shown = all ? items : items.slice(0, 5);

  return (
    <section aria-label="Deposits" className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 p-4 tablet:p-5">
      <h2 className="text-label-md text-01">Deposits</h2>
      {deposits.isPending ? (
        <SkeletonRows rows={3} />
      ) : deposits.isError ? (
        <PageState kind="error" title="Deposits could not be loaded" onRetry={() => void deposits.refetch()} />
      ) : items.length === 0 ? (
        <p className="py-2 text-body-13 text-03">No deposits yet. Each one shows here as soon as the chain sees it.</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-01">
            {shown.map((d) => {
              const chain = findChain(chains, d.chainId);
              const status = DEPOSIT_STATUS[d.status];
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2.5">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-mono text-mono-13 text-01">{formatMoney(d.settledAmount ?? d.requestedAmount)}</span>
                    <span className="text-body-xs text-03">
                      <LocalTime value={d.createdAt} />
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className={cn("text-body-xs", status.tone)}>{status.label}</span>
                    {d.chainTxRef && chain ? (
                      <a
                        href={explorerTxUrl(chain, d.chainTxRef)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-label-xs text-02 hover:underline"
                        aria-label="View this deposit on the explorer"
                      >
                        Explorer
                        <ExternalLink aria-hidden="true" className="size-3" />
                      </a>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {items.length > 5 ? (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="self-start rounded-md px-1 py-1 text-label-13 text-primary-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {all ? "Show fewer" : `See all ${items.length}`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
