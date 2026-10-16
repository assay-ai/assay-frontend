import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { monthBounds } from "./format";
import { StatementsView } from "./statements-view";

const ASSET = "eip155:46630/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3";
const m = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });

/**
 * listed 10.00 = charged 6.00 + not charged 2.00 (of which 1.50 withheld)
 * + owed 1.25 + in progress 0.75. The statement must add up to the atomic
 * unit, so every bucket is on it, not just withheld (final review M1).
 */
const FIGURES = {
  calls: 10,
  refundedCalls: 2,
  listedTotal: m("10000000"),
  chargedTotal: m("6000000"),
  withheldTotal: m("1500000"),
  notChargedTotal: m("2000000"),
  notChargedCalls: 3,
  owedTotal: m("1250000"),
  owedCalls: 1,
  inProgressTotal: m("750000"),
  inProgressCalls: 1,
  failRate: 0.2,
};

function markup(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["receipts-summary", "statement", monthBounds().from], {
    groups: [{ key: "tool-1", ...FIGURES, comparison: null }],
    totals: FIGURES,
    asset: ASSET,
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <StatementsView />
    </QueryClientProvider>,
  );
}

describe("StatementsView — the statement adds up like /spend", () => {
  it("lists not charged, owed and in progress between gross spend and net charged", () => {
    const html = markup();
    expect(html).toContain("−$10.00");
    expect(html).toContain("+$2.00");
    expect(html).toContain("includes $1.50 withheld by the guarantee");
    expect(html).toContain("+$1.25");
    expect(html).toContain("+$0.75");
    expect(html).toContain("−$6.00");
    expect(html).not.toContain("Amount withheld");
  });

  it("shows the owed and in-progress columns in the per-tool table", () => {
    const html = markup();
    expect(html).toContain("Not charged");
    expect(html).toContain("Owed");
    expect(html).toContain("In progress");
  });
});
