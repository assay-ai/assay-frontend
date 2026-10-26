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
const reg = vi.hoisted(() => ({ ownerContact: null as null | { name: string; email: string; phone: null } }));
vi.mock("@/services/provider-registration.service", () => ({
  getProviderRegistration: vi.fn(async () => ({ registration: { ownerContact: reg.ownerContact, payoutAccounts: [] } })),
}));

import { LiveStage } from "./live-stage";

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
  reg.ownerContact = null;
});

/* Onboarding wave 2 item 5: optional at sign-up, asked with a clear prompt before a paid listing. */
describe("Go live asks for a second contact only when charging", () => {
  const prompt = /Paid tools need a second contact/;

  it("never asks on Free", async () => {
    mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(prompt)).toBeNull();
  });

  it("asks on Paid when the registration has none, with a link to add one", async () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Paid" }));
    await waitFor(() => expect(screen.getByText(prompt)).toBeTruthy());
    expect(screen.getByRole("link", { name: "Add a second contact" }).getAttribute("href")).toBe("/provider/setup?step=you");
  });

  it("does not ask once a second contact is set", async () => {
    reg.ownerContact = { name: "Sam", email: "sam@acme.example", phone: null };
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Paid" }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByText(prompt)).toBeNull();
  });
});
