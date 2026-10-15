import { describe, expect, it } from "vitest";

import type { OperatorApproval } from "@/interfaces/operator";

import { approvalOutcome, approvalTitle, describeApproval, EMPTY_APPROVAL_CONTEXT, type ApprovalContext } from "./approvals";

function approval(overrides: Partial<OperatorApproval>): OperatorApproval {
  return {
    id: "a1",
    action: "account.unblock",
    code: "A-10",
    target: "account_block:blk-2",
    payload: { blockId: "blk-2", body: { reasonCode: "KEY_ROTATED" } },
    status: "PENDING",
    requestedBy: "sam@",
    requestedById: "sam",
    approvedBy: null,
    rejectedBy: null,
    createdAt: "2026-10-16T10:00:00Z",
    decidedAt: null,
    expiresAt: "2026-10-17T10:00:00Z",
    ...overrides,
  };
}

const PENALTY = "8b3f2e9a-1c74-4d05-b6e2-7f0a9c3d5e18";
const context: ApprovalContext = {
  ...EMPTY_APPROVAL_CONTEXT,
  blocks: new Map([
    ["blk-2", { subjectKind: "WALLET", subject: "eip155:1:0x9f3c0000000000000000000000000000000ff36c", active: true, reasonCode: "LEAKED_KEY", blockedBy: "jordan@" }],
  ]),
  penalties: new Map([[PENALTY, "Meridian Index's $3.75 penalty"]]),
  penaltyParts: new Map([[PENALTY, { provider: "Meridian Index", amount: "$3.75" }]]),
};

const compensated = approval({
  action: "slash.compensated",
  code: "S-5",
  target: `slash_proposal:${PENALTY}`,
  payload: { proposalId: PENALTY, body: { reasonCode: "EXECUTED_IN_ERROR", signature: "0x9d1c" } },
});

describe("approvalTitle", () => {
  it("is the short form: no reason, no period", () => {
    expect(approvalTitle(compensated, context)).toBe("Pay back Meridian Index's $3.75 penalty");
    expect(approvalTitle(approval({}), context)).toMatch(/^Lift the block on Wallet 0x9f3c…/i);
    expect(
      approvalTitle(approval({ action: "slash.suspend", code: "S-1", target: `slash_proposal:${PENALTY}`, payload: { proposalId: PENALTY } }), context),
    ).toBe("Suspend Meridian Index's $3.75 penalty");
    expect(
      approvalTitle(
        approval({ action: "operator.add", code: "A-12", target: "operator_wallet:0x1", payload: { body: { displayName: "Noor Hassan", roles: ["ADJ"] } } }),
        context,
      ),
    ).toBe("Add Noor Hassan as Adjudicator");
  });

  it("comes with the reason apart, and the long sentence unchanged", () => {
    const described = describeApproval(compensated, context);
    expect(described.title).toBe("Pay back Meridian Index's $3.75 penalty");
    expect(described.reason).toBe("Executed in error");
    expect(described.sentence).toBe("Record that Meridian Index's $3.75 penalty was paid back, and close it as compensated (executed in error).");
  });
});

describe("approvalOutcome", () => {
  it("leads with the money and ends with where it is recorded", () => {
    const lines = approvalOutcome(compensated, context);
    expect(lines[0]).toEqual({ kind: "money", text: "Treasury pays $3.75 to Meridian Index" });
    expect(lines[lines.length - 1]).toEqual({ kind: "record", text: "Recorded in Activity under your name" });
  });

  it("says a wallet can pay again after a lift", () => {
    expect(approvalOutcome(approval({}), context)[0]!.text).toMatch(/^Wallet 0x9f3c….* can pay again within seconds$/i);
  });

  it("falls back to words without the penalty read", () => {
    expect(approvalOutcome(compensated, EMPTY_APPROVAL_CONTEXT)[0]!.text).toBe("Treasury pays the provider back the penalty");
  });
});
