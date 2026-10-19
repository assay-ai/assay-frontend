/**
 * The buyer's escrow.
 *
 * Every mutation here is a WALLET-SIGNED instruction on the settlement program,
 * and the browser builds none of them: the backend answers with unsigned base64
 * wire bytes (see `EscrowIntent` in `@/interfaces/escrow`), and a signing helper
 * puts the buyer's own signature on them. That is not an implementation detail —
 * it is the property the whole security-hardening effort exists to buy. Only the
 * owner withdraws.
 *
 * `src/libs/chains/solana/settlement-client-only.test.ts` is the lock that keeps it
 * that way — nothing here may import Anchor, an IDL, a generated client,
 * `@solana/web3.js`, or name the settlement program id.
 *
 * ## Reconciled against the shipped controller, not against a plan
 *
 * Read off the assay-backend repository,
 * assay-backend `src/modules/settlement/controllers/escrow.controller.ts` — `@Controller('escrow')`
 * with `@Get()`, `@Post('limits-intent')`, `@Post('withdrawals/request-intent')`
 * and `@Post('withdrawals/intent')`. All four are session-authenticated and
 * take the account from the session; none of them accepts an account field, so
 * nothing below sends one.
 *
 * **There is no `close-intent`.** Lean v3 removed `close_escrow` from the
 * program: an escrow account is permanent, its rent is never reclaimed, and
 * the route that built the instruction is gone with it.
 *
 * The API's global prefix is `api` with URI versioning at `v1`
 * (assay-backend `src/bootstrap/api/main.ts`), and `NEXT_PUBLIC_API_BASE_URL` already
 * ends in `/api/v1` — so the paths here are relative to that and must stay
 * prefix-free.
 *
 * **`POST /escrow/withdrawals/…`, not `POST /withdrawals/…`.** The two
 * withdrawal routes are nested under this controller's own `escrow` prefix.
 *
 * **A refusal is a status code, not a null transaction.** These three never
 * answer 201 with `transaction: null`; a frozen, immature or unmatured act
 * comes back 409 (and 503 when the chain could not be read).
 * Do not branch on `transaction === null` — it never happens here, unlike on
 * the stake withdrawal this file's envelope used to be aliased to.
 */

import type {
  BuyerDebts,
  BuyerEscrow,
  DebtVoucherIntent,
  SettleDebtBody,
  SettleDebtResult,
  EscrowClaimBody,
  EscrowIntent,
  EscrowLimitsBody,
  RelayedEscrowIntent,
  SubmitRequestWithdrawBody,
  SubmitSetLimitsBody,
  WithdrawIntentBody,
} from "@/interfaces";

import { api } from "./api";

/**
 * `GET /escrow` — the PDA, its ATA balance, the open holds, the window meter,
 * both on-chain limits and any pending withdrawal.
 *
 * Fails closed: a chain that could not be read is a 503, never a stale picture.
 *
 * ## `chainId` is sent and the backend does not read it yet
 *
 * Withdrawal is per chain — two withdrawals, never one — so the
 * escrow drawer is opened per chain (`?chain=<caip2>`) and the chain travels on the
 * request. **The controller takes the account from the session and accepts no
 * account or chain field**, and it answers for the session's single account
 * until the backend supports several accounts per session. An unknown query
 * parameter is ignored, not refused, so this is shaped for N and identical on
 * one.
 *
 * The consequence, and the reason the screen must not trust what it asked for:
 * **the chain this response is about is `account`, not `chainId` above.** Read
 * the chain off the answer (`chainIdOfAccount(escrow.account)`) — which is what
 * `run-escrow-intent.ts` already does, for the same reason: it is the chain the
 * transaction was actually built for.
 *
 * **Required, with no default.** A default made `queryFn: getEscrow` compile,
 * and React Query calls a bare `queryFn` with its own context object — so the
 * chain would have been an object serialised into the query string. `tsc`
 * caught it the moment the default was removed, which is the argument for not
 * having one.
 */
export function getEscrow(chainId: string | null): Promise<BuyerEscrow> {
  return api.get<BuyerEscrow>("/escrow", chainId === null ? undefined : { chainId });
}

/**
 * `GET /escrow`, revalidated past the browser's HTTP cache — for the reads
 * right after a write that changed the escrow. The route is served
 * `private, max-age=10, stale-while-revalidate=3600`, so a plain refetch in
 * the next ten seconds is answered with the pre-write body without ever
 * reaching the API.
 */
export function revalidateEscrow(chainId: string | null): Promise<BuyerEscrow> {
  return api.getRevalidated<BuyerEscrow>("/escrow", chainId === null ? undefined : { chainId });
}

/**
 * `POST /escrow/withdrawals/request-intent` — builds `request_withdraw(amount)`.
 * Step 1 of 2.
 *
 * Starts the clock the program freezes at `now + Config.withdraw_delay_seconds`;
 * read the resulting instant off `escrow.withdrawAvailableAt` on the response,
 * never compute it here. `amount: "0"` cancels a standing request.
 */
export function createEscrowWithdrawIntent(body: WithdrawIntentBody): Promise<EscrowIntent> {
  return api.post<EscrowIntent>("/escrow/withdrawals/request-intent", body);
}

/**
 * `POST /escrow/withdrawals/intent` — builds `withdraw()`. Step 2 of 2.
 *
 * No amount: the program pays `min(requested, escrow_ata.amount)`. Sending one
 * would imply the browser controls a figure it does not. `destination` is
 * optional and chain-native (a bare address, not CAIP-10); omitting it pays the
 * buyer's own ATA for the escrow mint, which is what a console sends by default.
 */
export function createEscrowClaimIntent(body: EscrowClaimBody = {}): Promise<EscrowIntent> {
  return api.post<EscrowIntent>("/escrow/withdrawals/intent", body);
}

/**
 * `POST /escrow/limits-intent` — builds `set_escrow_limits(...)`. One step;
 * takes effect immediately.
 *
 * Both limits move together, and `"0"` on either REFUSES EVERY REDEMPTION — it
 * is not "unlimited". A console that renders a zero as "no limit" tells a buyer
 * they are unprotected at the exact moment no call of theirs can be paid at all.
 */
export function createEscrowLimitsIntent(body: EscrowLimitsBody): Promise<EscrowIntent> {
  return api.post<EscrowIntent>("/escrow/limits-intent", body);
}


/**
 * `POST /escrow/limits` — **submit** the signature `limits-intent` asked for.
 *
 * The pair is deliberate and the naming carries it: `…-intent` builds something
 * to sign, the bare path sends what was signed. On `eip155` the thing that was
 * signed is an EIP-712 request and the platform's relayer pays the gas — which
 * is the whole reason this route exists: `setLimits` is `msg.sender`-only, so
 * without it a buyer holding USDG and no ETH could never arm their own escrow.
 *
 * There is no Solana equivalent and there must not be one. A Solana buyer signs
 * and sends their own transaction with their own SOL; a Solana session here is
 * refused `CHAIN_UNSUPPORTED` rather than answered, and
 * `submitRelayedEscrowIntent` refuses before the request is made at all.
 *
 * **The body is the issued message, echoed back, plus the signature.** Nothing
 * is re-derived here — see {@link SubmitSetLimitsBody}.
 */
export function submitEscrowLimits(body: SubmitSetLimitsBody): Promise<RelayedEscrowIntent> {
  return api.post<RelayedEscrowIntent>("/escrow/limits", body);
}

/**
 * `POST /escrow/withdrawals/request` — submit the signature
 * `withdrawals/request-intent` asked for.
 *
 * Refused while withdrawals are frozen, exactly as building one is: relaying a
 * request signed before a freeze would make the freeze mean nothing.
 *
 * This starts the one-hour clock; it pays nothing out. `withdraw()` has no
 * relayed form anywhere in the contract and nothing on this controller will
 * ever send it for a buyer.
 */
export function submitEscrowWithdrawRequest(
  body: SubmitRequestWithdrawBody,
): Promise<RelayedEscrowIntent> {
  return api.post<RelayedEscrowIntent>("/escrow/withdrawals/request", body);
}

/**
 * `GET /escrow/debts` — the payer's BUYER DEBTS: served paid calls whose
 * payment could not be collected, in every state (`OPEN`, `REPLACING`,
 * `WRITTEN_OFF`). Paid calls are refused (`PAYMENT_DEBT_OUTSTANDING`) until
 * each is collected; free calls work. Lists
 * the session account's debts and the organization's, so a console sees every
 * debt that blocks its agents — but only the session account's own can be
 * settled from here (`account` on the answer).
 */
export function getBuyerDebts(): Promise<BuyerDebts> {
  return api.get<BuyerDebts>("/escrow/debts");
}

/**
 * `POST /escrow/debts/:intentId/voucher-intent` — the replacement voucher that
 * settles one debt, with a fresh `seq`, plus its EIP-712 request on eip155.
 * Sign it unchanged before `voucher.expiresAt`. 404 `PAYMENT_DEBT_NOT_FOUND`
 * when it is settled already, another wallet's, or (for an agent's delegate)
 * another agent's call; 409 `PAYMENT_DEBT_REPLACEMENT_PENDING` while a signed
 * replacement is being collected; 429 `PAYMENT_NEXT_SEQ_RATE_LIMITED`. The
 * optional `{ resource }` body (for an old debt whose tool is gone) is not
 * sent: the console does not know the resource the call signed.
 */
export function createDebtVoucherIntent(intentId: string): Promise<DebtVoucherIntent> {
  return api.post<DebtVoucherIntent>(`/escrow/debts/${encodeURIComponent(intentId)}/voucher-intent`, {});
}

/**
 * `POST /escrow/debts/:intentId/voucher` — settle one debt with the signed
 * voucher. Answers `REPLACING`: the debt is collected within about a minute.
 * See `settleDebtErrorSentence` for the refusals.
 */
export function submitDebtVoucher(intentId: string, body: SettleDebtBody): Promise<SettleDebtResult> {
  return api.post<SettleDebtResult>(`/escrow/debts/${encodeURIComponent(intentId)}/voucher`, body);
}
