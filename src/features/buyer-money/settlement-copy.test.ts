import { describe, expect, it } from "vitest";

import { onChainHeld, pendingSettlement, pendingSettlementLine, signedInWindow, withdrawalPausedText, withdrawSettlingNote } from "./settlement-copy";

const usd = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x1", decimals: 6 });
const unsettled = (count: number, amount: string, windowNeeds = amount) => ({
  count,
  amount: usd(amount),
  largest: usd(amount),
  windowNeeds: usd(windowNeeds),
  redeemableUntil: null,
});
const NOW = Date.parse("2026-10-31T12:00:00.000Z");

describe("buyer settlement copy (round-2 SPEC-W2 §11)", () => {
  it("Funding's Pending settlement line: the escrow's own figure, the maximum wait, never the moving nextSettleAt (API-W2 §3.3)", () => {
    const escrow = { pendingSettlement: usd("1500000"), pendingSettlementCalls: 3, nextSettleAt: "2026-10-31T12:30:00.000Z" };
    expect(pendingSettlementLine(pendingSettlement(escrow, null))).toEqual({
      label: "Pending settlement",
      text: "$1.50 for 3 paid calls not yet recorded on chain, still in your escrow; taken on chain in the next settlement round (within about an hour).",
    });
    // A W2 server with nothing pending: no line, and the older endpoint is not consulted.
    expect(pendingSettlement({ pendingSettlement: usd("0") }, unsettled(2, "100"))).toBeNull();
    expect(pendingSettlement({ pendingSettlement: null }, unsettled(2, "100"))).toBeNull();
  });

  it("an older server: the unsettled payments, a maximum wait; nothing when none or unknown", () => {
    expect(pendingSettlementLine(pendingSettlement({}, unsettled(3, "1500000")))?.text).toBe(
      "$1.50 for 3 paid calls not yet recorded on chain, still in your escrow; taken on chain in the next settlement round (within about an hour).",
    );
    expect(pendingSettlementLine(pendingSettlement({}, unsettled(1, "2000")))?.text).toMatch(/^\$0\.002 for 1 paid call /);
    expect(pendingSettlement({}, unsettled(0, "0"))).toBeNull();
    expect(pendingSettlement({}, null)).toBeNull();
  });

  it("the 24 h figure counts what is signed, including not yet settled; unknown keeps the chain's own words", () => {
    const label = "Signed in the last 24 h, including not yet settled, all agents";
    expect(signedInWindow({ signedLast24h: usd("2000000"), spentInWindow: usd("1000000") }, null)).toEqual({ label, used: usd("2000000") });
    expect(signedInWindow({ spentInWindow: usd("1000000") }, unsettled(2, "500000", "1500000"))).toEqual({ label, used: usd("1500000") });
    expect(signedInWindow({ spentInWindow: usd("1000000") }, unsettled(0, "0", "0")).used).toEqual(usd("1000000"));
    expect(signedInWindow({ spentInWindow: usd("1000000") }, null)).toEqual({
      label: "Spent from your escrow in the last 24 hours, all agents",
      used: usd("1000000"),
    });
  });

  it("withdraw: still-settling money is paid first; up to min(requested, balance − pending), with when", () => {
    expect(
      withdrawSettlingNote({
        requested: usd("10000000"),
        balance: usd("12000000"),
        pending: usd("3000000"),
        availableAt: "2026-10-31T15:00:00.000Z",
        now: NOW,
      }),
    ).toBe("About $3.00 from earlier calls is still settling and is paid first; you will receive up to $9.00 (available 15:00 UTC).");
    expect(
      withdrawSettlingNote({ requested: usd("11000000"), balance: usd("12000000"), pending: usd("3000000"), availableAt: null, availableIn: "3 hours" }),
    ).toBe("About $3.00 from earlier calls is still settling and is paid first; you will receive up to $9.00 (available about 3 hours after you ask).");
    // The settling money leaves the whole request payable: no second sentence beside "You receive up to $5.00".
    expect(withdrawSettlingNote({ requested: usd("5000000"), balance: usd("12000000"), pending: usd("3000000"), availableAt: null })).toBeNull();
    // Never below zero.
    expect(withdrawSettlingNote({ requested: usd("5000000"), balance: usd("1000000"), pending: usd("3000000"), availableAt: null })).toBe(
      "About $3.00 from earlier calls is still settling and is paid first; you will receive up to $0.00.",
    );
    expect(withdrawSettlingNote({ requested: usd("5000000"), balance: usd("1000000"), pending: usd("0"), availableAt: null })).toBeNull();
    expect(withdrawSettlingNote({ requested: null, balance: usd("1000000"), pending: usd("10"), availableAt: null })).toBeNull();
    // The server's own upper bound wins when it sends one.
    expect(
      withdrawSettlingNote({ requested: usd("5000000"), balance: null, pending: usd("3000000"), upTo: usd("4000000"), availableAt: null }),
    ).toBe("About $3.00 from earlier calls is still settling and is paid first; you will receive up to $4.00.");
  });

  it("the standing withdrawal names the pause and the way out", () => {
    expect(withdrawalPausedText("Robinhood Chain testnet")).toBe(
      "Every agent's paid calls on Robinhood Chain testnet are paused while a withdrawal is pending; claim it or cancel it to resume. Free calls keep working.",
    );
  });
});

describe("the on-chain dispute hold (BUG-R2-BUY-01)", () => {
  it("reads the escrow's onChainHeld fields, apart from pendingSettlement", () => {
    const escrow = { onChainHeld: usd("90000"), onChainHeldCalls: 9, onChainHoldEndsAt: "2026-11-01T15:00:00.000Z" };
    expect(onChainHeld(escrow)).toEqual({ amount: usd("90000"), calls: 9, endsAt: "2026-11-01T15:00:00.000Z" });
  });
  it("says nothing when there is none, or on an older server that does not send it", () => {
    expect(onChainHeld({ onChainHeld: usd("0"), onChainHeldCalls: 0, onChainHoldEndsAt: null })).toBeNull();
    expect(onChainHeld({ onChainHeld: null })).toBeNull();
    expect(onChainHeld({})).toBeNull();
    expect(onChainHeld(null)).toBeNull();
  });
});
