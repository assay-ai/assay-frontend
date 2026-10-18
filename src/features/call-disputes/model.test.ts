import { describe, expect, it } from "vitest";

import { ApiError } from "@/libs/ApiClient";
import type { CallDispute } from "@/services/call-disputes.service";

import { BUYER_COPY, buyerStatus, decisionDueAt, DISPUTE_COPY, shortRef, disputeQueueQuery, disputeErrorText, disputeTimeline, providerStatus, replyDueAt, reportWindow, slaMarks } from "./model";

const FILED = "2026-10-18T10:00:00.000Z";
const H = 3_600_000;
const t0 = Date.parse(FILED);
const usd = (amount: string) => ({ amount, asset: "eip155:1/erc20:0xusd", decimals: 6 });

const dispute = (over: Partial<CallDispute> = {}): CallDispute => ({
  id: "d1",
  state: "OPEN",
  reason: "WRONG_DATA",
  reasonLabel: "Wrong data",
  note: null,
  intentId: "i1",
  verdictId: null,
  toolId: "tool-1",
  bindingId: "b1",
  providerId: "p1",
  amount: usd("20000"),
  providerResponse: null,
  providerRespondedAt: null,
  resolvedAt: null,
  resolutionNote: null,
  refundSource: null,
  refundState: null,
  refundAmount: null,
  restoredAmount: null,
  canRespond: true,
  refundGuaranteed: true,
  refundNotice: "Filed inside the dispute window",
  replyDueAt: "2026-10-19T10:00:00.000Z",
  pageAt: "2026-10-20T10:00:00.000Z",
  decisionDueAt: "2026-10-21T10:00:00.000Z",
  autoUpholdAt: "2026-10-21T10:00:00.000Z",
  holdEndsAt: "2026-10-25T11:00:00.000Z",
  filingClosesAt: "2026-10-25T10:00:00.000Z",
  createdAt: FILED,
  updatedAt: FILED,
  ...over,
});

const ids = (steps: { id: string; state: string }[]) => steps.map((s) => `${s.id}:${s.state}`);

describe("deadlines", () => {
  it("reply in 24 h, decision in 72 h, from the filing", () => {
    expect(replyDueAt(dispute())).toBe("2026-10-19T10:00:00.000Z");
    expect(decisionDueAt(dispute())).toBe("2026-10-21T10:00:00.000Z");
  });
});

describe("the timeline", () => {
  it("held, waiting for the provider", () => {
    const steps = disputeTimeline(dispute(), t0 + H);
    expect(ids(steps)).toEqual(["reported:done", "reply:current", "decision:upcoming", "refund:upcoming"]);
    expect(steps[0]!.description).toMatch(/held, not paid out/);
    expect(steps[2]!.description).toMatch(/accepted automatically at 72 hours/);
  });

  it("the provider replied: an operator decides", () => {
    const steps = disputeTimeline(dispute({ providerRespondedAt: "2026-10-18T12:00:00.000Z", canRespond: false }), t0 + 3 * H);
    expect(ids(steps)).toEqual(["reported:done", "reply:done", "decision:current", "refund:upcoming"]);
  });

  it("silent provider past 24 h", () => {
    expect(ids(disputeTimeline(dispute({ canRespond: false }), t0 + 30 * H))).toEqual(["reported:done", "reply:skipped", "decision:current", "refund:upcoming"]);
  });

  it("upheld and refunded", () => {
    const steps = disputeTimeline(dispute({ state: "UPHELD", resolvedAt: "2026-10-20T10:00:00.000Z", refundState: "REFUNDED", restoredAmount: usd("20000") }), t0 + 50 * H);
    expect(ids(steps)).toEqual(["reported:done", "reply:skipped", "decision:done", "refund:done"]);
    expect(steps[3]!.label).toBe("Refunded $0.02");
  });

  it("the blocked-provider refund lands before any decision", () => {
    const steps = disputeTimeline(dispute({ refundState: "REFUNDED" }), t0 + 2 * H);
    expect(ids(steps)).toEqual(["reported:done", "reply:skipped", "refunded-early:done", "decision:upcoming"]);
    expect(steps[1]!.label).toBe("No reply needed: provider blocked");
  });

  it("rejected, but refunded anyway because the provider was blocked", () => {
    const steps = disputeTimeline(dispute({ state: "REJECTED", resolvedAt: "2026-10-19T10:00:00.000Z", refundState: "REFUNDED" }), t0 + 30 * H);
    expect(steps.at(-1)).toMatchObject({ id: "refund", label: "Refunded anyway", state: "done" });
  });

  it("filed after the hold, upheld, provider already paid", () => {
    const steps = disputeTimeline(dispute({ refundGuaranteed: false, state: "UPHELD", resolvedAt: FILED, refundState: "NOT_REFUNDABLE" }), t0 + H);
    expect(steps[0]!.description).toMatch(/After the 1-hour hold/);
    expect(steps.at(-1)).toMatchObject({ label: "Not refundable", state: "failed" });
  });

  it("withdrawn ends the timeline", () => {
    expect(ids(disputeTimeline(dispute({ state: "WITHDRAWN" }), t0 + H))).toEqual(["reported:done", "reply:skipped", "decision:skipped"]);
  });
});

describe("one-line status", () => {
  it("for the buyer", () => {
    expect(buyerStatus(dispute(), t0 + H).label).toBe("Waiting for the provider");
    expect(buyerStatus(dispute(), t0 + 25 * H).label).toBe("Waiting for a decision");
    expect(buyerStatus(dispute({ refundState: "REFUNDED" }), t0 + H)).toMatchObject({ label: "Refunded · decision pending", tone: "teal" });
    expect(buyerStatus(dispute({ state: "UPHELD", refundState: "PENDING" }), t0).label).toBe("Accepted · refund on its way");
    expect(buyerStatus(dispute({ state: "REJECTED" }), t0).label).toBe("Not accepted");
  });

  it("for the provider", () => {
    expect(providerStatus(dispute(), t0 + H).label).toBe("Reply needed");
    expect(providerStatus(dispute({ canRespond: false }), t0 + 25 * H).label).toBe("Reply window closed");
    expect(providerStatus(dispute({ canRespond: false, providerRespondedAt: FILED }), t0 + 2 * H).label).toBe("Waiting for a decision");
  });
});

describe("operator SLA marks", () => {
  it("counts from the filing", () => {
    expect(slaMarks(dispute(), t0 + H).map((m) => m.label)).toEqual(["Provider may reply", "Auto-uphold at 72 h"]);
    expect(slaMarks(dispute(), t0 + 49 * H).map((m) => [m.label, m.tone])).toEqual([
      ["Provider silent", "warning"],
      ["Paged · auto-uphold at 72 h", "danger"],
    ]);
    expect(slaMarks(dispute({ providerRespondedAt: FILED, autoUpholdAt: null }), t0 + 73 * H).map((m) => m.label)).toEqual(["Overdue: decide now"]);
    expect(slaMarks(dispute({ state: "UPHELD" }), t0)).toEqual([]);
    expect(slaMarks(dispute({ autoUpholdAt: null }), t0 + 25 * H).map((m) => m.label)).toContain("No auto-uphold: a large refund needs two operators");
    expect(slaMarks(dispute({ autoUpholdAt: null, refundGuaranteed: false }), t0 + 25 * H).map((m) => m.label)).toContain("No auto-uphold: filed after the hold");
  });
});

describe("the report window on a receipt", () => {
  const receipt = { status: "SETTLED", createdAt: FILED, settledAt: FILED, disputeWindowEndsAt: "2026-10-18T11:00:00.000Z", disputeFilingClosesAt: "2026-10-25T10:00:00.000Z", chargedPrice: usd("20000") };
  it("inside the hold: a full refund if upheld", () => {
    expect(reportWindow(receipt, t0 + 30 * 60_000)).toMatchObject({ open: true, guaranteed: true, holdEndsAt: "2026-10-18T11:00:00.000Z" });
  });
  it("after the hold: still open, no refund, a quality signal", () => {
    expect(reportWindow(receipt, t0 + 2 * H)).toMatchObject({ open: true, guaranteed: false });
    expect(reportWindow(receipt, t0 + 2 * H).text).toMatch(/^The 1-hour hold has ended, so there is no refund/);
  });
  // B2 review C1: a rail-B voucher not yet redeemed into the hold has no hold fields, and a report filed then IS guaranteed.
  it("before the payment is collected: a full refund, never 'No refund'", () => {
    const fresh = { ...receipt, disputeWindowEndsAt: null, collectableAt: null };
    const view = reportWindow(fresh, t0 + 5 * 60_000);
    expect(view).toMatchObject({ open: true, guaranteed: true, holdEndsAt: null });
    expect(view.text).toMatch(/not been collected yet.*refunded in full/);
    expect(view.text).not.toMatch(/no refund/i);
  });
  // Re-review R1: the backend guarantees a not-yet-held call only while nothing else happened to the payment.
  it("with a released hold, a debt or a forfeit: neither a refund promise nor 'no refund'", () => {
    const bare = { ...receipt, disputeWindowEndsAt: null, collectableAt: null };
    for (const over of [
      { holdReleasedAt: "2026-10-18T10:10:00.000Z" },
      { debt: "OUTSTANDING" },
      { forfeited: true },
      { chargeNote: "uncollected:DelegateIsRevoked" },
    ]) {
      const view = reportWindow({ ...bare, ...over }, t0 + 5 * 60_000);
      expect(view).toMatchObject({ open: true, guaranteed: false, holdEndsAt: null });
      expect(view.text).not.toMatch(/refunded in full|no refund/i);
    }
  });
  it("closed after 7 days, and for calls that did not settle", () => {
    expect(reportWindow(receipt, t0 + 8 * 24 * H).open).toBe(false);
    expect(reportWindow({ ...receipt, disputeFilingClosesAt: null }, t0).open).toBe(false);
  });
});

describe("the operator queue's query", () => {
  it("reads open disputes oldest first, so the ones closest to auto-uphold load on the first page", () => {
    expect(disputeQueueQuery("open", false)).toMatchObject({ state: ["OPEN"], order: "asc" });
    expect(disputeQueueQuery("all", true, "c2")).toEqual({ order: "desc", flaggedOnly: true, cursor: "c2", limit: 20 });
  });
});

describe("errors", () => {
  it("says what happened", () => {
    expect(disputeErrorText(new ApiError("DISPUTE_ALREADY_OPEN", "x", 409))).toMatch(/already reported/);
    expect(disputeErrorText(new ApiError("DISPUTE_RATE_LIMITED", "x", 429))).toMatch(/in 24 hours/);
  });
});

describe("the decided dispute copy", () => {
  it("keeps one clock per sentence and the 7-day timeout out of the status", () => {
    for (const text of Object.values(DISPUTE_COPY)) expect((text.match(/\d+ (hours|days)/g) ?? []).length).toBeLessThanOrEqual(1);
    const open = buyerStatus(dispute(), t0 + H).detail;
    expect(open).not.toMatch(/7 days/);
    expect(buyerStatus(dispute({ refundGuaranteed: false }), t0 + H).detail).toMatch(/^This report is not covered by the refund guarantee, so there is no refund for this call\. .*penalty on their stake/);
  });
});

describe("buyer words", () => {
  it("never say upheld or operator to a buyer", () => {
    const states = ["OPEN", "UPHELD", "REJECTED", "WITHDRAWN"] as const;
    const refunds = [null, "REFUNDED", "PENDING", "NOT_REFUNDABLE", "NOT_CHARGED"];
    const texts: string[] = [...Object.values(BUYER_COPY)];
    for (const state of states) for (const refundState of refunds) {
      const v = buyerStatus(dispute({ state, refundState }), t0 + H);
      texts.push(v.label, v.detail);
      for (const step of disputeTimeline(dispute({ state, refundState, refundGuaranteed: false }), t0 + H, "buyer")) texts.push(String(step.label), String(step.description ?? ""));
    }
    for (const text of texts) expect(text).not.toMatch(/upheld|operator/i);
  });

  it("an after-hold report says what accepting it means for the money", () => {
    expect(BUYER_COPY.afterHold).toMatch(/no refund for this call\. If your report is accepted, it counts against the provider's quality and can lead to a penalty on their stake/);
  });

  it("refer to an organization by a short, stable reference, never its id", () => {
    expect(shortRef("org-buyer")).toMatch(/^#[0-9a-f]{6}$/);
    expect(shortRef("3f9c2a71-5b08-4d6e-9a14-7c2e0b5d8f13")).not.toContain("3f9c2a71");
    expect(shortRef("org-buyer")).toBe(shortRef("org-buyer"));
    expect(shortRef("org-buyer")).not.toBe(shortRef("org-buyer-2"));
  });
});
