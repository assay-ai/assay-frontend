import { describe, expect, it } from "vitest";

import { accountStepsDone, combinedProgress, resolveStage, wizardSteps } from "./stages";

describe("one progress line across setup and the listing wizard", () => {
  it("counts setup's three steps from the four onboarding steps", () => {
    expect(
      accountStepsDone([
        { key: "account", status: "DONE" },
        { key: "terms", status: "IN_PROGRESS" },
        { key: "payoutWallet", status: "DONE" },
        { key: "endpoint", status: "NOT_STARTED" },
      ]),
    ).toBe(1);
    expect(
      accountStepsDone(["account", "terms", "payoutWallet", "endpoint"].map((key) => ({ key, status: "DONE" }))),
    ).toBe(3);
  });

  it("reads Account n/3 · Listing n/3", () => {
    expect(combinedProgress(2, null)).toBe("Account 2/3 · Listing 0/3");
    expect(combinedProgress(3, "tool")).toBe("Account 3/3 · Listing 1/3");
    expect(combinedProgress(3, "live")).toBe("Account 3/3 · Listing 3/3");
  });

  it("marks the stage on screen current and the done ones done", () => {
    expect(wizardSteps("connect", new Set(["tool"])).map((step) => step.state)).toEqual(["done", "current", "upcoming"]);
  });
});

describe("resolveStage", () => {
  const base = { stageParam: null, draft: null, testPassed: false, hasTool: false, waitingOnDraft: false };

  it("falls back to picking a tool when Connect is asked for with no tool and no draft", () => {
    expect(resolveStage({ ...base, stageParam: "connect" })).toBe("tool");
  });

  it("falls back to picking a tool when the tool is not in the catalogue after the re-read", () => {
    expect(resolveStage({ ...base, stageParam: "connect", hasTool: false })).toBe("tool");
    expect(resolveStage({ ...base, stageParam: "connect", hasTool: true })).toBe("connect");
  });

  it("does not leave Connect while a named draft is still loading", () => {
    expect(resolveStage({ ...base, stageParam: "connect", waitingOnDraft: true })).toBe("connect");
  });

  it("sends Go live without a draft back to Connect or Tool", () => {
    expect(resolveStage({ ...base, stageParam: "live", hasTool: true })).toBe("connect");
    expect(resolveStage({ ...base, stageParam: "live" })).toBe("tool");
  });

  it("opens a draft on Connect until its test passes, then on Go live", () => {
    const draft = { status: "DRAFT" };
    expect(resolveStage({ ...base, draft, hasTool: true })).toBe("connect");
    expect(resolveStage({ ...base, draft, hasTool: true, testPassed: true })).toBe("live");
  });
});
