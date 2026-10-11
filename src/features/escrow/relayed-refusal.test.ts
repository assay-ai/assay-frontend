import { describe, expect, it } from "vitest";

import { chainRefusalIn, isRelayedRefusal, relayedRefusal, relayRetryAt } from "./relayed-refusal";

import { ApiError } from "@/libs/ApiClient";

/**
 * The five refusals, spelled exactly as the backend composes them.
 *
 * Copied from `settlement.errors.ts`'s own message builders — `relayedIntentRefused`
 * concatenates `": <reason>"` and then either `" — nothing was submitted"` or
 * `" — transaction 0x… was sent and reverted"`. A fixture that paraphrased the
 * message would prove this file parses a sentence nobody sends.
 */
function refused(reason: string, sent = false): ApiError {
  return new ApiError(
    "SETTLEMENT_RELAYED_INTENT_REFUSED",
    `The relayed escrow request was refused: ${reason}` +
      (sent ? " — transaction 0xabc was sent and reverted" : " — nothing was submitted"),
    409,
  );
}

const FOR_ANOTHER_BUYER = new ApiError(
  "SETTLEMENT_RELAYED_INTENT_FOR_ANOTHER_BUYER",
  "This signed request names 0x1111111111111111111111111111111111111111, which is not this " +
    "session's account (eip155:46630:0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1) — the platform " +
    "does not relay one buyer's request on another buyer's session",
  403,
);

const RATE_LIMITED = new ApiError(
  "SETTLEMENT_RELAYED_INTENT_RATE_LIMITED",
  "You have reached the limit of 20 escrow changes the platform relays for this account per " +
    "hour. Nothing was submitted. You can make the next one from 2026-10-12T13:17:14.000Z.",
  429,
);

const UNAVAILABLE = new ApiError(
  "SETTLEMENT_RELAYED_INTENT_UNAVAILABLE",
  "The relayed-submission budget could not be counted, so nothing was submitted. The signature " +
    "is still valid until its deadline; try again",
  503,
);

const MALFORMED = new ApiError(
  "SETTLEMENT_RELAYED_INTENT_MALFORMED",
  "The relayed escrow request cannot be submitted: signature must be 65 bytes of hex (r || s || v)",
  400,
);

describe("chainRefusalIn", () => {
  it("finds the Errors.sol name in the sentence the backend actually composes", () => {
    expect(chainRefusalIn(refused("BadNonce").message)).toBe("BadNonce");
    expect(chainRefusalIn(refused("SignatureExpired").message)).toBe("SignatureExpired");
    expect(chainRefusalIn(refused("MalleableSignature").message)).toBe("MalleableSignature");
    expect(chainRefusalIn(refused("EscrowLimitsUnchanged").message)).toBe("EscrowLimitsUnchanged");
    expect(chainRefusalIn(refused("ProgramPaused").message)).toBe("ProgramPaused");
  });

  it("finds it whether or not a transaction was sent", () => {
    expect(chainRefusalIn(refused("BadNonce", true).message)).toBe("BadNonce");
  });

  it("answers null for a selector nobody in this app knows", () => {
    expect(chainRefusalIn(refused("UNKNOWN_REVERT:0xdeadbeef").message)).toBeNull();
  });
});

describe("relayedRefusal", () => {
  /** Every refusal a buyer can actually receive from the two submit routes. */
  const ALL = [
    FOR_ANOTHER_BUYER,
    MALFORMED,
    RATE_LIMITED,
    UNAVAILABLE,
    new ApiError("SETTLEMENT_WITHDRAWALS_FROZEN", "Withdrawals are frozen", 409),
    refused("BadNonce"),
    refused("SignatureExpired"),
    refused("MalleableSignature"),
    refused("SignerIsNotBuyer"),
    refused("EscrowLimitsUnchanged"),
    refused("ProgramPaused"),
    refused("UNKNOWN_REVERT:0xdeadbeef"),
  ];

  it("gives every named refusal its own sentence — no two are the same words", () => {
    /*
      This is the assertion that kills "render every failure with the same
      message". A handler returning one string for all twelve passes any test
      that only checks one of them.
    */
    const sentences = ALL.map((error) => relayedRefusal(error).text);
    expect(new Set(sentences).size).toBe(ALL.length);
  });

  it("never tells a buyer they need gas — the relayer pays for both doors", () => {
    /*
      The zero-ETH buyer is the whole reason these routes exist. A refusal that
      mentioned a fee they must cover would send them to buy a token they need
      none of, at the moment they are trying to set a limit or leave.
    */
    for (const error of ALL) {
      const { text } = relayedRefusal(error);
      expect(text, error.code).not.toMatch(/\bETH\b|\bgas fee\b|top up|native token/i);
    }
  });

  it("says plainly that nothing was submitted, wherever that is true", () => {
    for (const error of [FOR_ANOTHER_BUYER, MALFORMED, RATE_LIMITED, UNAVAILABLE, refused("BadNonce")]) {
      /*
        The claim, not one phrasing of it. `UNAVAILABLE` says "it submitted
        nothing" and the others say "nothing was submitted"; both tell the buyer
        the same load-bearing fact, which is that their escrow did not move.
      */
      expect(relayedRefusal(error).text, error.code).toMatch(
        /[Nn]othing was submitted|submitted nothing/,
      );
    }
  });

  it("asks for a fresh request exactly where the old signature is dead", () => {
    /*
      Three refusals retire the signature — a spent counter, a passed deadline,
      a shape the contract will not read — and re-posting the same bytes can
      never work for any of them. Two others are the platform's own limits and
      the SAME request will go through later; telling a buyer to re-sign there
      is telling them to burn a counter for nothing.
    */
    expect(relayedRefusal(refused("BadNonce")).retry).toBe("rebuild");
    expect(relayedRefusal(refused("SignatureExpired")).retry).toBe("rebuild");
    expect(relayedRefusal(refused("MalleableSignature")).retry).toBe("rebuild");
    expect(relayedRefusal(MALFORMED).retry).toBe("rebuild");

    expect(relayedRefusal(RATE_LIMITED).retry).toBe("wait");
    expect(relayedRefusal(UNAVAILABLE).retry).toBe("wait");
    expect(relayedRefusal(refused("ProgramPaused")).retry).toBe("wait");

    expect(relayedRefusal(FOR_ANOTHER_BUYER).retry).toBe("wallet");
    expect(relayedRefusal(refused("SignerIsNotBuyer")).retry).toBe("wallet");

    expect(relayedRefusal(refused("EscrowLimitsUnchanged")).retry).toBe("none");
    expect(relayedRefusal(new ApiError("SETTLEMENT_WITHDRAWALS_FROZEN", "frozen", 409)).retry).toBe(
      "none",
    );
  });

  it("keeps the chain's own name on the refusal it came from", () => {
    expect(relayedRefusal(refused("BadNonce")).reason).toBe("BadNonce");
    expect(relayedRefusal(refused("SignatureExpired")).reason).toBe("SignatureExpired");
    /* Not a chain refusal at all — there is no Errors.sol name to report. */
    expect(relayedRefusal(RATE_LIMITED).reason).toBeNull();
  });

  it("prints the server's own words for a code it has never seen", () => {
    const unknown = new ApiError("SETTLEMENT_SOMETHING_NEW", "A thing happened.", 409);
    const { text } = relayedRefusal(unknown);
    expect(text).toContain("A thing happened.");
    expect(text).toContain("SETTLEMENT_SOMETHING_NEW");
  });

  it("passes an unknown revert selector through verbatim — it is the only identifier", () => {
    const { text } = relayedRefusal(refused("UNKNOWN_REVERT:0xdeadbeef"));
    expect(text).toContain("UNKNOWN_REVERT:0xdeadbeef");
  });
});

describe("isRelayedRefusal", () => {
  it("claims the relayed codes and nothing else", () => {
    expect(isRelayedRefusal(FOR_ANOTHER_BUYER)).toBe(true);
    expect(isRelayedRefusal(refused("BadNonce"))).toBe(true);
    expect(isRelayedRefusal(new ApiError("SETTLEMENT_WITHDRAWALS_FROZEN", "frozen", 409))).toBe(
      false,
    );
    expect(isRelayedRefusal(new Error("boom"))).toBe(false);
    expect(isRelayedRefusal(null)).toBe(false);
  });
});

/**
 * REGRESSION (BUG-D1-06): the person was told only "wait a few minutes"; the
 * server now says when the budget frees, and the sentence says it in their
 * own time.
 */
describe("relayedRefusal — rate limited, with the time it frees up", () => {
  it("reads the instant out of the server's sentence", () => {
    expect(relayRetryAt(RATE_LIMITED.message)?.toISOString()).toBe("2026-10-12T13:17:14.000Z");
    expect(relayRetryAt("Too many requests")).toBeNull();
  });

  it("says how long to wait, and never shows a raw account string", () => {
    const now = Date.parse("2026-10-12T13:05:00.000Z");
    const refusal = relayedRefusal(RATE_LIMITED, now);
    expect(refusal.retry).toBe("wait");
    expect(refusal.text).toContain("(in 13 minutes)");
    expect(refusal.text).not.toContain("eip155:");
    expect(refusal.text).not.toContain("seconds");
  });
});
