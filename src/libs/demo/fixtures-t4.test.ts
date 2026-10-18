import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buyerStatus, reportWindow, slaMarks } from "@/features/call-disputes/model";
import { providerToolState } from "@/features/provider-tools/model";
import { ApiError } from "@/libs/ApiClient";
import type { CallDispute } from "@/services/call-disputes.service";
import type { OperatorCallDisputeRow } from "@/services/operator-call-disputes.service";
import type { ModerationCutoff, PromotionGroup, ReviewDetail, ReviewQueueItem } from "@/services/operator-provider-tools.service";
import type { PromotionInvitation, ProviderTool, ProviderToolGate, ProviderToolSummary } from "@/services/provider-tools.service";
import type { PublicHandleProfile } from "@/services/public-toolsets.service";
import type { PublicTool } from "@/services/public-explorer.service";

import { DEMO_FIXTURES } from "./fixtures";
import { DEMO_AFTER_HOLD_RECEIPT, DEMO_HELD_RECEIPT, t4Notifications } from "./fixtures-t4";

/* Through the whole table, first match wins — as the client resolves a request. */
function call<T>(method: string, path: string, query: Record<string, unknown> = {}, data?: Record<string, unknown>): T {
  const fixture = DEMO_FIXTURES.find((f) => f.method === method && (f.match instanceof RegExp ? f.match.test(path) : f.match === path));
  if (!fixture) throw new Error(`no fixture for ${method} ${path}`);
  return fixture.body(path, query, data) as T;
}

function refusal(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { search: "", hostname: "localhost" },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("provider tools: every state", () => {
  it("lists one own tool per state, all under the demo's public name", () => {
    const { items } = call<{ items: ProviderToolSummary[] }>("GET", "/provider/tools");
    expect(new Set(items.map((t) => providerToolState(t).id))).toEqual(
      new Set(["DRAFT", "PRIVATE", "UNLISTED", "IN_REVIEW", "CHANGES_IN_REVIEW", "LISTED", "CHANGES_REQUESTED", "TAKEN_DOWN", "DEPRECATED"]),
    );
    expect(items.every((t) => t.name.startsWith("brightpath__"))).toBe(true);
  });

  it("opens each tool, its gate, and an invitation with a prefill", () => {
    const { items } = call<{ items: ProviderToolSummary[] }>("GET", "/provider/tools");
    for (const t of items) {
      expect(call<ProviderTool>("GET", `/provider/tools/${t.id}`).id).toBe(t.id);
      expect(call<ProviderToolGate>("GET", `/provider/tools/${t.id}/publish-check`).requirements).toHaveLength(10);
    }
    const invite = call<{ invitations: PromotionInvitation[] }>("GET", "/provider/tools/invitations").invitations[0]!;
    expect(invite.prefill?.endpoint).toMatch(/^https:/);
    expect(items.map((t) => t.id)).toContain(invite.sourceToolId);
  });

  it("refuses sharing a tool whose checks fail, and echoes a created one on the next read", () => {
    const failing = call<{ items: ProviderToolSummary[] }>("GET", "/provider/tools").items.find((t) => t.localName === "weather_alerts")!;
    expect(refusal(() => call("POST", `/provider/tools/${failing.id}/publish`)).code).toBe("TOOL_PROVIDER_TOOL_GATE_FAILED");
    const created = call<ProviderTool>("POST", "/provider/tools", {}, { name: "flight_status", category: "travel", summary: "Is a flight on time." });
    expect(call<ProviderTool>("GET", `/provider/tools/${created.id}`).name).toBe("brightpath__flight_status");
    expect(refusal(() => call("POST", "/provider/tools", {}, { name: "store_hours" })).code).toBe("TOOL_PROVIDER_TOOL_NAME_TAKEN");
  });

  it("offers the own tools in the listing wizard's picker", () => {
    const { tools } = call<{ tools: { name: string }[] }>("GET", "/providers/me/tool-bindings/catalogue");
    expect(tools.some((t) => t.name === "brightpath__weather_alerts")).toBe(true);
    expect(tools.some((t) => t.name === "Market quote")).toBe(true);
  });
});

describe("operator queues", () => {
  it("has a first review and a change with a diff, bound to a content hash", () => {
    const queue = call<ReviewQueueItem[]>("GET", "/operator/reviews", { pending: true });
    expect(queue.map((r) => r.kind)).toEqual(expect.arrayContaining(["FIRST", "CHANGE"]));
    const change = call<ReviewDetail>("GET", `/operator/reviews/${queue.find((r) => r.kind === "CHANGE")!.toolId}`);
    expect(change.changes.length).toBeGreaterThan(0);
    expect(change.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const wrong = refusal(() => call("POST", `/operator/reviews/${change.tool.id}`, {}, { decision: "APPROVE", contentHash: "0".repeat(64) }));
    expect(wrong.code).toBe("TOOL_REVIEW_STALE");
    expect(call<{ decision: string }>("POST", `/operator/reviews/${change.tool.id}`, {}, { decision: "APPROVE", contentHash: change.contentHash }).decision).toBe("APPROVE");
  });

  it("has a takedown to confirm, a confirmed one whose lift waits for two, and promotion groups", () => {
    const all = call<ModerationCutoff[]>("GET", "/operator/cutoffs", { pending: false });
    expect(all.filter((c) => !c.confirmedAt)).toHaveLength(1);
    expect(call<{ approvalId: string }>("POST", "/operator/cutoffs/cut-free-crypto/revert", {}, {}).approvalId).toBeTruthy();
    for (const c of all) expect(call<ReviewDetail>("GET", `/operator/reviews/${c.targetId}`).tool.id).toBe(c.targetId);
    expect(call<{ groups: PromotionGroup[] }>("GET", "/operator/promotions").groups.every((g) => g.tools.length >= 2)).toBe(true);
  });

  it("has open call disputes with every SLA mark", () => {
    const rows = call<{ items: OperatorCallDisputeRow[] }>("GET", "/operator/call-disputes", { state: "OPEN" }).items;
    const marks = new Set(rows.flatMap((d) => slaMarks(d, Date.now()).map((m) => m.label)));
    for (const label of ["Provider may reply", "Provider silent", "Auto-uphold at 72 h", "Decide by 72 h", "Paged · auto-uphold at 72 h", "Paged · decide by 72 h", "Overdue: decide now"]) expect(marks).toContain(label);
    expect(rows.some((d) => d.buyerHistory.flagged)).toBe(true);
    expect(call<{ items: OperatorCallDisputeRow[] }>("GET", "/operator/call-disputes", { state: "OPEN", flaggedOnly: true }).items.every((d) => d.buyerHistory.flagged)).toBe(true);
    const twoPerson = rows.find((d) => d.needsSecondOperator)!;
    expect(call<{ approvalId: string }>("POST", `/operator/call-disputes/${twoPerson.id}/decide`, {}, { decision: "UPHOLD", note: "The ship is on land." }).approvalId).toBeTruthy();
  });
});

describe("buyer and provider reports", () => {
  it("covers open, replied, upheld and refunded, rejected, and refunded because the provider was blocked", () => {
    const { items } = call<{ items: CallDispute[] }>("GET", "/call-disputes");
    const labels = items.map((d) => buyerStatus(d, Date.now()).label);
    expect(labels).toEqual(expect.arrayContaining(["Waiting for the provider", "Waiting for a decision", "Upheld · refunded", "Rejected", "Refunded · decision pending"]));
    expect(items.some((d) => !d.refundGuaranteed && d.state === "OPEN" && d.reason === "OTHER")).toBe(true);
    for (const d of items) expect(call<{ intentId: string }>("GET", `/receipts/${d.intentId}`).intentId).toBe(d.intentId);
  });

  it("offers Report a bad result inside the hold and after it", () => {
    type R = Parameters<typeof reportWindow>[0] & { intentId: string };
    expect(reportWindow(call<R>("GET", `/receipts/${DEMO_HELD_RECEIPT}`), Date.now()).guaranteed).toBe(true);
    const after = reportWindow(call<R>("GET", `/receipts/${DEMO_AFTER_HOLD_RECEIPT}`), Date.now());
    expect([after.open, after.guaranteed]).toEqual([true, false]);
    expect(call<{ items: CallDispute[] }>("GET", "/call-disputes", { intentId: DEMO_HELD_RECEIPT }).items).toEqual([]);
  });

  it("gives the provider reports to reply to, once", () => {
    const { items } = call<{ items: CallDispute[] }>("GET", "/providers/me/call-disputes", { state: "OPEN" });
    const open = items.find((d) => d.canRespond)!;
    expect(call<CallDispute>("POST", `/providers/me/call-disputes/${open.id}/respond`, {}, { response: "Checked." }).providerResponse).toBe("Checked.");
    const replied = items.find((d) => d.providerResponse)!;
    expect(refusal(() => call("POST", `/providers/me/call-disputes/${replied.id}/respond`, {}, { response: "x" })).code).toBe("DISPUTE_ALREADY_RESPONDED");
  });

  it("rings both bells with the new events", () => {
    const buyer = t4Notifications("BUYER") as { event: string; payload: { role?: string; state?: string } }[];
    expect(buyer.map((n) => n.event)).toEqual(["call_dispute.refunded", "call_dispute.responded", "call_dispute.decided", "call_dispute.decided"]);
    expect(buyer.every((n) => n.payload.role === "buyer")).toBe(true);
    expect(buyer.map((n) => n.payload.state)).toContain("REJECTED");
    const provider = (t4Notifications("PROVIDER") as { event: string; payload: { role?: string } }[]).map((n) => n.event);
    expect(provider).toEqual(expect.arrayContaining(["provider_tool.taken_down", "provider_tool.rejected", "provider_tool.promotion_invited", "provider_tool.approved", "call_dispute.opened", "call_dispute.decided"]));
  });
});

describe("public pages", () => {
  it("lists a maker's LISTED tools on its page and in the catalogue", () => {
    const own = call<PublicHandleProfile>("GET", "/public/handles/brightpath");
    expect(own.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["brightpath__company_facts", "brightpath__pdf_tables"]));
    expect(own.tools.some((t) => t.name.includes("lottery"))).toBe(false);
    expect(call<PublicHandleProfile>("GET", "/public/handles/geodesk").tools.length).toBe(2);
    const { tools } = call<{ tools: PublicTool[] }>("GET", "/public/catalogue/tools");
    expect(tools.filter((t) => t.kind === "PROVIDER").length).toBeGreaterThanOrEqual(4);
    expect(tools.some((t) => t.kind === "STANDARD")).toBe(true);
  });
});

describe("a write shows on the next read (this tab's memory)", () => {
  it("a reply sent", () => {
    const open = call<{ items: CallDispute[] }>("GET", "/providers/me/call-disputes", { state: "OPEN" }).items.find((d) => d.canRespond)!;
    call("POST", `/providers/me/call-disputes/${open.id}/respond`, {}, { response: "Checked." });
    const again = call<CallDispute>("GET", `/providers/me/call-disputes/${open.id}`);
    expect([again.providerResponse, again.canRespond, again.autoUpholdAt]).toEqual(["Checked.", false, null]);
  });

  it("a report withdrawn, and one filed from a receipt with what the form said", () => {
    const first = call<{ items: CallDispute[] }>("GET", "/call-disputes").items.find((d) => d.state === "OPEN" && d.canRespond)!;
    call("POST", `/call-disputes/${first.id}/withdraw`);
    expect(call<CallDispute>("GET", `/call-disputes/${first.id}`).state).toBe("WITHDRAWN");
    const filed = call<CallDispute>("POST", "/call-disputes", {}, { subjectType: "PAYMENT_INTENT", subjectId: DEMO_AFTER_HOLD_RECEIPT, reason: "TOO_SLOW", note: "Nine seconds." });
    const read = call<CallDispute>("GET", `/call-disputes/${filed.id}`);
    expect([read.reason, read.note, read.refundGuaranteed]).toEqual(["TOO_SLOW", "Nine seconds.", false]);
    expect(call<{ items: CallDispute[] }>("GET", "/call-disputes").items[0]!.id).toBe(filed.id);
  });

  it("a takedown confirmed leaves the queue", () => {
    expect(call<ModerationCutoff[]>("GET", "/operator/cutoffs", { pending: true })).toHaveLength(1);
    call("POST", "/operator/cutoffs/cut-lottery/confirm");
    expect(call<ModerationCutoff[]>("GET", "/operator/cutoffs", { pending: true })).toHaveLength(0);
  });

  it("publishing a first version ticks the gate's \"A version is published\"", () => {
    const draft = call<{ items: ProviderToolSummary[] }>("GET", "/provider/tools").items.find((t) => t.status === "DRAFT")!;
    const before = call<ProviderToolGate>("GET", `/provider/tools/${draft.id}/publish-check`).requirements.find((r) => r.requirement === "PUBLISHED_VERSION")!;
    expect(before.met).toBe(false);
    call("POST", `/provider/tools/${draft.id}/versions/1/publish`);
    const after = call<ProviderToolGate>("GET", `/provider/tools/${draft.id}/publish-check`).requirements.find((r) => r.requirement === "PUBLISHED_VERSION")!;
    expect(after.met).toBe(true);
    expect(call<ProviderTool>("GET", `/provider/tools/${draft.id}`).currentSemver).toBe("1.0.0");
  });

  it("the blocked-provider refund never waits for a reply", () => {
    const blocked = call<{ items: CallDispute[] }>("GET", "/call-disputes").items.find((d) => d.state === "OPEN" && d.refundState === "REFUNDED")!;
    expect(blocked.autoUpholdAt).toBeNull();
  });

  it("the review content changes a minute after the page first opened it", () => {
    vi.useFakeTimers();
    const cobalt = "3e9b7f15-6c20-4d84-a1e7-5f0c2b8d4a93";
    const first = call<ReviewDetail>("GET", `/operator/reviews/${cobalt}`).contentHash;
    vi.setSystemTime(Date.now() + 61_000);
    expect(call<ReviewDetail>("GET", `/operator/reviews/${cobalt}`).contentHash).not.toBe(first);
    vi.useRealTimers();
  });

  it("the operator queue has more than one page", () => {
    const page1 = call<{ items: OperatorCallDisputeRow[]; pageInfo: { hasMore: boolean; nextCursor: string | null } }>("GET", "/operator/call-disputes", { state: "OPEN", order: "ASC", limit: 20 });
    expect(page1.pageInfo.hasMore).toBe(true);
    const page2 = call<{ items: OperatorCallDisputeRow[] }>("GET", "/operator/call-disputes", { state: "OPEN", order: "ASC", limit: 20, cursor: page1.pageInfo.nextCursor });
    expect(page2.items.length).toBeGreaterThan(0);
    expect(Date.parse(page1.items[0]!.createdAt)).toBeLessThanOrEqual(Date.parse(page1.items[1]!.createdAt));
  });
});
