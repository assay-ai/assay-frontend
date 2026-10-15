"use client";

import { useQuery } from "@tanstack/react-query";
import Decimal from "decimal.js";

import { readDepositReadiness } from "@/libs/chains/evm/deposit-transaction";
import { stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";
import { formatDecimal } from "@/utils/money";

/**
 * "Before you sign" for Add stake: what the stake wallet holds, read from the
 * chain before the wallet opens, so a short balance is said up front instead
 * of surfacing as a wallet error (provider review 2026-10-16b; the console had
 * this before the redesign).
 *
 * Read straight from the pinned deployment: the settlement token's balance
 * and the native (gas) balance of the wallet that will sign. No gas estimate
 * exists before the deposit is built, so the gas check is "holds some", not
 * "holds enough"; the wallet still has the final word on the fee.
 */

export interface StakeBalances {
  tokenAtomic: bigint;
  nativeWei: bigint;
}

export interface PreflightRow {
  label: string;
  value: string;
  bad: boolean;
}

export interface StakePreflight {
  rows: PreflightRow[];
  /** Why signing would fail, in one sentence, or null. */
  blocker: string | null;
}

const NATIVE_DECIMALS = 18;

export function stakePreflight(input: {
  balances: StakeBalances | null;
  /** The amount to stake, atomic; null while the field is empty or invalid. */
  amountAtomic: string | null;
  decimals: number;
  tokenSymbol: string;
  nativeSymbol: string;
}): StakePreflight {
  const { balances, amountAtomic, decimals, tokenSymbol, nativeSymbol } = input;
  if (!balances) return { rows: [], blocker: null };
  const token = new Decimal(balances.tokenAtomic.toString()).div(new Decimal(10).pow(decimals));
  const native = new Decimal(balances.nativeWei.toString()).div(new Decimal(10).pow(NATIVE_DECIMALS));
  const amount = amountAtomic ? BigInt(amountAtomic) : null;
  const shortOfToken = amount !== null && amount > balances.tokenAtomic;
  const noGas = balances.nativeWei === 0n;
  const tokenText = `${formatDecimal(token)} ${tokenSymbol}`;
  const nativeText = `${formatDecimal(native, { decimals: 8, symbol: "" })} ${nativeSymbol}`;

  const rows: PreflightRow[] = [
    { label: `${tokenSymbol} in this wallet`, value: tokenText, bad: shortOfToken },
    { label: `${nativeSymbol} for network fees`, value: nativeText, bad: noGas },
  ];
  const blocker = shortOfToken
    ? `This wallet holds ${tokenText}, less than the ${formatDecimal(
        new Decimal(amount!.toString()).div(new Decimal(10).pow(decimals)),
      )} you are staking. Add ${tokenSymbol} to it or stake less.`
    : noGas
      ? `This wallet holds no ${nativeSymbol} to pay the network fee. Send a little ${nativeSymbol} to it first.`
      : null;
  return { rows, blocker };
}

/** The stake wallet's balances on a pinned EVM deployment; idle elsewhere. */
export function useStakeBalances(input: { chainId: string | null; address: string; enabled: boolean }) {
  const deployment = stakeDeploymentFor(input.chainId);
  return useQuery({
    queryKey: ["provider", "stake-wallet-balances", input.chainId, input.address.toLowerCase()],
    queryFn: async (): Promise<StakeBalances> => {
      const { tokenAtomic, nativeWei } = await readDepositReadiness({
        chainId: deployment!.chainId,
        owner: input.address,
        token: deployment!.settlementToken,
        spender: deployment!.stakeContract,
      });
      return { tokenAtomic, nativeWei };
    },
    enabled: input.enabled && Boolean(deployment) && /^0x[0-9a-fA-F]{40}$/.test(input.address),
    retry: 0,
    staleTime: 15_000,
  });
}
