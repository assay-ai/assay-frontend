/**
 * The slash split is the chain's (`params().slashAgentBps` /
 * `slashPlatformBps`, served on `GET /chains`), and an executed record shows
 * the split the chain recorded (`SlashExecuted`). Nothing here is typed in.
 */

import { describe, expect, it } from "vitest";

import { TEST_PARAMS } from "@/test/chain-fixture";

import { recordedSplit, splitOfParams, splitPenalty } from "./distribution";

const usd = (amount: string) => ({ amount, asset: "USDG", decimals: 6 });

describe("the slash split the UI shows", () => {
  it("comes from the chain's params, and is unknown until they are", () => {
    expect(splitOfParams(TEST_PARAMS)).toEqual({ agentBps: 6000, platformBps: 3000 });
    expect(splitOfParams({ ...TEST_PARAMS, slashPlatformBps: null })).toBeNull();
    expect(splitOfParams(null)).toBeNull();
    expect(splitPenalty(usd("1000000"), null)).toBeNull();
  });

  it("splits exactly as the contract does (floors, the provider keeps the residual)", () => {
    const split = splitPenalty(usd("1000001"), { agentBps: 6000, platformBps: 3000 })!;
    expect(split.agent.amount).toBe("600000");
    expect(split.platform.amount).toBe("300000");
    expect(split.neverTaken.amount).toBe("100001");
    expect(split.taken.amount).toBe("900000");
  });

  it("follows a changed on-chain split", () => {
    const split = splitPenalty(usd("1000000"), { agentBps: 5000, platformBps: 4000 })!;
    expect([split.agent.amount, split.platform.amount, split.neverTaken.amount]).toEqual(["500000", "400000", "100000"]);
  });

  it("shows an executed record as the chain recorded it, not recomputed", () => {
    const split = recordedSplit({ agentAmount: "700000", platformAmount: "200000", providerAmount: "100000" }, usd("1000000"));
    expect(split.agent.amount).toBe("700000");
    expect(split.platform.amount).toBe("200000");
    expect(split.neverTaken.amount).toBe("100000");
    expect(split.taken.amount).toBe("900000");
  });
});
