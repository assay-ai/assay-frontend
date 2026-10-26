// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogueSettlementAsset, CatalogueTool, ToolBindingDetail } from "@/interfaces";
import { WithChains } from "@/test/chain-fixture";

const check = vi.hoisted(() => ({ requirements: [] as { requirement: string; met: boolean }[] }));
vi.mock("@/services/provider-tool-bindings.service", () => ({ getPublishCheck: vi.fn(async () => check) }));
vi.mock("@/features/provider-stake/use-stake-status", () => ({
  useStakeStatus: () => ({ isLoading: false, isError: false, stake: null, staked: null, refetch: vi.fn() }),
}));
vi.mock("@/features/provider-stake/stake-sheet", () => ({ StakeSheet: () => null }));
vi.mock("../tool-name", () => ({ useProviderToolNames: () => ({ tool: () => null }) }));

import { LiveStage, liveFormOf } from "./live-stage";

const ASSET = { assetId: "eip155:46630/erc20:0x915E", decimals: 6 } as unknown as CatalogueSettlementAsset;
const TOOL = { id: "t1", name: "quote", description: "d", versions: [] } as unknown as CatalogueTool;
const draft = {
  id: "b1",
  toolId: "t1",
  status: "DRAFT",
  pricingMode: "FREE",
  price: { amount: "0", asset: ASSET.assetId, decimals: 6 },
  freeQuotaPerAgent: null,
  freeDailyBudget: null,
  slaFailureRate: 0.02,
  timeoutMs: 10_000,
} as unknown as ToolBindingDetail;

function mount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WithChains>
        <LiveStage tool={TOOL} binding={draft} asset={ASSET} terms={null} priceHint="0.01" readOnly={false} onSave={async () => draft} onPublish={async () => undefined} onBackToTest={() => undefined} />
      </WithChains>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  check.requirements = [];
});

/* Onboarding wave item 2: start free; Paid is an opt-in upgrade that says what it needs. */
describe("Go live starts free", () => {
  it("a new draft starts on Free even with a price hint, which only prefills the price", () => {
    expect(liveFormOf(draft, "0.01")).toMatchObject({ choice: "free", price: "0.01" });
  });

  it("says nothing about stake, gas or USDG on Free", () => {
    mount();
    expect(screen.queryByTestId("paid-needs")).toBeNull();
    expect(screen.queryByTestId("stake-short-banner")).toBeNull();
  });

  it("on Paid, lists what it needs in the chain's own asset", () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Paid" }));
    const needs = screen.getByTestId("paid-needs").textContent!;
    expect(needs).toContain("Stake: $50.00");
    expect(needs).toContain("USDG in your stake wallet");
    expect(needs).toContain("Robinhood Chain testnet ETH");
  });

  it("when the publish check says the stake is short, shows a banner with Add stake, not a silent button", async () => {
    check.requirements = [{ requirement: "STAKE_AT_MINIMUM_ON_EVERY_CHAIN", met: false }];
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Paid" }));
    await waitFor(() => expect(screen.getByTestId("stake-short-banner")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Add stake" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /stake and publish/ })).toBeTruthy();
  });
});
