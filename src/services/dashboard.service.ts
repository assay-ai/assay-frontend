import type { CursorPage } from "@/interfaces";

import { withDemoChain } from "@/libs/chains/demo-chains";

import { api } from "./api";
import type { BalancesResponse } from "./balances.service";
import type { ToolCall } from "./tool-calls.service";

/** `[from, to)`, ISO-8601 UTC. */
export interface OverviewWindow {
  from: string;
  to: string;
}

/**
 * `GET /overview` — the Overview screen in one request.
 *
 * Every part is exactly what its own route answers for the same window (the
 * backend asserts it against the old routes), so the screen reads each part
 * with the code it read the old route with. The shapes the screen does not
 * type itself stay `unknown` here, as they are in their own services.
 */
export interface OverviewResponse {
  at: string;
  windows: {
    month: OverviewWindow;
    today: OverviewWindow;
    yesterday: OverviewWindow;
    /** Seven UTC days ending today, oldest first. */
    days: Array<OverviewWindow & { key: string }>;
  };
  balances: BalancesResponse;
  /** `GET /holds`. */
  holds: CursorPage<unknown>;
  /** `GET /withheld?from=month.from&to=month.to`. */
  withheld: unknown;
  /** `GET /receipts/summary`, the month grouped by day. */
  monthSummary: unknown;
  /** `GET /receipts/summary`, today grouped by tool. */
  todaySummary: unknown;
  /** `GET /receipts/summary`, yesterday grouped by tool. */
  yesterdaySummary: unknown;
  /** `GET /receipts/summary/daily`: one summary grouped by tool per day of `windows.days`. */
  chart: { days: Array<OverviewWindow & { key: string; summary: unknown }> };
  /** `GET /tool-calls?limit=callsLimit&sort=createdAt&order=desc`. */
  recentCalls: CursorPage<ToolCall>;
  /** The FIRST page of `GET /notifications?limit=alertsLimit&unreadOnly=true`. */
  notifications: CursorPage<unknown>;
}

export interface OverviewQuery {
  /** The anchor the windows are computed from (`anchor.toISOString()`). */
  at: string;
  /** Sent only for a buyer who holds more than one asset, like `getReceiptsSummary`. */
  asset?: string;
  callsLimit?: number;
  alertsLimit?: number;
}

export async function getOverview(query: OverviewQuery): Promise<OverviewResponse> {
  const response = await api.get<OverviewResponse>("/overview", query as unknown as Record<string, unknown>);
  // The same no-op-unless-demo naming `getBalances` applies to its rows.
  return { ...response, balances: { ...response.balances, balances: withDemoChain(response.balances?.balances ?? []) } };
}
