// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolBindingDetail } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";

/* The paid-call minimum on a listing's Settings: shown, checked, and the API's refusal on the price box. */

const binding = {
  id: "b1",
  toolId: "t1",
  endpoint: "https://p.test/v1",
  publishedEndpoint: "https://p.test/v1",
  status: "PAUSED",
  version: 1,
  authMode: "SIGNATURE",
  pricingMode: "FREE",
  price: { amount: "0", asset: "a", decimals: 6 },
  freeQuotaPerAgent: null,
  freeDailyBudget: null,
  slaFailureRate: 0.05,
  timeoutMs: 10000,
  maxRps: null,
  maxDailyCalls: null,
  hasUnpublishedChanges: false,
} as unknown as ToolBindingDetail;

const service = vi.hoisted(() => ({ updateToolBinding: vi.fn() }));
vi.mock("@/services/provider-tool-bindings.service", () => service);
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("binding=b1") }));
vi.mock("@/features/account-block/use-account-block", () => ({ useAccountReadOnly: () => false }));
vi.mock("@/features/provider-stake/use-stake-status", () => ({ useStakeStatus: () => ({ stake: null, staked: null, refetch: vi.fn() }) }));
vi.mock("@/features/provider-stake/stake-sheet", () => ({ StakeSheet: () => null }));
vi.mock("@/features/provider-binding/tool-name", () => ({
  useProviderCatalogue: () => ({ data: { settlementAsset: { assetId: "a", symbol: "USDG", decimals: 6, minPaidPrice: "100000" } } }),
}));
vi.mock("@/features/provider-binding/binding-header", () => ({
  bindingQueryKey: (id: string) => ["provider", "tool-binding", id],
  useBinding: () => ({ data: binding, isError: false }),
  BindingHeader: () => null,
}));
vi.mock("@/features/provider-binding/authentication/authentication-panel", () => ({ AuthenticationPanel: () => null }));

import BindingSettingsPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BindingSettingsPage />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("radio", { name: "Paid" }));
}

describe("Settings: the paid-call minimum", () => {
  it("shows the minimum and refuses a lower price before sending", () => {
    renderPage();
    expect(screen.getByText("Enter a price per call of at least $0.10.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: /^Price per call/ }), { target: { value: "0.05" } });
    expect(screen.getByText("At least $0.10 per paid call. Choose Free for no charge.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: /^Price per call/ }), { target: { value: "0.10" } });
    expect(screen.getByText(/^Minimum \$0\.10 per paid call\./)).toBeTruthy();
  });

  it("puts the API's PROVIDER_BINDING_PRICE_BELOW_MINIMUM on the price box", async () => {
    service.updateToolBinding.mockRejectedValue(
      new ApiError("PROVIDER_BINDING_PRICE_BELOW_MINIMUM", "x", 400, "/p", { minimumAmount: "250000", decimals: 6 }),
    );
    renderPage();
    fireEvent.change(screen.getByRole("textbox", { name: /^Price per call/ }), { target: { value: "0.20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(service.updateToolBinding).toHaveBeenCalled());
    expect(await screen.findByText("At least $0.25 per paid call. Choose Free for no charge.")).toBeTruthy();
    // Typing again clears it until the next save.
    fireEvent.change(screen.getByRole("textbox", { name: /^Price per call/ }), { target: { value: "0.30" } });
    expect(screen.queryByText("At least $0.25 per paid call. Choose Free for no charge.")).toBeNull();
  });
});
