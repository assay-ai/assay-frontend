import { describe, expect, it } from "vitest";

import { ceilingBelowSpentNote, seedCaps } from "./caps";

const fmt = (atomic: string) => `$${(Number(atomic) / 1e6).toFixed(2)}`;

describe("ceilingBelowSpentNote", () => {
  it("warns when the new 24-hour ceiling is below what the running window already spent", () => {
    expect(ceilingBelowSpentNote({ amount: "15750000", decimals: 6 }, "5000000", "2026-10-18T00:00:00.000Z", fmt)).toBe(
      "Your agents already spent $15.75 in this 24-hour window, more than the new $5.00: paid calls stop until the window refills.",
    );
  });
  it("prints the spent amount with its own formatter, so it matches the meters", () => {
    const up = (atomic: string) => `$${(Math.ceil(Number(atomic) / 1e4) / 100).toFixed(2)}`;
    expect(ceilingBelowSpentNote({ amount: "103126", decimals: 6 }, "50000", "2026-10-18T00:00:00.000Z", fmt, up)).toBe(
      "Your agents already spent $0.11 in this 24-hour window, more than the new $0.05: paid calls stop until the window refills.",
    );
  });
  it("says nothing when it still fits, the window is not running, or the spend is unknown", () => {
    expect(ceilingBelowSpentNote({ amount: "1000000", decimals: 6 }, "5000000", "2026-10-18T00:00:00.000Z", fmt)).toBeNull();
    expect(ceilingBelowSpentNote({ amount: "15750000", decimals: 6 }, "5000000", null, fmt)).toBeNull();
    expect(ceilingBelowSpentNote(null, "5000000", "2026-10-18T00:00:00.000Z", fmt)).toBeNull();
  });
});

describe("seedCaps (verify-r12 P3)", () => {
  it("prefills the amount a deep link needs, from the caps in force", () => {
    expect(seedCaps({ perCall: "2", perDay: "120" }, { perCall: "2.5" })).toEqual({ perCall: "2.5", perDay: "120" });
    expect(seedCaps({ perCall: "2", perDay: "3" }, { perDay: "3.5" })).toEqual({ perCall: "2", perDay: "3.5" });
  });
  it("never lowers a cap, keeps a call within a day, and ignores junk", () => {
    expect(seedCaps({ perCall: "5", perDay: "120" }, { perCall: "2.5" })).toEqual({ perCall: "5", perDay: "120" });
    expect(seedCaps({ perCall: "1", perDay: "2" }, { perCall: "3" })).toEqual({ perCall: "3", perDay: "3" });
    expect(seedCaps({ perCall: "1", perDay: "20" }, { perCall: "abc", perDay: "" })).toEqual({ perCall: "1", perDay: "20" });
  });
  it("starts from the defaults when no ceiling is set", () => {
    expect(seedCaps(null)).toEqual({ perCall: "1", perDay: "20" });
    expect(seedCaps(null, { perCall: "2.5" })).toEqual({ perCall: "2.5", perDay: "20" });
  });
});
