import { describe, expect, it } from "vitest";

import type { OperatorApproval, OperatorIdentity, OperatorRole } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";

import {
  actionLabel,
  approvalErrorMessage,
  approveBlockedBecause,
  approvedResultSentence,
  decisionText,
  describeApproval,
  isWithdrawn,
  pendingBadge,
  rejectMode,
  showApprove,
  statusWord,
  type ApprovalContext,
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

  // BUG-R15-OP-01: the payloads below are the ones R15 queued, verbatim.
  describe("describeApproval", () => {
    const BLOCK_ID = "7b2acf05-2b3e-4846-8908-1d3d40f55e60";
    const OP_ID = "c39c364e-21f2-49dd-af75-7d05d537285e";
    const context: ApprovalContext = {
      blocks: new Map([
        [
          BLOCK_ID,
          {
            subjectKind: "WALLET" as const,
            subject: "eip155:1:0x0000000000000000000000000000000000000abc",
            active: true,
            reasonCode: "R15_TEST",
            blockedBy: "jordan-privy@",
          },
        ],
      ]),
      operators: new Map([
        [
          OP_ID,
          {
            subject: "test-op-b@",
            displayName: "Test Op B",
            walletAddress: "0x07cd29d00e0f6f86b9e061f5d15c65d5edf4d711",
            roles: ["POL", "TRE"] as OperatorRole[],
            authorityLimit: { amount: "0", asset: "USDC", decimals: 6 },
          },
        ],
      ]),
      asset: { asset: "USDC", decimals: 6 },
    };

    it("names the wallet a lift is for, not the block uuid", () => {
      const d = describeApproval(
        {
          action: "account.unblock",
          target: `account_block:${BLOCK_ID}`,
          payload: { body: { note: "R15 e2e lifting throwaway block again", reasonCode: "R15_DONE" }, blockId: BLOCK_ID },
        },
        context,
      );
      expect(d.sentence).toBe("Lift the block on wallet 0x0000…0aBc (reason R15_DONE).");
      expect(d.target).toEqual({ label: "Wallet 0x0000…0aBc", href: "/operator/blocks" });
      expect(d.fields.map((f) => f.label)).toEqual(["Blocked", "Reason code", "Note"]);
      expect(JSON.stringify(d)).not.toContain(BLOCK_ID);
    });

    it("falls back to a short block id when the block is not loaded", () => {
      const d = describeApproval({
        action: "account.unblock",
        target: `account_block:${BLOCK_ID}`,
        payload: { body: { reasonCode: "R" }, blockId: BLOCK_ID },
      });
      expect(d.sentence).toBe("Lift the block on block 7b2acf05… (reason R).");
    });

    it("spells out an operator add with labels, a checksummed wallet and money", () => {
      const d = describeApproval(
        {
          action: "operator.add",
          target: "operator_wallet:0x07cd29d00e0f6f86b9e061f5d15c65d5edf4d711",
          payload: {
            body: {
              note: "R15 e2e throwaway operator, removed afterwards",
              roles: ["POL"],
              subject: "r15-throwaway@example.test",
              reasonCode: "E2E_TEST",
              displayName: "R15 Throwaway",
              walletAddress: "0x07cd29d00E0F6f86B9e061F5d15c65D5edf4D711",
              authorityLimitMinor: "0",
            },
          },
        },
        context,
      );
      expect(d.sentence).toBe(
        "Add operator r15-throwaway@example.test with wallet 0x07cd…D711, roles POL, limit $0.00 (reason E2E_TEST).",
      );
      expect(d.target.label).toBe("Wallet 0x07cd29d00E0F6f86B9e061F5d15c65D5edf4D711");
      expect(d.fields).toEqual([
        { label: "Operator", value: "R15 Throwaway (r15-throwaway@example.test)" },
        { label: "Wallet", value: "0x07cd29d00E0F6f86B9e061F5d15c65D5edf4D711" },
        { label: "Roles", value: "POL (Policy author)" },
        { label: "Authority limit", value: "$0.00" },
        { label: "Reason code", value: "E2E_TEST" },
        { label: "Note", value: "R15 e2e throwaway operator, removed afterwards" },
      ]);
      expect(JSON.stringify(d.fields)).not.toMatch(/authorityLimitMinor|walletAddress|displayName|reasonCode/);
    });

    it("says when a change takes OPS_ADMIN away, and names a removal", () => {
      const admin: ApprovalContext = {
        ...context,
        operators: new Map([[OP_ID, { ...context.operators.get(OP_ID)!, roles: ["OPS_ADMIN", "ADJ"] as OperatorRole[] }]]),
      };
      expect(
        describeApproval(
          { action: "operator.change", target: `operator:${OP_ID}`, payload: { body: { roles: ["ADJ"], reasonCode: "R" }, operatorId: OP_ID } },
          admin,
        ).sentence,
      ).toBe("Take OPS_ADMIN away from Test Op B (test-op-b@): roles become ADJ (reason R).");
      expect(
        describeApproval(
          { action: "operator.remove", target: `operator:${OP_ID}`, payload: { body: { reasonCode: "R" }, operatorId: OP_ID } },
          admin,
        ).sentence,
      ).toBe("Remove Test Op B (test-op-b@), ending every session they hold (reason R).");
    });

    it("names the address an arbiter block would freeze, and that the arbiter still signs", () => {
      const d = describeApproval({
        action: "arbiter.block",
        target: "chain_blocklist:eip155:46630:0xabc",
        payload: { chainId: "eip155:46630", account: "0xAbC", reasonCode: "R", note: "n" },
      });
      expect(d.sentence).toMatch(/^Prepare the arbiter's on-chain block of 0xAbC \(reason R\)\./);
      expect(d.sentence).toContain("the arbiter's wallet still has to sign it");
      expect(d.fields[0]).toEqual({ label: "Chain", value: "eip155:46630" });
      expect(actionLabel("arbiter.block")).toMatch(/on-chain block/);
    });

    it("names the operator a change raises, with roles before and after", () => {
      const d = describeApproval(
        {
          action: "operator.change",
          target: `operator:${OP_ID}`,
          payload: { body: { note: "R14 temp ADJL for unblock", roles: ["POL", "TRE", "ADJL"], reasonCode: "R14_ADJL" }, operatorId: OP_ID },
        },
        context,
      );
      expect(d.sentence).toBe("Raise the roles of Test Op B (test-op-b@) to POL, TRE, ADJL (reason R14_ADJL).");
      expect(d.target.label).toBe("Operator test-op-b@");
      expect(d.fields.slice(0, 3)).toEqual([
        { label: "Wallet", value: "0x07cd29d00E0F6f86B9e061F5d15c65D5edf4D711" },
        { label: "Roles now", value: "POL, TRE" },
        { label: "New roles", value: "POL (Policy author), TRE (Treasury), ADJL (Adjudication lead)" },
      ]);
    });

    it("shows a decided change as requested at the time, never the live row", () => {
      const d = describeApproval(
        {
          action: "operator.change",
          target: `operator:${OP_ID}`,
          status: "APPROVED",
          payload: { body: { roles: ["POL", "TRE", "ADJL"], authorityLimitMinor: "5000000", reasonCode: "R" }, operatorId: OP_ID },
        },
        context,
      );
      const labels = d.fields.map((f) => f.label);
      expect(labels).not.toContain("Roles now");
      expect(labels).not.toContain("Limit now");
      expect(d.fields).toContainEqual({
        label: "Roles requested (at request time)",
        value: "POL (Policy author), TRE (Treasury), ADJL (Adjudication lead)",
      });
      expect(d.fields).toContainEqual({ label: "Limit requested (at request time)", value: "$5.00" });
      expect(labels).not.toContain("Roles before (at request time)");
    });

    it("shows the before values of a decided change when the payload has them", () => {
      const d = describeApproval(
        {
          action: "operator.change",
          target: `operator:${OP_ID}`,
          status: "REJECTED",
          payload: {
            body: { roles: ["POL", "ADJL"], reasonCode: "R" },
            before: { roles: ["POL"], authorityLimitMinor: "0" },
            operatorId: OP_ID,
          },
        },
        context,
      );
      expect(d.fields).toContainEqual({ label: "Roles before (at request time)", value: "POL" });
      expect(d.fields).toContainEqual({ label: "Limit before (at request time)", value: "$0.00" });
    });

    it("keeps the live row on a pending change", () => {
      const d = describeApproval(
        { action: "operator.change", target: `operator:${OP_ID}`, status: "PENDING", payload: { body: { roles: ["ADJ"] }, operatorId: OP_ID } },
        context,
      );
      expect(d.fields.map((f) => f.label)).toEqual(["Wallet", "Roles now", "New roles"]);
    });

    it("states an unbounded limit raise", () => {
      const d = describeApproval({
        action: "operator.change",
        target: `operator:${OP_ID}`,
        payload: { body: { authorityLimitMinor: null, reasonCode: "R" }, operatorId: OP_ID },
      });
      expect(d.sentence).toBe("Raise the authority limit of operator c39c364e… to unbounded (reason R).");
    });

    it("links a case and words suspend, sweep and compensation", () => {
      const id = "a337cb6d-5917-4c3c-be7e-f1463a385ab8";
      const suspend = describeApproval({
        action: "slash.suspend",
        target: `slash_proposal:${id}`,
        payload: { body: { note: "n", reasonCode: "R15_TEST" }, proposalId: id },
      });
      expect(suspend.sentence).toBe("Suspend case a337cb6d…, which cancels its penalty (reason R15_TEST).");
      expect(suspend.target).toEqual({ label: "Case a337cb6d…", href: `/operator/cases/${id}` });

      const sweep = describeApproval(approval());
      expect(sweep.sentence).toBe("Sweep every case with defect D-1 over the last 24 h, decided like case p1 (reason R).");
      expect(sweep.fields.map((f) => f.label)).toEqual(["Defect", "Look back", "Reason code", "Note"]);

      const comp = describeApproval({
        action: "slash.compensated",
        target: "slash_proposal:p1",
        payload: { proposalId: "p1", body: { signature: "5sig", reasonCode: "R", note: "n" } },
      });
      expect(comp.sentence).toBe("Record compensation for case p1 and close it as compensated (reason R).");
      expect(comp.fields[0]).toEqual({ label: "Deposit signature", value: "5sig" });
    });

    it("keeps an unknown action readable", () => {
      const d = describeApproval({ action: "x.y", target: "weird", payload: { body: { someField: 3 } } });
      expect(d.target).toEqual({ label: "weird", href: null });
      expect(d.fields).toEqual([{ label: "Some field", value: "3" }]);
    });
  });

  it("states what an approval did, from the result", () => {
    expect(approvedResultSentence("slash.sweep", { matchedCount: 14, appliedCount: 0 })).toBe(
      "Fleet sweep opened: 14 matched, 0 applied.",
    );
    expect(approvedResultSentence("account.unblock", { subject: "eip155:1:0xabc" })).toBe(
      "Block lifted on eip155:1:0xabc.",
    );
    expect(approvedResultSentence("arbiter.block", {})).toMatch(/Nothing is blocked until the arbiter's wallet signs/);
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

  // R15 retest: a request its own requester withdrew read "rejected by".
  describe("withdrawn vs rejected", () => {
    it("reads a requester's own reject as withdrawn", () => {
      const row = approval({ status: "REJECTED", rejectedBy: "alice@", requestedBy: "alice@" });
      expect(isWithdrawn(row)).toBe(true);
      expect(statusWord(row)).toBe("withdrawn");
      expect(decisionText(row)).toBe("Withdrawn by alice@");
    });

    it("reads another operator's reject as rejected", () => {
      const row = approval({ status: "REJECTED", rejectedBy: "bob@", requestedBy: "alice@" });
      expect(isWithdrawn(row)).toBe(false);
      expect(statusWord(row)).toBe("rejected");
      expect(decisionText(row)).toBe("Rejected by bob@");
    });

    it("words approved and expired rows", () => {
      expect(decisionText(approval({ status: "APPROVED", approvedBy: "bob@" }))).toBe("Approved by bob@");
      expect(decisionText(approval({ status: "EXPIRED" }))).toBe("Expired");
      expect(statusWord(approval({ status: "EXPIRED" }))).toBe("expired");
    });
  });
});
