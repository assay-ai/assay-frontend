import Decimal from "decimal.js";

import type {
  CreateDelegateIntentBody,
  EscrowDelegate,
  Money,
} from "@/interfaces";
import { exceedsScale, toAtomic, toDecimal } from "@/utils/money";

/**
 * The "Authorize agent to pay" form, as pure logic: no React, no network.
 *
 * Every rule here is one `X402Escrow.authorizeDelegate` applies on chain, so a
 * person is never asked to sign something the chain will refuse:
 *
 * - both caps above zero, the per-payment cap no higher than the per-window cap;
 * - neither cap above the escrow's OWN current limit (the escrow limits keep
 *   applying to the agent too — these caps can only narrow them);
 * - an expiry between 1 and 365 days out.
 */
export const DEFAULT_DELEGATION_DAYS = 30;
export const MAX_DELEGATION_DAYS = 365;
const SECONDS_PER_DAY = 86_400;

export interface DelegationFormInput {
  maxVoucherAmount: string;
  maxPerWindow: string;
  validDays: string;
}

export interface DelegationFormErrors {
  maxVoucherAmount?: string;
  maxPerWindow?: string;
  validDays?: string;
}

export interface EscrowCaps {
  maxVoucherAmount: Money | null;
  maxPerWindow: Money | null;
}

export type ParsedDelegationForm =
  | { ok: true; body: CreateDelegateIntentBody }
  | { ok: false; errors: DelegationFormErrors };

/** An escrow whose limits refuse every payment cannot hand an agent any part of them. */
export function escrowCanDelegate(
  escrow: EscrowCaps | null | undefined,
): boolean {
  if (!escrow?.maxVoucherAmount || !escrow.maxPerWindow) return false;
  return (
    escrow.maxVoucherAmount.amount !== "0" && escrow.maxPerWindow.amount !== "0"
  );
}

/**
 * The form's starting values: the escrow's own limits (the most the chain will
 * accept) and 30 days. `null` when the escrow cannot delegate yet — the screen
 * then asks for escrow limits first instead of pre-filling zeros.
 */
export function defaultDelegationForm(
  escrow: EscrowCaps | null | undefined,
): DelegationFormInput | null {
  if (!escrowCanDelegate(escrow)) return null;
  return {
    maxVoucherAmount: toDecimal(escrow!.maxVoucherAmount!).toString(),
    maxPerWindow: toDecimal(escrow!.maxPerWindow!).toString(),
    validDays: String(DEFAULT_DELEGATION_DAYS),
  };
}

function parseAmount(
  raw: string,
  decimals: number,
): { ok: true; value: Decimal } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: "Enter an amount." };
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === ".")
    return { ok: false, error: "Enter a plain, positive number." };
  const value = new Decimal(trimmed);
  if (exceedsScale(value, decimals))
    return { ok: false, error: `Goes to ${decimals} decimal places at most.` };
  if (value.isZero())
    return {
      ok: false,
      error: "Must be above zero — a zero cap would let the agent pay nothing.",
    };
  return { ok: true, value };
}

export function parseDelegationForm(
  input: DelegationFormInput,
  escrow: EscrowCaps,
  delegate: string,
  nowSeconds: number,
): ParsedDelegationForm {
  const errors: DelegationFormErrors = {};
  const decimals =
    escrow.maxVoucherAmount?.decimals ?? escrow.maxPerWindow?.decimals ?? 6;

  const perCall = parseAmount(input.maxVoucherAmount, decimals);
  const perWindow = parseAmount(input.maxPerWindow, decimals);
  if (!perCall.ok) errors.maxVoucherAmount = perCall.error;
  if (!perWindow.ok) errors.maxPerWindow = perWindow.error;

  if (
    perCall.ok &&
    escrow.maxVoucherAmount &&
    perCall.value.greaterThan(toDecimal(escrow.maxVoucherAmount))
  ) {
    errors.maxVoucherAmount = `At most ${toDecimal(escrow.maxVoucherAmount).toString()} — the escrow's own per-payment limit.`;
  }
  if (
    perWindow.ok &&
    escrow.maxPerWindow &&
    perWindow.value.greaterThan(toDecimal(escrow.maxPerWindow))
  ) {
    errors.maxPerWindow = `At most ${toDecimal(escrow.maxPerWindow).toString()} — the escrow's own per-window limit.`;
  }
  if (
    perCall.ok &&
    perWindow.ok &&
    !errors.maxVoucherAmount &&
    perCall.value.greaterThan(perWindow.value)
  ) {
    errors.maxVoucherAmount = "Cannot be more than the per-window cap.";
  }

  const days = input.validDays.trim();
  if (
    !/^\d+$/.test(days) ||
    Number(days) < 1 ||
    Number(days) > MAX_DELEGATION_DAYS
  ) {
    errors.validDays = `Between 1 and ${MAX_DELEGATION_DAYS} days.`;
  }

  if (!perCall.ok || !perWindow.ok || Object.keys(errors).length > 0)
    return { ok: false, errors };
  return {
    ok: true,
    body: {
      delegate,
      maxVoucherAmount: toAtomic(perCall.value, decimals),
      maxPerWindow: toAtomic(perWindow.value, decimals),
      validUntil: String(
        Math.floor(nowSeconds) + Number(days) * SECONDS_PER_DAY,
      ),
    },
  };
}

function addressOf(account: string): string {
  const parts = account.split(":");
  return (parts.length >= 3 ? parts[parts.length - 1] : account).toLowerCase();
}

/** The payer's on-chain delegation for this key, matched by address (EIP-55 case is not identity). */
export function findDelegation(
  delegates: readonly EscrowDelegate[] | undefined,
  delegateAccount: string,
): EscrowDelegate | null {
  const wanted = addressOf(delegateAccount);
  return delegates?.find((d) => addressOf(d.delegate) === wanted) ?? null;
}

/** Only an eip155 escrow has delegation. */
export function supportsDelegation(
  account: string | null | undefined,
): boolean {
  return typeof account === "string" && account.startsWith("eip155:");
}

/** One credential's binding to a delegate key, as `/agents` knows it. */
export interface DelegateBinding {
  agentId: string;
  agentLabel: string;
  credentialId: string;
  credentialName: string;
  /** CAIP-10 of the bound key. */
  delegateAccount: string;
  delegateBoundAt: string | null;
  /** Set when the credential itself was revoked — its key's grant may still be live. */
  revokedAt: string | null;
}

export interface DelegationRow {
  delegation: EscrowDelegate;
  /** Every credential ever bound to this key, live or revoked. */
  bindings: DelegateBinding[];
  /** True when a LIVE credential is bound to this key. */
  bound: boolean;
}

/**
 * EVERY on-chain delegate of the payer, with the credentials bound to it joined
 * on — never the other way round (review S2-5). A grant whose credential was
 * revoked, rotated or rebound still has authority over the money for up to a
 * year, so it must be listed, labelled, and revocable; a screen that started
 * from the credentials would hide exactly those.
 */
export function delegationRows(
  delegates: readonly EscrowDelegate[] | null | undefined,
  bindings: readonly DelegateBinding[],
): DelegationRow[] {
  return (delegates ?? []).map((delegation) => {
    const wanted = addressOf(delegation.delegate);
    const matched = bindings.filter(
      (b) => addressOf(b.delegateAccount) === wanted,
    );
    return {
      delegation,
      bindings: matched,
      bound: matched.some((b) => b.revokedAt === null),
    };
  });
}

/** The last four hex characters of an address — what `agent-cli address` shows the person. */
export function keyFingerprint(account: string | null | undefined): string {
  if (!account) return "";
  const address = addressOf(account);
  return address.slice(-4);
}

/**
 * The person confirms the key they authorise is THEIR machine's, by typing its
 * last four characters as `agent-cli address` printed them on that machine.
 * Anyone holding the agent's token can bind a key of their own; this is what
 * keeps a stolen token from becoming a grant the person signs blind (review S3-9).
 */
export function confirmsDelegateKey(
  typed: string,
  delegateAccount: string,
): boolean {
  const t = typed.trim().toLowerCase();
  return t.length === 4 && t === keyFingerprint(delegateAccount);
}
