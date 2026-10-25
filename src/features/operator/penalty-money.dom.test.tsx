import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PenaltyMoney, reductionHint } from "./penalty-money";

const PENALTY = { amount: "28470000", asset: "eip155:46630/erc20:0x0000000000000000000000000000000000000001", decimals: 6 };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&rsquo;/g, "’").replace(/\s+/g, " ");

describe("PenaltyMoney's split", () => {
  it("draws the last-read split with its time when the chain can't be read now", () => {
    const words = text(renderToStaticMarkup(<PenaltyMoney penalty={PENALTY} stage="window-open" agentBps={6000} platformBps={3000} lastKnownAt={Date.parse("2026-10-18T14:17:00Z")} />));
    expect(words).toContain("Agents who paid");
    expect(words).toMatch(/Split as last read from the chain, .*14:17.*; it could not be read just now\./);
  });

  it("says nothing about an old read when the split is live", () => {
    const words = text(renderToStaticMarkup(<PenaltyMoney penalty={PENALTY} stage="window-open" agentBps={6000} platformBps={3000} />));
    expect(words).not.toContain("last read");
  });

  it("draws no split while the chain's platform share is unknown", () => {
    const words = text(renderToStaticMarkup(<PenaltyMoney penalty={PENALTY} stage="window-open" agentBps={6000} platformBps={null} />));
    expect(words).not.toContain("Agents who paid");
  });
});

describe("the side panel's stake line (B12 fix round 1)", () => {
  it("labels a split drawn from the last read with its time, like the money card", () => {
    const at = Date.parse("2026-10-18T14:17:00Z");
    expect(reductionHint(6000, 3000, at)).toMatch(/never taken\. Split as last read from the chain, .*14:17.*; it could not be read just now\.$/);
    expect(reductionHint(6000, 3000)).not.toMatch(/last read/);
  });
});
