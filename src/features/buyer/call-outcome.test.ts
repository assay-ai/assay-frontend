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
    expect(statusesFor("not-charged")).toEqual(["REFUNDED", "VOIDED", "EXPIRED", "SETTLED"]);
    expect(statusesFor("free")).toBeUndefined();
    expect(parseCallsFilter("nope")).toBe("all");
    expect(parseCallsFilter("free")).toBe("free");
  });
  it("has an Owed chip that keeps owed calls, open or written off, and only those", () => {
    expect(parseCallsFilter("owed")).toBe("owed");
    expect(statusesFor("owed")).toEqual(["SETTLED"]);
    const owed = { status: "SETTLED", price: m("1000"), charged: m("1000"), debt: "OUTSTANDING" as const };
    expect(matchesFilter(owed, "owed")).toBe(true);
    expect(matchesFilter({ ...owed, debt: "WRITTEN_OFF" as const }, "owed")).toBe(true);
    expect(matchesFilter({ ...owed, debt: "VOIDED" as const }, "owed")).toBe(false);
    expect(matchesFilter({ ...owed, debt: null }, "owed")).toBe(false);
    expect(matchesFilter(owed, "charged")).toBe(false);
  });
  it("calls a forfeited call or a voided debt not charged, though its status is SETTLED", () => {
    const settled = { status: "SETTLED", price: m("1000"), charged: m("0") };
    expect(callOutcome({ ...settled, forfeited: true } as Parameters<typeof callOutcome>[0])).toBe("not-charged");
    expect(callOutcome({ ...settled, debt: "VOIDED" })).toBe("not-charged");
    expect(callOutcome({ ...settled, charged: m("1000"), debt: "OUTSTANDING" })).toBe("owed");
    expect(callOutcome({ ...settled, debt: "WRITTEN_OFF" })).toBe("owed");
    expect(matchesFilter({ ...settled, debt: "VOIDED" }, "not-charged")).toBe(true);
    expect(statusesFor("not-charged")).toContain("SETTLED");
  });
});
