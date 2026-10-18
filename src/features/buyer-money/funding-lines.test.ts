import { describe, expect, it } from "vitest";

import type { Withdrawal } from "@/services/funding.service";

import { finishedWithdrawals, reconciliationLine, refundableLine, refundableSummary, withdrawalOutcome } from "./funding-lines";

const ASSET = "eip155:46630/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3";
const m = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });

describe("reconciliationLine (B7)", () => {
  it("adds the chain's lifetime counters up to the balance", () => {
    expect(reconciliationLine({ deposited: m("20000000"), spent: m("6760000"), withdrawn: m("0") }, m("13240000"))).toBe(
      "Deposited $20.00 − spent $6.76 − withdrawn $0.00 = $13.24",
    );
  });
  it("says nothing it cannot show adding up", () => {
    expect(reconciliationLine(null, m("13240000"))).toBeNull();
    expect(reconciliationLine(undefined, m("13240000"))).toBeNull();
    expect(reconciliationLine({ deposited: m("20000000"), spent: m("6000000"), withdrawn: m("0") }, m("13240000"))).toBeNull();
  });
});

describe("refundableSummary (B7)", () => {
  it("adds up the backend's refundable list and names the soonest end", () => {
    const summary = refundableSummary([
      { charged: m("50000"), refundableIfReportedUntil: "2026-10-19T12:40:00Z" },
      { charged: m("200000"), refundableIfReportedUntil: "2026-10-19T12:10:00Z" },
      { charged: m("10000"), refundableIfReportedUntil: null },
    ])!;
    expect(summary).toEqual({ count: 3, total: m("260000"), soonestUntil: "2026-10-19T12:10:00Z" });
    expect(refundableLine(summary)).toBe("$0.26 charged recently can still be reported for a full refund (3 calls).");
  });
  it("is nothing when the backend lists none", () => {
    expect(refundableSummary([])).toBeNull();
    expect(refundableSummary(undefined)).toBeNull();
  });
});

describe("withdrawal history (B7)", () => {
  const row = (over: Partial<Withdrawal>): Withdrawal => ({
    id: "w1",
    chainId: "eip155:46630",
    account: "eip155:46630:0xabc",
    status: "CLAIMED",
    requested: m("13240000"),
    received: m("13240000"),
    requestedAt: "2026-10-18T10:00:00Z",
    claimableAt: "2026-10-18T11:00:00Z",
    closedAt: "2026-10-18T11:05:00Z",
    requestTransactionHash: "0x1",
    closeTransactionHash: "0x2",
    ...over,
  });
  it("leaves the pending request to the live escrow card", () => {
    expect(finishedWithdrawals([row({ status: "PENDING" }), row({ id: "w2" })]).map((w) => w.id)).toEqual(["w2"]);
  });
  it("says what became of each request, and a partly filled claim", () => {
    expect(withdrawalOutcome(row({}))).toEqual({ label: "Claimed", tone: "success", amount: "$13.24" });
    expect(withdrawalOutcome(row({ received: m("13000000") })).label).toBe("Claimed, $13.00 of $13.24 asked");
    expect(withdrawalOutcome(row({ status: "CANCELLED", received: null })).label).toBe("Cancelled, nothing moved");
    expect(withdrawalOutcome(row({ status: "REPLACED", received: null })).label).toBe("Replaced by a newer request");
  });
});
