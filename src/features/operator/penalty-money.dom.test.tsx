import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PenaltyMoney } from "./penalty-money";

const PENALTY = { amount: "28470000", asset: "eip155:46630/erc20:0x0000000000000000000000000000000000000001", decimals: 6 };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&rsquo;/g, "’").replace(/\s+/g, " ");

describe("PenaltyMoney's split", () => {
  it("draws the last-read split with its time when the chain can't be read now", () => {
    const words = text(renderToStaticMarkup(<PenaltyMoney penalty={PENALTY} stage="window-open" agentBps={6000} lastKnownAt={Date.parse("2026-10-18T14:17:00Z")} />));
    expect(words).toContain("Agents who paid");
    expect(words).toMatch(/Split as last read from the chain, .*14:17.*; it could not be read just now\./);
  });

  it("says nothing about an old read when the split is live", () => {
    const words = text(renderToStaticMarkup(<PenaltyMoney penalty={PENALTY} stage="window-open" agentBps={6000} />));
    expect(words).not.toContain("last read");
  });
});
