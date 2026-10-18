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
    expect(text).toContain(
      "Payouts are never clawed back. Only your stake is at risk: at most 10% of it in any 24 hours, and only if you fail more often than you promised, over at least 400 checked calls.",
    );
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
