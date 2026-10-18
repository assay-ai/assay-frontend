import { describe, expect, it } from "vitest";

import type { OperatorRole } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import type { ModerationCutoff } from "@/services/operator-provider-tools.service";

import { activeOperatorNav, OPERATOR_NAV_ITEMS, operatorNavFor, operatorTitleFor } from "./nav";
import {
  approveBlockedBy,
  checklistRows,
  confirmBlockedBy,
  cutoffView,
  isStaleReview,
  operatorToolsTabs,
  shortHash,
  sortReviewQueue,
  toolReviewErrorText,
  toolsHomeFor,
} from "./provider-tool-review";

const ALL: OperatorRole[] = ["SRE", "ADJ", "ADJL", "POL", "POLA", "TRE", "TREA", "BD", "SUP", "CMP", "SEC", "OPS_ADMIN"];

describe("operator navigation with provider tools and call disputes", () => {
  it("never has more than eight items, so the phone tab bar fits at 390px", () => {
    expect(OPERATOR_NAV_ITEMS).toHaveLength(8);
    expect(operatorNavFor(ALL).length).toBeLessThanOrEqual(8);
    // 390px minus the bar's padding, shared by the items: each still at least 40px wide.
    expect((390 - 8) / operatorNavFor(ALL).length).toBeGreaterThanOrEqual(40);
  });

  it("shows Tools to reviewers and takedown roles, opening where they can act", () => {
    expect(operatorNavFor(["ADJ"]).find((i) => i.id === "tools")?.href).toBe("/operator/tools/reviews");
    expect(operatorNavFor(["SRE"]).find((i) => i.id === "tools")?.href).toBe("/operator/tools/takedowns");
    expect(operatorNavFor(["POL"]).find((i) => i.id === "tools")?.href).toBe("/operator/tools");
    expect(operatorNavFor(["SUP"]).map((i) => i.id)).not.toContain("tools");
    expect(toolsHomeFor(["ADJL", "POLA"])).toBe("/operator/tools");
  });

  it("keeps the new pages under their sections, with titles for the phone bar", () => {
    expect(activeOperatorNav("/operator/tools/reviews/view")).toBe("tools");
    expect(activeOperatorNav("/operator/tools/takedowns")).toBe("tools");
    expect(activeOperatorNav("/operator/disputes")).toBe("penalties");
    expect(activeOperatorNav("/operator/disputes/view")).toBe("penalties");
    expect(operatorTitleFor("/operator/tools/reviews/view")).toBe("Review");
    expect(operatorTitleFor("/operator/disputes/view")).toBe("Call dispute");
  });

  it("offers only the Tools tabs a role can use", () => {
    expect(operatorToolsTabs(["POL"]).map((t) => t.id)).toEqual(["standard", "reviews", "promotions"]);
    expect(operatorToolsTabs(["ADJ"]).map((t) => t.id)).toEqual(["reviews", "takedowns"]);
    expect(operatorToolsTabs(["SRE"]).map((t) => t.id)).toEqual(["reviews", "takedowns"]);
    expect(operatorToolsTabs(["POLA"]).map((t) => t.id)).toEqual(["standard", "promotions"]);
  });
});

describe("the review", () => {
  const rows = checklistRows([
    { item: "NO_MODEL_INSTRUCTIONS", automated: "FAIL", detail: "1 finding", findings: [] },
    { item: "NO_IMPERSONATION", automated: "CHECK", detail: "Compare with the brand", findings: [] },
    { item: "PRICING_CLEAR", automated: "PASS", detail: "", findings: [] },
  ]);

  it("names each checklist item and who decided it", () => {
    expect(rows.map((r) => [r.label, r.verdictLabel])).toEqual([
      ["No instructions to models", "Failed the screen"],
      ["No impersonation", "You decide"],
      ["Pricing is clear", "Passed the screen"],
    ]);
  });

  it("blocks approval while the screen failed or the gate no longer passes", () => {
    expect(approveBlockedBy(rows, true)).toMatch(/no instructions to models/);
    expect(approveBlockedBy(rows.slice(1), false)).toMatch(/publish checks no longer pass/);
    expect(approveBlockedBy(rows.slice(1), true)).toBeNull();
  });

  it("orders the queue pending first, oldest first", () => {
    const row = (toolId: string, status: string, submittedAt: string) => ({ toolId, name: toolId, handle: "a", organizationId: "o", category: "c", visibility: "PRIVATE", status, kind: "FIRST", reviewVersion: 1, reviewSemver: "1.0.0", submittedAt, decidedAt: null });
    expect(sortReviewQueue([row("c", "APPROVED", "2026-10-01T00:00:00Z"), row("b", "PENDING", "2026-10-03T00:00:00Z"), row("a", "PENDING", "2026-10-02T00:00:00Z")]).map((r) => r.toolId)).toEqual(["a", "b", "c"]);
  });

  it("explains a stale review and keeps the hash readable", () => {
    const stale = new ApiError("TOOL_REVIEW_STALE", "stale", 409, "/", { contentHash: "x" });
    expect(isStaleReview(stale)).toBe(true);
    expect(toolReviewErrorText(stale)).toMatch(/changed what is under review/);
    expect(shortHash("f3b1c2d4e5f60718293a4b5c6d7e8f90")).toBe("f3b1c2d4…8f90");
  });
});

describe("takedowns", () => {
  const cutoff = (over: Partial<ModerationCutoff> = {}): ModerationCutoff => ({
    id: "c1",
    targetType: "TOOL",
    targetId: "t1",
    action: "TAKEDOWN",
    actedBy: "op-1",
    actedAt: "2026-10-18T00:00:00.000Z",
    confirmBy: "2026-10-21T00:00:00.000Z",
    confirmedBy: null,
    confirmedAt: null,
    revertedAt: null,
    revertReason: null,
    reportId: null,
    note: "Pretends to be another company's API.",
    ...over,
  });
  const now = Date.parse("2026-10-18T06:00:00.000Z");

  it("waits for a second operator, then reads as confirmed or reverted", () => {
    expect(cutoffView(cutoff(), now)).toMatchObject({ pending: true, tone: "warning" });
    expect(cutoffView(cutoff(), Date.parse("2026-10-20T13:00:00.000Z")).tone).toBe("danger");
    expect(cutoffView(cutoff({ confirmedAt: "2026-10-18T05:00:00.000Z" }), now).label).toBe("Confirmed");
    expect(cutoffView(cutoff({ revertedAt: "2026-10-21T00:00:00.000Z", revertReason: "EXPIRED" }), now).label).toMatch(/nobody confirmed/);
  });

  it("the one who took it down cannot confirm it", () => {
    expect(confirmBlockedBy(cutoff(), { id: "op-1" })).toMatch(/different operator/);
    expect(confirmBlockedBy(cutoff(), { id: "op-2" })).toBeNull();
  });
});
