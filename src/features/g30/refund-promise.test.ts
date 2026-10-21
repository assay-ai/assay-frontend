import { describe, expect, it } from "vitest";

import { receiptRefetchInterval, refundPromiseLive } from "./refund-promise";

const ENDS = "2026-10-18T11:00:00.000Z";
const UNTIL = "2026-10-18T10:59:00.000Z";

describe("refundPromiseLive (W1A review C1)", () => {
  it("only on the backend's flag", () => {
    expect(refundPromiseLive({ refundableIfReportedNow: false, disputeWindowEndsAt: ENDS }, 0)).toBe(false);
    expect(refundPromiseLive({ disputeWindowEndsAt: ENDS }, 0)).toBe(false);
  });

  it("never past refundableIfReportedUntil or the hold's end, however stale the flag", () => {
    const receipt = { refundableIfReportedNow: true, refundableIfReportedUntil: UNTIL, disputeWindowEndsAt: ENDS };
    expect(refundPromiseLive(receipt, Date.parse(UNTIL) - 1)).toBe(true);
    expect(refundPromiseLive(receipt, Date.parse(UNTIL))).toBe(false);
    expect(refundPromiseLive({ refundableIfReportedNow: true, disputeWindowEndsAt: ENDS }, Date.parse(ENDS))).toBe(false);
  });

  it("with no end known (a voucher not redeemed yet): the flag, until a refetch brings one", () => {
    expect(refundPromiseLive({ refundableIfReportedNow: true }, Date.parse(ENDS) + 1)).toBe(true);
  });
});

describe("receiptRefetchInterval", () => {
  it("refetches every minute while the receipt carries the promise, never otherwise", () => {
    expect(receiptRefetchInterval({ refundableIfReportedNow: true })).toBe(60_000);
    expect(receiptRefetchInterval({ refundableIfReportedNow: false })).toBe(false);
    expect(receiptRefetchInterval(undefined)).toBe(false);
  });
});
