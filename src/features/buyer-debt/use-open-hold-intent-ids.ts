"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { Hold } from "@/features/g30/balance";
import { getHolds } from "@/services/balances.service";

/**
 * The open holds' intents whose money is still in the escrow (`GET /holds`,
 * the `["holds"]` query Funding and Close account share), to tell buyer debt
 * (held until it is collected) apart from calls being checked. A hold in the
 * on-chain dispute hold (`ON_CHAIN_HOLD`) is left out: its money already left
 * the escrow and is not in `openHolds` (BUG-R2-BUY-01). Empty until read.
 */
export function useOpenHoldIntentIds(): string[] {
  const open = useOpenHolds();
  return React.useMemo(() => inEscrowHolds(open).map((hold) => hold.intentId), [open]);
}

/** Pure: the open holds whose money is still in the escrow (every stage but `ON_CHAIN_HOLD`). */
export function inEscrowHolds<T extends Pick<Hold, "stage">>(open: readonly T[]): T[] {
  return open.filter((hold) => hold.stage !== "ON_CHAIN_HOLD");
}

/**
 * The open holds whose call passed and is being paid on chain (`stage`
 * `SETTLING`), or null when any open hold does not say its stage (an older
 * server): the copy then names both stages rather than guess (SPEC-H H-2).
 */
export function usePayingIntentIds(): ReadonlySet<string> | null {
  const open = useOpenHolds();
  return React.useMemo(() => payingIntentIds(open), [open]);
}

const KNOWN_STAGES: readonly (string | null | undefined)[] = ["CHECKING", "SETTLING", "DEBT"];

/**
 * Pure: see `usePayingIntentIds`. A `DEBT` hold is a known stage, never "being
 * paid"; an `ON_CHAIN_HOLD` one is not money in the escrow, so it is left out
 * before the stages are read.
 */
export function payingIntentIds(open: readonly Pick<Hold, "intentId" | "stage">[]): ReadonlySet<string> | null {
  const inEscrow = inEscrowHolds(open);
  if (inEscrow.some((hold) => !KNOWN_STAGES.includes(hold.stage))) return null;
  return new Set(inEscrow.filter((hold) => hold.stage === "SETTLING").map((hold) => hold.intentId));
}

/**
 * The open holds the backend calls buyer debt (`stage` `DEBT`: the payment is
 * being collected again after it could not be collected the first time). They
 * are unpaid calls, never calls being checked, even before the debts list loads.
 * Reads the shared `["holds"]` cache only: it never sends a request of its own,
 * so a page that does not read the holds asks for nothing more.
 */
export function useDebtStageIntentIds(): ReadonlySet<string> {
  const open = useOpenHolds({ fetch: false });
  return React.useMemo(() => debtStageIntentIds(open), [open]);
}

/** Pure: see `useDebtStageIntentIds`. */
export function debtStageIntentIds(open: readonly Pick<Hold, "intentId" | "stage">[]): ReadonlySet<string> {
  return new Set(open.filter((hold) => hold.stage === "DEBT").map((hold) => hold.intentId));
}

function useOpenHolds({ fetch = true }: { fetch?: boolean } = {}): Hold[] {
  const holds = useQuery({
    queryKey: ["holds"],
    retry: 0,
    enabled: fetch,
    queryFn: () => getHolds() as Promise<{ items?: Hold[] } | Hold[]>,
  });
  return React.useMemo(() => {
    const data = holds.data;
    const items = Array.isArray(data) ? data : (data?.items ?? []);
    return items.filter((hold) => !hold.status || hold.status === "OPEN");
  }, [holds.data]);
}
