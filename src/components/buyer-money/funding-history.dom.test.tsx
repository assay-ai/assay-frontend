// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
  B7: Funding shows its results. The reconciliation line comes from the
  chain's lifetime counters, the refundable line from the backend's own
  refundable list (never a clock rule), the withdrawals list from
  GET /withdrawals, and a standing request shows app-wide.
*/
const ASSET = "eip155:46630/erc20:0x1";
const usd = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });
const api = vi.hoisted(() => ({
  refundable: [] as unknown[],
  secondPage: [] as unknown[],
  withdrawals: [] as unknown[],
  escrow: null as unknown,
  path: "/",
}));

vi.mock("@/services/tool-calls.service", () => ({
  listToolCalls: vi.fn(async (query: { refundable?: boolean; cursor?: string }) => {
    if (!query.refundable) throw new Error("the line must ask the backend for refundable calls");
    if (query.cursor === "p2") return { items: api.secondPage, pageInfo: { nextCursor: null, hasMore: false } };
    const more = api.secondPage.length > 0;
    return { items: api.refundable, pageInfo: { nextCursor: more ? "p2" : null, hasMore: more } };
  }),
}));
vi.mock("@/services/funding.service", () => ({ listWithdrawals: vi.fn(async () => ({ items: api.withdrawals })) }));
vi.mock("./use-buyer-money", () => ({
  useBuyerMoney: () => ({ chains: [{ chainId: "eip155:46630", displayName: "Robinhood Chain testnet", explorerBaseUrl: "https://explorer.example" }] }),
  useEscrowQuery: () => ({ data: api.escrow }),
}));
vi.mock("@/hooks/useChains", () => ({
  useChains: () => ({ chains: [{ chainId: "eip155:46630", displayName: "Robinhood Chain testnet" }], status: "ready" }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => api.path }));

import { EscrowReconciliation, RefundableNowLine, WithdrawalsList } from "./funding-history";
import { WithdrawalPendingBanner } from "./withdrawal-banner";

afterEach(() => {
  cleanup();
  api.refundable = [];
  api.secondPage = [];
  api.withdrawals = [];
  api.escrow = null;
  api.path = "/";
});

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("Funding result lines (B7)", () => {
  it("reconciles deposited − spent − withdrawn to the balance, with a Statements link", () => {
    wrap(
      <EscrowReconciliation
        escrow={{ balance: usd("13240000"), lifetime: { deposited: usd("20000000"), spent: usd("6760000"), withdrawn: usd("0") } } as never}
      />,
    );
    expect(screen.getByTestId("escrow-reconciliation").textContent).toContain("Deposited $20.00 − spent $6.76 − withdrawn $0.00 = $13.24");
    expect(screen.getByRole("link", { name: "Statements" }).getAttribute("href")).toBe("/statements");
  });

  it("says what is still refundable only from the backend's refundable list", async () => {
    api.refundable = [{ charged: usd("250000"), refundableIfReportedUntil: "2026-10-19T12:10:00Z" }];
    wrap(<RefundableNowLine />);
    const line = await screen.findByTestId("funding-refundable");
    expect(line.textContent).toContain("$0.25 charged recently (1 call) is still covered: a report accepted for any of them is refunded in full.");
    expect(screen.getByRole("link", { name: "See them" }).getAttribute("href")).toBe("/spend/calls?status=refundable");
  });

  it("sums every page of the backend's list, not only the first", async () => {
    api.refundable = [{ charged: usd("250000"), refundableIfReportedUntil: null }];
    api.secondPage = [{ charged: usd("100000"), refundableIfReportedUntil: null }];
    wrap(<RefundableNowLine />);
    expect((await screen.findByTestId("funding-refundable")).textContent).toContain("$0.35 charged recently (2 calls)");
  });

  it("shows nothing when nothing is refundable", async () => {
    const { container } = wrap(<RefundableNowLine />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("lists finished withdrawals, leaving the pending one to the escrow card", async () => {
    api.withdrawals = [
      { id: "w0", chainId: "eip155:46630", account: "a", status: "PENDING", requested: usd("1000000"), received: null, requestedAt: "2026-10-19T10:00:00Z", claimableAt: null, closedAt: null, requestTransactionHash: "0x9", closeTransactionHash: null },
      { id: "w1", chainId: "eip155:46630", account: "a", status: "CLAIMED", requested: usd("13240000"), received: usd("13000000"), requestedAt: "2026-10-18T10:00:00Z", claimableAt: "2026-10-18T11:00:00Z", closedAt: "2026-10-18T11:05:00Z", requestTransactionHash: "0x1", closeTransactionHash: "0x2" },
    ];
    wrap(<WithdrawalsList pending />);
    const list = await screen.findByTestId("withdrawals-list");
    expect(list.querySelectorAll("li")).toHaveLength(1);
    expect(list.textContent).toContain("Claimed, $13.00 of $13.24 asked");
    expect(screen.getByText(/Your open request, with Claim and Cancel/)).toBeTruthy();
  });
});

describe("the pending-withdrawal banner (B7)", () => {
  const escrow = (over: Record<string, unknown> = {}) => ({
    account: "eip155:46630:0x66d7CA4cD09C65197B2f3239c1fe79631747dd00",
    withdrawRequested: usd("5000000"),
    withdrawAvailableAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    ...over,
  });

  it("says paid calls on that chain are paused, and when it can be claimed", () => {
    api.escrow = escrow();
    wrap(<WithdrawalPendingBanner />);
    const banner = screen.getByTestId("withdrawal-banner");
    expect(banner.textContent).toContain("Withdrawal of up to $5.00 requested. Paid calls on Robinhood Chain testnet are paused until you claim or cancel it");
    expect(screen.getByRole("link", { name: "Open Funding" }).getAttribute("href")).toBe("/funding");
  });

  it("offers Claim once it can be claimed", () => {
    api.escrow = escrow({ withdrawAvailableAt: new Date(Date.now() - 60_000).toISOString() });
    wrap(<WithdrawalPendingBanner />);
    expect(screen.getByRole("link", { name: "Claim" }).getAttribute("href")).toBe("/funding?action=claim");
  });

  it("is absent with no request, and on Funding itself", () => {
    api.escrow = escrow({ withdrawRequested: usd("0"), withdrawAvailableAt: null });
    const { container } = wrap(<WithdrawalPendingBanner />);
    expect(container.textContent).toBe("");
    cleanup();
    api.escrow = escrow();
    api.path = "/funding";
    expect(wrap(<WithdrawalPendingBanner />).container.textContent).toBe("");
  });
});
