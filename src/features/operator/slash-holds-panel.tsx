"use client";

import type { SlashHoldHealth } from "@/interfaces/operator";

/** Oldest hold first: the one stuck longest is the one to look at. */
export function sortHoldsOldestFirst(holds: readonly SlashHoldHealth[]): SlashHoldHealth[] {
  return [...holds].sort(
    (a, b) =>
      Date.parse(a.heldSince) - Date.parse(b.heldSince)
      || a.providerId.localeCompare(b.providerId)
      || a.chainId.localeCompare(b.chainId),
  );
}
