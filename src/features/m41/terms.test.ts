import { describe, expect, it } from "vitest";

import { DESIGN_TERMS, termValue } from "./terms";

describe("provider terms copy (BUG-R5-03)", () => {
  it("shows the published slash trigger in words, not as an enum name", () => {
    expect(termValue({ value: "DATA_FAIL only" })).toBe("failed data checks only");
    expect(termValue({ value: "10%" })).toBe("10%");
  });

  it("states payouts the way every earnings screen does", () => {
    const row = (key: string) => DESIGN_TERMS.commercialTerms.find((term) => term.key === key);
    expect(row("payouts")?.value).toBe("as each call settles");
    expect(row("slashedWhen")?.value).not.toContain("DATA_FAIL");
  });
});
