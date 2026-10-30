// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OperatorApproval } from "@/interfaces/operator";

/*
  A bulk void of buyer debts (M-1) in the approvals inbox: the row names the
  count and total, the confirm says the providers are not paid, and once
  approved the per-debt results show under the result card.
*/

const service = vi.hoisted(() => ({ approveApproval: vi.fn(), rejectApproval: vi.fn() }));
vi.mock("@/services/operator.service", () => service);
const debts = vi.hoisted(() => ({ findOpenBuyerDebts: vi.fn() }));
vi.mock("@/services/operator-buyer-debts.service", () => debts);
vi.mock("@/services/catalogue.service", () => ({ listCatalogueProviders: vi.fn().mockResolvedValue({ providers: [] }) }));

import type { OperatorIdentity } from "@/interfaces/operator";
import type { OperatorBuyerDebt } from "@/services/operator-buyer-debts.service";

import { ApprovalItem } from "./approval-item";
import { EMPTY_APPROVAL_CONTEXT } from "./approvals";
import { OperatorSessionContext } from "./session-context";

const USDG = "eip155:46630/erc20:0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec";
const IDS = ["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002", "aaaaaaaa-0000-4000-8000-000000000003"];

const approval: OperatorApproval = {
  id: "ap-1",
  action: "buyer_debt.bulk_void",
  code: "M-1",
  target: "buyer_debt_void:abc",
  payload: { intentIds: IDS, assetId: USDG, decimals: 6, count: 3, totalAmount: "300000", reason: "Redeemer ran out of gas on 2026-10-29.", ticketRef: null },
  status: "PENDING",
  requestedBy: "tre@",
  requestedById: "op-tre",
  approvedBy: null,
  rejectedBy: null,
  createdAt: "2026-10-30T08:00:00.000Z",
  decidedAt: null,
  expiresAt: "2026-10-31T08:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a bulk void in Approvals", () => {
  it("reads as a count and total, warns the providers are not paid, and shows each debt's result once approved", async () => {
    service.approveApproval.mockResolvedValue({
      approval: { ...approval, status: "APPROVED", approvedBy: "lead@" },
      result: {
        approvalId: "ap-1",
        assetId: USDG,
        decimals: 6,
        requestedCount: 3,
        requestedAmount: "300000",
        voidedCount: 2,
        voidedAmount: "200000",
        items: [
          { intentId: IDS[0], result: "VOIDED", skipReason: null },
          { intentId: IDS[1], result: "VOIDED", skipReason: null },
          { intentId: IDS[2], result: "SKIPPED", skipReason: "SEQ_USED_ON_CHAIN" },
        ],
      },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApprovalItem approval={approval} context={EMPTY_APPROVAL_CONTEXT} mode="decide" nameOf={(s) => s ?? ""} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Void 3 buyer debts ($0.30)")).toBeTruthy();
    expect(screen.getByText(/Redeemer ran out of gas/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("The providers are NOT paid for those calls")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve and run" }));

    const results = await screen.findByTestId("debt-void-result");
    expect(service.approveApproval).toHaveBeenCalledWith("ap-1");
    expect(screen.getByText("Approved. 2 of 3 buyer debts voided; the per-debt results are below.")).toBeTruthy();
    expect(results.textContent).toContain("Voided 2 of 3 buyer debts ($0.20 of $0.30). 1 skipped ($0.10).");
    expect(within(results).queryByTestId("debt-void-partial")).toBeNull();
    const skipped = within(results).getByRole("list", { name: "Skipped" });
    expect(skipped.textContent).toContain("Its voucher was used on chain");
    expect(within(results).getByRole("list", { name: "Voided" }).querySelectorAll("li")).toHaveLength(2);
  });

  it("shows the result kept on the approval in History: counts, a label per skip and a partial-run notice", () => {
    const decided: OperatorApproval = {
      ...approval,
      status: "APPROVED",
      approvedBy: "lead@",
      decidedAt: "2026-10-30T09:00:00.000Z",
      result: {
        approvalId: "ap-1",
        assetId: USDG,
        decimals: 6,
        requestedCount: 3,
        requestedAmount: "300000",
        voidedCount: 0,
        voidedAmount: "0",
        skippedCount: 3,
        skippedAmount: "300000",
        complete: false,
        recordedAt: "2026-10-30T09:00:01.000Z",
        items: [
          { intentId: IDS[0], result: "SKIPPED", skipReason: "NOT_A_DEBT" },
          { intentId: IDS[1], result: "SKIPPED", skipReason: "CHAIN_UNREADABLE" },
          { intentId: IDS[2], result: "SKIPPED", skipReason: "NOT_ATTEMPTED" },
        ],
      },
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApprovalItem approval={decided} context={EMPTY_APPROVAL_CONTEXT} mode="history" nameOf={(s) => s ?? ""} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("debt-void-short").textContent).toBe("0 voided · 3 skipped · partial run");
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const results = screen.getByTestId("debt-void-result");
    expect(results.textContent).toContain("Voided 0 of 3 buyer debts ($0.00 of $0.30). 3 skipped ($0.30). Nothing was voided");
    expect(within(results).getByTestId("debt-void-partial").textContent).toMatch(/Partial run.*1 buyer debt was never attempted/);
    const skipped = within(results).getByRole("list", { name: "Skipped" });
    expect(skipped.textContent).toContain("No longer a debt");
    expect(skipped.textContent).toContain("The chain could not be read");
    expect(skipped.textContent).toContain("Not attempted: the run stopped before it");
    expect(within(results).queryByRole("list", { name: "Voided" })).toBeNull();
  });

  it("shows the approver who the pinned debts belong to, and warns when some look caused by the buyer", async () => {
    const row = (id: string, org: string, patch: Partial<OperatorBuyerDebt> = {}): OperatorBuyerDebt => ({
      intentId: id,
      buyerOrganizationId: org,
      payerAccount: "eip155:46630:0x3333333333333333333333333333333333333333",
      providerId: null,
      providerAccount: null,
      chainId: "eip155:46630",
      assetId: USDG,
      decimals: 6,
      amount: "100000",
      voucherSeq: "1",
      createdAt: "2026-10-29T10:00:00.000Z",
      lapsedAt: "2026-10-29T12:00:00.000Z",
      lastError: "VoucherExpired",
      writtenOff: false,
      suggestedPlatformCause: true,
      ...patch,
    });
    debts.findOpenBuyerDebts.mockResolvedValue({
      rows: [
        row(IDS[0]!, "11111111-2222-4333-8444-555555555555"),
        row(IDS[1]!, "11111111-2222-4333-8444-555555555555", { lastError: "EscrowInsufficient", suggestedPlatformCause: false }),
      ],
      searchedAll: true,
    });
    const lead: OperatorIdentity = {
      id: "op-lead",
      subject: "lead@",
      displayName: "Lee Lead",
      walletAddress: "0x2222222222222222222222222222222222222222",
      roles: ["ADJL"],
      authorityLimit: { amount: "100000000", asset: USDG, decimals: 6 },
      status: "ACTIVE",
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OperatorSessionContext.Provider value={lead}>
          <ApprovalItem approval={approval} context={EMPTY_APPROVAL_CONTEXT} mode="decide" nameOf={(s) => s ?? ""} />
        </OperatorSessionContext.Provider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const breakdown = await screen.findByTestId("debt-breakdown");
    expect(debts.findOpenBuyerDebts).toHaveBeenCalledWith(IDS, USDG, 20);
    expect(within(breakdown).getByRole("region", { name: "Per buyer" }).textContent).toContain("2 debts · $0.20");
    expect(within(breakdown).getByRole("region", { name: "Per provider" }).textContent).toContain("Unknown provider2 debts · $0.20");
    expect(screen.getByText(/2 of 3 debts found in the open list\. The other 1 is no longer open/)).toBeTruthy();
    expect(screen.getByTestId("buyer-caused-warning").textContent).toContain("Some selected debts look caused by the buyer, not the platform.");
    // Every pinned id is still listed.
    expect(screen.getByRole("list", { name: "Intent ids" }).querySelectorAll("li")).toHaveLength(3);
  });
});
