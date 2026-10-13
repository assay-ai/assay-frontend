/**
 * @fileoverview
 * What the withdrawal screen says about agent payments.
 *
 * The gateway refuses every new paid call while a withdrawal request stands on
 * the escrow (`PAYMENT_WITHDRAWAL_PENDING`): a voucher signed after the request
 * could still be redeemable once the money has been claimed. Vouchers signed
 * before the request are still redeemed, which is why the payout can fall.
 * These sentences have to say that — the page used to say "your calls keep
 * being paid" (BUG-R2-D1-01).
 */
export const WITHDRAWAL_COPY = {
  /** Under "Request a withdrawal", before anything is signed. */
  beforeRequest:
    "Name a ceiling. Agent payments stop as soon as you request: your agents cannot pay for calls from this escrow until you claim the withdrawal or cancel the request. Nothing is reserved — calls made before the request still settle — and once the settlement window has passed you can claim whatever the escrow still holds, up to that ceiling.",
  /** Beside the countdown, while a request is pending and not yet claimable. */
  whilePending:
    "Agent payments are stopped while this request is pending: your agents cannot pay for calls from this escrow until you claim or cancel. Calls made before the request can still settle, which is why the figure above is a ceiling and not a promise.",
  /** Beside the countdown, once the wait is over. */
  whenMatured:
    "Claim whenever you like — the request does not expire, and agent payments stay stopped until you claim or cancel. The amount is still settled at the moment you claim.",
  /** Under "Cancel the pending request". */
  cancel:
    "Cancelling withdraws nothing and costs nothing but a signature. It clears the standing request so your agents can pay for calls again; nothing else on this page changes.",
} as const;
