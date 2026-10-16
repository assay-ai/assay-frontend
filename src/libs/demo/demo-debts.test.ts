import { describe, expect, it } from "vitest";

import { demoDebtNote, demoDebtSigned, markDemoDebtsSigned, parseDebtVariant } from "./demo-debts";
import "./fixtures";
import { demoDebts } from "./fixtures-buyer";

describe("demo debt pictures", () => {
  it("reads only the known variants", () => {
    expect(parseDebtVariant("many")).toBe("many");
    expect(parseDebtVariant("written-off")).toBe("written-off");
    expect(parseDebtVariant("waiting")).toBe("waiting");
    expect(parseDebtVariant("waiting-mixed")).toBe("waiting-mixed");
    expect(parseDebtVariant("bogus")).toBeNull();
    expect(parseDebtVariant(null)).toBeNull();
  });

  it("says a kept picture is a demo one, only in a demo build and only off the default", () => {
    const prev = process.env.NEXT_PUBLIC_DEMO_CHAINS;
    try {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
      expect(demoDebtNote("many")).toBe(
        'Demo: the "many" debt picture (?debt=many) is kept for this tab. Add ?debt=open to any page to go back.',
      );
      expect(demoDebtNote("open")).toBeNull();
      process.env.NEXT_PUBLIC_DEMO_CHAINS = "";
      expect(demoDebtNote("many")).toBeNull();
    } finally {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = prev;
    }
  });

  it("serves one open debt by default, and shows a debt signed in the demo as being collected", () => {
    const [open] = demoDebts();
    expect(open.state).toBe("OPEN");
    markDemoDebtsSigned([open.intentId]);
    expect(demoDebtSigned(open.intentId)).toBe(true);
    const [after] = demoDebts();
    expect(after.state).toBe("REPLACING");
    expect(after.replacedAt).not.toBeNull();
  });
});

describe("demo totals agree with the demo debt", () => {
  it("reports the open debt as owed in the summary, not as charged", async () => {
    const { demoResponse } = await import("./demo-api");
    const prev = process.env.NEXT_PUBLIC_DEMO_CHAINS;
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
    try {
      const now = Date.now();
      const body = demoResponse("GET", "/receipts/summary", {
        from: new Date(now - 24 * 3600 * 1000).toISOString(),
        to: new Date(now).toISOString(),
        groupBy: "day",
      }) as { totals: { owedTotal: { amount: string }; owedCalls: number } };
      expect(body.totals.owedCalls).toBe(1);
      expect(body.totals.owedTotal.amount).toBe("1200000");
    } finally {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = prev;
    }
  });

  it("counts Overview's UTC today and yesterday as one demo day each", async () => {
    const { demoResponse } = await import("./demo-api");
    const { utcDayBounds } = await import("@/libs/utc-time");
    const prev = process.env.NEXT_PUBLIC_DEMO_CHAINS;
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
    try {
      const totals = (window: { from: string; to: string }) =>
        (
          demoResponse("GET", "/receipts/summary", { ...window, groupBy: "tool" }) as {
            totals: { calls: number; chargedTotal: { amount: string } };
          }
        ).totals;
      const now = Date.now();
      const today = utcDayBounds(now);
      const yesterday = utcDayBounds(now, { offsetDays: -1 });
      const both = totals({ from: yesterday.from, to: today.to });
      expect(totals(today).calls + totals(yesterday).calls).toBe(both.calls);
      expect(today.from).toBe(yesterday.to);
    } finally {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = prev;
    }
  });
});
