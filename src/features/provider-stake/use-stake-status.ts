"use client";

import { useQuery } from "@tanstack/react-query";
import Decimal from "decimal.js";

import type { Money, ProviderStake } from "@/interfaces";
import { revalidateProviderStake } from "@/services/provider-stake.service";
import { toDecimal } from "@/utils/money";

import { requirementChain, stakeActionChain } from "./chain-stake";

/**
 * "Is my stake enough?" in one object, for every surface that asks it: the
 * Home checklist and Needs-action strip, the wizard's Go live summary, the
 * Stake page gauge and the Stake sheet's prefilled amount.
 *
 * - `required`: what the bindings that need stake need in total (null = none
 *   needed, e.g. only free bindings or nothing listed yet).
 * - `staked`: what the chain holds for the stake wallet (null = unknown).
 * - `recommended`: required × 1.5, the cushion against a penalty taking you
 *   below the minimum (the backend's `recommendedBuffer` when it sends one).
 * - `shortfall`: how much more is needed now (null when enough or unknown).
 */
export interface StakeStatus {
  required: Money | null;
  staked: Money | null;
  recommended: Money | null;
  shortfall: Money | null;
  /** True: covered. False: short. Null: cannot tell (nothing read yet). */
  enough: boolean | null;
  /** The stake wallet has been proved (the Stake sheet skips that step). */
  authorityProved: boolean;
  /** The stake wallet, as an account id, once proved. */
  stakeAuthority: string | null;
  chainId: string | null;
}

const RECOMMENDED_FACTOR = new Decimal(1.5);

function money(value: Decimal, like: Money): Money {
  return { amount: value.mul(new Decimal(10).pow(like.decimals)).toFixed(0, Decimal.ROUND_UP), asset: like.asset, decimals: like.decimals };
}

/** Pure, for tests: the status from `GET /providers/me/stake`. */
export function stakeStatusOf(stake: ProviderStake | undefined): StakeStatus {
  const chain = requirementChain(stake) ?? stakeActionChain(stake);
  const action = stakeActionChain(stake);
  const required = stake?.requirementTotal && toDecimal(stake.requirementTotal).gt(0) ? stake.requirementTotal : null;
  const staked = chain?.staked ?? null;

  let recommended: Money | null = null;
  if (required) {
    const buffer = stake?.recommendedBuffer;
    recommended =
      buffer && toDecimal(buffer).gt(toDecimal(required))
        ? buffer
        : money(toDecimal(required).mul(RECOMMENDED_FACTOR), required);
  }

  let shortfall: Money | null = null;
  let enough: boolean | null = null;
  if (!stake) {
    enough = null;
  } else if (!required) {
    enough = true;
  } else if (staked) {
    const gap = toDecimal(required).minus(toDecimal(staked));
    enough = gap.lte(0);
    shortfall = enough ? null : money(gap, required);
  } else if (stake?.shortfall && toDecimal(stake.shortfall).gt(0)) {
    enough = false;
    shortfall = stake.shortfall;
  } else if (stake) {
    // Required, and nothing on chain is known: everything is short.
    enough = false;
    shortfall = required;
  }

  return {
    required,
    staked,
    recommended,
    shortfall,
    enough,
    authorityProved: Boolean(action?.stakeAuthority),
    stakeAuthority: action?.stakeAuthority ?? null,
    chainId: action?.chainId ?? chain?.chainId ?? null,
  };
}

export const PROVIDER_STAKE_KEY = ["provider", "stake"] as const;

export function useStakeStatus() {
  // Revalidated past the browser's HTTP cache: a body from before a binding was
  // resumed left an ACTIVE binding out of the requirement table (BUG-R16-V3-01).
  const query = useQuery({ queryKey: PROVIDER_STAKE_KEY, queryFn: revalidateProviderStake, retry: 0 });
  return { ...stakeStatusOf(query.data), isLoading: query.isLoading, isError: query.isError, stake: query.data ?? null, refetch: query.refetch };
}
