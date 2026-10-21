import { describe, expect, it } from "vitest";

import { chartFrom } from "./use-overview";

/* fe-followup M4 (lot 1 E18): a free-only tool gets no legend entry at $0. */
describe("chartFrom", () => {
  const money = (amount: string) => ({ amount, asset: "eip155:1/erc20:0x1", decimals: 6 });
  it("lists only tools that charged something", () => {
    const { tools, chart } = chartFrom({
      days: [
        { key: "2026-10-20", summary: { groups: [{ key: "paid", chargedTotal: money("1000000") }, { key: "free", chargedTotal: money("0") }] } },
        { key: "2026-10-21", summary: { groups: [{ key: "free", chargedTotal: money("0") }] } },
      ],
    } as never);
    expect(tools).toEqual(["paid"]);
    expect(chart).toHaveLength(2);
  });
});
