import Decimal from "decimal.js";

import type {
  CreateDelegateIntentBody,
  EscrowDelegate,
  Money,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { exceedsScale, toAtomic, toDecimal } from "@/utils/money";

/**
 * The "Authorize agent to pay" form, as pure logic: no React, no network.
 *
 * Every rule here is one `AssayEscrow.authorizeDelegate` applies on chain, so a
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
  /**
   * Editing only (BUG-J-POST-01): sign the grant's CURRENT `validUntil`
   * instead of "`validDays` from now". `validDays` is then ignored.
   */
  keepExpiry?: boolean;
}

/**
 * `REDEEM_GRACE_SECONDS` on chain: a voucher stays redeemable this long after it
 * expires, and the backend refuses a delegate voucher whose grant ends inside
 * that window (D1-P05). A kept expiry closer than this could cover no payment.
 */
export const REDEEM_GRACE_SECONDS = 1_800;

/**
 * The nearest expiry the backend builds a grant for (assay-evm D-21): at least
 * `TIGHTEN_DELAY_SECONDS` (3600) after the signed request's `deadline`, which is
 * the chain's clock plus 300 s — so 3900 s out — plus a margin for the time the
 * person takes to sign and for clock drift. Closer, it is refused
 * `SETTLEMENT_DELEGATION_INVALID`.
 */
export const MIN_VALID_UNTIL_LEAD_SECONDS = 3_900 + 120;

/** The backend's refusal of a grant the escrow would refuse (bad caps or expiry). */
export const DELEGATION_INVALID_CODE = "SETTLEMENT_DELEGATION_INVALID";

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
  /** The standing grant's `validUntil`, unix seconds — what `keepExpiry` signs. */
  currentValidUntil?: number,
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
  const keep = input.keepExpiry === true && currentValidUntil !== undefined;
  if (keep) {
    if (currentValidUntil < Math.floor(nowSeconds) + MIN_VALID_UNTIL_LEAD_SECONDS) {
      errors.validDays =
        "The current expiry is less than about 1 hour 5 minutes away — choose a number of days instead.";
    }
  } else if (
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
      validUntil: keep
        ? String(currentValidUntil)
        : String(Math.floor(nowSeconds) + Number(days) * SECONDS_PER_DAY),
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

/** The last four hex characters of an address — what `npx -y @assay-ai/mcp@<V> status` shows the person. */
export function keyFingerprint(account: string | null | undefined): string {
  if (!account) return "";
  const address = addressOf(account);
  return address.slice(-4);
}

/**
 * The person confirms the key they authorise is THEIR machine's, by typing its
 * last four characters as `npx -y @assay-ai/mcp@<V> status` printed them on that machine.
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

/**
 * The server's clock NOW, in unix seconds, from the `serverTime` an earlier
 * read carried and when that read arrived (BUG-D1-05).
 *
 * The expiry is "N days from when you sign", on the chain's clock. Taking
 * `serverTime` as-is froze "now" at the moment the escrow was read — page
 * load — so after a long session "30 days" was shorter than chosen. The
 * browser's own clock may be wrong, but the time ELAPSED since the read is
 * not, so the server's instant is carried forward by it.
 */
export function serverNowSeconds(
  serverTime: string | null | undefined,
  receivedAtMs: number,
  nowMs: number,
): number {
  const server = serverTime ? Date.parse(serverTime) : Number.NaN;
  if (!Number.isFinite(server) || !receivedAtMs) return Math.floor(nowMs / 1000);
  return Math.floor((server + Math.max(0, nowMs - receivedAtMs)) / 1000);
}

/**
 * The errors still true after `field` changed (BUG-D1-05): a field's own error
 * goes, and so does the per-payment error that compared it with the window
 * cap, which either amount can fix. The rest are re-checked on Sign.
 */
export function errorsAfterEdit(
  errors: DelegationFormErrors,
  field: keyof DelegationFormErrors,
): DelegationFormErrors {
  const next = { ...errors };
  delete next[field];
  if (field === "maxPerWindow") delete next.maxVoucherAmount;
  return next;
}

/**
 * The form for EDITING a standing grant (BUG-D1-04): its own caps, and its
 * own expiry KEPT exactly (BUG-J-POST-01) — a cap edit no longer moves
 * `validUntil` to "N whole days from now". `validDays` is pre-filled with the
 * days it has left (at least 1) for a person who chooses a new expiry. A grant
 * whose expiry is closer than {@link MIN_VALID_UNTIL_LEAD_SECONDS} starts on
 * days, since the backend no longer builds a grant ending that soon (D-21). Every rule of
 * {@link parseDelegationForm} applies — the escrow's CURRENT limits included.
 */
export function editDelegationForm(
  delegation: Pick<EscrowDelegate, "maxVoucherAmount" | "maxPerWindow" | "validUntil">,
  nowSeconds: number,
): DelegationFormInput {
  const validUntil = validUntilSeconds(delegation.validUntil);
  const left = Math.ceil((validUntil - nowSeconds) / SECONDS_PER_DAY);
  return {
    maxVoucherAmount: toDecimal(delegation.maxVoucherAmount).toString(),
    maxPerWindow: toDecimal(delegation.maxPerWindow).toString(),
    validDays: String(Math.min(MAX_DELEGATION_DAYS, Math.max(1, Number.isFinite(left) ? left : 1))),
    keepExpiry:
      Number.isFinite(validUntil) && validUntil >= nowSeconds + MIN_VALID_UNTIL_LEAD_SECONDS,
  };
}

/** A grant's ISO `validUntil` as the unix seconds the chain stores. */
export function validUntilSeconds(validUntil: string): number {
  return Math.floor(Date.parse(validUntil) / 1000);
}

/**
 * A grant's caps that are above the escrow's CURRENT limits (BUG-D1-03). The
 * chain refuses caps above the limits when a grant is made, but the payer can
 * lower the escrow's limits afterwards; the escrow's limits keep binding, so a
 * payment above them is refused whatever the grant says.
 */
export function capsAboveEscrow(
  delegation: Pick<EscrowDelegate, "maxVoucherAmount" | "maxPerWindow">,
  escrow: EscrowCaps | null | undefined,
): { maxVoucherAmount?: Money; maxPerWindow?: Money } {
  const above: { maxVoucherAmount?: Money; maxPerWindow?: Money } = {};
  if (
    escrow?.maxVoucherAmount &&
    toDecimal(delegation.maxVoucherAmount).greaterThan(toDecimal(escrow.maxVoucherAmount))
  ) {
    above.maxVoucherAmount = escrow.maxVoucherAmount;
  }
  if (
    escrow?.maxPerWindow &&
    toDecimal(delegation.maxPerWindow).greaterThan(toDecimal(escrow.maxPerWindow))
  ) {
    above.maxPerWindow = escrow.maxPerWindow;
  }
  return above;
}

/**
 * `SETTLEMENT_DELEGATION_INVALID` in plain words, or null for any other error.
 * The backend names the contract's reason (`DelegateValidUntilInvalid`, …) in
 * its message; the person needs what to change instead.
 */
export function delegationInvalidText(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== DELEGATION_INVALID_CODE) return null;
  const reason = `${String(error.context?.reason ?? "")} ${error.message}`;
  if (/ValidUntil/i.test(reason)) {
    return (
      "The expiry is too soon. An agent’s authorisation must last at least about " +
      "1 hour 5 minutes from now (and at most 365 days). Choose a later expiry and sign again."
    );
  }
  return (
    "Your escrow would refuse these caps. Both must be above zero and within your escrow’s " +
    "own limits, and the per-payment cap no higher than the 24-hour cap."
  );
}
