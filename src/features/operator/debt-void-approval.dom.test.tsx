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

import { ApprovalItem } from "./approval-item";
import { EMPTY_APPROVAL_CONTEXT } from "./approvals";

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
    expect(results.textContent).toContain("Voided 2 of 3 buyer debts ($0.20 of $0.30). 1 skipped.");
    const skipped = within(results).getByRole("list", { name: "Skipped" });
    expect(skipped.textContent).toContain("Its voucher was used on chain");
    expect(within(results).getByRole("list", { name: "Voided" }).querySelectorAll("li")).toHaveLength(2);
  });
});
