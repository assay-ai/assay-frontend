import { describe, expect, it } from "vitest";

import type { Withdrawal } from "@/services/funding.service";

import {
  finishedWithdrawals,
  reconciliationLine,
  REFUNDABLE_ROW,
  refundableLine,
  refundableSummary,
  statementCheckSentence,
  withdrawalOutcome,
} from "./funding-lines";

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
    expect(refundableLine(summary)).toBe(
      "$0.26 charged recently (3 calls) is still covered: a report accepted for any of them is refunded in full.",
    );
    expect(refundableLine(summary, true)).toMatch(/^At least \$0\.26/);
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

describe("refund copy carries its condition (B7 review M1)", () => {
  it("every sentence that names a refund also says the report must be accepted", () => {
    const summary = refundableSummary([{ charged: m("50000"), refundableIfReportedUntil: null }])!;
    const texts = [
      refundableLine(summary),
      refundableLine(summary, true),
      `${REFUNDABLE_ROW.beforeTime} 12:10 UTC ${REFUNDABLE_ROW.afterTime}`,
      REFUNDABLE_ROW.noEnd,
      REFUNDABLE_ROW.empty,
      REFUNDABLE_ROW.pointer,
    ];
    for (const text of texts) {
      expect(text).toMatch(/refund/i);
      expect(text, text).toMatch(/accepted/);
      expect(text).not.toMatch(/can still be reported for a full refund|refundable if you report it|can be reported for a full refund|a report would refund/i);
    }
  });
});

describe("statementCheckSentence (B7 review M2)", () => {
  const check = (escrow: string, settling: string, difference: string, matches: boolean) => ({
    account: "a",
    chainId: "eip155:46630",
    opening: m("0"),
    deposits: m("0"),
    withdrawals: m("0"),
    paid: m("0"),
    closing: m("23500000"),
    check: { escrowBalance: m(escrow), stillSettling: m(settling), difference: m(difference), matches, observedAt: "2026-10-19T12:00:00Z" },
  });

  it("a match with payments still settling walks escrow − settling = closing", () => {
    expect(statementCheckSentence(check("24000000", "500000", "0", true))).toBe(
      "Your escrow holds $24.00. $0.50 of it is already paid for calls and still being collected on chain, which leaves $23.50: this closing balance.",
    );
  });

  it("a match with nothing settling", () => {
    expect(statementCheckSentence(check("23500000", "0", "0", true))).toBe("Your escrow holds $23.50: this closing balance.");
  });

  it("a mismatch with payments settling names the gap after them", () => {
    // escrow 23.00 − settling 0.50 = 22.50, which is 1.00 less than 23.50.
    expect(statementCheckSentence(check("23000000", "500000", "-1000000", false))).toMatch(
      /^Your escrow holds \$23\.00; less \$0\.50 still being collected on chain, that is \$22\.50, \$1\.00 less than this closing balance\./,
    );
    expect(statementCheckSentence(check("25000000", "500000", "1000000", false))).toMatch(/that is \$24\.50, \$1\.00 more than this closing balance/);
  });

  it("a mismatch with nothing settling", () => {
    expect(statementCheckSentence(check("24500000", "0", "1000000", false))).toMatch(/^Your escrow holds \$24\.50, \$1\.00 more than this closing balance\./);
  });
});
