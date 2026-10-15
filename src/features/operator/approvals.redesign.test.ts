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

/* Operator review 2026-10-16b, P1-6: the two most dangerous requests name who they are about. */
describe("high-risk requests name their target", () => {
  const block = approval({
    action: "arbiter.block",
    code: "A-11",
    target: "chain_blocklist:eip155:46630:0x9f3c0000000000000000000000000000000ff36c",
    payload: { chainId: "eip155:46630", account: "0x9f3c0000000000000000000000000000000ff36c", reasonCode: "FRAUD" },
  });
  const removal = approval({ action: "operator.remove", code: "A-14", target: "operator:op-ava", payload: { operatorId: "op-ava", body: { reasonCode: "LEFT" } } });
  const team: ApprovalContext = {
    ...context,
    operators: new Map([["op-ava", { subject: "ava@", displayName: "Ava Chen", walletAddress: "0x2e7b", roles: ["OPS_ADMIN"], authorityLimit: null }]]),
  };

  it("titles an on-chain block with the wallet and the chain by name", () => {
    expect(approvalTitle(block, context)).toMatch(/^Block wallet 0x9[fF]3[cC]…[fF]36[cC] on chain \(Robinhood Chain testnet\)$/);
  });

  it("titles an admin removal with the person and their role", () => {
    expect(approvalTitle(removal, team)).toBe("Remove Ava Chen (Admin)");
  });

  it("says what approving does, and that a removal can't be undone", () => {
    expect(approvalOutcome(block, context).map((l) => l.text).join(" | ")).toMatch(/Nothing is blocked on chain until the arbiter's wallet signs it/);
    const lines = approvalOutcome(removal, team).map((l) => l.text);
    expect(lines[0]).toBe("Ava Chen is removed, and every session they hold ends now");
    expect(lines).toContain("It can't be undone: adding them back is a new request");
  });
});

describe("approvalOutcome", () => {
  it("leads with the money and ends with where it is recorded", () => {
    const lines = approvalOutcome(compensated, context);
    // The deposit already happened: approving records it, in the same words as the result and Activity.
    expect(lines[0]).toEqual({ kind: "money", text: "Records that the treasury paid $3.75 back into Meridian Index's stake" });
    expect(lines).toContainEqual({ kind: "record", text: "The penalty closes as paid back. It can't be undone" });
    expect(lines[lines.length - 1]).toEqual({ kind: "record", text: "Recorded in Activity under your name" });
  });

  it("says a wallet can pay again after a lift", () => {
    expect(approvalOutcome(approval({}), context)[0]!.text).toMatch(/^Wallet 0x9f3c….* can pay again within seconds$/i);
  });

  it("falls back to words without the penalty read", () => {
    expect(approvalOutcome(compensated, EMPTY_APPROVAL_CONTEXT)[0]!.text).toBe("Records that the treasury paid the penalty back into the provider's stake");
  });
});
