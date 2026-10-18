import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Receipt } from "@/features/g30/wire";
import { DEMO_NOW_MS } from "@/libs/demo/demo-clock";
// The matcher first: the per-area fixture files import each other through it.
import "@/libs/demo/fixtures";
import { demoSettledReceipt } from "@/libs/demo/fixtures-buyer";

import ReceiptPage from "./page";

/*
  The receipt page as a whole: one story from the headline down to the
  timeline (FIX-PLAN P0-2), and the 1-hour hold on the timeline.
*/
let intentId = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
  usePathname: () => "/receipts/view",
  useSearchParams: () => new URLSearchParams({ id: intentId }),
}));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: false, authenticated: false }) }));

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

function render(receipt: Receipt): string {
  intentId = receipt.intentId;
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["receipt", receipt.intentId], receipt);
  client.setQueryData(["receipt-evidence", receipt.intentId], null);
  client.setQueryData(["call-disputes", "buyer", "intent", receipt.intentId], { items: [] });
  return text(renderToStaticMarkup(<QueryClientProvider client={client}><ReceiptPage /></QueryClientProvider>));
}

/** The timeline panel's words: from its title to the details row. */
function timelineOf(words: string): string {
  const start = words.indexOf("Timeline");
  return words.slice(start, words.indexOf("Provider identity", start));
}

const usd = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x1", decimals: 6 });
const notReached = ["SCHEMA", "DETERMINISTIC_RULES", "CROSS_CHECK", "SEMANTIC"].map((stage) => ({
  stage,
  status: "NOT_REACHED",
  passed: false,
  note: "checks stop at the first failure",
  detail: "checks stop at the first failure",
}));

afterEach(() => vi.useRealTimers());

describe("the receipt page tells one story", () => {
  it("a settled call with no check record (e17d…0007) never says 'Check passed' or 'not charged'", () => {
    const receipt = {
      intentId: "e17d0000-0000-0000-0000-000000000007",
      toolId: "tool-rate",
      providerId: null,
      classification: "DATA_RESULT",
      status: "SETTLED",
      listedPrice: usd("20000"),
      chargedPrice: usd("20000"),
      withheld: usd("0"),
      verdict: { status: null },
      stages: notReached,
      policy: {},
      sampling: {},
      createdAt: "2026-10-13T17:55:23.000Z",
      expiresAt: "2026-10-13T18:00:23.000Z",
      updatedAt: "2026-10-13T18:10:00.000Z",
      holdReleasedAt: "2026-10-13T18:10:00.000Z",
      evaluatedAt: null,
      settledAt: null,
      collectableAt: null,
      disputeWindowEndsAt: null,
      disputeFilingClosesAt: null,
    } as unknown as Receipt;
    const words = render(receipt);
    expect(words).toContain("Charged $0.02. Served; no check result was recorded for this call.");
    expect(words).toContain("Served (not checked)");
    expect(words).not.toContain("Check passed");
    expect(words).not.toContain("No result recorded");
    const timeline = timelineOf(words);
    expect(timeline).toContain("Charged");
    expect(timeline).not.toContain("not charged");
    expect(timeline).not.toContain("Hold released");
  });

  it("a demo charged call inside the hold: unchanged story, plus the countdown and the hold rows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEMO_NOW_MS);
    const receipt = demoSettledReceipt("5e1d0c2a-7b44-4f19-a3e8-0c9d6b2f4a71", "geocode", 15) as unknown as Receipt;
    const words = render(receipt);
    expect(words).toContain("Check passed");
    expect(words).not.toContain("Served (not checked)");
    expect(words).toMatch(/Refundable until \S+ UTC · \d+m left to report it for a full refund\./);
    expect(words).toContain("Report a bad result");
    const timeline = timelineOf(words);
    expect(timeline).toMatch(/Charged \$[\d.]+ .*Refundable until then .*Paid to provider after the hold/);
    expect(timeline).not.toContain("not charged");
  });

  it("a demo charged call after the hold: no countdown, the hour ended and the provider was paid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEMO_NOW_MS);
    const receipt = demoSettledReceipt("8b3f6e9d-2c15-4a70-9e41-d7a05c38b2f6", "price_quote", 180) as unknown as Receipt;
    const words = render(receipt);
    expect(words).toContain("Check passed");
    expect(words).not.toContain("left to report it");
    expect(timelineOf(words)).toMatch(/Refundable hour ended .*Paid to provider/);
    expect(words).toContain("No refund. Your report counts against the provider's quality and can lead to a penalty on their stake.");
  });
});
