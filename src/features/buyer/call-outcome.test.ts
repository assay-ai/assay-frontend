import { describe, expect, it } from "vitest";

import { callOutcome, matchesFilter, parseCallsFilter, statusesFor } from "./call-outcome";

const m = (amount: string) => ({ amount, asset: "a", decimals: 6 });

describe("callOutcome", () => {
  it("names each outcome", () => {
    expect(callOutcome({ status: "SETTLED", price: m("1000"), charged: m("1000") })).toBe("charged");
    expect(callOutcome({ status: "REFUNDED", price: m("1000"), charged: m("0") })).toBe("not-charged");
    expect(callOutcome({ status: "EXPIRED", price: m("1000"), charged: m("0") })).toBe("not-charged");
    expect(callOutcome({ status: "VERIFYING", price: m("1000"), charged: m("0") })).toBe("checking");
    expect(callOutcome({ status: "SETTLED", price: m("0"), charged: m("0") })).toBe("free");
  });
  it("filters and maps chips to API statuses", () => {
    expect(matchesFilter({ status: "SETTLED", price: m("0"), charged: m("0") }, "free")).toBe(true);
    expect(statusesFor("not-charged")).toEqual(["REFUNDED", "VOIDED", "EXPIRED"]);
    expect(statusesFor("free")).toBeUndefined();
    expect(parseCallsFilter("nope")).toBe("all");
    expect(parseCallsFilter("free")).toBe("free");
  });
});
