"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { Hold } from "@/features/g30/balance";
import type { Money } from "@/interfaces";
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

/**
 * The open holds still in the escrow whose call passed and waits for its
 * on-chain settlement (`stage` `SETTLING`): the calls of Funding's "Pending
 * settlement" line (BUG-R2-DEV-01). Empty until read.
 */
export function useSettlingHolds(): Hold[] {
  const open = useOpenHolds();
  return React.useMemo(() => inEscrowHolds(open).filter((hold) => hold.stage === "SETTLING"), [open]);
}

/**
 * Funding's held figure beside the "Pending settlement" line (BUG-R2-DEV-01).
 * A passed call not settled on chain yet (`SETTLING`, a channel call before its
 * lane settles or a per-call payment before its redeem) is in `openHolds` and
 * in `pendingSettlement` both: the money is still in the escrow and agents
 * cannot spend it. While the pending line is shown, those calls are said there
 * only, so the held line describes the rest: `openHolds` less their amounts,
 * without their intents. The balance math is unchanged (available = balance −
 * openHolds; the two lines together still add up to `openHolds`). They reach
 * the "dispute hold" line once the settle lands (`ON_CHAIN_HOLD`). Without the
 * pending line (an older server), everything stays in the held line, as
 * before. `pendingCalls` is how many holds were moved to the pending line.
 */
export function heldBesidePending({
  openHolds,
  openHoldIntentIds,
  settling,
  pendingShown,
}: {
  openHolds: Money | null | undefined;
  openHoldIntentIds: readonly string[];
  settling: readonly Pick<Hold, "intentId" | "amount">[];
  pendingShown: boolean;
}): { amount: Money | null; intentIds: readonly string[]; pendingCalls: number } {
  const amount = openHolds ?? null;
  if (!pendingShown || !amount) return { amount, intentIds: openHoldIntentIds, pendingCalls: 0 };
  // Only this escrow's asset: `GET /holds` lists every chain's holds.
  const ours = settling.filter((hold) => hold.amount?.asset === amount.asset && hold.amount.decimals === amount.decimals);
  const ids = new Set(ours.map((hold) => hold.intentId));
  const intentIds = openHoldIntentIds.filter((id) => !ids.has(id));
  const pendingCalls = openHoldIntentIds.length - intentIds.length;
  if (pendingCalls === 0) return { amount, intentIds: openHoldIntentIds, pendingCalls: 0 };
  const moved = ours.filter((hold) => openHoldIntentIds.includes(hold.intentId)).reduce((sum, hold) => sum + BigInt(hold.amount.amount || "0"), 0n);
  const total = BigInt(amount.amount || "0");
  const rest = total > moved ? total - moved : 0n;
  return { amount: { ...amount, amount: rest.toString() }, intentIds, pendingCalls };
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
