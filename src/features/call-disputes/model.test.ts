import { describe, expect, it } from "vitest";

import { ApiError } from "@/libs/ApiClient";
import type { CallDispute } from "@/services/call-disputes.service";

import {
  BUYER_COPY,
  buyerStatus,
  DEADLINE_SENTENCE,
  decisionDueAt,
  DISPUTE_COPY,
  disputeReasonLabel,
  filedToast,
  fullDateTime,
  reportUntilText,
  shortRef,
  disputeQueueQuery,
  disputeErrorText,
  disputeTimeline,
  providerStatus,
  refundPlanText,
  replyDueAt,
  reportWindow,
  slaMarks,
} from "./model";

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
    expect(steps[2]!.description).toMatch(/can be accepted automatically from 72 hours; if it is, you are refunded in full/);
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
    const steps = disputeTimeline(dispute({ refundGuaranteed: false, state: "UPHELD", resolvedAt: FILED, refundState: "NOT_REFUNDABLE" }), t0 + H, "buyer", "1-hour");
    expect(steps[0]!.description).toMatch(/After the 1-hour hold/);
    // The hold is the chain's: another value reads as another value, and none before it is known.
    expect(disputeTimeline(dispute({ refundGuaranteed: false }), t0 + H, "buyer", "2-hour")[0]!.description).toMatch(/After the 2-hour hold/);
    expect(disputeTimeline(dispute({ refundGuaranteed: false }), t0 + H)[0]!.description).toMatch(/After the — hold/);
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
    expect(slaMarks(dispute(), t0 + H).map((m) => m.label)).toEqual(["Provider may reply", "Auto-uphold from 72 h"]);
    expect(slaMarks(dispute(), t0 + 49 * H).map((m) => [m.label, m.tone])).toEqual([
      ["Provider silent", "warning"],
      ["Paged · auto-uphold from 72 h", "danger"],
    ]);
    expect(slaMarks(dispute({ providerRespondedAt: FILED, autoUpholdAt: null }), t0 + 73 * H).map((m) => m.label)).toEqual(["Overdue: decide now"]);
    expect(slaMarks(dispute({ state: "UPHELD" }), t0)).toEqual([]);
    expect(slaMarks(dispute({ autoUpholdAt: null }), t0 + 25 * H).map((m) => m.label)).toContain("No auto-uphold: a large refund needs two operators");
    expect(slaMarks(dispute({ autoUpholdAt: null, refundGuaranteed: false }), t0 + 25 * H).map((m) => m.label)).toContain("No auto-uphold: filed after the hold");
  });
});

describe("the report window on a receipt", () => {
  const receipt = { status: "SETTLED", createdAt: FILED, settledAt: FILED, disputeWindowEndsAt: "2026-10-18T11:00:00.000Z", disputeFilingClosesAt: "2026-10-25T10:00:00.000Z", chargedPrice: usd("20000"), refundableIfReportedNow: true };
  it("inside the hold, and the backend says a report now is refunded: a full refund if upheld", () => {
    expect(reportWindow(receipt, t0 + 30 * 60_000)).toMatchObject({ open: true, guaranteed: true, holdEndsAt: "2026-10-18T11:00:00.000Z" });
    expect(reportWindow(receipt, t0 + 30 * 60_000).text).toMatch(/still held.*refunded in full/);
  });
  it("after the hold: still open, no refund, a quality signal", () => {
    const after = { ...receipt, refundableIfReportedNow: false };
    expect(reportWindow(after, t0 + 2 * H)).toMatchObject({ open: true, guaranteed: false });
    expect(reportWindow(after, t0 + 2 * H, "1-hour").text).toMatch(/^The 1-hour hold has ended, so there is no refund/);
  });
  // B2 review C1: a rail-B voucher not yet redeemed into the hold has no hold fields, and a report filed then IS guaranteed.
  it("before the payment is collected, when the backend guarantees it: a full refund, never 'No refund'", () => {
    const fresh = { ...receipt, disputeWindowEndsAt: null, collectableAt: null };
    const view = reportWindow(fresh, t0 + 5 * 60_000);
    expect(view).toMatchObject({ open: true, guaranteed: true, holdEndsAt: null });
    expect(view.text).toMatch(/not been collected yet.*refunded in full/);
    expect(view.text).not.toMatch(/no refund/i);
  });
  // Wave-1 audit I1: the promise is the backend's (`refundableIfReportedNow`), never inferred from the hold fields.
  it("without the backend's guarantee (no escrow hold on the chain, the last minute, a flag missing): no refund promise", () => {
    const bare = { ...receipt, disputeWindowEndsAt: null, collectableAt: null };
    for (const over of [
      { refundableIfReportedNow: false },
      { refundableIfReportedNow: undefined },
      { holdReleasedAt: "2026-10-18T10:10:00.000Z", refundableIfReportedNow: false },
      { debt: "OUTSTANDING", refundableIfReportedNow: false },
    ]) {
      const view = reportWindow({ ...bare, ...over }, t0 + 5 * 60_000);
      expect(view).toMatchObject({ open: true, guaranteed: false, holdEndsAt: null });
      expect(view.text).not.toMatch(/refunded in full|no refund/i);
    }
    // Inside the hour, but the backend would not guarantee it (e.g. within its last minute).
    const late = reportWindow({ ...receipt, refundableIfReportedNow: false }, t0 + 59.5 * 60_000);
    expect(late).toMatchObject({ open: true, guaranteed: false, holdEndsAt: null });
    expect(late.text).not.toMatch(/refunded in full|no refund/i);
  });
  // W1A review C1: the flag was true when fetched; the page stayed open past the hold.
  it("a stale 'true' after the hold has ended never says 'refunded in full'", () => {
    const view = reportWindow(receipt, t0 + 2 * H, "1-hour");
    expect(view).toMatchObject({ open: true, guaranteed: false, holdEndsAt: null });
    expect(view.text).not.toMatch(/refunded in full/);
    expect(view.text).toMatch(/^The 1-hour hold has ended/);
  });
  it("a stale 'true' past the backend's refundableIfReportedUntil promises nothing, even with no hold fields", () => {
    const until = "2026-10-18T10:20:00.000Z";
    const bounded = { ...receipt, refundableIfReportedUntil: until };
    expect(reportWindow(bounded, Date.parse(until) - 60_000)).toMatchObject({ guaranteed: true, holdEndsAt: until });
    expect(reportWindow(bounded, Date.parse(until))).toMatchObject({ guaranteed: false });
    expect(reportWindow(bounded, Date.parse(until)).text).not.toMatch(/refunded in full/);
    const unredeemed = { ...bounded, disputeWindowEndsAt: null, collectableAt: null };
    expect(reportWindow(unredeemed, Date.parse(until) + 1).text).not.toMatch(/refunded in full|no refund/i);
  });
  it("closed after 7 days, and for calls that did not settle", () => {
    expect(reportWindow(receipt, t0 + 8 * 24 * H)).toMatchObject({ open: false, guaranteed: false });
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
    expect(disputeErrorText(new ApiError("DISPUTE_ALREADY_DECIDED", "x", 409))).toBe("This call's report was already decided, so it can't be reported again.");
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

describe("B7 report copy", () => {
  // Owner rule: the daily auto-uphold cap can defer it, so no copy says it happens at a time.
  const FORBIDDEN = [/upheld automatically at/i, /accepted automatically at/i, /buyer wins/i];
  const all = (texts: string[]) => texts.forEach((text) => FORBIDDEN.forEach((rule) => expect(text).not.toMatch(rule)));

  it("never says a report is upheld or accepted automatically AT a time, on either side", () => {
    all([
      ...Object.values(DISPUTE_COPY),
      ...Object.values(BUYER_COPY),
      ...Object.values(DEADLINE_SENTENCE),
      providerStatus(dispute(), t0 + H).detail,
      providerStatus(dispute({ canRespond: false }), t0 + 25 * H).detail,
      ...disputeTimeline(dispute(), t0 + H).map((step) => String(step.description ?? "")),
      ...disputeTimeline(dispute(), t0 + H, "provider").map((step) => String(step.description ?? "")),
    ]);
    expect(DEADLINE_SENTENCE.provider).toBe("Reply within 24 h. If you don't, the report can be upheld automatically from 72 h.");
    expect(DEADLINE_SENTENCE.buyer).toBe("The provider has 24 h to reply. If it doesn't, your report can be accepted automatically from 72 h.");
    expect(providerStatus(dispute(), t0 + H).detail).toContain("can be upheld automatically from Oct 21, 10:00 UTC");
  });

  it("names a refund in the automatic acceptance only when the backend guarantees one", () => {
    const guaranteed = disputeTimeline(dispute(), t0 + H).find((s) => s.id === "decision")!;
    const notGuaranteed = disputeTimeline(dispute({ refundGuaranteed: false }), t0 + H).find((s) => s.id === "decision")!;
    expect(guaranteed.description).toContain("you are refunded in full");
    expect(notGuaranteed.description).not.toMatch(/refund/i);
  });

  it("the toast says when it is answered and decided, never the outcome", () => {
    const text = filedToast(dispute(), t0);
    expect(text).toBe("Reported. The provider has 24 h to reply; we decide by Oct 21, 10:00 UTC.");
    expect(text).not.toMatch(/counts against|refunded|upheld/i);
  });

  it("full dates, one reason label, and the filing deadline", () => {
    expect(fullDateTime(FILED, t0)).toBe("Oct 18, 10:00 UTC");
    expect(disputeReasonLabel(dispute({ reason: "OTHER", reasonLabel: "Other" }))).toBe("Something else");
    expect(disputeReasonLabel(dispute({ reason: "NEW_REASON", reasonLabel: "A new reason" }))).toBe("A new reason");
    expect(reportUntilText("2026-10-25T10:00:00.000Z", t0)).toBe("You can report this call until Oct 25, 10:00 UTC.");
    expect(reportUntilText("2026-10-25T10:00:00.000Z", Date.parse("2026-10-26T00:00:00.000Z"))).toBeNull();
    expect(reportUntilText(null, t0)).toBeNull();
  });
});

// BUG-RETEST-R5a-03: decided in its first minute, the reply window never closed.
describe("the reply row of a dispute decided early", () => {
  it("says the reply was not needed, never 'Window closed' with a future date", () => {
    const early = dispute({ state: "UPHELD", resolvedAt: "2026-10-18T10:01:00.000Z", refundState: "REFUNDED" });
    const reply = disputeTimeline(early, t0 + 2 * 60_000).find((step) => step.id === "reply")!;
    expect(reply).toMatchObject({
      label: "No reply needed: decided before the reply window ended",
      state: "skipped",
      date: "2026-10-19T10:00:00.000Z",
      dateLabel: "Would have closed",
    });
  });

  it("keeps 'Window closed' when the window had closed before the decision", () => {
    const late = dispute({ state: "UPHELD", resolvedAt: "2026-10-19T12:00:00.000Z", refundState: "REFUNDED" });
    const reply = disputeTimeline(late, t0 + 30 * H).find((step) => step.id === "reply")!;
    expect(reply).toMatchObject({ label: "No reply from the provider", dateLabel: "Window closed" });
  });
});

// BUG-RETEST-R5a-02: a normal decided dispute is not "a decision being retried".
describe("refundPlanText", () => {
  it("says plainly that the refund landed", () => {
    expect(refundPlanText("ALREADY_REFUNDED", "UPHELD")).toBe("Refunded to the buyer. Deciding again moves no money.");
    expect(refundPlanText("ALREADY_REFUNDED", "OPEN")).toBe("Already refunded to the buyer. Deciding moves no money.");
    expect(refundPlanText("RELEASE_HELD", "OPEN")).toMatch(/^Upholding returns the held payment/);
    expect(refundPlanText("SOMETHING_NEW", "OPEN")).toBe("SOMETHING_NEW");
    expect(refundPlanText("ALREADY_REFUNDED", "UPHELD")).not.toMatch(/retried/);
  });
});
