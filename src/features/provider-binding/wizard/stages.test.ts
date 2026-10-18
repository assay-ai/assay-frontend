import { describe, expect, it } from "vitest";

import { accountStepsDone, combinedProgress, wizardSteps } from "./stages";

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
