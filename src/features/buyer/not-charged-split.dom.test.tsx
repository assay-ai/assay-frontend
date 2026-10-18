import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NotChargedSplitLine } from "./not-charged-split";
import type { WithheldForAsset } from "./wire";

const money = (amount: string) => ({
  amount,
  asset: "eip155:46630/erc20:0xusdg",
  decimals: 6,
});

function withheld(calls: [number, number, number]): WithheldForAsset {
  const buckets = [
    "FAILED_VERIFICATION",
    "PROVIDER_OR_PLATFORM_ERROR",
    "NOT_COLLECTED",
  ].map((bucket, i) => ({
    bucket,
    label: bucket.toLowerCase(),
    calls: calls[i]!,
    amount: money(String(calls[i]! * 100_000)),
  }));
  const total = calls.reduce((n, c) => n + c, 0);
  return {
    withheld: {
      asset: "eip155:46630/erc20:0xusdg",
      calls: total,
      amount: money(String(total * 100_000)),
      buckets,
    },
    holdReleaseTotal: money(String(total * 100_000)),
    orphanedReleases: money("0"),
    orphanedHoldIds: [],
    ok: true,
    difference: "0",
  };
}

describe("NotChargedSplitLine (/spend)", () => {
  it("names the three lines, adding up to the not-charged count", () => {
    const html = renderToStaticMarkup(
      <NotChargedSplitLine withheld={withheld([4, 10, 5])} />,
    );
    expect(html).toContain('data-testid="spend-not-charged-split"');
    expect(html).toContain(
      "Not charged: 4 failed our checks (incl. wrong format), 10 had no usable result, 5 not collected.",
    );
  });

  it("leaves out an empty line, and says nothing when nothing was withheld", () => {
    expect(
      renderToStaticMarkup(
        <NotChargedSplitLine withheld={withheld([0, 2, 0])} />,
      ),
    ).toContain("Not charged: 2 had no usable result.");
    expect(
      renderToStaticMarkup(
        <NotChargedSplitLine withheld={withheld([0, 0, 0])} />,
      ),
    ).toBe("");
    expect(renderToStaticMarkup(<NotChargedSplitLine withheld={null} />)).toBe(
      "",
    );
  });
});
