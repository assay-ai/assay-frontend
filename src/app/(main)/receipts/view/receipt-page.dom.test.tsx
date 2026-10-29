import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Receipt } from "@/features/g30/wire";
import { DEMO_NOW_MS } from "@/libs/demo/demo-clock";
// The matcher first: the per-area fixture files import each other through it.
import "@/libs/demo/fixtures";
import { demoSettledReceipt } from "@/libs/demo/fixtures-buyer";

import { ApiError } from "@/libs/ApiClient";

import ReceiptPage from "./page";
import { WithChains } from "@/test/chain-fixture";

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
  return text(
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <WithChains>
          <ReceiptPage />
        </WithChains>
      </QueryClientProvider>,
    ),
  );
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

/** The e17d…0007 shape: SETTLED, no verification record, a released hold. */
function uncheckedReceipt(over: Partial<Receipt> = {}): Receipt {
  return {
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
    ...over,
  } as unknown as Receipt;
}

/**
 * The timeline rows, in order, as screen readers get them ("label: meta"):
 * each row carries an sr-only "stamp — label: meta", then the visible stamp.
 */
const STAMP = String.raw`(?:Today|Yesterday|[A-Z][a-z]{2} \d+,) \d\d:\d\d:\d\d UTC`;
function timelineLabels(words: string): string[] {
  const rows = new RegExp(`${STAMP} — (.*?) ${STAMP} `, "g");
  return [...timelineOf(words).matchAll(rows)].map((m) => m[1]!.trim());
}

describe("the receipt page tells one story", () => {
  it("a settled call with no check record (e17d…0007) never says 'Check passed' or 'not charged'", () => {
    const words = render(uncheckedReceipt());
    expect(words).toContain("Charged $0.02. Served; no check result was recorded for this call.");
    expect(words).toContain("Served (not checked)");
    expect(words).not.toContain("Check passed");
    expect(words).not.toContain("No result recorded");
    // V1-8: its four checks say why they did not run, not that one failed.
    expect(words.replace(/Raw data[\s\S]*$/, "")).not.toMatch(/checks stop at the first failure/i);
    expect(words).toContain("No check result was recorded for this call");
    // Four stages, drawn once per layout (table and list).
    expect(words.match(/not reached · no check result was recorded/g)?.length).toBe(4);
    const timeline = timelineOf(words);
    expect(timeline).toContain("Charged");
    expect(timeline).not.toContain("not charged");
    expect(timeline).not.toContain("Hold released");
  });

  // B2 review C1: a rail-B call whose voucher is not redeemed yet has no hold fields, and a report IS refunded.
  it("a reportable call not yet collected never says 'No refund'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-13T18:20:00.000Z"));
    const words = render(
      uncheckedReceipt({ providerId: "prv-1", disputeFilingClosesAt: "2026-10-20T18:10:00.000Z", holdReleasedAt: null, refundableIfReportedNow: true }),
    );
    expect(words).not.toMatch(/no refund/i);
    expect(words).toContain("Refundable: the 1-hour hold starts when the payment is collected.");
    expect(words).toContain("The payment has not been collected yet. Report it now and, if your report is accepted, you are refunded in full.");
    // One button, beside the headline; the box at the foot only explains.
    expect(words.match(/Report a bad result/g)).toHaveLength(1);
  });

  // Wave-1 audit I1: the same call where the backend would not guarantee a refund (no escrow hold on its chain).
  it("a reportable call not yet collected, on a chain without the hold, promises no refund", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-13T18:20:00.000Z"));
    const words = render(
      uncheckedReceipt({ providerId: "prv-1", disputeFilingClosesAt: "2026-10-20T18:10:00.000Z", holdReleasedAt: null, refundableIfReportedNow: false }),
    );
    expect(words).not.toMatch(/refunded in full|full refund|no refund/i);
    expect(words).not.toContain("Refundable:");
    expect(words).toContain("If your report is accepted, it counts against the provider's quality.");
    expect(words.match(/Report a bad result/g)).toHaveLength(1);
  });

  // Re-review R1: the e17d shape with a provider: the hold was released, so the backend guarantees nothing.
  it("a reportable call whose hold was released promises neither a refund nor 'no refund'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-13T18:20:00.000Z"));
    const words = render(uncheckedReceipt({ providerId: "prv-1", disputeFilingClosesAt: "2026-10-20T18:10:00.000Z" }));
    expect(words).not.toMatch(/refunded in full|no refund/i);
    expect(words).not.toContain("left to report it");
    expect(words).not.toContain("Refundable:");
    expect(words).toContain("If your report is accepted, it counts against the provider's quality.");
  });

  it("a demo charged call inside the hold: the pre-B2 story, plus the countdown and the hold rows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEMO_NOW_MS);
    const receipt = demoSettledReceipt("5e1d0c2a-7b44-4f19-a3e8-0c9d6b2f4a71", "geocode", 15) as unknown as Receipt;
    const words = render(receipt);
    // Unchanged from before B2: the headline, its sub-line and the money strip.
    expect(words).toContain(
      "Charged $0.0012. Passed every check we run on this call. One check (relevance) runs on a sample of calls; this call was not in the sample.",
    );
    expect(words).toContain("Where the money went Held $0.0012 Check passed Charged $0.0012");
    // The timeline: the pre-B2 rows, then only the two hold rows.
    expect(timelineLabels(words)).toEqual([
      "Call made",
      "Money held: $0.0012",
      "Result checked",
      "Charged: $0.0012",
      "Refundable until then: report a bad result for a full refund",
      "Goes to the provider after the hold: $0.0012",
    ]);
    expect(words).toMatch(/Refundable until \S+ UTC · \d+m left to report it for a full refund\./);
    expect(words.match(/Report a bad result/g)).toHaveLength(1);
  });

  it("a demo charged call after the hold: no countdown, the hour ended, the D9 outcome", () => {
    vi.useFakeTimers();
    vi.setSystemTime(DEMO_NOW_MS);
    const receipt = demoSettledReceipt("8b3f6e9d-2c15-4a70-9e41-d7a05c38b2f6", "price_quote", 180) as unknown as Receipt;
    const words = render(receipt);
    expect(words).toMatch(/Charged \$[\d.]+\. Passed every check we run on this call\./);
    expect(words).toMatch(/Where the money went Held \$[\d.]+ Check passed Charged \$[\d.]+/);
    expect(words).not.toContain("left to report it");
    const labels = timelineLabels(words).map((l) => l.replace(/: \$[\d.]+$/, ""));
    expect(labels).toEqual(["Call made", "Money held", "Result checked", "Charged", "Refundable hour ended", "Released to the provider"]);
    expect(words).not.toContain("Paid to provider");
    expect(words).toContain(
      "The 1-hour hold has ended, so there is no refund for this call. If your report is accepted, it counts against the provider's quality and can lead to a penalty on their stake",
    );
  });
});

/* BUG-PROD-NF-01/02: an id the API refuses as malformed is a call that does not exist, under one h1. */
describe("the public link row", () => {
  it("offers the /r/view link with what it shows", () => {
    const words = render(uncheckedReceipt());
    expect(words).toContain("Public link");
    expect(words).toContain("/r/view?id=e17d0000-0000-0000-0000-000000000007");
    expect(words).toContain("Anyone with the link sees only the price, the tool and the check results.");
  });
});

describe("a receipt that cannot be found", () => {
  function renderError(id: string, error: ApiError): string {
    intentId = id;
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, retryOnMount: false } } });
    client.getQueryCache().build(client, { queryKey: ["receipt", id] }).setState({ status: "error", error, fetchStatus: "idle" });
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <WithChains>
          <ReceiptPage />
        </WithChains>
      </QueryClientProvider>,
    );
  }

  it("shows the not-found state, not a retry, for a non-uuid id (400 VALIDATION_FAILED)", () => {
    const html = renderError("not-a-uuid", new ApiError("VALIDATION_FAILED", "Validation failed (uuid is expected)", 400));
    expect(text(html)).toContain("We could not find this call");
    expect(text(html)).not.toContain("Try again");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it("and the same for a random uuid (404)", () => {
    const html = renderError("e17d0000-0000-0000-0000-00000000ffff", new ApiError("NOT_FOUND", "not found", 404));
    expect(text(html)).toContain("We could not find this call");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });
});
