import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { heldSegmentLabel } from "@/features/buyer-debt/debt-copy";
import { chargedCallsFromTotals } from "@/features/g30/spend-buckets";
import { debtBannerSummary, owedChangeRow, settleEscrowCheck } from "@/features/buyer-debt/debt-summary";
import type { BuyerDebt } from "@/interfaces/buyer-debt";

import { demoResponse } from "./demo-api";
import { DEMO_NOW_MS } from "./demo-clock";
import { DEMO_BUYER_ACCOUNT } from "./fixtures";

/*
  Review 2026-10-17: the settle sheet's escrow check never showed in the demo
  (the escrow fixture's money had no asset, so it matched no debt), there was
  no picture where settling is blocked, and a written-off debt read as written
  off before its call was made.
*/
const prevFlag = process.env.NEXT_PUBLIC_DEMO_CHAINS;

function tabAt(search: string) {
  const store = new Map<string, string>();
  return {
    location: { search },
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
});
afterEach(() => {
  process.env.NEXT_PUBLIC_DEMO_CHAINS = prevFlag;
  vi.unstubAllGlobals();
});

function sheetCheck() {
  const escrow = demoResponse("GET", "/escrow") as Parameters<typeof settleEscrowCheck>[0]["data"];
  const { debts } = demoResponse("GET", "/escrow/debts") as { debts: BuyerDebt[] };
  return { check: settleEscrowCheck({ data: escrow, isError: false, isPending: false }, debts), debts };
}

describe("demo debt pictures and the settle sheet's escrow check", () => {
  it("shows the passed checks for the default open debt", () => {
    vi.stubGlobal("window", tabAt(""));
    const { check } = sheetCheck();
    expect(check.kind).toBe("ok");
  });

  it("?debt=short blocks settling with Add funds and Raise the per-call ceiling", () => {
    vi.stubGlobal("window", tabAt("?debt=short"));
    const { check, debts } = sheetCheck();
    expect(debts[0]!.state).toBe("WRITTEN_OFF");
    expect(check.kind).toBe("blocked");
    if (check.kind !== "blocked") return;
    expect(check.blocks.map((block) => block.kind)).toEqual(["funds", "per-call"]);
    expect(check.blocks[0]!.action.label).toBe("Add $0.20");
  });

  it("?debt=unread makes the sheet say the escrow could not be read", () => {
    vi.stubGlobal("window", tabAt("?debt=unread"));
    expect(sheetCheck().check).toEqual({ kind: "unread" });
  });

  it("writes a debt off 30 days after its payment lapsed, never before the call", () => {
    vi.stubGlobal("window", tabAt("?debt=written-off"));
    const { debts } = sheetCheck();
    const debt = debts[0]!;
    expect(Date.parse(debt.writeOffAt)).toBeGreaterThan(Date.parse(debt.createdAt));
    expect(Date.parse(debt.writeOffAt) - Date.parse(debt.lapsedAt)).toBe(30 * 86_400_000);
    // The receipt carries the same (older) call time as the debt.
    const receipt = demoResponse("GET", `/tool-calls/${debt.intentId}`) as { createdAt: string };
    expect(receipt.createdAt).toBe(debt.createdAt);
  });

  it("?debt=written-off counts the owed call on the day it was made, not in today's figures", () => {
    type Totals = {
      calls: number;
      owedCalls: number;
      notChargedCalls?: number;
      inProgressCalls?: number;
      chargedTotal: { amount: string };
    };
    const summary = (from: number, to: number) =>
      (
        demoResponse("GET", "/receipts/summary", {
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          groupBy: "tool",
        }) as { totals: Totals }
      ).totals;
    const day = 86_400_000;
    const now = new Date();
    const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    vi.stubGlobal("window", tabAt("?debt=open"));
    const openToday = summary(utcToday, utcToday + day);
    expect(openToday.owedCalls).toBe(1);

    vi.stubGlobal("window", tabAt("?debt=written-off"));
    const { debts } = sheetCheck();
    const writtenOffToday = summary(utcToday, utcToday + day);
    // The same charged calls today, minus the owed one, which is not today's.
    expect(writtenOffToday.owedCalls).toBe(0);
    expect(writtenOffToday.calls).toBe(openToday.calls - 1);
    expect(writtenOffToday.chargedTotal).toEqual(openToday.chargedTotal);
    // "Spent today" counts the charged calls: the same count whether the owed call is today's or not.
    expect(chargedCallsFromTotals(openToday)).toBe(chargedCallsFromTotals(writtenOffToday));
    expect(chargedCallsFromTotals(openToday)).toBe(openToday.calls - 1 - (openToday.notChargedCalls ?? 0) - (openToday.inProgressCalls ?? 0));
    // Its own day still has it, owed.
    const madeAt = Date.parse(debts[0]!.createdAt);
    const madeDay = Date.UTC(new Date(madeAt).getUTCFullYear(), new Date(madeAt).getUTCMonth(), new Date(madeAt).getUTCDate());
    expect(summary(madeDay, madeDay + day).owedCalls).toBe(1);
  });

  it("?debt=waiting: one debt not ready for about 20 minutes, so Settle waits", () => {
    vi.stubGlobal("window", tabAt("?debt=waiting"));
    const { debts } = sheetCheck();
    expect(debts).toHaveLength(1);
    const at = Date.parse(debts[0]!.replaceableAt!);
    expect(at).toBeGreaterThan(Date.now());
    expect(at - Date.now()).toBeLessThanOrEqual(20 * 60_000);
    // On the demo clock's 20-minute grid, like the other demo times.
    expect((at - DEMO_NOW_MS) % (20 * 60_000)).toBe(0);
    const summary = debtBannerSummary({ account: DEMO_BUYER_ACCOUNT, debts })!;
    expect(summary.actionDisabled).toBe(true);
    expect(summary.waitingNote).toMatch(/^You can settle this from .+ \(in \d+m\):/);
  });

  it("?debt=waiting-mixed: one ready, one waiting; the sheet's You owe row keeps the waiting part", () => {
    vi.stubGlobal("window", tabAt("?debt=waiting-mixed"));
    const { debts } = sheetCheck();
    expect(debts).toHaveLength(2);
    const summary = debtBannerSummary({ account: DEMO_BUYER_ACCOUNT, debts })!;
    expect(summary.ready).toHaveLength(1);
    expect(summary.actionDisabled).toBe(false);
    expect(summary.actionLabel).toBe("Settle $1.20");
    expect(summary.title).toMatch(/^You owe \$2\.40 for 2 calls\./);
    expect(summary.waitingNote).toMatch(/^1 of them is not ready to sign yet: you can settle it from /);
    expect(owedChangeRow(summary.toSign, summary.ready)).toEqual({
      label: "You owe",
      before: "$2.40",
      after: "$1.20 after this signature",
    });
  });

  it("holds an open debt's price in the escrow, so Funding and Withdraw say it is held until collected", () => {
    type Holds = { items: { intentId: string; status: string }[] };
    type Escrow = { openHolds: { amount: string }; spendable: { amount: string }; balance: { amount: string } };
    for (const [search, held] of [
      ["?debt=open", "2417700"],
      ["?debt=waiting", "2417700"],
      ["?debt=collecting", "2417700"],
      ["?debt=waiting-mixed", "3617700"],
      ["?debt=written-off", "1217700"],
      ["?debt=other-wallet", "1217700"],
      ["?debt=none", "1217700"],
    ] as const) {
      vi.stubGlobal("window", tabAt(search));
      const escrow = demoResponse("GET", "/escrow") as Escrow;
      expect(escrow.openHolds.amount, search).toBe(held);
      expect(BigInt(escrow.spendable.amount) + BigInt(escrow.openHolds.amount)).toBe(BigInt(escrow.balance.amount));
      const holds = (demoResponse("GET", "/holds") as Holds).items.map((hold) => hold.intentId);
      const { debts } = demoResponse("GET", "/escrow/debts") as { debts: BuyerDebt[] };
      const owedIds = new Set(debts.map((debt) => debt.intentId));
      const label = heldSegmentLabel(holds, owedIds);
      if (held === "1217700") expect(label, search).toBe("Held by calls being checked");
      else expect(label, search).toBe("Held by calls being checked and unpaid calls");
      const balances = demoResponse("GET", "/balances") as { balances: { held: { amount: string } }[] };
      expect(balances.balances[0]!.held.amount, search).toBe(held);
    }
  });
});

describe("demo written-off debts share one date (final2 P3)", () => {
  it("dates the written-off debt the same in written-off, short and many", () => {
    const dates = ["?debt=written-off", "?debt=short", "?debt=many"].map((search) => {
      vi.stubGlobal("window", tabAt(search));
      const { debts } = demoResponse("GET", "/escrow/debts") as { debts: BuyerDebt[] };
      const off = debts.find((debt) => debt.state === "WRITTEN_OFF")!;
      vi.unstubAllGlobals();
      return [off.createdAt, off.writeOffAt];
    });
    expect(dates[1]).toEqual(dates[0]);
    expect(dates[2]).toEqual(dates[0]);
    expect(Date.parse(dates[0][0]!)).toBeLessThan(DEMO_NOW_MS - 30 * 86_400_000);
  });
});
