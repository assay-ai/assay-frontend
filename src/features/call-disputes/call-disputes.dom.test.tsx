import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Receipt } from "@/features/g30/wire";
import type { CallDispute } from "@/services/call-disputes.service";

import { buyerStatus } from "./model";
import { ReceiptReport, RefundableNow, receiptReportState } from "./receipt-report";
import { DisputeChip, DisputeTimeline, EvidencePanes } from "./ui";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/" }));

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const FILED = "2026-10-18T10:00:00.000Z";
const t0 = Date.parse(FILED);
const usd = { amount: "20000", asset: "eip155:1/erc20:0xusd", decimals: 6 };

const dispute: CallDispute = {
  id: "d1",
  state: "OPEN",
  reason: "EMPTY_OR_GARBAGE",
  reasonLabel: "Empty or garbage result",
  note: null,
  intentId: "i1",
  verdictId: null,
  toolId: "tool-1",
  bindingId: "b1",
  providerId: "p1",
  amount: usd,
  providerResponse: null,
  providerRespondedAt: null,
  resolvedAt: null,
  resolutionNote: null,
  refundSource: null,
  refundState: "REFUNDED",
  refundAmount: null,
  restoredAmount: usd,
  canRespond: true,
  refundGuaranteed: true,
  refundNotice: "",
  replyDueAt: "2026-10-19T10:00:00.000Z",
  pageAt: "2026-10-20T10:00:00.000Z",
  decisionDueAt: "2026-10-21T10:00:00.000Z",
  autoUpholdAt: null,
  holdEndsAt: null,
  filingClosesAt: "2026-10-25T10:00:00.000Z",
  createdAt: FILED,
  updatedAt: "2026-10-18T10:20:00.000Z",
};

describe("the report timeline", () => {
  it("shows a refund that landed before the decision (the provider was blocked)", () => {
    const words = text(renderToStaticMarkup(<DisputeTimeline dispute={dispute} side="buyer" now={t0 + 30 * 60_000} />));
    expect(words).toContain("Reported");
    expect(words).toContain("No reply needed: provider blocked");
    expect(words).toContain("Refunded");
    expect(words).toContain("The provider was blocked");
    expect(words).toContain("Decided by");
  });

  it("the chip says it in a word", () => {
    expect(text(renderToStaticMarkup(<DisputeChip view={buyerStatus(dispute, t0)} />))).toContain("Refunded");
  });
});

describe("the evidence", () => {
  it("shows the captured request and response", () => {
    const words = text(renderToStaticMarkup(<EvidencePanes evidence={{ request: { q: "rain" }, response: { posts: [] } }} />));
    expect(words).toContain("REQUEST");
    expect(words).toContain('"q": "rain"');
  });

  it("says when nothing was kept", () => {
    expect(text(renderToStaticMarkup(<EvidencePanes evidence={{}} />))).toContain("were not kept");
  });
});

describe("the receipt's Report a bad result", () => {
  it("offers the report while the payment is held", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(t0 + 10 * 60_000));
    const receipt = {
      intentId: "i1",
      toolId: "tool-1",
      status: "SETTLED",
      createdAt: FILED,
      settledAt: FILED,
      disputeWindowEndsAt: "2026-10-18T11:00:00.000Z",
      disputeFilingClosesAt: "2026-10-25T10:00:00.000Z",
      chargedPrice: usd,
      refundableIfReportedNow: true,
    } as unknown as Receipt;
    const client = new QueryClient();
    const words = text(renderToStaticMarkup(<QueryClientProvider client={client}><ReceiptReport receipt={receipt} toolName="acme__search_posts" /></QueryClientProvider>));
    vi.useRealTimers();
    expect(words).toContain("Bad result?");
    expect(words).toContain("The payment is still held");
    expect(words).toContain("Report a bad result");
  });

  // W1A review C1: a receipt fetched inside the hold, with the tab left open past it.
  it("the headline renders nothing once a stale 'true' outlives the hold", () => {
    const receipt = {
      intentId: "i1",
      toolId: "tool-1",
      status: "SETTLED",
      createdAt: FILED,
      settledAt: FILED,
      disputeWindowEndsAt: "2026-10-18T11:00:00.000Z",
      disputeFilingClosesAt: "2026-10-25T10:00:00.000Z",
      chargedPrice: usd,
      refundableIfReportedNow: true,
      refundableIfReportedUntil: "2026-10-18T10:59:00.000Z",
    } as unknown as Receipt;
    const client = new QueryClient();
    const later = t0 + 2 * 60 * 60_000;
    const headline = renderToStaticMarkup(<QueryClientProvider client={client}><RefundableNow receipt={receipt} toolName="acme__search_posts" now={later} /></QueryClientProvider>);
    const report = text(renderToStaticMarkup(<QueryClientProvider client={client}><ReceiptReport receipt={receipt} toolName="acme__search_posts" now={later} /></QueryClientProvider>));
    expect(headline).toBe("");
    expect(report).not.toMatch(/refunded in full|full refund/);
  });

  // Wave-1 audit I1: a chain without the escrow hold looks the same on the hold fields; the backend says no.
  it("promises no refund in the hold when the backend would not guarantee one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(t0 + 10 * 60_000));
    const receipt = {
      intentId: "i1",
      toolId: "tool-1",
      status: "SETTLED",
      createdAt: FILED,
      settledAt: FILED,
      disputeWindowEndsAt: "2026-10-18T11:00:00.000Z",
      disputeFilingClosesAt: "2026-10-25T10:00:00.000Z",
      chargedPrice: usd,
      refundableIfReportedNow: false,
    } as unknown as Receipt;
    const client = new QueryClient();
    const report = text(renderToStaticMarkup(<QueryClientProvider client={client}><ReceiptReport receipt={receipt} toolName="acme__search_posts" /></QueryClientProvider>));
    const headline = renderToStaticMarkup(<QueryClientProvider client={client}><RefundableNow receipt={receipt} toolName="acme__search_posts" now={t0 + 10 * 60_000} /></QueryClientProvider>);
    vi.useRealTimers();
    expect(report).not.toMatch(/refunded in full|full refund/);
    expect(report).toContain("Report a bad result");
    expect(headline).toBe("");
  });
});

// Re-review R2: only a report covered by the refund guarantee keeps the payment held.
describe("receiptReportState", () => {
  it("is open only for an open report with the refund guarantee", () => {
    expect(receiptReportState([{ state: "OPEN", refundGuaranteed: true }])).toBe("open");
    expect(receiptReportState([{ state: "OPEN", refundGuaranteed: false }])).toBe("closed");
    expect(receiptReportState([{ state: "REJECTED", refundGuaranteed: true }])).toBe("closed");
    expect(receiptReportState([{ state: "WITHDRAWN", refundGuaranteed: true }])).toBe("none");
    expect(receiptReportState(undefined)).toBe("none");
  });
});

// BUG-PROD-BUY-SPEND-02: one decided report per call is final (the API answers DISPUTE_ALREADY_DECIDED).
describe("Report it again", () => {
  const receipt = {
    intentId: "i1",
    toolId: "tool-1",
    status: "SETTLED",
    createdAt: FILED,
    settledAt: FILED,
    disputeWindowEndsAt: "2026-10-18T11:00:00.000Z",
    disputeFilingClosesAt: "2026-10-25T10:00:00.000Z",
    chargedPrice: usd,
    refundableIfReportedNow: false,
  } as unknown as Receipt;
  const later = t0 + 2 * 60 * 60_000;
  const reportBox = (items: CallDispute[]) => {
    const client = new QueryClient();
    client.setQueryData(["call-disputes", "buyer", "intent", "i1"], { items });
    return text(renderToStaticMarkup(<QueryClientProvider client={client}><ReceiptReport receipt={receipt} toolName="acme__search_posts" now={later} /></QueryClientProvider>));
  };

  it("is offered after a withdrawn report", () => {
    expect(reportBox([{ ...dispute, state: "WITHDRAWN" }])).toContain("Report it again");
  });

  it("is not offered once a report was decided, even under a later withdrawn one", () => {
    expect(reportBox([{ ...dispute, state: "UPHELD" }])).not.toContain("Report it again");
    expect(reportBox([{ ...dispute, state: "REJECTED" }])).not.toContain("Report it again");
    expect(
      reportBox([
        { ...dispute, id: "d2", state: "WITHDRAWN", createdAt: "2026-10-18T11:30:00.000Z" },
        { ...dispute, state: "REJECTED" },
      ]),
    ).not.toContain("Report it again");
  });
});
