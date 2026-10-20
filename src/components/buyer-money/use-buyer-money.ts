"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { ConnectWalletNote } from "@/components/buyer-money/connect-wallet";
import { capsAreSet } from "@/features/buyer-money/caps";
import { anyConfirming, confirmingPollMs } from "@/features/buyer-money/confirming";
import { WalletNotReady } from "@/features/buyer-money/money-errors";
import type { FullBalance } from "@/features/g30/balance";
import { useChains } from "@/hooks/useChains";
import { type Signer, type UseSignerResult, useSigner } from "@/hooks/useSigner";
import type { BuyerEscrow } from "@/interfaces";
import type { ApiError } from "@/libs/ApiClient";
import { shortAddress } from "@/libs/chains/format";
import { servesPaidCalls } from "@/libs/chains/paid-rails";
import { demoEnabled } from "@/libs/demo/demo-api";
import { getBalances } from "@/services";
import { chainDisplayName, findChain, settlementSymbol } from "@/services/chains.service";
import { getEscrow } from "@/services/escrow.service";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";

/**
 * What every money surface reads: the escrow (from the chain, through the
 * API), the ledger balances, the chain list, and a signer for the escrow's
 * owner. Same query keys as the rest of the app, so opening a drawer reads
 * what the page already has.
 *
 * `retry: 0` + `networkMode: "always"`: React Query pauses a pending retry on
 * a network error, which left money screens spinning forever with the API
 * down. A money screen that cannot read must say so at once.
 */
export function useEscrowQuery(options: { refetchInterval?: number | false; enabled?: boolean } = {}) {
  return useQuery<BuyerEscrow, ApiError>({
    queryKey: ["escrow", null],
    queryFn: () => getEscrow(null),
    retry: 0,
    networkMode: "always" as const,
    refetchInterval: options.refetchInterval,
    enabled: options.enabled,
  });
}

export function useBalancesQuery() {
  // When this view first saw a deposit confirming; null while none is.
  const confirmingSince = React.useRef<number | null>(null);
  return useQuery<{ balances: FullBalance[] }, ApiError>({
    queryKey: ["balances"],
    queryFn: () => getBalances() as Promise<{ balances: FullBalance[] }>,
    // While a deposit is confirming, look again every few seconds: the API
    // credits it within seconds, and "still confirming" must not outlive it.
    // A deposit stuck confirming is then checked every 30 s, not every 3 s forever.
    refetchInterval: (query) => {
      if (!anyConfirming(query.state.data?.balances)) {
        confirmingSince.current = null;
        return false;
      }
      const now = Date.now();
      confirmingSince.current ??= now;
      return confirmingPollMs(now - confirmingSince.current);
    },
    retry: 0,
    networkMode: "always" as const,
  });
}

export function useBuyerMoney(options: { refetchInterval?: number | false } = {}) {
  const escrowQuery = useEscrowQuery(options);
  const balancesQuery = useBalancesQuery();
  const { chains, status: chainsStatus } = useChains();
  const escrow = escrowQuery.data ?? null;
  const chainId = chainIdOfAccount(escrow?.account);
  const owner = addressOfAccount(escrow?.account);
  const signerState = useSigner({ chainId, address: owner });
  const chain = chainId ? findChain(chains, chainId) : null;

  return {
    escrowQuery,
    balancesQuery,
    escrow,
    chains,
    chainsStatus,
    chain,
    chainId,
    owner,
    chainName: chainId ? chainDisplayName(chains, chainId) : null,
    symbol: (chainId && settlementSymbol(chains, chainId)) || "USD",
    decimals: escrow?.balance?.decimals ?? escrow?.maxVoucherAmount?.decimals ?? 6,
    capsSet: capsAreSet(escrow),
    signerState,
    ownerShort: chainId && owner ? shortAddress(chainId, owner) : null,
  };
}

/**
 * The signer, or a sentence the person can act on. Thrown from inside a wallet
 * step, so the message lands in SignAction's failure line (via
 * `describeMoneyError`) rather than as a generic error.
 */
export function requireSigner(state: UseSignerResult, owner?: string | null): Signer {
  if (state.status === "ready") return state.signer;
  if (state.status === "address-not-connected") {
    throw new WalletNotReady(
      owner
        ? `Connect the wallet ${owner}. It is the only one that can sign for your escrow.`
        : "Connect the wallet that owns your escrow.",
    );
  }
  if (state.status === "hydrating") throw new WalletNotReady("Still connecting your wallet. Try again in a moment.");
  if (state.status === "chain-unknown") throw new WalletNotReady("Still reading which chain you are on. Try again in a moment.");
  throw new WalletNotReady("Connect a wallet first.");
}

/**
 * Why the sign button cannot be pressed yet, or `null` when it can. Waits a
 * while before blaming the wallet connection, then says what to do — and when
 * connecting a wallet is the fix, offers it as a button beside the sentence
 * (a disabled sign button with only a footnote was a dead end).
 */
export function useWalletBlocker(state: UseSignerResult, owner?: string | null): React.ReactNode | null {
  const text = useWalletBlockerText(state, owner);
  // DEMO ONLY: no wallet session exists, and the signing sheets run simulated
  // steps that never reach a wallet, so a missing wallet blocks nothing.
  if (demoEnabled()) return null;
  if (text === null) return null;
  const connectable = state.status === "address-not-connected" || state.status === "no-wallet";
  return connectable ? React.createElement(ConnectWalletNote, { text }) : text;
}

/** The same reason as a plain sentence (for places that cannot hold a button). */
export function useWalletBlockerText(state: UseSignerResult, owner?: string | null): string | null {
  const [slow, setSlow] = React.useState(false);
  const hydrating = state.status === "hydrating" || state.status === "chain-unknown";
  React.useEffect(() => {
    if (!hydrating) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [hydrating]);
  return walletBlockerText(state, owner, { slow });
}

/**
 * The sentence itself, pure. Every branch says what is wrong and what to do
 * next; "slow" is the wallet still not connected after ten seconds.
 */
export function walletBlockerText(
  state: Pick<UseSignerResult, "status">,
  owner: string | null | undefined,
  { slow }: { slow: boolean },
): string | null {
  if (state.status === "ready") return null;
  if (state.status === "hydrating" || state.status === "chain-unknown") {
    return slow
      ? "Your wallet has not connected yet. Reload the page; if it still does not connect, sign out and sign in again."
      : "Connecting your wallet…";
  }
  if (state.status === "address-not-connected") {
    return owner ? `Connect the wallet ${owner} to sign. It is the only one your escrow answers to.` : "Connect the wallet that owns your escrow.";
  }
  return "Connect a wallet to sign.";
}

/**
 * Whether the account's chain serves free calls only (Solana today,
 * `paid-rails.ts`), with its name — for every entry point that would send the
 * buyer to a deposit or a payment that cannot happen there.
 */
export function useFreeOnlyChain(options: { enabled?: boolean } = {}): {
  freeOnly: boolean;
  chainName: string | null;
  chainId: string | null;
} {
  const escrowQuery = useEscrowQuery({ enabled: options.enabled });
  const { chains } = useChains();
  const chainId = chainIdOfAccount(escrowQuery.data?.account);
  const freeOnly = chainId !== null && !servesPaidCalls(chainId);
  return { freeOnly, chainId, chainName: chainId ? chainDisplayName(chains, chainId) : null };
}
