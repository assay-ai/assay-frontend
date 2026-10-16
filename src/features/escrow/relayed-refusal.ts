import { ApiError } from "@/libs/ApiClient";
import { formatClock } from "@/libs/utc-time";

/**
 * @fileoverview
 * What to tell a buyer whose signed request was not relayed.
 *
 * ## Why this is a module and not a ternary on the page
 *
 * A buyer who has just approved a wallet prompt and is then told "something
 * went wrong" has no idea whether to retry, wait, reconnect a different wallet,
 * or stop. The five refusals the submit routes publish are five different
 * instructions, and two of them are the buyer's own mistake to fix while two
 * are the platform's and one is the chain's. Collapsing them costs the buyer
 * the one action that would have worked.
 *
 * ## The 409 carries the chain's refusal inside its message, not its code
 *
 * `SETTLEMENT_RELAYED_INTENT_REFUSED` is ONE code covering six distinct
 * `Errors.sol` refusals — `BadNonce`, `SignatureExpired`, `MalleableSignature`,
 * `SignerIsNotBuyer`, `EscrowLimitsUnchanged`, `ProgramPaused` — and the error
 * envelope this API emits has no `details` member to carry which
 * (`shared/errors/error-response.ts`: "There are no optional members").
 * The name is in the `message`, in a format the backend builds itself:
 *
 *     The relayed escrow request was refused: BadNonce — nothing was submitted
 *
 * So the name is read out of the message. **Ruling, and what it costs if it is
 * wrong:** matching prose is fragile, and the failure mode is chosen to be the
 * harmless one — an unmatched message falls through to the generic 409
 * sentence *plus the server's own words verbatim*, which is exactly what the
 * page would have shown anyway. Nothing is invented and no instruction is given
 * that the message does not support. The alternative, branching on the status
 * code alone, would tell a buyer with a used nonce to "wait and try again",
 * which is advice that can never work.
 */

/**
 * The `Errors.sol` names the pre-flight decodes, as this app understands them.
 *
 * A union of literals and not an enum, for the reason every other backend
 * vocabulary in this app is one: a name the contract adds later must arrive as
 * an unmatched string that falls through to the generic sentence, never as a
 * member this file invented.
 */
export type RelayedChainRefusal =
  | "BadNonce"
  | "SignatureExpired"
  | "MalleableSignature"
  | "SignerIsNotBuyer"
  | "EscrowLimitsUnchanged"
  | "ProgramPaused";

const CHAIN_REFUSALS: readonly RelayedChainRefusal[] = [
  "BadNonce",
  "SignatureExpired",
  "MalleableSignature",
  "SignerIsNotBuyer",
  "EscrowLimitsUnchanged",
  "ProgramPaused",
];

/**
 * What the buyer can usefully do next, as one word.
 *
 * The page turns this into an affordance — `rebuild` gets a button that throws
 * the dead signature away and asks for a fresh one, `wait` gets no button at
 * all. It is a separate field from the sentence so that a test can assert two
 * refusals differ in *what they ask for* and not merely in their wording: two
 * sentences that read differently and both offer a retry that cannot work are
 * the defect this file exists to prevent.
 */
export type RelayedRetry =
  /** The signature is dead. Ask for a new request and sign that one. */
  | "rebuild"
  /** Nothing is wrong with the request. Try the same one again shortly. */
  | "wait"
  /** A different wallet has to sign this. */
  | "wallet"
  /** Nothing the buyer does changes the answer. */
  | "none";

export interface RelayedRefusal {
  readonly code: string;
  /** The `Errors.sol` name, when the chain named one. `null` otherwise. */
  readonly reason: RelayedChainRefusal | null;
  readonly text: string;
  readonly retry: RelayedRetry;
}

/**
 * The chain's own refusal, pulled out of the server's sentence.
 *
 * Word-boundary matched against a fixed list rather than parsed positionally:
 * The backend composes the message from three fragments and a positional
 * reader would break on the one that is absent when nothing was submitted.
 */
export function chainRefusalIn(message: string): RelayedChainRefusal | null {
  return CHAIN_REFUSALS.find((name) => new RegExp(`\\b${name}\\b`).test(message)) ?? null;
}

/**
 * One sentence and one instruction per named refusal.
 *
 * Every sentence here obeys the same rule: it says what happened to the money
 * and to the signature, then what to do. The zero-ETH buyer is the reader —
 * none of these may suggest they need gas, because they need none for either
 * relayed door and the whole point of the pair is that the platform pays.
 */
export function relayedRefusal(error: ApiError, nowMs: number = Date.now()): RelayedRefusal {
  switch (error.code) {
    case "SETTLEMENT_RELAYED_INTENT_FOR_ANOTHER_BUYER":
      return {
        code: error.code,
        reason: null,
        retry: "wallet",
        text:
          "That request was signed for a different account than the one you are signed in as. " +
          "The platform pays the gas for this call and will not pay it for somebody else's " +
          "signature. Nothing was submitted and your escrow is untouched — connect the wallet " +
          "this escrow belongs to and sign again.",
      };

    case "SETTLEMENT_RELAYED_INTENT_MALFORMED":
      return {
        code: error.code,
        reason: null,
        retry: "rebuild",
        text:
          "The signature your wallet returned is not in the form the contract reads, so nothing " +
          "was submitted and nothing was charged. Build the request again and sign the fresh " +
          "one. If it happens twice, the wallet is the thing to change, not the amount.",
      };

    case "SETTLEMENT_RELAYED_INTENT_REFUSED":
      return chainRefusal(error);

    case "SETTLEMENT_RELAYED_INTENT_RATE_LIMITED":
      return {
        code: error.code,
        reason: null,
        retry: "wait",
        text:
          "You have used this account's share of the relayer's gas budget for now. This is a " +
          "limit on how often the platform will pay to submit for you, not a limit on your " +
          "escrow: nothing was submitted, nothing was charged, and your money is where it was. " +
          retryWhen(relayRetryAt(error.message), nowMs),
      };

    case "SETTLEMENT_RELAYED_INTENT_UNAVAILABLE":
      return {
        code: error.code,
        reason: null,
        retry: "wait",
        text:
          "The platform could not count its own submission budget, so it submitted nothing " +
          "rather than risk submitting too much. This is ours, not yours. Your signature stays " +
          "valid until its deadline — try again in a moment.",
      };

    case "SETTLEMENT_WITHDRAWALS_FROZEN":
      return {
        code: error.code,
        reason: null,
        retry: "none",
        text:
          "Withdrawals are frozen while the last reconciliation is investigated — it found the " +
          "vault holding less than it owes. This is not specific to your escrow and nothing has " +
          "been taken from it. Starting exits during a known shortfall would make it a race " +
          "between users over money that is already not all there.",
      };

    default:
      return {
        code: error.code,
        reason: null,
        retry: "wait",
        /*
          The server's own words, not an invented sentence. An unknown code on a
          money path is precisely when a made-up instruction is most likely to
          be the wrong one.
        */
        text: `${error.message} Quote ${error.code} if you contact support.`,
      };
  }
}

/**
 * When the relay budget frees up, from the server's sentence ("… You can make
 * the next one from 2026-10-12T13:17:14.000Z."), or `null` when it names none
 * (BUG-D1-06).
 */
export function relayRetryAt(message: string): Date | null {
  const match = /from (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/.exec(message);
  if (!match) return null;
  const at = new Date(match[1]);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** "You can try again at 13:17 UTC (in 12 minutes)." */
function retryWhen(at: Date | null, nowMs: number): string {
  if (!at) return "Wait a few minutes and try again.";
  const minutes = Math.max(1, Math.ceil((at.getTime() - nowMs) / 60_000));
  return `You can try again at ${formatClock(at)} UTC (in ${minutes} minute${minutes === 1 ? "" : "s"}).`;
}

/** The 409 branch: the chain refused, and it said why. */
function chainRefusal(error: ApiError): RelayedRefusal {
  const reason = chainRefusalIn(error.message);
  switch (reason) {
    case "BadNonce":
      return {
        code: error.code,
        reason,
        retry: "rebuild",
        text:
          "That request has already been used. Each signed request carries a counter that the " +
          "contract spends once, and one counter serves both escrow doors — so a change to your " +
          "limits also retires a withdrawal request signed beforehand. Nothing was submitted " +
          "this time and nothing was charged. Build the request again: the fresh one carries " +
          "the counter as it stands now.",
      };

    case "SignatureExpired":
      return {
        code: error.code,
        reason,
        retry: "rebuild",
        text:
          "The signature had a deadline and it has passed. Nothing was submitted and nothing " +
          "was charged — the deadline is what stops a signature you approved today being used " +
          "against you next month. Build the request again and sign it without leaving the " +
          "wallet prompt open.",
      };

    case "MalleableSignature":
      return {
        code: error.code,
        reason,
        retry: "rebuild",
        text:
          "The contract refused the shape of that signature — the same signature can be written " +
          "two ways and it accepts only one, so that a single approval cannot be replayed under " +
          "a second identity. Nothing was submitted. Build the request again and sign the fresh " +
          "one; if the same wallet does it twice, sign with a different one.",
      };

    case "SignerIsNotBuyer":
      return {
        code: error.code,
        reason,
        retry: "wallet",
        text:
          "The contract recovered a different address from that signature than the escrow's " +
          "owner, so it refused it. Nothing was submitted. Connect the wallet that owns this " +
          "escrow — it is the only key the contract answers to — and sign again.",
      };

    case "EscrowLimitsUnchanged":
      return {
        code: error.code,
        reason,
        retry: "none",
        text:
          "Those are already your limits, so the contract refused to spend gas writing them " +
          "again. Nothing was submitted and nothing has changed. Enter figures that differ from " +
          "the ones shown above if you meant to change them.",
      };

    case "ProgramPaused":
      return {
        code: error.code,
        reason,
        retry: "wait",
        text:
          "The settlement contract is paused, so it is accepting nothing from anyone right now " +
          "— not this request and not a redemption against your escrow. Nothing was submitted " +
          "and your money is where it was. There is nothing for you to fix; try again later.",
      };

    default:
      return {
        code: error.code,
        reason: null,
        retry: "rebuild",
        /*
          A revert whose selector belongs to nobody this app knows. The server's
          own message carries it (`UNKNOWN_REVERT:0x…`), so it is printed rather
          than summarised: the selector is the only thing that identifies it.
        */
        text:
          `The chain refused this request and the platform passed on its reason verbatim: ` +
          `${error.message}. Nothing about your escrow changed. Build the request again; if the ` +
          `same refusal comes back, quote that reason to support.`,
      };
  }
}

/**
 * Whether an error is one the relayed vocabulary above speaks for.
 *
 * The escrow screens already have a refusal table for the `*-intent` routes,
 * and the two must not silently overlap: a `SETTLEMENT_WITHDRAWALS_FROZEN` on a
 * *build* is the same sentence either way. Every `…RELAYED…` code comes from a
 * submit, except `…RATE_LIMITED`, which the intent routes now also answer
 * BEFORE anything is signed (BUG-D1-06). The page asks this before choosing
 * which table to read.
 */
export function isRelayedRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code.startsWith("SETTLEMENT_RELAYED_INTENT_");
}
