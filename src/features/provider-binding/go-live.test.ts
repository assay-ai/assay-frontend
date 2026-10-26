import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import type { Money, ProviderStake } from "@/interfaces";

import { TEST_PARAMS } from "@/test/chain-fixture";

import {
  choiceOfMode,
  failureRateFromPercent,
  freeBudgetFromInput,
  freeBudgetHint,
  freeBudgetWarning,
  freeCallsFromInput,
  freeTermsChangeRows,
  modeOfChoice,
  onlyChanged,
  percentText,
  providerShare,
  stakeNeededFor,
  stakeRuleOf,
  takeRateOf,
  timeoutFromSeconds,
  stakeSummary,
  totalStakeWith, stakeEffectOf } from "./go-live";

const usd = (major: string): Money => ({ amount: String(Math.round(Number(major) * 1e6)), asset: "USDG", decimals: 6 });

const stake = {
  stake: [],
  requirement: [
    {
      bindingId: "a",
      toolId: "t",
      pricingMode: "PAID",
      price: usd("0.45"),
      minimum: usd("450"),
      derivation: "max(floor 60.000000, 900 × 0.450000) = 405.000000",
      grace: null,
    },
  ],
  requirementRule: "max",
  requirementTotal: usd("450"),
  negotiatedMinimum: null,
  graceSummary: null,
  headroom: null,
  shortfall: null,
  recommendedBuffer: null,
} as ProviderStake;

describe("go-live arithmetic", () => {
  it("reads the stake rule from a derivation line, else from the chain, else leaves the floor unknown", () => {
    const rule = stakeRuleOf(stake);
    expect(rule.fromServer).toBe(true);
    expect(rule.floor?.toNumber()).toBe(60);
    expect(rule.multiplier.toNumber()).toBe(900);
    expect(stakeRuleOf(null, TEST_PARAMS).floor?.toNumber()).toBe(50);
    expect(stakeRuleOf(null, { ...TEST_PARAMS, minimumStake: "100000000" }).floor?.toNumber()).toBe(100);
    expect(stakeRuleOf(null).fromServer).toBe(false);
    expect(stakeRuleOf(null).floor).toBeNull();
    expect(stakeNeededFor(usd("0.10"), "PAID", stakeRuleOf(null))).toBeNull();
  });

  it("needs max(floor, multiplier × price) for paid listings only", () => {
    const rule = stakeRuleOf(null, TEST_PARAMS);
    expect(stakeNeededFor(usd("0.10"), "PAID", rule)?.amount).toBe(usd("100").amount);
    expect(stakeNeededFor(usd("0.01"), "FREEMIUM", rule)?.amount).toBe(usd("50").amount);
    expect(stakeNeededFor(usd("0.10"), "FREE", rule)).toBeNull();
  });

  it("takes the larger of the other listings and this one", () => {
    expect(totalStakeWith(usd("100"), stake)?.amount).toBe(usd("450").amount);
    expect(totalStakeWith(usd("500"), stake)?.amount).toBe(usd("500").amount);
    expect(totalStakeWith(null, stake, "a")).toBeNull();
  });

  it("pays the provider the price less the take rate", () => {
    expect(providerShare(usd("0.10"), takeRateOf(null, TEST_PARAMS))?.amount).toBe(usd("0.09").amount);
    expect(providerShare(usd("0.10"), takeRateOf(null))).toBeNull();
    const terms = { commercialTerms: [{ key: "takeRate", label: "", value: "5%", caption: "" }] };
    const take = takeRateOf(terms as never);
    expect(take.fromServer).toBe(true);
    expect(providerShare(usd("1"), take)?.amount).toBe(usd("0.95").amount);
  });

  it("parses percentages, free calls and seconds", () => {
    expect(failureRateFromPercent("2").value).toBe(0.02);
    expect(failureRateFromPercent("2.5%").value).toBe(0.025);
    expect(failureRateFromPercent("0").error).toBeTruthy();
    expect(failureRateFromPercent("0.02").value).toBe(0.0002);
    expect(percentText(0.025)).toBe("2.5");
    expect(freeCallsFromInput("1,000").value).toBe(1000);
    expect(freeCallsFromInput("x").error).toBeTruthy();
    expect(timeoutFromSeconds("10").value).toBe(10000);
  });

  it("maps choices and modes both ways", () => {
    expect(modeOfChoice(choiceOfMode("FREEMIUM"))).toBe("FREEMIUM");
    expect(choiceOfMode("PAID")).toBe("paid");
  });
});

describe("stakeSummary", () => {
  const rule = { floor: new Decimal(50), multiplier: new Decimal(1000), fromServer: true };

  it("separates this tool's need from the largest tool's and says when it is covered", () => {
    const summary = stakeSummary({
      needed: usd("300"),
      total: usd("450"),
      have: usd("600"),
      price: usd("0.30"),
      rule,
      largestToolName: "Market quote",
    });
    expect(summary.perTool).toBe("This tool alone needs $300.00 (1,000 × $0.30).");
    expect(summary.total).toBe("Your stake has to cover your largest paid tool, Market quote: $450.00; you have $600.00 ✓.");
    expect(summary.tone).toBe("ok");
    expect(summary.exposure).toContain("1,000 calls' worth of refunds");
    expect(summary.recommended).toContain("We recommend $675.00 (1.5 × $450.00)");
  });

  it("names the minimum when the floor wins, and the shortfall", () => {
    const summary = stakeSummary({ needed: usd("50"), total: usd("50"), have: usd("20"), price: usd("0.01"), rule });
    expect(summary.perTool).toBe("This tool alone needs $50.00 (the minimum for any paid tool).");
    expect(summary.total).toBe("Your stake is $30.00 short; you have $20.00.");
    expect(summary.tone).toBe("short");
  });
});

describe("stakeSummary wording", () => {
  const rule = { floor: new Decimal(50), multiplier: new Decimal(1000), fromServer: true };
  const sum = (have: ReturnType<typeof usd> | null) =>
    stakeSummary({ needed: usd("300"), total: usd("300"), have, price: usd("0.30"), rule }).total;

  it("never says 'all the stake you need' next to a shortfall", () => {
    expect(sum(usd("260"))).toBe("Your stake is $40.00 short; you have $260.00.");
    expect(sum(usd("0"))).toBe("Your stake is $300.00 short; you have none yet.");
  });

  it("keeps the met and unknown sentences", () => {
    expect(sum(usd("300"))).toBe("That is all the stake you need; you have $300.00 ✓.");
    expect(sum(null)).toBe("That is all the stake you need; we could not read your stake yet.");
  });
});

describe("stakeEffectOf", () => {
  const usd = (major: string) => ({ amount: String(Math.round(Number(major) * 1e6)), asset: "usd", decimals: 6 });
  const binding = { id: "b1", price: usd("0.05"), pricingMode: "PAID" as const };

  it("names the stake needed before and after a price rise, and the shortfall", () => {
    const effect = stakeEffectOf({ binding, price: usd("0.30"), mode: "PAID", stake: null, staked: usd("100"), chainParams: TEST_PARAMS });
    expect(effect.before?.amount).toBe(usd("50").amount);
    expect(effect.after?.amount).toBe(usd("300").amount);
    expect(effect.shortfall?.amount).toBe(usd("200").amount);
  });

  it("has no shortfall when the stake covers the new price, and none for a switch to free", () => {
    expect(stakeEffectOf({ binding, price: usd("0.30"), mode: "PAID", stake: null, staked: usd("400") }).shortfall).toBeNull();
    const free = stakeEffectOf({ binding, price: null, mode: "FREE", stake: null, staked: null });
    expect(free.after).toBeNull();
    expect(free.shortfall).toBeNull();
  });
});

describe("free-call boxes (provider Settings)", () => {
  it("validate both boxes with the same words", () => {
    expect(freeCallsFromInput("x").error).toBe("A whole number of calls, like 100.");
    expect(freeBudgetFromInput("x").error).toBe("A whole number of calls, like 100.");
    expect(freeCallsFromInput("0").error).toBe("At least 1 call.");
    expect(freeBudgetFromInput("0").error).toBe("At least 1 call. Leave it empty for the platform default.");
    expect(freeCallsFromInput("2000000").error).toBe("At most 1,000,000 calls.");
    expect(freeBudgetFromInput("3000000000").error).toBe("At most 2,147,483,647 calls.");
    expect(freeBudgetFromInput("")).toEqual({ value: null, error: null });
    expect(freeBudgetFromInput("5,000")).toEqual({ value: 5000, error: null });
  });

  it("warns when all agents together get fewer free calls a day than one agent", () => {
    expect(freeBudgetWarning(50, 100)).toBe(
      "Agents get at most 50 free calls a day in total, fewer than the 100 each agent is offered.",
    );
    expect(freeBudgetWarning(100, 100)).toBeNull();
    expect(freeBudgetWarning(null, 100)).toBeNull();
    expect(freeBudgetWarning(50, null)).toBeNull();
  });

  it("says what happens when the all-agents free calls run out, by how agents pay", () => {
    expect(freeBudgetHint("FREEMIUM")).toMatch(/offered the paid option at your price\.$/);
    expect(freeBudgetHint("FREE")).not.toMatch(/paid option/);
    expect(freeBudgetHint("FREE")).toMatch(/takes no more calls until the reset; agents' calls go to another provider/);
    expect(freeBudgetHint("PAID")).toMatch(/applies only on Free or Free \+ paid/);
    expect(freeBudgetHint("PAID")).not.toMatch(/paid option at your price/);
  });

  it("leaves out confirm rows whose before and after read the same", () => {
    const stake = { label: "Stake needed (you have $500.00)", before: "$450.00", after: "$450.00" };
    const price = { label: "Price", before: "$0.001000 a call", after: "$0.002000 a call" };
    expect(onlyChanged([price, stake])).toEqual([price]);
    const binding = { pricingMode: "FREEMIUM" as const, freeQuotaPerAgent: 50, freeDailyBudget: 5000 };
    expect(freeTermsChangeRows(binding, { freeQuotaPerAgent: 50, freeDailyBudget: 400 })).toEqual([
      { label: "Free calls per day, all agents", before: "5,000 calls", after: "400 calls" },
    ]);
  });

  it("lists the pricing mode and free-call changes for the save confirm", () => {
    const binding = { pricingMode: "PAID" as const, freeQuotaPerAgent: null, freeDailyBudget: 5000 };
    expect(freeTermsChangeRows(binding, { pricingMode: "FREEMIUM", freeQuotaPerAgent: 100, freeDailyBudget: null })).toEqual([
      { label: "How agents pay", before: "Paid", after: "Free + paid" },
      { label: "Free calls per agent per day", before: "None", after: "100 calls" },
      { label: "Free calls per day, all agents", before: "5,000 calls", after: "Platform default" },
    ]);
    expect(freeTermsChangeRows(binding, {})).toEqual([]);
  });
});
