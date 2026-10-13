"use client";

import { Code2, ExternalLink } from "lucide-react";
import Link from "next/link";
import * as React from "react";

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
  "Balances counted here are held in a pooled vault that the platform controls. This page is " +
  "how you check that the vault holds at least what the ledger owes. Per-account balance caps " +
  "may apply.";

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
        <Banner
          tone="danger"
          title="Could not load proof of reserves"
          description="The figures are not available right now. This page shows nothing rather than showing numbers it cannot stand behind."
        />
      </Shell>
    );
  }

  if (configured === null) {
    return (
      <Shell>
        <p className="text-body-13 text-02">Loading…</p>
      </Shell>
    );
  }

  // Not an error state — this deployment publishes no reserves page. Rendering
  // empty tiles here would read as zero reserves.
  if (configured === false || data === null) {
    return (
      <Shell>
        <Banner
          tone="primary"
          title="Proof of reserves is not available yet"
          description="We are not publishing reserve figures here yet, so there is nothing to show. That is not a shortfall."
        />
        <p className="text-body-13 text-02">
          You can still read{" "}
          <Link href="/how-it-works" className="text-primary-500 underline">
            how a call is checked before it is charged
          </Link>{" "}
          or browse{" "}
          <Link href="/catalogue" className="text-primary-500 underline">
            the tools and prices
          </Link>
          .
        </p>
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
      sub: data.asset ? `CAIP-19 ${data.asset}` : undefined,
    },
    // No signer count is printed — see the file docstring.
    {
      label: "Control",
      value: "Squads multisig",
      sub: "signer threshold is on the multisig account",
    },
    {
      label: "Withdrawals",
      value: "wallet signature required",
      sub: "a session token can never move value",
    },
    { label: "Reconciler", value: "every 5 minutes", sub: "vault balance vs ledger liabilities" },
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
        ? `${data.stake.providerCount} providers · read at ${utc(data.stake.readAt)}`
        : "no stake reading yet",
    },
  ];

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-[6px]">
          <h1 className="text-display-sm text-01">Proof of reserves</h1>
          <p className="text-body-15 text-02">
            Compares the USDC held in the reserve vault on-chain with the ledger&apos;s
            liabilities, verifiable without an account. Reconciled every five minutes.
          </p>
          {network && <p className="font-mono text-mono-2xs tracking-[1.1px] text-03">{network}</p>}
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
          <a
            href="/api/v1/public/reserves"
            className="flex items-center gap-2 rounded-lg border border-02 px-3 py-2 text-label-13 text-01"
          >
            <Code2 className="h-4 w-4" />
            API
          </a>
        </div>
      </div>

      {never && (
        <Banner
          tone="primary"
          title="No reserve check has run yet"
          description="The figures below are absent rather than zero. Nothing has been checked, so nothing is being claimed."
        />
      )}

      {blind && (
        <Banner
          tone="danger"
          title="The last reconciliation failed"
          description="The most recent check could not read the chain, so there are no current figures to publish. Earlier readings are in the history below with the time they were taken."
        />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Vault balance"
          value={money(data.vaultBalance, data.decimals, data.asset)}
          sub={
            data.vaultSlot
              ? `observed on-chain · slot ${slot(data.vaultSlot)}`
              : "observed on-chain · slot not recorded"
          }
        />
        <MetricTile
          label="Ledger liabilities"
          value={money(data.totalLiabilities, data.decimals, data.asset)}
          sub="sum of all user balances and holds"
        />
        <MetricTile
          // Teal is the frame's treatment for a difference of exactly zero. A
          // shortfall or a surplus is not a reassuring state and must not be
          // painted like one.
          tone={data.difference === "0" ? "teal" : "default"}
          label="Difference"
          value={money(data.difference, data.decimals, data.asset)}
          sub={
            data.reconciledAt ? `reconciled ${utc(data.reconciledAt)}` : "not yet reconciled"
          }
        />
        <MetricTile
          label="Accounts"
          value={data.accounts === null ? ABSENT : data.accounts.toLocaleString("en-US")}
          sub="with a non-zero balance"
        />
      </div>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>The vault</PanelTitle>
            <PanelDescription>one address, no commingling with operating funds</PanelDescription>
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
            <PanelTitle>Reconciliation history</PanelTitle>
            <PanelDescription>
              a non-zero difference is a public incident, not a private one
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody>
          {data.history.length === 0 ? (
            <p className="text-body-13 text-02">No reconciliation has been recorded yet.</p>
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
                  header: "Liabilities",
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
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-4 px-7 pb-7 pt-6">{children}</div>
  );
}
