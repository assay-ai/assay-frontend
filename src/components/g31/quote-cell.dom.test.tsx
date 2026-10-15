import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QuoteCell } from "./tools-view";
import type { ToolRow } from "./use-catalogue";

function tool(overrides: Partial<ToolRow>): ToolRow {
  return {
    toolId: "b0a2f1c4-0000-4000-8000-000000000001",
    name: "weather.forecast",
    description: "forecast",
    providerCount: 2,
    fromPrice: null,
    price: { amount: "20000", asset: "eip155:46630/erc20:0xabc", decimals: 6 },
    routableBindings: 2,
    pricingMode: "PAID",
    routable: true,
    unroutableReason: null,
    settlementChains: undefined,
    yourCalls: 0,
    listed: null,
    charged: null,
    ...overrides,
  };
}

/** Free first, then paid — the quote column of the tools explorer. */
describe("QuoteCell", () => {
  it("leads a FREEMIUM tool with its free calls per day, then the quote", () => {
    const html = renderToStaticMarkup(
      <QuoteCell tool={tool({ pricingMode: "FREEMIUM", freeCallsPerDay: 100 })} />,
    );
    expect(html).toContain("100 free per day, then");
    expect(html).toContain("up to $0.0200");
  });

  it("is the bare quote for a PAID tool", () => {
    const html = renderToStaticMarkup(<QuoteCell tool={tool({ freeCallsPerDay: null })} />);
    expect(html).not.toContain("free");
    expect(html).toContain("up to $0.0200");
  });
});
