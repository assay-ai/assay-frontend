import { describe, expect, it } from "vitest";

import { isCredited, type ProviderCallRow } from "./calls";

const money = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0xabc", decimals: 6 });

function row(overrides: Partial<ProviderCallRow>): ProviderCallRow {
  return {
    callId: "call",
    intentId: "intent",
    createdAt: "2026-10-16T00:00:00.000Z",
    toolId: "tool",
    status: "SETTLED",
    classification: "PAID_CREDITED",
    reason: "",
    verdict: "PASS",
    providerAmount: money("900000"),
    platformFee: money("100000"),
    priceAmount: money("1000000"),
    ...overrides,
  };
}

describe("isCredited", () => {
  it("counts a settled, credited call as earned", () => {
    expect(isCredited(row({}))).toBe(true);
  });

  it("does not count a settled call whose credit is not written", () => {
    expect(isCredited(row({ classification: "PENDING" }))).toBe(false);
    expect(isCredited(row({ classification: "PAID_AWAITING_REDEMPTION" }))).toBe(false);
  });

  // Review 2026-10-15, M2: a forfeited voucher is SETTLED, but nothing was collected.
  it("does not count a voucher the provider forfeited as earned", () => {
    expect(isCredited(row({ classification: "PROVIDER_FORFEITED", providerAmount: money("0") }))).toBe(
      false,
    );
  });
});
