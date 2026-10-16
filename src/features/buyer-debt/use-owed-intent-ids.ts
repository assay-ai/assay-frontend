"use client";

import * as React from "react";

import { useBuyerDebtsQuery } from "./settle-debt-sheet";

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The intents whose price is held as buyer debt (shares the banner's query
 * and cache, `useBuyerDebtsQuery`). Empty while loading or when the read
 * fails, so callers fall back to calling every open hold a call in flight, as
 * before.
 */
export function useOwedIntentIds(): ReadonlySet<string> {
  const query = useBuyerDebtsQuery();
  const debts = query.data?.debts;
  return React.useMemo(() => (debts ? new Set(debts.map((d) => d.intentId)) : EMPTY), [debts]);
}
