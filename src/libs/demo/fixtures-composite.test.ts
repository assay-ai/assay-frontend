import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { demoResponse } from "./demo-api";

const get = (path: string, query?: Record<string, unknown>) => demoResponse("GET", path, query) as Record<string, unknown>;

describe("the demo's composite reads, made of its single-route answers", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEMO_CHAINS", "robinhood"));
  afterEach(() => vi.unstubAllEnvs());

  it("GET /me/status: the unread count and the debts as their own routes answer them, and no block", () => {
    const status = get("/me/status");
    expect(status.unreadCount).toEqual(get("/notifications/unread-count"));
    expect(status.debts).toEqual(get("/escrow/debts"));
    expect(status.blockStatus).toEqual({ blocked: false, blocks: [] });
  });

  it("GET /overview: every part is its route's answer for the windows of `at`", () => {
    const at = "2026-10-20T12:00:00.000Z";
    const overview = get("/overview", { at, callsLimit: 6, alertsLimit: 50 }) as {
      windows: { month: { from: string; to: string }; today: { from: string; to: string }; days: { key: string }[] };
      chart: { days: { key: string; summary: unknown }[] };
      [part: string]: unknown;
    };
    expect(overview.windows.month).toEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" });
    expect(overview.windows.today).toEqual({ from: "2026-10-20T00:00:00.000Z", to: "2026-10-21T00:00:00.000Z" });
    expect(overview.windows.days.map((d) => d.key)).toEqual([
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
    ]);
    expect(overview.balances).toEqual(get("/balances"));
    expect(overview.recentCalls).toEqual(get("/tool-calls", { limit: 6, sort: "createdAt", order: "desc" }));
    expect(overview.notifications).toEqual(get("/notifications", { limit: 50, unreadOnly: true }));
    expect(overview.todaySummary).toEqual(get("/receipts/summary", { ...overview.windows.today, groupBy: "tool" }));
    expect(overview.chart.days[6]!.summary).toEqual(
      get("/receipts/summary", { from: "2026-10-20T00:00:00.000Z", to: "2026-10-21T00:00:00.000Z", groupBy: "tool" }),
    );
  });

  it("GET /agents?include=: each agent with its credentials route's keys and their health; plain /agents unchanged", () => {
    const plain = get("/agents") as { items: { agentId: string }[] };
    const page = get("/agents", { include: "credentials,health" }) as {
      items: { agentId: string; credentials: { items: unknown[]; hasMore: boolean }; health: { unrevokedKeyCount: number } }[];
    };
    expect(page.items.map((a) => a.agentId)).toEqual(plain.items.map((a) => a.agentId));
    expect(plain.items.every((a) => !("credentials" in a))).toBe(true);
    for (const agent of page.items) {
      const own = get(`/agents/${agent.agentId}/credentials`, { limit: 50 }) as { items: { revokedAt: string | null }[] };
      expect(agent.credentials).toEqual({ items: own.items, hasMore: false });
      expect(agent.health.unrevokedKeyCount).toBe(own.items.filter((k) => !k.revokedAt).length);
    }
  });
});
