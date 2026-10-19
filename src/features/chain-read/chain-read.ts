import type { Money } from "@/interfaces";
import { formatMoney } from "@/utils/money";

/**
 * The three states a chain-derived figure is in, and the one rule that they
 * must never render alike.
 *
 * ## Why this exists
 *
 * Three screens shipped the same defect within one milestone, and all three
 * were the same sentence: **a chain that could not be read was rendered as a
 * confident answer.** `/funding` printed the ledger's `available` under the
 * heading "Withdrawable" with nothing marking it as unconfirmed;
 * `/funding/escrow` read `exists: null` as `exists: false` and told a buyer
 * with $9.96 "You do not have an escrow yet"; `/provider/capital` read a
 * per-chain array at the top level, got `undefined`, and told a provider with
 * $500 bonded that the chain could not be read.
 *
 * Every backend DTO on this surface (`AccountBalanceDto.chainReadable`,
 * `GetEscrowResponseDto.chainReadable`, `ProviderChainStakeDto.chainReadable`
 * / `hasKnownStake`) already spells the distinction out at length. The wire
 * was never ambiguous. What was missing was one vocabulary on this side, so
 * that "we could not look" has a *word* rather than being whatever the nearest
 * `??` happens to fall through to.
 *
 * ## The three states
 *
 * ```text
 *  state        what it means                        what it must never be
 *  read         the chain answered, with this much   (a zero read is `read`)
 *  absent       the chain answered: nothing there    not "unknown"
 *  unreadable   we could not look                    not zero, not a fallback
 * ```
 *
 * A **zero read is `read`**, and that is the distinction with teeth: `$0.00`
 * is a strictly stronger claim than "Unknown", and a design where an outage
 * and an empty account look the same is the defect, not a cosmetic issue.
 */
export type ChainReadState = "read" | "absent" | "unreadable";

/**
 * What an unreadable chain prints instead of a figure.
 *
 * Deliberately a **word, not an em dash**. The dash is already this codebase's
 * "we have not computed that" (see `/provider/capital`'s `money()`), so a dash
 * here would mean two things on one screen — and the report on the three
 * defects named exactly that: "an em-dash that means both 'nothing' and 'we
 * could not tell'".
 */
export const UNREADABLE_TEXT = "Unknown";

/** The chain answered and there is nothing there — not a figure, and not "Unknown". */
export const ABSENT_TEXT = "None";

export interface ChainFigure {
  readonly state: ChainReadState;
  /** Ready to print. Never a number, never a bare `null`. */
  readonly text: string;
}

export interface ChainFigureOptions {
  /** Fraction digits, passed through to `formatMoney`. */
  readonly decimals?: number;
  /** Override for the `absent` wording, e.g. "None yet" where a deposit opens one. */
  readonly absentText?: string;
}

/**
 * Turn a `chainReadable` flag and a nullable `Money` into one of the three
 * states, with the text already chosen.
 *
 * **`chainReadable !== true` is unreadable**, not `=== false`. A field that
 * stops being sent arrives as `undefined`, and the safe direction for a reader
 * is to say it does not know: a visible "Unknown" is loud and true, whereas
 * treating a missing flag as readable is how a stale mirror prints a confident
 * figure for a chain nobody asked. Ruled 2026-09-11; the cost if the backend
 * ever drops the field is that every buyer sees "Unknown" — noisy, and
 * impossible to mistake for a working screen.
 */
export function chainFigure(
  chainReadable: boolean | null | undefined,
  value: Money | null | undefined,
  options: ChainFigureOptions = {},
): ChainFigure {
  if (chainReadable !== true) {
    return { state: "unreadable", text: UNREADABLE_TEXT };
  }
  if (!value) {
    return { state: "absent", text: options.absentText ?? ABSENT_TEXT };
  }
  /*
    A zero Money reaches here and formats as `$0.00`. That is deliberate and it
    is the whole point: the chain was asked and the answer was zero, which is a
    different and much stronger claim than either of the two states above.
  */
  return { state: "read", text: formatMoney(value, { decimals: options.decimals ?? 2 }) };
}
