import type { BuyerEscrow } from "@/interfaces";

/**
 * Which of three things `GET /escrow` actually said, as one word.
 *
 * ## The defect this replaces
 *
 * The page branched on `escrow && !escrow.exists`. `GetEscrowResponseDto.exists`
 * is `boolean | null`, `null` means "the chain could not be read, so I do not
 * know", and `!null === true` in JavaScript — so the unknown state rendered the
 * **same definitive sentence** as a real `exists: false`:
 *
 * > You do not have an escrow yet — … your first deposit opens it, and there is
 * > nothing to withdraw until then.
 *
 * That was printed live, twice, to a buyer holding $9.96 whose escrow the
 * platform had simply failed to look at. The wire was unambiguous
 * (`{"exists":null,"chainReadable":false,…}`); the frontend interface typed the
 * field as a plain `boolean`, so nothing on this side could even express the
 * third answer.
 *
 * ## Why a function and not an inline ternary
 *
 * Because the mistake is one character wide. `!escrow.exists`,
 * `escrow.exists === false` and `escrow.exists !== true` are three different
 * programs, and only the middle one is right — reading which is which at four
 * separate call sites on a 900-line page is exactly how the wrong one survives
 * review. One named function, one test file, three states that cannot collapse.
 */
export type EscrowPresence =
  /** The chain answered: this escrow is open. Its figures can be printed. */
  | "open"
  /** The chain answered: there is no escrow at those seeds. A deposit opens one. */
  | "absent"
  /** Nobody looked. NOT "no escrow", NOT zero — and never a sentence in the present tense. */
  | "unreadable";

/**
 * `undefined` in, `null` out — the caller is still loading and has no state to
 * render. Every other input resolves to exactly one of the three.
 *
 * **Both conditions collapse to `unreadable`.** `chainReadable: false` is the
 * backend saying it could not look; `exists: null` is the same fact expressed
 * through the field. The DTO sends them together, and a response carrying only
 * one of them is still a response that does not know — so this asks for both
 * and trusts neither alone.
 */
export function escrowPresence(escrow: BuyerEscrow | undefined | null): EscrowPresence | null {
  if (!escrow) return null;
  if (escrow.chainReadable !== true || escrow.exists === null || escrow.exists === undefined) {
    return "unreadable";
  }
  return escrow.exists ? "open" : "absent";
}
