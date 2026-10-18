"use client";

import { useQuery } from "@tanstack/react-query";
import Decimal from "decimal.js";

import { readDepositReadiness, readGasPrice } from "@/libs/chains/evm/deposit-transaction";
import { stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";
import { demoEnabled } from "@/libs/demo/demo-api";
import { formatDecimal } from "@/utils/money";

/**
 * "Before you sign" for Add funds (B7): what the depositing wallet holds,
 * read from the chain before the wallet opens, so a short balance or no gas
 * is said up front instead of surfacing as a wallet error, and an estimate of
 * the network fee.
 *
 * Read through the pinned deployment (the settlement token and the escrow the
 * deposit approves), never through addresses the API served. Display and a
 * pre-check only: the wallet and the chain still have the final word.
 */

/**
 * Gas for both steps, `approve` then `depositFor`, rounded up from the escrow
 * contract's deposit tests (about 190,000–230,000 with the approve). An
 * estimate for the fee line only; the wallet fills the real limit.
 */
export const DEPOSIT_GAS_ESTIMATE = 230_000n;
const NATIVE_DECIMALS = 18;

export interface DepositWalletBalances {
  tokenAtomic: bigint;
  nativeWei: bigint;
  /** Null when the node's gas price could not be read: no fee line then. */
  gasPriceWei: bigint | null;
}

export interface DepositWalletRow {
  label: string;
  value: string;
  bad: boolean;
}

export interface DepositWalletView {
  rows: DepositWalletRow[];
  /** Why the deposit would fail, in one sentence, or null. */
  blocker: string | null;
  /** "Network fee: about 0.0000046 ETH for both steps", or null. */
  feeText: string | null;
  /** The wallet holds none of the token: show where to get some. */
  needsToken: boolean;
  /** The wallet holds no gas: show where to get some. */
  needsGas: boolean;
}

function units(atomic: bigint, decimals: number): Decimal {
  return new Decimal(atomic.toString()).div(new Decimal(10).pow(decimals));
}

export function depositWalletView(input: {
  balances: DepositWalletBalances | null;
  /** The amount to deposit, atomic; null while none is chosen. */
  amountAtomic: string | null;
  decimals: number;
  tokenSymbol: string;
  nativeSymbol: string;
}): DepositWalletView {
  const { balances, amountAtomic, decimals, tokenSymbol, nativeSymbol } = input;
  if (!balances) return { rows: [], blocker: null, feeText: null, needsToken: false, needsGas: false };
  const tokenText = `${formatDecimal(units(balances.tokenAtomic, decimals))} ${tokenSymbol}`;
  const nativeText = `${formatDecimal(units(balances.nativeWei, NATIVE_DECIMALS), { decimals: 6, symbol: "" })} ${nativeSymbol}`;
  const amount = amountAtomic ? BigInt(amountAtomic) : null;
  const shortOfToken = amount !== null && amount > balances.tokenAtomic;
  const fee = balances.gasPriceWei !== null ? balances.gasPriceWei * DEPOSIT_GAS_ESTIMATE : null;
  const noGas = balances.nativeWei === 0n;
  const shortOfGas = !noGas && fee !== null && balances.nativeWei < fee;
  const rows: DepositWalletRow[] = [
    { label: `${tokenSymbol} in this wallet`, value: tokenText, bad: shortOfToken || balances.tokenAtomic === 0n },
    { label: `${nativeSymbol} for network fees`, value: nativeText, bad: noGas || shortOfGas },
  ];
  const blocker = shortOfToken
    ? `This wallet holds ${tokenText}, less than the ${formatDecimal(units(amount!, decimals))} you are depositing. Deposit less, or add ${tokenSymbol} to it first.`
    : noGas
      ? `This wallet holds no ${nativeSymbol} to pay the network fee. Send a little ${nativeSymbol} to it first.`
      : shortOfGas
        ? `This wallet's ${nativeText} may not cover the network fee. Add a little ${nativeSymbol} first.`
        : null;
  const feeText =
    fee !== null
      ? `Network fee: about ${formatDecimal(units(fee, NATIVE_DECIMALS), { decimals: 8, symbol: "" })} ${nativeSymbol} for both steps; your wallet shows the exact fee.`
      : null;
  return { rows, blocker, feeText, needsToken: balances.tokenAtomic === 0n, needsGas: noGas };
}

/** What the demo's wallet holds: enough for any preset, and a little test ETH. */
const DEMO_WALLET: DepositWalletBalances = {
  tokenAtomic: 250_000_000n,
  nativeWei: 20_000_000_000_000_000n,
  gasPriceWei: 20_000_000n,
};

/** The depositing wallet's balances on a pinned EVM deployment; idle elsewhere. */
export function useDepositWallet(input: { chainId: string | null; address: string | null; enabled: boolean }) {
  const deployment = stakeDeploymentFor(input.chainId);
  const address = input.address ?? "";
  return useQuery({
    queryKey: ["funding", "deposit-wallet", input.chainId, address.toLowerCase()],
    queryFn: async (): Promise<DepositWalletBalances> => {
      // DEMO ONLY: no chain is read; the demo wallet is simulated.
      if (demoEnabled()) return DEMO_WALLET;
      const [{ tokenAtomic, nativeWei }, gasPriceWei] = await Promise.all([
        readDepositReadiness({
          chainId: deployment!.chainId,
          owner: address,
          token: deployment!.settlementToken,
          spender: deployment!.escrowContract,
        }),
        readGasPrice(deployment!.chainId).catch(() => null),
      ]);
      return { tokenAtomic, nativeWei, gasPriceWei };
    },
    enabled: input.enabled && Boolean(deployment) && /^0x[0-9a-fA-F]{40}$/.test(address),
    retry: 0,
    staleTime: 15_000,
  });
}
