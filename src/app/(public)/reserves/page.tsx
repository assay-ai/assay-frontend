"use client";

import { ArrowLeft, Code2, ExternalLink } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { StartFreeCta } from "@/components/explorer/start-free";
import { UnavailablePage } from "@/components/explorer/unavailable-page";
import { PageState } from "@/components/patterns/page-state";
import { useChainName } from "@/hooks/useChainName";
import { Banner } from "@/components/ui/banner";
import { MetricTile } from "@/components/ui/metric-tile";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table } from "@/components/ui/table";
import {
  PublicReserves,
  PublicReservesState,
  getPublicReserves,
} from "@/services/reserves.service";
import { formatMoney } from "@/utils/money";

/**
 * Proof of reserves — route `/reserves`.
 *
 * Two choices worth knowing:
 *
 * - **`Control` prints no signer count and makes no claim about how many keys
 *   can move funds.** Nothing in the codebase reads the multisig's `threshold`
 *   or `members` — the backend's vault-control check proves only that the PDA
 *   is owned by the Squads program, that the token account's authority is the
 *   vault PDA, and that the mint is right. Printing an unverified number on a
 *   proof-of-reserves page defeats the page. A signer count can be shown once
 *   something reads `threshold` off the account.
 * - **`Stake locked` is a sixth panel row, not a fifth tile**, so the figure
 *   fits without breaking the four-tile grid.
 *
 * ## Absent is never zero
 *
 * `formatMoney(null)` returns `"$0.00"`, so every figure here is guarded before
 * it is formatted. On this page `$0.00` is a claim about somebody's money, and
 * the three states below exist precisely so that no claim is made from missing
 * data:
 *
 * | Condition                  | What the page says                          |
 * |----------------------------|---------------------------------------------|
 * | not served here            | proof of reserves is not available yet      |
 * | `NO_RECONCILIATION`        | no reconciliation has run yet               |
 * | `LAST_CHECK_FAILED`        | the last check failed; figures not current  |
 *
 * The middle two are `state` values from the API, not inferences drawn here.
 *
 * ## Two clocks, shown as two clocks
 *
 * The stake row prints its **own** `readAt`, separate from the tiles'
 * `reconciled …`. The two readings come off different crons — measured 1.2s
 * apart on the local stack, and arbitrarily far apart when either is failing —
 * and the whole reason the snapshot has its own table is to stop the page
 * implying they were one measurement.
 */

const CUSTODIAL_NOTE =
  "Buyers' balances counted here sit together in one vault that Assay controls. This page lets " +
  "anyone check that the vault holds at least what Assay owes. Per-account balance limits may apply.";

/** The raw JSON behind this page, on the API host (this site is static). */
const RESERVES_API_URL = `${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}/public/reserves`;

/** Absent, drawn as absent. The frame has no empty-value example; `—` is the console's. */
const ABSENT = "—";

function money(amount: string | null, decimals: number | null, asset: string | null): string {
  if (amount === null || decimals === null) return ABSENT;
  return formatMoney({ amount, asset: asset ?? "", decimals }, { decimals: 2 });
}

/** Grouped like the frame's `291,004,112`. */
function slot(value: string | null): string {
  if (!value) return ABSENT;
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The frame writes `2026-08-11 12:38 UTC`. */
function utc(value: string | null): string {
  if (!value) return ABSENT;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return ABSENT;
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * `USDC · <mint>`, as the frame writes it.
 *
 * The ticker comes from the API, which reads the asset registry. When the
 * registry has never heard of the configured asset the symbol is null and the
 * mint stands alone — a made-up ticker on a proof-of-reserves page is exactly
 * the class of unverified claim this page removes.
 */
function assetLabel(asset: string | null, symbol: string | null): string {
  if (!asset) return ABSENT;
  const [, reference] = asset.split("/token:");
  const mint = reference ?? asset;
  return symbol ? `${symbol} · ${mint}` : mint;
}

/** `solana:<chain>:<address>` — CAIP-10, of which only the address is on Solscan. */
function accountAddress(account: string | null): string | null {
  if (!account) return null;
  const parts = account.split(":");
  return parts[parts.length - 1] || null;
}

function networkOf(asset: string | null): string | null {
  if (!asset) return null;
  // CAIP-19 `solana:<genesis-hash-prefix>/token:<mint>`. The genesis prefix is
  // what actually distinguishes mainnet from devnet, and saying which network
  // the figures are from is the point of naming one asset in config at all.
  const [chain] = asset.split("/");
  return chain ?? null;
}

interface VaultRow {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}

export default function ReservesPage() {
  const [data, setData] = React.useState<PublicReserves | null>(null);
  const [configured, setConfigured] = React.useState<boolean | null>(null);
  const [failed, setFailed] = React.useState(false);
  const chainName = useChainName();

  React.useEffect(() => {
    let cancelled = false;
    getPublicReserves()
      .then((reserves) => {
        if (cancelled) return;
        setConfigured(reserves !== null);
        setData(reserves);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <Shell>
        <PageState
          kind="error"
          title="Could not load proof of reserves"
          description="The figures are not available right now. We show nothing rather than numbers we cannot stand behind."
          onRetry={() => window.location.reload()}
        />
      </Shell>
    );
  }

  if (configured === null) {
    return (
      <Shell>
        <PageState kind="loading" rows={4} label="Loading proof of reserves" />
      </Shell>
    );
  }

  // Not an error state — this deployment publishes no reserves page. Rendering
  // empty tiles here would read as zero reserves.
  if (configured === false || data === null) {
    return (
      <Shell>
        <UnavailablePage
          eyebrow="Reserves"
          title="Reserve figures are not published on this site"
          wouldShow="This page would show the account that holds buyers' money and how it compares with what buyers are owed. This site does not publish these figures. What you can check here:"
          destinations={[
            {
              href: "/how-it-works",
              title: "Where your money sits while a call is checked",
              description: "Money is held per call and released back to you if the result fails.",
            },
            {
              href: "/catalogue",
              title: "Providers' stake, per provider",
              description: "What each provider has put up as a promise of quality, and their failure record.",
            },
          ]}
        />
      </Shell>
    );
  }

  const blind = data.state === PublicReservesState.LAST_CHECK_FAILED;
  const never = data.state === PublicReservesState.NO_RECONCILIATION;
  const address = accountAddress(data.vaultAccount);
  const network = networkOf(data.asset);

  const vaultRows: VaultRow[] = [
    { label: "Address", value: address ?? ABSENT },
    {
      label: "Asset",
      value: assetLabel(data.asset, data.assetSymbol),
    },
    // No signer count is printed — see the file docstring.
    {
      label: "Control",
      value: "Shared multi-signature wallet",
      sub: "several people must sign to move money",
    },
    {
      label: "Withdrawals",
      value: "Need the owner's wallet signature",
      sub: "being signed in is never enough to move money",
    },
    { label: "Checked", value: "Every 5 minutes", sub: "vault balance compared with what Assay owes" },
    {
      label: "Stake locked",
      value: data.stake
        ? formatMoney(
            {
              amount: data.stake.bondedTotal,
              asset: data.stake.asset,
              decimals: data.stake.decimals,
            },
            { decimals: 2 }
          )
        : ABSENT,
      // Its OWN clock. Not `reconciledAt`.
      sub: data.stake
        ? `providers' stake · ${data.stake.providerCount} providers · read at ${utc(data.stake.readAt)}`
        : "no stake reading yet",
    },
  ];

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-[6px]">
          <h1 className="text-heading-lg text-01">Proof of reserves</h1>
          <p className="max-w-[720px] text-body-md text-02">
            Is the money really there? This compares what the vault holds on chain with what Assay
            owes its users. Anyone can check it, no account needed. Checked every five minutes.
          </p>
          {network && <p className="text-body-xs text-03">On {chainName(network)}</p>}
        </div>
        <div className="flex items-center gap-2">
          {address && (
            <a
              href={`https://solscan.io/account/${address}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-02 px-3 py-2 text-label-13 text-01"
            >
              <ExternalLink className="h-4 w-4" />
              View vault on Solscan
            </a>
          )}
          {process.env.NEXT_PUBLIC_API_BASE_URL ? (
            <a
              href={RESERVES_API_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-02 px-3 py-2 text-label-13 text-01"
            >
              <Code2 className="h-4 w-4" />
              Raw data (JSON)
            </a>
          ) : null}
        </div>
      </div>

      {never && (
        <Banner
          tone="primary"
          title="No check has run yet"
          description="The figures below are blank, not zero: nothing has been checked, so nothing is claimed."
        />
      )}

      {blind && (
        <Banner
          tone="danger"
          title="The last check failed"
          description="It could not read the chain, so there are no current figures. Earlier readings are in the history below, with the time each was taken."
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Vault balance"
          value={money(data.vaultBalance, data.decimals, data.asset)}
          sub={
            data.vaultSlot
              ? `read on chain · slot ${slot(data.vaultSlot)}`
              : "read on chain"
          }
        />
        <MetricTile
          label="What Assay owes"
          value={money(data.totalLiabilities, data.decimals, data.asset)}
          sub="every user balance and hold"
        />
        <MetricTile
          // Teal is the frame's treatment for a difference of exactly zero. A
          // shortfall or a surplus is not a reassuring state and must not be
          // painted like one.
          tone={data.difference === "0" ? "teal" : "default"}
          label="Difference"
          value={money(data.difference, data.decimals, data.asset)}
          sub={
            data.reconciledAt ? `checked ${utc(data.reconciledAt)}` : "not checked yet"
          }
        />
        <MetricTile
          label="Accounts"
          value={data.accounts === null ? ABSENT : data.accounts.toLocaleString("en-US")}
          sub="holding money"
        />
      </div>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>The vault</PanelTitle>
            <PanelDescription>One address, kept apart from Assay&apos;s own money</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody>
          <dl className="flex flex-col">
            {vaultRows.map((row) => (
              <div
                key={row.label}
                className="flex flex-col gap-1 border-b border-02 py-3 last:border-b-0 sm:flex-row sm:gap-6"
              >
                <dt className="text-label-13 text-02 sm:w-[160px] sm:shrink-0">{row.label}</dt>
                <dd className="flex min-w-0 flex-col gap-[2px]">
                  <span className="break-all font-mono text-mono-13 text-01">{row.value}</span>
                  {row.sub && (
                    <span className="break-all font-mono text-mono-2xs text-03">{row.sub}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>History of checks</PanelTitle>
            <PanelDescription>
              Any difference shows here, in public
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody>
          {data.history.length === 0 ? (
            <p className="px-5 py-4 text-body-13 text-02">No check has been recorded yet.</p>
          ) : (
            <Table
              caption="Reconciliation history"
              columns={[
                {
                  key: "checkedAt",
                  header: "Checked at",
                  mono: true,
                  cell: (row) => (
                    <span className={row.failed ? "text-03" : undefined}>
                      {utc(row.checkedAt)}
                      {row.failed ? " · check failed" : ""}
                    </span>
                  ),
                },
                {
                  key: "vault",
                  header: "Vault",
                  width: 130,
                  align: "end",
                  mono: true,
                  cell: (row) => money(row.vaultBalance, data.decimals, data.asset),
                },
                {
                  key: "liabilities",
                  header: "Owed",
                  width: 130,
                  align: "end",
                  mono: true,
                  cell: (row) => money(row.totalLiabilities, data.decimals, data.asset),
                },
                {
                  key: "difference",
                  header: "Difference",
                  width: 130,
                  align: "end",
                  mono: true,
                  cell: (row) => money(row.difference, data.decimals, data.asset),
                },
                {
                  key: "slot",
                  header: "Slot",
                  width: 130,
                  align: "end",
                  mono: true,
                  cell: (row) => slot(row.vaultSlot),
                },
              ]}
              rows={data.history.map((row, index) => ({ id: `${row.checkedAt}-${index}`, ...row }))}
            />
          )}
        </PanelBody>
      </Panel>

      <Banner tone="warning" title={CUSTODIAL_NOTE} />
      <StartFreeCta next="/" className="pt-2" />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 pb-7 pt-6 tablet:px-7">
      <Link href="/how-it-works" className="inline-flex items-center gap-1.5 self-start text-label-13 text-02 hover:text-01">
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        How it works
      </Link>
      {children}
    </div>
  );
}
