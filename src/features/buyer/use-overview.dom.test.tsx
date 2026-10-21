// @vitest-environment jsdom
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

const api = vi.hoisted(() => ({
  overview: vi.fn(),
  notifications: vi.fn(),
  resolveAsset: vi.fn(async (): Promise<string | undefined> => undefined),
  stored: null as string | null,
}));

vi.mock("@/services/dashboard.service", () => ({ getOverview: api.overview }));
vi.mock("@/services", () => ({ listNotifications: api.notifications }));
vi.mock("@/services/display-asset", async () => {
  const actual = await vi.importActual<typeof import("@/services/display-asset")>("@/services/display-asset");
  return { ...actual, resolveDisplayAsset: api.resolveAsset, storedDisplayAsset: () => api.stored };
});

import { OVERVIEW_REFRESH_MS, useOverview, type OverviewState } from "./use-overview";

const ASSET_A = "eip155:46630/erc20:0xaaaa";
const ASSET_B = "eip155:46630/erc20:0xbbbb";
const ANCHOR = new Date("2026-10-20T12:00:00.000Z");
const usd = (amount: string, asset = ASSET_A) => ({ amount, asset, decimals: 6 });
const page = <T,>(items: T[], nextCursor: string | null = null) => ({ items, pageInfo: { nextCursor, hasMore: nextCursor !== null } });

const totals = (charged: string) => ({
  calls: 1,
  refundedCalls: 0,
  listedTotal: usd(charged),
  chargedTotal: usd(charged),
  withheldTotal: usd("0"),
  notChargedTotal: usd("0"),
  notChargedCalls: 0,
  owedTotal: usd("0"),
  owedCalls: 0,
  inProgressTotal: usd("0"),
  inProgressCalls: 0,
  freeCalls: 0,
  failRate: 0,
});
const summary = (charged: string, groups: { key: string; chargedTotal: unknown }[] = []) => ({ groups, totals: totals(charged), asset: ASSET_A });
const alert = (id: string, title = id) => ({
  id,
  event: "spend.band",
  severity: "WARNING",
  title,
  body: "",
  readAt: null,
  createdAt: "2026-10-20T11:00:00.000Z",
});

function wire(overrides: Record<string, unknown> = {}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const from = new Date(Date.UTC(2026, 9, 14 + i)).toISOString();
    const to = new Date(Date.UTC(2026, 9, 15 + i)).toISOString();
    return { key: from.slice(0, 10), from, to, summary: summary("0", i === 6 ? [{ key: "tool-x", chargedTotal: usd("1500000") }] : []) };
  });
  return {
    at: ANCHOR.toISOString(),
    windows: {},
    balances: { balances: [{ chainId: "eip155:46630", accountId: "acct", asset: ASSET_A, decimals: 6, available: usd("5000000") }] },
    holds: page([{ id: "h1", intentId: "i1", amount: usd("1"), status: "OPEN", ageSeconds: 30 }]),
    withheld: { withheld: [] },
    monthSummary: summary("9000000"),
    todaySummary: summary("1500000"),
    yesterdaySummary: summary("1000000"),
    chart: { days },
    recentCalls: page([{ intentId: "c1" }]),
    notifications: page([alert("n1")]),
    ...overrides,
  };
}

let state: OverviewState | null = null;
function Probe({ assetKey = null }: { assetKey?: string | null }) {
  const overview = useOverview(ANCHOR, assetKey);
  React.useEffect(() => {
    state = overview;
  });
  return <span data-testid="loaded">{overview.data ? "yes" : "no"}</span>;
}

function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return { client, ...render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>) };
}

beforeEach(() => {
  api.overview.mockReset();
  api.notifications.mockReset();
  api.resolveAsset.mockReset();
  api.resolveAsset.mockResolvedValue(undefined);
  api.stored = null;
  state = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useOverview on GET /overview", () => {
  it("loads the whole screen from ONE request, with the windows of the page's anchor", async () => {
    api.overview.mockResolvedValue(wire());
    mount();
    await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("yes"));
    expect(api.overview).toHaveBeenCalledTimes(1);
    expect(api.overview).toHaveBeenCalledWith({ at: ANCHOR.toISOString(), callsLimit: 6, alertsLimit: 50 });
    expect(api.notifications).not.toHaveBeenCalled();

    const data = state!.data!;
    expect(data.month.label).toBe("October 2026");
    expect(data.balances).toHaveLength(1);
    expect(data.holds.map((h) => h.id)).toEqual(["h1"]);
    expect(data.todayCharged).toEqual(usd("1500000"));
    expect(data.yesterdayCharged).toEqual(usd("1000000"));
    expect(data.monthListed).toEqual(usd("9000000"));
    expect(data.chart.map((d) => d.key)).toEqual([
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
    ]);
    expect(data.chart[6]!.byTool).toEqual({ "tool-x": 1.5 });
    expect(data.chartTools).toEqual(["tool-x"]);
    expect(data.recentCalls).toEqual([{ intentId: "c1" }]);
    expect(data.notifications.map((n) => n.id)).toEqual(["n1"]);
    expect(data.notificationsComplete).toBe(true);
  });

  it("refreshes every 30 seconds with one request, and no second read of /balances for the asset", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.overview.mockResolvedValue(wire());
    mount();
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(1));
    expect(api.resolveAsset).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OVERVIEW_REFRESH_MS);
    });
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(2));
    // The refresh decides the asset from the balances the overview itself brought.
    expect(api.resolveAsset).toHaveBeenCalledTimes(1);
  });

  it("names the display asset for a buyer who holds two, from the last answer's balances", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.stored = ASSET_B;
    api.resolveAsset.mockResolvedValue(ASSET_B);
    const two = {
      balances: [
        { chainId: "eip155:46630", accountId: "a", asset: ASSET_A, decimals: 6, available: usd("1") },
        { chainId: "eip155:46630", accountId: "a", asset: ASSET_B, decimals: 6, available: usd("1", ASSET_B) },
      ],
    };
    api.overview.mockResolvedValue(wire({ balances: two }));
    mount();
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(1));
    expect(api.overview.mock.calls[0]![0]).toMatchObject({ asset: ASSET_B });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OVERVIEW_REFRESH_MS);
    });
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(2));
    expect(api.overview.mock.calls[1]![0]).toMatchObject({ asset: ASSET_B });
    expect(api.resolveAsset).toHaveBeenCalledTimes(1);
  });

  it("asks again with a freshly resolved asset when a second asset arrived since the last answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.overview.mockResolvedValueOnce(wire());
    mount();
    await waitFor(() => expect(state?.data).toBeTruthy());
    api.resolveAsset.mockResolvedValue(ASSET_B);
    api.overview
      .mockRejectedValueOnce(new ApiError("VERIFICATION_SUMMARY_MULTIPLE_ASSETS", "two assets", 422))
      .mockResolvedValueOnce(wire());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OVERVIEW_REFRESH_MS);
    });
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(3));
    expect(api.overview.mock.calls[1]![0]).not.toHaveProperty("asset");
    expect(api.overview.mock.calls[2]![0]).toMatchObject({ asset: ASSET_B });
    expect(state!.error).toBeNull();
  });

  it("keeps reading unread pages from the overview's cursor while Needs attention is not full", async () => {
    // Three copies of one alert are one row: the first page cannot fill Needs attention.
    const same = Array.from({ length: 3 }, (_, i) => ({ ...alert(`dup-${i}`, "Same alert") }));
    api.overview.mockResolvedValue(wire({ notifications: page(same, "c-2") }));
    api.notifications
      .mockResolvedValueOnce(page([alert("n2"), alert("n3")], "c-3"))
      .mockResolvedValueOnce(page([alert("n4"), alert("n5")]));
    mount();
    await waitFor(() => expect(state?.data).toBeTruthy());
    expect(api.notifications.mock.calls.map((c) => c[0])).toEqual([
      { limit: 50, unreadOnly: true, cursor: "c-2" },
      { limit: 50, unreadOnly: true, cursor: "c-3" },
    ]);
    expect(state!.data!.notifications.map((n) => n.id)).toEqual(["dup-0", "dup-1", "dup-2", "n2", "n3", "n4", "n5"]);
    expect(state!.data!.notificationsComplete).toBe(true);
  });

  it("stops at a full Needs attention and says the list was not read to its end", async () => {
    const five = ["a", "b", "c", "d", "e"].map((id) => alert(id));
    api.overview.mockResolvedValue(wire({ notifications: page(five, "c-2") }));
    mount();
    await waitFor(() => expect(state?.data).toBeTruthy());
    expect(api.notifications).not.toHaveBeenCalled();
    expect(state!.data!.notificationsComplete).toBe(false);
  });

  it("fails the whole load when the overview fails, as the batch did, and clears the error on a good refresh", async () => {
    api.overview.mockRejectedValueOnce(new ApiError("VERIFICATION_SUMMARY_MULTIPLE_ASSETS", "two assets", 422));
    mount();
    await waitFor(() => expect(state?.error?.code).toBe("VERIFICATION_SUMMARY_MULTIPLE_ASSETS"));
    expect(state!.data).toBeNull();
    expect(state!.loading).toBe(false);

    api.overview.mockResolvedValueOnce(wire());
    act(() => state!.reload());
    await waitFor(() => expect(state?.data).toBeTruthy());
    expect(state!.error).toBeNull();
  });

  it("fails the whole load when a further unread page fails", async () => {
    api.overview.mockResolvedValue(wire({ notifications: page([alert("x")], "c-2") }));
    api.notifications.mockRejectedValue(new ApiError("API_UNAVAILABLE", "down", 503));
    mount();
    await waitFor(() => expect(state?.error?.code).toBe("API_UNAVAILABLE"));
    expect(state!.data).toBeNull();
  });

  it("reads a non-API failure as UNKNOWN", async () => {
    api.overview.mockRejectedValue(new TypeError("boom"));
    mount();
    await waitFor(() => expect(state?.error?.code).toBe("UNKNOWN"));
  });

  it("reads Needs attention afresh after a sign-in as someone else, not capped by the last user's pages", async () => {
    // The first user's list ends on its first page, so their refreshes read one page.
    api.overview.mockResolvedValue(wire());
    const { client } = mount();
    await waitFor(() => expect(state?.data).toBeTruthy());
    // The next user's first page is not enough: their first load reads on.
    api.overview.mockResolvedValue(wire({ notifications: page([alert("x")], "c-2") }));
    api.notifications.mockResolvedValue(page([alert("y")]));
    await act(async () => {
      await client.resetQueries();
    });
    await waitFor(() => expect(state?.data?.notifications.map((n) => n.id)).toEqual(["x", "y"]));
    expect(api.notifications).toHaveBeenCalledTimes(1);
  });

  it("caps a refresh at the pages the last load needed", async () => {
    api.overview.mockResolvedValue(wire());
    const { client } = mount();
    await waitFor(() => expect(state?.data).toBeTruthy());
    api.overview.mockResolvedValue(wire({ notifications: page([alert("x")], "c-2") }));
    await act(async () => {
      await client.refetchQueries();
    });
    await waitFor(() => expect(state?.data?.notifications.map((n) => n.id)).toEqual(["x"]));
    expect(api.notifications).not.toHaveBeenCalled();
  });

  it("refetches when the tab comes back after the figures went stale", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.overview.mockResolvedValue(wire());
    mount();
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(1));
    // Hidden: the 30-second refresh does not run.
    focusManager.setFocused(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OVERVIEW_REFRESH_MS + 1_000);
    });
    expect(api.overview).toHaveBeenCalledTimes(1);
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(2));
    focusManager.setFocused(undefined);
  });

  it("starts empty after a sign-in as someone else: the cache reset drops the last user's overview", async () => {
    api.overview.mockResolvedValue(wire());
    const { client } = mount();
    await waitFor(() => expect(state?.data).toBeTruthy());
    api.overview.mockImplementation(() => new Promise(() => undefined));
    await act(async () => {
      void client.resetQueries();
    });
    await waitFor(() => expect(state?.data).toBeNull());
  });
});
