import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settleEscrowCheck } from "@/features/buyer-debt/debt-summary";
import type { BuyerDebt } from "@/interfaces/buyer-debt";

import { demoResponse } from "./demo-api";

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
    expect(check.blocks[0]!.action.label).toBe("Add $1.50");
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
    type Totals = { calls: number; owedCalls: number; chargedTotal: { amount: string } };
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
    // Its own day still has it, owed.
    const madeAt = Date.parse(debts[0]!.createdAt);
    const madeDay = Date.UTC(new Date(madeAt).getUTCFullYear(), new Date(madeAt).getUTCMonth(), new Date(madeAt).getUTCDate());
    expect(summary(madeDay, madeDay + day).owedCalls).toBe(1);
  });
});
