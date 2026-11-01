import { describe, expect, it } from "vitest";

import type { ProviderPayoutState } from "@/interfaces";

import { providerMoney } from "./not-credited";
import { cadenceLabel, hasPayoutStages, nextPayoutLine, paymentRowTitle, payoutStages } from "./payout-stages";

const usd = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x1", decimals: 6 });
const NOW = Date.parse("2026-10-31T12:10:00.000Z");
const base: ProviderPayoutState = {};

describe("payout stages (round-2 SPEC-W2 §11)", () => {
  it("is null on an older server, so the page keeps its earlier lines", () => {
    expect(hasPayoutStages(base)).toBe(false);
    expect(payoutStages(base, usd("900000"), providerMoney, NOW)).toBeNull();
    expect(payoutStages(undefined, null, providerMoney, NOW)).toBeNull();
  });

  it("names the four stages in order, with the scheduler's own times", () => {
    const stages = payoutStages(
      {
        ...base,
        awaitingSettlement: usd("200000"),
        awaitingSettlementCalls: 4,
        inDisputeHold: usd("300000"),
        inDisputeHoldCalls: 1,
        disputeHoldEndsAt: "2026-10-31T13:00:00.000Z",
        readyForPayout: usd("0"),
        readyForPayoutCalls: 0,
        nextPayoutAt: "2026-10-31T18:00:00.000Z",
      },
      usd("900000"),
      providerMoney,
      NOW,
    )!;
    expect(stages.map((s) => s.label)).toEqual([
      "Passed, being recorded on chain",
      "In the dispute hold until 13:00 UTC",
      "Ready, paid in the next payout (about 18:00 UTC)",
      "In your wallet",
    ]);
    expect(stages.map((s) => s.calls)).toEqual([4, 1, 0, null]);
    expect(stages.map((s) => s.empty)).toEqual([false, false, true, false]);
  });

  it("shows unknown (null) money as a dash, never $0", () => {
    const stages = payoutStages({ awaitingSettlement: null, inDisputeHold: usd("10") }, null, providerMoney, NOW)!;
    expect(stages[0]!.amount).toBe("—");
    expect(stages[3]!.amount).toBe("—");
  });

  it("drops a time it does not know or that has passed, never guesses one", () => {
    const stages = payoutStages(
      { ...base, readyForPayout: usd("10"), disputeHoldEndsAt: "2026-10-31T11:00:00.000Z", nextPayoutAt: null },
      null,
      providerMoney,
      NOW,
    )!;
    expect(stages[1]!.label).toBe("In the dispute hold");
    expect(stages[2]!.label).toBe("Ready, paid in the next payout");
  });

  it("with several calls held, the earliest end is said as the first one's", () => {
    const stages = payoutStages(
      { inDisputeHold: usd("10"), inDisputeHoldCalls: 3, disputeHoldEndsAt: "2026-10-31T13:00:00.000Z" },
      null,
      providerMoney,
      NOW,
    )!;
    expect(stages[1]!.label).toBe("In the dispute hold, the first until 13:00 UTC");
  });
});

describe("payout cadence and payment rows (SPEC-W2 §8, §11)", () => {
  it("offers every 6 hours (default) and hourly only once the minimum is ready; no daily option", () => {
    expect(cadenceLabel("EVERY_6_HOURS")).toBe("Every 6 hours (default)");
    expect(cadenceLabel("HOURLY", "$25.00")).toBe("Every hour, only when at least $25.00 is ready (otherwise in the 6-hour run)");
    expect(cadenceLabel("HOURLY")).toBe("Every hour, only when at least $25 is ready (otherwise in the 6-hour run)");
  });

  it("says the next payout as 'about HH:MM UTC', or nothing when none is planned", () => {
    expect(nextPayoutLine("2026-10-31T18:00:00.000Z", NOW)).toBe("Next payout about 18:00 UTC");
    expect(nextPayoutLine(null, NOW)).toBeNull();
  });

  it("BUG-R2-PRV-02: says why an hourly schedule shows the 6-hour run", () => {
    const hourly = (ready: ReturnType<typeof usd> | null, minimum: ReturnType<typeof usd> | null = usd("10000")) => ({
      inputs: { cadence: "HOURLY" as const, minimum, ready },
      format: providerMoney,
    });
    // 18:00 is more than an hour after 12:10, and $0.009 is below the $0.01 minimum.
    expect(nextPayoutLine("2026-10-31T18:00:00.000Z", NOW, hourly(usd("9000")))).toBe(
      "Next payout about 18:00 UTC (hourly payouts start once at least $0.01 is ready)",
    );
    // Nothing ready yet (all still in the hold): the same reason.
    expect(nextPayoutLine("2026-10-31T18:00:00.000Z", NOW, hourly(null))).toMatch(/at least \$0\.01 is ready\)$/);
    // No minimum from the server: no number.
    expect(nextPayoutLine("2026-10-31T18:00:00.000Z", NOW, hourly(usd("9000"), null))).toBe(
      "Next payout about 18:00 UTC (hourly payouts start once enough is ready)",
    );
    // Within the hour, or the minimum is ready, or the 6-hour cadence: no reason.
    expect(nextPayoutLine("2026-10-31T13:00:00.000Z", NOW, hourly(usd("9000")))).toBe("Next payout about 13:00 UTC");
    expect(nextPayoutLine("2026-10-31T18:00:00.000Z", NOW, hourly(usd("10000")))).toBe("Next payout about 18:00 UTC");
    expect(
      nextPayoutLine("2026-10-31T18:00:00.000Z", NOW, {
        inputs: { cadence: "EVERY_6_HOURS", minimum: usd("10000"), ready: null },
        format: providerMoney,
      }),
    ).toBe("Next payout about 18:00 UTC");
  });

  it("titles a payment as one transfer for many calls, buyers only when known", () => {
    const tx = "0xabc";
    expect(paymentRowTitle({ calls: 12, buyers: 3, chainTxRef: tx }, true)).toBe("Paid for 12 calls (from 3 buyers) in one transfer");
    expect(paymentRowTitle({ calls: 1, buyers: 1, chainTxRef: tx }, true)).toBe("Paid for 1 call (from 1 buyer) in one transfer");
    expect(paymentRowTitle({ calls: 5, chainTxRef: tx }, true)).toBe("Paid for 5 calls in one transfer");
    // No transaction to check it against: no "one transfer" claim. No count: no number.
    expect(paymentRowTitle({ calls: 5, chainTxRef: null }, false)).toBe("Paid for 5 calls");
    expect(paymentRowTitle({ calls: null, buyers: null, chainTxRef: tx }, true)).toBe("Paid for calls");
  });
});

describe("unpaid payouts (round-2 review M4)", () => {
  it("is its own line after the four, never part of In your wallet", () => {
    const stages = payoutStages(
      { ...base, readyForPayout: usd("0"), unpaid: usd("1250000"), unpaidSince: "2026-10-30T08:00:00.000Z" },
      usd("900000"),
      providerMoney,
      NOW,
    )!;
    expect(stages.map((s) => s.key)).toEqual(["recording", "hold", "ready", "wallet", "unpaid"]);
    const wallet = stages.find((s) => s.key === "wallet")!;
    const unpaid = stages.find((s) => s.key === "unpaid")!;
    expect(wallet.amount).toBe(providerMoney(usd("900000")));
    expect(unpaid.amount).toBe(providerMoney(usd("1250000")));
    expect(unpaid.label).toBe("Not paid yet: blocked by the token issuer since yesterday 08:00 UTC");
    expect(unpaid.note).toContain("did not reach your wallet");
    expect(unpaid.note).toContain("paid to you after Assay claims it, once the issuer lifts the block");
  });

  it("L-6: one line per asset with unpaid, whatever asset the page reads; the single figure is not repeated", () => {
    const other = { amount: "500000", asset: "eip155:46630/erc20:0x2", decimals: 6 };
    const stages = payoutStages(
      {
        ...base,
        readyForPayout: usd("0"),
        // The page reads asset 0x1, which has nothing unpaid…
        unpaid: null,
        // …but 0x2 has: it is shown all the same.
        unpaidByAsset: [{ amount: other, since: "2026-10-30T08:00:00.000Z" }],
      },
      null,
      providerMoney,
      NOW,
    )!;
    const unpaid = stages.filter((s) => s.key === "unpaid");
    expect(unpaid.map((s) => s.amount)).toEqual([providerMoney(other)]);
    expect(unpaid[0]!.label).toBe("Not paid yet: blocked by the token issuer since yesterday 08:00 UTC");

    const two = payoutStages(
      {
        ...base,
        readyForPayout: usd("0"),
        unpaid: usd("1250000"),
        unpaidByAsset: [
          { amount: usd("1250000"), since: null },
          { amount: other, since: null },
        ],
      },
      null,
      providerMoney,
      NOW,
    )!;
    const lines = two.filter((s) => s.key === "unpaid");
    expect(lines.map((s) => s.amount)).toEqual([providerMoney(usd("1250000")), providerMoney(other)]);
    expect(lines[0]!.label).toBe("Not paid yet in this token: blocked by the token issuer");
  });

  it("is left out when nothing is unpaid", () => {
    for (const unpaid of [null, usd("0"), undefined]) {
      const stages = payoutStages({ ...base, readyForPayout: usd("0"), unpaid }, null, providerMoney, NOW)!;
      expect(stages.map((s) => s.key)).not.toContain("unpaid");
    }
  });
});
