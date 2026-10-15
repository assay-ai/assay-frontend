import { afterEach, describe, expect, it, vi } from "vitest";

import { sheetSigning } from "./sign-action";
import { runWalletSteps, type WalletStep } from "./wallet-steps";

/*
  One demo behaviour for every wallet sheet (buyer deposit and withdraw,
  provider stake and dispute): the button can be pressed, the steps run as a
  simulation and end in the same success state as a live run, and the real
  `run` (the wallet) is never called. A live build is unchanged.
*/
function realSteps() {
  const approve = vi.fn(async () => ({ data: "0xapprove" }));
  const send = vi.fn(async () => ({ data: "0xsend" }));
  const steps: WalletStep[] = [
    { id: "approve", label: "Allow Assay to move USDG", cost: "gas", run: approve },
    { id: "send", label: "Stake $75.00", cost: "gas", run: send },
  ];
  return { steps, approve, send };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("sheetSigning on a demo build", () => {
  it("leaves the button enabled once the box is ticked", () => {
    const { steps } = realSteps();
    expect(sheetSigning({ demo: true, steps, needsAck: false })).toMatchObject({ disabled: false, disabledReason: undefined });
    expect(sheetSigning({ demo: true, steps, needsAck: true })).toMatchObject({
      disabled: true,
      disabledReason: "Tick the box above to continue.",
    });
  });

  it("keeps the caller's own reason (e.g. no amount yet)", () => {
    const { steps } = realSteps();
    expect(
      sheetSigning({ demo: true, steps, needsAck: false, disabled: true, disabledReason: "Pick or enter an amount." }),
    ).toMatchObject({ disabled: true, disabledReason: "Pick or enter an amount." });
  });

  it("walks every step to success without calling the wallet", async () => {
    vi.useFakeTimers();
    const { steps, approve, send } = realSteps();
    const signing = sheetSigning({ demo: true, steps, needsAck: false });
    expect(signing.steps.map((step) => [step.id, step.label, step.cost])).toEqual(
      steps.map((step) => [step.id, step.label, step.cost]),
    );
    const run = runWalletSteps(signing.steps);
    await vi.runAllTimersAsync();
    const final = await run;
    expect(final.phase).toBe("success");
    expect(final.results.map((result) => result?.data)).toEqual(["demo:approve", "demo:send"]);
    expect(approve).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("sheetSigning on a live build", () => {
  it("runs the caller's steps unchanged", () => {
    const { steps } = realSteps();
    const signing = sheetSigning({ demo: false, steps, needsAck: false });
    expect(signing.steps).toBe(steps);
    expect(signing.disabled).toBe(false);
  });
});
