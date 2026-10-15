import { describe, expect, it } from "vitest";

import type { ArbiterDispute } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";

import {
  agentShareText,
  approvedArbiterBlocks,
  arbiterErrorMessage,
  beneficiaryCheck,
  mayBlockOnChain,
  mayRule,
  pruneArbiterSelection,
  sortDisputesOldestFirst,
  toggleArbiterSelection,
  validateChainBlockForm,
  validateRulingForm,
} from "./arbiter";

const NOTE = "The evidence holds on every sampled call.";

function dispute(n: number, opts: Partial<ArbiterDispute> = {}): ArbiterDispute {
  return {
    requestId: `0x${n.toString(16).padStart(64, "0")}`,
    proposalId: `p-${n}`,
    providerId: "prov",
    chainId: "eip155:46630",
    caseStatus: "UNDER_REVIEW",
    caseChainStatus: "DISPUTED",
    penaltyAmount: "1000000",
    reservedAmount: "1000000",
    disputedAt: new Date(Date.UTC(2026, 9, n)).toISOString(),
    executableAt: null,
    expiresAt: null,
    upheldViolations30d: 0,
    beneficiary: "eip155:46630:0x64fecbe18e8998cb2990bce631a042f8e2be1659",
    beneficiaryEvidence: null,
    ...opts,
  };
}

describe("roles", () => {
  it("rules with ADJL or TRE and blocks with ADJL, SRE or TRE", () => {
    expect(mayRule(["ADJL"])).toBe(true);
    expect(mayRule(["TRE"])).toBe(true);
    expect(mayRule(["SRE", "ADJ"])).toBe(false);
    expect(mayBlockOnChain(["SRE"])).toBe(true);
    expect(mayBlockOnChain(["ADJ"])).toBe(false);
  });
});

describe("arbiter selection", () => {
  it("stops at 64 and refuses a second chain", () => {
    const rows = Array.from({ length: 66 }, (_, i) => dispute(i + 1));
    let selected: ReadonlySet<string> = new Set();
    for (const row of rows.slice(0, 64)) selected = toggleArbiterSelection(selected, row, rows).selected;
    expect(selected.size).toBe(64);
    expect(toggleArbiterSelection(selected, rows[64], rows)).toMatchObject({ ok: false, reason: "limit" });

    const other = dispute(99, { chainId: "eip155:8453" });
    const one = toggleArbiterSelection(new Set(), rows[0], [...rows, other]).selected;
    expect(toggleArbiterSelection(one, other, [...rows, other])).toMatchObject({ ok: false, reason: "other-chain" });
  });

  it("drops ids no longer listed", () => {
    const selected = new Set([dispute(1).requestId, dispute(2).requestId]);
    expect(pruneArbiterSelection(selected, [dispute(1)]).size).toBe(1);
    expect(pruneArbiterSelection(selected, [dispute(1), dispute(2)])).toBe(selected);
  });

  it("orders oldest dispute first", () => {
    expect(sortDisputesOldestFirst([dispute(3), dispute(1), dispute(2)]).map((r) => r.proposalId)).toEqual([
      "p-1",
      "p-2",
      "p-3",
    ]);
  });
});

describe("validateRulingForm", () => {
  it("builds the S-13 body", () => {
    const result = validateRulingForm(
      { ruling: "UPHOLD", reasonCode: " EVIDENCE_HOLDS ", note: NOTE, ticketRef: "INC-1" },
      "eip155:46630",
      [dispute(1).requestId],
    );
    expect(result).toEqual({
      ok: true,
      body: {
        chainId: "eip155:46630",
        ruling: "UPHOLD",
        requestIds: [dispute(1).requestId],
        reasonCode: "EVIDENCE_HOLDS",
        note: NOTE,
        ticketRef: "INC-1",
      },
    });
  });

  it("needs a selection, a ruling, a reason and a 20-character note", () => {
    const result = validateRulingForm({ ruling: "", reasonCode: "", note: "too short", ticketRef: "" }, null, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["note", "reasonCode", "ruling", "selection"]);
  });
});

describe("validateChainBlockForm", () => {
  it("checksums the address and refuses the zero address", () => {
    const ok = validateChainBlockForm(
      { account: "0x18a508c9af1c6fc512015276f6ca2e9aabd74680", reasonCode: "LEAKED_KEY", note: NOTE, ticketRef: "" },
      "eip155:46630",
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.body.account.toLowerCase()).toBe("0x18a508c9af1c6fc512015276f6ca2e9aabd74680");
      expect(ok.body.account).not.toBe(ok.body.account.toLowerCase());
    }
    const zero = validateChainBlockForm(
      { account: `0x${"0".repeat(40)}`, reasonCode: "X", note: NOTE, ticketRef: "" },
      "eip155:46630",
    );
    expect(zero).toMatchObject({ ok: false, errors: { account: expect.stringMatching(/zero/) } });
  });
});

describe("arbiterErrorMessage", () => {
  it("maps the chain and operator refusals, keeping the code", () => {
    expect(arbiterErrorMessage(new ApiError("CHAIN_ARBITER_NOT_SET", "m", 409), "ruling")).toMatch(
      /No arbiter is appointed.*\(CHAIN_ARBITER_NOT_SET\)$/,
    );
    expect(arbiterErrorMessage(new ApiError("CHAIN_ADDRESS_ALREADY_BLOCKED", "m", 409), "block")).toMatch(/already blocked/);
    expect(arbiterErrorMessage(new ApiError("CHAIN_PROGRAM_PAUSED", "m", 503), "ruling")).toMatch(/^Contracts paused/);
    expect(arbiterErrorMessage(new ApiError("SLASH_CHAIN_BATCH_REFUSED", "m", 422), "ruling")).toMatch(/marked in the list/);
    expect(
      arbiterErrorMessage(
        new ApiError("SLASH_CHAIN_BATCH_REFUSED", "m", 422, undefined, { functionName: "upholdSlashBatch" }),
        "ruling",
      ),
    ).toMatch(/refuse the whole upholdSlashBatch\./);
    expect(arbiterErrorMessage(new ApiError("OPERATOR_ROLE_REQUIRED", "m", 403), "block")).toMatch(/ADJL, SRE or TRE/);
    expect(arbiterErrorMessage(new ApiError("SOMETHING_ELSE", "the backend says", 500), "ruling")).toBe(
      "SOMETHING_ELSE · the backend says",
    );
  });
});

describe("arbiterErrorMessage for a missing arbiter", () => {
  it("says what cannot be built, per action, and never offers the admin as a fallback", () => {
    const error = new ApiError("CHAIN_ARBITER_NOT_SET", "m", 409);
    expect(arbiterErrorMessage(error, "cancel")).toMatch(/cancellation cannot be built.*arbiter only.*setArbiter/);
    expect(arbiterErrorMessage(error, "cancel")).toMatch(/\(CHAIN_ARBITER_NOT_SET\)$/);
    expect(arbiterErrorMessage(error, "block")).toMatch(/nobody can block on chain/);
    expect(arbiterErrorMessage(error, "ruling")).toMatch(/nobody can rule/);
    for (const action of ["cancel", "ruling", "block"] as const) {
      expect(arbiterErrorMessage(error, action)).not.toMatch(/admin's/);
    }
  });
});

describe("agentShareText", () => {
  it("reads basis points as a percentage", () => {
    expect(agentShareText(6000)).toBe("60% (6000 bps)");
    expect(agentShareText(1234)).toBe("12.34% (1234 bps)");
    expect(agentShareText(0)).toBe("0% (0 bps)");
    expect(agentShareText(undefined)).toBe("Not reported");
  });
});

describe("beneficiaryCheck", () => {
  const evidence = {
    payer: "eip155:46630:0x64fecbe18e8998cb2990bce631a042f8e2be1659",
    failedCalls: 3,
    paidAmount: "900000",
    formulaShareAmount: "1000000",
    redeemedAmount: "600000",
    shareAmount: "600000",
    ok: true,
    reason: null,
  };

  it("is unchecked when the backend sends no evidence", () => {
    expect(beneficiaryCheck(dispute(1))).toMatchObject({ status: "unchecked", reason: null });
    expect(beneficiaryCheck(dispute(1)).headline).toMatch(/by hand/);
  });

  it("passes when the backend's check passes, counting the failed calls", () => {
    const check = beneficiaryCheck(dispute(1, { beneficiaryEvidence: evidence }));
    expect(check).toMatchObject({ status: "ok", reason: null });
    expect(check.headline).toMatch(/paid for 3 failed calls/);
    expect(beneficiaryCheck(dispute(1, { beneficiaryEvidence: { ...evidence, failedCalls: 1 } })).headline).toMatch(
      /1 failed call,/,
    );
  });

  it("fails with the backend's reason when its check fails", () => {
    const reason = "eip155:46630:0x64fe…'s part 1000000 is more than the 400000 the penalty formula gives it for 3 failed call(s)";
    const check = beneficiaryCheck(dispute(1, { beneficiaryEvidence: { ...evidence, ok: false, reason } }));
    expect(check.status).toBe("failed");
    expect(check.reason).toBe(reason);
  });
});

/* Frontend review N5: an approved A-11 stays reachable for the arbiter's wallet. */
describe("approvedArbiterBlocks", () => {
  const row = (patch: Record<string, unknown>) => ({
    id: "appr-1",
    action: "arbiter.block",
    status: "APPROVED",
    payload: { chainId: "eip155:46630", account: "0xA271A3407D3302f4b4Fbe469b9188487cedd7d45" },
    approvedBy: "lead@",
    decidedAt: "2026-10-15T10:00:00Z",
    ...patch,
  });

  it("keeps the approved blocks, with the address and chain off the approved payload", () => {
    expect(
      approvedArbiterBlocks([
        row({}),
        row({ id: "appr-2", status: "PENDING" }),
        row({ id: "appr-3", action: "slash.suspend" }),
        row({ id: "appr-4", payload: { chainId: "eip155:46630" } }),
      ]),
    ).toEqual([
      {
        approvalId: "appr-1",
        chainId: "eip155:46630",
        account: "0xA271A3407D3302f4b4Fbe469b9188487cedd7d45",
        approvedBy: "lead@",
        decidedAt: "2026-10-15T10:00:00Z",
      },
    ]);
  });
});
