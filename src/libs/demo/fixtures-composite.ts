import { monthPeriod, recentDays } from "@/features/buyer/period";
import { utcDayBounds } from "@/libs/utc-time";

import { demoAgentsWithKeys } from "./demo-agent-health";
import type { DemoFixture } from "./fixtures";

/**
 * DEMO ONLY. The composite reads (`GET /overview`, `GET /me/status`, `GET
 * /agents?include=`) built from the demo's own single-route fixtures, so every
 * part is exactly what that route's fixture answers — the same rule the API
 * keeps for the real routes. `answer` reads one of those fixtures.
 */
type Answer = (path: string, query?: Record<string, unknown>) => unknown;

/** A part that has no fixture is `null`, as a part the API could not read. */
function part(answer: Answer, path: string, query?: Record<string, unknown>): unknown {
  return answer(path, query) ?? null;
}

export function compositeFixtures(answer: Answer): DemoFixture[] {
  return [
    {
      method: "GET",
      match: "/me/status",
      body: () => ({
        // The demo account is not blocked.
        blockStatus: answer("/account/block-status") ?? { blocked: false, blocks: [] },
        unreadCount: part(answer, "/notifications/unread-count"),
        debts: part(answer, "/escrow/debts"),
      }),
    },
    {
      method: "GET",
      match: "/overview",
      body: (_path, query) => {
        const at = new Date(typeof query.at === "string" ? query.at : Date.now());
        const asset = typeof query.asset === "string" ? { asset: query.asset } : {};
        const month = monthPeriod(at);
        const today = utcDayBounds(at);
        const yesterday = utcDayBounds(at, { offsetDays: -1 });
        const days = recentDays(at, 7).map((day) => ({ key: day.key, from: day.from, to: day.to }));
        const summary = (window: { from: string; to: string }, groupBy: string) =>
          answer("/receipts/summary", { ...window, groupBy, ...asset });
        return {
          at: at.toISOString(),
          windows: { month: { from: month.from, to: month.to }, today, yesterday, days },
          balances: answer("/balances"),
          holds: answer("/holds"),
          withheld: answer("/withheld", { from: month.from, to: month.to }),
          monthSummary: summary(month, "day"),
          todaySummary: summary(today, "tool"),
          yesterdaySummary: summary(yesterday, "tool"),
          chart: { days: days.map((day) => ({ ...day, summary: summary(day, "tool") })) },
          recentCalls: answer("/tool-calls", { limit: Number(query.callsLimit ?? 6), sort: "createdAt", order: "desc" }),
          notifications: answer("/notifications", { limit: Number(query.alertsLimit ?? 50), unreadOnly: true }),
        };
      },
    },
    {
      method: "GET",
      match: "/agents",
      body: (_path, query) => {
        const page = answer("/agents", query) as { items: { agentId: string }[]; pageInfo?: unknown };
        if (!query.include) return page;
        const keys = Object.fromEntries(
          page.items.map((agent) => [
            agent.agentId,
            (answer(`/agents/${agent.agentId}/credentials`, { limit: 50 }) as { items: unknown[] }).items,
          ]),
        );
        return { ...demoAgentsWithKeys(page, keys), pageInfo: page.pageInfo };
      },
    },
  ];
}
