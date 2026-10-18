import { describe, expect, it } from "vitest";

import { wholePercents } from "./shares";

describe("wholePercents", () => {
  it("adds up to 100 with an Other row, where rounding each alone left 7% unexplained", () => {
    // Three listed tools and the calls on tools no longer listed (the review's 17/13/63 + 7).
    const shares = wholePercents([18, 14, 68, 8], 108);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(shares).toEqual([17, 13, 63, 7]);
  });

  it("gives the lost points to the largest remainders", () => {
    expect(wholePercents([1, 1, 1], 3)).toEqual([34, 33, 33]);
  });

  it("is all zeros for no calls", () => {
    expect(wholePercents([0, 0], 0)).toEqual([0, 0]);
  });
});
