import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { notChargedLines } from "@/features/buyer/not-charged";
import type { WithheldForAsset } from "@/features/buyer/wire";
import type { SummaryFigures } from "@/features/g30/wire";

import { StatementFigures } from "./statements-view";

const ASSET = "eip155:46630/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3";
const m = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });

/**
 * listed 10.00 = charged 6.00 + not charged 2.00 + owed 1.25 + in progress 0.75. The statement must add up to the atomic
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

/** `GET /withheld` for the same month: three lines adding up to not charged. */
const WITHHELD = {
  withheld: {
    asset: ASSET,
    calls: 3,
    amount: m("2000000"),
    buckets: [
      { bucket: "FAILED_VERIFICATION", label: "failed verification", calls: 1, amount: m("1000000") },
      { bucket: "PROVIDER_OR_PLATFORM_ERROR", label: "provider or platform error", calls: 1, amount: m("500000") },
      { bucket: "NOT_COLLECTED", label: "not collected (the charge was cancelled or never taken)", calls: 1, amount: m("500000") },
    ],
  },
  holdReleaseTotal: m("2000000"),
  orphanedReleases: m("0"),
  orphanedHoldIds: [],
  ok: true,
  difference: "0",
} satisfies WithheldForAsset;

function markup(figures: SummaryFigures = FIGURES): string {
  return renderToStaticMarkup(<StatementFigures totals={figures} lines={null} />);
}

describe("StatementFigures — the statement adds up like /spend", () => {
  it("lists not charged, owed and in progress between gross spend and what was paid", () => {
    const html = markup();
    expect(html).toContain("$10.00");
    expect(html).toContain("−$2.00");
    expect(html).toContain("−$1.25");
    expect(html).toContain("−$0.75");
    expect(html).toContain("$6.00");
    expect(html).toContain("Owed");
    expect(html).toContain("In progress");
    expect(html).not.toContain("Amount withheld");
  });

  it("gives every not-charged call its reason, in the three lines", () => {
    const html = renderToStaticMarkup(<StatementFigures totals={FIGURES} lines={notChargedLines(WITHHELD)} />);
    expect(html).toContain("Failed our checks (incl. wrong format)");
    expect(html).toContain("No usable result");
    expect(html).toContain("Not collected (the charge was cancelled or never taken)");
    expect(html).toContain("$1.00");
    expect(html).not.toContain("by the guarantee");
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
