import { describe, expect, it } from "vitest";

import type { SlaWindow } from "@/interfaces";

import { callPrice } from "./format";
import { needsActionItems, percent, slaWatchItems } from "./needs-action";

const usd = (amount: string) => ({ amount, asset: "usdg", decimals: 6 });

function window(partial: Partial<SlaWindow>): SlaWindow {
  return {
    windowId: "w1",
    label: "w_1",
    sequence: 1,
    bindingId: "b1",
    toolId: "t1",
    status: "OPEN",
    outcome: null,
    openedAt: "2026-10-16T10:00:00Z",
    deadlineAt: "2026-10-16T12:00:00Z",
    closedAt: null,
    declaredFailureRate: 0.02,
    minVerifiedCalls: 400,
    totalCalls: 420,
    verifiedCalls: 420,
    failedCalls: 1,
    observedFailureRate: 0.016,
    totalCallAmount: "0",
    assetId: "usdg",
    warningLevel: null,
    ...partial,
  } as SlaWindow;
}

const base = {
  penalties: [],
  openWindows: [],
  bindings: [{ id: "b1", toolId: "t1", status: "ACTIVE" as const, endpoint: "https://api.example" }],
  stake: { enough: true, shortfall: null },
  label: () => "Market quote",
  now: Date.parse("2026-10-16T11:00:00Z"),
};

describe("needsActionItems", () => {
  it("is empty when nothing needs the provider", () => {
    expect(needsActionItems(base)).toEqual([]);
  });

  it("warns early, in plain percentages, before the promise is broken", () => {
    const [item] = needsActionItems({ ...base, openWindows: [window({})] });
    expect(item.title).toBe("Market quote: 1.6% of calls failed in this check window (last 1 h), near your 2% promise");
    expect(item.tone).toBe("warning");
    expect(item.deadline).toBe("2026-10-16T12:00:00Z");
  });

  it("shows one row per tool, for the window still open", () => {
    const items = needsActionItems({
      ...base,
      openWindows: [
        window({ windowId: "old", deadlineAt: "2026-10-16T09:00:00Z", observedFailureRate: 0.13 }),
        window({ windowId: "open" }),
      ],
    });
    expect(items.map((i) => i.id)).toEqual(["sla:open"]);
  });

  it("stays quiet under half of the promised rate", () => {
    expect(needsActionItems({ ...base, openWindows: [window({ observedFailureRate: 0.005 })] })).toEqual([]);
  });

  it("puts penalties first, then stake, then windows", () => {
    const items = needsActionItems({
      ...base,
      openWindows: [window({ observedFailureRate: 0.03 })],
      stake: { enough: false, shortfall: usd("25000000") },
      penalties: [{ id: "p1", proposalId: null, toolName: "Market quote", amount: usd("12500000"), executableAt: "2026-10-18T00:00:00Z", href: "/provider/penalties?case=p1" }],
    });
    expect(items.map((item) => item.kind)).toEqual(["penalty", "stake", "sla"]);
    expect(items[0]!.title).toBe("Penalty on Market quote: $12.50");
    expect(items[1]!.title).toBe("Your stake is $25.00 short");
    expect(items[2]!.tone).toBe("danger");
  });

  it("D20: no action under the minimum sample; a warning with the Quality sentence instead", () => {
    // The reviewed case: 13 of 400 calls, 7.7% failed against a 5% promise.
    const short = window({ verifiedCalls: 13, totalCalls: 13, failedCalls: 1, observedFailureRate: 0.077, declaredFailureRate: 0.05 });
    expect(needsActionItems({ ...base, openWindows: [short] })).toEqual([]);
    const [watch] = slaWatchItems({ ...base, openWindows: [short] });
    expect(watch!.title).toBe("Market quote: 7.7% of calls failed in this check window (last 1 h), over your 5% promise");
    expect(watch!.detail).toBe(
      "Above your promise, but too few calls to judge. No penalty is possible until the window has enough calls. Not enough calls yet (13 of 400).",
    );
    expect(watch!.href).toBe("/provider/bindings/view/quality?binding=b1");
  });

  it("D20: from the minimum sample on, the window is an action and not a warning", () => {
    const full = window({ verifiedCalls: 400, observedFailureRate: 0.03 });
    expect(needsActionItems({ ...base, openWindows: [full] }).map((item) => item.kind)).toEqual(["sla"]);
    expect(slaWatchItems({ ...base, openWindows: [full] })).toEqual([]);
  });

  it("puts an open bad-result report under Needs action with its reply deadline", () => {
    const report = {
      id: "d1",
      bindingId: "b1",
      canRespond: true,
      replyDueAt: "2026-10-17T10:00:00Z",
      autoUpholdAt: "2026-10-19T10:00:00Z",
      reasonLabel: "Other",
    };
    const [item] = needsActionItems({ ...base, reports: [report] });
    expect(item!.kind).toBe("report");
    expect(item!.title).toBe("A buyer reported a bad result on Market quote: reply needed");
    expect(item!.deadline).toBe("2026-10-17T10:00:00Z");
    expect(item!.detail).toContain("or the buyer wins");
    expect(item!.action).toEqual({ label: "Reply", href: "/provider/call-disputes/view?id=d1" });
    // Replied, or past the reply window: nothing left to do.
    expect(needsActionItems({ ...base, reports: [{ ...report, canRespond: false }] })).toEqual([]);
    expect(needsActionItems({ ...base, reports: [{ ...report, replyDueAt: "2026-10-16T10:00:00Z" }] })).toEqual([]);
  });

  it("formats percentages", () => {
    expect(percent(0.02)).toBe("2%");
    expect(percent(0.016)).toBe("1.6%");
    expect(percent(0.125)).toBe("13%");
  });
});


describe("callPrice", () => {
  it("writes cents with two decimals and smaller prices in full", () => {
    expect(callPrice({ amount: "100000", asset: "usdg", decimals: 6 })).toBe("$0.10");
    expect(callPrice({ amount: "2500", asset: "usdg", decimals: 6 })).toBe("$0.0025");
    expect(callPrice({ amount: "0", asset: "usdg", decimals: 6 })).toBe("Free");
  });
});
