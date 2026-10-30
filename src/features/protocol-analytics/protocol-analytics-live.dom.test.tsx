// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProtocolAnalyticsResponse } from "@/services/protocol-analytics.service";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/services/protocol-analytics.service", () => ({
  getProtocolAnalytics: read,
}));
import { ProtocolAnalytics } from "./protocol-analytics";

const asset = {
  id: "asset",
  chainId: "eip155:46630",
  chainName: "Robinhood Chain testnet",
  symbol: "USDG",
  decimals: 6,
};
const figures = {
  paidCalls: 2,
  payingAgents: 1,
  toolsEarning: 1,
  collectedCalls: 1,
  refundedCalls: 1,
  pendingCalls: 0,
  volume: "2000000",
  revenue: "100000",
  providerEarnings: "900000",
  refunded: "1000000",
  pending: "0",
  notCharged: "0",
  passRate: 0.5,
};
function response(): ProtocolAnalyticsResponse {
  return {
    state: "OK",
    generatedAt: "2026-10-29T12:00:00Z",
    cacheTtlMs: 300000,
    assets: [asset],
    asset,
    range: "30d",
    window: {
      from: "2026-09-30T00:00:00Z",
      to: "2026-10-29T12:00:00Z",
      chartFrom: "2026-09-30T00:00:00Z",
    },
    totals: figures,
    previous: null,
    daily: [
      {
        ...figures,
        day: "2026-10-29",
        agentsSinceLaunch: 1,
        toolsSinceLaunch: 1,
      },
    ],
    topTools: [],
    recent: [],
    escrow: { available: "0", held: "0" },
    withheldForPrivacy: false,
  };
}
let client: QueryClient;
function show() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProtocolAnalytics />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  read.mockReset();
  read.mockResolvedValue(response());
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.useRealTimers();
});

describe("protocol analytics live data", () => {
  it("explains withheld table groups while retaining the protocol totals", async () => {
    read.mockResolvedValue({ ...response(), withheldForPrivacy: true });
    show();
    await screen.findAllByText("0.10 USDG");
    for (const title of ["Top tools", "Latest payments"]) {
      const table = screen.getByRole("table", { name: title });
      expect(within(table).getByText(/No groups are eligible for public display/).textContent)
        .toContain("at least five buyer organizations");
      expect(within(table).queryByText("No data available.")).toBeNull();
    }
  });

  it("renders ledger amounts and real zero balances", async () => {
    show();
    await screen.findAllByText("0.10 USDG");
    expect(
      within(
        screen.getByRole("region", { name: "Headline figures" }),
      ).getByText("2.00 USDG"),
    ).toBeDefined();
    expect(screen.getAllByText("0.00 USDG")).toHaveLength(4);
    expect(
      screen.queryByText(/internal|unclassified|classification/i),
    ).toBeNull();
    expect(screen.getByRole("img", { name: "Revenue per day" })).toBeDefined();
  });

  it("hides cached figures when refresh fails instead of showing them as current zeros", async () => {
    show();
    await screen.findAllByText("0.10 USDG");
    read.mockRejectedValue(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("alert");
    expect(
      within(
        screen.getByRole("region", { name: "Headline figures" }),
      ).getAllByText("—"),
    ).toHaveLength(6);
    expect(screen.queryAllByText("0.10 USDG")).toHaveLength(0);
  });

  it("does not carry figures from the previous time range while the next range loads", async () => {
    show();
    await screen.findAllByText("0.10 USDG");
    read.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(screen.getByRole("radio", { name: "7D" }));
    expect(
      within(
        screen.getByRole("region", { name: "Headline figures" }),
      ).getAllByText("—"),
    ).toHaveLength(6);
    await waitFor(() => expect(read).toHaveBeenLastCalledWith("7d", undefined));
  });

  it("reuses the five-minute client cache and polls after expiry", async () => {
    vi.useFakeTimers();
    show();
    await vi.advanceTimersByTimeAsync(10);
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("0.10 USDG").length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(299000);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1010);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("omits empty UTC days while retaining zero-revenue days with paid activity", async () => {
    const data = response();
    const active = data.daily[0];
    data.daily = [
      { ...active, day: "2026-10-01", paidCalls: 0, payingAgents: 0 },
      { ...active, day: "2026-10-27", revenue: "0" },
      { ...active, day: "2026-10-28", paidCalls: 0, payingAgents: 0 },
      active,
    ];
    read.mockResolvedValue(data);
    show();
    await screen.findAllByText("0.10 USDG");
    const chart = screen.getByRole("group", { name: "Revenue per day details" });
    const labels = within(chart).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["2026-10-27: 0 USDG", "2026-10-29: 0.1 USDG"]);
    const adoption = screen.getByRole("group", { name: "Agents since launch details" });
    expect(within(adoption).getAllByRole("button")).toHaveLength(2);
  });
});
