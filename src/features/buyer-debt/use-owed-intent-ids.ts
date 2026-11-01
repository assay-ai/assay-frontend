"use client";

import * as React from "react";

import { useBuyerDebtsQuery } from "./settle-debt-sheet";
import { useDebtStageIntentIds } from "./use-open-hold-intent-ids";

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The intents whose price is held as buyer debt (shares the banner's query
 * and cache, `useBuyerDebtsQuery`). Empty while loading or when the read
 * fails (save the holds `GET /holds` marks `DEBT`), so callers fall back to calling every open hold a call in flight, as
 * before.
 */
export function useOwedIntentIds(): ReadonlySet<string> {
  const query = useBuyerDebtsQuery();
  const debts = query.data?.debts;
  // A hold the backend marks `DEBT` is owed too, even while the debts list loads or fails.
  const debtHolds = useDebtStageIntentIds();
  return React.useMemo(() => {
    if (!debts && debtHolds.size === 0) return EMPTY;
    return new Set([...(debts ?? []).map((d) => d.intentId), ...debtHolds]);
  }, [debts, debtHolds]);
}
