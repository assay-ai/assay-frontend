import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import type { Money, ProviderStake } from "@/interfaces";

import {
  choiceOfMode,
  failureRateFromPercent,
  freeCallsFromInput,
  modeOfChoice,
  percentText,
  providerShare,
  stakeNeededFor,
  stakeRuleOf,
  takeRateOf,
  timeoutFromSeconds,
  stakeSummary,
  totalStakeWith,
} from "./go-live";

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
  it("reads the stake rule from a derivation line, else uses current terms", () => {
    const rule = stakeRuleOf(stake);
    expect(rule.fromServer).toBe(true);
    expect(rule.floor.toNumber()).toBe(60);
    expect(rule.multiplier.toNumber()).toBe(900);
    expect(stakeRuleOf(null).fromServer).toBe(false);
  });

  it("needs max(floor, multiplier × price) for paid listings only", () => {
    const rule = stakeRuleOf(null);
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
    expect(providerShare(usd("0.10"), takeRateOf(null)).amount).toBe(usd("0.09").amount);
    const terms = { commercialTerms: [{ key: "takeRate", label: "", value: "5%", caption: "" }] };
    const take = takeRateOf(terms as never);
    expect(take.fromServer).toBe(true);
    expect(providerShare(usd("1"), take).amount).toBe(usd("0.95").amount);
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
    expect(summary.total).toBe("That is all the stake you need; you have $20.00, $30.00 short.");
    expect(summary.tone).toBe("short");
  });
});
