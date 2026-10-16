import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuyerDebt } from "@/interfaces/buyer-debt";
import { ApiError } from "@/libs/ApiClient";

import {
  balanceAfterSettling,
  debtBannerSummary,
  debtTotal,
  owedCallState,
  resumesAfterSettling,
} from "./debt-summary";
import { refreshesDebts, settleDebtFailure } from "./settle-debt-errors";

const ACCOUNT = "eip155:46630:0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1";
const OTHER = "eip155:46630:0x2222222222222222222222222222222222222222";
const ASSET = "eip155:46630/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3";

const debt = (overrides: Partial<BuyerDebt> = {}): BuyerDebt => ({
  intentId: "int_1",
  payer: ACCOUNT,
  amount: { amount: "2500000", asset: ASSET, decimals: 6 },
  providerId: "prv_1",
  toolId: "price_quote",
  cause: "VoucherExpired",
  state: "OPEN",
  lapsedAt: "2026-10-16T00:00:00.000Z",
  writeOffAt: "2026-11-15T00:00:00.000Z",
  replacedAt: null,
  createdAt: "2026-10-15T23:59:00.000Z",
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T00:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("debtTotal", () => {
  it("adds the amounts, and refuses to add different assets", () => {
    expect(debtTotal([debt(), debt({ amount: { amount: "405000", asset: ASSET, decimals: 6 } })])).toEqual({
      amount: "2905000",
      asset: ASSET,
      decimals: 6,
    });
    expect(debtTotal([debt(), debt({ amount: { amount: "1", asset: "other", decimals: 6 } })])).toBeNull();
    expect(debtTotal([])).toBeNull();
  });
});

describe("debtBannerSummary", () => {
  it("is null when nothing is owed", () => {
    expect(debtBannerSummary({ account: ACCOUNT, debts: [] })).toBeNull();
    expect(debtBannerSummary(undefined)).toBeNull();
  });

  it("names the amount, the count, the pause, the deadline and that free calls work", () => {
    const summary = debtBannerSummary({ account: ACCOUNT, debts: [debt()] })!;
    expect(summary.kind).toBe("settle");
    expect(summary.title).toBe("You owe $2.50 for 1 call. Paid calls are paused until you settle.");
    expect(summary.detail).toBe(
      "Settle by Nov 15, 00:00 UTC (in 29 days), or the provider is not paid (paid calls stay paused either way). Free calls still work.",
    );
    expect(summary.actionLabel).toBe("Settle $2.50");
    expect(summary.toSign.map((d) => d.intentId)).toEqual(["int_1"]);
  });

  it("names the earliest deadline among several open debts", () => {
    const summary = debtBannerSummary({
      account: ACCOUNT,
      debts: [debt({ writeOffAt: "2026-11-20T00:00:00.000Z" }), debt({ intentId: "int_2", writeOffAt: "2026-11-10T00:00:00.000Z" })],
    })!;
    expect(summary.detail).toContain("Settle by Nov 10, 00:00 UTC (in 24 days), or the providers are not paid");
    expect(summary.title).toBe("You owe $5.00 for 2 calls. Paid calls are paused until you settle.");
  });

  it("counts written-off debts among several", () => {
    const summary = debtBannerSummary({
      account: ACCOUNT,
      debts: [debt({ state: "WRITTEN_OFF" }), debt({ intentId: "int_2" })],
    })!;
    expect(summary.detail).toContain("1 was written off: settling pays that provider.");
  });

  it("says what another wallet owes beside the session's own", () => {
    const summary = debtBannerSummary({ account: ACCOUNT, debts: [debt(), debt({ intentId: "int_2", payer: OTHER })] })!;
    expect(summary.title).toContain("You owe $2.50 for 1 call");
    expect(summary.detail).toContain("1 more call ($2.50) is owed by another wallet of your organization");
  });

  it("asks nothing when every debt is another wallet's", () => {
    const summary = debtBannerSummary({ account: ACCOUNT, debts: [debt({ payer: OTHER })] })!;
    expect(summary.kind).toBe("other-wallet");
    expect(summary.actionLabel).toBeNull();
    expect(summary.title).toBe("Your organization owes $2.50 for 1 call. Paid calls are paused until it is settled.");
  });

  it("says a signed debt is being collected, with nothing to do", () => {
    const summary = debtBannerSummary({ account: ACCOUNT, debts: [debt({ state: "REPLACING" })] })!;
    expect(summary.kind).toBe("collecting");
    expect(summary.title).toBe("Collecting $2.50 you signed. Paid calls resume in about a minute.");
    expect(summary.actionLabel).toBeNull();
  });
});

describe("owedCallState", () => {
  const data = {
    account: ACCOUNT,
    debts: [debt(), debt({ intentId: "int_2", state: "REPLACING" }), debt({ intentId: "int_3", payer: OTHER })],
  };
  it("says whether this session can settle a call", () => {
    expect(owedCallState(data, "int_1").kind).toBe("settle");
    expect(owedCallState(data, "int_2").kind).toBe("collecting");
    expect(owedCallState(data, "int_3").kind).toBe("other-wallet");
    expect(owedCallState(data, "int_9").kind).toBe("unknown");
    expect(owedCallState(undefined, "int_1").kind).toBe("unknown");
  });
});

describe("after settling", () => {
  it("takes the settled amount off the escrow balance", () => {
    expect(balanceAfterSettling({ amount: "10000000", asset: ASSET, decimals: 6 }, [debt()])).toEqual({
      amount: "7500000",
      asset: ASSET,
      decimals: 6,
    });
    expect(balanceAfterSettling(null, [debt()])).toBeNull();
    expect(balanceAfterSettling({ amount: "1", asset: "other", decimals: 6 }, [debt()])).toBeNull();
  });

  it("resumes paid calls only when nothing else is owed", () => {
    const data = { account: ACCOUNT, debts: [debt(), debt({ intentId: "int_2", payer: OTHER })] };
    expect(resumesAfterSettling(data, [debt()])).toBe(false);
    expect(resumesAfterSettling({ account: ACCOUNT, debts: [debt(), debt({ intentId: "int_2", state: "REPLACING" })] }, [debt()])).toBe(true);
  });
});

describe("settle failures", () => {
  it("words the settle routes' refusals and a refused signing request", () => {
    expect(settleDebtFailure(new ApiError("PAYMENT_NEXT_SEQ_RATE_LIMITED", "raw", 429))).toMatch(/Too many signing attempts/);
    expect(settleDebtFailure(new Error("DEBT_SIGNING_REFUSED: the voucher is for another call. Nothing was signed."))).toMatch(
      /did not match this call exactly/,
    );
    expect(settleDebtFailure(new ApiError("SOMETHING_ELSE", "Raw message", 500))).toBe("Raw message");
  });

  it("refreshes the debts list after a settled-already or pending refusal", () => {
    expect(refreshesDebts(new ApiError("PAYMENT_DEBT_NOT_FOUND", "x", 404))).toBe(true);
    expect(refreshesDebts(new ApiError("PAYMENT_DEBT_REPLACEMENT_PENDING", "x", 409))).toBe(true);
    expect(refreshesDebts(new ApiError("OTHER", "x", 400))).toBe(false);
  });
});
