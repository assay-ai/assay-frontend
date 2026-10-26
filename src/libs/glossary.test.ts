import { describe, expect, it } from "vitest";

import { estimatePenalty } from "@/features/provider-penalties/estimate";
import { formatMoney } from "@/utils/money";

import { chainTerms, UNKNOWN_TERMS } from "@/libs/chain-terms";
import { TEST_CHAIN } from "@/test/chain-fixture";

import { definitionOf, GLOSSARY, GLOSSARY_KEYS } from "./glossary";

const TERMS = chainTerms(TEST_CHAIN);

describe("glossary", () => {
  it("has the shared vocabulary (FIX-PLAN 2026-10-18 §2)", () => {
    for (const key of ["reserved", "refundable-until", "report", "not-charged", "observed-failures", "agent-limit", "account-ceiling"]) {
      expect(GLOSSARY_KEYS).toContain(key);
    }
    expect(GLOSSARY["observed-failures"].term).toBe("Failure rate");
    expect(GLOSSARY.report.term).toBe("Report a bad result (a dispute)");
  });

  it("defines Not charged as all three ways a call goes unpaid", () => {
    const definition = GLOSSARY["not-charged"].definition;
    expect(definition).toMatch(/failed our checks/);
    expect(definition).toMatch(/no usable result/);
    expect(definition).toMatch(/not collected/);
  });

  it("states the stake rule with the provider screens' numbers", () => {
    expect(GLOSSARY["stake-rule"].definition).toContain("at least 400 checked calls");
    expect(definitionOf("stake-rule", TERMS)).toContain("never more than 10%");
    // As the backend judges it (a statistical tolerance) and as /why-list-here says it (a per-penalty maximum).
    expect(GLOSSARY["stake-rule"].definition).toContain("beyond a margin for chance");
    expect(GLOSSARY["stake-rule"].definition).toContain("maximum set on chain");
  });

  it("says when a payment is final: after the 1-hour report window, then only the stake is at risk", () => {
    const final = definitionOf("payout-final", TERMS);
    expect(final).toContain("1 hour after the call, once a buyer can no longer report a bad result");
    expect(final).toContain("a call that fails because of the provider");
    expect(final).toContain("After that, a payout is never clawed back, and only the provider's stake is at risk.");
    expect(GLOSSARY["penalty-example"].definition).toContain("maximum set on chain");
  });

  it("works the penalty example with the same formula as the provider wizard", () => {
    const { penalty } = estimatePenalty({
      price: { amount: "100000", asset: "x", decimals: 6 },
      calls: 1000,
      observedRate: 0.12,
      declaredRate: 0.03,
    });
    expect(formatMoney(penalty)).toBe("$18.00");
    expect(GLOSSARY["penalty-example"].definition).toContain("up to about $18.00");
    expect(GLOSSARY["penalty-example"].definition).toContain("1,000 × $0.10 × (12% − 3%) × 2");
  });

  it("keeps no on-chain number of its own: the cap and the report window come from the chain", () => {
    expect(GLOSSARY["stake-rule"].definition).toContain("{{dailyCapPercent}}");
    expect(GLOSSARY["payout-final"].definition).toContain("{{holdWindow}}");
    expect(definitionOf("payout-final", UNKNOWN_TERMS)).toContain("— after the call");
    for (const key of GLOSSARY_KEYS) {
      expect(definitionOf(key, TERMS)).not.toMatch(/\{\{/);
    }
  });

  it("keeps every definition free of codes and internal names", () => {
    for (const key of GLOSSARY_KEYS) {
      expect(GLOSSARY[key].definition).not.toMatch(/eip155:|solana:|[A-Z]{3,}_[A-Z]+/);
    }
  });
});
