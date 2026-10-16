"use client";

import * as React from "react";

import type { BuyerDebts } from "@/interfaces/buyer-debt";

import { debtsToSign, nextReplaceableAt, splitDebts } from "./debt-copy";

/**
 * The time to judge `replaceableAt` against. A debt is signable only once its
 * original voucher is past its on-chain deadline (`replaceableAt`); this moves
 * on at the earliest such time, and with every new list (`dataUpdatedAt`), so
 * a "Settle" button turns on without a reload.
 */
export function useReplaceableNow(data: BuyerDebts | null | undefined, dataUpdatedAt: number): number {
  const [tick, setTick] = React.useState(() => Date.now());
  const now = Math.max(tick, dataUpdatedAt);
  const wakeAt = nextReplaceableAt(debtsToSign(splitDebts(data).own), now);
  React.useEffect(() => {
    if (wakeAt === null) return;
    // setTimeout holds at most ~24.8 days; a longer wait is caught by a refetch.
    const delay = Math.min(Math.max(wakeAt - Date.now(), 0) + 250, 2 ** 31 - 1);
    const timer = setTimeout(() => setTick(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [wakeAt]);
  return now;
}
