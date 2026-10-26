import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: false }) }));
vi.mock("@/features/explorer/use-public-explorer", () => ({
  usePublicFeatures: () => ({ demo: false, reserves: false, isPending: false }),
}));

vi.mock("@/components/explorer/buyer-costs", () => ({ BuyerCosts: () => null }));

import { WithChains } from "@/test/chain-fixture";

import HowItWorksPage from "./page";

/* A#2 (2026-10-18): nothing above the fold said what Assay is, and the page spoke only to buyers. */
describe("How it works", () => {
  const html = renderToStaticMarkup(
    <WithChains>
      <HowItWorksPage />
    </WithChains>,
  );
  const text = html.replace(/<[^>]+>/g, "");

  it("says what Assay is in one line under the headline", () => {
    const at = html.indexOf('data-testid="product-definition"');
    expect(at).toBeGreaterThan(html.indexOf("<h1"));
    expect(text).toContain("AI agents pay per call for MCP tools, and a response in the wrong shape is never charged");
    // Quality rules are not on for every tool: the page never claims they run on every call.
    expect(text).not.toMatch(/only when the result passes the check|quality rules run on every call/i);
    expect(text).toContain("quality rules run on tools where they are switched on");
    expect(text).toContain("Providers list their APIs, put up a stake, and get paid per call");
  });

  it("forks buyers and providers under the hero and again at the bottom", () => {
    expect(text.match(/I have an agent/g)).toHaveLength(2);
    expect(text.match(/I have an API/g)).toHaveLength(2);
    expect(html.match(/href="\/catalogue"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/href="\/why-list-here"/g)).toHaveLength(2);
    // The bottom fork comes after the last panel.
    expect(html.lastIndexOf("I have an API")).toBeGreaterThan(html.indexOf("What can run on every call"));
  });

  it("introduces escrow once", () => {
    expect(text.match(/escrow/gi)).toHaveLength(1);
  });

  it("states the stake rule with its threshold and daily cap", () => {
    expect(text).toContain("over at least 400 checked calls in a window");
    expect(text).toContain("never more than 10% of it in any 24 hours");
  });
});
