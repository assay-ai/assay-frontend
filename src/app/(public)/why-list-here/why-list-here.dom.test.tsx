import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { chainTerms } from "@/libs/chain-terms";
import { definitionOf } from "@/libs/glossary";
import { TEST_CHAIN, WithChains } from "@/test/chain-fixture";

import WhyListHerePage from "./page";

/* A (2026-10-18) and D: "never clawed back" next to "10% of your stake" read as a contradiction,
   and a prospect could not see the steps before signing in. */
describe("Why list here", () => {
  const html = renderToStaticMarkup(
    <WithChains>
      <WhyListHerePage />
    </WithChains>,
  );
  const terms = chainTerms(TEST_CHAIN);
  const text = html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

  it("reconciles never clawed back with the stake in one sentence under the headline", () => {
    const at = html.indexOf('data-testid="stake-reconcile"');
    expect(at).toBeGreaterThan(html.indexOf("<h1"));
    expect(text).toContain(
      `Payouts are never clawed back. ${definitionOf("payout-final", terms)} ${definitionOf("stake-rule", terms)}`,
    );
    expect(definitionOf("payout-final", terms)).toContain("1 hour after the call");
  });

  // B5 review M1/M2: the stake is the only risk only after the report window, and a call is held for it.
  it("never says the stake is the only risk without the report window, nor that nothing is held", () => {
    expect(text).not.toContain("Only your stake is at risk");
    expect(text).not.toContain("we hold nothing back");
    expect(text).toContain("No standing reserve: each paid call is held for 1 hour for buyer reports");
    expect(text).toContain("a call that fails because of the provider");
  });

  it("shows the steps to list: setup, then each listing, then the stake", () => {
    const steps = html.slice(html.indexOf('id="steps"'));
    const order = ["You", "Get paid", "Your API", "Tool", "Connect &amp; test", "Go live", "Stake, for paid calls."].map(
      (label) => steps.indexOf(`>${label}`),
    );
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("Steps to list");
  });

  it("prints every on-chain number from GET /chains, and none before it answered", () => {
    expect(text).toContain("covers $50.00 or 1,000 calls");
    expect(text).toContain("A penalty waits 72 hours before it can be taken");
    expect(text).toContain("more than 10% of your stake in any 24 hours");
    const before = renderToStaticMarkup(<WhyListHerePage />).replace(/<[^>]+>/g, "");
    expect(before).toContain("A penalty waits — before it can be taken");
    expect(before).not.toContain("72 hours");
  });
});
