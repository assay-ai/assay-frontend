import { describe, expect, it } from "vitest";

import { sampleAnalytics, percentChange } from "./sample-analytics";

describe("sample analytics periods", () => {
  it.each(["7d", "30d", "90d", "all"] as const)(
    "reconciles money for %s",
    (range) => {
      const { current } = sampleAnalytics(range);
      expect(
        current.provider_usd + current.fees_usd + current.refunded_usd,
      ).toBeCloseTo(current.volume_usd, 2);
    },
  );

  it("uses the previous period only when a full period exists", () => {
    expect(sampleAnalytics("7d").previous).not.toBeNull();
    expect(sampleAnalytics("30d").previous).not.toBeNull();
    expect(sampleAnalytics("90d").previous).toBeNull();
    expect(sampleAnalytics("all").previous).toBeNull();
    expect(percentChange(1, null)).toBeNull();
    expect(percentChange(1, 0)).toBeNull();
  });

  it("keeps cumulative totals since launch when narrowing the visible window", () => {
    const all = sampleAnalytics("all");
    const week = sampleAnalytics("7d");
    expect(week.growth.at(-1)).toEqual(all.growth.at(-1));
    expect(week.rows).toHaveLength(7);
    expect(all.rows).toHaveLength(120);
  });
});
