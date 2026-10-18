import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Receipt } from "@/features/g30/wire";
import type { CallDispute } from "@/services/call-disputes.service";

import { buyerStatus } from "./model";
import { ReceiptReport } from "./receipt-report";
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
  createdAt: FILED,
  updatedAt: "2026-10-18T10:20:00.000Z",
};

describe("the report timeline", () => {
  it("shows a refund that landed before the decision (the provider was blocked)", () => {
    const words = text(renderToStaticMarkup(<DisputeTimeline dispute={dispute} side="buyer" now={t0 + 30 * 60_000} />));
    expect(words).toContain("Reported");
    expect(words).toContain("Provider may reply");
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
      chargedPrice: usd,
    } as unknown as Receipt;
    const client = new QueryClient();
    const words = text(renderToStaticMarkup(<QueryClientProvider client={client}><ReceiptReport receipt={receipt} toolName="acme__search_posts" /></QueryClientProvider>));
    vi.useRealTimers();
    expect(words).toContain("Bad result?");
    expect(words).toContain("The payment is still held");
    expect(words).toContain("Report a bad result");
  });
});
