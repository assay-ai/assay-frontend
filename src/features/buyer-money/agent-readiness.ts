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
  /** An OAuth grant's rolling expiry: past it, the credential is signed out. */
  expiresAt?: string | null;
  lastUsedAt: string | null;
  delegateAccount?: string | null;
}

/** A live credential with a payment key, and that key's pay permission as the chain lists it. */
export interface BoundKey {
  credential: ReadinessCredential;
  /** `null` when the chain lists no permission for the key (or was not read). */
  grant: EscrowDelegate | null;
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
  /** `undefined` = not read yet: the answer is "loading", never "no key". */
  credentials: readonly ReadinessCredential[] | undefined;
  /** The keys' read failed (so `credentials` stays `undefined`). */
  credentialsUnreadable?: boolean;
  /** The keys are not shown to this session (an agent-kind one, BUG-DEMO-02). */
  credentialsHidden?: boolean;
  /** `undefined` = not read yet. */
  delegates: readonly EscrowDelegate[] | undefined;
  /** The pay permissions' read failed. */
  delegatesUnreadable?: boolean;
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
  /**
   * The escrow owes a payment (buyer debt): the backend refuses every paid
   * call until it is settled, so the agent is not "paying" whatever its
   * permission says.
   */
  debtOwed?: boolean;
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
  /**
   * The live key bound to a payment key that the agent pays through: of every
   * bound key (one per machine, R-MU-11), the first one allowed to pay with
   * room left, else the first allowed to pay, else the first bound.
   */
  boundCredential: ReadinessCredential | null;
  grant: EscrowDelegate | null;
  /** Every live credential with a payment key, in list order. */
  boundCredentials: BoundKey[];
  /** The chain serves free calls only: no pay permission, spend or renewal applies. */
  freeOnly: boolean;
  /**
   * The keys (or a bound key's pay permission) are not read yet: draw a
   * skeleton. A card that said "No key" here sent people to make a key they
   * already had.
   */
  loading: boolean;
}

const RECENT_MS = 24 * 3600 * 1000;

/** The agent card's line while it has no payment key (owner decision D14). */
export const PAID_BY_INVITATION_SENTENCE = "Free calls work. Paid calls are by invitation during testnet.";

function positive(money: Money | null | undefined): boolean {
  return Boolean(money && BigInt(money.amount || "0") > 0n);
}

export function agentReadiness(input: ReadinessInput, nowMs: number = Date.now()): AgentReadiness {
  if (input.credentials === undefined) {
    return {
      lastCallAt: null,
      liveCredentials: [],
      boundCredential: null,
      grant: null,
      boundCredentials: [],
      freeOnly: Boolean(input.freeOnlyChain),
      // Hidden keys are settled, not pending: never a skeleton that never ends.
      loading: !input.credentialsUnreadable && !input.credentialsHidden,
      status: "checking",
      sentence: input.credentialsHidden
        ? input.freeOnlyChain
          ? `Free calls only: ${input.freeOnlyChain} serves free calls only, so this agent makes free calls there and pays for none. Its keys show when you sign in as yourself.`
          : "Its keys show when you sign in as yourself, not with an agent key. This does not change what it can call."
        : input.credentialsUnreadable
          ? "We could not read its keys just now. This does not change what it can call."
          : "Checking its keys…",
      next: null,
    };
  }
  const all = input.credentials;
  const live = all.filter((c) => credentialIsLive(c, nowMs));
  const lastCallAt =
    live
      .map((c) => c.lastUsedAt)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1) ?? null;
  const boundCredentials: BoundKey[] = live
    .filter((c) => c.delegateAccount)
    .map((credential) => ({ credential, grant: findDelegation(input.delegates, credential.delegateAccount!) }));
  // "Paid calls are refused" only when no bound key may pay (R-MU-11).
  const paying = (b: BoundKey) => b.grant?.status === "ACTIVE";
  const chosen =
    boundCredentials.find((b) => paying(b) && !capReached(b.grant!)) ?? boundCredentials.find(paying) ?? boundCredentials[0] ?? null;
  const bound = chosen?.credential ?? null;
  const grant = chosen?.grant ?? null;
  const base = {
    lastCallAt,
    liveCredentials: live,
    boundCredential: bound,
    grant,
    boundCredentials,
    freeOnly: Boolean(input.freeOnlyChain),
    loading: false,
  };

  // A bound key's permission decides "can it pay": wait for it rather than
  // flash "Let it pay" at an agent that already can.
  if (bound && input.delegates === undefined && !input.delegatesUnreadable && supportsDelegation(input.agentAccount) && !input.freeOnlyChain) {
    return { ...base, loading: true, status: "checking", sentence: "Checking whether it can pay…", next: null };
  }

  if (live.length === 0) {
    return all.length > 0
      ? { ...base, status: "revoked", sentence: "Every key of this agent is revoked or signed out, so it cannot call tools. Create a new key to use it again.", next: "key" }
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
  if (input.debtOwed) {
    return {
      ...base,
      status: "owed",
      sentence: "Paid calls are paused until you settle the payment owed (see the banner). Free calls still work.",
      next: null,
    };
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
      // Without a payment key, funds alone do not let it pay (D14).
      sentence: bound ? "Free calls work now. Add funds to let it pay for calls." : PAID_BY_INVITATION_SENTENCE,
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
    // D14: the payment key needs assay-mcp, which is not published; paying is
    // by invitation during testnet. Not a warning: nothing here is the
    // person's to fix.
    return {
      ...base,
      status: "ready",
      sentence: PAID_BY_INVITATION_SENTENCE,
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
  if (capReached(grant)) {
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

/** Not revoked, and not past an OAuth grant's expiry. */
export function credentialIsLive(credential: Pick<ReadinessCredential, "revokedAt" | "expiresAt">, nowMs: number): boolean {
  return !credential.revokedAt && (!credential.expiresAt || Date.parse(credential.expiresAt) > nowMs);
}

function capReached(grant: EscrowDelegate): boolean {
  return positive(grant.maxPerWindow) && BigInt(grant.spentInWindow.amount || "0") >= BigInt(grant.maxPerWindow.amount);
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
