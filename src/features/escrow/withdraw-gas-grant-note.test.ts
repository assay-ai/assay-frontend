import { describe, expect, it } from "vitest";

import type { GasGrantRefusal, WithdrawGasGrant } from "@/interfaces";

import { withdrawGasGrantNote } from "./withdraw-gas-grant-note";

const HASH = `0x${"ab".repeat(32)}`;

const ALL_REFUSALS: GasGrantRefusal[] = [
  "ALREADY_GRANTED",
  "NO_MATURED_WITHDRAWAL",
  "BUYER_HAS_GAS",
  "ABOVE_PER_GRANT_CAP",
  "DAILY_CAP_REACHED",
  "RELAYER_FLOAT_LOW",
  "TRANSFER_FAILED",
  "GRANT_IN_FLIGHT",
];

const refused = (reason: GasGrantRefusal): WithdrawGasGrant => ({
  status: "REFUSED",
  reason,
  transactionHash: null,
});

describe("withdrawGasGrantNote", () => {
  it("says nothing when there is no grant to report", () => {
    // Solana, and every intent kind but the claim, both arrive as `null`. The
    // correct rendering of both is silence — an "n/a" line on a Solana
    // withdrawal describes a mechanism that chain does not have.
    expect(withdrawGasGrantNote(null)).toBeNull();
    expect(withdrawGasGrantNote(undefined)).toBeNull();
  });

  it("tells the buyer to WAIT when the fee was sent, and shows the transfer", () => {
    const note = withdrawGasGrantNote({
      status: "GRANTED",
      reason: null,
      transactionHash: HASH,
    });

    expect(note).not.toBeNull();
    expect(note?.tone).toBe("wait");
    expect(note?.transactionHash).toBe(HASH);
    /*
      The one thing this sentence MUST do that no other does: tell a buyer whose
      wallet says "insufficient funds for gas" that they are early rather than
      stuck. The ETH is in flight; signing before it lands fails, and a buyer who
      reads that failure as final walks away from money that is about to be
      claimable.
    */
    expect(note?.text).toMatch(/wait/i);
  });

  it("has a distinct sentence for every one of the eight refusals", () => {
    /*
      The failure mode this pins is a default arm. A lookup with `?? generic`
      ships a new backend reason as copy nobody wrote, and it looks exactly like
      copy somebody did — so the eight are enumerated here and compared for
      distinctness rather than merely for existence.
    */
    const texts = ALL_REFUSALS.map((reason) => withdrawGasGrantNote(refused(reason))?.text);

    expect(texts.filter(Boolean)).toHaveLength(ALL_REFUSALS.length);
    expect(new Set(texts).size).toBe(ALL_REFUSALS.length);
  });

  it("does not apologise to a buyer who simply already has gas", () => {
    // `BUYER_HAS_GAS` is a control confirming the buyer never needed help.
    // Printing the platform's apology copy here would invent a problem.
    const note = withdrawGasGrantNote(refused("BUYER_HAS_GAS"));

    expect(note?.tone).toBe("ready");
    expect(note?.text).not.toMatch(/could not|cannot|did not go through|ours to fix/i);
  });

  it("never tells a buyer their withdrawal has failed", () => {
    /*
      The whole contract of this field: a refusal arrives ALONGSIDE valid
      unsigned bytes. Every sentence is read at the moment somebody is trying to
      get their money out, which is the worst possible moment to imply the
      money, the escrow or the request is gone.
    */
    const notes = [
      withdrawGasGrantNote({ status: "GRANTED", reason: null, transactionHash: HASH }),
      withdrawGasGrantNote({ status: "UNAVAILABLE", reason: null, transactionHash: null }),
      ...ALL_REFUSALS.map((reason) => withdrawGasGrantNote(refused(reason))),
    ];

    for (const note of notes) {
      expect(note).not.toBeNull();
      expect(note?.text).not.toMatch(/withdrawal (has )?failed|cannot withdraw|not be withdrawn/i);
      expect(note?.text).not.toMatch(/your (money|funds|balance) (is|are) (gone|lost)/i);
    }
  });

  it("shows a transfer hash only when one was actually sent", () => {
    /*
      A hash beside a refusal would link a buyer to a transfer that does not
      exist, and tell them money moved when the whole meaning of the refusal is
      that none did.

      **The fixtures carry a hash on purpose.** The first version of this test
      passed `transactionHash: null` on every refusal — which is what the
      backend actually sends — and a module that blindly echoed
      `grant.transactionHash` passed all eight cases. The assertion was
      satisfiable by the wrong implementation, because nothing in the fixture
      could tell "drops it" from "there was none". So the input here is a
      HOSTILE one the wire is not supposed to produce, and the module has to
      drop the field rather than trust it.
    */
    for (const reason of ALL_REFUSALS) {
      expect(
        withdrawGasGrantNote({ status: "REFUSED", reason, transactionHash: HASH })
          ?.transactionHash,
      ).toBeNull();
    }
    expect(
      withdrawGasGrantNote({ status: "UNAVAILABLE", reason: null, transactionHash: HASH })
        ?.transactionHash,
    ).toBeNull();
  });

  it("says an outage is an outage, not a control firing", () => {
    const outage = withdrawGasGrantNote({
      status: "UNAVAILABLE",
      reason: null,
      transactionHash: null,
    });

    expect(outage?.tone).toBe("blocked");
    expect(outage?.text).toMatch(/could not check/i);
    // And it is not any of the eight refusals' copy: an outage means nobody
    // knows, and a refusal means the system worked.
    const refusalTexts = new Set(ALL_REFUSALS.map((r) => withdrawGasGrantNote(refused(r))?.text));
    expect(refusalTexts.has(outage?.text)).toBe(false);
  });

  it("treats a REFUSED with no reason as an outage rather than printing undefined", () => {
    /*
      "non-null exactly when status is REFUSED" is the backend's contract, which
      TypeScript cannot enforce across HTTP. Indexing the copy table with `null`
      would render the string "undefined" onto a money screen, so a malformed
      response degrades to the sentence that is still true.
    */
    const note = withdrawGasGrantNote({
      status: "REFUSED",
      reason: null,
      transactionHash: null,
    });

    expect(note?.text).toMatch(/could not check/i);
    expect(note?.text).not.toMatch(/undefined/);
  });
});
