import { describe, expect, it } from "vitest";

import { formatRemaining } from "./useCountdown";

describe("formatRemaining", () => {
  it("uses days and hours past a day", () => {
    expect(formatRemaining((2 * 24 + 4) * 3_600_000)).toBe("2d 4h");
  });

  it("uses hours and minutes under a day", () => {
    expect(formatRemaining(3 * 3_600_000 + 12 * 60_000)).toBe("3h 12m");
  });

  it("uses minutes alone under an hour", () => {
    expect(formatRemaining(48 * 60_000)).toBe("48m");
  });

  it("never prints '0m', which reads as 'ready' when it is not", () => {
    // The buyer's whole decision is "can I claim yet". Rounding 40 seconds down
    // to "0m" says yes 40 seconds early, and the claim reverts on chain.
    expect(formatRemaining(40_000)).toBe("under a minute");
  });

  it("treats a passed instant as passed rather than as negative time", () => {
    expect(formatRemaining(-5_000)).toBe("under a minute");
  });
});
