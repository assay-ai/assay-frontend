import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuyerDebt } from "@/interfaces/buyer-debt";
import { ApiError } from "@/libs/ApiClient";
import { timelineStamp } from "@/features/g30/receipt-collection";
import { formatLocalDateTime } from "@/libs/local-time";

import {
  callPaymentNote,
  debtBannerDescription,
  debtBannerTitle,
  deadlineCountdown,
  debtDeadline,
  closeAccountHeldText,
  debtLocalTime,
  debtOutstandingContext,
  debtRefusalSentence,
  debtRowText,
  debtSentence,
  debtsToSign,
  escrowHeldText,
  heldCallsText,
  heldSegmentLabel,
  isReplaceable,
  nextReplaceableAt,
  notYetReplaceableSentence,
  notYetSettleSentence,
  settledToast,
  settleDebtErrorSentence,
  withdrawAllHeldReason,
  withdrawHeldText,
  splitDebts,
  uncollectedNotWithheld,
} from "./debt-copy";

const ASSET = "eip155:46630/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3";
const ACCOUNT = "eip155:46630:0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1";

function debt(overrides: Partial<BuyerDebt> = {}): BuyerDebt {
  return {
    intentId: "int_1",
    payer: ACCOUNT,
    amount: { amount: "2500000", asset: ASSET, decimals: 6 },
    providerId: "prv_1",
    toolId: "price_quote",
    cause: "DelegateIsRevoked",
    state: "OPEN",
    lapsedAt: "2026-10-16T00:00:00.000Z",
    writeOffAt: "2026-11-15T00:00:00.000Z",
    replacedAt: null,
    createdAt: "2026-10-15T23:59:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T00:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("the debt banner", () => {
  it("says in plain words what happened, what it blocks and the write-off date", () => {
    expect(debtBannerDescription([debt()])).toBe(
      "A call your agent made could not be collected from your escrow (the agent key that signed it was revoked). " +
        "Paid calls are paused until you settle it. Free calls still work. " +
        "If not settled by Nov 15, 00:00 UTC (in 29 days), it is written off: you still owe it, and the provider is paid only once you settle. " +
        "Paid calls stay paused until you do.",
    );
  });

  it("says a written-off debt still pauses paid calls, and that settling it pays the provider", () => {
    const text = debtBannerDescription([debt({ state: "WRITTEN_OFF", writeOffAt: "2026-10-01T00:00:00.000Z" })]);
    expect(text).toContain("written off on Oct 1, 00:00 UTC");
    expect(text).toContain("the provider was not paid");
    expect(text).toContain("Paid calls stay paused until you settle it, and settling it pays the provider.");
    expect(debtBannerTitle([debt({ state: "WRITTEN_OFF" })])).toMatch(/^Settle .*\$2\.50 your agent owes/);
  });

  it("says a signed debt is being collected, with nothing to do", () => {
    const replacing = debt({ state: "REPLACING", replacedAt: "2026-10-16T00:05:00.000Z" });
    expect(debtBannerDescription([replacing])).toBe(
      "You signed the payment for a call your agent made, and it is being collected from your escrow " +
        "(about a minute). Paid calls resume once it is collected. Free calls still work.",
    );
    expect(debtBannerTitle([replacing])).toBe("Collecting the payment you signed");
    expect(debtBannerTitle([replacing, replacing])).toBe("Collecting 2 payments you signed");
    expect(debtBannerDescription([replacing, replacing])).toMatch(/^You signed the payments for 2 calls/);
  });

  it("counts the states of several debts, and dates only the open ones", () => {
    const text = debtBannerDescription([
      debt({ state: "WRITTEN_OFF", writeOffAt: "2026-10-01T00:00:00.000Z" }),
      debt({ intentId: "int_2", state: "REPLACING" }),
      debt({ intentId: "int_3" }),
    ]);
    expect(text).toMatch(/^3 calls your agents made could not be collected/);
    expect(text).toContain("1 was written off: its provider was not paid, and settling it pays the provider.");
    expect(text).toContain("1 is signed and being collected.");
    expect(text).toContain("If the open one is not settled by Nov 15, 00:00 UTC (in 29 days)");
    expect(text).not.toContain("Oct 1,");
    expect(
      debtBannerTitle([debt(), debt({ state: "REPLACING" }), debt({ state: "WRITTEN_OFF" })]),
    ).toBe("Settle 2 payments your agents owe");
  });

  it("marks a row's state, and nothing for an open one", () => {
    expect(debtRowText(debt())).not.toMatch(/written off|being collected/);
    expect(debtRowText(debt({ state: "WRITTEN_OFF" }))).toMatch(/ · written off$/);
    expect(debtRowText(debt({ state: "REPLACING" }))).toMatch(/ · signed, being collected$/);
  });

  it("words a written-off row's prefixed cause like the open row's, and names the tool (R17b-B-02)", () => {
    const toolId = "06399979-f8b8-4c9e-a9b1-bd2a5924d442";
    const writtenOff = debt({
      toolId,
      state: "WRITTEN_OFF",
      cause: "uncollected:VerdictPastRedemptionDeadline",
    });
    const open = debt({ toolId, cause: "VerdictPastRedemptionDeadline" });
    const nameOf = (id: string) => (id === toolId ? "price_quote" : id);
    expect(debtRowText(writtenOff, nameOf)).toMatch(
      / · price_quote · the check finished after the payment voucher expired · written off$/,
    );
    expect(debtRowText(writtenOff, nameOf)).not.toContain("uncollected:");
    expect(debtRowText(open, nameOf).split(" · ")[2]).toBe(debtRowText(writtenOff, nameOf).split(" · ")[2]);
    // No catalogue name: a short id, never the full uuid.
    expect(debtRowText(writtenOff)).toContain(" · 06399979… · ");
    expect(debtRowText(writtenOff)).not.toContain(toolId);
  });

  it("strips every recorded-cause prefix before wording the cause", () => {
    for (const prefix of ["uncollected:", "buyer_debt:", "provider_forfeit:", "voided:"]) {
      expect(debtSentence({ ...debt(), cause: `${prefix}DelegateIsRevoked` })).toContain(
        "(the agent key that signed it was revoked)",
      );
    }
  });

  it("leaves a signed debt out of the ones to sign, and reads a missing state as open", () => {
    const legacy = { ...debt({ intentId: "int_4" }), state: undefined } as unknown as BuyerDebt;
    const toSign = debtsToSign([debt({ state: "REPLACING" }), debt({ intentId: "int_2", state: "WRITTEN_OFF" }), legacy]);
    expect(toSign.map((d) => d.intentId)).toEqual(["int_2", "int_4"]);
  });

  it("says paid calls resume only once the signed payment is collected", () => {
    expect(settledToast(0)).toMatch(/paid calls resume once it is\.$/);
    expect(settledToast(2)).toBe("Signed. 2 more calls are still to settle before paid calls resume.");
  });

  it("falls back to the raw cause, and says when none was recorded", () => {
    expect(debtBannerDescription([debt({ cause: "SomethingNew" })])).toContain("(SomethingNew)");
    expect(debtBannerDescription([debt({ cause: null })])).toContain("(the reason was not recorded)");
  });

  it("counts several debts and names the earliest write-off", () => {
    const text = debtBannerDescription([
      debt(),
      debt({ intentId: "int_2", writeOffAt: "2026-11-01T00:00:00.000Z" }),
    ]);
    expect(text).toMatch(/^2 calls your agents made/);
    expect(text).toContain("Paid calls are paused until every one is settled.");
    expect(text).toContain("If the earliest is not settled by Nov 1, 00:00 UTC (in 15 days)");
    expect(debtBannerTitle([debt(), debt()])).toBe("Settle 2 payments your agents owe");
  });

  it("titles one debt with its amount", () => {
    expect(debtBannerTitle([debt()])).toMatch(/^Settle .*\$2\.50 your agent owes for a call$/);
  });

  it("prints the deadline in UTC, with the time, the UTC label and a countdown", () => {
    expect(debtDeadline("2026-11-16T02:00:00.000Z")).toBe("Nov 16, 02:00 UTC (in 30 days)");
    expect(debtDeadline("2026-10-17T05:30:00.000Z")).toBe("today 05:30 UTC (in 5h 30m)");
    expect(debtDeadline("2026-10-01T00:00:00.000Z")).toBe("Oct 1, 00:00 UTC");
    expect(deadlineCountdown("2026-10-01T00:00:00.000Z")).toBeNull();
  });

  it("names the day the way the receipt timeline does (the banner leaves out the seconds)", () => {
    for (const iso of ["2026-09-15T08:40:00.000Z", "2026-10-17T05:30:00.000Z"]) {
      const banner = debtDeadline(iso);
      const timeline = timelineStamp(iso).time;
      // "Sep 15, 08:40" in both; "today 05:30" mid-sentence in the banner, "Today 05:30:00" on the timeline.
      expect(timeline.toLowerCase().startsWith(banner.split(" UTC")[0]!.toLowerCase())).toBe(true);
    }
    expect(formatLocalDateTime("2026-10-17T05:30:00.000Z", { alwaysDay: true })).toBe("Today 05:30");
  });
});

describe("splitDebts", () => {
  it("settles only the session account's own debts", () => {
    const other = debt({ intentId: "int_9", payer: "eip155:46630:0x2222222222222222222222222222222222222222" });
    const { own, others } = splitDebts({ account: ACCOUNT.toLowerCase(), debts: [debt(), other] });
    expect(own.map((d) => d.intentId)).toEqual(["int_1"]);
    expect(others.map((d) => d.intentId)).toEqual(["int_9"]);
    expect(splitDebts(undefined)).toEqual({ own: [], others: [] });
  });
});

describe("the debt refusals", () => {
  const outstanding = new ApiError("PAYMENT_DEBT_OUTSTANDING", "raw", 402, "/x", {
    count: 1,
    owed: "2.50 USDG",
    debts: [debt()],
    settleWith: "GET /escrow/debts, then POST /escrow/debts/{intentId}/voucher",
  });

  it("reads the PAYMENT_DEBT_OUTSTANDING context", () => {
    const ctx = debtOutstandingContext(outstanding);
    expect(ctx?.count).toBe(1);
    expect(ctx?.owed).toBe("2.50 USDG");
    expect(ctx?.debts).toHaveLength(1);
    expect(debtOutstandingContext(new ApiError("OTHER", "x", 400))).toBeNull();
  });

  it("words both codes, and nothing else", () => {
    expect(debtRefusalSentence(outstanding)).toMatch(/^Paid calls are paused: your escrow owes for a call .*\(2\.50 USDG\)/);
    expect(debtRefusalSentence(outstanding)).toContain("Free calls still work");
    expect(debtRefusalSentence(new ApiError("PAYMENT_DEBT_NOT_FOUND", "x", 404))).toMatch(
      /cannot settle this call.*another agent's call/,
    );
    expect(debtRefusalSentence(new ApiError("PAYMENT_DEBT_REPLACEMENT_PENDING", "x", 409))).toMatch(
      /signed already .* being collected/,
    );
    expect(debtRefusalSentence(new ApiError("OTHER", "x", 400))).toBeNull();
  });
});

describe("when a debt can be settled", () => {
  const now = Date.parse("2026-10-17T10:00:00.000Z");

  it("waits for replaceableAt, and settles at once without one", () => {
    expect(isReplaceable(debt({ replaceableAt: "2026-10-17T10:30:00.000Z" }), now)).toBe(false);
    expect(isReplaceable(debt({ replaceableAt: "2026-10-17T10:00:00.000Z" }), now)).toBe(true);
    expect(isReplaceable(debt({ replaceableAt: "2026-10-17T09:00:00.000Z" }), now)).toBe(true);
    expect(isReplaceable(debt({ replaceableAt: null }), now)).toBe(true);
    expect(isReplaceable(debt(), now)).toBe(true);
    expect(isReplaceable(debt({ replaceableAt: "not a time" }), now)).toBe(true);
  });

  it("finds the earliest time still ahead", () => {
    expect(nextReplaceableAt([debt()], now)).toBeNull();
    expect(
      nextReplaceableAt(
        [
          debt({ replaceableAt: "2026-10-17T09:00:00.000Z" }),
          debt({ replaceableAt: "2026-10-17T11:00:00.000Z" }),
          debt({ replaceableAt: "2026-10-17T10:20:00.000Z" }),
        ],
        now,
      ),
    ).toBe(Date.parse("2026-10-17T10:20:00.000Z"));
  });

  it("says from when, in local time, and why", () => {
    const at = "2026-10-17T10:30:00.000Z";
    expect(notYetReplaceableSentence(at)).toBe(
      `You can settle this from ${debtLocalTime(at)} (the original payment must expire on chain first, ` +
        "so you never pay twice).",
    );
    expect(notYetReplaceableSentence(at, "it")).toMatch(/^you can settle it from /);
    expect(notYetReplaceableSentence(null)).toMatch(/^You can settle this in a few minutes \(/);
    expect(debtLocalTime(at)).toMatch(/\d{2}:\d{2}/);
    expect(debtLocalTime("soon")).toBe("soon");
  });
});

describe("the settle refusals", () => {
  const err = (code: string, status: number, context?: Record<string, unknown>) =>
    new ApiError(code, "raw", status, "/escrow/debts/int_1/voucher", context);

  it("says from when a debt can be settled, and that nothing was signed", () => {
    const at = "2026-10-17T10:30:00.000Z";
    expect(settleDebtErrorSentence(err("PAYMENT_DEBT_NOT_YET_REPLACEABLE", 409, { replaceableAt: at }))).toBe(
      `${notYetReplaceableSentence(at)} Nothing was signed.`,
    );
    expect(settleDebtErrorSentence(err("PAYMENT_DEBT_NOT_YET_REPLACEABLE", 409))).toMatch(/in a few minutes/);
    expect(settleDebtErrorSentence(err("PAYMENT_DEBT_REPLACEMENT_REFUSED", 409))).toBe(
      "This call changed while you were signing, so the payment was not accepted and nothing was charged. Try again.",
    );
    // Only the settle routes reword them: not the client-wide debt sentence.
    expect(debtRefusalSentence(err("PAYMENT_DEBT_NOT_YET_REPLACEABLE", 409))).toBeNull();
  });

  it("words each refusal the settle routes answer", () => {
    expect(settleDebtErrorSentence(err("PAYMENT_DEBT_REPLACEMENT_PENDING", 409))).toMatch(/being collected/);
    expect(settleDebtErrorSentence(err("PAYMENT_DEBT_NOT_FOUND", 404))).toMatch(/another agent's call/);
    expect(settleDebtErrorSentence(err("PAYMENT_NEXT_SEQ_RATE_LIMITED", 429))).toMatch(/^Too many signing attempts/);
    expect(settleDebtErrorSentence(err("PAYMENT_VOUCHER_ADMISSION_PAUSED", 503, { retryAfter: 30 }))).toMatch(
      /paused for a moment .*\(about 30 s\)\. Try again shortly/,
    );
    expect(settleDebtErrorSentence(err("PAYMENT_VOUCHER_ADMISSION_PAUSED", 503))).not.toContain("about");
    for (const code of ["PAYMENT_VOUCHER_ESCROW_LIMIT_EXCEEDED", "PAYMENT_VOUCHER_DELEGATE_LIMIT_EXCEEDED"]) {
      expect(settleDebtErrorSentence(err(code, 409))).toMatch(/spending limit for the period is used up/);
    }
    expect(settleDebtErrorSentence(err("PAYMENT_VOUCHER_SEQ_ALREADY_USED", 409))).toMatch(/Sign to settle again/);
    expect(settleDebtErrorSentence(err("LEDGER_INSUFFICIENT_AVAILABLE_BALANCE", 409))).toMatch(/does not hold enough/);
    expect(settleDebtErrorSentence(err("PAYMENT_VOUCHER_BINDING_MISMATCH", 400, { field: "resource" }))).toMatch(
      /no longer exists/,
    );
  });

  it("keeps the error's own message for anything else", () => {
    expect(settleDebtErrorSentence(err("PAYMENT_VOUCHER_BINDING_MISMATCH", 400, { field: "amount" }))).toBeNull();
    expect(settleDebtErrorSentence(err("OTHER", 400))).toBeNull();
  });
});

describe("call payment notes", () => {
  it("names a debt or a forfeit on a call row, and nothing for an ordinary call", () => {
    expect(callPaymentNote({ debt: "OUTSTANDING" })).toBe("Payment not collected · settle to resume paid calls");
    expect(callPaymentNote({ debt: "WRITTEN_OFF" })).toBe("Written off · still owed to resume paid calls");
    expect(callPaymentNote({ debt: "VOIDED" })).toBe("Debt cancelled by a late verdict · not charged");
    expect(callPaymentNote({ forfeited: true })).toBe("Not charged · provider forfeited");
    expect(callPaymentNote({ forfeited: false, debt: null })).toBeNull();
  });

  it("does not count a forfeited, written-off or voided call as withheld", () => {
    expect(uncollectedNotWithheld({ forfeited: true })).toBe(true);
    expect(uncollectedNotWithheld({ debt: "WRITTEN_OFF" })).toBe(true);
    expect(uncollectedNotWithheld({ debt: "VOIDED" })).toBe(true);
    expect(uncollectedNotWithheld({ debt: "OUTSTANDING" })).toBe(false);
    expect(uncollectedNotWithheld({})).toBe(false);
  });
});

describe("heldCallsText", () => {
  const owed = new Set(["d1"]);
  it("keeps the in-flight wording when nothing is owed", () => {
    expect(heldCallsText(["a", "b"], new Set())).toBe("2 calls in flight — returns within 24h");
    expect(heldCallsText([], new Set())).toBe("0 calls in flight — returns within 24h");
  });
  it("does not call a held debt a call in flight", () => {
    expect(heldCallsText(["d1"], owed)).toBe("1 unpaid call — held until it is collected");
    expect(heldCallsText(["a", "d1"], owed)).toBe(
      "1 call in flight — returns within 24h · 1 unpaid call — held until it is collected",
    );
    expect(heldCallsText(["a", "d1"], owed, { short: true })).toBe("1 call in flight · 1 unpaid");
  });
});

describe("notYetSettleSentence (review P3-1)", () => {
  const now = Date.parse("2026-10-17T07:00:00.000Z");
  it("gives the time in UTC with its label and a countdown", () => {
    expect(notYetSettleSentence("2026-10-17T07:12:00.000Z", { now })).toBe(
      "You can settle this from today 07:12 UTC (in 12m): the original payment must expire on chain first, so you never pay twice.",
    );
    expect(
      notYetSettleSentence("2026-10-17T07:12:00.000Z", { now, subject: "the first", midSentence: true }),
    ).toMatch(/^you can settle the first from today 07:12 UTC \(in 12m\):/);
    expect(notYetSettleSentence(null)).toMatch(/^You can settle this in a few minutes:/);
    expect(notYetSettleSentence("soon")).toMatch(/in a few minutes/);
  });
});

describe("Funding's held line (main d021840 / 49210cf in the redesign)", () => {
  const owed = new Set(["d1", "d2"]);
  it("keeps the calls-being-checked wording when nothing is owed", () => {
    expect(escrowHeldText("$1.00", ["a"], new Set())).toBe(
      "$1.00 more is held by calls being checked; it comes back or goes to providers within minutes",
    );
    expect(heldSegmentLabel(["a"], new Set())).toBe("Held by calls being checked");
  });
  it("never calls a held debt a call in flight, and says it is held until collected", () => {
    expect(escrowHeldText("$2.50", ["d1"], owed)).toBe(
      "$2.50 more is held for 1 unpaid call, held until it is collected (see the banner)",
    );
    expect(escrowHeldText("$5.00", ["a", "d1", "d2"], owed)).toBe(
      "$5.00 more is held: 1 call being checked (it comes back or goes to providers within minutes) and 2 unpaid calls, held until they are collected",
    );
    expect(heldSegmentLabel(["d1"], owed)).toBe("Held for unpaid calls");
    expect(heldSegmentLabel(["a", "d1"], owed)).toBe("Held by calls being checked and unpaid calls");
  });
  it("Withdraw: a debt hold is held until collected and says to settle it; checking holds keep their wording", () => {
    expect(withdrawHeldText("$1.00", ["a"], new Set())).toEqual({
      text: "$1.00 is held by calls being checked; it comes back or goes to providers within minutes.",
      owed: 0,
    });
    expect(withdrawHeldText("$2.50", ["d1"], owed)).toEqual({
      text: "$2.50 is held for 1 unpaid call, held until its payment is collected. Settle it to free that money.",
      owed: 1,
    });
    expect(withdrawHeldText("$5.00", ["a", "d1", "d2"], owed).text).toBe(
      "$5.00 is held: 1 call being checked (it comes back or goes to providers within minutes) and 2 unpaid calls, held until their payments are collected. Settle them to free that money.",
    );
    expect(withdrawAllHeldReason(["a"], new Set())).toBe(
      "Everything in your escrow is held by calls being checked. Try again in a few minutes.",
    );
    expect(withdrawAllHeldReason(["d1"], owed)).toBe(
      "Everything in your escrow is held for 1 unpaid call, held until its payment is collected. Settle it first, then withdraw what is left.",
    );
    expect(withdrawAllHeldReason(["a", "d1"], owed)).not.toMatch(/few minutes/);
  });
  it("Close account: calls being checked come back within 24 hours; unpaid calls wait to be settled", () => {
    expect(closeAccountHeldText(["a", "b"], new Set())).toEqual({
      checking: "2 calls are still being checked. Their held money is charged or comes back within 24 hours; then withdraw it too.",
      unpaid: null,
    });
    expect(closeAccountHeldText(["d1"], owed)).toEqual({
      checking: null,
      unpaid: "1 unpaid call keeps its price held until it is collected: settle it, then withdraw what is left.",
    });
  });
});
