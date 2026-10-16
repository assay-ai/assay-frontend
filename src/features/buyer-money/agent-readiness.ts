import type { StatusChipKey } from "@/components/patterns/status-chip";
import { findDelegation, supportsDelegation } from "@/features/delegation/delegation-form";
import type { EscrowDelegate, Money } from "@/interfaces";

import { capsAreSet } from "./caps";

/**
 * "Is my agent working right now?" — one answer per agent, from what the
 * screens already read: its keys, the escrow, the agent's pay permission and
 * the budget's pause switch. Pure, so Overview, Agents and Get started say the
 * same words.
 */

export interface ReadinessCredential {
  id: string;
  name: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  delegateAccount?: string | null;
}

export interface ReadinessEscrow {
  exists: boolean | null;
  maxVoucherAmount: Money | null;
  maxPerWindow: Money | null;
  withdrawRequested: Money | null;
  spentInWindow?: Money | null;
  balance?: Money | null;
}

export interface ReadinessInput {
  agentAccount?: string | null;
  credentials: readonly ReadinessCredential[] | undefined;
  delegates: readonly EscrowDelegate[] | undefined;
  /** `undefined` = not read yet (or the read failed: say so with `escrowUnreadable`). */
  escrow: ReadinessEscrow | null | undefined;
  escrowUnreadable?: boolean;
  paused: boolean;
  /**
   * The chain's name when it serves free calls only (Solana today,
   * `paid-rails.ts`): the agent makes free calls there and pays for none, so
   * no paying step applies. Said up front on every agent, not after a click.
   */
  freeOnlyChain?: string | null;
}

export type ReadinessStep = "key" | "funds" | "caps" | "bind" | "authorise" | null;

export interface AgentReadiness {
  status: StatusChipKey;
  /** One sentence: what that means for calls, and the next thing to do. */
  sentence: string;
  /** What to do next, for a button; `null` when nothing is needed. */
  next: ReadinessStep;
  /** Latest `lastUsedAt` over the agent's live keys. */
  lastCallAt: string | null;
  liveCredentials: ReadinessCredential[];
  /** The live key bound to a payment key, if any. */
  boundCredential: ReadinessCredential | null;
  grant: EscrowDelegate | null;
}

const RECENT_MS = 24 * 3600 * 1000;

function positive(money: Money | null | undefined): boolean {
  return Boolean(money && BigInt(money.amount || "0") > 0n);
}

export function agentReadiness(input: ReadinessInput, nowMs: number = Date.now()): AgentReadiness {
  const all = input.credentials ?? [];
  const live = all.filter((c) => !c.revokedAt);
  const lastCallAt =
    live
      .map((c) => c.lastUsedAt)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;
  const bound = live.find((c) => c.delegateAccount) ?? null;
  const grant = bound?.delegateAccount ? findDelegation(input.delegates, bound.delegateAccount) : null;
  const base = { lastCallAt, liveCredentials: live, boundCredential: bound, grant };

  if (live.length === 0) {
    return all.length > 0
      ? { ...base, status: "revoked", sentence: "Every key of this agent is revoked, so it cannot call tools. Create a new key to use it again.", next: "key" }
      : { ...base, status: "no-key", sentence: "This agent has no key yet, so it cannot call tools. Create one to connect it.", next: "key" };
  }
  if (input.freeOnlyChain) {
    return {
      ...base,
      status: "ready",
      sentence: `Free calls only: ${input.freeOnlyChain} serves free calls only, so this agent makes free calls there and pays for none.`,
      next: null,
    };
  }
  if (input.paused) {
    return { ...base, status: "paused", sentence: "All paid calls are paused. Free calls still work.", next: null };
  }
  if (positive(input.escrow?.withdrawRequested)) {
    return {
      ...base,
      status: "withdrawal-pending",
      sentence: "Paid calls are stopped while your withdrawal is pending. Claim or cancel it to pay again. Free calls still work.",
      next: null,
    };
  }
  // A key that pays for itself from a non-EVM account needs no permission step.
  if (!supportsDelegation(input.agentAccount)) {
    return { ...base, status: recent(lastCallAt, nowMs) ? "paying" : "ready", sentence: readySentence(lastCallAt, nowMs), next: null };
  }
  if (input.escrow === undefined) {
    return {
      ...base,
      status: "checking",
      sentence: input.escrowUnreadable
        ? "We could not read your escrow just now, so we cannot tell whether it can pay. Free calls are unaffected."
        : "Checking whether it can pay…",
      next: null,
    };
  }
  if (!input.escrow?.exists) {
    return {
      ...base,
      status: "ready",
      sentence: "Free calls work now. Add funds to let it pay for calls.",
      next: "funds",
    };
  }
  if (!capsAreSet(input.escrow)) {
    return {
      ...base,
      status: "caps-not-set",
      sentence: "Paid calls are refused until you set your account ceiling. Free calls still work.",
      next: "caps",
    };
  }
  if (!bound) {
    return {
      ...base,
      status: "needs-authorisation",
      sentence: "Free calls work. To pay, the agent needs its own payment key: run agent-cli bind on its machine.",
      next: "bind",
    };
  }
  if (!grant || grant.status === "EXPIRED") {
    return {
      ...base,
      status: "needs-authorisation",
      sentence: grant
        ? "Its permission to pay has expired. Let it pay again so it can pay for calls."
        : "Its payment key is ready. Let it pay for calls.",
      next: "authorise",
    };
  }
  if (positive(grant.maxPerWindow) && BigInt(grant.spentInWindow.amount || "0") >= BigInt(grant.maxPerWindow.amount)) {
    return {
      ...base,
      status: "cap-reached",
      sentence: "Its 24-hour spending limit is used up, so paid calls are refused until it refills.",
      next: null,
    };
  }
  if (input.escrow.balance && !positive(input.escrow.balance)) {
    return {
      ...base,
      status: "ready",
      sentence: "Allowed to pay, but your escrow is empty, so paid calls are refused. Add funds; free calls still work.",
      next: "funds",
    };
  }
  return { ...base, status: recent(lastCallAt, nowMs) ? "paying" : "ready", sentence: readySentence(lastCallAt, nowMs), next: null };
}

function recent(lastCallAt: string | null, nowMs: number): boolean {
  if (!lastCallAt) return false;
  return nowMs - Date.parse(lastCallAt) < RECENT_MS;
}

function readySentence(lastCallAt: string | null, nowMs: number): string {
  if (recent(lastCallAt, nowMs)) return "Working: it is calling tools and can pay within its spending limits.";
  return lastCallAt
    ? "Ready to pay. No calls in the last 24 hours."
    : "Ready to pay. Waiting for its first call.";
}
