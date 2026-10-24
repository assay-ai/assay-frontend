import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import { stakeAfterSentence, stakeStatus } from "./stake-status";

const usd = (major: string) => ({ amount: new Decimal(major).mul(1_000_000).toFixed(0), asset: "USDG", decimals: 6 });

describe("stakeStatus", () => {
  const required = usd("100");
  const recommended = usd("150");

  it("is Short below the minimum", () => {
    const reading = stakeStatus({ required, staked: usd("80"), recommended, enough: false });
    expect(reading.health).toBe("short");
    expect(reading.label).toBe("Short");
    expect(reading.sentence).toBe(
      "Short: $20.00 below the $100.00 minimum. Pending penalties count against your stake. Add stake to keep paid calls running.",
    );
  });

  it("is Covered, close to the minimum, within 20% of it (the headroom notice's rule)", () => {
    const reading = stakeStatus({ required, staked: usd("119.955"), recommended, enough: true });
    expect(reading.health).toBe("close");
    expect(reading.label).toBe("Covered, close to the minimum");
    expect(reading.sentence).toBe(
      "Covered, close to the minimum: $19.95 above the $100.00 minimum. A proposed penalty counts against your stake at once and could take you below it; keep your stake above the minimum. Recommended: $150.00.",
    );
  });

  it("is Covered from 20% above the minimum", () => {
    expect(stakeStatus({ required, staked: usd("120"), recommended, enough: true }).health).toBe("covered");
    expect(stakeStatus({ required, staked: usd("160"), recommended, enough: true }).sentence).toBe(
      "Covered: $60.00 above the $100.00 minimum.",
    );
  });

  it("says nothing is needed without paid tools, and nothing while unknown", () => {
    expect(stakeStatus({ required: null, staked: usd("5"), enough: true }).health).toBe("none");
    expect(stakeStatus({ required: null, staked: usd("5"), enough: true }).sentence).toBe(
      "No paid tool needs stake right now. Paid tools will use it when they go live.",
    );
    expect(stakeStatus({ required: null, staked: null, enough: true }).sentence).toBe(
      "No paid tool needs stake right now. Free tools go live without it.",
    );
    expect(stakeStatus({ required, staked: null, enough: null }).health).toBe("unknown");
  });
});

describe("stakeAfterSentence", () => {
  it("measures the amount against the recommended figure", () => {
    expect(stakeAfterSentence(new Decimal(150), usd("100"), usd("150"))).toBe("Brings you to the recommended $150.00.");
    expect(stakeAfterSentence(new Decimal(90), usd("100"), usd("150"))).toBe("Brings you to $90.00, still below the $100.00 minimum.");
    expect(stakeAfterSentence(new Decimal(130), usd("100"), usd("150"))).toBe("Brings you to $130.00; the recommended amount is $150.00.");
  });
});
