import { describe, expect, it, vi } from "vitest";

import {
  IDLE,
  isUserRejection,
  lastExplorerUrl,
  runWalletSteps,
  stepStatuses,
  trackerHeadline,
  type WalletRunState,
  type WalletStep,
} from "./wallet-steps";

function step(id: string, run: WalletStep["run"]): WalletStep {
  return { id, label: id, cost: "gas", run };
}

describe("runWalletSteps", () => {
  it("runs every step in order and reports each transition", async () => {
    const order: string[] = [];
    const seen: WalletRunState["phase"][] = [];
    const final = await runWalletSteps(
      [
        step("approve", async () => {
          order.push("approve");
        }),
        step("deposit", async ({ results }) => {
          order.push(`deposit after ${results.length}`);
          return { explorerUrl: "https://x/tx/1" };
        }),
      ],
      { onChange: (s) => seen.push(s.phase) },
    );
    expect(order).toEqual(["approve", "deposit after 1"]);
    expect(seen).toEqual(["running", "running", "success"]);
    expect(final.phase).toBe("success");
    expect(lastExplorerUrl(final.results)).toBe("https://x/tx/1");
  });

  it("stops at a wallet rejection, as declined — not failed", async () => {
    const second = vi.fn();
    const final = await runWalletSteps([
      step("approve", async () => {
        throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      }),
      step("deposit", second),
    ]);
    expect(final).toMatchObject({ phase: "declined", index: 0 });
    expect(second).not.toHaveBeenCalled();
  });

  it("reports any other error as failed, with the error", async () => {
    const boom = new Error("insufficient funds for gas");
    const final = await runWalletSteps([step("a", async () => Promise.reject(boom))]);
    expect(final).toMatchObject({ phase: "failed", index: 0, error: boom });
  });

  it("resumes at the declined step without re-running finished ones", async () => {
    const first = vi.fn(async () => ({ data: "approved" }));
    let attempts = 0;
    const steps = [
      step("approve", first),
      step("deposit", async ({ results }) => {
        attempts += 1;
        if (attempts === 1) throw new Error("User denied transaction signature");
        expect(results[0]).toEqual({ data: "approved" });
      }),
    ];
    const declined = await runWalletSteps(steps);
    expect(declined).toMatchObject({ phase: "declined", index: 1 });
    if (declined.phase !== "declined") throw new Error("unreachable");

    const final = await runWalletSteps(steps, { startAt: declined.index, results: declined.results });
    expect(final.phase).toBe("success");
    expect(first).toHaveBeenCalledTimes(1);
  });
});

describe("isUserRejection", () => {
  it.each([
    [{ code: 4001 }],
    [{ name: "UserRejectedRequestError" }],
    [{ message: "User rejected the request." }],
    [{ message: "wrapped", cause: { code: 4001 } }],
    [{ name: "WalletSignTransactionError", message: "x" }],
  ])("recognises %o", (error) => {
    expect(isUserRejection(error)).toBe(true);
  });

  it("does not treat a real failure as a rejection", () => {
    expect(isUserRejection(new Error("execution reverted"))).toBe(false);
    expect(isUserRejection(null)).toBe(false);
  });
});

describe("tracker", () => {
  it("counts signatures and marks per-step state", () => {
    expect(trackerHeadline(2, IDLE)).toBe("Signature 1 of 2");
    expect(trackerHeadline(2, { phase: "running", index: 1, results: [{}] })).toBe("Signature 2 of 2");
    expect(trackerHeadline(1, IDLE)).toBeNull();
    expect(stepStatuses(3, { phase: "declined", index: 1, results: [{}] })).toEqual(["done", "declined", "upcoming"]);
    expect(stepStatuses(2, { phase: "success", results: [{}, {}] })).toEqual(["done", "done"]);
    expect(stepStatuses(2, IDLE)).toEqual(["upcoming", "upcoming"]);
  });
});
