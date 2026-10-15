import { describe, expect, it } from "vitest";

import type { ProviderChainStake } from "@/interfaces";

import { availableAfterRequest, periodLabel, withdrawStateOf } from "./withdraw-state";

const m = (amount: string) => ({ amount, asset: "usdg", decimals: 6 });
const entry = (patch: Partial<ProviderChainStake>): ProviderChainStake => ({
  chainId: "eip155:46630",
  hasKnownStake: true,
  staked: m("180000000"),
  observedAt: null,
  unbonding: null,
  unbondingStartedAt: null,
  unbondingCompletesAt: null,
  chainReadable: true,
  stakeAuthority: "eip155:46630:0xabc",
  ...patch,
});

const NOW = Date.parse("2026-10-16T12:00:00Z");

describe("withdrawStateOf", () => {
  it("is none when nothing unbonds", () => {
    expect(withdrawStateOf(entry({}), NOW).phase).toBe("none");
    expect(withdrawStateOf(entry({ unbonding: m("0") }), NOW).phase).toBe("none");
    expect(withdrawStateOf(null, NOW).phase).toBe("none");
  });

  it("is unbonding until the clock ends, then ready", () => {
    const running = entry({
      unbonding: m("50000000"),
      unbondingStartedAt: "2026-10-14T12:00:00Z",
      unbondingCompletesAt: "2026-10-21T12:00:00Z",
    });
    const state = withdrawStateOf(running, NOW);
    expect(state.phase).toBe("unbonding");
    expect(periodLabel(state.periodMs)).toBe("7 days");
    expect(availableAfterRequest(state, NOW)).toBe("2026-10-23T12:00:00.000Z");
    expect(withdrawStateOf(running, Date.parse("2026-10-21T12:00:01Z")).phase).toBe("ready");
  });

  it("does not invent a period", () => {
    const state = withdrawStateOf(entry({}), NOW);
    expect(state.periodMs).toBeNull();
    expect(availableAfterRequest(state, NOW)).toBeNull();
  });
});
