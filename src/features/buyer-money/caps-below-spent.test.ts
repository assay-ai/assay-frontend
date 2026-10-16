import { describe, expect, it } from "vitest";

import { ceilingBelowSpentNote } from "./caps";

const fmt = (atomic: string) => `$${(Number(atomic) / 1e6).toFixed(2)}`;

describe("ceilingBelowSpentNote", () => {
  it("warns when the new 24-hour ceiling is below what the running window already spent", () => {
    expect(ceilingBelowSpentNote({ amount: "15750000", decimals: 6 }, "5000000", "2026-10-18T00:00:00.000Z", fmt)).toBe(
      "Your agents already spent $15.75 in this 24-hour window, more than the new $5.00: paid calls stop until the window refills.",
    );
  });
  it("says nothing when it still fits, the window is not running, or the spend is unknown", () => {
    expect(ceilingBelowSpentNote({ amount: "1000000", decimals: 6 }, "5000000", "2026-10-18T00:00:00.000Z", fmt)).toBeNull();
    expect(ceilingBelowSpentNote({ amount: "15750000", decimals: 6 }, "5000000", null, fmt)).toBeNull();
    expect(ceilingBelowSpentNote(null, "5000000", "2026-10-18T00:00:00.000Z", fmt)).toBeNull();
  });
});
