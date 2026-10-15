import { describe, expect, it } from "vitest";

import type { ProviderStake } from "@/interfaces";

import { stakeStatusOf } from "./use-stake-status";

const m = (major: number) => ({ amount: String(major * 1_000_000), asset: "usdg", decimals: 6 });

function stake(patch: Partial<ProviderStake>, staked: number | null, authority: string | null = "eip155:1:0xabc"): ProviderStake {
  return {
    stake: [
      {
        chainId: "eip155:1",
        hasKnownStake: staked !== null,
        staked: staked === null ? null : m(staked),
        observedAt: null,
        unbonding: null,
        unbondingStartedAt: null,
        unbondingCompletesAt: null,
        chainReadable: true,
        stakeAuthority: authority,
      },
    ],
    requirement: [],
    requirementRule: "max",
    requirementTotal: null,
    negotiatedMinimum: null,
    graceSummary: null,
    headroom: null,
    shortfall: null,
    recommendedBuffer: null,
    ...patch,
  };
}

describe("stakeStatusOf", () => {
  it("is enough with no requirement", () => {
    const s = stakeStatusOf(stake({}, 0));
    expect(s.enough).toBe(true);
    expect(s.required).toBeNull();
    expect(s.recommended).toBeNull();
  });

  it("computes the shortfall and a 1.5× recommendation", () => {
    const s = stakeStatusOf(stake({ requirementTotal: m(100) }, 40, null));
    expect(s.enough).toBe(false);
    expect(s.shortfall?.amount).toBe(String(60 * 1_000_000));
    expect(s.recommended?.amount).toBe(String(150 * 1_000_000));
    expect(s.authorityProved).toBe(false);
  });

  it("prefers the backend's buffer when larger", () => {
    const s = stakeStatusOf(stake({ requirementTotal: m(100), recommendedBuffer: m(200) }, 120));
    expect(s.enough).toBe(true);
    expect(s.shortfall).toBeNull();
    expect(s.recommended?.amount).toBe(String(200 * 1_000_000));
  });

  it("cannot tell before anything is read", () => {
    expect(stakeStatusOf(undefined).enough).toBeNull();
  });
});
