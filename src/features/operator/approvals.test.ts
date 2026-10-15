import { describe, expect, it } from "vitest";

import type { OperatorApproval, OperatorIdentity, OperatorRole } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";

import {
  actionLabel,
  approvalErrorMessage,
  approvalNeeds,
  approveBlockedBecause,
  approvedResultSentence,
  decisionText,
  describeApproval,
  EMPTY_APPROVAL_CONTEXT,
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
    expect(approveBlockedBecause(approval({ code: "A-10" }), me)).toBe("Only a Lead adjudicator can approve this.");
    expect(approveBlockedBecause(approval({ code: "A-12" }), { roles: ["ADJL"] })).toMatch(/an Admin/);
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
    expect(actionLabel("slash.suspend")).toBe("Suspend a penalty (cancels it)");
    expect(actionLabel("operator.change")).toMatch(/^Raise someone's roles/);
    // No role codes in the words people read.
    expect(Object.values({ a: actionLabel("operator.change"), b: actionLabel("operator.remove") }).join(" ")).not.toMatch(/OPS_ADMIN/);
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
      expect(d.sentence).toBe("Lift the block on wallet 0x0000…0aBc (r15 done).");
      expect(d.target).toEqual({ label: "Wallet 0x0000…0aBc", href: "/operator/blocks" });
      expect(d.fields.map((f) => f.label)).toEqual(["Blocked for", "Reason", "Note"]);
      expect(JSON.stringify(d)).not.toContain(BLOCK_ID);
    });

    it("names who blocked by display name, not by a truncated handle", () => {
      const blocked = new Map(context.blocks);
      blocked.set(BLOCK_ID, { ...context.blocks.get(BLOCK_ID)!, blockedBy: "test-op-b@" });
      const d = describeApproval(
        { action: "account.unblock", target: `account_block:${BLOCK_ID}`, payload: { blockId: BLOCK_ID } },
        { ...context, blocks: blocked },
      );
      expect(d.fields.find((f) => f.label === "Blocked for")?.value).toBe("R15 test · by Test Op B");
    });

    it("falls back to a short block id when the block is not loaded", () => {
      const d = describeApproval({
        action: "account.unblock",
        target: `account_block:${BLOCK_ID}`,
        payload: { body: { reasonCode: "R" }, blockId: BLOCK_ID },
      });
      expect(d.sentence).toBe("Lift the block on block 7b2acf05… (r).");
    });

    it("names an added operator without their bare handle, and writes the limit as Team does", () => {
      const d = describeApproval(
        {
          action: "operator.add",
          target: "operator_wallet:0x4d2e8a1c6b9f3e07d5a2c8b1e4f7a0d3c6b9e258",
          payload: {
            body: {
              subject: "noor@",
              displayName: "Noor Hassan",
              roles: ["ADJ"],
              reasonCode: "JOINING",
              walletAddress: "0x4d2e8a1c6b9f3e07d5a2c8b1e4f7a0d3c6b9e258",
              authorityLimitMinor: "1000000000",
            },
          },
        },
        context,
      );
      expect(d.fields).toContainEqual({ label: "Operator", value: "Noor Hassan" });
      expect(d.fields).toContainEqual({ label: "Authority limit", value: "$1,000" });
      expect(d.sentence).toMatch(/^Add operator Noor Hassan with wallet/);
      expect(JSON.stringify(d)).not.toContain("noor@");
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
        "Add operator r15-throwaway@example.test with wallet 0x07cd…D711, roles Policy author, limit $0 (e2e test).",
      );
      expect(d.target.label).toBe("Wallet 0x07cd29d00E0F6f86B9e061F5d15c65D5edf4D711");
      expect(d.fields).toEqual([
        { label: "Operator", value: "R15 Throwaway (r15-throwaway@example.test)" },
        { label: "Wallet", value: "0x07cd29d00E0F6f86B9e061F5d15c65D5edf4D711" },
        { label: "Roles", value: "Policy author" },
        { label: "Authority limit", value: "$0" },
        { label: "Reason", value: "E2e test" },
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
      ).toBe("Take OPS_ADMIN away from Test Op B (test-op-b@): roles become Adjudicator (r).");
      expect(
        describeApproval(
          { action: "operator.remove", target: `operator:${OP_ID}`, payload: { body: { reasonCode: "R" }, operatorId: OP_ID } },
          admin,
        ).sentence,
      ).toBe("Remove Test Op B (test-op-b@), ending every session they hold (r).");
    });

    it("names the address an arbiter block would freeze, and that the arbiter still signs", () => {
      const d = describeApproval({
        action: "arbiter.block",
        target: "chain_blocklist:eip155:46630:0xabc",
        payload: { chainId: "eip155:46630", account: "0xAbC", reasonCode: "R", note: "n" },
      });
      expect(d.sentence).toMatch(/^Block wallet 0xAbC on chain \(Robinhood Chain testnet\) \(r\)\./);
      expect(d.sentence).toContain("the arbiter's wallet still has to sign it");
      expect(d.fields.slice(0, 2)).toEqual([
        { label: "Wallet", value: "0xAbC" },
        { label: "Chain", value: "Robinhood Chain testnet" },
      ]);
      expect(actionLabel("arbiter.block")).toMatch(/on chain/);
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
      expect(d.sentence).toBe("Raise the roles of Test Op B (test-op-b@) to Policy author, Treasury, Lead adjudicator (r14 adjl).");
      expect(d.target.label).toBe("Operator test-op-b@");
      expect(d.fields.slice(0, 3)).toEqual([
        { label: "Wallet", value: "0x07cd29d00E0F6f86B9e061F5d15c65D5edf4D711" },
        { label: "Roles now", value: "Policy author, Treasury" },
        { label: "New roles", value: "Policy author, Treasury, Lead adjudicator" },
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
        value: "Policy author, Treasury, Lead adjudicator",
      });
      expect(d.fields).toContainEqual({ label: "Limit requested (at request time)", value: "$5" });
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
      expect(d.fields).toContainEqual({ label: "Roles before (at request time)", value: "Policy author" });
      expect(d.fields).toContainEqual({ label: "Limit before (at request time)", value: "$0" });
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
      expect(d.sentence).toBe("Raise the authority limit of operator c39c364e… to unbounded (r).");
    });

    it("links a case and words suspend, sweep and compensation", () => {
      const id = "a337cb6d-5917-4c3c-be7e-f1463a385ab8";
      const suspend = describeApproval({
        action: "slash.suspend",
        target: `slash_proposal:${id}`,
        payload: { body: { note: "n", reasonCode: "R15_TEST" }, proposalId: id },
      });
      expect(suspend.sentence).toBe("Suspend penalty a337cb6d…, which cancels it (r15 test).");
      expect(suspend.target).toEqual({ label: "Penalty a337cb6d…", href: `/operator/cases/view?id=${id}` });
      // Once the penalty is read, it is named by its provider and amount.
      const named = describeApproval(
        { action: "slash.suspend", target: `slash_proposal:${id}`, payload: { proposalId: id, body: {} } },
        { ...EMPTY_APPROVAL_CONTEXT, penalties: new Map([[id, "Northwind Geo's $28.47 penalty"]]) },
      );
      expect(named.sentence).toBe("Suspend Northwind Geo's $28.47 penalty, which cancels it.");

      const sweep = describeApproval(approval());
      expect(sweep.sentence).toBe("Sweep every penalty with defect D-1 over the last 24 h, decided like penalty p1 (r).");
      expect(sweep.fields.map((f) => f.label)).toEqual(["Defect", "Look back", "Reason", "Note"]);

      const comp = describeApproval({
        action: "slash.compensated",
        target: "slash_proposal:p1",
        payload: { proposalId: "p1", body: { signature: "5sig", reasonCode: "R", note: "n" } },
      });
      expect(comp.sentence).toBe("Record that penalty p1 was paid back, and close it as compensated (r).");
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
    // Never the CAIP id off the wire: the shared wallet label, or the card's own name for it.
    expect(approvedResultSentence("account.unblock", { subjectKind: "WALLET", subject: "eip155:46630:0x9f3c2b7e1d4a8c05b6e9f2a3d7c1b4e8a0d5f36c" })).toMatch(
      /^Block lifted on Wallet 0x9[fF]3[cC]…[fF]36[cC]\.$/,
    );
    expect(approvedResultSentence("account.unblock", {}, "Wallet 0x9F3c…F36c")).toBe("Block lifted on Wallet 0x9F3c…F36c.");
    // "Below" only when the call came back, as the screen then draws it there.
    expect(approvedResultSentence("arbiter.block", { to: "0xcf65", data: "0x" })).toMatch(/ready below\. Nothing is blocked on chain until the arbiter's wallet signs/);
    expect(approvedResultSentence("arbiter.block", {})).toMatch(/^Approved\. Nothing is blocked on chain yet: .* from Arbiter/);
    expect(approvedResultSentence("arbiter.block", {})).not.toMatch(/below/);
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
  ] as const)("maps %s to a sentence; the code goes under Details", (code, status, pattern) => {
    const message = approvalErrorMessage(err(code, status), "approve");
    expect(message).toMatch(pattern);
    expect(message).not.toContain(code);
  });

  it("explains a re-validation failure and that the request is still pending", () => {
    const message = approvalErrorMessage(
      err("SLASH_PROPOSAL_INVALID_TRANSITION", 409, "The proposal is CANCELLED"),
      "approve",
    );
    expect(message).toMatch(/re-checked against how things stand now and refused/);
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

describe("approvalNeeds", () => {
  it("says 'a second' only when the requester holds the approving role", () => {
    expect(approvalNeeds("A-10", ["ADJL"])).toBe("a second Lead adjudicator");
    expect(approvalNeeds("A-10", ["SRE", "SUP"])).toBe("a Lead adjudicator");
    expect(approvalNeeds("A-12", ["SRE"])).toMatch(/^an Admin/);
  });

  it("keeps 'a second' when the requester is unknown", () => {
    expect(approvalNeeds("A-10")).toBe("a second Lead adjudicator");
  });
});
