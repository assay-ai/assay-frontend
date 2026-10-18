import { afterEach, describe, expect, it, vi } from "vitest";

import { isReplaceable } from "@/features/buyer-debt/debt-copy";

import { demoResponse } from "./demo-api";
import { DEMO_FIXTURES } from "./fixtures";
import { demoDebt, demoDebts, resetDemoAgentLabels, resetDemoNotificationsRead } from "./fixtures-buyer";
import { demoOfferPriceMinor } from "./fixtures-explore";

describe("the demo buyer debt", () => {
  it("can be signed now: its replaceableAt is in the past", () => {
    const debt = demoDebt();
    expect(debt.replaceableAt).toBeTruthy();
    expect(Date.parse(debt.replaceableAt)).toBeLessThan(Date.now());
    expect(isReplaceable(debt, Date.now())).toBe(true);
    expect(DEMO_FIXTURES.some((fixture) => fixture.match === "/escrow/debts")).toBe(true);
  });
});

describe("the demo buyer's prices", () => {
  it("are the catalogue's prices for the same tool at the same provider", () => {
    const prev = process.env.NEXT_PUBLIC_DEMO_CHAINS;
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
    try {
      const { items } = demoResponse("GET", "/tool-calls", {
        from: new Date(Date.now() - 60 * 86_400_000).toISOString(),
        to: new Date(Date.now() + 60_000).toISOString(),
      }) as { items: { toolId: string; providerId: string; price: { amount: string } }[] };
      expect(new Set(items.map((item) => item.toolId)).size).toBe(5);
      for (const item of items) {
        expect(item.price.amount, item.toolId).toBe(demoOfferPriceMinor(item.toolId, item.providerId));
      }
    } finally {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = prev;
    }
  });

  afterEach(() => vi.unstubAllGlobals());

  it("price every demo debt, in every ?debt= picture, as the catalogue prices its tool", () => {
    for (const picture of ["open", "many", "other-wallet", "short", "waiting-mixed"]) {
      const store = new Map<string, string>();
      vi.stubGlobal("window", {
        location: { search: `?debt=${picture}` },
        sessionStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => void store.set(key, value),
          removeItem: (key: string) => void store.delete(key),
        },
      });
      const debts = demoDebts();
      expect(debts.length, picture).toBeGreaterThan(0);
      for (const debt of debts) {
        expect(debt.amount.amount, `${picture} ${debt.toolId}`).toBe(demoOfferPriceMinor(debt.toolId, debt.providerId));
      }
    }
  });
});

describe("the demo /withheld split", () => {
  it("puts the voided search_web call under provider or platform error", () => {
    const prev = process.env.NEXT_PUBLIC_DEMO_CHAINS;
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
    try {
      const body = demoResponse("GET", "/withheld", {}) as {
        withheld: { withheld: { amount: { amount: string }; buckets: { bucket: string; calls: number; amount: { amount: string } }[] } }[];
      };
      const { amount, buckets } = body.withheld[0]!.withheld;
      expect(amount.amount).toBe("1213200");
      expect(buckets.map((b) => [b.bucket, b.calls, b.amount.amount])).toEqual([
        ["FAILED_VERIFICATION", 2, "1201200"],
        ["PROVIDER_OR_PLATFORM_ERROR", 1, "12000"],
        ["NOT_COLLECTED", 0, "0"],
      ]);
    } finally {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = prev;
    }
  });

  it("agrees with /receipts/summary's not charged for the same window", () => {
    const prev = process.env.NEXT_PUBLIC_DEMO_CHAINS;
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
    try {
      const now = Date.now();
      for (const days of [1, 7, 30, 60]) {
        const window = {
          from: new Date(now - days * 86_400_000).toISOString(),
          to: new Date(now + 60_000).toISOString(),
        };
        const withheld = (
          demoResponse("GET", "/withheld", window) as {
            withheld: { withheld: { calls: number; amount: { amount: string } } }[];
          }
        ).withheld[0]!.withheld;
        const { totals } = demoResponse("GET", "/receipts/summary", { ...window, groupBy: "day" }) as {
          totals: { notChargedTotal: { amount: string }; notChargedCalls: number };
        };
        expect(withheld.amount.amount, `${days} days`).toBe(totals.notChargedTotal.amount);
        expect(withheld.calls, `${days} days`).toBe(totals.notChargedCalls);
      }
    } finally {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = prev;
    }
  });
});

describe("the demo agent rename", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetDemoAgentLabels();
  });

  it("answers PATCH /agents/:id with the renamed agent, and GET /agents reads it back", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_CHAINS", "robinhood");
    const before = demoResponse("GET", "/agents") as { items: { agentId: string; label: string }[] };
    const first = before.items[0]!;

    const renamed = demoResponse("PATCH", `/agents/${first.agentId}`, {}, { label: "  Research bot  " }) as {
      agentId: string;
      label: string;
    };

    expect(renamed).toMatchObject({ agentId: first.agentId, label: "Research bot" });
    const after = demoResponse("GET", "/agents") as { items: { agentId: string; label: string }[] };
    expect(after.items.find((a) => a.agentId === first.agentId)?.label).toBe("Research bot");
  });

  it("refuses an agent that is not the account's, like the server", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_CHAINS", "robinhood");
    expect(() => demoResponse("PATCH", "/agents/00000000-0000-4000-8000-000000000000", {}, { label: "x" })).toThrow(/not found/i);
  });
});

describe("the demo's money results (B7)", () => {
  const withDemo = <T,>(body: () => T): T => {
    const prev = process.env.NEXT_PUBLIC_DEMO_CHAINS;
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
    try {
      return body();
    } finally {
      process.env.NEXT_PUBLIC_DEMO_CHAINS = prev;
    }
  };
  type M = { amount: string };
  const n = (m: M) => BigInt(m.amount);

  it("the escrow's lifetime counters add up to its balance", () => {
    withDemo(() => {
      const escrow = demoResponse("GET", "/escrow", {}) as { balance: M; lifetime: { deposited: M; spent: M; withdrawn: M } };
      expect(n(escrow.lifetime.deposited) - n(escrow.lifetime.spent) - n(escrow.lifetime.withdrawn)).toBe(n(escrow.balance));
    });
  });

  it("lists one cancelled withdrawal, which moved no money", () => {
    withDemo(() => {
      const { items } = demoResponse("GET", "/withdrawals", {}) as { items: { status: string; received: M | null }[] };
      expect(items.map((w) => w.status)).toEqual(["CANCELLED"]);
      expect(items[0]!.received).toBeNull();
    });
  });

  it("each month's statement adds up, months chain, and the current one matches the escrow", () => {
    withDemo(() => {
      const now = new Date();
      const month = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString();
      type Item = { opening: M; deposits: M; withdrawals: M; paid: M; closing: M; check: { matches: boolean } | null };
      const statement = (from: string, to: string) => (demoResponse("GET", "/statements/balance", { from, to }) as { items: Item[] }).items[0]!;
      const current = statement(month(0), month(1));
      const previous = statement(month(-1), month(0));
      for (const s of [current, previous]) {
        expect(n(s.opening) + n(s.deposits) - n(s.withdrawals) - n(s.paid)).toBe(n(s.closing));
      }
      expect(previous.closing.amount).toBe(current.opening.amount);
      expect(current.check?.matches).toBe(true);
      expect(previous.check).toBeNull();
    });
  });

  it("Still refundable lists exactly the calls whose receipt says a report now is refunded in full", () => {
    withDemo(() => {
      const { items } = demoResponse("GET", "/tool-calls", { refundable: "true" }) as {
        items: { intentId: string; refundableIfReportedUntil: string | null }[];
      };
      // Both ways: every call whose receipt promises a full refund is listed, and nothing else.
      const all = demoResponse("GET", "/tool-calls", { from: "2000-01-01T00:00:00Z", to: "2100-01-01T00:00:00Z" }) as { items: { intentId: string }[] };
      const promised = all.items
        .filter((call) => (demoResponse("GET", `/receipts/${call.intentId}`, {}) as { refundableIfReportedNow: boolean }).refundableIfReportedNow)
        .map((call) => call.intentId);
      expect(items.map((item) => item.intentId).sort()).toEqual(promised.sort());
      for (const item of items) {
        const receipt = demoResponse("GET", `/receipts/${item.intentId}`, {}) as { refundableIfReportedNow: boolean; refundableIfReportedUntil: string | null };
        expect(receipt.refundableIfReportedNow).toBe(true);
        expect(item.refundableIfReportedUntil).toBe(receipt.refundableIfReportedUntil);
      }
    });
  });
});

describe("the demo's alerts (B8)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetDemoNotificationsRead();
  });

  it("keeps a dismissed alert read: the unread-only list and the badge drop it", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_CHAINS", "robinhood");
    const unreadIds = () =>
      (demoResponse("GET", "/notifications", { unreadOnly: true }) as { items: { id: string }[] }).items.map((n) => n.id);
    const count = () => (demoResponse("GET", "/notifications/unread-count") as { count: number }).count;
    expect(unreadIds()).toContain("ntf_4c17");
    const before = count();

    const read = demoResponse("PATCH", "/notifications/ntf_4c17/read") as { id: string; readAt: string | null };
    expect(read).toMatchObject({ id: "ntf_4c17" });
    expect(read.readAt).not.toBeNull();
    expect(unreadIds()).not.toContain("ntf_4c17");
    expect(count()).toBe(before - 1);

    demoResponse("POST", "/notifications/read-all");
    expect(unreadIds()).not.toContain("ntf_8b30");
    expect(count()).toBe(0);
  });
});
