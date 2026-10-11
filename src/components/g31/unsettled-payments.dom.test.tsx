import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { UnsettledVouchers } from "@/interfaces";

import { UnsettledPayments } from "./unsettled-payments";

const ASSET = "eip155:46630/erc20:0xDbbC";
const usdg = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });
const IN_FLIGHT: UnsettledVouchers = {
  count: 1,
  amount: usdg("100000"),
  largest: usdg("100000"),
  windowNeeds: usdg("2370000"),
  redeemableUntil: "2026-10-12T15:27:11.000Z",
};

function render(props: Partial<React.ComponentProps<typeof UnsettledPayments>> = {}): string {
  return renderToStaticMarkup(
    <UnsettledPayments
      unsettled={IN_FLIGHT}
      unit="USDG"
      atRisk={false}
      reasons={[]}
      waiting={false}
      settled={false}
      onWait={() => {}}
      onProceed={() => {}}
      proceedLabel="Sign anyway"
      {...props}
    />,
  );
}

/** BUG-D1-07: the Edit limits, Revoke and escrow limits screens say what is still settling. */
describe("UnsettledPayments", () => {
  it("says how many payments are still being settled, without a warning when nothing strands", () => {
    const html = render();
    expect(html).toContain('data-testid="unsettled-line"');
    expect(html).toContain("1 payment (0.100000 USDG) still being settled");
    expect(html).not.toContain("unsettled-strand-warning");
  });

  it("warns and offers to wait or to go ahead when the change would strand them", () => {
    const html = render({ atRisk: true, reasons: ["maxPerWindow"] });
    expect(html).toContain('data-testid="unsettled-strand-warning"');
    expect(html).toContain("leave it unredeemable");
    expect(html).toContain('data-testid="unsettled-wait"');
    expect(html).toContain("Wait for them to settle");
    expect(html).toContain('data-testid="unsettled-proceed"');
    expect(html).toContain("Sign anyway");
  });

  it("shows the wait in progress", () => {
    const html = render({ atRisk: true, reasons: ["revoked"], waiting: true });
    expect(html).toContain("Waiting for them to settle…");
  });

  it("says the agent is still paying when the wait ran out, and offers to wait again (review finding 9)", () => {
    const html = render({ atRisk: true, reasons: ["maxPerWindow"], stalled: true });
    expect(html).toContain('data-testid="unsettled-stalled"');
    expect(html).toContain("Your agent is still paying");
    expect(html).toContain("Wait again");
    expect(html).toContain("Sign anyway");
  });

  it("says they settled once the wait is over, and nothing when there never were any", () => {
    expect(render({ unsettled: { ...IN_FLIGHT, count: 0 }, settled: true })).toContain(
      "They have settled. You can sign now.",
    );
    expect(render({ unsettled: { ...IN_FLIGHT, count: 0 } })).toBe("");
  });
});
