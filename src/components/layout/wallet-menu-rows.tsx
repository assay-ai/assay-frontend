"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import * as React from "react";

import { chainBalances, type FullBalance } from "@/features/g30/balance";
import { useSigner } from "@/hooks/useSigner";
import type { Chain } from "@/interfaces/chain";
import { explorerAddressUrl } from "@/libs/chains/explorer";
import { shortAddress } from "@/libs/chains/format";
import { formatMoney } from "@/utils/money";

/**
 * The account menu's two per-chain lists, extracted so they can be rendered by
 * a test.
 *
 * **This extraction is a response to a measured miss.** Batch B changed
 * `rows.length === 0` to `!rows` in `close-account-view.tsx` — an array is
 * always truthy — and it deleted a money blocker from the rendered page while
 * 213 tests, `tsc --noEmit` and a 56/56 build all stayed green. The same
 * `.length` guard is in `BalanceRows` below, and it had no rendering test
 * either. It has one now (`wallet-menu-rows.dom.test.tsx`), and the components
 * live here rather than inline in the menu so that test does not have to mount
 * Radix's dropdown or a `PrivyProvider`.
 */

/**
 * `formatMoney(undefined)` is `$0.00`, and a zero balance and a balance that
 * could not be read are different facts — only one of them stops a call. The
 * Overview tile makes exactly this distinction (`app/(main)/page.tsx`); the
 * menu has to make the same one or the two surfaces contradict each other,
 * which is how this was caught: Overview said "— not available" while the menu
 * said "$0.00" for the same account in the same second.
 */
export function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-2.5 py-1">
      <span className="text-body-xs text-03">{label}</span>
      <span className="text-label-13 tabular-nums text-01">{value}</span>
    </div>
  );
}

/**
 * One chain's wallet row: both addresses, grouped by chain, each with its own
 * explorer link — never one "your wallet".
 *
 * A component per chain, not a loop inside the parent: `useSigner` is a hook
 * and a hook cannot be called per element of a list. It also makes the signer
 * state "evaluated per chain" for free — this row can be `hydrating` while the row
 * above it is `ready`, and neither can collapse the other into "no wallet".
 *
 * The explorer link comes from `explorerAddressUrl(chain, address)` with the
 * chain the API served. It used to be a template literal pinned to
 * `explorer.solana.com` and `cluster=devnet`, which is a link that is wrong on
 * every row that is not this one deployment's Solana.
 */
export function ChainWalletRow({ chain }: { chain: Chain }) {
  const state = useSigner({ chainId: chain.chainId });
  const address = state.status === "ready" ? state.signer.address : null;
  const [copied, setCopied] = React.useState(false);
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => () => clearTimeout(resetTimer.current), []);

  /*
    Copy is per row, not per menu. The menu used to have one "copy address"
    item because there was one address; with two, a single button would have to
    pick one, and the menu must never pick a single "your wallet".
  */
  const copy = React.useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (insecure context, denied permission) — the full
      // address is on the link's `title`, so there is still a way to get it.
    }
  }, [address]);

  return (
    <div data-testid="wallet-row" data-chain-id={chain.chainId} className="px-2.5 py-1.5">
      <span className="text-label-xs uppercase tracking-[0.4px] text-03">{chain.displayName}</span>
      {address ? (
        <div className="mt-0.5 flex items-center gap-1.5">
          <a
            href={explorerAddressUrl(chain, address)}
            target="_blank"
            rel="noopener noreferrer"
            title={address}
            className="flex flex-1 items-center gap-1.5 truncate text-mono-13 font-mono text-01"
          >
            {shortAddress(chain.chainId, address)}
            <ExternalLink className="h-3.5 w-3.5 text-03" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded-md p-1 outline-none focus-visible:ring-1 focus-visible:ring-primary-500"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success-500" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-03" aria-hidden="true" />
            )}
            <span className="sr-only">
              {copied ? `${chain.displayName} address copied` : `Copy the ${chain.displayName} address`}
            </span>
          </button>
        </div>
      ) : (
        <p className="mt-0.5 text-body-xs text-02">
          {state.status === "hydrating"
            ? "Connecting…"
            : state.status === "chain-unknown"
              ? "Preparing…"
              : "No wallet connected on this chain."}
        </p>
      )}
    </div>
  );
}

/**
 * One row per chain the API named, in the order it named them.
 *
 * A chain with no wallet keeps its row. Hiding it would tell a user who has
 * funds on that chain that the chain does not exist, which is the opposite of
 * what they need to know.
 */
export function WalletChainRows({ chains }: { chains: readonly Chain[] }) {
  return (
    <>
      {chains.map((chain) => (
        <ChainWalletRow key={chain.chainId} chain={chain} />
      ))}
    </>
  );
}

/**
 * The platform balance, one Available/On hold pair per chain. **No total** —
 * balances on different chains are different assets, and there is no room for one in a 264px menu anyway.
 *
 * `balances` is the raw `GET /balances` list; `chainBalances` is applied here
 * so a caller cannot hand this component `[balances[0]]` and have it look
 * right.
 */
export function BalanceRows({
  balances,
  chains,
}: {
  balances: FullBalance[] | undefined;
  chains: readonly Chain[];
}) {
  const rows = chainBalances(balances);
  /*
    `.length`, not the array: an array is always truthy, and `rows ? … : "—"`
    would render `formatMoney(undefined)` — $0.00 — for an account whose
    balance could not be read. That is the exact crash shape of
    providers-view.tsx:112 and the exact contradiction `Row`'s doc comment
    above was written about.
  */
  if (rows.length === 0) {
    return (
      <>
        <Row label="Available" value="—" />
        <Row label="On hold" value="—" />
        <p className="px-2.5 pb-1 text-body-xs text-03">No balance to read for this account.</p>
      </>
    );
  }

  return (
    <>
      {rows.map((row) => (
        <React.Fragment key={row.accountId}>
          {/*
            One chain reads exactly as it always has; the label appears only
            when there is something to tell apart. The name is the API's own
            (`GET /chains`), falling back to the bare CAIP-2 id for a chain the
            list does not name — a balance is never hidden because the chain
            directory disagrees with the ledger.
          */}
          {rows.length > 1 ? (
            <div className="px-2.5 pt-1.5">
              <span className="font-mono text-mono-xs text-03">
                {chains.find((chain) => chain.chainId === row.chainId)?.displayName ?? row.chainId}
              </span>
            </div>
          ) : null}
          <Row label="Available" value={formatMoney(row.available)} />
          <Row label="On hold" value={formatMoney(row.held)} />
        </React.Fragment>
      ))}
    </>
  );
}
