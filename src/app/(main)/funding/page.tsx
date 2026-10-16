"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpFromLine, Coins, Info, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { BalanceCards } from "@/components/funding/balance-cards";
import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { Table, type TableColumn } from "@/components/ui/table";
import { heldCallsText } from "@/features/buyer-debt/debt-copy";
import { useOwedIntentIds } from "@/features/buyer-debt/use-owed-intent-ids";
import { depositableChains } from "@/features/funding/depositable-chains";
import { ledgerEmptyNote } from "@/features/funding/ledger-empty";
import {
  addFundsTile,
  depositMethodLabel,
  fundingAssetNote,
} from "@/features/funding/settlement-asset";
import { chainBalances, type FullBalance, type Hold } from "@/features/g30/balance";
import { ErrorBlock, NoteBox, PageHeader, PendingBlock } from "@/features/g30/ui";
import { useChains } from "@/hooks/useChains";
import { ApiError } from "@/libs/ApiClient";
import type { BuyerEscrow, CursorPage } from "@/interfaces";
import { getBalances, getHolds } from "@/services";
import { getEscrow } from "@/services/escrow.service";
import { listDeposits, type Deposit } from "@/services/funding.service";
import { chainIdOfAccount } from "@/utils/chain";
import { formatMoney } from "@/utils/money";

/**
 * Funding and balance.
 *
 * Organization-scoped, and it is the hub for the other three money screens:
 * Add funds → /funding/deposit, Withdraw → /funding/withdraw, Auto top-up →
 * /funding/auto-top-up. Those are four separate pages on purpose — a tabbed
 * single page would put "put money in" and "take money out" one keystroke
 * apart.
 *
 * The design draws a "Card" funding method with `enabled: false`. It is not
 * rendered: this release has no card and no fiat on-ramp, which the screen's
 * own note says out loud.
 */

interface DepositRow extends Deposit {
  id: string;
}

const STATUS_LABEL: Record<Deposit["status"], string> = {
  CREATED: "Awaiting transfer",
  SETTLING: "Confirming",
  SETTLED: "Credited",
  FAILED: "Failed",
  EXPIRED: "Expired",
};

const STATUS_TONE: Partial<Record<Deposit["status"], string>> = {
  SETTLING: "text-warning-600",
  FAILED: "text-danger-600",
  EXPIRED: "text-danger-600",
};

function stamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

export default function FundingPage() {
  const balancesQuery = useQuery<{ balances: FullBalance[] }, ApiError>({
    queryKey: ["balances"],
    queryFn: () => getBalances() as Promise<{ balances: FullBalance[] }>,
    // No retries, and `networkMode: "always"`.
    //
    // Measured, not assumed: with the defaults this query sat at
    // `status: "pending", fetchStatus: "paused", failureCount: 1` forever
    // while the request had already rejected with ERR_NETWORK — React Query
    // PAUSES a pending retry rather than failing it, so /funding showed
    // "Loading balance…" indefinitely with the API down. A money screen that
    // cannot read its figures has to say so, immediately and in words.
    retry: 0,
    networkMode: "always" as const,
  });

  const holdsQuery = useQuery<CursorPage<Hold>, ApiError>({
    queryKey: ["holds"],
    queryFn: () => getHolds() as Promise<CursorPage<Hold>>,
    // No retries, and `networkMode: "always"`.
    //
    // Measured, not assumed: with the defaults this query sat at
    // `status: "pending", fetchStatus: "paused", failureCount: 1` forever
    // while the request had already rejected with ERR_NETWORK — React Query
    // PAUSES a pending retry rather than failing it, so /funding showed
    // "Loading balance…" indefinitely with the API down. A money screen that
    // cannot read its figures has to say so, immediately and in words.
    retry: 0,
    networkMode: "always" as const,
  });

  const depositsQuery = useQuery({
    queryKey: ["deposits"],
    queryFn: () => listDeposits({ limit: 25 }),
    // No retries, and `networkMode: "always"`.
    //
    // Measured, not assumed: with the defaults this query sat at
    // `status: "pending", fetchStatus: "paused", failureCount: 1` forever
    // while the request had already rejected with ERR_NETWORK — React Query
    // PAUSES a pending retry rather than failing it, so /funding showed
    // "Loading balance…" indefinitely with the API down. A money screen that
    // cannot read its figures has to say so, immediately and in words.
    retry: 0,
    networkMode: "always" as const,
  });

  /*
    `GET /escrow`, with NO chain argument.

    Two things on this screen need it and neither can be answered without it.

    1. An empty `GET /balances` is not an empty account. This buyer's ledger
       has no row and their escrow holds 500.00 USDG — so the sentence that
       stood here, "No balance to read for this account", was false at the one
       place a buyer looks first. `ledgerEmptyNote` needs the escrow to say
       something true instead.
    2. The chain the session is actually linked to. The controller takes the
       account from the session and never from the request (its own docstring
       says so), so `escrow.account` is the authoritative CAIP-10 — which is
       why `null` is passed rather than a chain this screen would have had to
       choose.

    `retry: 0` and `networkMode: "always"` for the same measured reason as the
    three queries above: React Query PAUSES a pending retry rather than failing
    it, and a money screen that cannot read something has to say so rather than
    spin.
  */
  const escrowQuery = useQuery<BuyerEscrow, ApiError>({
    queryKey: ["escrow", null],
    queryFn: () => getEscrow(null),
    retry: 0,
    networkMode: "always" as const,
  });

  const balances = chainBalances(balancesQuery.data?.balances);
  const { chains } = useChains();
  const openHolds = holdsQuery.data?.items.filter((h) => h.status === "OPEN") ?? [];
  const owedIntentIds = useOwedIntentIds();

  /*
    The same narrowing the deposit picker uses, from the same two sources, so
    the tile below and the screen it links to cannot advertise different
    chains.
  */
  const depositable = depositableChains(chains, {
    status: escrowQuery.isPending ? "loading" : escrowQuery.isError ? "error" : "ready",
    chainId: chainIdOfAccount(escrowQuery.data?.account),
  });
  const tile = addFundsTile(depositable);

  const depositColumns: TableColumn<DepositRow>[] = [
    { key: "date", header: "Date", mono: true, cell: (d) => stamp(d.createdAt) },
    {
      key: "method",
      header: "Method",
      width: 120,
      align: "end",
      mono: true,
      /*
        The symbol of THIS ROW's chain, off `GET /chains`. It was the literal
        `"USDC"` for every row, which relabels a Robinhood-testnet deposit —
        USDG — as a token that does not exist on that chain. `d.chainId`, never
        a chain picked once for the whole table: a two-chain buyer's history is
        two assets.
      */
      cell: (d) => depositMethodLabel(chains, d.chainId),
    },
    {
      key: "requested",
      header: "Requested",
      width: 110,
      align: "end",
      mono: true,
      cell: (d) => formatMoney(d.requestedAmount),
    },
    {
      key: "status",
      header: "Status",
      // 180 in the design; 200 here because "Credited · network fee" is a real
      // status string on this wire and 180 truncates it.
      width: 200,
      align: "end",
      mono: true,
      cell: (d) => (
        <span className={STATUS_TONE[d.status]}>
          {STATUS_LABEL[d.status]}
          {d.statusReason ? ` · ${d.statusReason}` : ""}
        </span>
      ),
    },
    {
      key: "credited",
      header: "Credited",
      width: 110,
      align: "end",
      mono: true,
      cell: (d) => (d.settledAmount ? formatMoney(d.settledAmount) : "—"),
    },
    {
      key: "reference",
      header: "Reference",
      width: 180,
      align: "end",
      mono: true,
      cell: (d) =>
        d.chainTxRef ? `${d.chainTxRef.slice(0, 4)}…${d.chainTxRef.slice(-4)}` : `${d.id.slice(0, 12)}…`,
    },
  ];

  const deposits: DepositRow[] = (depositsQuery.data?.items ?? []).map((d) => ({ ...d }));

  return (
    <div className="flex w-full flex-col gap-[18px] bg-02 px-4 py-5 tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Funding"
        sub="organization-scoped — the agent switcher is disabled here"
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/funding/withdraw">
                <ArrowUpFromLine aria-hidden="true" />
                Withdraw
              </Link>
            </Button>
            <Button asChild>
              <Link href="/funding/deposit">
                <Plus aria-hidden="true" />
                Add funds
              </Link>
            </Button>
          </>
        }
      />

      {balancesQuery.isPending ? <PendingBlock label="Loading balance…" /> : null}
      {balancesQuery.error ? (
        <ErrorBlock code={balancesQuery.error.code} message={balancesQuery.error.message} />
      ) : null}

      {balancesQuery.isPending || balancesQuery.error ? null : (
        <div className="flex w-full flex-col gap-4">
          {/*
            One card per chain, never a total. This block used to
            be a single "Balance" panel filled from `primaryBalance(...)`, i.e.
            `balances[0]` — which answered a two-chain buyer with one chain's
            money and said nothing about the other.

            The condition changed with it: it was `balance ? …`, so an account
            the API answered with zero rows rendered NOTHING at all here. Now
            the empty list reaches `BalanceCards`, which has a state for it.
          */}
          <div className="min-w-0 flex-1">
            <BalanceCards
              balances={balances}
              chains={chains}
              emptyNote={ledgerEmptyNote(
                {
                  status: escrowQuery.isPending
                    ? "loading"
                    : escrowQuery.isError
                      ? "error"
                      : "ready",
                  escrow: escrowQuery.data,
                },
                chains,
              )}
              heldSub={heldCallsText(
                openHolds.map((h) => h.intentId),
                owedIntentIds,
              )}
              depositsConfirming={
                depositsQuery.data?.items.some((d) => d.status === "SETTLING") ?? false
              }
            />
          </div>

          <Panel className="w-full">
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>Auto top-up</PanelTitle>
                <PanelDescription>OFF</PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-3.5 p-5">
              <div className="flex w-full items-center gap-3">
                {/* Reading only. The switch that actually changes anything is on
                    /funding/auto-top-up, where the required cap lives. */}
                <Link
                  href="/funding/auto-top-up"
                  className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <Switch checked={false} readOnly label="Off" tabIndex={-1} />
                  <span className="text-body-13 text-02">
                    Turning it on always requires a monthly cap.
                  </span>
                </Link>
              </div>
              <NoteBox tone="teal" icon={<Info className="h-full w-full" />}>
                Your maximum possible spend is your current balance. We cannot charge you more than
                you have deposited. Turning auto top-up on changes that — and we show you the
                resulting number before you save.
              </NoteBox>
            </PanelBody>
          </Panel>
        </div>
      )}

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Add funds</PanelTitle>
            <PanelDescription>
              minimum $5.00 · payments settle on-chain and are final
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-3.5 p-5">
          <div className="flex w-full flex-col gap-3 tablet:flex-row">
            <Link
              href="/funding/deposit?method=transfer"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border-[1.5px] border-primary-500 bg-primary-10 p-4 transition-colors hover:bg-primary-20"
            >
              <Coins aria-hidden="true" className="size-[18px] shrink-0 text-primary-500" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {/*
                  Both lines from `GET /chains`, narrowed to the chains this
                  buyer can deposit on. They read "Send USDC" and "Solana · to
                  your deposit address · ~40s" for every buyer, including one
                  on `eip155:46630` whose money is USDG, whose network is not
                  Solana, for whom no deposit address exists, and for whom that
                  timing was never measured.
                */}
                <span data-testid="add-funds-title" className="text-label-sm text-01">
                  {tile.title}
                </span>
                <span data-testid="add-funds-sub" className="font-mono text-mono-xs text-03">
                  {tile.sub}
                </span>
              </span>
            </Link>
            <Link
              href="/funding/deposit?method=wallet"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-02 bg-02 p-4 transition-colors hover:bg-03"
            >
              <Wallet aria-hidden="true" className="size-[18px] shrink-0 text-02" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-label-sm text-01">From connected wallet</span>
                <span className="font-mono text-mono-xs text-03">one signature</span>
              </span>
            </Link>
          </div>
          <NoteBox icon={<Info className="h-full w-full" />}>
            <span data-testid="funding-asset-note">{fundingAssetNote(depositable)}</span>
          </NoteBox>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Deposits</PanelTitle>
            <PanelDescription>
              the credited amount is what we observed on-chain — any difference from the requested
              amount is shown, never absorbed
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          {depositsQuery.error ? (
            <div className="p-3">
              <ErrorBlock
                code={(depositsQuery.error as ApiError).code}
                message={(depositsQuery.error as ApiError).message}
              />
            </div>
          ) : depositsQuery.isPending ? (
            <p className="px-3 py-6 text-body-13 text-03">Loading deposits…</p>
          ) : deposits.length === 0 ? (
            <p className="px-3 py-6 text-body-13 text-03">
              No deposits yet. A transfer appears here the moment it is observed on chain, before it
              is credited.
            </p>
          ) : (
            <div className="w-full overflow-x-auto">
              <div className="min-w-[860px]">
                <Table columns={depositColumns} rows={deposits} caption="Deposits" />
              </div>
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
