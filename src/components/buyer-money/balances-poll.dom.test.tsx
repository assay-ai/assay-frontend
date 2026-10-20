// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* A deposit stuck confirming: /balances is read every 3 s for about 2 minutes, then every 30 s, not every 3 s forever. */
const services = vi.hoisted(() => ({ getBalances: vi.fn() }));
vi.mock("@/services", () => services);
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true }), useWallets: () => ({ ready: true, wallets: [] }) }));

import { useBalancesQuery } from "./use-buyer-money";

const ASSET = "eip155:46630/erc20:0x915E";
const m = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });
const balances = (pending: string) => ({
  balances: [
    { chainId: "eip155:46630", accountId: "eip155:46630:0xabc", asset: ASSET, decimals: 6, available: m("0"), held: m("0"), pending: m(pending), pendingDeposits: m("0"), chainReadable: true },
  ],
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useBalancesQuery(), { wrapper });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("/balances poll while a deposit is confirming", () => {
  it("backs off from 3 s to 30 s after about 2 minutes", async () => {
    services.getBalances.mockResolvedValue(balances("20000000"));
    mount();
    await advance(0);
    expect(services.getBalances).toHaveBeenCalledTimes(1);
    await advance(120_000);
    const fast = services.getBalances.mock.calls.length;
    expect(fast).toBeGreaterThanOrEqual(35);
    // The next ten minutes: every 30 s, not every 3 s (which would be 200 reads).
    await advance(600_000);
    const slow = services.getBalances.mock.calls.length - fast;
    expect(slow).toBeGreaterThanOrEqual(19);
    expect(slow).toBeLessThanOrEqual(21);
  });

  it("stops once nothing is confirming", async () => {
    services.getBalances.mockResolvedValueOnce(balances("20000000")).mockResolvedValue(balances("0"));
    mount();
    await advance(0);
    await advance(3_000);
    expect(services.getBalances).toHaveBeenCalledTimes(2);
    await advance(60_000);
    expect(services.getBalances).toHaveBeenCalledTimes(2);
  });
});
