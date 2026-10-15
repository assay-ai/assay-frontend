"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { useChains } from "@/hooks/useChains";
import { useConnectedAddresses, useSigner, type UseSignerResult } from "@/hooks/useSigner";
import type { Chain } from "@/interfaces/chain";
import { ROBINHOOD_TESTNET_STAKE, stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";
import { isEvmChain } from "@/libs/chains/registry";
import { demoEnabled } from "@/libs/demo/demo-api";
import { getProviderRegistration } from "@/services/provider-registration.service";
import { addressOfAccount, chainIdOfAccount } from "@/utils/chain";

import type { StakeStatus } from "./use-stake-status";
import { WALLET_READING, WALLET_READ_STALLED, useStalled } from "./wallet-readiness";

/**
 * Which wallet stakes, on which chain — with no typing.
 *
 * - Proved already: the proved stake wallet, on its own chain.
 * - Not proved: the chain the provider is paid on (their active payout
 *   enrolment) or else the stake deployment's chain, and one of the wallets
 *   connected in this browser that can hold an address on it (the first by
 *   default; the sheet lets them pick another).
 */
export function candidateAddresses(addresses: readonly string[], chainId: string | null): string[] {
  if (!chainId) return [];
  const evm = isEvmChain(chainId);
  return addresses.filter((address) => (evm ? /^0x[0-9a-fA-F]{40}$/.test(address) : !address.startsWith("0x")));
}

export function useStakeWallet(status: StakeStatus) {
  const registration = useQuery({
    queryKey: ["provider", "registration"],
    queryFn: getProviderRegistration,
    retry: false,
  });
  const payout = registration.data?.registration.payoutAccounts ?? [];
  const payoutChain = chainIdOfAccount((payout.find((a) => a.status === "ACTIVE") ?? payout[0])?.accountId);
  const chainId = status.chainId ?? payoutChain ?? ROBINHOOD_TESTNET_STAKE.chainId;

  const connected = useConnectedAddresses();
  const candidates = React.useMemo(() => candidateAddresses(connected, chainId), [connected, chainId]);
  const [picked, setPicked] = React.useState<string | null>(null);
  const proved = status.stakeAuthority ? addressOfAccount(status.stakeAuthority) : null;
  const address = proved ?? (picked && candidates.includes(picked) ? picked : (candidates[0] ?? ""));

  const signerState: UseSignerResult = useSigner({ chainId, address });
  const stalled = useStalled(signerState.status === "hydrating" || signerState.status === "chain-unknown");
  // DEMO ONLY (build-time flag): the sheets walk simulated steps, so no wallet is needed.
  const simulated = demoEnabled();
  const { chains } = useChains();
  const chain: Chain | null =
    chains.find((c) => c.chainId === chainId) ??
    (chainId === ROBINHOOD_TESTNET_STAKE.chainId && ROBINHOOD_TESTNET_STAKE.explorerBaseUrl
      ? ({
          chainId,
          namespace: "eip155",
          displayName: ROBINHOOD_TESTNET_STAKE.displayName,
          explorerBaseUrl: ROBINHOOD_TESTNET_STAKE.explorerBaseUrl,
        } as Chain)
      : null);

  return {
    chainId,
    chain,
    chainName: chain?.displayName ?? (chainId === ROBINHOOD_TESTNET_STAKE.chainId ? ROBINHOOD_TESTNET_STAKE.displayName : "your chain"),
    isEvm: isEvmChain(chainId),
    /** The stake token's symbol on a pinned deployment (USDG), for balance lines. */
    tokenSymbol: stakeDeploymentFor(chainId)?.fallbackAssetSymbol ?? "stake token",
    address,
    proved: Boolean(proved),
    candidates,
    pick: setPicked,
    signerState,
    signer: signerState.status === "ready" ? signerState.signer : null,
    /** The wallet list has been "reading" for too long: say so and offer Connect. */
    stalled,
    /** DEMO ONLY: steps are simulated; nothing is signed. */
    simulated,
    /** Whether a "Connect a wallet" button is the next step. */
    canConnect:
      !simulated &&
      (signerState.status === "no-wallet" || signerState.status === "address-not-connected" || stalled),
  };
}

export type StakeWallet = ReturnType<typeof useStakeWallet>;

/** Why the wallet cannot sign yet, as one sentence, or null when it can. */
export function walletBlocker(wallet: Pick<StakeWallet, "signerState" | "stalled" | "simulated" | "proved" | "address">): string | null {
  if (wallet.simulated) return null;
  switch (wallet.signerState.status) {
    case "ready":
      return null;
    case "chain-unknown":
    case "hydrating":
      return wallet.stalled ? WALLET_READ_STALLED : WALLET_READING;
    case "no-wallet":
      return "Connect the wallet that holds your stake to continue.";
    case "address-not-connected":
      return wallet.proved
        ? `Connect your stake wallet ${short(wallet.address)} in this browser: it is the only wallet that can sign for your stake.`
        : "Connect the wallet that will hold your stake to continue.";
    default:
      return null;
  }
}

export function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
