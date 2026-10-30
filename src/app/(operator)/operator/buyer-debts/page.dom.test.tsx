// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OperatorSessionContext } from "@/features/operator/session-context";
import type { OperatorIdentity } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import type { BuyerDebtPage, OperatorBuyerDebt } from "@/services/operator-buyer-debts.service";

/*
  Buyer debts (M-1): the list and its totals, the one-asset selection, the
  request that always goes to a second operator, and a 400 that names the
  debts that are no longer open.
*/

const debts = vi.hoisted(() => ({ listOperatorBuyerDebts: vi.fn(), requestBuyerDebtVoid: vi.fn() }));
vi.mock("@/services/operator-buyer-debts.service", () => debts);
const operator = vi.hoisted(() => ({ listOperators: vi.fn(), listApprovals: vi.fn() }));
vi.mock("@/services/operator.service", () => operator);
vi.mock("@/services/catalogue.service", () => ({ listCatalogueProviders: vi.fn().mockResolvedValue([]) }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => "/operator/buyer-debts",
}));

import BuyerDebtsPage from "./page";

const USDG = "eip155:46630/erc20:0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec";
const OTHER = "eip155:46630/erc20:0x0000000000000000000000000000000000000002";
const LIMIT = { amount: "100000000", asset: USDG, decimals: 6 };
const TRE: OperatorIdentity = { id: "op-tre", subject: "tre@", displayName: "Tia Treasury", walletAddress: "0x1111111111111111111111111111111111111111", roles: ["TRE"], authorityLimit: LIMIT, status: "ACTIVE" };
const ADJL = { ...TRE, id: "op-adjl", subject: "lead@", displayName: "Lee Lead", walletAddress: "0x2222222222222222222222222222222222222222", roles: ["ADJL"], lastSeenAt: null };

function debt(id: string, amount: string, patch: Partial<OperatorBuyerDebt> = {}): OperatorBuyerDebt {
  return {
    intentId: id,
    buyerOrganizationId: "11111111-2222-4333-8444-555555555555",
    payerAccount: "eip155:46630:0x3333333333333333333333333333333333333333",
    providerId: null,
    providerAccount: null,
    chainId: "eip155:46630",
    assetId: USDG,
    decimals: 6,
    amount,
    voucherSeq: "7",
    createdAt: "2026-10-29T10:00:00.000Z",
    lapsedAt: "2026-10-29T12:00:00.000Z",
    lastError: "VoucherExpired",
    writtenOff: false,
    suggestedPlatformCause: false,
    ...patch,
  };
}

const D1 = debt("aaaaaaaa-0000-4000-8000-000000000001", "100000", { suggestedPlatformCause: true });
const D2 = debt("aaaaaaaa-0000-4000-8000-000000000002", "250000");
const DX = debt("aaaaaaaa-0000-4000-8000-000000000003", "50000", { assetId: OTHER, lastError: "EscrowInsufficient" });

function page(items: OperatorBuyerDebt[], byAsset: BuyerDebtPage["totals"]["byAsset"]): BuyerDebtPage {
  return { items, pageInfo: { nextCursor: null, hasMore: false }, totals: { count: byAsset.reduce((n, t) => n + t.count, 0), byAsset } };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage(me: OperatorIdentity = TRE, items = [D1, D2, DX]) {
  debts.listOperatorBuyerDebts.mockResolvedValue(
    page(items, [
      { assetId: USDG, decimals: 6, count: 2, amount: "350000" },
      { assetId: OTHER, decimals: 6, count: 1, amount: "50000" },
    ]),
  );
  operator.listOperators.mockResolvedValue({ items: [{ ...TRE, lastSeenAt: null }, ADJL], pageInfo: { nextCursor: null, hasMore: false } });
  operator.listApprovals.mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasMore: false } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OperatorSessionContext.Provider value={me}>
        <BuyerDebtsPage />
      </OperatorSessionContext.Provider>
    </QueryClientProvider>,
  );
}

const box = (name: RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

describe("buyer debts: the list", () => {
  it("lists the debts with the suggested-cause chip, and totals per asset", async () => {
    renderPage();
    const table = await screen.findByTestId("debt-table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("$0.10")).toBeTruthy();
    expect(within(table).getAllByText("Suggested platform cause")).toHaveLength(1);
    const totals = screen.getByTestId("debt-totals");
    expect(totals.textContent).toContain("Matching: 3 debts");
    expect(totals.textContent).toContain("2 debts · $0.35");
    expect(totals.textContent).toContain("1 debt · $0.05");
    expect(totals.textContent).toMatch(/not added/);
  });

  it("asks the API for suggested ones only from the quick filter", async () => {
    renderPage();
    await screen.findByTestId("debt-table");
    fireEvent.click(screen.getByRole("button", { name: "Suggested only" }));
    await waitFor(() => expect(debts.listOperatorBuyerDebts).toHaveBeenLastCalledWith(expect.objectContaining({ suggestedOnly: true })));
  });

  it.each([["ADJ"], ["SRE"], ["SUP"]] as const)("is refused to %s, without asking the API", (role) => {
    renderPage({ ...TRE, roles: [role] });
    expect(screen.getByText("Buyer debts are for Treasury and Lead adjudicators")).toBeTruthy();
    expect(screen.queryByTestId("debt-table")).toBeNull();
    expect(debts.listOperatorBuyerDebts).not.toHaveBeenCalled();
  });
});

describe("buyer debts: one asset per void", () => {
  it("disables rows of another asset once one is selected, and the total follows the selection", async () => {
    renderPage();
    await screen.findByTestId("debt-table");
    fireEvent.click(box(/Select the \$0\.10 debt/));
    expect(box(/Select the \$0\.05 debt/).disabled).toBe(true);
    expect(box(/Select the \$0\.25 debt/).disabled).toBe(false);
    expect(screen.getByRole("region", { name: "Selection" }).textContent).toContain("1 of 2 debts selected · $0.10");

    // The header box takes the page's rows of that asset only.
    fireEvent.click(box(/Select all on this page/));
    expect(screen.getByRole("region", { name: "Selection" }).textContent).toContain("2 debts selected · $0.35");
    expect(screen.getByRole("region", { name: "Selection" }).textContent).not.toContain(" of ");
    expect(box(/Select the \$0\.05 debt/).checked).toBe(false);
  });
});

describe("buyer debts: at most 100 per request", () => {
  it("select all matching stops at 100 and says so, as N of M", async () => {
    const many = Array.from({ length: 250 }, (_, i) => debt(`bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`, "10000", { suggestedPlatformCause: true }));
    const totals = [{ assetId: USDG, decimals: 6, count: 250, amount: "2500000" }];
    debts.listOperatorBuyerDebts.mockImplementation(async (query: { cursor?: string }) => {
      const start = query.cursor ? Number(query.cursor) : 0;
      const items = many.slice(start, start + 100);
      const next = start + 100 < many.length ? String(start + 100) : null;
      return { items, pageInfo: { nextCursor: next, hasMore: next !== null }, totals: { count: 250, byAsset: totals } };
    });
    operator.listOperators.mockResolvedValue({ items: [{ ...TRE, lastSeenAt: null }, ADJL], pageInfo: { nextCursor: null, hasMore: false } });
    operator.listApprovals.mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasMore: false } });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OperatorSessionContext.Provider value={TRE}>
          <BuyerDebtsPage />
        </OperatorSessionContext.Provider>
      </QueryClientProvider>,
    );
    await screen.findByTestId("debt-table");
    expect(screen.getByText(/^100 of 250 selected; at most 100 per request/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Select all 100 matching \(of 250\)/ }));
    const bar = await screen.findByRole("region", { name: "Selection" });
    await waitFor(() => expect(bar.textContent).toContain("100 of 250 debts selected; at most 100 per request · $1.00"));
    expect(debts.listOperatorBuyerDebts).toHaveBeenCalledTimes(2); // the list's page, then select-all stops after one page
    expect(box(/Select all on this page/).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Request void" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/100 of 250 matching/)).toBeTruthy();
    expect(within(dialog).getByText(/at most 100 per request/)).toBeTruthy();
    expect(within(dialog).queryByTestId("buyer-caused-warning")).toBeNull();
  });
});

describe("buyer debts: requesting a void", () => {
  async function openSheet() {
    renderPage();
    await screen.findByTestId("debt-table");
    fireEvent.click(box(/Select the \$0\.10 debt/));
    fireEvent.click(box(/Select the \$0\.25 debt/));
    fireEvent.click(screen.getByRole("button", { name: "Request void" }));
    return screen.findByRole("dialog");
  }

  it("says what a void does, needs a reason, and on 202 shows it waiting for a second operator", async () => {
    debts.requestBuyerDebtVoid.mockResolvedValue({
      kind: "queued",
      approval: { approvalId: "ap-9", status: "PENDING", action: "buyer_debt.bulk_void", expiresAt: "2026-10-31T10:00:00.000Z" },
    });
    const dialog = await openSheet();
    expect(within(dialog).getByText("Void 2 buyer debts ($0.35)?")).toBeTruthy();
    expect(within(dialog).getByText("The provider is not paid for these calls")).toBeTruthy();
    expect(within(dialog).getByText("It cannot be undone")).toBeTruthy();
    // Who it is about, per buyer and per provider, not a list of ids.
    const breakdown = within(dialog).getByTestId("debt-breakdown");
    expect(within(breakdown).getByRole("region", { name: "Per buyer" }).textContent).toContain("Buyer");
    expect(within(breakdown).getByRole("region", { name: "Per buyer" }).textContent).toContain("2 debts · $0.35");
    expect(within(breakdown).getByRole("region", { name: "Per provider" }).textContent).toContain("Unknown provider2 debts · $0.35");
    // D2 lapsed on a cause that does not suggest the platform: a warning, and sending stays allowed.
    expect(within(dialog).getByTestId("buyer-caused-warning").textContent).toContain(
      "Some selected debts look caused by the buyer, not the platform. Voiding them means the provider is never paid.",
    );
    expect(within(dialog).getByTestId("buyer-caused-warning").textContent).toContain("1 of 2 debts");

    fireEvent.change(within(dialog).getByRole("textbox", { name: /Why the platform caused/ }), { target: { value: "gas" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for approval" }));
    expect(await within(dialog).findByText(/At least 10 characters/)).toBeTruthy();
    expect(debts.requestBuyerDebtVoid).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole("textbox", { name: /Why the platform caused/ }), { target: { value: "The redeemer ran out of gas on 2026-10-29." } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Ticket/ }), { target: { value: "INC-42" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for approval" }));
    await waitFor(() =>
      expect(debts.requestBuyerDebtVoid).toHaveBeenCalledWith({
        intentIds: [D1.intentId, D2.intentId],
        reason: "The redeemer ran out of gas on 2026-10-29.",
        ticketRef: "INC-42",
      }),
    );
    expect(await screen.findByText("Waiting for a second operator")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the request" }).getAttribute("href")).toBe("/operator/approvals?id=ap-9");
    // The selection is cleared: nothing else is pending on this screen.
    expect(screen.queryByRole("region", { name: "Selection" })).toBeNull();
  });

  it("marks the debts a 400 names, and sends again once they are left out", async () => {
    debts.requestBuyerDebtVoid.mockRejectedValueOnce(
      new ApiError("OPERATOR_DEBT_VOID_INVALID", "x", 400, "/operator/buyer-debts/void", { intentIds: [D2.intentId] }),
    );
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Why the platform caused/ }), { target: { value: "The redeemer ran out of gas on 2026-10-29." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for approval" }));

    expect(await within(dialog).findByText(/1 selected debt is no longer open/)).toBeTruthy();
    const marked = document.querySelector(`tr[data-invalid]`);
    expect(marked?.textContent).toContain("No longer open");
    expect(marked?.textContent).toContain("$0.25");
    expect((within(dialog).getByRole("button", { name: "Send for approval" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Leave it out" }));
    expect(document.querySelector("tr[data-invalid]")).toBeNull();
    expect(within(dialog).getByText("Void 1 buyer debt ($0.10)?")).toBeTruthy();
    debts.requestBuyerDebtVoid.mockResolvedValue({
      kind: "queued",
      approval: { approvalId: "ap-10", status: "PENDING", action: "buyer_debt.bulk_void", expiresAt: "2026-10-31T10:00:00.000Z" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for approval" }));
    await waitFor(() => expect(debts.requestBuyerDebtVoid).toHaveBeenLastCalledWith(expect.objectContaining({ intentIds: [D1.intentId] })));
  });

  it("says a 403 in words", async () => {
    debts.requestBuyerDebtVoid.mockRejectedValueOnce(new ApiError("OPERATOR_ROLE_REQUIRED", "x", 403));
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Why the platform caused/ }), { target: { value: "The redeemer ran out of gas on 2026-10-29." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for approval" }));
    expect(await within(dialog).findByText(/Your roles do not allow asking for a void/)).toBeTruthy();
  });
});
