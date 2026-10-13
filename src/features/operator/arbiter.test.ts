import { describe, expect, it } from "vitest";

import type { ArbiterDispute } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";

import {
  arbiterErrorMessage,
  mayBlockOnChain,
  mayRule,
  pruneArbiterSelection,
  sortDisputesOldestFirst,
  toggleArbiterSelection,
  upheldLast30dOf,
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
    expect(arbiterErrorMessage(new ApiError("OPERATOR_ROLE_REQUIRED", "m", 403), "block")).toMatch(/ADJL, SRE or TRE/);
    expect(arbiterErrorMessage(new ApiError("SOMETHING_ELSE", "the backend says", 500), "ruling")).toBe(
      "SOMETHING_ELSE · the backend says",
    );
  });
});

describe("upheldLast30dOf (placeholder)", () => {
  it("reads the count when the backend sends it, and is null until then", () => {
    expect(upheldLast30dOf(dispute(1))).toBeNull();
    expect(upheldLast30dOf(dispute(1, { upheldViolationsLast30d: 3 }))).toBe(3);
  });
});
