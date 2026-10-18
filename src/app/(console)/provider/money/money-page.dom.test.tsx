import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PROVIDER_CATALOGUE_KEY } from "@/features/provider-binding/tool-name";
import type { Money, ProviderEarnings, ProviderPayout } from "@/interfaces";

import ProviderMoneyPage from "./page";

/*
  Money on the UX review's seed (D-P0-1, D-P0-2): the summary, the reasons
  and the split read the same 22 calls / $0.74; Recent payments lists the
  redemptions; Overdue, not "written off"; tool names, not "a tool" repeated.
*/
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
  usePathname: () => "/provider/money",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: false, authenticated: false }) }));

const ASSET = "eip155:46630/erc20:0x1";
const usd = (amount: string): Money => ({ amount, asset: ASSET, decimals: 6 });

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const reasons = (failed: number, endpoint: number, refused: number, amounts: [string, string, string]) => [
  { class: "PAID_UNCREDITED" as const, calls: failed, amount: usd(amounts[0]) },
  { class: "SYSTEM_ERROR" as const, calls: endpoint, amount: usd(amounts[1]) },
  { class: "REQUEST_ERROR" as const, calls: refused, amount: usd(amounts[2]) },
];

const group = (key: string, calls: number, byClass: ReturnType<typeof reasons>) => ({
  key,
  calls,
  earned: usd("0"),
  platformFee: usd("0"),
  withheld: usd(byClass.reduce((s, r) => s + BigInt(r.amount.amount), 0n).toString()),
  withheldCalls: byClass.reduce((s, r) => s + r.calls, 0),
  withheldByClass: byClass,
});

const earnings: ProviderEarnings = {
  asset: ASSET,
  totals: {
    calls: 108,
    earned: usd("6084000"),
    platformFee: usd("676000"),
    withheld: usd("740000"),
    withheldCalls: 22,
    withheldByClass: reasons(12, 8, 2, ["353000", "297000", "90000"]),
    uncollected: usd("450000"),
    uncollectedCalls: 5,
  },
  groups: [
    group("tool-rate", 18, reasons(1, 4, 0, ["45000", "180000", "0"])),
    group("tool-geo", 14, reasons(3, 3, 2, ["108000", "117000", "90000"])),
    group("gone-1", 1, reasons(1, 0, 0, ["25000", "0", "0"])),
    group("gone-2", 1, reasons(1, 0, 0, ["25000", "0", "0"])),
  ],
};

const redemption = (id: string, amount: string, calls: number, minutes: number): ProviderPayout => ({
  id,
  kind: "REDEMPTION",
  batchId: null,
  amount: usd(amount),
  chainTxRef: `0x${id.padStart(64, "0")}`,
  calls,
  createdAt: new Date(Date.UTC(2026, 9, 17, 0, 60 - minutes)).toISOString(),
});

function render(): string {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["provider", "earnings", "tool", "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"], earnings);
  client.setQueryData(["provider", "payouts", "all"], {
    items: [redemption("a1", "90000", 1, 1), redemption("b2", "180000", 2, 5)],
    pageInfo: { nextCursor: null, hasMore: false },
  });
  client.setQueryData(["display-assets", "provider"], []);
  client.setQueryData(PROVIDER_CATALOGUE_KEY, {
    tools: [
      { id: "tool-rate", name: "get_usd_eur_rate", description: "", tier: "VERIFIED", inputSchema: {}, outputSchema: {} },
      { id: "tool-geo", name: "geocode_place", description: "", tier: "VERIFIED", inputSchema: {}, outputSchema: {} },
    ],
    settlementAsset: null,
  });
  return text(
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ProviderMoneyPage />
      </QueryClientProvider>,
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T12:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("provider Money", () => {
  it("says not credited once: the split, the summary and the reasons read 22 calls / $0.74", () => {
    const words = render();
    expect(words).toMatch(/Not credited · 22 calls, see below \d+% \$0\.74/);
    expect(words).toMatch(/Not credited this month 22 calls · \$0\.74 ·/);
    // The reasons below add up to it: 12 + 8 + 2 calls, $0.35 + $0.30 + $0.09.
    expect(words).toMatch(/Failed our checks .*\$0\.35 12 calls/);
    expect(words).toMatch(/Endpoint error .*\$0\.30 8 calls/);
    expect(words).toMatch(/Request refused .*\$0\.09 2 calls/);
    expect(words).not.toMatch(/14 calls/);
  });

  it("names the tools a reason happened on and counts the unlisted ones, never 'a tool' repeated", () => {
    const words = render();
    expect(words).toMatch(/On get_usd_eur_rate, geocode_place \+2 other tools/);
    expect(words).not.toMatch(/a tool, a tool/);
  });

  it("lists the redemption transactions as payments", () => {
    const words = render();
    expect(words).not.toMatch(/No payments yet/);
    expect(words).toMatch(/Paid for 1 call from the buyer's escrow/);
    expect(words).toMatch(/Paid for 2 calls from the buyer's escrow/);
  });

  it("calls a 30-day unpaid debt overdue, not written off", () => {
    const words = render();
    expect(words).toMatch(/Overdue \$0\.45 5 calls/);
    expect(words).toMatch(/Overdue: the buyer has not paid for 30 days/);
    expect(words).not.toMatch(/written off/i);
  });

  it("rounds the wallet figure and the fee once, from cents", () => {
    const words = render();
    // $6.084 + $0.676 = $6.76: shown $6.08 + $0.68, never $6.08 beside $0.67.
    expect(words).toMatch(/In your wallet this month \$6\.08/);
    expect(words).toMatch(/Assay fee \d+% \$0\.68/);
    expect(words).not.toMatch(/\$0\.67/);
  });
});
