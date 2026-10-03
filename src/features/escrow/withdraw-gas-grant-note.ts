import type { GasGrantRefusal, WithdrawGasGrant } from "@/interfaces";

/**
 * What the withdraw screen may say once a claim intent is in hand.
 *
 * ## Why this is a second module and not a change to `withdraw-gas-note.ts`
 *
 * That one answers a question asked BEFORE the buyer clicks: "what does this
 * step cost?". Nothing is known about a grant at that point — no request has
 * been made — so its careful refusal to promise anything is still correct and
 * is deliberately untouched.
 *
 * This one answers a question asked AFTER: `POST /escrow/withdrawals/intent`
 * has returned, and its `gasGrant` field says what the platform did. Folding
 * the two together would mean the pre-click note had to hedge about an outcome
 * that had not happened yet, which is how the original defect (a screen
 * promising a grant that is refused five ways) gets reintroduced.
 *
 * ## Why it is a module and not three ternaries in the page
 *
 * A list-branching line written inline in a page component has no guard at all:
 * no test can render it, so the branch nobody exercised is the branch that is
 * wrong. Every sentence below is reachable from a unit test, and
 * `withdraw-gas-grant-note.test.ts` reaches all of them.
 *
 * ## The tone is what the button does
 *
 * `wait` means the withdrawal is not sendable yet and the reason is temporary —
 * ETH is in flight. `ready` means send it. `blocked` means this buyer needs
 * native gas from somewhere else before this transaction will go through.
 * Nothing here disables anything: the transaction is valid in all three, the
 * buyer's wallet is the judge of whether it can pay for it, and a screen that
 * refused to offer a signature because it believed the wallet was empty would
 * be wrong for every buyer who topped up in another tab.
 */
export type WithdrawGasGrantNote = {
  readonly tone: "wait" | "ready" | "blocked";
  readonly text: string;
  /** Shown as the transfer's own identifier. `null` unless one was sent. */
  readonly transactionHash: string | null;
};

/** What one refusal says, and in which tone. */
type RefusalCopy = { readonly tone: WithdrawGasGrantNote["tone"]; readonly text: string };

/**
 * One sentence per refusal, and every one of the eight is written out.
 *
 * A `Record` with no index signature rather than a lookup with a `??` fallback:
 * **adding a member to `GasGrantRefusal` is a TypeScript error here** until
 * somebody writes its sentence, which is the only place a person would think to
 * write one. A default arm would ship the new case as generic copy nobody
 * noticed was generic.
 *
 * **That guard only runs in one direction.** `GasGrantRefusal` is a hand mirror
 * of the backend's enum (see `interfaces/escrow.ts`), so a reason the BACKEND
 * adds is not a compile error here — it is a member the union never grew, and
 * this table stays exhaustive over a vocabulary that is short. That is how
 * `GRANT_IN_FLIGHT` shipped with a buyer being told the faucet was unreachable.
 * `scripts/check-gas-grant-refusals.js` is the check that sees that; the `if
 * (!copy)` arm below is what makes it audible when nobody ran it.
 *
 * `tone` spans all three of `WithdrawGasGrantNote`'s values, not two. Seven of
 * the eight are settled — the buyer either can send (`ready`) or has to find
 * native gas elsewhere (`blocked`). `GRANT_IN_FLIGHT` is neither: the grant may
 * still land, so it is `wait`, the same tone a sent-and-unconfirmed transfer
 * gets, and for the same reason — the honest instruction is "come back in a
 * moment", not "fund this yourself".
 */
const REFUSAL_TEXT: Record<GasGrantRefusal, RefusalCopy> = {
  BUYER_HAS_GAS: {
    tone: "ready",
    text:
      "Your wallet already holds enough of this network's native token to send this transaction, " +
      "so nothing was added to it. Sign whenever you like.",
  },
  ALREADY_GRANTED: {
    tone: "blocked",
    text:
      "This address has already been covered for a network fee once, and that is a one-time thing " +
      "rather than a limit that resets. You will need enough of this network's native token in " +
      "this wallet to send the transaction yourself.",
  },
  NO_MATURED_WITHDRAWAL: {
    tone: "blocked",
    text:
      "The network fee was not covered because no matured withdrawal was found for this address " +
      "at that moment. The transaction above is still valid — reload the page and try again, and " +
      "contact support if this repeats.",
  },
  ABOVE_PER_GRANT_CAP: {
    tone: "blocked",
    text:
      "Network fees are unusually high right now, above what this platform covers, so nothing was " +
      "added to your wallet. Nothing is lost by waiting: the request does not expire, and you can " +
      "come back and claim when fees fall.",
  },
  DAILY_CAP_REACHED: {
    tone: "blocked",
    text:
      "This platform has already covered its limit of network fees for today, so nothing was " +
      "added to your wallet. Your request does not expire — try again tomorrow, or send the " +
      "transaction yourself if this wallet holds the native token.",
  },
  RELAYER_FLOAT_LOW: {
    tone: "blocked",
    text:
      "Network fees cannot be covered right now. Your escrow and your request are untouched and " +
      "this is ours to fix; the transaction above stays valid, and you can send it yourself if " +
      "this wallet holds the native token.",
  },
  TRANSFER_FAILED: {
    tone: "blocked",
    text:
      "The attempt to cover your network fee did not go through, and nothing was charged to you. " +
      "Your request is untouched — try again in a moment, and contact support if it repeats.",
  },
  /*
    The only refusal that is not settled, and the only one whose answer is
    "come back". It must not read like ALREADY_GRANTED: nothing has been
    granted and the one-time cover is still available, so a sentence implying
    the single chance is spent would send a buyer off to find gas they did not
    need to find.
  */
  GRANT_IN_FLIGHT: {
    tone: "wait",
    text:
      "Another attempt to cover your network fee for this wallet is already under way, so this " +
      "one did not start a second. Nothing has been used up — reload this page in a moment to " +
      "see how the first one ended.",
  },
};

/**
 * The note for this intent, or `null` when there is nothing to say.
 *
 * `null` on a chain with no gas grant (Solana) and on every intent kind but the
 * claim — both arrive here as a `null` `gasGrant`, and the correct rendering of
 * both is silence. An "n/a" line on a Solana withdrawal would be a sentence
 * about a mechanism that does not exist on the chain the buyer is looking at.
 */
export function withdrawGasGrantNote(
  grant: WithdrawGasGrant | null | undefined,
): WithdrawGasGrantNote | null {
  if (!grant) return null;

  switch (grant.status) {
    case "GRANTED":
      return {
        tone: "wait",
        text:
          "This platform has sent your wallet the network fee for this one transaction. Wait for " +
          "it to arrive — usually a few seconds — then sign. If your wallet says it cannot afford " +
          "the fee, it has not landed yet.",
        transactionHash: grant.transactionHash,
      };

    case "REFUSED": {
      /*
        `reason` is typed non-null on this branch by the backend's contract and
        not by TypeScript, which cannot express "non-null exactly when status is
        REFUSED" across an HTTP boundary. A malformed response is treated as an
        outage rather than as a refusal with no sentence: falling through to
        UNAVAILABLE prints something true, where indexing `REFUSAL_TEXT` with
        `null` would print `undefined` into a money screen.
      */
      if (!grant.reason) return UNAVAILABLE;

      /*
        The cast is the honest half of the hand mirror.

        `grant.reason` is typed `GasGrantRefusal`, so TypeScript believes this
        lookup always hits — and that belief is exactly what was wrong when
        `GRANT_IN_FLIGHT` arrived on the wire and the union had never heard of
        it. The value came off HTTP; it is a `string` with a hopeful type on it.
        Widening it here is what makes the miss expressible at all.
      */
      const copy = (REFUSAL_TEXT as Partial<Record<string, RefusalCopy>>)[grant.reason];
      if (!copy) {
        /*
          Loud, not silent.

          The old behaviour was a quiet fall-through to UNAVAILABLE, which reads
          to a buyer as "we could not consult the faucet" — a different problem
          with a different answer — and reads to a developer as nothing at all.
          The sentence shown stays UNAVAILABLE, because it is the only one still
          true when this build does not know what the backend said; what changes
          is that the build says so where somebody can see it.
        */
        reportUnknownRefusal(grant.reason);
        return UNAVAILABLE;
      }
      return { tone: copy.tone, text: copy.text, transactionHash: null };
    }

    case "UNAVAILABLE":
      return UNAVAILABLE;
  }
}

/**
 * An outage, said as an outage.
 *
 * Deliberately not one of the eight refusals: those mean a control fired and
 * the system worked. This means nobody knows, and the honest thing to tell
 * somebody trying to get their money out is that the transaction is fine and
 * the fee help is the part that is unknown.
 */
const UNAVAILABLE: WithdrawGasGrantNote = {
  tone: "blocked",
  text:
    "This platform could not check whether it can cover your network fee, so assume it has not. " +
    "The transaction above is valid and unaffected — send it whenever this wallet holds enough of " +
    "the network's native token.",
  transactionHash: null,
};


/**
 * Say, once per distinct reason, that the backend used a word this build does
 * not have a sentence for.
 *
 * `console.error` and not a thrown error: a withdrawal screen must keep
 * rendering — the unsigned transaction beside this note is valid and the buyer
 * is in the middle of getting their money out. Deduplicated because this runs
 * on every render of the page, and a message repeated forty times is read as
 * noise rather than as a missing case.
 */
const REPORTED = new Set<string>();

function reportUnknownRefusal(reason: string): void {
  if (REPORTED.has(reason)) return;
  REPORTED.add(reason);
  console.error(
    `[withdrawGasGrantNote] the API refused a gas grant with \`${reason}\`, which this build ` +
      "has no sentence for — the buyer was shown the outage copy instead. Add it to " +
      "`GasGrantRefusal` in `interfaces/escrow.ts` and to `REFUSAL_TEXT`, then re-run " +
      "`node scripts/check-gas-grant-refusals.js`.",
  );
}

/** Test seam: forget what has already been reported. Not used by the app. */
export function resetUnknownRefusalReports(): void {
  REPORTED.clear();
}
