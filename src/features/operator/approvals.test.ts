import { describe, expect, it } from "vitest";

import type { OperatorApproval, OperatorIdentity } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";

import {
  actionLabel,
  approvalErrorMessage,
  approveBlockedBecause,
  approvedResultSentence,
  payloadSummary,
  pendingBadge,
  rejectMode,
  showApprove,
  targetOf,
} from "./approvals";

const me: Pick<OperatorIdentity, "id" | "roles"> = { id: "me", roles: ["ADJ"] };

function approval(overrides: Partial<OperatorApproval> = {}): OperatorApproval {
  return {
    id: "a1",
    action: "slash.sweep",
    code: "S-11",
    target: "slash_proposal:p1",
    payload: { proposalId: "p1", body: { defectKey: "D-1", lookbackHours: 24, reasonCode: "R", note: "n" } },
    status: "PENDING",
    requestedBy: "alice@",
    requestedById: "alice",
    approvedBy: null,
    rejectedBy: null,
    createdAt: "2026-10-15T10:00:00.000Z",
    decidedAt: null,
    expiresAt: "2026-10-16T10:00:00.000Z",
    ...overrides,
  };
}

describe("who sees Approve", () => {
  it("is hidden on your own request", () => {
    expect(showApprove(approval({ requestedById: "me" }), me)).toBe(false);
  });

  it("is shown on someone else's pending request", () => {
    expect(showApprove(approval(), me)).toBe(true);
  });

  it("is never shown once decided", () => {
    for (const status of ["APPROVED", "REJECTED", "EXPIRED"] as const) {
      expect(showApprove(approval({ status }), me)).toBe(false);
    }
  });

  it("is held back, with the roles named, when yours do not cover the code", () => {
    expect(approveBlockedBecause(approval({ code: "A-10" }), me)).toBe("Approving A-10 needs ADJL.");
    expect(approveBlockedBecause(approval({ code: "A-12" }), { roles: ["ADJL"] })).toMatch(/OPS_ADMIN/);
    expect(approveBlockedBecause(approval({ code: "S-5" }), { roles: ["TRE"] })).toBeNull();
    expect(approveBlockedBecause(approval({ code: "S-11" }), me)).toBeNull();
  });

  it("leaves an unknown code to the backend", () => {
    expect(approveBlockedBecause(approval({ code: "Z-99" }), { roles: [] })).toBeNull();
  });
});

describe("who sees Reject", () => {
  it("lets the requester withdraw, whatever their roles", () => {
    expect(rejectMode(approval({ requestedById: "me", code: "A-12" }), me)).toBe("withdraw");
  });

  it("lets an eligible approver reject", () => {
    expect(rejectMode(approval(), me)).toBe("reject");
  });

  it("hides it from an operator who could not approve it", () => {
    expect(rejectMode(approval({ code: "A-12" }), me)).toBeNull();
  });

  it("hides it once decided", () => {
    expect(rejectMode(approval({ status: "EXPIRED" }), me)).toBeNull();
  });
});

describe("how a row reads", () => {
  it("names the action in plain words", () => {
    expect(actionLabel("account.unblock")).toBe("Lift an account block");
    expect(actionLabel("slash.suspend")).toMatch(/Suspend a slash proposal/);
    expect(actionLabel("operator.change")).toMatch(/Raise an operator/);
    expect(actionLabel("something.new")).toBe("something.new");
  });

  it("links the target", () => {
    expect(targetOf("slash_proposal:p1")).toEqual({ label: "Case p1", href: "/operator/cases/p1" });
    expect(targetOf("operator:o1").href).toBe("/operator/operators");
    expect(targetOf("operator_wallet:0xabc").label).toBe("Wallet 0xabc");
    expect(targetOf("account_block:b1").href).toMatch(/targetType=account_block&targetId=b1/);
    expect(targetOf("weird")).toEqual({ label: "weird", href: null });
  });

  it("summarises the payload's body and leaves the ids to the target", () => {
    expect(payloadSummary(approval().payload)).toEqual([
      { key: "defectKey", value: "D-1" },
      { key: "lookbackHours", value: "24" },
      { key: "reasonCode", value: "R" },
      { key: "note", value: "n" },
    ]);
    expect(
      payloadSummary({ operatorId: "o1", body: { roles: ["ADJ", "ADJL"], authorityLimitMinor: null } }),
    ).toEqual([
      { key: "roles", value: "ADJ, ADJL" },
      { key: "authorityLimitMinor", value: "none (unbounded)" },
    ]);
  });

  it("states what an approval did, from the result", () => {
    expect(approvedResultSentence("slash.sweep", { matchedCount: 14, appliedCount: 0 })).toBe(
      "Fleet sweep opened: 14 matched, 0 applied.",
    );
    expect(approvedResultSentence("account.unblock", { subject: "eip155:1:0xabc" })).toBe(
      "Block lifted on eip155:1:0xabc.",
    );
  });

  it("badges the pending count, with a plus past one page", () => {
    expect(pendingBadge(0, false)).toBeNull();
    expect(pendingBadge(3, false)).toBe("3");
    expect(pendingBadge(100, true)).toBe("100+");
  });
});

describe("the approve and reject refusals", () => {
  const err = (code: string, status: number, message = "backend") => new ApiError(code, message, status);

  it.each([
    ["OPERATOR_SELF_APPROVAL_REFUSED", 409, /you cannot approve it/],
    ["OPERATOR_APPROVER_ROLE_REQUIRED", 403, /roles do not cover/],
    ["OPERATOR_APPROVER_AUTHORITY_EXCEEDED", 403, /above your authority limit/],
    ["OPERATOR_APPROVAL_NOT_PENDING", 409, /already approved, rejected or has expired/],
    ["OPERATOR_NOT_AUTHORIZED", 403, /no longer active/],
  ] as const)("maps %s and keeps the code", (code, status, pattern) => {
    const message = approvalErrorMessage(err(code, status), "approve");
    expect(message).toMatch(pattern);
    expect(message).toContain(`(${code})`);
  });

  it("explains a re-validation failure and that the request is still pending", () => {
    const message = approvalErrorMessage(
      err("SLASH_PROPOSAL_INVALID_TRANSITION", 409, "The proposal is CANCELLED"),
      "approve",
    );
    expect(message).toMatch(/re-checked against the current state and refused: The proposal is CANCELLED/);
    expect(message).toMatch(/still pending/);
  });
});
