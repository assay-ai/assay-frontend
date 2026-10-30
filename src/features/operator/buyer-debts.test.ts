import { describe, expect, it } from "vitest";

import type { OperatorApproval } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";

import { activityIcon, activitySentence, activityText } from "./activity";
import { approvalOutcome, approvalTitle, approvedResultSentence, approverRolesFor, describeApproval } from "./approvals";
import {
  buyerCausedCount,
  debtBreakdown,
  debtQuery,
  debtVoidResultOf,
  debtVoidShort,
  debtVoidSummary,
  EMPTY_DEBT_FILTERS,
  EMPTY_SELECTION,
  filterErrors,
  mayReadBuyerDebts,
  mayVoidBuyerDebts,
  matchingCountFor,
  pageSelectState,
  partialRunText,
  reasonError,
  selectAllCapNote,
  selectBlockedBecause,
  selectedText,
  skipReasonText,
  toggleRows,
  voidRequestError,
} from "./buyer-debts";
import { operatorNavFor, operatorTitleFor, activeOperatorNav } from "./nav";
import { operatorCasesTabs } from "./provider-tool-review";

const USDG = "eip155:46630/erc20:0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec";
const OTHER = "eip155:46630/erc20:0x0000000000000000000000000000000000000002";

function row(id: string, amount = "100000", assetId = USDG) {
  return { intentId: id, assetId, decimals: 6, amount };
}

describe("buyer debts: who reads and who voids", () => {
  it("reads and voids for TRE and ADJL only; ADJ and SRE no longer read", () => {
    expect(mayReadBuyerDebts(["TRE"])).toBe(true);
    expect(mayReadBuyerDebts(["ADJL"])).toBe(true);
    expect(mayReadBuyerDebts(["ADJ"])).toBe(false);
    expect(mayReadBuyerDebts(["SRE"])).toBe(false);
    expect(mayReadBuyerDebts(["ADJ", "SRE", "SUP"])).toBe(false);
    expect(mayVoidBuyerDebts(["TRE"])).toBe(true);
    expect(mayVoidBuyerDebts(["ADJL"])).toBe(true);
    expect(mayVoidBuyerDebts(["ADJ", "SRE"])).toBe(false);
    expect(approverRolesFor("M-1")).toEqual(["ADJL", "TRE"]);
  });

  it("is a Penalties tab for readers only, and keeps Penalties lit", () => {
    expect(operatorCasesTabs(["TRE"]).map((tab) => tab.label)).toEqual(["Penalties", "Call disputes", "Buyer debts"]);
    expect(operatorCasesTabs(["ADJL"]).map((tab) => tab.label)).toEqual(["Penalties", "Call disputes", "Buyer debts"]);
    expect(operatorCasesTabs(["ADJ"]).map((tab) => tab.label)).toEqual(["Penalties", "Call disputes"]);
    expect(operatorCasesTabs(["SRE"]).map((tab) => tab.label)).toEqual(["Penalties", "Call disputes"]);
    expect(operatorCasesTabs(["SUP"]).map((tab) => tab.label)).toEqual(["Penalties", "Call disputes"]);
    expect(activeOperatorNav("/operator/buyer-debts")).toBe("penalties");
    expect(operatorTitleFor("/operator/buyer-debts")).toBe("Buyer debts");
    expect(operatorNavFor(["TRE"]).length).toBeLessThanOrEqual(8);
  });
});

describe("buyer debts: filters as a query", () => {
  it("sends only what is set, with the to-date as the whole UTC day", () => {
    const query = debtQuery({ ...EMPTY_DEBT_FILTERS, from: "2026-10-01", to: "2026-10-02", lastError: " VoucherExpired ", suggestedOnly: true }, "c1");
    expect(query).toMatchObject({
      cursor: "c1",
      limit: 100,
      sort: "lapsedAt",
      order: "desc",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-03T00:00:00.000Z",
      lastError: "VoucherExpired",
      suggestedOnly: true,
    });
    expect(debtQuery(EMPTY_DEBT_FILTERS).suggestedOnly).toBeUndefined();
    expect(debtQuery(EMPTY_DEBT_FILTERS).buyerOrganizationId).toBeUndefined();
  });

  it("refuses a partial id and a backwards range, and leaves them out of the query", () => {
    const filters = { ...EMPTY_DEBT_FILTERS, buyerOrganizationId: "7b2acf05", from: "2026-10-05", to: "2026-10-01" };
    expect(Object.keys(filterErrors(filters)).sort()).toEqual(["buyerOrganizationId", "to"]);
    expect(debtQuery(filters).buyerOrganizationId).toBeUndefined();
    expect(debtQuery(filters).to).toBeUndefined();
  });
});

describe("buyer debts: one asset per void", () => {
  const known = new Map([row("a"), row("b", "250000"), row("x", "100000", OTHER)].map((r) => [r.intentId, r]));

  it("adds rows of the first asset and sums them", () => {
    const selection = toggleRows(EMPTY_SELECTION, [row("a"), row("b", "250000")], true, known);
    expect(selection).toMatchObject({ ids: ["a", "b"], assetId: USDG, amount: "350000" });
  });

  it("refuses a row of another asset, with why", () => {
    const selection = toggleRows(EMPTY_SELECTION, [row("a")], true, known);
    expect(selectBlockedBecause(selection, row("x", "100000", OTHER))).toMatch(/One void covers one asset/);
    expect(toggleRows(selection, [row("x", "100000", OTHER)], true, known).ids).toEqual(["a"]);
    // A mixed page: only the selection's asset is taken.
    expect(toggleRows(EMPTY_SELECTION, [row("a"), row("x", "100000", OTHER), row("b", "250000")], true, known).ids).toEqual(["a", "b"]);
  });

  it("removes rows and recomputes the total; empty clears the asset", () => {
    const selection = toggleRows(EMPTY_SELECTION, [row("a"), row("b", "250000")], true, known);
    expect(toggleRows(selection, [row("a")], false, known)).toMatchObject({ ids: ["b"], amount: "250000" });
    expect(toggleRows(selection, [row("a"), row("b")], false, known)).toEqual(EMPTY_SELECTION);
  });

  it("stops at 100, the most one request carries", () => {
    const many = Array.from({ length: 102 }, (_, i) => row(`id-${i}`));
    const map = new Map(many.map((r) => [r.intentId, r]));
    const selection = toggleRows(EMPTY_SELECTION, many, true, map);
    expect(selection.ids).toHaveLength(100);
    expect(selectBlockedBecause(selection, many[101]!)).toMatch(/at most 100/);
  });

  it("says N of M wherever a selection is summarised, and the cap of select-all", () => {
    expect(selectedText(3, 12)).toBe("3 of 12 debts selected");
    expect(selectedText(1, 1)).toBe("1 debt selected");
    expect(selectedText(2, null)).toBe("2 debts selected");
    expect(selectAllCapNote(250)).toMatch(/^100 of 250 selected; at most 100 per request/);
    expect(selectAllCapNote(100)).toBeNull();
    const totals = [{ assetId: USDG, decimals: 6, count: 250, amount: "1" }];
    expect(matchingCountFor(totals, USDG, 6)).toBe(250);
    expect(matchingCountFor(totals, OTHER, 6)).toBeNull();
    expect(matchingCountFor(totals, null, null)).toBeNull();
  });

  it("the header box covers the selectable rows of the page", () => {
    const rows = [row("a"), row("x", "100000", OTHER), row("b")];
    expect(pageSelectState(EMPTY_SELECTION, rows).selectable.map((r) => r.intentId)).toEqual(["a", "b"]);
    const half = toggleRows(EMPTY_SELECTION, [row("a")], true, known);
    expect(pageSelectState(half, rows)).toMatchObject({ all: false, some: true });
  });
});

describe("buyer debts: who a void is about", () => {
  const ORG_A = "aaaaaaaa-0000-4000-8000-00000000000a";
  const ORG_B = "bbbbbbbb-0000-4000-8000-00000000000b";
  const P1 = "11111111-0000-4000-8000-000000000001";
  const debt = (id: string, org: string, payer: string, providerId: string | null, amount: string) => ({
    intentId: id,
    buyerOrganizationId: org,
    payerAccount: payer,
    providerId,
    amount,
  });

  it("groups per buyer (with its wallets) and per provider, largest amount first", () => {
    const { buyers, providers } = debtBreakdown([
      debt("1", ORG_A, "w1", P1, "100"),
      debt("2", ORG_B, "w3", P1, "500"),
      debt("3", ORG_A, "w2", null, "100"),
      debt("4", ORG_A, "w1", P1, "100"),
    ]);
    expect(buyers).toEqual([
      { buyerOrganizationId: ORG_B, payers: ["w3"], count: 1, amount: "500" },
      { buyerOrganizationId: ORG_A, payers: ["w1", "w2"], count: 3, amount: "300" },
    ]);
    expect(providers).toEqual([
      { providerId: P1, count: 3, amount: "700" },
      { providerId: null, count: 1, amount: "100" },
    ]);
  });

  it("counts the debts whose cause does not suggest the platform", () => {
    expect(buyerCausedCount([{ suggestedPlatformCause: true }, { suggestedPlatformCause: false }, { suggestedPlatformCause: false }])).toBe(2);
    expect(buyerCausedCount([{ suggestedPlatformCause: true }])).toBe(0);
  });
});

describe("buyer debts: the request", () => {
  it("needs a reason of at least 10 characters", () => {
    expect(reasonError("gas")).toMatch(/At least 10/);
    expect(reasonError("  redeemer out of gas  ")).toBeNull();
  });

  it("reads the offending ids off a 400, and says the mixed-asset refusal", () => {
    const invalid = new ApiError("OPERATOR_DEBT_VOID_INVALID", "x", 400, "/operator/buyer-debts/void", { intentIds: ["a", "b"] });
    expect(voidRequestError(invalid)).toMatchObject({ invalidIds: ["a", "b"] });
    expect(voidRequestError(invalid).message).toMatch(/2 selected debts are no longer open/);
    expect(voidRequestError(new ApiError("OPERATOR_DEBT_VOID_INVALID", "x", 400)).message).toMatch(/one asset only/);
    expect(voidRequestError(new ApiError("OPERATOR_ROLE_REQUIRED", "x", 403)).message).toMatch(/Treasury or a Lead adjudicator/);
    expect(voidRequestError(new ApiError("OPERATOR_AUTHORITY_EXCEEDED", "x", 403)).message).toMatch(/authority limit/);
  });
});

describe("buyer debts in Approvals", () => {
  const approval = {
    id: "ap-1",
    action: "buyer_debt.bulk_void",
    code: "M-1",
    target: "buyer_debt_void:abc",
    status: "PENDING",
    payload: { intentIds: ["i-1", "i-2", "i-3"], assetId: USDG, decimals: 6, count: 3, totalAmount: "300000", reason: "Redeemer ran out of gas on 2026-10-29.", ticketRef: "INC-12" },
  } as unknown as OperatorApproval;

  it("names the count and total, and says what approving does", () => {
    expect(approvalTitle(approval)).toBe("Void 3 buyer debts ($0.30)");
    const described = describeApproval(approval);
    expect(described.reason).toBe("Redeemer ran out of gas on 2026-10-29.");
    expect(described.fields).toEqual(
      expect.arrayContaining([
        { label: "Debts", value: "3" },
        { label: "Total", value: "$0.30" },
        { label: "Reason", value: "Redeemer ran out of gas on 2026-10-29." },
        { label: "Ticket", value: "INC-12" },
      ]),
    );
    const lines = approvalOutcome(approval).map((line) => line.text);
    expect(lines).toContain("The providers are NOT paid for those calls");
    expect(lines).toContain("It can't be undone");
  });

  it("summarises the result and each skip", () => {
    const result = {
      approvalId: "ap-1",
      assetId: USDG,
      decimals: 6,
      requestedCount: 3,
      requestedAmount: "300000",
      voidedCount: 2,
      voidedAmount: "200000",
      items: [
        { intentId: "i-1", result: "VOIDED", skipReason: null },
        { intentId: "i-2", result: "VOIDED", skipReason: null },
        { intentId: "i-3", result: "SKIPPED", skipReason: "SEQ_USED_ON_CHAIN" },
      ],
    };
    // The approve answer has no skipped side: it is worked out, and the run is complete.
    const read = debtVoidResultOf("buyer_debt.bulk_void", result)!;
    expect(read).toMatchObject({ ...result, skippedCount: 1, skippedAmount: "100000", complete: true, recordedAt: null });
    expect(debtVoidResultOf("account.unblock", result)).toBeNull();
    expect(debtVoidSummary(read)).toBe("Voided 2 of 3 buyer debts ($0.20 of $0.30). 1 skipped ($0.10). The providers are not paid for the voided ones.");
    expect(debtVoidShort(read)).toBe("2 voided · 1 skipped");
    expect(approvedResultSentence("buyer_debt.bulk_void", result)).toBe("Approved. 2 of 3 buyer debts voided; the per-debt results are below.");
  });

  it("reads the record kept on the approval, a partial run and the new skip reason", () => {
    const record = {
      approvalId: "ap-1",
      assetId: USDG,
      decimals: 6,
      requestedCount: 2,
      requestedAmount: "200000",
      voidedCount: 0,
      voidedAmount: "0",
      skippedCount: 2,
      skippedAmount: "200000",
      complete: false,
      recordedAt: "2026-10-30T09:00:00.000Z",
      items: [
        { intentId: "i-1", result: "SKIPPED", skipReason: "CHAIN_UNREADABLE" },
        { intentId: "i-2", result: "SKIPPED", skipReason: "NOT_ATTEMPTED" },
      ],
    };
    const read = debtVoidResultOf("buyer_debt.bulk_void", record)!;
    expect(read.complete).toBe(false);
    expect(debtVoidSummary(read)).toBe("Voided 0 of 2 buyer debts ($0.00 of $0.20). 2 skipped ($0.20). Nothing was voided; the buyers still owe them.");
    expect(debtVoidShort(read)).toBe("0 voided · 2 skipped · partial run");
    expect(partialRunText(read)).toMatch(/^Partial run: .*1 buyer debt was never attempted/);
    expect(skipReasonText("NOT_ATTEMPTED")).toMatch(/Not attempted/);
    expect(debtVoidResultOf("buyer_debt.bulk_void", null)).toBeNull();
  });

  const entry = {
    code: "M-1",
    action: "buyer_debt.bulk_voided",
    targetType: "buyer_debt_void",
    targetId: "abc",
    after: { count: 1, approvalId: "ap-1" },
    actorSubject: "tre@",
    approverSubject: "adjl@",
    reasonCode: "PLATFORM_FAULT",
    createdAt: "2026-10-30T00:00:00.000Z",
  };
  const names = { operator: (s: string | null | undefined) => s ?? "", target: () => null };

  it("reads in Activity as money, with its outcome: never voided when none was", () => {
    expect(activityIcon(entry)).toBe("money");
    const outcome = {
      approvalId: "ap-1",
      assetId: USDG,
      decimals: 6,
      requestedCount: 1,
      requestedAmount: "100000",
      voidedCount: 0,
      voidedAmount: "0",
      skippedCount: 1,
      skippedAmount: "100000",
      complete: true,
    };
    const sentence = activitySentence({ ...entry, outcome } as never, names);
    expect(activityText(sentence)).toBe("tre@ voided 0 buyer debts ($0.00), skipped 1 ($0.10) (Platform fault), approved by adjl@.");
    expect(sentence.href).toBe("/operator/approvals?id=ap-1");
    expect(sentence.note).toBeNull();

    const partial = activitySentence({ ...entry, outcome: { ...outcome, voidedCount: 1, voidedAmount: "100000", skippedCount: 0, skippedAmount: "0", requestedCount: 2, complete: false } } as never, names);
    expect(partial.target).toBe("1 buyer debt ($0.10), skipped 0");
    expect(partial.note).toMatch(/^Partial run/);
  });

  it("without an outcome says only that a void was requested", () => {
    for (const outcome of [null, undefined]) {
      const sentence = activitySentence({ ...entry, outcome } as never, names);
      expect(sentence.verb).toBe("requested a void of");
      expect(sentence.target).toBe("1 buyer debt");
      expect(sentence.note).toBe("Outcome pending or unknown.");
      expect(activityText(sentence)).not.toMatch(/ voided /);
    }
  });
});
