import { describe, expect, it, vi } from "vitest";

const balances = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/services/balances.service", () => ({
  BALANCES_KEY: ["balances"],
  getBalances: async () => {
    balances.calls += 1;
    return { balances: [{ asset: "a" }, { asset: "b" }] };
  },
}));

import { heldAssets } from "@/services/display-asset";
import { setSharedReader } from "@/services/shared-reads";

import { createAppQueryClient, LIVE_STALE_MS } from "./query-client";

describe("the app's query client", () => {
  it("keeps money and live data fresh for 2 s, and the rest for about half the server's cache", () => {
    const client = createAppQueryClient();
    const stale = (queryKey: unknown[]) => client.defaultQueryOptions({ queryKey }).staleTime;
    expect(stale(["balances"])).toBe(LIVE_STALE_MS);
    expect(stale(["me", "status"])).toBe(LIVE_STALE_MS);
    expect(stale(["overview", "x", null])).toBe(LIVE_STALE_MS);
    expect(stale(["escrow-delegates"])).toBe(LIVE_STALE_MS);
    expect(stale(["notifications", "bell"])).toBe(7_500);
    expect(stale(["call-disputes", "buyer", "list"])).toBe(5_000);
    expect(stale(["provider", "tool-bindings", "sidebar"])).toBe(7_500);
    expect(stale(["provider", "sla-windows", "latest", "b"])).toBe(15_000);
    expect(stale(["toolsets"])).toBe(15_000);
    expect(stale(["notification-channels"])).toBe(30_000);
    expect(stale(["operator", "approvals", "pending-count"])).toBe(7_500);
  });

  it("lets a service's own read join the screens' cached request", async () => {
    const client = createAppQueryClient();
    await Promise.all([heldAssets(), heldAssets(), client.fetchQuery({ queryKey: ["balances"], queryFn: async () => ({ balances: [] }) })]);
    expect(balances.calls).toBe(1);
    setSharedReader(null);
  });
});
