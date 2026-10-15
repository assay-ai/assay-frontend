import { describe, expect, it } from "vitest";

import { checklistProgress } from "@/components/patterns/setup-checklist";

import { listingProgress, type ListingProgressInput } from "./progress";

const registered = { termsAccepted: true, payoutWallet: true, endpoint: "https://api.example" };

function stateOf(input: Partial<ListingProgressInput>) {
  const progress = listingProgress({
    registration: registered,
    bindings: [],
    draftTestPassed: undefined,
    stakeEnough: null,
    ...input,
  });
  return Object.fromEntries(progress.steps.map((step) => [step.id, step.state]));
}

describe("listingProgress", () => {
  it("is loading until registration and bindings are known", () => {
    expect(listingProgress({ registration: undefined, bindings: [], draftTestPassed: undefined, stakeEnough: null }).loading).toBe(true);
    expect(listingProgress({ registration: null, bindings: undefined, draftTestPassed: undefined, stakeEnough: null }).loading).toBe(true);
  });

  it("starts a new account at the account step, everything else blocked", () => {
    const states = stateOf({ registration: null });
    expect(states).toMatchObject({ account: "current", wallet: "blocked", tool: "blocked", test: "blocked", live: "blocked" });
  });

  it("moves on to the first tool once account and wallet are done", () => {
    expect(stateOf({})).toMatchObject({ account: "done", wallet: "done", tool: "current", test: "blocked" });
  });

  it("treats stake as optional while every listing is free", () => {
    const progress = listingProgress({
      registration: registered,
      bindings: [{ id: "b1", status: "DRAFT", pricingMode: "FREE" }],
      draftTestPassed: true,
      stakeEnough: null,
    });
    const stake = progress.steps.find((step) => step.id === "stake")!;
    expect(stake.optional).toBe(true);
    expect(progress.steps.find((step) => step.id === "live")!.state).toBe("current");
    expect(progress.draftId).toBe("b1");
  });

  it("requires stake before going live with a paid listing", () => {
    const states = stateOf({ bindings: [{ id: "b1", status: "DRAFT", pricingMode: "PAID" }], draftTestPassed: true, stakeEnough: false });
    expect(states).toMatchObject({ test: "done", stake: "current", live: "blocked" });
  });

  it("is complete once a tool is live", () => {
    const progress = listingProgress({
      registration: registered,
      bindings: [{ id: "b1", status: "ACTIVE", pricingMode: "PAID" }],
      draftTestPassed: undefined,
      stakeEnough: true,
    });
    expect(progress.live).toBe(true);
    expect(checklistProgress(progress.steps).complete).toBe(true);
  });
});
