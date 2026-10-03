import type { Money } from "@/interfaces";
import type { AccountBalance } from "@/services";

/**
 * `GET /balances` returns per-chain rows with money positions that
 * `AccountBalance` in `balances.service.ts` did not declare — `pending`,
 * `pendingDeposits` and `withdrawable` are all on the wire and all on the Funding screen —
 * plus the two per-chain fields nothing on this side was reading:
 * `chainId` and `accountId`.
 *
 * That gap was the whole defect. The rows carried their chain from the start; the screen read `balances[0]` and threw the rest away.
 *
 * Reconciled against `AccountBalanceDto` in assay-backend
 * (assay-backend `src/modules/ledger/dto/get-balances.dto.ts`). Two differences from that DTO are deliberate:
 *
 * - The extra positions are declared **optional** here while the DTO declares
 *   them required. Optional is the safe direction for a reader: it forces the
 *   absent branch to exist, and this mirror has no sync guard, so a field that
 *   stops being sent must not become `undefined` behind a non-optional type.
 * - `withdrawable` is `Money | null` because the DTO's is nullable.
 *
 * **Corrected 2026-09-11.** This file used to say that `withdrawable`'s null
 * means "the chain could not be read" and that "every caller must fall through
 * it rather than format it". Both halves were wrong, and together they were a
 * shipped defect. `null` means *either* "no escrow on this chain yet"
 * (`chainReadable: true`) *or* "nobody looked" (`chainReadable: false`), and
 * the flag that separates them was not declared here at all. The falling
 * through is what did the damage: `withdrawable ?? available` printed the
 * LEDGER's $9.96 under the heading "Withdrawable" while Solana devnet was
 * genuinely unreadable, with no badge, sub-text or banner anywhere on
 * `/funding` distinguishing it from a confirmed on-chain read.
 *
 * So `chainReadable` is mirrored and **required** (see the field), and the
 * three states go through `@/features/chain-read`, which has no input that can
 * make an unreadable chain print an amount. `chainBalance` and `spendable`
 * are mirrored alongside it with the same null semantics, so the next screen
 * that needs one does not have to re-derive this paragraph.
 */
export interface FullBalance extends AccountBalance {
  /** CAIP-2. The chain this balance is held on and spent on. */
  chainId: string;
  /** CAIP-10. Which account this row is — two rows for one asset were previously indistinguishable. */
  accountId: string;
  pending?: Money;
  pendingDeposits?: Money;
  /**
   * `AccountBalanceDto.withdrawable` — what `POST /withdrawals` would actually
   * move, read off the chain.
   *
   * **`null` means two different things and `chainReadable` is the only thing
   * that separates them.** With `chainReadable: true` it is the chain's own
   * answer: this account has no escrow yet. With `chainReadable: false` it is
   * *unknown* — nobody looked. Never format it directly, and never fall
   * through it to `available`: `available` is a LEDGER figure, and printing it
   * under the heading "Withdrawable" is a claim about what the chain will pay.
   */
  withdrawable?: Money | null;
  /**
   * Whether the chain was read for THIS row, per `(account, asset)`.
   *
   * **Required, deliberately.** This field was on the wire long before it
   * was on this interface at all, which is how `/funding` printed
   * the ledger's $9.96 as a confirmed "Withdrawable" while Solana devnet was
   * down. Declaring it required makes every fixture and every caller state the
   * chain's state rather than inherit a default — the comparison between what
   * the wire says and what this side believes becomes a compile error instead
   * of an aspiration.
   *
   * `chainBalance`, `spendable` and `withdrawable` are all `null` when this is
   * false, and all three are then UNKNOWN, not zero.
   */
  chainReadable: boolean;
  /** `escrow_ata.amount` off the chain. `null` under the same two conditions as `withdrawable`. */
  chainBalance?: Money | null;
  /** `chainBalance` less open ledger holds, floored at zero. Same null semantics. */
  spendable?: Money | null;
}

export interface Hold {
  id: string;
  intentId: string;
  amount: Money;
  status: string;
  createdAt: string;
  ageSeconds: number;
  expiresAt: string;
}

const ZERO = (asset: string, decimals: number): Money => ({ amount: "0", asset, decimals });

/**
 * Every chain's balance, in the order the API served them.
 *
 * **This replaces `primaryBalance`, which returned `balances[0]`.** Under one
 * chain the two are identical, which is exactly why nothing caught it: a
 * two-chain buyer holding 12.50 USDC and 4.00 USDG saw `$12.50` labelled
 * "Available", and no surface anywhere said the 4.00 existed.
 *
 * **There is no sum, and there must never be one — not even labelled "USD
 * equivalent".** A total implies the buyer can spend it on one call, and they
 * cannot: the two are different CAIP-19 assets on chains that do not reach
 * each other, and the platform never bridges, never quotes a cross-chain
 * price and never nets two chains against each other.
 *
 * **An empty list is the absent state, never a zero.** Callers must branch on
 * `.length`, not on the array — an array is always truthy, and the version of
 * that mistake that already shipped
 * (`components/g31/providers-view.tsx:112`) took the wrong branch of
 * `stake ? … : "—"` and threw inside decimal.js.
 */
export function chainBalances(balances: FullBalance[] | undefined): readonly FullBalance[] {
  return balances ?? [];
}

/** Whether this buyer holds money on more than one chain — the label switch, not a total. */
export function hasMultipleChains(balances: readonly FullBalance[]): boolean {
  return balances.length > 1;
}

/**
 * The one chain's row, or `null` — for a screen that has no chain selector.
 *
 * `null` for zero rows **and** for two or more. A screen with one slot and no
 * way to say which chain it means must show nothing rather than pick, because
 * the pick is always the first row and the first row is always somebody's
 * wrong chain. Auto top-up (no endpoint at all) is the caller.
 *
 * Extracted from a `balances.length === 1 ? balances[0] : null` written inline
 * on that page. **A mutation sweep changed that line to
 * `balances ? balances[0] : null` — a silent first-chain pick — and all 300
 * tests passed.** A line on a page no test can render is a line with no guard;
 * this function is the guard, and `soleChainBalance` has its own two-chain
 * case below it.
 */
export function soleChainBalance(balances: readonly FullBalance[]): FullBalance | null {
  return balances.length === 1 ? balances[0] : null;
}

export function zeroLike(money: Money): Money {
  return ZERO(money.asset, money.decimals);
}
