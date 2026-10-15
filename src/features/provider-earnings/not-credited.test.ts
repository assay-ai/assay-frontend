import { describe, expect, it } from "vitest";

import { callCount, partsThatAddUp } from "./not-credited";

describe("partsThatAddUp", () => {
  it("hands the lost cent to the largest remainder so the parts add up", () => {
    // $0.81 + $0.405 + $0.405 = $1.62
    expect(partsThatAddUp(["810000", "405000", "405000"], 6)).toEqual(["810000", "410000", "400000"]);
  });

  it("never exceeds the truncated total", () => {
    const parts = partsThatAddUp(["3333", "3333", "3333"], 6);
    expect(parts.reduce((s, p) => s + BigInt(p), 0n)).toBe(0n);
  });

  it("keeps exact cents untouched", () => {
    expect(partsThatAddUp(["1000000", "250000"], 6)).toEqual(["1000000", "250000"]);
  });

  it("returns an empty list for no parts", () => {
    expect(partsThatAddUp([], 6)).toEqual([]);
  });
});

describe("callCount", () => {
  it("pluralises", () => {
    expect(callCount(1)).toBe("1 call");
    expect(callCount(2)).toBe("2 calls");
    expect(callCount(1200)).toBe("1,200 calls");
  });
});
