import { describe, expect, it } from "vitest";

import { DESIGN_TERMS, plainTermsLine, termLabel, termValue } from "./terms";

describe("provider terms copy (BUG-R5-03)", () => {
  it("shows the published slash trigger in words, not as an enum name", () => {
    expect(termValue({ value: "DATA_FAIL only" })).toBe("failed data checks only");
    expect(termValue({ value: "10%" })).toBe("10%");
  });

  it("states payouts the way every earnings screen does", () => {
    const row = (key: string) => DESIGN_TERMS.commercialTerms.find((term) => term.key === key);
    expect(row("payouts")?.value).toBe("as each call settles");
    // A payment is final only after the 1-hour report window.
    expect(row("payouts")?.caption).toBe("on chain; final 1 hour after each call");
    expect(row("slashedWhen")?.value).not.toContain("DATA_FAIL");
  });

  // B5 review M2: "we hold nothing back" contradicted the 1-hour hold for buyer reports.
  it("says each paid call is held for buyer reports, not that nothing is held", () => {
    const reserve = DESIGN_TERMS.commercialTerms.find((term) => term.key === "reserveHeld");
    expect(reserve?.caption).toBe("No standing reserve: each paid call is held for 1 hour for buyer reports");
    expect(reserve?.caption).not.toMatch(/nothing back/);
  });

  it("names the policy the console's way", () => {
    expect(plainTermsLine("I accept the Payout Terms (2026-04-01) and the Slash Policy (2026-06-15)")).toBe(
      "I accept the Payout Terms (Apr 1, 2026 version) and the Penalty Policy (Jun 15, 2026 version)"
    );
    expect(termLabel({ label: "Slashed when" })).toBe("Penalty when");
  });
});
