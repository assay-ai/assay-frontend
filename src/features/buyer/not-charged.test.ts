import { describe, expect, it } from "vitest";

import {
  bucketOfStatus,
  listedSplit,
  notChargedLines,
  notChargedSplitText,
} from "./not-charged";
import { sharePercent } from "./period";
import type { WithheldForAsset } from "./wire";

const money = (amount: string) => ({
  amount,
  asset: "eip155:46630/erc20:0xusdg",
  decimals: 6,
});

/** The seeded buyer's October (UX review 2026-10-18, P0-3). */
const october = {
  withheld: {
    asset: "eip155:46630/erc20:0xusdg",
    calls: 19,
    amount: money("1100000"),
    buckets: [
      {
        bucket: "FAILED_VERIFICATION",
        label: "failed verification",
        calls: 4,
        amount: money("170000"),
      },
      {
        bucket: "PROVIDER_OR_PLATFORM_ERROR",
        label: "provider or platform error",
        calls: 10,
        amount: money("430000"),
      },
      {
        bucket: "NOT_COLLECTED",
        label: "not collected (the provider could not be paid)",
        calls: 5,
        amount: money("500000"),
      },
    ],
  },
  holdReleaseTotal: money("1100000"),
  orphanedReleases: money("0"),
  orphanedHoldIds: [],
  ok: true,
  difference: "0",
} satisfies WithheldForAsset;

describe("notChargedLines", () => {
  it("gives the three lines in a fixed order, adding up to the total", () => {
    const lines = notChargedLines(october);
    expect(lines.map((l) => [l.label, l.calls, l.amount?.amount])).toEqual([
      ["Failed our checks (incl. wrong format)", 4, "170000"],
      ["No usable result", 10, "430000"],
      ["Not collected (the provider could not be paid)", 5, "500000"],
    ]);
    expect(lines.reduce((n, l) => n + l.calls, 0)).toBe(october.withheld.calls);
  });

  it("zero-fills a bucket an older API leaves out, and keeps one it adds later", () => {
    const lines = notChargedLines({
      ...october,
      withheld: {
        ...october.withheld,
        buckets: [
          october.withheld.buckets[0]!,
          {
            bucket: "SOMETHING_NEW",
            label: "something new",
            calls: 1,
            amount: money("1"),
          },
        ],
      },
    });
    expect(lines.map((l) => [l.bucket, l.calls])).toEqual([
      ["FAILED_VERIFICATION", 4],
      ["PROVIDER_OR_PLATFORM_ERROR", 0],
      ["NOT_COLLECTED", 0],
      ["SOMETHING_NEW", 1],
    ]);
    expect(lines[3]!.label).toBe("Something new");
  });

  it("is three empty lines with no figure at all", () => {
    expect(notChargedLines(null).map((l) => l.calls)).toEqual([0, 0, 0]);
  });
});

describe("notChargedSplitText", () => {
  it("names every non-empty line, the same words on every screen", () => {
    expect(notChargedSplitText(notChargedLines(october))).toBe(
      "4 failed our checks (incl. wrong format), 10 had no usable result, 5 not collected",
    );
    expect(notChargedSplitText(notChargedLines(null))).toBeNull();
  });
});

describe("bucketOfStatus", () => {
  it("follows the API's buckets", () => {
    expect(bucketOfStatus("REFUNDED")).toBe("FAILED_VERIFICATION");
    expect(bucketOfStatus("VOIDED")).toBe("PROVIDER_OR_PLATFORM_ERROR");
    expect(bucketOfStatus("EXPIRED")).toBe("PROVIDER_OR_PLATFORM_ERROR");
    expect(bucketOfStatus("SETTLED")).toBe("NOT_COLLECTED");
    expect(bucketOfStatus("VERIFYING")).toBeNull();
  });
});

describe("listedSplit", () => {
  it("adds up to listed, and every share is against listed", () => {
    const segments = listedSplit({
      listed: money("7860000"),
      charged: money("6760000"),
      notCharged: money("1100000"),
      owed: money("0"),
      inProgress: money("0"),
    });
    expect(segments.map((s) => [s.key, s.amount.amount, s.percent])).toEqual([
      ["charged", "6760000", "86.0%"],
      ["not-charged", "1100000", "14.0%"],
    ]);
    expect(segments.reduce((n, s) => n + s.value, 0)).toBeCloseTo(7.86, 6);
    // The hero's sentence uses the same share.
    expect(sharePercent(october.withheld.amount, money("7860000"))).toBe(
      "14.0%",
    );
  });

  it("draws owed and in progress only when there are any, still against listed", () => {
    const segments = listedSplit({
      listed: money("1000000"),
      charged: money("500000"),
      notCharged: money("200000"),
      owed: money("200000"),
      inProgress: money("100000"),
    });
    expect(segments.map((s) => [s.key, s.percent])).toEqual([
      ["charged", "50.0%"],
      ["not-charged", "20.0%"],
      ["owed", "20.0%"],
      ["in-progress", "10.0%"],
    ]);
  });
});
