import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import WhyListHerePage from "./page";

/* A (2026-10-18) and D: "never clawed back" next to "10% of your stake" read as a contradiction,
   and a prospect could not see the steps before signing in. */
describe("Why list here", () => {
  const html = renderToStaticMarkup(<WhyListHerePage />);
  const text = html.replace(/<[^>]+>/g, "");

  it("reconciles never clawed back with the stake in one sentence under the headline", () => {
    const at = html.indexOf('data-testid="stake-reconcile"');
    expect(at).toBeGreaterThan(html.indexOf("<h1"));
    expect(text).toContain("Payouts are never clawed back. Each paid call&#x27;s payment becomes yours 1 hour after the call");
    expect(text).toContain(
      "After that hour, only your stake is at risk: at most 10% of it in any 24 hours, and only if you fail more often than you promised, over at least 400 checked calls.",
    );
  });

  // B5 review M1/M2: the stake is the only risk only after the report window, and a call is held for it.
  it("never says the stake is the only risk without the report window, nor that nothing is held", () => {
    expect(text).not.toContain("Only your stake is at risk");
    expect(text).not.toContain("we hold nothing back");
    expect(text).toContain("No standing reserve: each paid call is held for 1 hour for buyer reports");
    expect(text).toContain("a call that fails because of you");
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
});
