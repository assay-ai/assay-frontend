import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SummaryFigures } from "@/features/g30/wire";

import { StatementFigures } from "./statements-view";

const ASSET = "eip155:46630/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3";
const m = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });

/**
 * listed 10.00 = charged 6.00 + not charged 2.00 (of which 1.50 withheld)
 * + owed 1.25 + in progress 0.75. The statement must add up to the atomic
 * unit, so every bucket is on it, not just withheld (final review M1).
 */
const FIGURES: SummaryFigures = {
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

function markup(figures: SummaryFigures = FIGURES): string {
  return renderToStaticMarkup(<StatementFigures totals={figures} withheldSub={null} />);
}

describe("StatementFigures — the statement adds up like /spend", () => {
  it("lists not charged, owed and in progress between gross spend and what was paid", () => {
    const html = markup();
    expect(html).toContain("$10.00");
    expect(html).toContain("−$2.00");
    expect(html).toContain("$1.50 by the guarantee");
    expect(html).toContain("−$1.25");
    expect(html).toContain("−$0.75");
    expect(html).toContain("$6.00");
    expect(html).toContain("Owed");
    expect(html).toContain("In progress");
    expect(html).not.toContain("Amount withheld");
    // The withheld part stays one short fragment.
    const withSub = renderToStaticMarkup(<StatementFigures totals={FIGURES} withheldSub="3 failed checks, 1 no result" />);
    expect(withSub).toContain("$1.50 by the guarantee (3 failed checks, 1 no result)");
  });

  it("says 1 call, not 1 calls, on the owed line", () => {
    expect(markup()).toContain("1 call · still owed by you, not collected yet, so not in You paid");
  });

  it("leaves out owed and in progress when there are none", () => {
    const html = markup({
      ...FIGURES,
      owedTotal: m("0"),
      owedCalls: 0,
      inProgressTotal: m("0"),
      inProgressCalls: 0,
    });
    expect(html).not.toContain("Owed");
    expect(html).not.toContain("In progress");
  });
});
