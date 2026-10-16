import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuyerDebt } from "@/interfaces/buyer-debt";
import { ApiError } from "@/libs/ApiClient";

import {
  balanceAfterSettling,
  debtBlocksPaidCalls,
  resumeSheetCopy,
  debtBannerSummary,
  debtDeadlineLine,
  debtTotal,
  earliestWriteOff,
  owedCallState,
  owedCallsFromDebts,
  owedRowText,
  paidCallsAfterSettling,
  resumesAfterSettling,
  settleBlockedSummary,
  settleNextSteps,
  settleEscrowCheck,
  settleReadiness,
  type SettleEscrowReading,
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
      "Settle by Nov 15, 00:00 UTC (in 29 days). After that it is written off: you still owe it, and the provider is paid only once you settle. Free calls still work.",
    );
    expect(summary.actionLabel).toBe("Settle $2.50");
    expect(summary.toSign.map((d) => d.intentId)).toEqual(["int_1"]);
  });

  it("names the earliest deadline among several open debts", () => {
    const summary = debtBannerSummary({
      account: ACCOUNT,
      debts: [debt({ writeOffAt: "2026-11-20T00:00:00.000Z" }), debt({ intentId: "int_2", writeOffAt: "2026-11-10T00:00:00.000Z" })],
    })!;
    expect(summary.detail).toContain("Settle by Nov 10, 00:00 UTC (in 24 days). After that it is written off: you still owe it, and the providers are paid only once you settle");
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
    // The headline names the other wallet's part, so it agrees with "Details (2 calls)" (?debt=many).
    expect(summary.title).toBe(
      "You owe $2.50 for 1 call, plus $2.50 owed by another wallet of your organization. Paid calls are paused until all of it is settled.",
    );
    expect(summary.detail).toContain("Sign in with that wallet to settle its 1 call.");
  });

  it("on a free-calls-only chain, says settling pays for an earlier paid call from the escrow", () => {
    const summary = debtBannerSummary({ account: ACCOUNT, debts: [debt()] }, { freeOnly: true })!;
    expect(summary.detail).toContain("settling pays for an earlier paid call: it is taken from your escrow");
    expect(debtBannerSummary({ account: ACCOUNT, debts: [debt()] })!.detail).not.toContain("free calls only");
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

  it("never promises a restart over the person's own Pause all while collecting", () => {
    const summary = debtBannerSummary({ account: ACCOUNT, debts: [debt({ state: "REPLACING" })] }, { pausedByYou: true })!;
    expect(summary.kind).toBe("collecting");
    expect(summary.title).toContain("stay paused by you");
    expect(summary.title).not.toContain("resume");
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
      after: { amount: "7500000", asset: ASSET, decimals: 6 },
      shortBy: null,
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

const usd = (dollars: string) => ({ amount: String(Math.round(Number(dollars) * 1_000_000)), asset: ASSET, decimals: 6 });

const escrow = (overrides: Partial<SettleEscrowReading> = {}): SettleEscrowReading => ({
  chainReadable: true,
  balance: usd("10"),
  spendable: usd("7.5"),
  maxVoucherAmount: usd("5"),
  maxPerWindow: usd("20"),
  spentInWindow: usd("1"),
  windowStartedAt: "2026-10-16T12:00:00.000Z",
  windowSeconds: 86_400,
  ...overrides,
});

describe("settleReadiness (P1-3)", () => {
  it("never floors the balance after to zero: a short escrow is a shortfall", () => {
    expect(balanceAfterSettling(usd("1"), [debt()])).toEqual({ after: null, shortBy: usd("1.5") });
  });

  it("lets an open debt draw on its own hold, so a fully held debt is fine", () => {
    expect(settleReadiness(escrow({ spendable: usd("0") }), [debt()])).toEqual([]);
  });

  it("asks for exactly the missing amount when a written-off debt's funds are gone", () => {
    const [block] = settleReadiness(escrow({ spendable: usd("1") }), [debt({ state: "WRITTEN_OFF" })]);
    expect(block.kind).toBe("funds");
    expect(block.text).toContain("Your escrow can pay $1.00 of the $2.50 owed. Add $1.50 first");
    expect(block.action).toEqual({ label: "Add $1.50", href: "/funding?action=deposit" });
  });

  it("asks to raise the per-call ceiling to the largest payment", () => {
    const [block] = settleReadiness(escrow({ maxVoucherAmount: usd("1") }), [debt()]);
    expect(block.kind).toBe("per-call");
    expect(block.action.label).toBe("Raise the per-call ceiling to $2.50");
    // The ceiling sheet opens prefilled with the amount needed (verify-r12 P3).
    expect(block.action.href).toBe("/funding?action=caps&perCall=2.5");
    expect(block.missing).toBe("a per-call ceiling of $2.50 (now $1.00)");
  });

  it("asks to raise the 24-hour ceiling when the window has no room left", () => {
    const [block] = settleReadiness(escrow({ maxPerWindow: usd("2"), spentInWindow: usd("1") }), [debt()]);
    expect(block.kind).toBe("window");
    expect(block.text).toContain("Only $1.00 of your 24-hour ceiling is left");
    expect(block.action.label).toBe("Raise the 24-hour ceiling to $3.50");
    expect(block.action.href).toBe("/funding?action=caps&perDay=3.5");
  });

  it("counts an ended window as unspent", () => {
    const old = escrow({ maxPerWindow: usd("3"), spentInWindow: usd("2"), windowStartedAt: "2026-10-10T00:00:00.000Z" });
    expect(settleReadiness(old, [debt()])).toEqual([]);
  });

  it("checks nothing when the escrow could not be read", () => {
    expect(settleReadiness(escrow({ chainReadable: false, spendable: usd("0") }), [debt({ state: "WRITTEN_OFF" })])).toEqual([]);
    expect(settleReadiness(null, [debt()])).toEqual([]);
  });
});

describe("settleEscrowCheck (review 2026-10-17 P2-a)", () => {
  const now = Date.parse("2026-10-16T18:00:00.000Z");
  const read = (data: SettleEscrowReading | null, more: { isError?: boolean; isPending?: boolean } = {}) => ({
    data,
    isError: more.isError ?? false,
    isPending: more.isPending ?? false,
  });

  it("shows each check that passed, with the amounts", () => {
    const check = settleEscrowCheck(read(escrow()), [debt()], now);
    expect(check).toEqual({
      kind: "ok",
      rows: [
        { label: "Escrow balance", value: "$10.00: enough for $2.50" },
        { label: "Per-call ceiling", value: "$5.00: each payment fits" },
        { label: "24-hour ceiling", value: "$19.00 of $20.00 left: enough" },
      ],
    });
  });

  it("blocks with the way out when the escrow cannot pay", () => {
    const check = settleEscrowCheck(
      read(escrow({ balance: usd("1"), spendable: usd("1"), maxVoucherAmount: usd("2") })),
      [debt({ state: "WRITTEN_OFF" })],
      now,
    );
    expect(check.kind).toBe("blocked");
    if (check.kind !== "blocked") return;
    expect(check.blocks.map((block) => block.action.label)).toEqual(["Add $1.50", "Raise the per-call ceiling to $2.50"]);
  });

  it("says it could not read the escrow when the query failed, the chain did not answer, or the asset differs", () => {
    expect(settleEscrowCheck(read(null, { isError: true }), [debt()], now)).toEqual({ kind: "unread" });
    expect(settleEscrowCheck(read(escrow({ chainReadable: false })), [debt()], now)).toEqual({ kind: "unread" });
    const otherAsset = { ...usd("10"), asset: "eip155:1/erc20:0x0" };
    expect(settleEscrowCheck(read(escrow({ balance: otherAsset })), [debt()], now)).toEqual({ kind: "unread" });
    expect(settleEscrowCheck(read(escrow({ balance: null })), [debt()], now)).toEqual({ kind: "unread" });
  });

  it("is pending only while the first read is on its way", () => {
    expect(settleEscrowCheck(read(null, { isPending: true }), [debt()], now)).toEqual({ kind: "pending" });
  });
});

describe("settleBlockedSummary (verify-r12 P3)", () => {
  it("says what is owed and what is missing, never the outcome", () => {
    const blocks = settleReadiness(escrow({ balance: usd("1"), spendable: usd("1"), maxVoucherAmount: usd("2") }), [
      debt({ state: "WRITTEN_OFF" }),
    ]);
    const rows = settleBlockedSummary([debt({ state: "WRITTEN_OFF" })], blocks);
    expect(rows).toEqual([
      { label: "You owe", value: "$2.50, still owed: nothing is signed yet" },
      { label: "Missing", value: "$1.50 in your escrow; a per-call ceiling of $2.50 (now $2.00)" },
    ]);
    const text = rows.map((row) => row.value).join(" ");
    expect(text).not.toContain("$0.00");
    expect(text).not.toContain("about a minute");
  });

  it("is empty when nothing blocks signing", () => {
    expect(settleBlockedSummary([debt()], [])).toEqual([]);
  });
});

describe("settleNextSteps (verify-r13 P3)", () => {
  it("numbers the way to signing: add funds, raise the ceiling, then sign, each fix with its link", () => {
    const blocks = settleReadiness(escrow({ balance: usd("1"), spendable: usd("1"), maxVoucherAmount: usd("2") }), [
      debt({ state: "WRITTEN_OFF" }),
    ]);
    const steps = settleNextSteps(blocks);
    expect(steps.map((step) => step.title)).toEqual([
      "Add funds",
      "Raise the per-call ceiling",
      "Come back here and sign",
    ]);
    expect(steps[0]!.action).toEqual(blocks[0]!.action);
    expect(steps[0]!.action!.label).toBe("Add $1.50");
    expect(steps[1]!.action).toEqual(blocks[1]!.action);
    expect(steps[2]!.action).toBeNull();
    expect(steps[2]!.text).toBe("Paid calls stay paused until it is settled.");
  });

  it("is empty when nothing blocks signing", () => {
    expect(settleNextSteps([])).toEqual([]);
  });
});

describe("paidCallsAfterSettling (P2-5)", () => {
  it("promises a resume only when nothing else stops paid calls", () => {
    expect(paidCallsAfterSettling({ resumes: true, pausedByYou: false, blocked: false }).short).toBe("Resume in about a minute");
    expect(paidCallsAfterSettling({ resumes: true, pausedByYou: true, blocked: false }).sentence).toContain(
      "you paused all paid calls: Resume in the banner",
    );
    expect(paidCallsAfterSettling({ resumes: true, pausedByYou: false, blocked: true }).short).toBe(
      "Still refused (account blocked)",
    );
    expect(paidCallsAfterSettling({ resumes: false, pausedByYou: false, blocked: false }).short).toBe(
      "Still paused (more is owed)",
    );
  });
});

describe("deadlines on owed rows, receipts and summaries (P2-2, P2-4, P3-3)", () => {
  const data = { account: ACCOUNT, debts: [debt(), debt({ intentId: "int_2", state: "WRITTEN_OFF" })] };

  it("says settle-by on an open debt and the write-off on a written-off one", () => {
    expect(debtDeadlineLine(debt())).toBe("Settle by Nov 15, 00:00 UTC (in 29 days); after that it is written off, but still owed.");
    expect(debtDeadlineLine(debt({ state: "WRITTEN_OFF", writeOffAt: "2026-10-01T00:00:00.000Z" }))).toBe(
      "Written off on Oct 1, 00:00 UTC, but still owed: settling still pays the provider.",
    );
    expect(debtDeadlineLine(debt({ state: "REPLACING" }))).toBeNull();
  });

  it("finds the earliest open write-off", () => {
    expect(earliestWriteOff({ account: ACCOUNT, debts: [debt(), debt({ intentId: "x", writeOffAt: "2026-11-01T00:00:00.000Z" })] })).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(earliestWriteOff(undefined)).toBeNull();
  });

  it("puts the deadline on an owed row, and says written off when it is", () => {
    expect(owedRowText(owedCallState(data, "int_1"))).toBe(
      "Payment not collected · paid calls paused · settle by Nov 15, 00:00 UTC (in 29 days).",
    );
    expect(owedRowText(owedCallState(data, "int_2"))).toMatch(/^Written off, still owed · paid calls paused/);
  });

  it("does not claim paid calls are paused when the debts list cannot say", () => {
    const unknown = owedCallState(undefined, "int_1");
    expect(owedRowText(unknown, { pending: true })).toBe("Payment not collected · checking what is owed…");
    expect(owedRowText(unknown)).toBe("Payment not collected · open the receipt for details.");
    expect(owedRowText(unknown, { callDebt: "WRITTEN_OFF" })).toBe("Written off · open the receipt for details.");
    expect(owedRowText(unknown)).not.toMatch(/paused/);
  });
});

describe("owedCallsFromDebts (P2-6)", () => {
  it("lists every owed call from the debts list, newest first, any wallet, by tool", () => {
    const data = {
      account: ACCOUNT,
      debts: [
        debt({ intentId: "a", createdAt: "2026-10-01T00:00:00.000Z" }),
        debt({ intentId: "b", createdAt: "2026-10-10T00:00:00.000Z", payer: OTHER, toolId: "other_tool" }),
        debt({ intentId: "c", createdAt: "2026-10-05T00:00:00.000Z", state: "REPLACING" }),
      ],
    };
    expect(owedCallsFromDebts(data)?.map((d) => d.intentId)).toEqual(["b", "c", "a"]);
    expect(owedCallsFromDebts(data, "price_quote")?.map((d) => d.intentId)).toEqual(["c", "a"]);
    expect(owedCallsFromDebts(undefined)).toBeNull();
  });
});

describe("the Resume sheet while a debt is owed (buyer retest 2026-10-17)", () => {
  it("does not promise paid calls while a debt still needs a signature", () => {
    const owed = { account: ACCOUNT, debts: [debt()] };
    expect(debtBlocksPaidCalls(owed)).toBe(true);
    expect(debtBlocksPaidCalls({ account: ACCOUNT, debts: [debt({ payer: OTHER })] })).toBe(true);
    const copy = resumeSheetCopy(true);
    expect(copy.description).toContain("Paid calls stay blocked until the payment owed is settled");
    expect(copy.after).toBe("Blocked until the debt is settled");
    expect(copy.description).not.toContain("can pay for calls again");
  });

  it("says Running when nothing is owed or the payment is only being collected", () => {
    expect(debtBlocksPaidCalls({ account: ACCOUNT, debts: [] })).toBe(false);
    expect(debtBlocksPaidCalls({ account: ACCOUNT, debts: [debt({ state: "REPLACING" })] })).toBe(false);
    expect(debtBlocksPaidCalls(undefined)).toBe(false);
    expect(resumeSheetCopy(false).after).toBe("Running");
  });
});
