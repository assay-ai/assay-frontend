// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

const api = vi.hoisted(() => ({
  balances: vi.fn(),
  list: vi.fn(),
  one: vi.fn(),
}));

vi.mock("@/services", () => ({ getBalances: api.balances }));
vi.mock("@/services/funding.service", () => ({ listDeposits: api.list, getDeposit: api.one }));

import { useBalancesQuery } from "@/components/buyer-money/use-buyer-money";
import { OVERVIEW_KEY } from "@/features/buyer/use-overview";
import { ME_STATUS_KEY } from "@/features/me-status/keys";

import { CONFIRMING_POLL_MS } from "./confirming";
import { depositStillPending } from "./deposit-finality";

const ASSET = "eip155:46630/erc20:0xaaaa";
const usd = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });
const row = (pending: string) => ({
  chainId: "eip155:46630",
  accountId: "acct",
  asset: ASSET,
  decimals: 6,
  available: usd("1000000"),
  held: usd("0"),
  pending: usd(pending),
  pendingDeposits: usd("0"),
});
const confirmingBalances = { balances: [row("5000000")] };
const settledBalances = { balances: [row("0")] };

const FUTURE = "2099-01-01T00:00:00.000Z";
const deposit = (id: string, status: string, finality: string | null | undefined) => ({
  id,
  status,
  statusReason: null,
  agentId: "a",
  agentAccount: "acct",
  requestedAmount: usd("5000000"),
  settledAmount: null,
  chainId: "eip155:46630",
  chainTxRef: null,
  expiresAt: FUTURE,
  createdAt: "2026-10-20T00:00:00.000Z",
  ...(finality === undefined ? {} : { finality }),
});
const page = (items: unknown[]) => ({ items, pageInfo: { nextCursor: null, hasMore: false } });

function Probe() {
  const balances = useBalancesQuery();
  return <span>{balances.data ? "loaded" : "loading"}</span>;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Probe />
      <Probe />
    </QueryClientProvider>,
  );
  return client;
}

async function tick(ms = CONFIRMING_POLL_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.balances.mockReset();
  api.list.mockReset();
  api.one.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("waiting for a deposit to be final", () => {
  it("polls GET /deposits/:id, never /balances, and reads /balances once when it is CONFIRMED", async () => {
    api.balances.mockResolvedValueOnce(confirmingBalances).mockResolvedValue(settledBalances);
    api.list.mockResolvedValue(page([deposit("d1", "SETTLED", "PENDING"), deposit("old", "SETTLED", "CONFIRMED")]));
    api.one.mockResolvedValue(deposit("d1", "SETTLED", "PENDING"));
    const client = mount();
    client.setQueryData(ME_STATUS_KEY, { blockStatus: null, unreadCount: null, debts: null });
    client.setQueryData([...OVERVIEW_KEY, "x"], {});
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    expect(api.list).toHaveBeenCalledWith({ status: ["CREATED", "SETTLING", "SETTLED"], limit: 50 });

    await tick();
    await tick();
    await waitFor(() => expect(api.one).toHaveBeenCalledTimes(2));
    expect(api.one).toHaveBeenCalledWith("d1");
    // Still PENDING: "still confirming" stays, and /balances is not read again.
    expect(api.balances).toHaveBeenCalledTimes(1);

    api.one.mockResolvedValue(deposit("d1", "SETTLED", "CONFIRMED"));
    await tick();
    await waitFor(() => expect(api.balances).toHaveBeenCalledTimes(2));
    expect(client.getQueryState(ME_STATUS_KEY)?.isInvalidated).toBe(true);
    expect(client.getQueryState([...OVERVIEW_KEY, "x"])?.isInvalidated).toBe(true);

    // Settled: nothing is polled any more.
    const calls = api.one.mock.calls.length + api.list.mock.calls.length;
    await tick();
    await tick();
    expect(api.one.mock.calls.length + api.list.mock.calls.length).toBe(calls);
    expect(api.balances).toHaveBeenCalledTimes(2);
  });

  it("waits on several deposits at once and reads /balances when each one is decided", async () => {
    api.balances.mockResolvedValue(confirmingBalances);
    api.list.mockResolvedValue(page([deposit("d1", "SETTLED", "PENDING"), deposit("d2", "SETTLING", null)]));
    api.one.mockImplementation(async (id: string) =>
      id === "d1" ? deposit("d1", "SETTLED", "REJECTED") : deposit("d2", "SETTLING", null),
    );
    mount();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    await tick();
    await waitFor(() => expect(api.one.mock.calls.map((c) => c[0]).sort()).toEqual(["d1", "d2"]));
    // d1 was rejected: the balances are read once, d2 is still awaited.
    await waitFor(() => expect(api.balances).toHaveBeenCalledTimes(2));
    await tick();
    await waitFor(() => expect(api.one.mock.calls.slice(2).map((c) => c[0])).toEqual(["d2"]));
    expect(api.balances).toHaveBeenCalledTimes(2);

    api.one.mockResolvedValue(deposit("d2", "FAILED", null));
    await tick();
    await waitFor(() => expect(api.balances).toHaveBeenCalledTimes(3));
  });

  it("falls back to the old /balances poll against an API without finality", async () => {
    api.balances.mockResolvedValue(confirmingBalances);
    api.list.mockResolvedValue(page([deposit("d1", "SETTLED", undefined)]));
    mount();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    const before = api.balances.mock.calls.length;
    await tick();
    await tick();
    await waitFor(() => expect(api.balances.mock.calls.length).toBeGreaterThanOrEqual(before + 2));
    expect(api.one).not.toHaveBeenCalled();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("when nothing is pending although the balances say confirming, reads /balances at most every 30 s", async () => {
    api.balances.mockResolvedValue(confirmingBalances);
    api.list.mockResolvedValue(page([]));
    mount();
    await waitFor(() => expect(api.balances).toHaveBeenCalledTimes(2));
    for (let i = 0; i < 5; i += 1) await tick();
    expect(api.balances).toHaveBeenCalledTimes(2);
  });

  it("drops a deposit that is gone (404) instead of failing every tick", async () => {
    api.balances.mockResolvedValueOnce(confirmingBalances).mockResolvedValue(settledBalances);
    api.list.mockResolvedValue(page([deposit("d1", "SETTLED", "PENDING")]));
    api.one.mockRejectedValue(new ApiError("PAYMENT_DEPOSIT_NOT_FOUND", "not found", 404));
    mount();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    await tick();
    await waitFor(() => expect(api.balances).toHaveBeenCalledTimes(2));
  });
});

describe("depositStillPending", () => {
  const now = Date.parse("2026-10-20T12:00:00.000Z");
  it("is pending while settling, settled but not final, or created and not expired", () => {
    expect(depositStillPending(deposit("a", "SETTLING", null) as never, now)).toBe(true);
    expect(depositStillPending(deposit("a", "SETTLED", "PENDING") as never, now)).toBe(true);
    expect(depositStillPending(deposit("a", "CREATED", null) as never, now)).toBe(true);
    expect(depositStillPending({ ...deposit("a", "CREATED", null), expiresAt: "2026-10-20T11:00:00.000Z" } as never, now)).toBe(false);
  });
  it("is decided once confirmed, rejected, failed or expired", () => {
    for (const [status, finality] of [
      ["SETTLED", "CONFIRMED"],
      ["SETTLED", "REJECTED"],
      ["FAILED", null],
      ["EXPIRED", null],
    ] as const) {
      expect(depositStillPending(deposit("a", status, finality) as never, now)).toBe(false);
    }
  });
});
