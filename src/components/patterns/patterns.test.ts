import { describe, expect, it } from "vitest";

import { capReading } from "./cap-meter";
import { shortId } from "./copy-chip";
import { moneyFlowSummary, splitPercents } from "./money-flow";
import { matchesPreset } from "./preset-chips";
import { checklistProgress, defaultExpandedStep } from "./setup-checklist";
import { nextDatedStepIndex } from "./status-timeline";

const usd = (amount: string) => ({ amount, asset: "x", decimals: 6 });
const UTC = { timeZone: "UTC", now: Date.parse("2026-10-15T12:00:00Z") };

describe("capReading", () => {
  it("says what is left and when it refills", () => {
    const r = capReading({ used: usd("1540000"), limit: usd("2000000"), refillsAt: "2026-10-15T14:20:00Z" }, UTC);
    expect(r.sentence).toBe("$0.46 left of $2.00 · full again ~14:20");
    expect(r.level).toBe("ok");
    expect(Math.round(r.percent)).toBe(77);
  });

  it("warns from 80%", () => {
    expect(capReading({ used: usd("1700000"), limit: usd("2000000") }, UTC)).toMatchObject({
      level: "high",
      sentence: "$0.30 left of $2.00",
    });
  });

  it("explains a full cap", () => {
    const r = capReading({ used: usd("2000000"), limit: usd("2000000"), refillsAt: "2026-10-16T00:00:00Z" }, UTC);
    expect(r.level).toBe("full");
    expect(r.sentence).toBe("All $2.00 used. Paid calls are refused until it refills tomorrow 00:00.");
  });

  it("explains being over the limit", () => {
    const r = capReading({ used: usd("2100000"), limit: usd("2000000") }, UTC);
    expect(r.level).toBe("over");
    expect(r.percent).toBe(100);
    expect(r.sentence).toBe("$0.10 over the limit ($2.10 of $2.00). Paid calls are refused until the limit is raised.");
  });

  it("handles a zero limit and sub-cent caps", () => {
    expect(capReading({ used: usd("0"), limit: usd("0") }, UTC).level).toBe("none");
    expect(capReading({ used: usd("0"), limit: usd("1000") }, UTC).sentence).toBe("$0.0010 left of $0.0010");
  });
});

describe("nextDatedStepIndex", () => {
  it("is the first unfinished step with a date", () => {
    expect(
      nextDatedStepIndex([
        { state: "done", date: "2026-10-01T00:00:00Z" },
        { state: "current" },
        { state: "upcoming", date: "2026-10-20T00:00:00Z" },
        { state: "upcoming", date: "2026-10-30T00:00:00Z" },
      ]),
    ).toBe(2);
  });

  it("is -1 when nothing is dated or everything is finished", () => {
    expect(nextDatedStepIndex([{ state: "done", date: "2026-10-01T00:00:00Z" }, { state: "upcoming" }])).toBe(-1);
    expect(nextDatedStepIndex([{ state: "current", date: "not a date" }])).toBe(-1);
  });
});

describe("money flow and split", () => {
  it("reads a flow as one sentence", () => {
    expect(
      moneyFlowSummary([{ label: "Held", amount: "$0.10" }, { label: "Check failed" }, { label: "Released", amount: "$0.10" }]),
    ).toBe("Held $0.10, then Check failed, then Released $0.10");
  });

  it("splits to 100 and survives an empty whole", () => {
    expect(splitPercents([60, 30, 10])).toEqual([60, 30, 10]);
    expect(splitPercents([0, 0])).toEqual([0, 0]);
    expect(splitPercents([-1, Number.NaN, 2])).toEqual([0, 0, 100]);
  });
});

describe("checklist", () => {
  const steps = [
    { id: "a", title: "A", state: "done" as const },
    { id: "b", title: "B", state: "current" as const, content: "x" },
    { id: "c", title: "C", state: "todo" as const, optional: true },
  ];

  it("counts required steps only", () => {
    expect(checklistProgress(steps)).toEqual({ done: 1, total: 2, complete: false });
    expect(checklistProgress([{ state: "done" }, { state: "todo", optional: true }])).toMatchObject({ complete: true });
    expect(checklistProgress([])).toMatchObject({ complete: false });
  });

  it("opens the current step", () => {
    expect(defaultExpandedStep(steps)).toBe("b");
  });
});

describe("small helpers", () => {
  it("shortens ids without losing what tells them apart", () => {
    expect(shortId("06399979-f8b8-4c9e-a9b1-bd2a5924d442")).toBe("06399979…");
    expect(shortId("0x83ab1234567890abcdef2913")).toBe("0x83ab…2913");
    expect(shortId("short")).toBe("short");
  });

  it("matches presets numerically", () => {
    expect(matchesPreset("20.00", ["5", "20"])).toBe(true);
    expect(matchesPreset("", ["5"])).toBe(false);
    expect(matchesPreset("7", ["5", "20"])).toBe(false);
  });
});
