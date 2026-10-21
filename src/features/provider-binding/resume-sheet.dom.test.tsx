// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderStake, ToolBindingDetail } from "@/interfaces";

/*
  B9: Resume asks first, like Pause. The sheet only shows what the listing
  takes on again (price, promise, stake); confirming runs the same resume
  call, once.
*/
const usd = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x1", decimals: 6 });

const STAKE = {
  stake: [{ chainId: "eip155:46630", staked: usd("80000000") }],
  requirement: [],
  requirementTotal: null,
  shortfall: null,
  recommendedBuffer: null,
} as unknown as ProviderStake;

vi.mock("@/services/provider-stake.service", () => ({ getProviderStake: vi.fn(async () => STAKE) }));
vi.mock("@/features/provider-stake/use-stake-status", () => ({
  useStakeStatus: () => ({ stake: STAKE, staked: usd("80000000"), isLoading: false }),
}));

import { resumeFacts, ResumeSheet } from "./resume-sheet";

const PAUSED = {
  id: "b1",
  toolId: "t1",
  status: "PAUSED",
  pricingMode: "PAID",
  price: usd("100000"),
  slaFailureRate: 0.02,
} as unknown as ToolBindingDetail;

afterEach(cleanup);

function mount(onConfirm: () => Promise<unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ResumeSheet open onOpenChange={() => undefined} binding={PAUSED} toolName="Market quote" onConfirm={onConfirm} />
    </QueryClientProvider>,
  );
}

describe("the Resume confirm sheet", () => {
  it("shows the price, the promise and the stake before anything happens", () => {
    const onConfirm = vi.fn(async () => undefined);
    mount(onConfirm);

    expect(screen.getByText("Resume Market quote?")).toBeTruthy();
    const facts = screen.getByTestId("resume-facts").textContent ?? "";
    expect(facts).toContain("$0.10 a call");
    expect(facts).toContain("At most 2% of checked calls fail");
    // $0.10 × 1,000 calls is over the $50 floor.
    expect(facts).toContain("$100.00");
    expect(facts).toContain("$80.00");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirming runs the existing resume action once", async () => {
    const onConfirm = vi.fn(async () => undefined);
    mount(onConfirm);

    fireEvent.click(screen.getByRole("button", { name: "Resume listing" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });
});

describe("resumeFacts", () => {
  it("says a free listing needs no stake", () => {
    const facts = resumeFacts({ ...PAUSED, pricingMode: "FREE" }, STAKE, usd("0"));
    expect(facts.free).toBe(true);
    expect(facts.rows.map((row) => row.value)).toContain("None needed: a free listing puts no money at risk");
    expect(facts.shortfall).toBeNull();
  });

  it("names a shortfall when the stake does not cover the listing", () => {
    const facts = resumeFacts(PAUSED, STAKE, usd("20000000"));
    expect(facts.shortfall?.amount).toBe("80000000");
  });
});
