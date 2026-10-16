"use client";

import { useQuery } from "@tanstack/react-query";

import type { BuyerDebts } from "@/interfaces/buyer-debt";
import type { ApiError } from "@/libs/ApiClient";
import { getBuyerDebts } from "@/services/escrow.service";

import { BUYER_DEBTS_KEY } from "./debt-banner";

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The intents whose price is held as buyer debt (shares the banner's cache).
 * Empty while loading or when the read fails, so callers fall back to calling
 * every open hold a call in flight, as before.
 */
export function useOwedIntentIds(): ReadonlySet<string> {
  const query = useQuery<BuyerDebts, ApiError>({
    queryKey: BUYER_DEBTS_KEY,
    queryFn: getBuyerDebts,
    staleTime: 30_000,
    retry: 0,
  });
  const debts = query.data?.debts;
  return debts ? new Set(debts.map((d) => d.intentId)) : EMPTY;
}
