/**
 * The buyer's escrow, as the shipped backend actually serves it.
 *
 * **Source: code, not plan.** Every shape below was read field-for-field off
 * the backend's settlement module:
 *
 *   - assay-backend `src/modules/settlement/dto/get-escrow.dto.ts` (`GetEscrowResponseDto`)
 *   - assay-backend `src/modules/settlement/dto/create-escrow-intent.dto.ts`
 *     (`SetEscrowLimitsBodyDto`, `RequestWithdrawBodyDto`, `WithdrawBodyDto`,
 *     `UnsignedEscrowTransactionDto`, `CreateEscrowIntentResponseDto`)
 *
 * **The provider's earnings are no longer a balance held anywhere.** Lean v3's
 * `redeem_voucher` pays the provider's own token account at the moment of
 * redemption, so there is no `ProviderEarnings` PDA, no earnings vault, no
 * withdrawal and no preflight. The three types that modelled that flow
 * (`ProviderEarningsBalance`, `EarningsIntentKind`, `EarningsIntent`) are gone
 * with the routes that served them; what survives is the historical earned
 * report in `./provider-reports`, which is a different thing that happens to
 * share the word.
 */

import type { Money } from "./api";
import type { UnsignedStakeTransaction } from "./provider-stake";

/**
 * The buyer's escrow, as `GET /escrow` reports it —
 * `GetEscrowResponseDto`, field-for-field.
 *
 * `BuyerEscrow` is the PDA at `["escrow", buyer]`; the buyer's *balance* is the
 * escrow's associated token account, not a field carried on the PDA itself
 * — `balance` here is an ATA read, and the read fails closed
 * (503) rather than serving a stale picture, so this response is either fresh
 * or absent. `spendable` is that balance minus open ledger holds, floored at
 * zero.
 */
export interface BuyerEscrow {
  /**
   * Absent is not zero, and **unknown is not absent**.
   *
   * A buyer with no escrow needs one opened (a deposit does this); a buyer
   * with an empty one needs money — different errands, so this is its own
   * field rather than inferred from a null balance.
   *
   * `null` is the third answer and it is the one this interface used to deny:
   * `GetEscrowResponseDto.exists` is `boolean | null`, and `null` means "the
   * chain could not be read, so I do not know". Typed as a plain `boolean`
   * here, the page's `!escrow.exists` read `!null === true` and printed the
   * definitive "You do not have an escrow yet" at a buyer with a real $9.96
   * balance while Solana devnet was down. Branch through
   * `escrowPresence()` in `@/features/escrow/escrow-presence`, never on this
   * field directly.
   */
  exists: boolean | null;
  /**
   * False when the chain could not be read on this request.
   *
   * Every chain-derived field on this response is then `null` because it is
   * **unknown** — not zero, and not "no escrow yet", which is what the same
   * nulls mean when this is true. `account`, `escrowPda`, `escrowTokenAccount`
   * and `nextSeq` are database facts and survive it.
   *
   * It was on the wire long before it appeared in this file,
   * `escrow.service.ts` or the page, so check the backend DTO when it changes.
   */
  chainReadable: boolean;
  /** The buyer's CAIP-10 account this escrow was read for. */
  account: string;
  /** The escrow PDA, base58. `null` when `exists` is false. */
  escrowPda: string | null;
  /** The escrow's ATA — this is what `payTo` on a deposit resolves to. `null` when `exists` is false. */
  escrowTokenAccount: string | null;
  /** `escrow_ata.amount`, live off the chain. `null` when `exists` is false. */
  balance: Money | null;
  /** Σ over every OPEN ledger hold against this escrow. */
  openHolds: Money | null;
  /** `balance − openHolds`, floored at zero. What a new call can draw on. */
  spendable: Money | null;
  /**
   * The ceiling the buyer signed for in `request_withdraw`. `"0"` when
   * nothing is pending. NOT what they will receive — `withdraw` pays
   * `min(requested, escrow_ata.amount)`.
   */
  withdrawRequested: Money | null;
  /**
   * When `withdraw()` becomes callable, ISO-8601. Null when nothing is
   * pending. An INSTANT the backend read off `BuyerEscrow.withdraw_available_at`,
   * never a duration the client adds to `serverTime`.
   *
   * The wait itself is the program's `WITHDRAW_DELAY_SECONDS` — a
   * program constant, not a `Config` field, and deliberately not
   * modelled here. The route may still send a `withdrawDelaySeconds`; nothing
   * reads it, because a client that rendered `now + delay` against its own
   * clock would be wrong in the direction that tells a buyer their money is
   * available before the chain will pay it.
   */
  withdrawAvailableAt: string | null;
  /** The server's own clock at the moment it answered — pairs with `withdrawAvailableAt` so a countdown does not inherit a skewed browser clock. */
  serverTime: string;
  /** Buyer-set, on chain. `"0"` REFUSES EVERY REDEMPTION — it is not "unlimited"; a buyer who wants no ceiling has `u64::MAX` here. `null` when `exists` is false. */
  maxVoucherAmount: Money | null;
  /** Buyer-set, on chain. Measured over `windowSeconds`. `"0"` refuses everything, same rule. `null` when `exists` is false. */
  maxPerWindow: Money | null;
  /** How much of `maxPerWindow` has been spent in the current window. */
  spentInWindow: Money | null;
  /** When the current window began. `null` until the first redemption, or when `exists` is false. */
  windowStartedAt: string | null;
  /**
   * The window's width in seconds. A fixed program constant (86,400), not an
   * operator-tunable one — `Config` has no such field, so the backend keeps it
   * in `settlement/constants/escrow-account.constants.ts`. Print it; do not
   * assume it can change under you mid-session.
   */
  windowSeconds: number;
  /**
   * ISO-8601. When this reading was taken from the chain — distinct from
   * `serverTime`. **`null` when there was no reading to take**
   * (`chainReadable: false`); the DTO is nullable and this was not, which is
   * how the page had a `read from the chain at {observedAt}` line that would
   * have printed the word `null` to a buyer during an outage.
   */
  observedAt: string | null;
  /**
   * Lifetime money in and out of this escrow, read from the chain in the same
   * call as `balance`: `deposited − spent − withdrawn = balance` by the
   * contract's own invariant. `spent` includes payments still in their 1-hour
   * hold. `null` where the chain keeps no such counters (Solana), with no
   * escrow, or when the chain could not be read; absent from an older backend.
   */
  lifetime?: EscrowLifetime | null;
}

/** `BuyerEscrow.lifetime`. */
export interface EscrowLifetime {
  deposited: Money;
  spent: Money;
  withdrawn: Money;
}

/**
 * Body of `POST /escrow/withdrawals/request-intent` (`RequestWithdrawBodyDto`).
 */
export interface WithdrawIntentBody {
  /**
   * Atomic units as a decimal integer string. The server validates
   * `/^\d+$/` with a 32-character ceiling, then range-checks it against `u64`.
   * Never a number. **`"0"` cancels a standing request**, which is why the
   * regex admits a leading zero rather than excluding it.
   */
  amount: string;
}

/**
 * Body of `POST /escrow/withdrawals/intent` (`WithdrawBodyDto`).
 *
 * No amount: the program pays `min(requested, escrow_ata.amount)`, and sending
 * one would imply the browser controls a figure it does not.
 */
export interface EscrowClaimBody {
  /**
   * The token account the buyer wants paid, **chain-native** (a bare Solana
   * address, not a CAIP-10 string — the server wraps it against the session's
   * own chain). Omit for the buyer's own ATA for the escrow mint, which is
   * what a console sends by default.
   */
  destination?: string;
}

/**
 * Body of `POST /escrow/limits-intent` (`SetEscrowLimitsBodyDto`) — the
 * two buyer-set limits.
 *
 * Both move together, because `set_escrow_limits` takes both and a partial
 * update would need a read-modify-write the buyer did not sign.
 */
export interface EscrowLimitsBody {
  /** Atomic units, decimal integer string (`/^\d+$/`, ≤32 chars). `"0"` refuses every redemption; `u64::MAX` is "no ceiling". */
  maxVoucherAmount: string;
  /** Same encoding, same "0 means refuse" rule. */
  maxPerWindow: string;
  /** Accept that lower limits strand payments still being settled (BUG-D1-07). */
  acknowledgeUnsettled?: boolean;
}

/**
 * The unsigned bytes a wallet is handed. Structurally
 * `UnsignedEscrowTransactionDto` and `UnsignedStakeTransactionDto`, which the
 * backend declares twice — field for field the same — only because neither
 * domain module may import the other. One declaration here, so the console
 * signs an escrow transaction with the helper it already has.
 */
export type UnsignedEscrowTransaction = UnsignedStakeTransaction;

/**
 * The three transactions a buyer's own wallet signs against their escrow.
 *
 * There is no `CLOSE`. Lean v3 removed `close_escrow` from the program — an
 * escrow account is permanent and its rent is never reclaimed — so the kind,
 * the route and the quarantine that guarded it are all gone.
 */
export type EscrowIntentKind = "SET_LIMITS" | "REQUEST_WITHDRAW" | "WITHDRAW";

/**
 * `CreateEscrowIntentResponseDto` — the one response shape all three escrow
 * intents return.
 *
 * **`transaction` is not nullable, and there is no `blockedBy`.** An earlier
 * revision aliased this to `StakeIntent` on the theory that "an intent the
 * chain would refuse comes back as a reason, not as bytes". That is true of the
 * *stake* withdrawal and false here: the escrow controller refuses with a **409**
 * (withdrawals frozen, nothing outstanding, not yet matured) and never with a
 * 201 carrying `transaction: null`. A screen that branched on
 * `transaction === null` would silently render nothing for a case that never
 * arrives, while the real refusal went to the error path unhandled.
 *
 * There is no `preflight` and no `amount` on this envelope either. What it
 * carries instead is `escrow` — the full `GET /escrow` state as it was when the
 * bytes were built, so a console re-renders without a second round trip.
 */
export interface EscrowIntent {
  kind: EscrowIntentKind;
  /** The buyer's CAIP-10 account. Taken from the session, never from the request. */
  account: string;
  transaction: UnsignedEscrowTransaction;
  /** The escrow state as it was when the bytes were built. */
  escrow: BuyerEscrow;
  /**
   * The gas grant this request triggered, or `null`.
   *
   * `WithdrawGasGrantDto` on the backend, field for field. Present on every
   * escrow intent response and `null` on all but `WITHDRAW`; also `null` on a
   * chain that has no gas grant at all — Solana, where the account that signs
   * the withdrawal already holds the SOL that pays for it.
   *
   * **It is never a reason the withdrawal failed.** A refusal here arrives
   * alongside a perfectly valid `transaction`; the buyer may already hold gas,
   * or may have been funded once before. The screen must not read any value of
   * this field as "you cannot withdraw".
   */
  gasGrant: WithdrawGasGrant | null;
}

/**
 * The bounded, once-per-address-ever gas grant, as the API reports it.
 *
 * `withdraw()` on `eip155` is `msg.sender`-only, so a buyer holding USDG and no
 * ETH has no exit — the platform's answer is to fund that exact address with
 * the gas for one `withdraw`. Originally there was **no API that reported grant
 * state** and `withdraw-gas-note.ts` deliberately promised nothing. This is
 * that API; the pre-claim note is unchanged, because before the buyer clicks
 * there is still nothing to report.
 *
 * **No wei and no cap.** The backend does not publish either — a buyer cannot
 * act on the figure, and publishing it with a refusal reason lets anyone with a
 * session bracket the platform's faucet. `transactionHash` is what a buyer can
 * use: it is the transfer, on an explorer.
 */
export interface WithdrawGasGrant {
  /**
   * `GRANTED` — the relayer sent this address the gas for one `withdraw`; it
   * has to confirm before the withdrawal can be sent. `REFUSED` — a control
   * fired and `reason` says which; the system is working. `UNAVAILABLE` — the
   * grant could not be consulted at all, which is an outage and deliberately
   * not one of the refusals.
   */
  status: "GRANTED" | "REFUSED" | "UNAVAILABLE";
  /** Non-null exactly when `status` is `REFUSED`. */
  reason: GasGrantRefusal | null;
  /** Non-null exactly when `status` is `GRANTED`. */
  transactionHash: string | null;
}

/**
 * The eight controls, as the backend's `GasGrantRefusal` names them.
 *
 * A union of string literals rather than a TypeScript `enum`, because an `enum`
 * here is a second *runtime* declaration of a vocabulary that already has one,
 * and an `enum` member is not assignable from the string the wire actually
 * carries.
 *
 * ## This is a HAND MIRROR, and TypeScript does not guard it
 *
 * An earlier revision of this comment claimed that "a value the backend adds
 * later must be a compile error at the mapping table". **That was false**, and
 * it was false in the direction that matters: the union below is not generated
 * from anything, so a member the backend adds simply does not appear here, the
 * mapping table in `features/escrow/withdraw-gas-grant-note.ts` stays exhaustive
 * over a union that is one short, and nothing anywhere errors. It shipped that
 * way — `GRANT_IN_FLIGHT` was added on the backend and this file did not
 * notice, so a buyer whose grant was merely contending with another attempt was
 * told the faucet could not be consulted at all.
 *
 * What a compile error DOES catch is the opposite direction: add a member here
 * and `REFUSAL_TEXT` fails to compile until somebody writes its sentence. That
 * half is real and is worth keeping. The other half needs a gate:
 *
 *   - `node scripts/check-gas-grant-refusals.js` reads the backend's own enum
 *     (`settlement/ports/withdraw-gas-grant.port.ts`) and fails when this union,
 *     the copy table or the committed snapshot disagrees with it. It is the only
 *     check that can see a backend addition, and it needs the backend on disk.
 *   - `features/escrow/gas-grant-refusal.contract.test.ts` runs in `pnpm test`
 *     with no backend present, against the snapshot that script writes
 *     (`src/interfaces/gas-grant-refusal.backend.json`).
 *
 * Neither catches a backend addition that nobody ran the script for. The
 * runtime does: `withdrawGasGrantNote` logs an unknown reason loudly rather
 * than degrading to the outage sentence in silence.
 */
export type GasGrantRefusal =
  | "ALREADY_GRANTED"
  | "NO_MATURED_WITHDRAWAL"
  | "BUYER_HAS_GAS"
  | "ABOVE_PER_GRANT_CAP"
  | "DAILY_CAP_REACHED"
  | "RELAYER_FLOAT_LOW"
  | "TRANSFER_FAILED"
  /**
   * Another attempt to grant this same buyer's once-ever gas is mid-flight.
   *
   * **Transient, and deliberately not `ALREADY_GRANTED`** — the backend's own
   * enum says so at the source: nothing has been granted, the once-ever budget
   * is intact, and asking again in a moment is the right thing to do.
   */
  | "GRANT_IN_FLIGHT";

/**
 * Body of `POST /escrow/limits` — `SubmitSetLimitsBodyDto`, field for field.
 *
 * **Every member is echoed back from the `message` `POST
 * /escrow/limits-intent` answered with**, unchanged, plus the signature the
 * wallet produced over it. That is the backend's own rule and it is not a
 * convenience: a client that re-derived any field could sign one struct and
 * post another, and the contract would refuse the result as
 * `SignerIsNotBuyer` — a signature failure reported for a marshalling bug.
 *
 * `buyer` travels so that a request naming somebody else can be refused **by
 * name** (403 `SETTLEMENT_RELAYED_INTENT_FOR_ANOTHER_BUYER`). It is never the
 * address the call is encoded for; that comes from the session.
 *
 * Every integer is a decimal string. They are `uint64` on chain and JSON has
 * no such number — a field that arrived rounded produces a digest the
 * signature does not cover.
 */
export interface SubmitSetLimitsBody {
  buyer: string;
  maxVoucherAmount: string;
  maxPerWindow: string;
  /**
   * `Escrow.authNonce` as it stood when the intent was issued. **One counter
   * serves both relayed doors** — a `setLimits` that lands first invalidates a
   * `requestWithdraw` signed against the same value, and the chain says so
   * with `BadNonce`.
   */
  nonce: string;
  /** Unix seconds, as signed. Issued on the CHAIN's clock, not the server's. */
  deadline: string;
  /** `r || s || v` — 65 bytes, `0x`-prefixed, 130 hex digits. */
  signature: string;
  /** Not signed: accept that lower limits strand payments still being settled (BUG-D1-07). */
  acknowledgeUnsettled?: boolean;
}

/** Body of `POST /escrow/withdrawals/request` — `SubmitRequestWithdrawBodyDto`. */
export interface SubmitRequestWithdrawBody {
  buyer: string;
  /** Atomic units, decimal integer string, as signed. `"0"` retracts a standing request. */
  amount: string;
  nonce: string;
  deadline: string;
  signature: string;
}

/**
 * What both submit routes answer — `RelayedEscrowIntentResponseDto`.
 *
 * **No `transaction` member, and that is the point of a separate type.** The
 * `*-intent` routes answer with bytes somebody still has to sign; these answer
 * about a transaction that has already landed, and reusing that shape would
 * have meant a `transaction` field that is either null or a lie.
 *
 * `escrow` is read off the chain **after** the transaction was mined, so a
 * console re-renders from the contract's own answer rather than from what it
 * hoped it had submitted.
 */
export interface RelayedEscrowIntent {
  /**
   * `WITHDRAW` can never appear. `withdraw()` is `msg.sender`-only, there is
   * no `withdrawBySig` in the contract or its bytecode, and the backend's port
   * excludes the kind at the type level.
   */
  kind: "SET_LIMITS" | "REQUEST_WITHDRAW";
  /** The buyer's CAIP-10 account this was relayed for. */
  account: string;
  /**
   * The relayer's transaction, which **succeeded**. A revert is an error
   * response naming the contract's own refusal, never a 201 with a failed hash
   * in it — so nothing that reads this field has to check a status.
   */
  transactionHash: string;
  /** Decimal string. The block that included it. */
  blockNumber: string;
  /**
   * Decimal string. What the platform paid for, in gas — published because the
   * buyer paid none of it and is entitled to see what was spent for them.
   */
  gasUsed: string;
  /** The escrow as the chain reports it AFTER this transaction landed. */
  escrow: BuyerEscrow;
}
