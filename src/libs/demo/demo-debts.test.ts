import { describe, expect, it } from "vitest";

import { demoDebtSigned, markDemoDebtsSigned, parseDebtVariant } from "./demo-debts";
import "./fixtures";
import { demoDebts } from "./fixtures-buyer";

describe("demo debt pictures", () => {
  it("reads only the known variants", () => {
    expect(parseDebtVariant("many")).toBe("many");
    expect(parseDebtVariant("written-off")).toBe("written-off");
    expect(parseDebtVariant("bogus")).toBeNull();
    expect(parseDebtVariant(null)).toBeNull();
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
      expect(body.totals.owedTotal.amount).toBe("2500000");
    } finally {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = prev;
    }
  });

  it("counts a reader's calendar day as one demo day, not the two UTC days it straddles", async () => {
    const { demoResponse } = await import("./demo-api");
    const prev = process.env.NEXT_PUBLIC_DEMO_CHAINS;
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
    try {
      const now = new Date();
      const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const totals = (from: number, to: number) =>
        (
          demoResponse("GET", "/receipts/summary", {
            from: new Date(from).toISOString(),
            to: new Date(to).toISOString(),
            groupBy: "tool",
          }) as { totals: { calls: number; chargedTotal: { amount: string } } }
        ).totals;
      const day = 86_400_000;
      const hour = 3_600_000;
      // The reader's today and yesterday, in a zone east and one west of Greenwich.
      for (const offset of [7, -5]) {
        const zoneToday = Math.floor((now.getTime() + offset * hour) / day) * day - offset * hour;
        expect(totals(zoneToday, zoneToday + day)).toEqual(totals(utcToday, utcToday + day));
        expect(totals(zoneToday - day, zoneToday)).toEqual(totals(utcToday - day, utcToday));
      }
    } finally {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = prev;
    }
  });
});
