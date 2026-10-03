import { describe, expect, it } from "vitest";

import { settlementReach } from "./settlement-reach";

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM = "eip155:46630";
const BASE = "eip155:84532";

describe("settlementReach", () => {
  it("is reachable when the buyer funds a chain the tool settles on", () => {
    expect(settlementReach([SOLANA, EVM], [SOLANA])).toEqual({ kind: "reachable" });
  });

  it("is unreachable, and names the tool's chains, when there is no overlap", () => {
    // Named, not just flagged: "you cannot pay for this" is useless without
    // "fund this chain". The backend's refusal makes exactly the same
    // distinction — PAYMENT_NO_SETTLEABLE_CHAIN means "add money SOMEWHERE
    // ELSE", which is a different errand from "add money".
    expect(settlementReach([EVM], [SOLANA])).toEqual({ kind: "unreachable", toolChains: [EVM] });
  });

  it("names EVERY chain the tool settles on, not just the first", () => {
    /*
      The loser, asserted. `toolChains: [toolChains[0]]` would pass the test
      above and send a buyer to fund one chain when either would have done —
      the same positional read this milestone removed from four screens.
    */
    expect(settlementReach([EVM, BASE], [SOLANA])).toEqual({
      kind: "unreachable",
      toolChains: [EVM, BASE],
    });
  });

  it("is unknown — never unreachable — when the tool declares no chains", () => {
    // Nothing populates `settlementChains` today. Treating absence as
    // "unreachable" would mark EVERY tool in the catalogue with a warning
    // that is false, which is how a caveat stops being read.
    expect(settlementReach(undefined, [SOLANA])).toEqual({ kind: "unknown" });
    expect(settlementReach([], [SOLANA])).toEqual({ kind: "unknown" });
  });

  it("is unknown when the BUYER's chains are not known, rather than accusing them", () => {
    // A buyer with no balances yet, or a failed /balances read, is not a buyer
    // who cannot pay. Marking every tool unreachable on a transient error is a
    // shop that looks empty because one request failed.
    expect(settlementReach([EVM], [])).toEqual({ kind: "unknown" });
  });

  it("is reachable on ANY overlap, not only on the buyer's first chain", () => {
    /*
      `buyerChains[0] === toolChains[0]` passes the first case in this file and
      hides a tool the buyer can pay for behind a warning telling them to fund a
      chain they already funded.
    */
    expect(settlementReach([EVM], [SOLANA, EVM])).toEqual({ kind: "reachable" });
  });
});
