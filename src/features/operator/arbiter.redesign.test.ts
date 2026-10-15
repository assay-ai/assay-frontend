import { describe, expect, it } from "vitest";

import { rulingOutcome } from "./arbiter";
import { whyLine } from "./why-not";

const usd = (amount: string) => ({ amount, asset: "eip155:46630", decimals: 6 });

describe("ruling sheet: what happens", () => {
  it("states the uphold split with what leaves the stake and what stays", () => {
    const lines = rulingOutcome({ kind: "UPHOLD", total: usd("5000000"), agentBps: 6000, count: 1, signer: "Signed by the arbiter key" });
    expect(lines.map((l) => l.text)).toEqual([
      "$4.50 leaves the provider's stake: $3.00 to the agents who paid · $1.50 to the platform. $0.50 stays with the provider",
      "Final: it can't be disputed again",
      "Signed by the arbiter key",
    ]);
  });

  it("says nothing is taken on cancel, and never says 'batch'", () => {
    const one = rulingOutcome({ kind: "CANCEL", total: usd("5000000"), agentBps: 6000, count: 1, signer: "s" });
    expect(one[0]!.text).toBe("$5.00 stays with the provider: nothing is taken");
    expect(one[1]!.text).toBe("Final: the penalty is closed");
    const two = rulingOutcome({ kind: "CANCEL", total: usd("5000000"), agentBps: 6000, count: 2, signer: "s" });
    expect(two[1]!.text).toBe("Final: the penalties are closed");
    expect(JSON.stringify([one, two])).not.toMatch(/batch/i);
  });

  it("still says the stake is taken when the chain's split is unknown", () => {
    expect(rulingOutcome({ kind: "UPHOLD", total: usd("5000000"), agentBps: null, count: 1, signer: "s" })[0]!.text).toBe(
      "The penalty ($5.00) is taken from the provider's stake",
    );
  });
});

describe("one-line why-not", () => {
  it("drops the full stop so the Ask link can follow", () => {
    expect(whyLine("Block an account needs Lead adjudicator or On-call (SRE).")).toBe("Block an account needs Lead adjudicator or On-call (SRE)");
  });
});
