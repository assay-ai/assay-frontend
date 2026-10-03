import { describe, expect, it } from "vitest";

import { withdrawGasNote } from "./withdraw-gas-note";

describe("withdrawGasNote", () => {
  it("says nothing on Solana, where the fee payer is not the buyer's problem", () => {
    expect(withdrawGasNote("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")).toEqual({ kind: "none" });
  });

  it("names the network fee on eip155, and does NOT promise the platform pays it", () => {
    const note = withdrawGasNote("eip155:46630");
    expect(note.kind).toBe("evm");
    const text = (note as { text: string }).text;
    // The mechanism, stated. `withdraw()` is msg.sender-only by design:
    // requestWithdraw already served the delay, so a phished signature past
    // that point would drain the escrow with no brake left. The buyer's own
    // transaction is the brake.
    expect(text).toMatch(/network fee/i);
    // And the limit of the claim. The grant is once per address EVER and has
    // five other refusals this screen cannot see. "We cover it" would be a
    // promise the platform refuses five ways.
    expect(text).not.toMatch(/we (will )?(cover|pay)/i);
    expect(text).not.toMatch(/free/i);
    // Nor may it promise the grant by any other wording. There is no API that
    // reports grant state, so any sentence in the future tense about the
    // platform funding this wallet is a claim nothing on this screen can check.
    expect(text).not.toMatch(/we('ll| will) (fund|top up|send)/i);
    expect(text).not.toMatch(/gas grant/i);
  });

  it("says nothing on a chain id it does not recognise, rather than warning about gas", () => {
    /*
      `addressStyleOf` falls back to base58 for an unparseable id and this
      follows it: an EVM gas warning drawn over a Solana withdrawal is a
      sentence telling a buyer to go and buy a token they do not need, at the
      moment they are trying to get money out.
    */
    expect(withdrawGasNote("")).toEqual({ kind: "none" });
    expect(withdrawGasNote("not-a-caip2-id")).toEqual({ kind: "none" });
  });
});
